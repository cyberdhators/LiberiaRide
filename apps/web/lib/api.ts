import "server-only";
import { NextResponse } from "next/server";
import { QlsError } from "@liberia-ride/geospatial";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(status: number, message: string, code?: string) {
  return json({ error: { message, code: code ?? null } }, status);
}

/** Authenticated, non-suspended user id from the verified session, or a 401/403 response. */
export async function requireApiUser(): Promise<{ userId: string } | { response: NextResponse }> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { response: fail(401, "Please sign in.", "unauthenticated") };
  const { data: profile } = await supabase.from("profiles").select("is_suspended").eq("id", data.user.id).maybeSingle();
  if (profile?.is_suspended) return { response: fail(403, "Account suspended.", "suspended") };
  return { userId: data.user.id };
}

/**
 * Credit guard for QLS: each call costs ~USD 0.10, so per-user budgets are enforced
 * from the qls_usage ledger (shared across serverless instances).
 */
export async function qlsBudgetExceeded(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [{ count: perMinute }, { count: perDay }] = await Promise.all([
    admin.from("qls_usage").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", minuteAgo),
    admin.from("qls_usage").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("billed", true).gte("created_at", dayAgo),
  ]);
  if ((perMinute ?? 0) >= 12) return "Too many searches. Please wait a moment.";
  if ((perDay ?? 0) >= 150) return "Daily search limit reached. Use saved places or drop a pin on the map.";
  return null;
}

export function qlsFailure(err: unknown) {
  if (err instanceof QlsError) {
    const status = err.isServiceUnavailable ? 503 : err.code === "ping_inactive" ? 409 : err.isNotFound ? 404 : err.code === "bad_request" ? 400 : 502;
    return fail(status, err.userMessage, err.code);
  }
  console.error("[qls] unexpected error", err);
  return fail(502, "Location service error. Please try again.", "qls_error");
}
