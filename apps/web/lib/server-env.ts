import "server-only";
import { z } from "zod";

const optional = z.string().optional().transform((v) => (v ? v : undefined));

const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20),
  QLS_API_KEY: optional,
  QLS_BASE_URL: optional,
  QLS_LIBERIA_COUNTRY_ID: optional,
  WHATSAPP_ACCESS_TOKEN: optional,
  WHATSAPP_PHONE_NUMBER_ID: optional,
  WHATSAPP_APP_SECRET: optional,
  WHATSAPP_VERIFY_TOKEN: optional,
  ORANGE_MONEY_CLIENT_ID: optional,
  ORANGE_MONEY_CLIENT_SECRET: optional,
  MTN_MOMO_SUBSCRIPTION_KEY: optional,
  MTN_MOMO_API_USER: optional,
  MTN_MOMO_API_KEY: optional,
});

let cached: z.infer<typeof serverSchema> | null = null;

/** Server-only secrets. Throws on first use if required values are missing. */
export function serverEnv() {
  cached ??= serverSchema.parse(process.env);
  return cached;
}
