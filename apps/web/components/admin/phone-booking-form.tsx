"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { newIdempotencyKey } from "@liberia-ride/shared";
import { money } from "@/lib/utils";
import { Alert, Button, Card, Input } from "@/components/ui";
import { LocationSearch } from "@/components/passenger/location-search";
import type { Place } from "@/components/passenger/booking-flow";

interface Estimate { category: string; estimateId?: string; currency?: string; totalMinor?: string; surgeMultiplier?: number; error?: string }
interface Category { code: string; name: string }

/** Operator books for a caller who has no smartphone (phone, name, pickup, destination, price, confirm). */
export function PhoneBookingForm({ categories }: { categories: Category[] }) {
  const [caller, setCaller] = useState({ phone: "", name: "" });
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [picking, setPicking] = useState<"pickup" | "dropoff" | null>(null);
  const [currency, setCurrency] = useState<"USD" | "LRD">("USD");
  const [quote, setQuote] = useState<{ passenger: { id: string; name: string; isNew: boolean }; estimates: Estimate[]; notice: string | null } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [later, setLater] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ id: string; code: string; status: string } | null>(null);
  const idem = useRef<string | null>(null);

  async function call(body: unknown) {
    const res = await fetch("/api/admin/phone-booking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message ?? "Request failed.");
    return data;
  }

  async function price() {
    if (!pickup || !dropoff) return setError("Choose the pickup and destination.");
    setBusy(true); setError(null); setQuote(null); setSelected(null); idem.current = null;
    try {
      const data = await call({ action: "price", phone: caller.phone, name: caller.name, pickup, dropoff, currency,
        categories: categories.map((c) => c.code) });
      setQuote(data);
      setSelected((data.estimates as Estimate[]).find((e) => !e.error)?.category ?? null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function book() {
    const est = quote?.estimates.find((e) => e.category === selected);
    if (!quote || !est?.estimateId) return;
    let scheduledFor: string | undefined;
    if (later) {
      const t = new Date(later);
      if (Number.isNaN(t.getTime())) return setError("Check the pickup time.");
      scheduledFor = t.toISOString();
    }
    idem.current ??= newIdempotencyKey();
    setBusy(true); setError(null);
    try {
      const data = await call({ action: "book", passengerId: quote.passenger.id, estimateId: est.estimateId,
        idempotencyKey: idem.current, note: note || undefined, scheduledFor });
      setBooked(data.booking);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  function reset() {
    setCaller({ phone: "", name: "" }); setPickup(null); setDropoff(null); setQuote(null); setSelected(null);
    setLater(""); setNote(""); setBooked(null); setError(null); idem.current = null;
  }

  if (booked) {
    return (
      <Card className="max-w-xl space-y-3 p-4">
        <Alert tone="ok" title={`Booked ${booked.code}`}>
          {booked.status === "SCHEDULED" ? "Scheduled. Dispatch starts 15 minutes before pickup." : "Finding a driver now."} The driver will call the
          caller on their phone. No ride PIN is needed for phone bookings; the driver starts the trip at the pickup.
        </Alert>
        <div className="flex gap-2">
          <Link href={`/admin/bookings/${booked.id}`}><Button variant="secondary">Open booking</Button></Link>
          <Button onClick={reset}>New booking</Button>
        </div>
      </Card>
    );
  }

  const placeButton = (label: string, place: Place | null, which: "pickup" | "dropoff") => (
    <button type="button" onClick={() => setPicking(which)} aria-label={`${label}: ${place?.address ?? "choose"}`}
      className="flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-left text-sm">
      <MapPin className={which === "pickup" ? "h-4 w-4 text-ok-500" : "h-4 w-4 text-signal-500"} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{place?.address ?? <span className="text-muted">{label}</span>}</span>
    </button>
  );

  return (
    <div className="max-w-xl space-y-3">
      <Card className="grid gap-2 p-3 sm:grid-cols-2">
        <Input aria-label="Caller phone" placeholder="Caller phone, e.g. 077 012 3456" inputMode="tel" value={caller.phone}
          onChange={(e) => setCaller({ ...caller, phone: e.target.value })} />
        <Input aria-label="Caller name" placeholder="Caller name" value={caller.name} onChange={(e) => setCaller({ ...caller, name: e.target.value })} />
        <div className="sm:col-span-2">{placeButton("Pickup", pickup, "pickup")}</div>
        <div className="sm:col-span-2">{placeButton("Destination", dropoff, "dropoff")}</div>
        <div className="flex items-center gap-2 sm:col-span-2">
          {(["USD", "LRD"] as const).map((c) => (
            <button type="button" key={c} aria-pressed={currency === c} onClick={() => setCurrency(c)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${currency === c ? "border-brand-500 bg-brand-50" : "border-line"}`}>{c}</button>
          ))}
          <Button className="ml-auto" loading={busy && !quote} disabled={!pickup || !dropoff || caller.phone.length < 6 || caller.name.trim().length < 2} onClick={price}>
            Get prices
          </Button>
        </div>
      </Card>

      {quote && (
        <Card className="space-y-2 p-3">
          <p className="text-sm">
            {quote.passenger.isNew ? "New caller account created for " : "Existing caller: "}<strong>{quote.passenger.name}</strong>
          </p>
          {quote.notice && <Alert tone="info">{quote.notice}</Alert>}
          <ul className="space-y-1" role="radiogroup" aria-label="Ride option">
            {quote.estimates.map((e) => {
              const cat = categories.find((c) => c.code === e.category);
              return (
                <li key={e.category}>
                  <button type="button" role="radio" aria-checked={selected === e.category} disabled={Boolean(e.error)} onClick={() => setSelected(e.category)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm ${selected === e.category ? "border-brand-500 bg-brand-50" : "border-line"} ${e.error ? "opacity-50" : ""}`}>
                    <span>{cat?.name ?? e.category}{(e.surgeMultiplier ?? 1) > 1 && <span className="text-muted"> · busy ×{e.surgeMultiplier!.toFixed(2)}</span>}</span>
                    <span className="font-semibold tabular-nums">{e.error ?? money(e.totalMinor, e.currency ?? currency)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <label className="block text-sm">Pickup later (optional)
            <Input type="datetime-local" aria-label="Pickup later" className="mt-1" value={later} onChange={(e) => setLater(e.target.value)} />
          </label>
          <Input aria-label="Note for the driver" placeholder="Note for the driver, e.g. landmark or gate colour" value={note} maxLength={300}
            onChange={(e) => setNote(e.target.value)} />
          <p className="text-muted text-xs">Cash only. The price is fixed now; tell the caller this amount.</p>
          <Button className="w-full" size="lg" disabled={!selected} loading={busy} onClick={book}>Book for caller</Button>
        </Card>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      {picking && (
        <LocationSearch title={picking === "pickup" ? "Pickup" : "Destination"} savedPlaces={[]}
          onClose={() => setPicking(null)}
          onPick={(p) => { (picking === "pickup" ? setPickup : setDropoff)(p); setQuote(null); setPicking(null); }} />
      )}
    </div>
  );
}
