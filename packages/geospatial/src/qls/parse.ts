// Tolerant parsing of QLS responses into our types.
// Verified live (9 Nov 2026): address rows carry top-level `latitude`/`longitude`; directions
// return `overviewPolyline` and steps with `start`/`end`. Ping/place point shapes are still
// UNVERIFIED, so several common shapes are accepted;
// anything without a valid coordinate is rejected rather than guessed.
import type { AddressDetails, GeoPoint, ResolvedLocation, Route, RouteStep } from "../types";
import { QlsError } from "./errors";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function validPoint(lat: number | null, lng: number | null): GeoPoint | null {
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null; // "null island" = missing data
  return { lat, lng };
}

function pointFromFlat(o: Obj): GeoPoint | null {
  return (
    validPoint(num(o.latitude), num(o.longitude)) ??
    validPoint(num(o.lat), num(o.lng)) ??
    validPoint(num(o.lat), num(o.lon))
  );
}

/** Extract a coordinate from any of the shapes we accept. */
export function extractPoint(value: unknown): GeoPoint | null {
  if (!isObj(value)) return null;
  const flat = pointFromFlat(value);
  if (flat) return flat;
  for (const key of ["location", "point", "position", "coordinates", "geometry", "coords"]) {
    const nested = value[key];
    if (isObj(nested)) {
      const p = pointFromFlat(nested) ?? extractPoint(nested);
      if (p) return p;
    }
    // GeoJSON [lng, lat]
    if (Array.isArray(nested) && nested.length >= 2) {
      const p = validPoint(num(nested[1]), num(nested[0]));
      if (p) return p;
    }
  }
  return null;
}

/** Point object to send back to QLS (driver-distance / directions accept latitude+longitude). */
export function toQlsPoint(p: GeoPoint): { latitude: number; longitude: number } {
  return { latitude: p.lat, longitude: p.lng };
}

const ADDRESS_FIELDS: (keyof AddressDetails)[] = [
  "formattedAddress", "buildingNumber", "streetName", "city", "district", "county", "state",
  "country", "postalCode", "zipcode", "geobloc", "structureType", "additionalInfo", "validationStatus",
];

/** Allow-list copy: internal fields (userId, createdByUser, projectId, …) never leave the server. */
export function sanitizeAddress(row: Obj): AddressDetails {
  const out: AddressDetails = {};
  for (const k of ADDRESS_FIELDS) {
    const v = str(row[k]);
    if (v) out[k] = v;
  }
  return out;
}

export function parseAddressRows(data: unknown): ResolvedLocation[] {
  if (!Array.isArray(data)) throw new QlsError("invalid_response", "address search: data is not a list");
  const out: ResolvedLocation[] = [];
  for (const row of data) {
    if (!isObj(row)) continue;
    const point = extractPoint(row);
    if (!point) continue;
    const details = sanitizeAddress(row);
    out.push({
      point,
      label: details.formattedAddress ?? [details.buildingNumber, details.streetName, details.city].filter(Boolean).join(" "),
      source: "qls_address",
      qlsRef: str(row.sourceId) ?? null,
      details,
    });
  }
  return out;
}

export function parsePlace(data: unknown): ResolvedLocation {
  if (!isObj(data)) throw new QlsError("invalid_response", "place search: data is not an object");
  const point = extractPoint(data);
  if (!point) throw new QlsError("invalid_response", "place search: no coordinates in response");
  const name = str(data.name);
  const label = str(data.label);
  return {
    point,
    label: name && label && !label.startsWith(name) ? `${name}, ${label}` : (label ?? name ?? "Selected place"),
    source: "qls_place",
    qlsRef: str(data.placeId) ?? null,
  };
}

export function parsePing(data: unknown): ResolvedLocation {
  if (!isObj(data)) throw new QlsError("invalid_response", "ping: data is not an object");
  const point = extractPoint(data);
  if (!point) throw new QlsError("invalid_response", "ping: no coordinates in response");
  return { point, label: str(data.label) ?? "Shared Ping", source: "qls_ping", qlsRef: str(data.id) ?? null };
}

function firstString(o: Obj, keys: string[]): string | null {
  for (const k of keys) {
    const v = str(o[k]);
    if (v) return v;
  }
  // Also look one level down, e.g. { overviewPolyline: { points: "..." } }
  for (const k of keys) {
    const v = o[k];
    if (isObj(v)) {
      const inner = str(v.points) ?? str(v.encoded) ?? str(v.polyline);
      if (inner) return inner;
    }
  }
  return null;
}

/** Returns null for a non-OK / empty route (QLS refunds the credit in that case). */
export function parseDirections(data: unknown): Route | null {
  if (!isObj(data)) throw new QlsError("invalid_response", "directions: data is not an object");
  const status = str(data.status) ?? "UNKNOWN";
  const rawSteps = Array.isArray(data.steps) ? data.steps : [];
  if (status !== "OK" || rawSteps.length === 0) return null;

  const distanceMeters = num(data.distanceMeters);
  const durationSeconds = num(data.durationSeconds);
  if (distanceMeters === null || durationSeconds === null || distanceMeters < 0 || durationSeconds < 0) {
    throw new QlsError("invalid_response", "directions: missing distanceMeters/durationSeconds");
  }

  const steps: RouteStep[] = rawSteps.filter(isObj).map((s) => ({
    instruction: str(s.instruction) ?? "",
    distanceText: str(s.distanceText),
    durationText: str(s.durationText),
    maneuver: str(s.maneuver),
    // Verified live: steps carry `start` / `end` objects.
    point: extractPoint(s.start) ?? extractPoint(s),
  }));

  return {
    status,
    distanceMeters: Math.round(distanceMeters),
    durationSeconds: Math.round(durationSeconds),
    distanceText: str(data.distanceText),
    durationText: str(data.durationText),
    originLabel: str(data.originLabel),
    destinationLabel: str(data.destinationLabel),
    crossBorder: data.crossBorder === true,
    polyline: firstString(data, ["polyline", "encodedPolyline", "overviewPolyline", "encodedPath", "path", "geometry"]),
    steps,
  };
}

export function parseDriverDistance(data: unknown): { kilometers: number; miles: number } {
  if (!isObj(data)) throw new QlsError("invalid_response", "driver-distance: data is not an object");
  const km = num(data.kilometers);
  const mi = num(data.miles);
  if (km === null || mi === null) throw new QlsError("invalid_response", "driver-distance: missing kilometers/miles");
  return { kilometers: km, miles: mi };
}

/** Address search rejects queries without "street, city" shape before spending a credit. */
export function isValidAddressQuery(query: string): boolean {
  const q = query.trim();
  if (q.length < 6) return false;
  const parts = q.split(",").map((p) => p.trim());
  return parts.length >= 2 && parts.every((p) => p.length >= 2);
}
