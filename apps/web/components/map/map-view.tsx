"use client";
// MapLibre rendering — the documented QLS map-render GAP adapter (docs/QLS_INTEGRATION.md §5.1).
// Draws only data we already hold (QLS lookups, our DB, live GPS). Never geocodes or routes.
import { useEffect, useRef } from "react";
import { GeoJSONSource, LngLatBounds, Map as MlMap, Marker, NavigationControl, type MapMouseEvent } from "maplibre-gl";
import { decodePolyline, mapRenderConfig } from "@liberia-ride/geospatial";

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
  /** Fit the view to markers/route when they change. */
  fit?: boolean;
  center?: { lat: number; lng: number } | null;
  onMapClick?: (p: { lat: number; lng: number }) => void;
  onMarkerDragEnd?: (id: string, p: { lat: number; lng: number }) => void;
  draggable?: string[];
  className?: string;
  interactive?: boolean;
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
  } else {
    el.style.cssText = `width:22px;height:22px;border-radius:9999px 9999px 9999px 0;transform:rotate(-45deg);background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);`;
  }
  return el;
}

export function MapView({
  markers = [], routePolyline, routePath, fit = true, center, onMapClick, onMarkerDragEnd, draggable = [],
  className, interactive = true,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRefs = useRef(new Map<string, Marker>());
  const loadedRef = useRef(false);
  const readyQueue = useRef<(() => void)[]>([]);
  const clickRef = useRef(onMapClick);
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
      const queued = readyQueue.current.splice(0);
      for (const fn of queued) fn();
    });
    map.on("click", (e: MapMouseEvent) => clickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    mapRef.current = map;
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
        el.style.cssText = fresh.style.cssText;
        el.innerHTML = fresh.innerHTML;
        el.title = fresh.title;
      } else {
        const marker = new Marker({ element: markerElement(m), draggable: draggable.includes(m.id) })
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
      if (pts.length === 1) map.easeTo({ center: pts[0], zoom: Math.max(map.getZoom(), 15), duration: 400 });
      else if (pts.length > 1) {
        const b = new LngLatBounds(pts[0], pts[0]);
        for (const p of pts) b.extend(p);
        map.fitBounds(b, { padding: { top: 60, bottom: 260, left: 40, right: 40 }, maxZoom: 16, duration: 400 });
      }
    };
    if (loadedRef.current) apply();
    else readyQueue.current.push(apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePolyline, routePath, fit, markerKey]);

  useEffect(() => {
    if (center && mapRef.current) mapRef.current.easeTo({ center: [center.lng, center.lat], zoom: 15, duration: 400 });
  }, [center]);

  return <div ref={containerRef} className={className ?? "h-full w-full"} />;
}
