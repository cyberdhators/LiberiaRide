import { z } from "zod";
import type { Route } from "@liberia-ride/geospatial";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cached, qls } from "@/lib/qls";
import { userMessage } from "@/lib/errors";
import { fail, json, qlsBudgetExceeded, requireApiUser } from "@/lib/api";

const Point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().min(1).max(300),
  qlsRef: z.string().max(100).nullish(),
});

const Body = z.object({
  pickup: Point,
  dropoff: Point,
  stops: z.array(Point).max(3).default([]),
  categories: z.array(z.string().regex(/^[a-z_]+$/)).min(1).max(6),
  currency: z.enum(["USD", "LRD"]),
  coupon: z.string().trim().max(32).optional(),
});

/**
 * Fare estimates for several categories from ONE route lookup.
 * The route comes from QLS directions (1 credit per leg, refunded when no route; cached 1 h);
 * if QLS is unavailable, the database computes a clearly-flagged geodesic fallback.
 * The price itself is ALWAYS computed in Postgres — the client never supplies a fare.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Invalid trip details.");
  const { pickup, dropoff, stops, categories, currency, coupon } = parsed.data;

  // 1. Route via QLS (best effort).
  let route: Route | null = null;
  let routeNotice: string | null = null;
  const providers = qls(auth.userId);
  if (providers.configured && !(await qlsBudgetExceeded(auth.userId))) {
    const pts = [pickup, ...stops, dropoff].map((p) => ({ lat: p.lat, lng: p.lng }));
    const key = pts.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(";");
    try {
      route = await cached("directions", { key }, key, () => providers.routing.multiLeg(pts));
    } catch (err) {
      console.warn("[estimate] QLS directions failed, using geodesic fallback", err);
      routeNotice = "Route service is slow; showing an approximate price.";
    }
  } else {
    routeNotice = "Showing an approximate price.";
  }

  // 2. Price each category in the database.
  const stopsJson = stops.map((s) => ({ lat: s.lat, lng: s.lng, address: s.address, qls_ref: s.qlsRef ?? null }));
  const supabase = await createClient();
  const admin = createAdminClient();
  const results = await Promise.all(
    categories.map(async (category) => {
      const { data, error } = route
        ? await admin.rpc("create_fare_estimate_routed", {
            p_passenger_id: auth.userId, // from the verified session, never from the request body
            p_category_code: category,
            p_currency: currency,
            p_pickup_lat: pickup.lat, p_pickup_lng: pickup.lng, p_pickup_address: pickup.address, p_pickup_qls_ref: pickup.qlsRef ?? null,
            p_dropoff_lat: dropoff.lat, p_dropoff_lng: dropoff.lng, p_dropoff_address: dropoff.address, p_dropoff_qls_ref: dropoff.qlsRef ?? null,
            p_stops: stopsJson,
            p_distance_m: route.distanceMeters,
            p_duration_s: route.durationSeconds,
            p_route_polyline: route.polyline ?? null,
            p_route_steps: route.steps.slice(0, 60),
            p_coupon_code: coupon || null,
          })
        : await supabase.rpc("create_fare_estimate", {
            p_category_code: category,
            p_currency: currency,
            p_pickup_lat: pickup.lat, p_pickup_lng: pickup.lng, p_pickup_address: pickup.address,
            p_dropoff_lat: dropoff.lat, p_dropoff_lng: dropoff.lng, p_dropoff_address: dropoff.address,
            p_stops: stopsJson,
            p_pickup_qls_ref: pickup.qlsRef ?? null,
            p_dropoff_qls_ref: dropoff.qlsRef ?? null,
            p_coupon_code: coupon || null,
          });
      if (error) return { category, error: userMessage(error, "Could not price this option.") };
      const est = data as Record<string, unknown>;
      return {
        category,
        estimateId: est.id as string,
        currency: est.currency as string,
        totalMinor: String(est.total_minor),
        subtotalMinor: String(est.subtotal_minor),
        discountMinor: String(est.discount_minor),
        distanceM: est.distance_m as number,
        durationS: est.duration_s as number,
        routeSource: est.route_source as string,
        expiresAt: est.expires_at as string,
        surgeMultiplier: Number(est.surge_multiplier ?? 1),
        breakdown: est.breakdown,
      };
    }),
  );

  return json({
    estimates: results,
    route: route ? { polyline: route.polyline ?? null, distanceM: route.distanceMeters, durationS: route.durationSeconds, steps: route.steps.slice(0, 60) } : null,
    notice: routeNotice,
  });
}
