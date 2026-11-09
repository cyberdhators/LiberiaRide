// GAP ADAPTER — QLS's rideshare package has no reverse geocoding (docs/QLS_INTEGRATION.md §5.2).
// Resolution order: our verified landmark aliases → cached QLS results → neutral "Pinned location".
// No third-party reverse geocoder is called by default.
import type { GeoPoint, ResolvedLocation, ReverseGeocoder } from "../types";

export interface NearbyLookup {
  /** Nearest verified address_aliases row within radius, or null. */
  nearestAlias(point: GeoPoint, radiusM: number): Promise<{ label: string; qlsRef: string | null; point: GeoPoint } | null>;
  /** Nearest cached QLS lookup within radius, or null. */
  nearestCached(point: GeoPoint, radiusM: number): Promise<{ label: string; qlsRef: string | null; point: GeoPoint } | null>;
}

export class ReverseGeocodingAdapter implements ReverseGeocoder {
  constructor(private readonly lookup: NearbyLookup) {}

  async reverse(point: GeoPoint): Promise<ResolvedLocation> {
    const alias = await this.lookup.nearestAlias(point, 75);
    if (alias) return { point, label: `Near ${alias.label}`, source: "alias", qlsRef: alias.qlsRef };
    const cached = await this.lookup.nearestCached(point, 50);
    if (cached) return { point, label: cached.label, source: "pin", qlsRef: cached.qlsRef };
    return { point, label: pinnedLabel(point), source: "pin", qlsRef: null };
  }
}

export function pinnedLabel(p: GeoPoint): string {
  return `Pinned location (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`;
}
