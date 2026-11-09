// QLS-backed implementations of the provider interfaces (docs/QLS_INTEGRATION.md §3).
import type {
  AddressProvider,
  GeocodingProvider,
  GeoPoint,
  LocationProvider,
  ResolvedLocation,
  Route,
  RoutingProvider,
  TravelMode,
} from "../types";
import type { QlsClient } from "./client";
import { QlsError } from "./errors";
import {
  isValidAddressQuery,
  parseAddressRows,
  parseDirections,
  parseDriverDistance,
  parsePing,
  parsePlace,
  toQlsPoint,
} from "./parse";

export class QLSGeocodingProvider implements GeocodingProvider {
  constructor(private readonly client: QlsClient) {}

  async searchPlace(query: string): Promise<ResolvedLocation | null> {
    const q = query.trim();
    if (q.length < 3) throw new QlsError("bad_request", "query must be at least 3 characters");
    try {
      const { data } = await this.client.post("/api/v1/search/places", { query: q, country: "LR" }, {}, { retry: true });
      return parsePlace(data);
    } catch (err) {
      if (err instanceof QlsError && err.isNotFound) return null;
      throw err;
    }
  }
}

export class QLSAddressProvider implements AddressProvider {
  constructor(private readonly client: QlsClient) {}

  async searchAddresses(query: string, limit = 10): Promise<ResolvedLocation[]> {
    if (!isValidAddressQuery(query)) {
      throw new QlsError("bad_request", "address must look like “street, city” (each part ≥ 2 characters)");
    }
    const { data } = await this.client.post(
      "/api/v1/search/addresses",
      { query: query.trim(), limit: Math.min(Math.max(Math.trunc(limit), 1), 50) },
      { "x-qls-country-id": this.client.liberiaCountryId },
      { retry: true },
    );
    return parseAddressRows(data);
  }
}

/** Accepts a share link (https://quantumloc.io/p/<id>) or a bare id. */
export function normalizePingInput(pin: string): string | null {
  const t = pin.trim();
  if (!t) return null;
  const m = /quantumloc\.io\/p\/([A-Za-z0-9_-]+)/i.exec(t);
  if (m) return m[1]!;
  return /^[A-Za-z0-9_-]{3,64}$/.test(t) ? t : null;
}

export class QLSLocationProvider implements LocationProvider {
  constructor(private readonly client: QlsClient) {}

  async resolvePing(pin: string): Promise<ResolvedLocation> {
    const id = normalizePingInput(pin);
    if (!id) throw new QlsError("bad_request", "not a valid Ping link or id");
    // Pings are live: never cached, never retried automatically (each attempt is billed).
    const { data } = await this.client.post("/api/v1/search/ping", { pin: id });
    return parsePing(data);
  }

  /**
   * On-demand only (1 credit per call). Live tracking uses PostGIS instead — see
   * docs/QLS_INTEGRATION.md §2. Exactly one of pickup/dropoff is sent, per the package.
   */
  async driverDistance(driver: GeoPoint, stop: GeoPoint, role: "pickup" | "dropoff") {
    const { data } = await this.client.post("/api/v1/search/driver-distance", {
      driver: toQlsPoint(driver),
      [role]: toQlsPoint(stop),
    });
    return parseDriverDistance(data);
  }
}

export class QLSRoutingProvider implements RoutingProvider {
  constructor(private readonly client: QlsClient) {}

  async directions(origin: GeoPoint | string, destination: GeoPoint | string, mode: TravelMode = "driving"): Promise<Route | null> {
    const asInput = (v: GeoPoint | string) => (typeof v === "string" ? v : toQlsPoint(v));
    // Non-OK routes are refunded by QLS, so one retry on transport errors is cheap.
    const { data } = await this.client.post(
      "/api/v1/navigation/directions",
      { origin: asInput(origin), destination: asInput(destination), mode },
      {},
      { retry: true },
    );
    return parseDirections(data);
  }

  /** Multi-stop route = sum of per-leg directions (QLS has no waypoint support). */
  async multiLeg(points: GeoPoint[], mode: TravelMode = "driving"): Promise<Route | null> {
    if (points.length < 2) return null;
    const legs: Route[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const leg = await this.directions(points[i]!, points[i + 1]!, mode);
      if (!leg) return null;
      legs.push(leg);
    }
    if (legs.length === 1) return legs[0]!;
    return {
      status: "OK",
      distanceMeters: legs.reduce((s, l) => s + l.distanceMeters, 0),
      durationSeconds: legs.reduce((s, l) => s + l.durationSeconds, 0),
      originLabel: legs[0]!.originLabel,
      destinationLabel: legs[legs.length - 1]!.destinationLabel,
      polyline: null,
      steps: legs.flatMap((l) => l.steps),
      crossBorder: legs.some((l) => l.crossBorder),
    };
  }
}
