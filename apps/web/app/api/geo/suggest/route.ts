import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, json, requireApiUser } from "@/lib/api";

const Body = z.object({
  q: z.string().trim().min(2).max(80),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

/**
 * Type-ahead suggestions while the passenger types: curated landmarks, then OpenStreetMap places
 * and streets of Greater Monrovia, nearest first. Free (our database only — no QLS credit).
 */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Type at least 2 characters.");
  const { q, lat, lng } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("suggest_places", { p_query: q, p_lat: lat ?? null, p_lng: lng ?? null, p_limit: 12 });
  if (error) return fail(500, "Suggestions are unavailable right now.");

  // The same place is often mapped twice (a point and a building): keep the first of each name nearby.
  const seen: { name: string; lat: number; lng: number }[] = [];
  const results = [];
  for (const r of (data ?? []) as { label: string; subtitle: string | null; lat: number; lng: number; source: string; qls_code: string | null }[]) {
    const name = r.label.toLowerCase();
    if (seen.some((s) => s.name === name && Math.abs(s.lat - r.lat) < 0.004 && Math.abs(s.lng - r.lng) < 0.004)) continue;
    seen.push({ name, lat: r.lat, lng: r.lng });
    results.push({ label: r.label, subtitle: r.subtitle, lat: r.lat, lng: r.lng, source: r.source, qlsRef: r.qls_code });
    if (results.length === 8) break;
  }
  return json({ results });
}
