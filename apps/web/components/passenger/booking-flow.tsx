"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Banknote, CalendarClock, Car, Circle, LocateFixed, MapPin, Plus, Smartphone, Square, Tag, UserRound, Users, X } from "lucide-react";
import { bidWindow, newIdempotencyKey, normalizePhone, parseMajor } from "@liberia-ride/shared";
import { formatDistance, formatDuration } from "@liberia-ride/geospatial";
import { createClient } from "@/lib/supabase/client";
import { userMessage } from "@/lib/errors";
import { cn, money } from "@/lib/utils";
import { getCurrentFix } from "@/hooks/use-geolocation";
import { reverseLabel } from "@/lib/geo-client";
import { Map, type MapApi, type MapMarker } from "@/components/map";
import { Alert, Badge, Button, Input, Spinner } from "@/components/ui";
import { LocationSearch } from "./location-search";

export interface Category { code: string; name: string; description: string | null; seats: number }
export interface SavedPlace {
  id: string; kind: "saved" | "recent"; label: string; address_text: string; qls_code: string | null;
  lat: number; lng: number; last_used_at: string;
}
export interface Place { lat: number; lng: number; address: string; qlsRef: string | null; source: string }

type PaymentMethod = "cash" | "orange_money" | "mtn_momo";
type Currency = "USD" | "LRD";
type FieldId = "pickup" | "dropoff" | `stop-${number}`;

interface Estimate {
  category: string; estimateId?: string; currency?: string; totalMinor?: string; subtotalMinor?: string;
  discountMinor?: string; distanceM?: number; durationS?: number; routeSource?: string; expiresAt?: string; error?: string;
  surgeMultiplier?: number;
}

const PAYMENT_LABEL: Record<PaymentMethod, string> = { cash: "Cash", orange_money: "Orange Money", mtn_momo: "MTN MoMo" };

export function BookingFlow({ categories, savedPlaces, defaultPayment, defaultCurrency, maxStops, bidding }: {
  categories: Category[]; savedPlaces: SavedPlace[]; defaultPayment: PaymentMethod; defaultCurrency: Currency;
  maxStops: number; bidding: Record<string, { min: number; max: number }>;
}) {
  const router = useRouter();
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [stops, setStops] = useState<(Place | null)[]>([]);
  const [searching, setSearching] = useState<FieldId | null>(null);
  const [mapPicking, setMapPicking] = useState<FieldId | null>(null);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<number | null>(null);

  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  // Unpaid cancellation fees are added to the next fare in the same currency — say so before confirming.
  const [fees, setFees] = useState<Record<string, number>>({});
  useEffect(() => {
    void createClient().rpc("my_outstanding_fees").then(({ data }) => setFees((data ?? {}) as Record<string, number>));
  }, []);
  const [payment, setPayment] = useState<PaymentMethod>(defaultPayment);
  const [coupon, setCoupon] = useState("");
  const [estimates, setEstimates] = useState<Estimate[] | null>(null);
  const [routePolyline, setRoutePolyline] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateNotice, setEstimateNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(categories[0]?.code ?? "car");
  const [offer, setOffer] = useState("");
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOffer, setShowOffer] = useState(false);
  const [showCoupon, setShowCoupon] = useState(false);
  // "Later": a scheduled ride (price locked now). "For someone else": rider name + phone.
  const [when, setWhen] = useState<"now" | "later">("now");
  const [laterAt, setLaterAt] = useState("");
  const [forOther, setForOther] = useState(false);
  const [rider, setRider] = useState({ name: "", phone: "" });
  const [rewardCodes, setRewardCodes] = useState<string[]>([]);
  const [upcoming, setUpcoming] = useState<{ id: string; scheduled_for: string; dropoff_address: string }[]>([]);
  useEffect(() => {
    void createClient().rpc("my_scheduled_rides").then(({ data }) => setUpcoming((data ?? []) as typeof upcoming));
    void createClient().rpc("my_referral").then(({ data }) =>
      setRewardCodes(((data as { coupons?: { code: string; used: boolean }[] } | null)?.coupons ?? []).filter((c) => !c.used).map((c) => c.code)));
  }, []);
  // One key per booking intent: retries of the same tap reuse it, so no duplicates.
  const idemKey = useRef<string | null>(null);
  const mapApi = useRef<MapApi | null>(null);

  // The map keeps markers clear of the bottom sheet, whatever its current height.
  const sheetRef = useRef<HTMLElement>(null);
  const [sheetH, setSheetH] = useState(260);
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSheetH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const mapPadding = useMemo(() => ({ top: 70, bottom: sheetH + 24, left: 40, right: 40 }), [sheetH]);

  /**
   * Coordinates -> place. Our landmark aliases first (server); otherwise the street/landmark names the
   * map is already showing, so passengers and drivers see "Camp Johnson Road, near Temple of Justice"
   * instead of raw coordinates. Neither costs a QLS credit.
   */
  const describe = useCallback(async (lat: number, lng: number, apply: (p: Place) => void, fallback?: string) => {
    const base = await reverseLabel(lat, lng);
    if (base.source !== "pin") return apply(base);
    apply(fallback ? { ...base, address: fallback } : base);
    const name = await mapApi.current?.labelAt(lat, lng);
    if (name) apply({ ...base, address: name, source: "map_label" });
  }, []);

  const locateMe = useCallback(async () => {
    setLocating(true);
    setGpsError(null);
    try {
      const fix = await getCurrentFix();
      setSearching(null);
      await describe(fix.lat, fix.lng, (p) => setPickup((cur) =>
        // Ignore a late label if the passenger has already moved the pickup elsewhere.
        cur && p.source === "map_label" && (cur.lat !== p.lat || cur.lng !== p.lng) ? cur : p), "Your current location");
    } catch (e) {
      setGpsError((e as Error).message);
    } finally {
      setLocating(false);
    }
  }, [describe]);

  // Try GPS once on arrival for a map-first start.
  useEffect(() => { void locateMe(); }, [locateMe]);

  useEffect(() => {
    if (!pickup) return;
    void createClient().rpc("nearby_driver_count", { p_lat: pickup.lat, p_lng: pickup.lng, p_category_code: null })
      .then(({ data }) => setNearby(typeof data === "number" ? data : null));
  }, [pickup]);

  const setField = (field: FieldId, place: Place) => {
    if (field === "pickup") setPickup(place);
    else if (field === "dropoff") setDropoff(place);
    else {
      const i = Number(field.split("-")[1]);
      setStops((s) => s.map((x, j) => (j === i ? place : x)));
    }
  };

  // Any change to the route invalidates prices and the booking intent.
  const tripKey = JSON.stringify([pickup && [pickup.lat, pickup.lng], dropoff && [dropoff.lat, dropoff.lng], stops.map((s) => s && [s.lat, s.lng])]);
  useEffect(() => {
    setEstimates(null);
    setRoutePolyline(null);
    idemKey.current = null;
  }, [tripKey]);

  const readyToPrice = pickup && dropoff && stops.every(Boolean);

  // Switching currency on the prices step re-quotes in place.
  const pricedCurrency = useRef(currency);
  useEffect(() => {
    if (estimates && pricedCurrency.current !== currency) void priceTrip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  async function priceTrip() {
    if (!pickup || !dropoff) return;
    setEstimating(true);
    setError(null);
    setEstimateNotice(null);
    try {
      const res = await fetch("/api/fares/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickup: { lat: pickup.lat, lng: pickup.lng, address: pickup.address, qlsRef: pickup.qlsRef },
          dropoff: { lat: dropoff.lat, lng: dropoff.lng, address: dropoff.address, qlsRef: dropoff.qlsRef },
          stops: (stops.filter(Boolean) as Place[]).map((s) => ({ lat: s.lat, lng: s.lng, address: s.address, qlsRef: s.qlsRef })),
          categories: categories.map((c) => c.code),
          currency,
          coupon: coupon.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not get prices.");
      pricedCurrency.current = currency;
      idemKey.current = null;
      setEstimates(body.estimates);
      setRoutePolyline(body.route?.polyline ?? null);
      setEstimateNotice(body.notice ?? null);
      const firstOk = (body.estimates as Estimate[]).find((e) => !e.error);
      if (firstOk && (body.estimates as Estimate[]).find((e) => e.category === selected)?.error) setSelected(firstOk.category);
      if ((body.estimates as Estimate[]).every((e) => e.error)) setError((body.estimates as Estimate[])[0]?.error ?? "No ride options available.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEstimating(false);
    }
  }

  const chosen = estimates?.find((e) => e.category === selected && !e.error);
  const feeDue = fees[chosen?.currency ?? currency] ?? 0;
  const bidRange = bidding[`${selected}:${currency}`];
  const bidBounds = chosen?.totalMinor && bidRange ? bidWindow(BigInt(chosen.totalMinor), bidRange.min, bidRange.max) : null;

  async function confirm() {
    if (!chosen?.estimateId) return;
    setError(null);
    let offerMinor: string | null = null;
    if (offer.trim() && bidBounds) {
      try {
        const m = parseMajor(offer, currency).minor;
        if (m < bidBounds.min || m > bidBounds.max) {
          setError(`Your offer must be between ${money(bidBounds.min, currency)} and ${money(bidBounds.max, currency)}.`);
          return;
        }
        offerMinor = m.toString();
      } catch {
        setError("Enter your offer as a number, e.g. 6.50.");
        return;
      }
    }
    let scheduledFor: string | null = null;
    if (when === "later") {
      const t = laterAt ? new Date(laterAt) : null;
      if (!t || Number.isNaN(t.getTime())) { setError("Choose the pickup date and time."); return; }
      scheduledFor = t.toISOString();
    }
    let riderPhone: string | null = null;
    if (forOther) {
      riderPhone = normalizePhone(rider.phone);
      if (rider.name.trim().length < 2) { setError("Enter the name of the person riding."); return; }
      if (!riderPhone) { setError("Enter the rider's phone number, e.g. 077 012 3456."); return; }
    }
    const twoStep = Boolean(scheduledFor || forOther);
    idemKey.current ??= newIdempotencyKey();
    setBooking(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_booking", {
      p_estimate_id: chosen.estimateId,
      p_payment_method: payment,
      p_idempotency_key: idemKey.current,
      p_confirm: !twoStep,
      p_passenger_offer_minor: offerMinor,
      p_note: null,
    });
    if (!rpcError && twoStep) {
      // Rider and/or time are set before a driver is searched for, then the booking is released.
      const id = (data as { id: string }).id;
      const steps: PromiseLike<{ error: { message?: string; code?: string } | null }>[] = [];
      if (forOther) steps.push(supabase.rpc("set_booking_rider", { p_booking_id: id, p_name: rider.name.trim(), p_phone: riderPhone }));
      for (const step of steps) {
        const { error } = await step;
        if (error) { setBooking(false); setError(userMessage(error)); return; }
      }
      const { error: finalError } = scheduledFor
        ? await supabase.rpc("schedule_booking", { p_booking_id: id, p_at: scheduledFor })
        : await supabase.rpc("confirm_booking", { p_booking_id: id });
      if (finalError) {
        setBooking(false);
        setError(userMessage(finalError));
        await supabase.rpc("passenger_cancel_booking", { p_booking_id: id, p_reason: "booking_not_completed" });
        idemKey.current = null;
        void priceTrip();
        return;
      }
    }
    if (rpcError) {
      setBooking(false);
      if (/expired/i.test(rpcError.message)) {
        setError("Prices were refreshed because the quote expired. Please confirm again.");
        idemKey.current = null;
        void priceTrip();
        return;
      }
      setError(userMessage(rpcError, "Could not book this ride."));
      return;
    }
    // Remember recent places (best effort).
    void supabase.rpc("save_location", { p_kind: "recent", p_label: dropoff!.address.slice(0, 60), p_address: dropoff!.address, p_lat: dropoff!.lat, p_lng: dropoff!.lng, p_qls_code: dropoff!.qlsRef });
    router.push(`/passenger/trip/${(data as { id: string }).id}`);
  }

  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [];
    if (pickup) m.push({ id: "pickup", kind: "pickup", lat: pickup.lat, lng: pickup.lng, label: "Pickup" });
    stops.forEach((s, i) => s && m.push({ id: `stop-${i}`, kind: "stop", lat: s.lat, lng: s.lng, label: `Stop ${i + 1}` }));
    if (dropoff) m.push({ id: "dropoff", kind: "dropoff", lat: dropoff.lat, lng: dropoff.lng, label: "Destination" });
    return m;
  }, [pickup, dropoff, stops]);

  const fieldTitle = (f: FieldId) => (f === "pickup" ? "Pickup" : f === "dropoff" ? "Where to?" : `Stop ${Number(f.split("-")[1]) + 1}`);

  return (
    <div className="relative h-[calc(100dvh-64px)] overflow-hidden">
      <div className="absolute inset-0">
        <Map
          markers={markers}
          routePolyline={routePolyline}
          draggable={["pickup"]}
          padding={mapPadding}
          onReady={(api) => { mapApi.current = api; }}
          onMarkerDragEnd={(_id, p) => void describe(p.lat, p.lng, setPickup)}
          onMapClick={(p) => {
            if (!mapPicking) return;
            const field = mapPicking;
            setMapPicking(null);
            void describe(p.lat, p.lng, (place) => setField(field, place));
          }}
        />
      </div>

      {mapPicking && (
        <div className="absolute inset-x-3 top-3 z-20">
          <Alert tone="info" className="flex items-center justify-between shadow">
            <span>Tap the map to set <strong>{fieldTitle(mapPicking).toLowerCase()}</strong>.</span>
            <button className="underline" onClick={() => setMapPicking(null)}>Cancel</button>
          </Alert>
        </div>
      )}

      {pickup && !mapPicking && (
        <button onClick={locateMe} aria-label="Use my current location as pickup" style={{ bottom: sheetH + 12 }}
          className="surface absolute right-3 z-10 grid h-11 w-11 place-items-center rounded-full shadow-lg">
          {locating ? <Spinner className="h-5 w-5" /> : <LocateFixed className="h-5 w-5 text-brand-600" />}
        </button>
      )}

      {/* Bottom sheet */}
      <section ref={sheetRef} className="surface absolute inset-x-0 bottom-0 z-10 max-h-[62%] overflow-y-auto rounded-t-3xl p-4 pt-3 shadow-[var(--shadow-sheet)]" aria-label="Plan your ride">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[var(--line)]" aria-hidden />

        {!estimates ? (
          <>
            <div className="space-y-2">
              <LocationButton icon={<Circle className="h-3.5 w-3.5 fill-ok-500 text-ok-500" />} value={pickup?.address}
                placeholder={locating ? "Finding your location…" : "Pickup location"} onClick={() => setSearching("pickup")} />
              {stops.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1">
                    <LocationButton icon={<Square className="h-3 w-3 fill-warn-500 text-warn-500" />} value={s?.address}
                      placeholder={`Stop ${i + 1}`} onClick={() => setSearching(`stop-${i}`)} />
                  </div>
                  <button className="text-muted grid h-11 w-11 place-items-center rounded-xl hover:bg-[var(--surface-muted)]" aria-label={`Remove stop ${i + 1}`}
                    onClick={() => setStops((x) => x.filter((_, j) => j !== i))}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <LocationButton icon={<MapPin className="h-4 w-4 text-signal-500" />} value={dropoff?.address}
                placeholder="Where to?" onClick={() => setSearching("dropoff")} emphasis />
            </div>

            <div className="mt-2 flex items-center justify-between">
              {stops.length < maxStops ? (
                <button className="flex items-center gap-1 text-sm font-medium text-brand-600" onClick={() => setStops((s) => [...s, null])}>
                  <Plus className="h-4 w-4" /> Add stop
                </button>
              ) : <span />}
              {nearby !== null && pickup && (
                <span className="text-muted text-xs">{nearby === 0 ? "No drivers nearby right now" : `${nearby} driver${nearby === 1 ? "" : "s"} nearby`}</span>
              )}
            </div>

            {gpsError && !pickup && <Alert tone="warn" className="mt-3">{gpsError} You can search or tap “Choose on map”.</Alert>}
            {upcoming.length > 0 && (
              <a href="/passenger/trips" className="mt-3 flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                <CalendarClock className="h-4 w-4 text-brand-600" aria-hidden />
                <span className="flex-1">Upcoming: {new Date(upcoming[0]!.scheduled_for).toLocaleString("en-LR", { weekday: "short", hour: "2-digit", minute: "2-digit" })} → {upcoming[0]!.dropoff_address}</span>
                {upcoming.length > 1 && <span className="text-muted text-xs">+{upcoming.length - 1}</span>}
              </a>
            )}

            {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
            <Button size="lg" className="mt-4 w-full" disabled={!readyToPrice} loading={estimating} onClick={priceTrip}>
              See prices
            </Button>
          </>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2">
              <button onClick={() => setEstimates(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg hover:bg-[var(--surface-muted)]" aria-label="Back">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-medium">{dropoff?.address}</p>
                {chosen?.distanceM !== undefined && (
                  <p className="text-muted text-xs">
                    {formatDistance(chosen.distanceM)} · ~{formatDuration(chosen.durationS ?? 0)}
                    {chosen.routeSource === "geodesic_fallback" && " · approximate"}
                  </p>
                )}
              </div>
              <div className="surface-muted grid shrink-0 grid-cols-2 rounded-lg p-0.5 text-xs font-semibold" role="radiogroup" aria-label="Currency">
                {(["USD", "LRD"] as const).map((c) => (
                  <button key={c} role="radio" aria-checked={currency === c} onClick={() => setCurrency(c)} disabled={estimating}
                    className={cn("rounded-md px-2.5 py-1.5", currency === c ? "surface shadow-sm" : "text-muted")}>{c}</button>
                ))}
              </div>
            </div>
            {estimateNotice && <Alert tone="info" className="mb-2">{estimateNotice}</Alert>}
            {(chosen?.surgeMultiplier ?? 1) > 1 && (
              <Alert tone="warn" className="mb-2" title={`Busy hours: prices ×${chosen!.surgeMultiplier!.toFixed(2)}`}>
                More people are riding right now. The price shown already includes it and won&apos;t change — or schedule for later.
              </Alert>
            )}

            <ul className={cn("space-y-2", estimating && "opacity-60")} role="radiogroup" aria-label="Ride option">
              {categories.map((c) => {
                const est = estimates.find((e) => e.category === c.code);
                const disabled = !est || Boolean(est.error);
                return (
                  <li key={c.code}>
                    <button role="radio" aria-checked={selected === c.code} disabled={disabled} onClick={() => setSelected(c.code)}
                      className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                        selected === c.code ? "border-brand-500 bg-brand-50" : "border-line", disabled && "opacity-50")}>
                      <Car className="h-6 w-6 shrink-0 text-brand-600" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 font-semibold">{c.name}
                          <span className="text-muted flex items-center gap-0.5 text-xs font-normal"><Users className="h-3 w-3" />{c.seats}</span></span>
                        <span className="text-muted block truncate text-xs">{c.description}</span>
                      </span>
                      <span className="text-right">
                        {est?.error ? <span className="text-muted text-xs">{est.error}</span> : (
                          <>
                            <span className="block font-bold tabular-nums">{money(est?.totalMinor, est?.currency ?? currency)}</span>
                            {est?.discountMinor && est.discountMinor !== "0" && (
                              <span className="text-muted block text-xs line-through">{money(est.subtotalMinor, est.currency ?? currency)}</span>
                            )}
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {bidBounds && !showOffer && (
                <button className="font-medium text-brand-600" onClick={() => setShowOffer(true)}>Offer your own price</button>
              )}
              {!showCoupon && !coupon && rewardCodes[0] && (
                <button className="flex items-center gap-1 font-medium text-ok-500" onClick={() => { setCoupon(rewardCodes[0]!); setShowCoupon(true); }}>
                  <Tag className="h-3.5 w-3.5" /> Use your reward {rewardCodes[0]}
                </button>
              )}
              {!showCoupon && (
                <button className="flex items-center gap-1 font-medium text-brand-600" onClick={() => setShowCoupon(true)}>
                  <Tag className="h-3.5 w-3.5" /> {coupon ? `Promo ${coupon}` : "Add promo code"}
                </button>
              )}
            </div>
            {showCoupon && (
              <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); setShowCoupon(false); void priceTrip(); }}>
                <Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Promo code" aria-label="Promo code" maxLength={32} autoFocus />
                <Button type="submit" variant="secondary" loading={estimating}>Apply</Button>
              </form>
            )}

            {bidBounds && showOffer && (
              <div className="mt-3 rounded-xl border border-dashed border-line p-3">
                <label htmlFor="offer" className="text-sm font-medium">Offer your price <Badge tone="brand">optional</Badge></label>
                <p className="text-muted text-xs">Drivers can accept or counter. Allowed: {money(bidBounds.min, currency)} – {money(bidBounds.max, currency)}.</p>
                <Input id="offer" inputMode="decimal" className="mt-2" placeholder={chosen?.totalMinor ? (Number(chosen.totalMinor) / 100).toFixed(2) : ""}
                  value={offer} onChange={(e) => setOffer(e.target.value)} />
              </div>
            )}

            <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Payment method">
              {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((p) => (
                <button key={p} role="radio" aria-checked={payment === p} onClick={() => setPayment(p)}
                  className={cn("flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-medium",
                    payment === p ? "border-brand-500 bg-brand-50" : "border-line")}>
                  {p === "cash" ? <Banknote className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                  {PAYMENT_LABEL[p]}
                </button>
              ))}
            </div>
            <p className="text-muted mt-2 text-xs">Upfront price: this is what you pay unless you change the route or keep the driver waiting.</p>
            {payment !== "cash" && (
              <p className="text-muted mt-2 text-xs">Mobile money is collected after the trip. If it can&apos;t be completed, you can pay your driver in cash.</p>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="When">
              {(["now", "later"] as const).map((w) => (
                <button key={w} role="radio" aria-checked={when === w} onClick={() => setWhen(w)}
                  className={cn("flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-medium",
                    when === w ? "border-brand-500 bg-brand-50" : "border-line")}>
                  {w === "now" ? <Car className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}{w === "now" ? "Ride now" : "Schedule"}
                </button>
              ))}
            </div>
            {when === "later" && (
              <div className="mt-2">
                <label htmlFor="later-at" className="text-sm font-medium">Pickup time</label>
                <Input id="later-at" type="datetime-local" className="mt-1" value={laterAt} onChange={(e) => setLaterAt(e.target.value)}
                  min={localInput(Date.now() + 30 * 60_000)} max={localInput(Date.now() + 7 * 86_400_000)} />
                <p className="text-muted mt-1 text-xs">From 30 minutes to 7 days ahead. The price above is locked; we start finding your driver 15 minutes before.</p>
              </div>
            )}
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={forOther} onChange={(e) => setForOther(e.target.checked)} />
              <UserRound className="h-4 w-4 text-brand-600" aria-hidden /> Booking for someone else
            </label>
            {forOther && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Input aria-label="Rider's name" placeholder="Rider's name" value={rider.name} onChange={(e) => setRider({ ...rider, name: e.target.value })} />
                <Input aria-label="Rider's phone" placeholder="Phone, e.g. 077…" inputMode="tel" value={rider.phone} onChange={(e) => setRider({ ...rider, phone: e.target.value })} />
                <p className="text-muted col-span-2 text-xs">The driver will call this number. After booking, send them the ride PIN and trip link from the trip screen.</p>
              </div>
            )}

            {feeDue > 0 && (
              <Alert tone="warn" className="mt-3">An unpaid cancellation fee of {money(feeDue, chosen?.currency ?? currency)} from an earlier ride will be added to this trip.</Alert>
            )}
            {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
            {/* Stays visible while the options scroll. */}
            <div className="surface sticky -bottom-4 -mx-4 mt-3 px-4 pb-4 pt-2">
              <Button size="lg" className="w-full" disabled={!chosen} loading={booking} onClick={confirm}>
                {offer.trim() && bidBounds ? "Send offer to drivers" : when === "later" ? "Schedule ride" : `Confirm ${categories.find((c) => c.code === selected)?.name ?? ""}`}
                {chosen?.totalMinor && !offer.trim() && <span className="opacity-80">· {money(Number(chosen.totalMinor) + feeDue, chosen.currency ?? currency)}</span>}
              </Button>
            </div>
          </>
        )}
      </section>

      {searching && (
        <LocationSearch
          title={fieldTitle(searching)}
          savedPlaces={savedPlaces}
          onUseGps={searching === "pickup" ? locateMe : undefined}
          onChooseOnMap={() => { setMapPicking(searching); setSearching(null); }}
          onClose={() => setSearching(null)}
          onPick={(p) => { setField(searching, p); setSearching(null); }}
        />
      )}
      {locating && !pickup && (
        <div className="absolute left-1/2 top-1/3 z-10 -translate-x-1/2"><Spinner className="h-8 w-8" /></div>
      )}
    </div>
  );
}

function LocationButton({ icon, value, placeholder, onClick, emphasis }: {
  icon: React.ReactNode; value?: string; placeholder: string; onClick: () => void; emphasis?: boolean;
}) {
  return (
    <button onClick={onClick}
      className={cn("flex h-12 w-full items-center gap-3 rounded-xl border px-3 text-left",
        emphasis && !value ? "border-brand-200 bg-brand-50" : "surface-muted border-transparent")}>
      {icon}
      <span className={cn("truncate text-[15px]", !value && "text-muted")}>{value ?? placeholder}</span>
    </button>
  );
}

/** `datetime-local` value (device time) for a timestamp. */
function localInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}
