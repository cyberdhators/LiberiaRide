import "server-only";
import { isValidAddressQuery } from "@liberia-ride/geospatial";
import { formatMoney, type Currency } from "@liberia-ride/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { cached, qls } from "@/lib/qls";
import { sendWhatsApp } from "./client";
import { buttons, intentOf, locationRequest, text, type Inbound } from "./protocol";

/**
 * WhatsApp booking conversation. Uses the SAME booking engine RPCs as the web app
 * (service-role variants that take the passenger id resolved from the verified sender).
 *
 * States: idle → await_pickup → await_dropoff → await_confirm → in_ride
 */
type State = "idle" | "await_pickup" | "await_dropoff" | "await_confirm" | "in_ride";
interface Place { lat: number; lng: number; label: string; qlsRef?: string | null }
interface Ctx { pickup?: Place; dropoff?: Place; estimates?: { id: string; category: string; total: string; currency: Currency }[] }
interface Conversation { id: string; wa_id: string; profile_id: string | null; state: State; context: Ctx; active_booking_id: string | null }

const CATEGORIES = ["keke", "car"] as const;
const CURRENCY: Currency = "USD";

export async function handleInbound(msg: Inbound): Promise<void> {
  const admin = createAdminClient();
  const conv = await loadConversation(msg.from, msg.name);

  // Idempotency: WhatsApp retries webhooks; the message id is unique.
  const { error: dup } = await admin.from("whatsapp_messages").insert({
    conversation_id: conv.id, wa_message_id: msg.id, direction: "inbound", msg_type: msg.kind,
    body: msg.kind === "text" ? { text: msg.text } : msg.kind === "location" ? { lat: msg.lat, lng: msg.lng, label: msg.label } : msg.kind === "button" ? { id: msg.buttonId } : { type: msg.type },
  });
  if (dup?.code === "23505") return;
  await admin.from("whatsapp_conversations").update({ last_inbound_at: new Date().toISOString() }).eq("id", conv.id);

  const reply = (body: Record<string, unknown>) => send(conv, body);
  const setState = (state: State, context: Ctx, active: string | null = conv.active_booking_id) =>
    admin.from("whatsapp_conversations").update({ state, context, active_booking_id: active }).eq("id", conv.id);

  // Check whether the tracked ride already ended.
  if (conv.active_booking_id) {
    const { data: b } = await admin.from("bookings").select("status").eq("id", conv.active_booking_id).maybeSingle();
    if (!b || ["COMPLETED", "CANCELLED", "EXPIRED", "FAILED"].includes(b.status)) {
      conv.active_booking_id = null;
      conv.state = "idle";
      await setState("idle", {}, null);
    }
  }

  const intent = msg.kind === "text" ? intentOf(msg.text) : "other";

  if (intent === "help") {
    return void reply(text(msg.from, "LiberiaRide on WhatsApp:\n• Send HI to book a ride\n• Share your location for pickup\n• Type a landmark or “street, city” for the destination\n• CANCEL to cancel · STATUS for your ride · AGENT to talk to support"));
  }
  if (intent === "agent") {
    await admin.from("complaints").insert({ complainant_id: conv.profile_id, booking_id: conv.active_booking_id, category: "other", description: "WhatsApp user asked for a support agent." });
    return void reply(text(msg.from, "A support agent will contact you on this number shortly."));
  }
  if (intent === "cancel") {
    if (!conv.active_booking_id) {
      await setState("idle", {});
      return void reply(text(msg.from, "Nothing to cancel. Send HI to book a ride."));
    }
    const { error } = await admin.rpc("whatsapp_cancel_booking", { p_passenger_id: conv.profile_id, p_booking_id: conv.active_booking_id });
    await setState("idle", {}, null);
    return void reply(text(msg.from, error ? "That ride can no longer be cancelled here (it may already be in progress). Reply AGENT for help." : "Cancelled. Send HI to book again."));
  }
  if (intent === "status" || (conv.state === "in_ride" && intent !== "start")) {
    if (!conv.active_booking_id) return void reply(text(msg.from, "You have no active ride. Send HI to book."));
    const { data: b } = await admin.from("bookings").select("code, status").eq("id", conv.active_booking_id).single();
    return void reply(text(msg.from, `Ride ${b?.code}: ${String(b?.status ?? "").replaceAll("_", " ").toLowerCase()}. Reply CANCEL to cancel.`));
  }
  if (intent === "start" || conv.state === "idle") {
    await setState("await_pickup", {});
    return void reply(locationRequest(msg.from, "Welcome to LiberiaRide 🚕\nWhere should we pick you up? Tap below to share your location, or type a landmark (e.g. “Red Light Market”)."));
  }

  if (conv.state === "await_pickup") {
    const place = await resolvePlace(msg, conv.profile_id);
    if (!place) return void reply(text(msg.from, "I couldn't find that pickup. Share your location, or try a landmark or “street, city”."));
    await setState("await_dropoff", { pickup: place });
    return void reply(text(msg.from, `Pickup: ${place.label}\nWhere are you going? Share a location or type a landmark / “street, city”.`));
  }

  if (conv.state === "await_dropoff") {
    const ctx = conv.context;
    const place = await resolvePlace(msg, conv.profile_id);
    if (!place || !ctx.pickup) return void reply(text(msg.from, "I couldn't find that destination. Try a landmark or “street, city”, or share a location."));
    const estimates = await estimate(conv.profile_id!, ctx.pickup, place);
    if (!estimates.length) {
      await setState("await_pickup", {});
      return void reply(text(msg.from, "Sorry, we can't serve that trip (it may be outside Greater Monrovia). Send HI to start again."));
    }
    await setState("await_confirm", { ...ctx, dropoff: place, estimates });
    return void reply(buttons(msg.from,
      `${ctx.pickup.label} → ${place.label}\nChoose your ride (pay cash to the driver):`,
      [...estimates.map((e) => ({ id: `book:${e.id}`, title: `${e.category === "keke" ? "Keke" : "Car"} ${formatMoney({ minor: BigInt(e.total), currency: e.currency })}` })), { id: "cancel", title: "Cancel" }]));
  }

  if (conv.state === "await_confirm") {
    if (msg.kind !== "button" || msg.buttonId === "cancel") {
      await setState("idle", {});
      return void reply(text(msg.from, "No problem. Send HI whenever you need a ride."));
    }
    const estimateId = msg.buttonId.replace(/^book:/, "");
    if (!conv.context.estimates?.some((e) => e.id === estimateId)) return void reply(text(msg.from, "That option has expired. Send HI to start again."));
    const { data, error } = await admin.rpc("whatsapp_create_booking", { p_passenger_id: conv.profile_id, p_estimate_id: estimateId, p_idempotency_key: `wa_${msg.id}`.slice(0, 100) });
    if (error) {
      await setState("idle", {});
      const msgText = /expired/.test(error.message) ? "That price expired. Send HI to get a new one." : /active/.test(error.message) || error.code === "23505" ? "You already have a ride in progress. Reply STATUS." : "Sorry, we couldn't book that ride. Send HI to try again.";
      return void reply(text(msg.from, msgText));
    }
    const booking = data as { id: string; code: string };
    await setState("in_ride", {}, booking.id);
    return void reply(text(msg.from, `Booking ${booking.code} confirmed. Finding a driver near you… We'll message you when a driver accepts. Reply CANCEL to cancel.`));
  }
}

async function loadConversation(waId: string, name: string | null): Promise<Conversation> {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("whatsapp_conversations").select("id, wa_id, profile_id, state, context, active_booking_id").eq("wa_id", waId).maybeSingle();
  if (existing?.profile_id) return existing as Conversation;

  // Identify or create the passenger by phone number (WhatsApp numbers are verified by Meta).
  const phone = `+${waId}`;
  let profileId: string | null = null;
  const { data: profile } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle();
  if (profile) profileId = profile.id;
  else {
    const { data: created, error } = await admin.auth.admin.createUser({ phone, phone_confirm: true, user_metadata: { full_name: name ?? undefined, source: "whatsapp" } });
    if (error) throw error;
    profileId = created.user.id;
  }
  const { data: conv, error } = await admin.from("whatsapp_conversations")
    .upsert({ wa_id: waId, profile_id: profileId }, { onConflict: "wa_id" })
    .select("id, wa_id, profile_id, state, context, active_booking_id").single();
  if (error) throw error;
  return conv as Conversation;
}

async function resolvePlace(msg: Inbound, profileId: string | null): Promise<Place | null> {
  if (msg.kind === "location") return { lat: msg.lat, lng: msg.lng, label: msg.label ?? `Shared location (${msg.lat.toFixed(4)}, ${msg.lng.toFixed(4)})` };
  if (msg.kind !== "text" || msg.text.trim().length < 3) return null;
  const q = msg.text.trim();
  const admin = createAdminClient();
  const { data: aliases } = await admin.rpc("search_address_aliases", { p_query: q, p_limit: 1 });
  const a = (aliases as { alias: string; lat: number; lng: number; qls_code: string | null }[] | null)?.[0];
  if (a) return { lat: a.lat, lng: a.lng, label: a.alias, qlsRef: a.qls_code };
  const providers = qls(profileId);
  if (!providers.configured) return null;
  try {
    if (isValidAddressQuery(q)) {
      const rows = await cached("address", { q: q.toLowerCase() }, q, () => providers.addresses.searchAddresses(q, 1),
        (r) => (r[0] ? { ...r[0].point, label: r[0].label } : null));
      return rows[0] ? { ...rows[0].point, label: rows[0].label, qlsRef: rows[0].qlsRef } : null;
    }
    const p = await cached("place", { q: q.toLowerCase() }, q, () => providers.places.searchPlace(q), (x) => (x ? { ...x.point, label: x.label } : null));
    return p ? { ...p.point, label: p.label, qlsRef: p.qlsRef } : null;
  } catch {
    return null;
  }
}

async function estimate(passengerId: string, pickup: Place, dropoff: Place) {
  const admin = createAdminClient();
  const providers = qls(passengerId);
  let route: { distanceMeters: number; durationSeconds: number; polyline?: string | null } | null = null;
  if (providers.configured) {
    try {
      const key = [pickup, dropoff].map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(";");
      route = await cached("directions", { key }, key, () => providers.routing.directions(pickup, dropoff));
    } catch { /* geodesic fallback below */ }
  }
  const out: { id: string; category: string; total: string; currency: Currency }[] = [];
  for (const category of CATEGORIES) {
    const { data, error } = route
      ? await admin.rpc("create_fare_estimate_routed", {
          p_passenger_id: passengerId, p_category_code: category, p_currency: CURRENCY,
          p_pickup_lat: pickup.lat, p_pickup_lng: pickup.lng, p_pickup_address: pickup.label, p_pickup_qls_ref: pickup.qlsRef ?? null,
          p_dropoff_lat: dropoff.lat, p_dropoff_lng: dropoff.lng, p_dropoff_address: dropoff.label, p_dropoff_qls_ref: dropoff.qlsRef ?? null,
          p_stops: [], p_distance_m: route.distanceMeters, p_duration_s: route.durationSeconds, p_route_polyline: route.polyline ?? null,
          p_route_steps: null, p_coupon_code: null,
        })
      : await admin.rpc("create_fare_estimate_for", {
          p_passenger_id: passengerId, p_category_code: category, p_currency: CURRENCY,
          p_pickup_lat: pickup.lat, p_pickup_lng: pickup.lng, p_pickup_address: pickup.label,
          p_dropoff_lat: dropoff.lat, p_dropoff_lng: dropoff.lng, p_dropoff_address: dropoff.label,
        });
    if (!error && data) {
      const e = data as { id: string; total_minor: number | string };
      out.push({ id: e.id, category, total: String(e.total_minor), currency: CURRENCY });
    }
  }
  return out;
}

async function send(conv: Conversation, body: Record<string, unknown>) {
  const admin = createAdminClient();
  try {
    const id = await sendWhatsApp(body);
    await admin.from("whatsapp_messages").insert({ conversation_id: conv.id, wa_message_id: id || null, direction: "outbound", msg_type: String(body.type), body, status: "sent" });
  } catch (err) {
    await admin.from("whatsapp_messages").insert({ conversation_id: conv.id, direction: "outbound", msg_type: String(body.type), body, status: `failed: ${(err as Error).message.slice(0, 200)}` });
  }
}

/** Deliver queued booking updates (whatsapp_outbox, filled by a DB trigger). */
export async function flushOutbox(limit = 25): Promise<{ sent: number; failed: number }> {
  const admin = createAdminClient();
  const { data: rows } = await admin.from("whatsapp_outbox").select("id, wa_id, body, attempts").eq("status", "pending").order("created_at").limit(limit);
  let sent = 0, failed = 0;
  for (const r of rows ?? []) {
    try {
      await sendWhatsApp(text(r.wa_id, r.body));
      await admin.from("whatsapp_outbox").update({ status: "sent", sent_at: new Date().toISOString(), attempts: r.attempts + 1 }).eq("id", r.id);
      sent++;
    } catch (err) {
      await admin.from("whatsapp_outbox").update({ status: r.attempts + 1 >= 5 ? "failed" : "pending", attempts: r.attempts + 1, last_error: (err as Error).message.slice(0, 300) }).eq("id", r.id);
      failed++;
    }
  }
  return { sent, failed };
}
