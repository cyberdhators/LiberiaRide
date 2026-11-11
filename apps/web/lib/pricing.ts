import "server-only";
import type { Route } from "@liberia-ride/geospatial";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cached, qls } from "@/lib/qls";
import { userMessage } from "@/lib/errors";
import { qlsBudgetExceeded } from "@/lib/api";

export interface TripPoint { lat: number; lng: number; address: string; qlsRef?: string | null }

export interface PricedTrip {
  estimates: Record<string, unknown>[];
  route: { polyline: string | null; distanceM: number; durationS: number; steps: unknown[] } | null;
  notice: string | null;
}

/**
 * Fare estimates for several categories from ONE route lookup — used by the passenger app and by
 * operators booking for a caller. The route comes from QLS directions (1 credit per leg, cached 1 h,
 * billed to `qlsUserId`); if QLS is unavailable the database computes a flagged geodesic fallback.
 * The price itself is ALWAYS computed in Postgres.
 *
 * `onBehalfOf`: price for another passenger (call-centre). Without a QLS route this uses the
 * service-role geodesic estimate for that passenger (no stops, no coupon).
 */
export async function priceTrip(opts: {
  qlsUserId: string; passengerId: string; onBehalfOf: boolean;
  pickup: TripPoint; dropoff: TripPoint; stops: TripPoint[]; categories: string[]; currency: "USD" | "LRD"; coupon?: string;
}): Promise<PricedTrip> {
  const { qlsUserId, passengerId, onBehalfOf, pickup, dropoff, stops, categories, currency, coupon } = opts;

  // 1. Route via QLS (best effort).
  let route: Route | null = null;
  let notice: string | null = null;
  const providers = qls(qlsUserId);
  if (providers.configured && !(await qlsBudgetExceeded(qlsUserId))) {
    const pts = [pickup, ...stops, dropoff].map((p) => ({ lat: p.lat, lng: p.lng }));
    const key = pts.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(";");
    try {
      route = await cached("directions", { key }, key, () => providers.routing.multiLeg(pts));
    } catch (err) {
      console.warn("[estimate] QLS directions failed, using geodesic fallback", err);
      notice = "Route service is slow; showing an approximate price.";
    }
  } else {
    notice = "Showing an approximate price.";
  }

  // 2. Price each category in the database.
  const stopsJson = stops.map((s) => ({ lat: s.lat, lng: s.lng, address: s.address, qls_ref: s.qlsRef ?? null }));
  const supabase = await createClient();
  const admin = createAdminClient();
  const estimates = await Promise.all(
    categories.map(async (category) => {
      const { data, error } = route
        ? await admin.rpc("create_fare_estimate_routed", {
            p_passenger_id: passengerId, // verified session, or a passenger the operator is permitted to book for
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
        : onBehalfOf
          ? await admin.rpc("create_fare_estimate_for", {
              p_passenger_id: passengerId, p_category_code: category, p_currency: currency,
              p_pickup_lat: pickup.lat, p_pickup_lng: pickup.lng, p_pickup_address: pickup.address,
              p_dropoff_lat: dropoff.lat, p_dropoff_lng: dropoff.lng, p_dropoff_address: dropoff.address,
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

  return {
    estimates,
    route: route ? { polyline: route.polyline ?? null, distanceM: route.distanceMeters, durationS: route.durationSeconds, steps: route.steps.slice(0, 60) } : null,
    notice,
  };
}
