import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/server-env";

/**
 * Service-role client: bypasses RLS. Server-only, never sent to a browser.
 * Use ONLY for operations the user's own session cannot perform by design
 * (routed fare estimates, QLS cache/usage writes, webhooks), and always derive
 * the acting user id from a verified session — never from request input.
 */
export function createAdminClient() {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
