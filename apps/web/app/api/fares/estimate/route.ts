import { z } from "zod";
import { fail, json, requireApiUser } from "@/lib/api";
import { priceTrip } from "@/lib/pricing";

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
 * Fare estimates for the signed-in passenger (see lib/pricing.ts).
 * The price itself is ALWAYS computed in Postgres — the client never supplies a fare.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Invalid trip details.");
  const { pickup, dropoff, stops, categories, currency, coupon } = parsed.data;

  const priced = await priceTrip({ qlsUserId: auth.userId, passengerId: auth.userId, onBehalfOf: false,
    pickup, dropoff, stops, categories, currency, coupon });
  return json(priced);
}
