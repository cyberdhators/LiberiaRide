import type { GeoPoint } from "./types";

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres (for UI hints only; billing uses PostGIS). */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rough ETA from straight-line distance, using the configured fallback speed. */
export function etaSecondsFromDistance(meters: number, speedKmh = 22, roadFactor = 1.35): number {
  return Math.round((meters * roadFactor) / (speedKmh / 3.6));
}

export function formatDistance(meters: number): string {
  if (meters < 950) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(meters < 9950 ? 1 : 0)} km`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function isFresh(receivedAt: string | Date | null | undefined, freshSeconds: number, now = Date.now()): boolean {
  if (!receivedAt) return false;
  const t = typeof receivedAt === "string" ? Date.parse(receivedAt) : receivedAt.getTime();
  return Number.isFinite(t) && now - t <= freshSeconds * 1000;
}

/** EWKT accepted by PostgREST for geography columns. */
export function toEwkt(p: GeoPoint): string {
  return `SRID=4326;POINT(${p.lng} ${p.lat})`;
}

/** Parse GeoJSON/EWKB-hex-free shapes PostgREST returns for geography columns (GeoJSON object). */
export function fromGeoJson(value: unknown): GeoPoint | null {
  if (typeof value === "object" && value !== null && "coordinates" in value) {
    const c = (value as { coordinates: unknown }).coordinates;
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") return { lng: c[0], lat: c[1] };
  }
  return null;
}
