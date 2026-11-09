"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Navigation, Phone, Power, ShieldAlert, Signal, WifiOff } from "lucide-react";
import { STATUS_LABELS } from "@liberia-ride/shared";
import { formatDuration, isFresh } from "@liberia-ride/geospatial";
import { createClient } from "@/lib/supabase/client";
import { getCurrentFix, useDeviceStatus, useGeoWatch, type Fix } from "@/hooks/use-geolocation";
import { useRealtime } from "@/hooks/use-realtime";
import { userMessage } from "@/lib/errors";
import { cn, money, timeAgo } from "@/lib/utils";
import { Map, type MapMarker } from "@/components/map";
import { Alert, Badge, Button, Card, Input } from "@/components/ui";
import { ChatPanel } from "@/components/chat-panel";
import { OfferCard, type Offer } from "./offer-card";

export interface DriverDashboard {
  status: "pending" | "approved" | "rejected" | "suspended";
  is_online: boolean;
  review_note: string | null;
  rating: number | null;
  completed_trips: number;
  acceptance_rate: number | null;
  vehicle: { id: string; make: string; model: string; color: string; plate: string; status: string; category: string; category_name: string } | null;
  documents: { id: string; doc_type: string; status: string; review_note: string | null; expires_at: string | null }[];
  location: { lat: number; lng: number; accuracy_m: number; received_at: string } | null;
  fresh_seconds: number;
  offers: Offer[];
  active_booking_id: string | null;
  today: { trips: number; currency_totals: Record<string, number> };
}

interface ActiveView {
  id: string; code: string; status: string; currency: string;
  pickup: { lat: number; lng: number; address: string }; dropoff: { lat: number; lng: number; address: string };
  stops: { id: string; seq: number; kind: string; address: string; lat: number; lng: number; arrived_at: string | null; departed_at: string | null }[];
  estimated_fare_minor: number; agreed_fare_minor: number | null; final_fare_minor: number | null;
  payment_method: string; payment_status: string; route_polyline: string | null;
  passenger: { name: string; rating: number | null; phone: string | null } | null;
  arrived_at: string | null;
}

const SEND_EVERY_MS = 4_000;
const HEARTBEAT_MS = 15_000;

export function DriverConsole({ initial, userId }: { initial: DriverDashboard; userId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [dash, setDash] = useState(initial);
  const [offers, setOffers] = useState<Offer[]>(initial.offers);
  const [active, setActive] = useState<ActiveView | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(initial.is_online || Boolean(initial.active_booking_id));
  const [lastSent, setLastSent] = useState<{ at: number; accepted: boolean; reason?: string } | null>(null);
  const [cashInput, setCashInput] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const lastSentAt = useRef(0);
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  const { visible, online: networkOnline } = useDeviceStatus();
  const tracking = sharing || dash.is_online || Boolean(active);
  const { fix, error: gpsError, permission } = useGeoWatch(tracking);

  // ----- data -----
  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc("driver_dashboard");
    if (!data) return;
    const d = data as DriverDashboard;
    setDash(d);
    setOffers(d.offers);
    if (d.active_booking_id) {
      const { data: v } = await supabase.rpc("get_booking_view", { p_booking_id: d.active_booking_id });
      setActive(v as ActiveView);
      const { data: conv } = await supabase.from("chat_conversations").select("id").eq("booking_id", d.active_booking_id).maybeSingle();
      setConversationId(conv?.id ?? null);
    } else {
      setActive((a) => (a && a.status === "COMPLETED" ? a : null));
    }
    setNow(Date.now());
  }, [supabase]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const offerChannel = useRealtime(`driver:${userId}`, {
    offer: (p) => {
      const o = p as unknown as Offer;
      setOffers((list) => o.status === "pending" ? [...list.filter((x) => x.offer_id !== o.offer_id), o] : list.filter((x) => x.offer_id !== o.offer_id));
      if (o.status === "pending" && "vibrate" in navigator) navigator.vibrate?.([200, 100, 200]);
    },
    bid: () => void refresh(),
  }, refresh);
  useRealtime(active ? `booking:${active.id}` : null, { booking_status: () => void refresh() }, refresh);

  // ----- GPS upload -----
  const send = useCallback(async (f: Fix) => {
    lastSentAt.current = Date.now();
    const { data, error } = await supabase.rpc("driver_update_location", {
      p_lat: f.lat, p_lng: f.lng, p_accuracy_m: Math.round(f.accuracy), p_heading_deg: f.heading, p_speed_mps: f.speed,
      p_recorded_at: new Date(f.timestamp).toISOString(),
    });
    if (error) {
      setLastSent({ at: Date.now(), accepted: false, reason: "network" });
      return;
    }
    const res = data as { accepted: boolean; reason?: string };
    setLastSent({ at: Date.now(), accepted: res.accepted, reason: res.reason });
  }, [supabase]);

  useEffect(() => {
    if (!fix || !tracking) return;
    if (Date.now() - lastSentAt.current >= SEND_EVERY_MS) void send(fix);
  }, [fix, tracking, send]);

  // Heartbeat: some phones stop emitting watch updates when stationary.
  useEffect(() => {
    if (!tracking) return;
    const t = setInterval(async () => {
      if (Date.now() - lastSentAt.current < HEARTBEAT_MS || document.visibilityState !== "visible") return;
      try { await send(await getCurrentFix(8000)); } catch { /* surfaced via gpsError */ }
    }, 5_000);
    return () => clearInterval(t);
  }, [tracking, send]);

  // Keep the screen awake while on duty (the only reliable way to keep web GPS flowing).
  useEffect(() => {
    if (!tracking || !visible || !("wakeLock" in navigator)) return;
    let released = false;
    navigator.wakeLock.request("screen").then((l) => {
      if (released) void l.release();
      else wakeLock.current = l;
    }).catch(() => undefined);
    return () => {
      released = true;
      void wakeLock.current?.release();
      wakeLock.current = null;
    };
  }, [tracking, visible]);

  // ----- actions -----
  async function run(name: string, fn: () => PromiseLike<{ error: { message?: string; code?: string } | null }>) {
    setBusy(name);
    setError(null);
    const { error } = await fn();
    setBusy(null);
    if (error) setError(userMessage(error));
    await refresh();
    return !error;
  }

  async function goOnline() {
    setSharing(true);
    setError(null);
    setBusy("online");
    try {
      const f = fix ?? (await getCurrentFix(12_000));
      await send(f);
    } catch (e) {
      setBusy(null);
      setError((e as Error).message);
      return;
    }
    setBusy(null);
    await run("online", () => supabase.rpc("driver_set_online", { p_online: true }));
  }
  const goOffline = () => run("online", async () => {
    const r = await supabase.rpc("driver_set_online", { p_online: false });
    if (!r.error) setSharing(false);
    return r;
  });

  const bookingAction = (rpc: string, extra: Record<string, unknown> = {}) =>
    run(rpc, () => supabase.rpc(rpc, { p_booking_id: active!.id, ...extra }));

  async function confirmCash() {
    if (!active) return;
    const minor = Math.round(Number(cashInput.replace(/,/g, "")) * 100);
    if (!Number.isFinite(minor) || minor < 0) return setError("Enter the amount you received.");
    const ok = await run("cash", () => supabase.rpc("driver_confirm_cash_collected", { p_booking_id: active.id, p_amount_minor: minor }));
    if (ok) { setActive(null); setCashInput(""); router.refresh(); }
  }

  async function sos() {
    setBusy("sos");
    const { error } = await supabase.rpc("raise_sos", { p_booking_id: active?.id ?? null, p_lat: fix?.lat ?? null, p_lng: fix?.lng ?? null, p_note: "driver SOS" });
    setBusy(null);
    setError(error ? userMessage(error) : null);
    if (!error) alert("SOS sent to operations. If you are in danger call 911.");
  }

  // ----- derived -----
  const serverLoc = dash.location;
  const locFresh = serverLoc ? isFresh(serverLoc.received_at, dash.fresh_seconds, now) : false;
  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [];
    const me = fix ?? serverLoc;
    if (me) m.push({ id: "me", kind: locFresh ? "driver" : "driver-stale", lat: me.lat, lng: me.lng, heading: fix?.heading ?? null, label: "You" });
    if (active) {
      m.push({ id: "pickup", kind: "pickup", lat: active.pickup.lat, lng: active.pickup.lng, label: "Pickup" });
      m.push({ id: "dropoff", kind: "dropoff", lat: active.dropoff.lat, lng: active.dropoff.lng, label: "Destination" });
    } else {
      for (const o of offers) m.push({ id: o.offer_id, kind: "pickup", lat: o.pickup.lat, lng: o.pickup.lng, label: o.pickup_address });
    }
    return m;
  }, [fix, serverLoc, locFresh, active, offers]);

  const navTarget = active && (active.status === "IN_PROGRESS" ? active.dropoff : active.pickup);
  const gpsReason: Record<string, string> = {
    throttled: "Updating…",
    low_accuracy: `Location is too imprecise${fix ? ` (±${Math.round(fix.accuracy)} m)` : ""}. Turn on GPS / precise location, or move to an open area. Laptops usually can't do this.`,
    stale_fix: "Your phone sent an old position.", implausible_jump: "Ignored a GPS jump.", not_approved: "Account not approved.",
    network: "Couldn't reach the server.",
  };

  return (
    <div className="relative h-[calc(100dvh-64px)] overflow-hidden">
      <div className="absolute inset-0"><Map markers={markers} routePolyline={active?.status === "IN_PROGRESS" ? active.route_polyline : null} /></div>

      {/* Status bar */}
      <div className="absolute inset-x-3 top-3 z-20 space-y-2">
        <div className="surface flex items-center gap-2 rounded-2xl border border-line px-3 py-2 text-xs shadow">
          <span className={cn("h-2.5 w-2.5 rounded-full", dash.is_online ? "bg-ok-500" : "bg-[var(--line)]")} aria-hidden />
          <span className="font-semibold">{dash.is_online ? "Online" : "Offline"}</span>
          <span className="text-muted">·</span>
          <Signal className={cn("h-3.5 w-3.5", locFresh ? "text-ok-500" : "text-warn-500")} aria-hidden />
          <span className="text-muted">
            {serverLoc ? `GPS ${timeAgo(serverLoc.received_at, now)}${fix ? ` · ±${Math.round(fix.accuracy)} m` : ""}` : "No GPS yet"}
          </span>
          {!networkOnline && <span className="ml-auto flex items-center gap-1 font-semibold text-signal-600"><WifiOff className="h-3.5 w-3.5" />Offline</span>}
          {networkOnline && offerChannel !== "live" && dash.is_online && <span className="text-muted ml-auto">reconnecting…</span>}
        </div>
        {tracking && (
          <div className="flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span><strong>Keep this screen open.</strong> Web browsers pause GPS when you switch apps, lock the phone or close this tab — you then stop receiving rides and your passenger stops seeing you.</span>
          </div>
        )}
        {gpsError && <Alert tone="danger">{gpsError}</Alert>}
        {permission === "denied" && <Alert tone="danger">Location is blocked. Allow location for this site in your browser settings to drive.</Alert>}
        {lastSent && !lastSent.accepted && lastSent.reason && lastSent.reason !== "throttled" && <Alert tone="warn">{gpsReason[lastSent.reason] ?? lastSent.reason}</Alert>}
      </div>

      {(active || dash.is_online) && (
        <button onClick={sos} disabled={busy === "sos"} className="absolute bottom-[calc(50%+1rem)] right-3 z-20 flex items-center gap-1 rounded-full bg-signal-500 px-3 py-2 text-xs font-bold text-white shadow-lg" aria-label="Emergency SOS">
          <ShieldAlert className="h-4 w-4" /> SOS
        </button>
      )}

      <section className="surface absolute inset-x-0 bottom-0 z-10 max-h-[60%] overflow-y-auto rounded-t-3xl p-4 shadow-[var(--shadow-sheet)]">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[var(--line)]" aria-hidden />
        {error && <Alert tone="danger" className="mb-3">{error}</Alert>}

        {active ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-bold">{STATUS_LABELS[active.status as keyof typeof STATUS_LABELS]}</h1>
                <p className="text-muted text-xs">Trip {active.code}</p>
              </div>
              <p className="font-bold tabular-nums">{money(active.final_fare_minor ?? active.agreed_fare_minor ?? active.estimated_fare_minor, active.currency)}</p>
            </div>

            {active.passenger && active.status !== "COMPLETED" && (
              <Card className="flex items-center gap-3 p-3">
                <div className="flex-1">
                  <p className="font-semibold">{active.passenger.name} {active.passenger.rating && <span className="text-muted text-xs">★ {active.passenger.rating}</span>}</p>
                  <p className="text-muted text-xs">{active.payment_method.replace("_", " ")}</p>
                </div>
                {active.passenger.phone && <a href={`tel:${active.passenger.phone}`} className="surface-muted grid h-11 w-11 place-items-center rounded-xl" aria-label="Call passenger"><Phone className="h-4 w-4" /></a>}
                {conversationId && <Button variant="secondary" size="sm" onClick={() => setShowChat((s) => !s)}>Chat</Button>}
              </Card>
            )}
            {showChat && conversationId && active.status !== "COMPLETED" && <ChatPanel bookingId={active.id} conversationId={conversationId} userId={userId} closed={false} />}

            <div className="space-y-1 text-sm">
              <p className={cn("flex gap-2", active.status === "IN_PROGRESS" && "text-muted")}><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ok-500" />{active.pickup.address}</p>
              {active.stops.filter((s) => s.kind === "stop").map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 bg-warn-500" /><span className="flex-1">{s.address}</span>
                  {active.status === "IN_PROGRESS" && !s.departed_at && (
                    <Button size="sm" variant="secondary" loading={busy === `stop-${s.id}`}
                      onClick={() => run(`stop-${s.id}`, () => supabase.rpc("driver_record_stop", { p_booking_id: active.id, p_stop_id: s.id, p_event: s.arrived_at ? "departed" : "arrived" }))}>
                      {s.arrived_at ? "Depart" : "Arrived"}
                    </Button>
                  )}
                </div>
              ))}
              <p className="flex gap-2"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-signal-500" />{active.dropoff.address}</p>
            </div>

            {navTarget && active.status !== "COMPLETED" && (
              <a href={`geo:${navTarget.lat},${navTarget.lng}?q=${navTarget.lat},${navTarget.lng}`}
                className="flex items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-sm font-semibold">
                <Navigation className="h-4 w-4" /> Open in navigation app
              </a>
            )}

            {active.status === "DRIVER_ASSIGNED" && <Button size="lg" className="w-full" loading={busy === "driver_mark_arriving"} onClick={() => bookingAction("driver_mark_arriving")}>Start driving to pickup</Button>}
            {(active.status === "DRIVER_ASSIGNED" || active.status === "DRIVER_ARRIVING") && (
              <Button size="lg" variant={active.status === "DRIVER_ARRIVING" ? "primary" : "secondary"} className="w-full" loading={busy === "driver_mark_arrived"} onClick={() => bookingAction("driver_mark_arrived")}>I have arrived</Button>
            )}
            {active.status === "DRIVER_ARRIVED" && (
              <>
                <Button size="lg" variant="success" className="w-full" loading={busy === "driver_start_trip"} onClick={() => bookingAction("driver_start_trip")}>Passenger on board — start trip</Button>
                <WaitTimer since={active.arrived_at} now={now} />
              </>
            )}
            {active.status === "IN_PROGRESS" && <Button size="lg" variant="success" className="w-full" loading={busy === "driver_complete_trip"} onClick={() => bookingAction("driver_complete_trip")}>Complete trip</Button>}

            {active.status === "COMPLETED" && (
              <Card className="space-y-2 p-3">
                <p className="font-semibold">Trip complete · {money(active.final_fare_minor, active.currency)}</p>
                {active.payment_method === "cash" && active.payment_status !== "succeeded" ? (
                  <>
                    <p className="text-muted text-xs">Enter the cash you received ({active.currency}).</p>
                    <div className="flex gap-2">
                      <Input inputMode="decimal" value={cashInput} placeholder={((active.final_fare_minor ?? 0) / 100).toFixed(2)} onChange={(e) => setCashInput(e.target.value)} aria-label="Cash received" />
                      <Button loading={busy === "cash"} onClick={confirmCash}>Confirm</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <Badge tone={active.payment_status === "succeeded" ? "ok" : "warn"}>{active.payment_status === "succeeded" ? "Paid" : "Payment pending (mobile money)"}</Badge>
                    <Button className="w-full" onClick={() => { setActive(null); void refresh(); }}>Back to requests</Button>
                  </>
                )}
              </Card>
            )}

            {["DRIVER_ASSIGNED", "DRIVER_ARRIVING", "DRIVER_ARRIVED"].includes(active.status) && (
              <CancelRide status={active.status} arrivedAt={active.arrived_at} now={now} busy={busy === "driver_cancel_booking"}
                onCancel={(reason) => bookingAction("driver_cancel_booking", { p_reason: reason })} />
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {offers.length > 0 ? (
              offers.map((o) => (
                <OfferCard key={o.offer_id} offer={o} now={now} busy={busy}
                  onAccept={() => run("accept", () => supabase.rpc("accept_offer", { p_offer_id: o.offer_id }))}
                  onReject={() => run("reject", async () => {
                    const r = await supabase.rpc("reject_offer", { p_offer_id: o.offer_id, p_reason: "driver_declined" });
                    setOffers((l) => l.filter((x) => x.offer_id !== o.offer_id));
                    return r;
                  })}
                  onCounter={(amountMinor) => run("counter", () => supabase.rpc("driver_counter_bid", { p_offer_id: o.offer_id, p_amount_minor: amountMinor }))}
                />
              ))
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{dash.is_online ? "Waiting for ride requests…" : "You are offline"}</p>
                  <p className="text-muted text-xs">
                    Today: {dash.today.trips} trips{Object.entries(dash.today.currency_totals).map(([c, v]) => ` · ${money(v, c)}`).join("")}
                    {dash.rating && ` · ★ ${dash.rating}`}{dash.acceptance_rate !== null && ` · ${dash.acceptance_rate}% accepted`}
                  </p>
                </div>
              </div>
            )}
            {dash.vehicle && (
              <p className="text-muted text-xs">{dash.vehicle.category_name} · {dash.vehicle.color} {dash.vehicle.make} {dash.vehicle.model} · {dash.vehicle.plate}</p>
            )}
            <Button size="lg" className="w-full" variant={dash.is_online ? "secondary" : "success"} loading={busy === "online"}
              onClick={dash.is_online ? goOffline : goOnline}>
              <Power className="h-5 w-5" /> {dash.is_online ? "Go offline" : "Go online"}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function WaitTimer({ since, now }: { since: string | null; now: number }) {
  if (!since) return null;
  const s = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  return <p className="text-muted text-center text-xs">Waiting {formatDuration(s)} ({Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")})</p>;
}

function CancelRide({ status, arrivedAt, now, busy, onCancel }: {
  status: string; arrivedAt: string | null; now: number; busy: boolean; onCancel: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const waitedMin = arrivedAt ? (now - Date.parse(arrivedAt)) / 60000 : 0;
  if (!open) return <button className="text-muted w-full py-2 text-sm underline" onClick={() => setOpen(true)}>Can&apos;t complete this ride?</button>;
  return (
    <div className="space-y-2 rounded-xl border border-line p-3 text-sm">
      {status === "DRIVER_ARRIVED" && (
        <Button variant="secondary" className="w-full" disabled={waitedMin < 5} loading={busy} onClick={() => onCancel("passenger_no_show")}>
          Passenger didn&apos;t show {waitedMin < 5 && `(available after 5 min)`}
        </Button>
      )}
      <Button variant="danger" className="w-full" loading={busy} onClick={() => onCancel("driver_unable")}>Cancel — reassign to another driver</Button>
      <p className="text-muted text-xs">Frequent cancellations lower your acceptance score.</p>
    </div>
  );
}

