import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BookingFlow, type Category, type SavedPlace } from "@/components/passenger/booking-flow";

export const metadata = { title: "Book a ride" };

const IN_FLIGHT = ["PENDING_CONFIRMATION", "SEARCHING_DRIVER", "DRIVER_OFFERED", "DRIVER_ASSIGNED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "IN_PROGRESS"];

export default async function PassengerHome() {
  const user = await requireUser("/passenger");
  const supabase = await createClient();

  // A passenger can have one ride in flight; send them straight to it.
  const { data: active } = await supabase
    .from("bookings")
    .select("id")
    .eq("passenger_id", user.id)
    .in("status", IN_FLIGHT)
    .maybeSingle();
  if (active) redirect(`/passenger/trip/${active.id}`);

  const [{ data: categories }, { data: places }, { data: passenger }, { data: config }, { data: profile }] = await Promise.all([
    supabase.from("vehicle_categories").select("code, name, description, seats").eq("is_active", true).order("sort_order"),
    supabase.rpc("my_saved_locations"),
    supabase.from("passengers").select("default_payment_method").eq("id", user.id).maybeSingle(),
    supabase.from("configuration_settings").select("key, value").in("key", ["bidding.enabled", "booking.max_stops"]),
    supabase.from("profiles").select("preferred_currency").eq("id", user.id).maybeSingle(),
  ]);
  const { data: biddingRules } = await supabase.from("fare_rules").select("category_id, vehicle_categories(code), bid_min_pct, bid_max_pct, bidding_enabled, currency").eq("is_active", true);

  const cfg = Object.fromEntries((config ?? []).map((c) => [c.key, c.value]));
  const bidding: Record<string, { min: number; max: number }> = {};
  for (const r of biddingRules ?? []) {
    const code = (r.vehicle_categories as unknown as { code: string } | null)?.code;
    if (code && r.bidding_enabled && cfg["bidding.enabled"] === true) bidding[`${code}:${r.currency}`] = { min: r.bid_min_pct, max: r.bid_max_pct };
  }

  return (
    <BookingFlow
      categories={(categories ?? []) as Category[]}
      savedPlaces={(places ?? []) as SavedPlace[]}
      defaultPayment={(passenger?.default_payment_method as "cash" | "orange_money" | "mtn_momo") ?? "cash"}
      defaultCurrency={(profile?.preferred_currency as "USD" | "LRD") ?? "USD"}
      maxStops={Number(cfg["booking.max_stops"] ?? 3)}
      bidding={bidding}
    />
  );
}
