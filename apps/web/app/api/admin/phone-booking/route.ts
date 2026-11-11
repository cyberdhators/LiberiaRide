import { z } from "zod";
import { normalizePhone } from "@liberia-ride/shared";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userMessage } from "@/lib/errors";
import { fail, json, requireApiUser } from "@/lib/api";
import { priceTrip } from "@/lib/pricing";

const Point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().min(1).max(300),
  qlsRef: z.string().max(100).nullish(),
});

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("price"),
    phone: z.string().trim().min(6).max(20),
    name: z.string().trim().min(2).max(80),
    pickup: Point,
    dropoff: Point,
    categories: z.array(z.string().regex(/^[a-z_]+$/)).min(1).max(6),
    currency: z.enum(["USD", "LRD"]),
  }),
  z.object({
    action: z.literal("book"),
    passengerId: z.uuid(),
    estimateId: z.uuid(),
    idempotencyKey: z.string().min(8).max(100),
    note: z.string().trim().max(300).optional(),
    scheduledFor: z.iso.datetime().optional(),
  }),
]);

/**
 * Call-centre booking: an operator with `bookings.create` books for a caller.
 *  - price: find the caller's passenger account by phone (or create one — phone-only, no app needed),
 *           then price the trip for that passenger (QLS route billed to the operator).
 *  - book:  create the booking AS THE OPERATOR via admin_create_booking_for (permission + audit in the DB).
 * Only account lookup/creation and pricing use the service role.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("has_permission", { p_permission: "bookings.create" });
  if (allowed !== true) return fail(403, "You do not have permission to book for callers.", "forbidden");

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Check the caller and trip details.");
  const body = parsed.data;

  if (body.action === "book") {
    const { data, error } = await supabase.rpc("admin_create_booking_for", {
      p_passenger_id: body.passengerId, p_estimate_id: body.estimateId, p_payment_method: "cash",
      p_idempotency_key: body.idempotencyKey, p_note: body.note ?? null, p_scheduled_for: body.scheduledFor ?? null,
    });
    if (error) return fail(error.code === "42501" ? 403 : 400, userMessage(error, "Could not create the booking."));
    const b = data as { id: string; code: string; status: string; scheduled_for: string | null };
    return json({ booking: { id: b.id, code: b.code, status: b.status, scheduledFor: b.scheduled_for } });
  }

  const phone = normalizePhone(body.phone);
  if (!phone) return fail(400, "Enter the caller's phone number, e.g. 077 012 3456.");
  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("id, full_name, is_suspended").eq("phone", phone).maybeSingle();
  let passenger = existing ? { id: existing.id as string, name: (existing.full_name as string | null) ?? body.name, isNew: false } : null;
  if (existing?.is_suspended) return fail(403, "This caller's account is suspended.", "suspended");
  if (!passenger) {
    const { data: created, error } = await admin.auth.admin.createUser({ phone, phone_confirm: true, user_metadata: { full_name: body.name } });
    if (error || !created.user) return fail(400, "Could not create an account for this caller.");
    passenger = { id: created.user.id, name: body.name, isNew: true };
  }
  if (passenger.id === auth.userId) return fail(400, "Use the passenger app to book for yourself.");
  await supabase.rpc("admin_log_caller_account", { p_passenger_id: passenger.id, p_created: passenger.isNew });

  const priced = await priceTrip({
    qlsUserId: auth.userId, passengerId: passenger.id, onBehalfOf: true,
    pickup: body.pickup, dropoff: body.dropoff, stops: [], categories: body.categories, currency: body.currency,
  });
  return json({ passenger, ...priced });
}
