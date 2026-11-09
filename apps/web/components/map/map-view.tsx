"use client";
// MapLibre rendering — the documented QLS map-render GAP adapter (docs/QLS_INTEGRATION.md §5.1).
// Draws only data we already hold (QLS lookups, our DB, live GPS). Never geocodes or routes.
import { useEffect, useRef } from "react";
import { GeoJSONSource, LngLatBounds, Map as MlMap, Marker, NavigationControl, getVersion, setWorkerUrl, type MapMouseEvent } from "maplibre-gl";
import { decodePolyline, mapRenderConfig } from "@liberia-ride/geospatial";

// The tile worker is served from /public (copied by scripts/copy-map-worker.mjs); bundling breaks
// MapLibre's own lookup and the map stays blank. Version query busts stale caches after upgrades.
setWorkerUrl(`/maplibre/maplibre-gl-worker.mjs?v=${getVersion()}`);

export type MarkerKind = "pickup" | "dropoff" | "stop" | "driver" | "driver-stale" | "driver-busy" | "me" | "sos";

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: MarkerKind;
  label?: string;
  heading?: number | null;
}

interface MapViewProps {
  markers?: MapMarker[];
  /** Encoded polyline (QLS directions) or explicit [lng,lat] path. */
  routePolyline?: string | null;
  routePath?: [number, number][] | null;
  /** Polygons to shade (service areas, zones); the view fits them when there are no markers. */
  areas?: MapArea[];
  /** Fit the view to markers/route when they change. */
  fit?: boolean;
  center?: { lat: number; lng: number } | null;
  onMapClick?: (p: { lat: number; lng: number }) => void;
  onMarkerDragEnd?: (id: string, p: { lat: number; lng: number }) => void;
  draggable?: string[];
  className?: string;
  interactive?: boolean;
  /** Space covered by overlays (e.g. a bottom sheet) so fitting keeps markers visible. */
  padding?: { top: number; bottom: number; left: number; right: number };
  /** Receives helpers once the map is created. */
  onReady?: (api: MapApi) => void;
}

export interface MapArea {
  id: string;
  geojson: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
  color?: string;
  dimmed?: boolean;
}

export interface MapApi {
  /**
   * Readable name for a point from the map's own labels (street + nearby landmark). Free: no QLS credit.
   * Waits for the map to finish drawing; null when nothing named is close or the point is off-screen.
   */
  labelAt(lat: number, lng: number): Promise<string | null>;
}

// Symbol layers carrying names in the OpenMapTiles schema (OpenFreeMap styles).
const isPoi = (layer: string) => /poi|landmark|aerodrome/i.test(layer);
const isRoad = (layer: string) => /road|highway|street|transportation/i.test(layer);

function nameNear(map: MlMap, lat: number, lng: number): string | null {
  const pt = map.project([lng, lat]);
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  if (pt.x < 0 || pt.y < 0 || pt.x > w || pt.y > h) return null;
  const pick = (radius: number, test: (layer: string) => boolean) => {
    const feats = map.queryRenderedFeatures([[pt.x - radius, pt.y - radius], [pt.x + radius, pt.y + radius]]);
    let best: { name: string; d: number } | null = null;
    for (const f of feats) {
      const name = (f.properties?.["name:en"] ?? f.properties?.name) as string | undefined;
      if (!name || !test(f.layer.id) || f.geometry.type === "Polygon") continue;
      const c = f.geometry.type === "Point" ? map.project(f.geometry.coordinates as [number, number]) : pt;
      const d = Math.hypot(c.x - pt.x, c.y - pt.y);
      if (!best || d < best.d) best = { name, d };
    }
    return best?.name ?? null;
  };
  const road = pick(30, isRoad);
  const poi = pick(70, isPoi);
  if (road && poi) return `${road}, near ${poi}`;
  if (poi) return `Near ${poi}`;
  return road;
}

const COLORS: Record<MarkerKind, string> = {
  pickup: "#138a52",
  dropoff: "#c8102e",
  stop: "#c77700",
  driver: "#143f85",
  "driver-busy": "#6b21a8",
  "driver-stale": "#9aa3b2",
  me: "#1d4f9c",
  sos: "#c8102e",
};

const PIN_KINDS = new Set<MarkerKind>(["dropoff", "stop", "sos"]);

function markerElement(m: MapMarker): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", m.label ?? m.kind);
  el.title = m.label ?? "";
  const color = COLORS[m.kind];
  if (m.kind.startsWith("driver")) {
    el.style.cssText = `width:30px;height:30px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:grid;place-items:center;`;
    el.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" style="transform:rotate(${m.heading ?? 0}deg)"><path fill="#fff" d="M12 2l7 18-7-4-7 4z"/></svg>`;
  } else if (m.kind === "me") {
    el.style.cssText = `width:18px;height:18px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 0 0 6px rgba(29,79,156,.25);`;
  } else if (m.kind === "pickup") {
    el.style.cssText = `width:22px;height:22px;border-radius:9999px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:grid;place-items:center;cursor:grab;`;
    el.innerHTML = `<span style="width:12px;height:12px;border-radius:9999px;background:${color};display:block"></span>`;
  } else {
    // Teardrop pin anchored at its tip (anchor "bottom"); MapLibre owns the element's transform.
    el.style.cssText = "width:30px;height:40px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));";
    el.innerHTML = `<svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><path d="M15 39C15 39 28 24.5 28 14.5A13 13 0 0 0 2 14.5C2 24.5 15 39 15 39Z" fill="${color}" stroke="#fff" stroke-width="2.5"/>`
      + (m.kind === "stop" ? `<rect x="10" y="9.5" width="10" height="10" rx="2" fill="#fff"/>` : `<circle cx="15" cy="14.5" r="5" fill="#fff"/>`) + `</svg>`;
  }
  return el;
}

const DEFAULT_PADDING = { top: 60, bottom: 260, left: 40, right: 40 };

export function MapView({
  markers = [], routePolyline, routePath, fit = true, center, onMapClick, onMarkerDragEnd, draggable = [],
  className, interactive = true, padding = DEFAULT_PADDING, onReady, areas,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRefs = useRef(new Map<string, Marker>());
  const loadedRef = useRef(false);
  const readyQueue = useRef<(() => void)[]>([]);
  const clickRef = useRef(onMapClick);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const dragRef = useRef(onMarkerDragEnd);
  clickRef.current = onMapClick;
  dragRef.current = onMarkerDragEnd;

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const cfg = mapRenderConfig({ NEXT_PUBLIC_MAP_STYLE_URL: process.env.NEXT_PUBLIC_MAP_STYLE_URL });
    const map = new MlMap({
      container: containerRef.current,
      style: cfg.styleUrl,
      center: [cfg.defaultCenter.lng, cfg.defaultCenter.lat],
      zoom: cfg.defaultZoom,
      maxBounds: cfg.maxBounds,
      attributionControl: { compact: true, customAttribution: cfg.attribution },
      interactive,
      fadeDuration: 0,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      loadedRef.current = true;
      map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "route-casing", type: "line", source: "route", paint: { "line-color": "#ffffff", "line-width": 8 } });
      map.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#143f85", "line-width": 5 } });
      map.addSource("areas", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "areas-fill", type: "fill", source: "areas", paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "dimmed"], 0.04, 0.12] } }, "route-casing");
      map.addLayer({ id: "areas-line", type: "line", source: "areas", paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": ["case", ["get", "dimmed"], ["literal", [2, 2]], ["literal", [1, 0]]] } }, "route-casing");
      const queued = readyQueue.current.splice(0);
      for (const fn of queued) fn();
    });
    map.on("click", (e: MapMouseEvent) => clickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    mapRef.current = map;
    readyRef.current?.({
      labelAt: (lat, lng) => new Promise((resolve) => {
        const run = () => resolve(nameNear(map, lat, lng));
        if (map.loaded() && !map.isMoving()) run();
        else map.once("idle", run);
      }),
    });
    const markersMap = markerRefs.current;
    return () => {
      markersMap.forEach((m) => m.remove());
      markersMap.clear();
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, [interactive]);

  // Sync markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    for (const m of markers) {
      seen.add(m.id);
      const existing = markerRefs.current.get(m.id);
      if (existing) {
        existing.setLngLat([m.lng, m.lat]);
        const el = existing.getElement();
        const fresh = markerElement(m);
        // Keep MapLibre's positioning transform; replacing cssText wholesale would drop it.
        const transform = el.style.transform;
        el.style.cssText = fresh.style.cssText;
        el.style.transform = transform;
        el.innerHTML = fresh.innerHTML;
        el.title = fresh.title;
      } else {
        const marker = new Marker({ element: markerElement(m), draggable: draggable.includes(m.id), anchor: PIN_KINDS.has(m.kind) ? "bottom" : "center" })
          .setLngLat([m.lng, m.lat])
          .addTo(map);
        if (draggable.includes(m.id)) {
          marker.on("dragend", () => {
            const p = marker.getLngLat();
            dragRef.current?.(m.id, { lat: p.lat, lng: p.lng });
          });
        }
        markerRefs.current.set(m.id, marker);
      }
    }
    for (const [id, marker] of markerRefs.current) {
      if (!seen.has(id)) {
        marker.remove();
        markerRefs.current.delete(id);
      }
    }
  }, [markers, draggable]);

  // Sync route + fit.
  const markerKey = markers.map((m) => `${m.id}:${m.lat.toFixed(4)},${m.lng.toFixed(4)}`).join("|");
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const path = routePath ?? (routePolyline ? decodePolyline(routePolyline) : null);
      const src = map.getSource("route") as GeoJSONSource | undefined;
      src?.setData({
        type: "FeatureCollection",
        features: path && path.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: path } }] : [],
      });
      if (!fit) return;
      const pts: [number, number][] = [...markers.map((m) => [m.lng, m.lat] as [number, number]), ...(path ?? [])];
      // Padding is applied as a one-off camera offset. Passing it to easeTo/fitBounds would make it sticky
      // on the map, and with a tall bottom sheet MapLibre then stops loading tiles in the visible area.
      if (pts.length === 1) {
        map.easeTo({ center: pts[0], zoom: Math.max(map.getZoom(), 15), offset: [0, (padding.top - padding.bottom) / 2], duration: 400 });
      } else if (pts.length > 1) {
        const b = new LngLatBounds(pts[0], pts[0]);
        for (const p of pts) b.extend(p);
        const cam = map.cameraForBounds(b, { padding, maxZoom: 16 });
        if (cam) map.easeTo({ center: cam.center, zoom: cam.zoom, duration: 400 });
      }
    };
    if (loadedRef.current) apply();
    else readyQueue.current.push(apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePolyline, routePath, fit, markerKey, padding.bottom]);

  // Sync areas; with no markers, frame them.
  const areaKey = (areas ?? []).map((a) => `${a.id}:${a.color}:${a.dimmed}`).join("|") + JSON.stringify((areas ?? []).map((a) => a.geojson)).length;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !areas) return;
    const apply = () => {
      (map.getSource("areas") as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: areas.map((a) => ({ type: "Feature", properties: { color: a.color ?? "#143f85", dimmed: Boolean(a.dimmed) }, geometry: a.geojson as never })),
      });
      if (!fit || markers.length || !areas.length) return;
      const coords: [number, number][] = [];
      const walk = (c: unknown): void => {
        if (Array.isArray(c) && typeof c[0] === "number") coords.push(c as [number, number]);
        else if (Array.isArray(c)) c.forEach(walk);
      };
      areas.forEach((a) => walk(a.geojson.coordinates));
      if (!coords.length) return;
      const b = new LngLatBounds(coords[0], coords[0]);
      for (const p of coords) b.extend(p);
      const cam = map.cameraForBounds(b, { padding: 40 });
      if (cam) map.easeTo({ center: cam.center, zoom: cam.zoom, duration: 400 });
    };
    if (loadedRef.current) apply();
    else readyQueue.current.push(apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey, fit]);

  useEffect(() => {
    if (center && mapRef.current) mapRef.current.easeTo({ center: [center.lng, center.lat], zoom: 15, duration: 400 });
  }, [center]);

  return <div ref={containerRef} className={className ?? "h-full w-full"} />;
}
