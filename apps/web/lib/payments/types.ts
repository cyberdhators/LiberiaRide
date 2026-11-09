// Payment-provider abstraction (docs/PAYMENTS.md). Providers never mark a payment as paid
// on their own: the server records a result only after a provider STATUS query confirms it.

export type ProviderId = "mtn_momo" | "orange_money";
export type ProviderStatus = "pending" | "succeeded" | "failed";

export interface InitiateInput {
  paymentId: string;      // our payments.id (used as the provider externalId)
  amountMinor: bigint;
  currency: "USD" | "LRD";
  msisdn: string;          // E.164 payer number
  description: string;
  callbackUrl?: string;
}

export interface InitiateResult {
  providerReference: string;
  raw: Record<string, unknown>;
}

export interface StatusResult {
  status: ProviderStatus;
  reason?: string;
  providerTransactionId?: string;
  raw: Record<string, unknown>;
}

export interface PaymentProvider {
  id: ProviderId;
  /** Human-readable reason the provider cannot be used, or null when ready. */
  unavailableReason(): string | null;
  initiate(input: InitiateInput): Promise<InitiateResult>;
  checkStatus(providerReference: string): Promise<StatusResult>;
}

export class PaymentProviderError extends Error {
  constructor(message: string, readonly retryable = false, readonly httpStatus: number | null = null) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

/** Remove anything that looks like a secret before persisting provider payloads. */
export function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/token|secret|key|authorization|password/i.test(k)) out[k] = "[redacted]";
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = redact(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}
