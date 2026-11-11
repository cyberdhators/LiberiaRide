"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle, Phone, Share2, ShieldAlert, Star } from "lucide-react";
import { isActiveRide, isTerminal, passengerCanCancel, STATUS_LABELS, type BookingStatus } from "@liberia-ride/shared";
import { etaSecondsFromDistance, formatDistance, formatDuration, haversineMeters, isFresh } from "@liberia-ride/geospatial";
import { createClient } from "@/lib/supabase/client";
import { useRealtime } from "@/hooks/use-realtime";
import { getCurrentFix } from "@/hooks/use-geolocation";
import { userMessage } from "@/lib/errors";
import { playRideAlert } from "@/lib/alert-sound";
import { cn, formatDateTime, money, timeAgo } from "@/lib/utils";
import { Map, type MapMarker } from "@/components/map";
import { Alert, Badge, Button, Card, Textarea } from "@/components/ui";
import { ChatPanel } from "@/components/chat-panel";
import { PayNow } from "./pay-now";
import { PushToggle } from "@/components/push-toggle";

interface Pt { lat: number; lng: number; address?: string }
export interface BookingView {
  id: string; code: string; status: BookingStatus; pickup: Pt; dropoff: Pt;
  stops: { id: string; seq: number; kind: string; address: string; lat: number; lng: number }[];
  currency: string; estimated_fare_minor: number; agreed_fare_minor: number | null; final_fare_minor: number | null;
  discount_minor: number; outstanding_fee_minor: number; estimated_distance_m: number; estimated_duration_s: number;
  payment_method: string; payment_status: string; bidding_enabled: boolean; passenger_offer_minor: number | null;
  route_polyline: string | null; share_token: string | null; reserved: boolean; search_expires_at: string | null;
  driver: { id: string; name: string; rating: number | null; trips: number; phone: string | null;
    vehicle: { make: string; model: string; color: string; plate: string; category: string } } | null;
  driver_location: { lat: number; lng: number; heading: number | null; received_at: string; stale: boolean } | null;
  passenger: unknown;
  created_at: string; assigned_at: string | null; started_at: string | null; completed_at: string | null;
  cancelled_at: string | null; cancel_reason: string | null; cancellation_fee_minor: number;
  final_breakdown: Record<string, number> | null;
}
interface Bid { id: string; amount_minor: number; currency: string; status: string; expires_at: string; driver?: { name: string; rating: number | null; vehicle: string } | null }

const FRESH_S = 45;

export function TripTracker({ initial, userId, initialBids, conversationId, alreadyRated, siteUrl }: {
  initial: BookingView; userId: string; initialBids: Bid[]; conversationId: string | null; alreadyRated: boolean; siteUrl: string;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [bids, setBids] = useState<Bid[]>(initialBids);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [sosSent, setSosSent] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [pin, setPin] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data } = await createClient().rpc("get_booking_view", { p_booking_id: initial.id });
    if (data) setView(data as BookingView);
    setNow(Date.now());
  }, [initial.id]);

  const channel = useRealtime(`booking:${initial.id}`, {
    booking_status: () => void reload(),
    driver_location: (p) => {
      setView((v) => ({ ...v, driver_location: { lat: p.lat as number, lng: p.lng as number, heading: (p.heading as number) ?? null,
        received_at: p.received_at as string, stale: false } }));
      setNow(Date.now());
    },
    bid: (p) => {
      const b = p as unknown as Bid & { party: string };
      if (b.party !== "driver") return;
      setBids((list) => [...list.filter((x) => x.id !== b.id), b].filter((x) => x.status === "open"));
    },
  }, reload);

  const status = view.status;

  // Safety net when Realtime silently drops: poll, and refresh on focus / reconnect / push.
  useEffect(() => {
    if (isTerminal(status)) return;
    const wake = () => { if (document.visibilityState === "visible") void reload(); };
    const t = setInterval(wake, channel === "live" ? 30_000 : 10_000);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("lr:push", wake);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("lr:push", wake);
    };
  }, [reload, channel, status]);

  // Chime once when the driver reaches the pickup.
  const [chimedArrival, setChimedArrival] = useState(initial.status === "DRIVER_ARRIVED");
  useEffect(() => {
    if (status === "DRIVER_ARRIVED" && !chimedArrival) {
      setChimedArrival(true);
      playRideAlert(1);
    }
  }, [status, chimedArrival]);

  const showPin = status === "DRIVER_ASSIGNED" || status === "DRIVER_ARRIVING" || status === "DRIVER_ARRIVED";

  // Ride PIN: readable by the passenger only (RLS); the driver needs it to start the trip.
  useEffect(() => {
    if (!showPin || pin) return;
    void createClient().from("booking_start_pins").select("pin").eq("booking_id", initial.id).maybeSingle()
      .then(({ data }) => setPin((data?.pin as string | undefined) ?? null));
  }, [showPin, pin, initial.id]);
  const loc = view.driver_location;
  const locFresh = loc ? isFresh(loc.received_at, FRESH_S, now) : false;
  const target = status === "IN_PROGRESS" ? view.dropoff : view.pickup;
  const distToTarget = loc ? haversineMeters(loc, target) : null;
  const eta = distToTarget !== null ? etaSecondsFromDistance(distToTarget) : null;

  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [
      { id: "pickup", kind: "pickup", lat: view.pickup.lat, lng: view.pickup.lng, label: "Pickup" },
      { id: "dropoff", kind: "dropoff", lat: view.dropoff.lat, lng: view.dropoff.lng, label: "Destination" },
      ...view.stops.filter((s) => s.kind === "stop").map((s) => ({ id: s.id, kind: "stop" as const, lat: s.lat, lng: s.lng, label: s.address })),
    ];
    if (loc && isActiveRide(status)) m.push({ id: "driver", kind: locFresh ? "driver" : "driver-stale", lat: loc.lat, lng: loc.lng, heading: loc.heading, label: "Your driver" });
    return m;
  }, [view, loc, locFresh, status]);

  async function act(name: string, fn: () => PromiseLike<{ error: { message?: string; code?: string } | null }>) {
    setBusy(name);
    setError(null);
    const { error } = await fn();
    setBusy(null);
    if (error) setError(userMessage(error));
    await reload();
  }

  const supabase = createClient();
  const cancel = () => act("cancel", () => supabase.rpc("passenger_cancel_booking", { p_booking_id: view.id, p_reason: "passenger_request" }));
  const acceptBid = (id: string) => act("bid", () => supabase.rpc("passenger_accept_bid", { p_bid_id: id }));
  const rejectBid = (id: string) => act("bid", async () => {
    const r = await supabase.rpc("passenger_reject_bid", { p_bid_id: id });
    setBids((b) => b.filter((x) => x.id !== id));
    return r;
  });

  async function sos() {
    setBusy("sos");
    let lat: number | null = null, lng: number | null = null;
    try { const f = await getCurrentFix(5000); lat = f.lat; lng = f.lng; } catch { /* send without position */ }
    const { error } = await supabase.rpc("raise_sos", { p_booking_id: view.id, p_lat: lat, p_lng: lng, p_note: null });
    setBusy(null);
    if (error) setError(userMessage(error));
    else setSosSent(true);
  }

  async function share() {
    if (!view.share_token) return;
    const url = `${siteUrl || window.location.origin}/share/${encodeURIComponent(view.share_token)}`;
    const text = `Track my LiberiaRide trip ${view.code}`;
    if (navigator.share) await navigator.share({ title: "My trip", text, url }).catch(() => undefined);
    else { await navigator.clipboard.writeText(url); setError(null); alert("Trip link copied."); }
  }

  const fare = view.final_fare_minor ?? (view.agreed_fare_minor ?? view.estimated_fare_minor) + (view.outstanding_fee_minor ?? 0);

  return (
    <div className="relative h-[calc(100dvh-64px)] overflow-hidden">
      <div className="absolute inset-0"><Map markers={markers} routePolyline={view.route_polyline} /></div>

      {isActiveRide(status) && (
        <button onClick={sos} disabled={busy === "sos" || sosSent}
          className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-full bg-signal-500 px-4 py-2 text-sm font-bold text-white shadow-lg"
          aria-label="Emergency SOS">
          <ShieldAlert className="h-4 w-4" /> {sosSent ? "SOS sent" : "SOS"}
        </button>
      )}

      <section className="surface absolute inset-x-0 bottom-0 z-10 max-h-[78%] overflow-y-auto rounded-t-3xl p-4 shadow-[var(--shadow-sheet)]">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[var(--line)]" aria-hidden />
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold" aria-live="polite">{STATUS_LABELS[status]}</h1>
            <p className="text-muted text-xs">Trip {view.code}</p>
          </div>
          <div className="text-right">
            <p className="font-bold tabular-nums">{money(fare, view.currency)}</p>
            <p className="text-muted text-xs">{view.final_fare_minor !== null ? "Final fare" : view.agreed_fare_minor !== null ? "Agreed price" : "Upfront price"}{view.final_fare_minor === null && view.outstanding_fee_minor > 0 && " + unpaid fee"}</p>
          </div>
        </div>
        {channel === "offline" && !isTerminal(status) && (
          <Alert tone="warn" className="mt-2">Live updates paused — reconnecting. <button className="underline" onClick={() => void reload()}>Refresh</button></Alert>
        )}
        {sosSent && <Alert tone="danger" className="mt-2" title="SOS sent to LiberiaRide operations">If you are in immediate danger call 911 (Liberia National Police).</Alert>}

        {(status === "SEARCHING_DRIVER" || status === "DRIVER_OFFERED") && (
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-60" /><span className="relative inline-flex h-3 w-3 rounded-full bg-brand-600" /></span>
              <p className="text-sm">{view.reserved ? "A driver is reviewing your request…" : "Looking for the nearest driver…"}</p>
            </div>
            {view.bidding_enabled && (
              <div>
                <p className="text-sm font-medium">Driver offers {view.passenger_offer_minor !== null && <span className="text-muted">(you offered {money(view.passenger_offer_minor, view.currency)})</span>}</p>
                {bids.length === 0 ? <p className="text-muted text-xs">Waiting for drivers to accept or counter…</p> : (
                  <ul className="mt-2 space-y-2">
                    {bids.map((b) => (
                      <li key={b.id} className="flex items-center gap-2 rounded-xl border border-line p-2">
                        <div className="flex-1 text-sm">
                          <p className="font-semibold">{money(b.amount_minor, b.currency)}</p>
                          <p className="text-muted text-xs">{b.driver ? `${b.driver.name} · ${b.driver.vehicle}${b.driver.rating ? ` · ★ ${b.driver.rating}` : ""}` : "Driver"}</p>
                        </div>
                        <Button size="sm" variant="secondary" onClick={() => rejectBid(b.id)} disabled={busy === "bid"}>Decline</Button>
                        <Button size="sm" onClick={() => acceptBid(b.id)} loading={busy === "bid"}>Accept</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {view.driver && isActiveRide(status) && (
          <Card className="mt-3 p-3">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-brand-100 font-bold text-brand-700">{view.driver.name.charAt(0)}</div>
              <div className="flex-1">
                <p className="font-semibold">{view.driver.name} {view.driver.rating && <span className="text-muted text-xs">★ {view.driver.rating}</span>}</p>
                <p className="text-muted text-xs">{view.driver.vehicle.color} {view.driver.vehicle.make} {view.driver.vehicle.model}</p>
              </div>
              <span className="rounded-lg border border-line px-2 py-1 font-mono text-sm font-bold tracking-wider">{view.driver.vehicle.plate}</span>
            </div>
            {showPin && pin && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-brand-50 px-3 py-2 text-brand-900">
                <span className="text-sm font-semibold">Ride PIN
                  <span className="block text-xs font-normal">Check the plate, then tell your driver this PIN once you are in the car.</span>
                </span>
                <span className="font-mono text-2xl font-bold tracking-[0.3em]" aria-label={`Ride PIN ${pin.split("").join(" ")}`}>{pin}</span>
              </div>
            )}
            <div className="mt-3 text-sm">
              {loc ? (
                <p className={cn(!locFresh && "text-warn-500")}>
                  {locFresh ? (
                    <>{status === "IN_PROGRESS" ? "Arriving at destination" : "Driver arriving"} in about <strong>{formatDuration(eta ?? 0)}</strong> · {formatDistance(distToTarget ?? 0)} away</>
                  ) : (
                    <>Driver location last updated {timeAgo(loc.received_at, now)} — position may be out of date.</>
                  )}
                </p>
              ) : <p className="text-muted">Waiting for the driver&apos;s location…</p>}
              {status === "DRIVER_ARRIVED" && <Alert tone="ok" className="mt-2">Your driver is at the pickup point.</Alert>}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {view.driver.phone && (
                <a href={`tel:${view.driver.phone}`} className="surface-muted flex flex-col items-center gap-1 rounded-xl p-2 text-xs font-medium"><Phone className="h-4 w-4" />Call</a>
              )}
              {conversationId && (
                <button onClick={() => setShowChat((s) => !s)} className="surface-muted flex flex-col items-center gap-1 rounded-xl p-2 text-xs font-medium"><MessageCircle className="h-4 w-4" />Chat</button>
              )}
              <button onClick={share} className="surface-muted flex flex-col items-center gap-1 rounded-xl p-2 text-xs font-medium"><Share2 className="h-4 w-4" />Share trip</button>
            </div>
            {showChat && conversationId && (
              <div className="mt-3"><ChatPanel bookingId={view.id} conversationId={conversationId} userId={userId} closed={false} /></div>
            )}
          </Card>
        )}

        {status === "COMPLETED" && (
          <>
            {view.payment_method !== "cash" && (
              <div className="mt-3"><PayNow bookingId={view.id} method={view.payment_method} status={view.payment_status} defaultMsisdn={null} /></div>
            )}
            <Receipt view={view} alreadyRated={alreadyRated} onDone={() => router.push("/passenger")} />
          </>
        )}

        {(status === "CANCELLED" || status === "EXPIRED" || status === "FAILED") && (
          <div className="mt-3 space-y-3">
            <Alert tone={status === "CANCELLED" ? "info" : "warn"}>
              {status === "EXPIRED" ? "No driver accepted in time. Please try again — drivers may be busy." :
               status === "FAILED" ? "This trip was ended by operations. Contact support if you need help." :
               `Ride cancelled${view.cancel_reason ? ` (${view.cancel_reason.replaceAll("_", " ")})` : ""}.`}
              {view.cancellation_fee_minor > 0 && <> A cancellation fee of {money(view.cancellation_fee_minor, view.currency)} applies.</>}
            </Alert>
            <Link href="/passenger" className="block"><Button className="w-full" size="lg">Book another ride</Button></Link>
          </div>
        )}

        <div className="mt-3 space-y-1 text-sm">
          <p className="flex gap-2"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ok-500" />{view.pickup.address}</p>
          {view.stops.filter((s) => s.kind === "stop").map((s) => (
            <p key={s.id} className="flex gap-2"><span className="mt-1.5 h-2 w-2 shrink-0 bg-warn-500" />{s.address}</p>
          ))}
          <p className="flex gap-2"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-signal-500" />{view.dropoff.address}</p>
        </div>

        {error && <Alert tone="danger" className="mt-3">{error}</Alert>}

        {!isTerminal(status) && (
          <PushToggle className="mt-3" title="Trip alerts" description="Get notified when your driver accepts and arrives, even with the screen off." />
        )}

        {passengerCanCancel(status) && (
          confirmCancel ? (
            <div className="mt-4 rounded-xl border border-line p-3">
              <p className="text-sm">Cancel this ride?{view.assigned_at && " A cancellation fee may apply once your driver has been on the way for a while."}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setConfirmCancel(false)}>Keep ride</Button>
                <Button variant="danger" loading={busy === "cancel"} onClick={cancel}>Cancel ride</Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" className="mt-3 w-full text-signal-600" onClick={() => setConfirmCancel(true)}>Cancel ride</Button>
          )
        )}
      </section>
    </div>
  );
}

function Receipt({ view, alreadyRated, onDone }: { view: BookingView; alreadyRated: boolean; onDone: () => void }) {
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [rated, setRated] = useState(alreadyRated);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const b = view.final_breakdown;
  const rows: [string, number | undefined][] = b ? [
    ["Base fare", b.base_minor], ["Distance", b.distance_minor], ["Time", b.time_minor], ["Stops", b.stops_minor],
    ["Waiting", b.waiting_minor], ["Booking fee", b.booking_fee_minor], ["Minimum fare adjustment", b.minimum_adjustment_minor],
    ["Rounding", b.rounding_minor], ["Unpaid cancellation fee (earlier ride)", b.cancellation_minor],
  ] : [];

  async function rate() {
    if (!score) return;
    setBusy(true);
    const { error } = await createClient().rpc("rate_booking", { p_booking_id: view.id, p_score: score, p_tags: [], p_comment: comment.trim() || null });
    setBusy(false);
    if (error && error.code !== "23505") setError(userMessage(error));
    else setRated(true);
  }

  return (
    <div className="mt-3 space-y-3">
      <Card className="p-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Receipt</p>
          <Badge tone={view.payment_status === "succeeded" ? "ok" : "warn"}>
            {view.payment_method.replace("_", " ")} · {view.payment_status === "succeeded" ? "paid" : "payment pending"}
          </Badge>
        </div>
        <dl className="mt-2 space-y-1 text-sm">
          {rows.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="flex justify-between"><dt className="text-muted">{k}</dt><dd className="tabular-nums">{money(v!, view.currency)}</dd></div>
          ))}
          {view.agreed_fare_minor !== null && <div className="flex justify-between"><dt className="text-muted">Agreed price</dt><dd>{money(view.agreed_fare_minor, view.currency)}</dd></div>}
          {view.discount_minor > 0 && <div className="flex justify-between"><dt className="text-muted">Promotion</dt><dd>−{money(view.discount_minor, view.currency)}</dd></div>}
          <div className="flex justify-between border-t border-line pt-1 font-bold"><dt>Total</dt><dd className="tabular-nums">{money(view.final_fare_minor, view.currency)}</dd></div>
        </dl>
        <p className="text-muted mt-2 text-xs">{formatDateTime(view.started_at)} → {formatDateTime(view.completed_at)} · Trip {view.code}</p>
      </Card>
      {!rated ? (
        <Card className="p-3">
          <p className="font-semibold">Rate your driver</p>
          <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} role="radio" aria-checked={score === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setScore(n)}>
                <Star className={cn("h-8 w-8", n <= score ? "fill-amber-400 text-amber-400" : "text-[var(--line)]")} />
              </button>
            ))}
          </div>
          <Textarea className="mt-2" placeholder="Anything to add? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
          {error && <Alert tone="danger" className="mt-2">{error}</Alert>}
          <Button className="mt-2 w-full" disabled={!score} loading={busy} onClick={rate}>Submit rating</Button>
        </Card>
      ) : <Alert tone="ok">Thanks for your feedback!</Alert>}
      <div className="grid grid-cols-2 gap-2">
        <Link href={`/passenger/support?booking=${view.id}`}><Button variant="secondary" className="w-full">Report a problem</Button></Link>
        <Button className="w-full" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}
