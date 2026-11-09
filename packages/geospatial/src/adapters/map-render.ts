// GAP ADAPTER — QLS's rideshare package provides no map tiles or JS map SDK
// (docs/QLS_INTEGRATION.md §5.1). Rendering uses MapLibre GL with an open vector style.
// This module only describes *drawing*; every coordinate, label and route drawn comes
// from QLS or from our database.

export interface MapRenderConfig {
  styleUrl: string;
  attribution: string;
  /** Monrovia city centre. */
  defaultCenter: { lat: number; lng: number };
  defaultZoom: number;
  maxBounds: [[number, number], [number, number]];
}

export const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function mapRenderConfig(env: { NEXT_PUBLIC_MAP_STYLE_URL?: string } = {}): MapRenderConfig {
  return {
    styleUrl: env.NEXT_PUBLIC_MAP_STYLE_URL || DEFAULT_STYLE_URL,
    attribution: "Locations © QuantumLoc · Map © OpenStreetMap contributors",
    defaultCenter: { lat: 6.3005, lng: -10.7969 },
    defaultZoom: 13,
    // Liberia with margin, so the map can't wander off-continent on small screens.
    maxBounds: [[-12.2, 4.0], [-6.9, 9.0]],
  };
}

/** Decode a Google-style encoded polyline (precision 5) into [lng, lat] pairs for GeoJSON. */
export function decodePolyline(encoded: string, precision = 5): [number, number][] {
  const factor = 10 ** precision;
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const which of [0, 1] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        if (index >= encoded.length) return coords;
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lng += delta;
    }
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}
