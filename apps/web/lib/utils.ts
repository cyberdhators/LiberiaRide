import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatMoney, type Currency } from "@liberia-ride/shared";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a minor-unit amount coming from Postgres (number | string | bigint). */
export function money(minor: number | string | bigint | null | undefined, currency: Currency | string): string {
  if (minor === null || minor === undefined) return "—";
  return formatMoney({ minor: BigInt(minor), currency: currency as Currency });
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-LR", { day: "numeric", month: "short" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-LR", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Monrovia",
  });
}

/** PostGIS geography returned by PostgREST as GeoJSON → {lat,lng}. */
export function pointOf(value: unknown): { lat: number; lng: number } | null {
  if (value && typeof value === "object" && "coordinates" in value) {
    const c = (value as { coordinates: [number, number] }).coordinates;
    return { lng: c[0], lat: c[1] };
  }
  return null;
}
