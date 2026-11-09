import "server-only";
import { PaymentProviderError, type InitiateResult, type PaymentProvider, type StatusResult } from "./types";

/**
 * Orange Money Liberia — DISABLED pending official merchant documentation.
 *
 * Orange's developer portal offers "Orange Money Web Payment / M Payment" per country, with
 * credentials issued by the local Orange Money business team. We found no public Liberia
 * endpoint specification, so — per the project rules — no endpoint is guessed here.
 * When Orange Money Liberia provides the merchant API pack, implement initiate/checkStatus
 * from it and remove the unconditional unavailableReason (docs/PAYMENTS.md).
 */
export class OrangeMoneyProvider implements PaymentProvider {
  readonly id = "orange_money" as const;

  unavailableReason(): string {
    return "Orange Money payments are not live yet. Please pay your driver in cash.";
  }

  async initiate(): Promise<InitiateResult> {
    throw new PaymentProviderError(this.unavailableReason());
  }

  async checkStatus(): Promise<StatusResult> {
    throw new PaymentProviderError(this.unavailableReason());
  }
}
