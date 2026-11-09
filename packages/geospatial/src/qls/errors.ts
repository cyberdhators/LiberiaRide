// Error codes documented in the QLS rideshare package (docs/QLS_INTEGRATION.md §4, §7).

export type QlsErrorCode =
  | "invalid_api_key"
  | "api_inactive"
  | "place_not_found"
  | "country_required"
  | "ping_inactive"
  | "invalid_directions_request"
  | "bad_request"
  | "timeout"
  | "network"
  | "not_configured"
  | "invalid_response"
  | "server_error";

export class QlsError extends Error {
  constructor(
    readonly code: QlsErrorCode,
    message: string,
    readonly status: number | null = null,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "QlsError";
  }

  /** Account-level problems: alert operators, show "location search unavailable". */
  get isServiceUnavailable(): boolean {
    return this.code === "invalid_api_key" || this.code === "api_inactive" || this.code === "not_configured";
  }

  /** Lookups that legitimately found nothing. */
  get isNotFound(): boolean {
    return this.code === "place_not_found";
  }

  /** Worth one retry (idempotent lookups only). */
  get isRetryable(): boolean {
    return this.code === "timeout" || this.code === "network" || this.code === "server_error";
  }

  /** Safe message for end users (never leaks provider internals). */
  get userMessage(): string {
    switch (this.code) {
      case "place_not_found":
        return "No match in Liberia. Try a landmark, or a street and city (e.g. “Tubman Blvd, Monrovia”).";
      case "ping_inactive":
        return "This Ping is off. Ask the sender to turn it back on, or choose the pickup on the map.";
      case "invalid_api_key":
      case "api_inactive":
      case "not_configured":
        return "Location search is temporarily unavailable. You can still drop a pin on the map.";
      case "country_required":
      case "bad_request":
      case "invalid_directions_request":
        return "Please check the address and try again.";
      default:
        return "Location service is slow right now. Please try again.";
    }
  }
}
