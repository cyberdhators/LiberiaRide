import type { Place } from "@/components/passenger/booking-flow";

/** Coordinates → readable place via /api/geo/reverse (free, no QLS credit). Falls back to a pinned label offline. */
export async function reverseLabel(lat: number, lng: number): Promise<Place> {
  try {
    const res = await fetch("/api/geo/reverse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat, lng }) });
    const body = await res.json();
    if (res.ok) return { lat, lng, address: body.result.label, qlsRef: body.result.qlsRef ?? null, source: body.result.source };
  } catch { /* offline: fall through */ }
  return { lat, lng, address: `Pinned location (${lat.toFixed(5)}, ${lng.toFixed(5)})`, qlsRef: null, source: "pin" };
}
