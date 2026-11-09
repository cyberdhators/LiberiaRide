"use client";
import { useState } from "react";
import { formatDistance, formatDuration } from "@liberia-ride/geospatial";
import { money } from "@/lib/utils";
import { Badge, Button, Card, Input } from "@/components/ui";

export interface Offer {
  offer_id: string; booking_id: string; status: string;
  pickup_address: string; dropoff_address: string | null; pickup: { lat: number; lng: number };
  category: string; currency: string; fare_minor: number; trip_distance_m: number; trip_duration_s: number;
  pickup_distance_m: number; bidding_enabled: boolean; expires_at: string;
}

export function OfferCard({ offer, now, busy, onAccept, onReject, onCounter }: {
  offer: Offer; now: number; busy: string | null;
  onAccept: () => void; onReject: () => void; onCounter: (amountMinor: number) => void;
}) {
  const [counter, setCounter] = useState("");
  const secondsLeft = Math.max(0, Math.round((Date.parse(offer.expires_at) - now) / 1000));
  const expired = secondsLeft === 0;

  return (
    <Card className="border-brand-200 p-3" aria-live="assertive">
      <div className="flex items-center justify-between">
        <Badge tone="brand">{offer.bidding_enabled ? "Price offer" : "New ride"}</Badge>
        <span className={`font-mono text-sm font-bold tabular-nums ${secondsLeft <= 5 ? "text-signal-600" : ""}`} aria-label={`${secondsLeft} seconds left`}>
          {secondsLeft}s
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{money(offer.fare_minor, offer.currency)}</p>
      <p className="text-muted text-xs">
        {formatDistance(offer.pickup_distance_m)} to pickup · trip {formatDistance(offer.trip_distance_m)} · ~{formatDuration(offer.trip_duration_s)}
      </p>
      <div className="mt-2 space-y-1 text-sm">
        <p className="flex gap-2"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ok-500" />{offer.pickup_address}</p>
        {offer.dropoff_address && <p className="flex gap-2"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-signal-500" />{offer.dropoff_address}</p>}
      </div>
      {offer.bidding_enabled && (
        <div className="mt-3 flex gap-2">
          <Input inputMode="decimal" placeholder={`Counter (${offer.currency})`} value={counter} onChange={(e) => setCounter(e.target.value)} aria-label="Counter-offer amount" />
          <Button variant="secondary" disabled={!counter || expired} loading={busy === "counter"}
            onClick={() => { const m = Math.round(Number(counter.replace(/,/g, "")) * 100); if (m > 0) onCounter(m); }}>
            Counter
          </Button>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" onClick={onReject} disabled={busy !== null}>Decline</Button>
        <Button variant="success" size="lg" onClick={onAccept} loading={busy === "accept"} disabled={expired}>Accept</Button>
      </div>
    </Card>
  );
}
