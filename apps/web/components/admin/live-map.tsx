"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { STATUS_LABELS, type BookingStatus } from "@liberia-ride/shared";
import { createClient } from "@/lib/supabase/client";
import { useRealtime } from "@/hooks/use-realtime";
import { timeAgo } from "@/lib/utils";
import { Map, type MapMarker } from "@/components/map";
import { Badge } from "@/components/ui";

interface Driver { id: string; name: string | null; online: boolean; busy: boolean; lat: number; lng: number; heading: number | null; received_at: string; fresh: boolean }
interface Booking { id: string; code: string; status: BookingStatus; driver_id: string | null; pickup: { lat: number; lng: number; address: string }; dropoff: { lat: number; lng: number; address: string } }
export interface LiveMapData { drivers: Driver[]; bookings: Booking[] }

const FRESH_MS = 45_000;

export function LiveMap({ initial }: { initial: LiveMapData }) {
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<"all" | "available" | "busy" | "stale">("all");

  const reload = useCallback(async () => {
    const { data } = await createClient().rpc("admin_live_map");
    if (data) setData(data as LiveMapData);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    const r = setInterval(() => void reload(), 60_000); // bookings refresh; positions stream live
    return () => { clearInterval(t); clearInterval(r); };
  }, [reload]);

  useRealtime("admin:fleet", {
    driver_location: (p) => setData((d) => ({
      ...d,
      drivers: d.drivers.some((x) => x.id === p.driver_id)
        ? d.drivers.map((x) => x.id === p.driver_id ? { ...x, lat: p.lat as number, lng: p.lng as number, heading: (p.heading as number) ?? null, received_at: p.received_at as string } : x)
        : d.drivers,
    })),
  }, reload);
  useRealtime("admin:ops", { booking_status: () => void reload() });

  const drivers = data.drivers.map((d) => ({ ...d, fresh: now - Date.parse(d.received_at) < FRESH_MS }));
  const shown = drivers.filter((d) => filter === "all" || (filter === "available" && d.online && !d.busy && d.fresh) || (filter === "busy" && d.busy) || (filter === "stale" && !d.fresh));

  const markers: MapMarker[] = useMemo(() => [
    ...shown.map((d) => ({ id: `d-${d.id}`, kind: (!d.fresh ? "driver-stale" : d.busy ? "driver-busy" : "driver") as MapMarker["kind"],
      lat: d.lat, lng: d.lng, heading: d.heading, label: `${d.name ?? "Driver"} · ${timeAgo(d.received_at, now)}` })),
    ...data.bookings.flatMap((b) => [
      { id: `p-${b.id}`, kind: "pickup" as const, lat: b.pickup.lat, lng: b.pickup.lng, label: `${b.code} pickup` },
      ...(b.status === "IN_PROGRESS" ? [{ id: `x-${b.id}`, kind: "dropoff" as const, lat: b.dropoff.lat, lng: b.dropoff.lng, label: `${b.code} destination` }] : []),
    ]),
  ], [shown, data.bookings, now]);

  const counts = {
    available: drivers.filter((d) => d.online && !d.busy && d.fresh).length,
    busy: drivers.filter((d) => d.busy).length,
    stale: drivers.filter((d) => !d.fresh).length,
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="h-[70dvh] overflow-hidden rounded-xl border border-line">
        <Map markers={markers} fit={false} />
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          {(["all", "available", "busy", "stale"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 ${filter === f ? "border-brand-500 bg-brand-50" : "border-line"}`}>
              {f}{f !== "all" && ` (${counts[f]})`}
            </button>
          ))}
        </div>
        <p className="text-muted text-xs">Blue: available · Purple: on a trip · Grey: no GPS for 45 s+ (not dispatchable).</p>
        <div>
          <h2 className="text-sm font-semibold">Active bookings ({data.bookings.length})</h2>
          <ul className="mt-2 max-h-[55dvh] space-y-2 overflow-y-auto text-sm">
            {data.bookings.map((b) => (
              <li key={b.id} className="surface rounded-lg border border-line p-2">
                <Link href={`/admin/bookings/${b.id}`} className="font-medium underline">{b.code}</Link>{" "}
                <Badge tone={b.driver_id ? "brand" : "warn"}>{STATUS_LABELS[b.status]}</Badge>
                <p className="text-muted truncate text-xs">{b.pickup.address} → {b.dropoff.address}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
