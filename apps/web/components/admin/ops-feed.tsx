"use client";
import { useState } from "react";
import Link from "next/link";
import { STATUS_LABELS, type BookingStatus } from "@liberia-ride/shared";
import { useRealtime } from "@/hooks/use-realtime";
import { Badge } from "@/components/ui";

interface FeedItem { key: string; at: number; kind: "booking" | "sos" | "incident"; text: string; href: string; tone: "brand" | "danger" | "warn" | "ok" | "neutral" }

/** Streams admin:ops (private; staff only by RLS on realtime.messages). */
export function OpsFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const push = (i: FeedItem) => setItems((list) => [i, ...list].slice(0, 40));

  const state = useRealtime("admin:ops", {
    booking_status: (p) => {
      const status = p.status as BookingStatus;
      push({
        key: `${p.booking_id}-${status}-${Date.now()}`, at: Date.now(), kind: "booking",
        text: `${p.code} → ${STATUS_LABELS[status] ?? status}`, href: `/admin/bookings/${p.booking_id}`,
        tone: status === "COMPLETED" ? "ok" : status === "CANCELLED" || status === "EXPIRED" || status === "FAILED" ? "neutral" : "brand",
      });
    },
    sos: (p) => {
      push({ key: `sos-${p.incident_id}-${Date.now()}`, at: Date.now(), kind: "sos", text: `SOS from ${p.reporter_role}`, href: "/admin/safety", tone: "danger" });
      if ("Notification" in window && Notification.permission === "granted") new Notification("LiberiaRide SOS", { body: `SOS from ${p.reporter_role}` });
    },
    incident: (p) => push({ key: `inc-${p.incident_id}-${Date.now()}`, at: Date.now(), kind: "incident", text: `Incident: ${p.kind}`, href: "/admin/safety", tone: "warn" }),
  });

  return (
    <div className="mt-2">
      <p className="text-muted text-xs">
        {state === "live" ? "● Live" : state === "connecting" ? "Connecting…" : "Disconnected — refresh the page"}
        {typeof window !== "undefined" && "Notification" in window && Notification.permission === "default" && (
          <button className="ml-2 underline" onClick={() => void Notification.requestPermission()}>Enable SOS desktop alerts</button>
        )}
      </p>
      {items.length === 0 ? <p className="text-muted mt-3 text-sm">Events will appear here as they happen.</p> : (
        <ul className="mt-2 max-h-96 divide-y divide-[var(--line)] overflow-y-auto text-sm" aria-live="polite">
          {items.map((i) => (
            <li key={i.key} className="flex items-center justify-between py-1.5">
              <Link href={i.href} className="hover:underline"><Badge tone={i.tone}>{i.kind}</Badge> {i.text}</Link>
              <span className="text-muted text-xs">{new Date(i.at).toLocaleTimeString("en-LR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
