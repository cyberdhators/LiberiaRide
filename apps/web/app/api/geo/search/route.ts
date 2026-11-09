import { z } from "zod";
import { isValidAddressQuery, type ResolvedLocation } from "@liberia-ride/geospatial";
import { createClient } from "@/lib/supabase/server";
import { cached, qls } from "@/lib/qls";
import { fail, json, qlsBudgetExceeded, qlsFailure, requireApiUser } from "@/lib/api";

const Body = z.object({
  q: z.string().trim().min(3).max(120),
  kind: z.enum(["auto", "place", "address"]).default("auto"),
});

/**
 * Location search. Order (cheapest first):
 *  1. verified local landmark aliases (free, our DB)
 *  2. QLS address search when the text looks like "street, city"   (1 credit, cached 30 days)
 *  3. QLS place search otherwise                                   (1 credit, cached 30 days)
 */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Type at least 3 characters.");
  const { q, kind } = parsed.data;

  const supabase = await createClient();
  const { data: aliases } = await supabase.rpc("search_address_aliases", { p_query: q, p_limit: 5 });
  const local: ResolvedLocation[] = (aliases ?? []).map((a: { alias: string; address_text: string | null; qls_code: string | null; lat: number; lng: number }) => ({
    point: { lat: a.lat, lng: a.lng },
    label: a.address_text ? `${a.alias} — ${a.address_text}` : a.alias,
    source: "alias" as const,
    qlsRef: a.qls_code,
  }));

  const useAddress = kind === "address" || (kind === "auto" && isValidAddressQuery(q));
  if (kind === "auto" && local.length > 0 && !useAddress) {
    return json({ results: local, source: "alias" });
  }

  const budget = await qlsBudgetExceeded(auth.userId);
  if (budget) return local.length ? json({ results: local, source: "alias", notice: budget }) : fail(429, budget, "rate_limited");

  const providers = qls(auth.userId);
  if (!providers.configured) {
    return local.length
      ? json({ results: local, source: "alias", notice: "Location search is temporarily limited." })
      : fail(503, "Location search is temporarily unavailable. Drop a pin on the map instead.", "not_configured");
  }

  try {
    if (useAddress) {
      const results = await cached("address", { q: q.toLowerCase() }, q, () => providers.addresses.searchAddresses(q, 8),
        (rows) => (rows[0] ? { ...rows[0].point, label: rows[0].label } : null));
      return json({ results: [...local, ...results], source: "qls_address" });
    }
    const place = await cached("place", { q: q.toLowerCase() }, q, () => providers.places.searchPlace(q),
      (p) => (p ? { ...p.point, label: p.label } : null));
    const results = place ? [...local, place] : local;
    if (!results.length) {
      return fail(404, "No match in Liberia. Try a landmark, or a street and city (e.g. “Tubman Blvd, Monrovia”).", "place_not_found");
    }
    return json({ results, source: "qls_place" });
  } catch (err) {
    return qlsFailure(err);
  }
}
