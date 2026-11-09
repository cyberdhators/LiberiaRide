// Real-database integration tests through the public API (PostgREST + Auth), exactly as
// browsers call it. Skipped unless RUN_DB_TESTS=1 with Supabase credentials in the env.
//
//   RUN_DB_TESTS=1 npx vitest run apps/web/tests/integration
//
// Creates throw-away users (@liberiaride.test), runs the scenario, then deletes everything.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

function loadEnv() {
  const file = join(__dirname, "../../.env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
  }
}
loadEnv();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && URL && PUB && SECRET;

const PICKUP = { lat: 6.3002, lng: -10.7983 }; // Capitol Hill
const DROPOFF = { lat: 6.2394, lng: -10.7066 }; // ELWA Junction
const run = randomUUID().slice(0, 8);

interface TestUser { id: string; email: string; client: SupabaseClient }

describe.skipIf(!enabled)("dispatch & concurrency against the real database", () => {
  const admin = createClient(URL, SECRET, { auth: { persistSession: false } });
  const users: TestUser[] = [];
  let passenger: TestUser;
  let drivers: TestUser[] = [];

  async function makeUser(role: string): Promise<TestUser> {
    const email = `${role}-${run}-${randomUUID().slice(0, 6)}@liberiaride.test`;
    const password = `T3st!${randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `${role} ${run}` } });
    if (error) throw error;
    const client = createClient(URL, PUB, { auth: { persistSession: false } });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    const u = { id: data.user.id, email, client };
    users.push(u);
    return u;
  }

  beforeAll(async () => {
    passenger = await makeUser("pax");
    drivers = await Promise.all([0, 1, 2].map(() => makeUser("drv")));

    for (const [i, d] of drivers.entries()) {
      // Self-service onboarding through the real RPCs…
      const reg = await d.client.rpc("register_driver", { p_full_name: `Driver ${i} ${run}`, p_licence_number: `IT-${run}-${i}`, p_licence_expiry: "2030-01-01", p_date_of_birth: "1990-01-01", p_address_text: "Sinkor" });
      expect(reg.error).toBeNull();
      const veh = await d.client.rpc("register_vehicle", { p_category_code: "car", p_make: "Toyota", p_model: "Corolla", p_year: 2016, p_color: "White", p_plate_number: `IT${run}${i}`.slice(0, 20), p_registration_number: null });
      expect(veh.error).toBeNull();
      // …then the review steps an operator would do (service role stands in for the admin UI here).
      await admin.from("driver_documents").insert([
        { driver_id: d.id, doc_type: "driver_licence", storage_path: `${d.id}/lic-${run}.jpg`, mime_type: "image/jpeg", status: "approved" },
        { driver_id: d.id, doc_type: "vehicle_registration", storage_path: `${d.id}/reg-${run}.jpg`, mime_type: "image/jpeg", status: "approved" },
      ]);
      await admin.from("vehicles").update({ status: "approved" }).eq("driver_id", d.id);
      await admin.from("drivers").update({ status: "approved" }).eq("id", d.id);
      // Each driver 150–450 m from the pickup.
      const fix = await d.client.rpc("driver_update_location", { p_lat: PICKUP.lat + 0.0015 * (i + 1), p_lng: PICKUP.lng, p_accuracy_m: 10, p_heading_deg: null, p_speed_mps: null, p_recorded_at: new Date().toISOString() });
      expect((fix.data as { accepted: boolean }).accepted).toBe(true);
      const on = await d.client.rpc("driver_set_online", { p_online: true });
      expect(on.error).toBeNull();
    }
  }, 60_000);

  afterAll(async () => {
    const ids = users.map((u) => u.id);
    if (!ids.length) return;
    const { data: bookings } = await admin.from("bookings").select("id").in("passenger_id", ids);
    const bIds = (bookings ?? []).map((b) => b.id);
    if (bIds.length) {
      await admin.from("payments").delete().in("booking_id", bIds);
      await admin.from("driver_earnings").delete().in("booking_id", bIds);
      await admin.from("platform_commissions").delete().in("booking_id", bIds);
      await admin.from("cash_reconciliation").delete().in("booking_id", bIds);
      await admin.from("bookings").delete().in("id", bIds);
    }
    await admin.from("drivers").update({ current_vehicle_id: null, is_online: false }).in("id", ids);
    await admin.from("vehicles").delete().in("driver_id", ids);
    await admin.from("audit_logs").delete().in("actor_id", ids);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("passenger cannot read another user's data or write status directly", async () => {
    const other = drivers[0]!;
    const { data } = await passenger.client.from("drivers").select("id").eq("id", other.id);
    expect(data).toEqual([]);
    const upd = await passenger.client.from("bookings").update({ status: "COMPLETED" }).eq("passenger_id", passenger.id);
    expect(upd.error).not.toBeNull();
  });

  it("exactly one of three drivers wins a broadcast booking when all accept at once", async () => {
    // Bidding → broadcast strategy → all three drivers receive simultaneous offers.
    const est = await passenger.client.rpc("create_fare_estimate", {
      p_category_code: "car", p_currency: "USD",
      p_pickup_lat: PICKUP.lat, p_pickup_lng: PICKUP.lng, p_pickup_address: "Capitol Hill, Monrovia",
      p_dropoff_lat: DROPOFF.lat, p_dropoff_lng: DROPOFF.lng, p_dropoff_address: "ELWA Junction",
      p_stops: [], p_pickup_qls_ref: null, p_dropoff_qls_ref: null, p_coupon_code: null,
    });
    expect(est.error).toBeNull();
    const total = Number((est.data as { total_minor: number }).total_minor);

    const key = `bk_it_${run}`;
    const [b1, b2] = await Promise.all([
      passenger.client.rpc("create_booking", { p_estimate_id: (est.data as { id: string }).id, p_payment_method: "cash", p_idempotency_key: key, p_confirm: true, p_passenger_offer_minor: total, p_note: null }),
      passenger.client.rpc("create_booking", { p_estimate_id: (est.data as { id: string }).id, p_payment_method: "cash", p_idempotency_key: key, p_confirm: true, p_passenger_offer_minor: total, p_note: null }),
    ]);
    // Idempotency under concurrency: both calls resolve to the same booking (one may lose the unique race).
    const booking = (b1.data ?? b2.data) as { id: string; status: string; allocation_strategy: string };
    expect(booking).toBeTruthy();
    if (b1.data && b2.data) expect((b1.data as { id: string }).id).toBe((b2.data as { id: string }).id);
    expect(booking.allocation_strategy).toBe("broadcast");
    expect(booking.status).toBe("DRIVER_OFFERED");

    const offers = await Promise.all(drivers.map((d) => d.client.from("booking_offers").select("id").eq("booking_id", booking.id).eq("status", "pending").maybeSingle()));
    const offerIds = offers.map((o) => o.data?.id);
    expect(offerIds.every(Boolean)).toBe(true);

    const results = await Promise.all(drivers.map((d, i) => d.client.rpc("accept_offer", { p_offer_id: offerIds[i] })));
    const winners = results.filter((r) => !r.error);
    const losers = results.filter((r) => r.error);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(2);

    const { data: assignments } = await admin.from("booking_assignments").select("driver_id").eq("booking_id", booking.id).is("released_at", null);
    expect(assignments).toHaveLength(1);
    const { data: final } = await admin.from("bookings").select("status, driver_id, agreed_fare_minor").eq("id", booking.id).single();
    expect(final?.status).toBe("DRIVER_ASSIGNED");
    expect(Number(final?.agreed_fare_minor)).toBe(total);

    // Losing drivers can't see the booking row; the winner can.
    const winnerIdx = results.findIndex((r) => !r.error);
    for (const [i, d] of drivers.entries()) {
      const { data } = await d.client.from("bookings").select("id").eq("id", booking.id);
      expect(data?.length ?? 0).toBe(i === winnerIdx ? 1 : 0);
    }

    const cancel = await passenger.client.rpc("passenger_cancel_booking", { p_booking_id: booking.id, p_reason: "test" });
    expect(cancel.error).toBeNull();
  }, 60_000);
});
