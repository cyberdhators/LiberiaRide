// Provider-neutral location types. QLS is the primary implementation (see docs/QLS_INTEGRATION.md).

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type LocationSource = "qls_ping" | "qls_place" | "qls_address" | "alias" | "pin" | "gps";

export interface ResolvedLocation {
  point: GeoPoint;
  /** Human-readable label shown to users. */
  label: string;
  source: LocationSource;
  /** QLS reference: address sourceId ("LI-MON-…"), placeId, or ping id. */
  qlsRef?: string | null;
  /** Extra QLS address details (allow-listed, never internal ids). */
  details?: AddressDetails | null;
}

export interface AddressDetails {
  formattedAddress?: string;
  buildingNumber?: string;
  streetName?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  zipcode?: string;
  geobloc?: string;
  structureType?: string;
  additionalInfo?: string;
  validationStatus?: string;
}

export interface RouteStep {
  instruction: string;
  distanceText?: string;
  durationText?: string;
  maneuver?: string;
  point?: GeoPoint | null;
}

export interface Route {
  status: string;
  distanceMeters: number;
  durationSeconds: number;
  distanceText?: string;
  durationText?: string;
  originLabel?: string;
  destinationLabel?: string;
  /** Encoded polyline when provided by the routing service. */
  polyline?: string | null;
  steps: RouteStep[];
  crossBorder?: boolean;
}

export type TravelMode = "driving" | "walking" | "bicycling" | "transit";

export interface GeocodingProvider {
  /** Landmark / place name search. Returns null when nothing matched. */
  searchPlace(query: string): Promise<ResolvedLocation | null>;
}

export interface AddressProvider {
  /** Street-address search ("street, city[, region]"). */
  searchAddresses(query: string, limit?: number): Promise<ResolvedLocation[]>;
}

export interface LocationProvider {
  /** Resolve a shared live pin (share link or id). */
  resolvePing(pin: string): Promise<ResolvedLocation>;
  /** Straight-line distance in km between a driver and ONE stop. */
  driverDistance(driver: GeoPoint, stop: GeoPoint, role: "pickup" | "dropoff"): Promise<{ kilometers: number; miles: number }>;
}

export interface RoutingProvider {
  directions(origin: GeoPoint | string, destination: GeoPoint | string, mode?: TravelMode): Promise<Route | null>;
}

export interface ReverseGeocoder {
  reverse(point: GeoPoint): Promise<ResolvedLocation | null>;
}
