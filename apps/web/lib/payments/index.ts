import "server-only";
import { serverEnv } from "@/lib/server-env";
import { MtnMomoProvider } from "./mtn-momo";
import { OrangeMoneyProvider } from "./orange-money";
import type { PaymentProvider, ProviderId } from "./types";

export function paymentProvider(id: ProviderId): PaymentProvider {
  const env = serverEnv();
  if (id === "mtn_momo") {
    return new MtnMomoProvider({
      baseUrl: process.env.MTN_MOMO_BASE_URL || undefined,
      subscriptionKey: env.MTN_MOMO_SUBSCRIPTION_KEY,
      apiUser: env.MTN_MOMO_API_USER,
      apiKey: env.MTN_MOMO_API_KEY,
      targetEnvironment: process.env.MTN_MOMO_TARGET_ENV || undefined,
    });
  }
  return new OrangeMoneyProvider();
}

export function isProviderId(v: unknown): v is ProviderId {
  return v === "mtn_momo" || v === "orange_money";
}

export * from "./types";
