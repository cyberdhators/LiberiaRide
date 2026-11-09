"use client";
import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui";

// MapLibre touches `window` on import, so it is only ever loaded in the browser.
export const Map = dynamic(() => import("./map-view").then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div className="surface-muted grid h-full w-full place-items-center">
      <Spinner />
    </div>
  ),
});

export type { MapApi, MapArea, MapMarker, MarkerKind } from "./map-view";
