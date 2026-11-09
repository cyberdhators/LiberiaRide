"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Banknote, Car, Circle, MapPin, Plus, Smartphone, Square, Users, X } from "lucide-react";
import { bidWindow, newIdempotencyKey, parseMajor } from "@liberia-ride/shared";
import { formatDistance, formatDuration } from "@liberia-ride/geospatial";
import { createClient } from "@/lib/supabase/client";
import { userMessage } from "@/lib/errors";
import { cn, money } from "@/lib/utils";
import { getCurrentFix } from "@/hooks/use-geolocation";
import { Map, type MapMarker } from "@/components/map";
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
  // One key per booking intent: retries of the same tap reuse it, so no duplicates.
  const idemKey = useRef<string | null>(null);

  const reverseLabel = useCallback(async (lat: number, lng: number): Promise<Place> => {
    try {
      const res = await fetch("/api/geo/reverse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat, lng }) });
      const body = await res.json();
      if (res.ok) return { lat, lng, address: body.result.label, qlsRef: body.result.qlsRef ?? null, source: body.result.source };
    } catch { /* offline: fall through */ }
    return { lat, lng, address: `Pinned location (${lat.toFixed(5)}, ${lng.toFixed(5)})`, qlsRef: null, source: "pin" };
  }, []);

  const locateMe = useCallback(async () => {
    setLocating(true);
    setGpsError(null);
    try {
      const fix = await getCurrentFix();
      setPickup(await reverseLabel(fix.lat, fix.lng));
      setSearching(null);
    } catch (e) {
      setGpsError((e as Error).message);
    } finally {
      setLocating(false);
    }
  }, [reverseLabel]);

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

  // Any change to the trip invalidates prices and the booking intent.
  const tripKey = JSON.stringify([pickup, dropoff, stops, currency, coupon]);
  useEffect(() => {
    setEstimates(null);
    setRoutePolyline(null);
    idemKey.current = null;
  }, [tripKey]);

  const readyToPrice = pickup && dropoff && stops.every(Boolean);

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
    idemKey.current ??= newIdempotencyKey();
    setBooking(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_booking", {
      p_estimate_id: chosen.estimateId,
      p_payment_method: payment,
      p_idempotency_key: idemKey.current,
      p_confirm: true,
      p_passenger_offer_minor: offerMinor,
      p_note: null,
    });
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
          onMarkerDragEnd={async (_id, p) => setPickup(await reverseLabel(p.lat, p.lng))}
          onMapClick={async (p) => {
            if (!mapPicking) return;
            setField(mapPicking, await reverseLabel(p.lat, p.lng));
            setMapPicking(null);
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

      {/* Bottom sheet */}
      <section className="surface absolute inset-x-0 bottom-0 z-10 max-h-[75%] overflow-y-auto rounded-t-3xl p-4 shadow-[var(--shadow-sheet)]" aria-label="Plan your ride">
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

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="surface-muted grid grid-cols-2 rounded-xl p-1 text-sm font-semibold" role="radiogroup" aria-label="Currency">
                {(["USD", "LRD"] as const).map((c) => (
                  <button key={c} role="radio" aria-checked={currency === c} onClick={() => setCurrency(c)}
                    className={cn("rounded-lg py-2", currency === c ? "surface shadow-sm" : "text-muted")}>{c}</button>
                ))}
              </div>
              <Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Promo code" aria-label="Promo code" maxLength={32} />
            </div>

            {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
            <Button size="lg" className="mt-4 w-full" disabled={!readyToPrice} loading={estimating} onClick={priceTrip}>
              See prices
            </Button>
          </>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <button onClick={() => setEstimates(null)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-[var(--surface-muted)]" aria-label="Back">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium">{dropoff?.address}</p>
                {chosen?.distanceM !== undefined && (
                  <p className="text-muted text-xs">
                    {formatDistance(chosen.distanceM)} · ~{formatDuration(chosen.durationS ?? 0)}
                    {chosen.routeSource === "geodesic_fallback" && " · approximate"}
                  </p>
                )}
              </div>
            </div>
            {estimateNotice && <Alert tone="info" className="mb-3">{estimateNotice}</Alert>}

            <ul className="space-y-2" role="radiogroup" aria-label="Ride option">
              {categories.map((c) => {
                const est = estimates.find((e) => e.category === c.code);
                const disabled = !est || Boolean(est.error);
                return (
                  <li key={c.code}>
                    <button role="radio" aria-checked={selected === c.code} disabled={disabled} onClick={() => setSelected(c.code)}
                      className={cn("flex w-full items-center gap-3 rounded-xl border p-3 text-left transition",
                        selected === c.code ? "border-brand-500 bg-brand-50" : "border-line", disabled && "opacity-50")}>
                      <Car className="h-6 w-6 text-brand-600" aria-hidden />
                      <span className="flex-1">
                        <span className="block font-semibold">{c.name}</span>
                        <span className="text-muted flex items-center gap-1 text-xs"><Users className="h-3 w-3" />{c.seats} · {c.description}</span>
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

            {bidBounds && (
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
                  className={cn("flex flex-col items-center gap-1 rounded-xl border p-2 text-xs font-medium",
                    payment === p ? "border-brand-500 bg-brand-50" : "border-line")}>
                  {p === "cash" ? <Banknote className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                  {PAYMENT_LABEL[p]}
                </button>
              ))}
            </div>
            {payment !== "cash" && (
              <p className="text-muted mt-2 text-xs">Mobile money is collected after the trip. If it can&apos;t be completed, you can pay your driver in cash.</p>
            )}

            {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
            <Button size="lg" className="mt-4 w-full" disabled={!chosen} loading={booking} onClick={confirm}>
              {offer.trim() && bidBounds ? "Send offer to drivers" : `Confirm ${categories.find((c) => c.code === selected)?.name ?? ""}`}
            </Button>
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
