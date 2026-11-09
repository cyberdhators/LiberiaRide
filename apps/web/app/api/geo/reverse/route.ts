import { z } from "zod";
import { pinnedLabel } from "@liberia-ride/geospatial";
import { createClient } from "@/lib/supabase/server";
import { fail, json, requireApiUser } from "@/lib/api";

const Body = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

/**
 * Coordinates → label. QLS's package has no reverse geocoding (documented GAP,
 * docs/QLS_INTEGRATION.md §5.2), so we use our landmark aliases and cached QLS
 * results, then fall back to a neutral "Pinned location" label. Free: no QLS call.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Invalid coordinates.");
  const { lat, lng } = parsed.data;

  const supabase = await createClient();
  const { data } = await supabase.rpc("nearest_place_label", { p_lat: lat, p_lng: lng });
  const hit = data as { label: string; source: string; qls_ref: string | null } | null;
  return json({
    result: {
      point: { lat, lng },
      label: hit?.label ?? pinnedLabel({ lat, lng }),
      source: hit ? (hit.source === "alias" ? "alias" : "pin") : "pin",
      qlsRef: hit?.qls_ref ?? null,
    },
  });
}
