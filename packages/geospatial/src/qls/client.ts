// Server-only QLS HTTP client. Never import this from a client component:
// it reads QLS_API_KEY and every call costs a credit.
import { QlsError, type QlsErrorCode } from "./errors";

export const QLS_DEFAULT_BASE_URL = "https://qls-global-api-15562653385.europe-west1.run.app";
export const QLS_LIBERIA_COUNTRY_ID = "0b2f0b78-152d-408d-b357-1af1ae4d2a49";

export type QlsEndpoint =
  | "/api/v1/search/ping"
  | "/api/v1/search/places"
  | "/api/v1/search/addresses"
  | "/api/v1/search/driver-distance"
  | "/api/v1/navigation/directions";

export interface QlsCallRecord {
  endpoint: QlsEndpoint;
  httpStatus: number;
  errorCode: string | null;
  /** Whether QLS charged a credit for this call (per the package's billing rules). */
  billed: boolean;
  latencyMs: number;
}

export interface QlsClientOptions {
  apiKey: string | undefined;
  baseUrl?: string;
  countryId?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Called after every call — used to write public.qls_usage for credit monitoring. */
  onCall?: (record: QlsCallRecord) => void | Promise<void>;
}

interface QlsEnvelope {
  data?: unknown;
  meta?: { count?: number };
  error?: { code?: string; message?: string; requestId?: string | null };
}

const KNOWN_CODES = new Set<QlsErrorCode>([
  "invalid_api_key", "api_inactive", "place_not_found", "country_required", "ping_inactive", "invalid_directions_request",
]);

/** Billing rules from the package: 400/401 are free; directions refunds non-OK routes. */
function wasBilled(endpoint: QlsEndpoint, status: number, data: unknown): boolean {
  if (status === 400 || status === 401 || status === 403) return false;
  if (status >= 500) return false;
  if (endpoint === "/api/v1/navigation/directions") {
    const d = data as { status?: string; steps?: unknown[] } | undefined;
    return status === 200 && d?.status === "OK" && Array.isArray(d.steps) && d.steps.length > 0;
  }
  return status === 200 || status === 404 || status === 409;
}

export class QlsClient {
  private readonly baseUrl: string;
  private readonly countryId: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: QlsClientOptions) {
    this.baseUrl = (opts.baseUrl || QLS_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.countryId = opts.countryId || QLS_LIBERIA_COUNTRY_ID;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.opts.apiKey);
  }

  get liberiaCountryId(): string {
    return this.countryId;
  }

  async post<T = unknown>(
    endpoint: QlsEndpoint,
    body: Record<string, unknown>,
    extraHeaders: Record<string, string> = {},
    { retry = false }: { retry?: boolean } = {},
  ): Promise<{ data: T; meta?: QlsEnvelope["meta"] }> {
    if (!this.opts.apiKey) {
      throw new QlsError("not_configured", "QLS_API_KEY is not set");
    }
    try {
      return await this.once<T>(endpoint, body, extraHeaders);
    } catch (err) {
      if (retry && err instanceof QlsError && err.isRetryable) {
        await new Promise((r) => setTimeout(r, 250 + Math.random() * 500));
        return this.once<T>(endpoint, body, extraHeaders);
      }
      throw err;
    }
  }

  private async once<T>(endpoint: QlsEndpoint, body: Record<string, unknown>, extraHeaders: Record<string, string>) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl + endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.opts.apiKey!,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (err) {
      const aborted = (err as Error)?.name === "AbortError";
      await this.record(endpoint, 0, aborted ? "timeout" : "network", false, started);
      throw new QlsError(aborted ? "timeout" : "network", aborted ? "QLS request timed out" : "QLS network error");
    } finally {
      clearTimeout(timer);
    }

    let json: QlsEnvelope = {};
    try {
      json = (await response.json()) as QlsEnvelope;
    } catch {
      // non-JSON body (proxy error page etc.)
    }

    const billed = wasBilled(endpoint, response.status, json.data);
    if (!response.ok) {
      const raw = json.error?.code;
      const code: QlsErrorCode = raw && KNOWN_CODES.has(raw as QlsErrorCode)
        ? (raw as QlsErrorCode)
        : response.status === 401 ? "invalid_api_key"
        : response.status === 400 ? "bad_request"
        : response.status >= 500 ? "server_error"
        : "bad_request";
      await this.record(endpoint, response.status, raw ?? code, billed, started);
      throw new QlsError(code, json.error?.message ?? `QLS HTTP ${response.status}`, response.status, json.error?.requestId ?? null);
    }

    await this.record(endpoint, response.status, null, billed, started);
    return { data: json.data as T, meta: json.meta };
  }

  private async record(endpoint: QlsEndpoint, httpStatus: number, errorCode: string | null, billed: boolean, started: number) {
    if (!this.opts.onCall) return;
    try {
      await this.opts.onCall({ endpoint, httpStatus, errorCode, billed, latencyMs: Date.now() - started });
    } catch {
      // Usage logging must never break a lookup.
    }
  }
}
