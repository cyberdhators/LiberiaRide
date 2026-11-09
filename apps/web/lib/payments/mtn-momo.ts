import "server-only";
import { randomUUID } from "node:crypto";
import { PaymentProviderError, type InitiateInput, type InitiateResult, type PaymentProvider, type StatusResult } from "./types";

/**
 * MTN Mobile Money — MoMo Open API, Collections product (momodeveloper.mtn.com).
 *   POST {base}/collection/token/                       Basic(apiUser:apiKey) → access_token
 *   POST {base}/collection/v1_0/requesttopay            202 Accepted, X-Reference-Id = our UUID
 *   GET  {base}/collection/v1_0/requesttopay/{refId}    → { status: PENDING | SUCCESSFUL | FAILED, reason, ... }
 * Liberia production target environment: "mtnliberia" (sandbox: "sandbox", currency EUR).
 * The production base URL and credentials are issued at go-live by MTN / Lonestar Cell MTN,
 * so nothing here has a production default.
 */
export interface MtnMomoConfig {
  baseUrl?: string;
  subscriptionKey?: string;
  apiUser?: string;
  apiKey?: string;
  targetEnvironment?: string;
  fetchImpl?: typeof fetch;
}

export class MtnMomoProvider implements PaymentProvider {
  readonly id = "mtn_momo" as const;
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: MtnMomoConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  unavailableReason(): string | null {
    const missing = (["baseUrl", "subscriptionKey", "apiUser", "apiKey", "targetEnvironment"] as const).filter((k) => !this.cfg[k]);
    return missing.length ? `MTN MoMo is not configured (missing ${missing.join(", ")}).` : null;
  }

  private headers(extra: Record<string, string> = {}) {
    return { "Ocp-Apim-Subscription-Key": this.cfg.subscriptionKey!, ...extra };
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const basic = Buffer.from(`${this.cfg.apiUser}:${this.cfg.apiKey}`).toString("base64");
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/collection/token/`, {
      method: "POST",
      headers: this.headers({ Authorization: `Basic ${basic}` }),
      cache: "no-store",
    });
    if (!res.ok) throw new PaymentProviderError(`MoMo token request failed (${res.status})`, res.status >= 500, res.status);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const reason = this.unavailableReason();
    if (reason) throw new PaymentProviderError(reason);
    const referenceId = randomUUID();
    const amount = (Number(input.amountMinor) / 100).toFixed(2).replace(/\.00$/, "");
    const body = {
      amount,
      currency: input.currency,
      externalId: input.paymentId,
      payer: { partyIdType: "MSISDN", partyId: input.msisdn.replace(/^\+/, "") },
      payerMessage: input.description.slice(0, 160),
      payeeNote: input.description.slice(0, 160),
    };
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/collection/v1_0/requesttopay`, {
      method: "POST",
      headers: this.headers({
        Authorization: `Bearer ${await this.accessToken()}`,
        "X-Reference-Id": referenceId,
        "X-Target-Environment": this.cfg.targetEnvironment!,
        "Content-Type": "application/json",
        ...(input.callbackUrl ? { "X-Callback-Url": input.callbackUrl } : {}),
      }),
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (res.status !== 202) {
      const text = await res.text().catch(() => "");
      throw new PaymentProviderError(`MoMo rejected the request (${res.status}) ${text.slice(0, 200)}`, res.status >= 500, res.status);
    }
    return { providerReference: referenceId, raw: { request: { ...body, payer: { partyIdType: "MSISDN", partyId: "***" + body.payer.partyId.slice(-3) } }, httpStatus: 202 } };
  }

  async checkStatus(providerReference: string): Promise<StatusResult> {
    const reason = this.unavailableReason();
    if (reason) throw new PaymentProviderError(reason);
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/collection/v1_0/requesttopay/${encodeURIComponent(providerReference)}`, {
      headers: this.headers({ Authorization: `Bearer ${await this.accessToken()}`, "X-Target-Environment": this.cfg.targetEnvironment! }),
      cache: "no-store",
    });
    if (!res.ok) throw new PaymentProviderError(`MoMo status query failed (${res.status})`, res.status >= 500, res.status);
    const body = (await res.json()) as { status?: string; reason?: unknown; financialTransactionId?: string };
    const status = body.status === "SUCCESSFUL" ? "succeeded" : body.status === "FAILED" ? "failed" : "pending";
    const reasonText = typeof body.reason === "string" ? body.reason : (body.reason as { message?: string } | undefined)?.message;
    return { status, reason: reasonText, providerTransactionId: body.financialTransactionId, raw: { status: body.status, reason: reasonText ?? null, financialTransactionId: body.financialTransactionId ?? null } };
  }
}
