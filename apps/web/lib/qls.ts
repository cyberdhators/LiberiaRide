import "server-only";
import { createHash } from "node:crypto";
import {
  QlsClient,
  QLSAddressProvider,
  QLSGeocodingProvider,
  QLSLocationProvider,
  QLSRoutingProvider,
  type ResolvedLocation,
  type Route,
} from "@liberia-ride/geospatial";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server-env";

/** Build QLS providers for one request; usage is logged to public.qls_usage for credit monitoring. */
export function qls(userId: string | null) {
  const env = serverEnv();
  const admin = createAdminClient();
  const client = new QlsClient({
    apiKey: env.QLS_API_KEY,
    baseUrl: env.QLS_BASE_URL,
    countryId: env.QLS_LIBERIA_COUNTRY_ID,
    onCall: async (rec) => {
      await admin.from("qls_usage").insert({
        endpoint: rec.endpoint,
        http_status: rec.httpStatus,
        error_code: rec.errorCode,
        billed: rec.billed,
        user_id: userId,
        latency_ms: rec.latencyMs,
      });
    },
  });
  return {
    configured: client.configured,
    places: new QLSGeocodingProvider(client),
    addresses: new QLSAddressProvider(client),
    location: new QLSLocationProvider(client),
    routing: new QLSRoutingProvider(client),
  };
}

const TTL_SECONDS = { place: 30 * 86400, address: 30 * 86400, directions: 3600 } as const;
type CacheKind = keyof typeof TTL_SECONDS;

export function cacheKey(kind: CacheKind, body: unknown): string {
  return createHash("sha256").update(kind + ":" + JSON.stringify(body)).digest("hex");
}

/** Read-through cache in public.qls_lookup_cache (service role). Saves credits on repeat lookups. */
export async function cached<T>(
  kind: CacheKind,
  keyBody: unknown,
  queryText: string,
  load: () => Promise<T>,
  locate?: (value: T) => { lat: number; lng: number; label: string } | null,
): Promise<T> {
  const admin = createAdminClient();
  const hash = cacheKey(kind, keyBody);
  const { data: hit } = await admin
    .from("qls_lookup_cache")
    .select("id, response, hit_count")
    .eq("kind", kind)
    .eq("query_hash", hash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (hit) {
    void admin.from("qls_lookup_cache").update({ hit_count: (hit.hit_count ?? 0) + 1 }).eq("id", hit.id);
    return hit.response as T;
  }
  const value = await load();
  if (value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)) {
    const loc = locate?.(value) ?? null;
    await admin.from("qls_lookup_cache").upsert(
      {
        kind,
        query_hash: hash,
        query_text: queryText.slice(0, 300),
        response: value as object,
        label: loc?.label ?? null,
        location: loc ? `SRID=4326;POINT(${loc.lng} ${loc.lat})` : null,
        expires_at: new Date(Date.now() + TTL_SECONDS[kind] * 1000).toISOString(),
      },
      { onConflict: "kind,query_hash" },
    );
  }
  return value;
}

export type { ResolvedLocation, Route };
