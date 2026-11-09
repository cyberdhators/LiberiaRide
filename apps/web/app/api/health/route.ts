import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server-env";
import { json } from "@/lib/api";

/** Liveness + dependency check for monitoring. Reveals configuration presence, never values. */
export async function GET() {
  const started = Date.now();
  let database = "ok";
  try {
    const { error } = await createAdminClient().from("configuration_settings").select("key").limit(1);
    if (error) database = "error";
  } catch {
    database = "error";
  }
  const env = serverEnv();
  return json(
    {
      status: database === "ok" ? "ok" : "degraded",
      database,
      qls: env.QLS_API_KEY ? "configured" : "missing",
      whatsapp: env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_APP_SECRET ? "configured" : "missing",
      payments: {
        orange_money: env.ORANGE_MONEY_CLIENT_ID ? "configured" : "missing",
        mtn_momo: env.MTN_MOMO_SUBSCRIPTION_KEY ? "configured" : "missing",
      },
      latency_ms: Date.now() - started,
    },
    database === "ok" ? 200 : 503,
  );
}
