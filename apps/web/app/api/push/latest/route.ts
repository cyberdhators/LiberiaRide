import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notificationHref } from "@/lib/notification-href";

export const dynamic = "force-dynamic";

/**
 * Called by the service worker when an (empty) push arrives: returns the
 * signed-in user's recent, not yet shown alerts. Pushes carry no payload, so
 * the text only ever travels over our own authenticated connection.
 */
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("push_take_recent");
  if (error) return NextResponse.json({ items: [] }, { status: error.code === "28000" ? 401 : 200, headers: { "Cache-Control": "no-store" } });
  const items = (data ?? []).map((r: { id: number; kind: string; title: string; body: string | null; data: Record<string, unknown>; urgent: boolean }) => ({
    id: r.id, kind: r.kind, title: r.title, body: r.body, urgent: r.urgent,
    url: notificationHref(r) ?? "/notifications",
  }));
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
