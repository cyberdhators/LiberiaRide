// MapLibre loads its tile worker from a separate file next to its own module. Bundlers move the
// module, so we serve the worker from /public and point MapLibre at it (see components/map/map-view.tsx).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = join(dirname(require.resolve("maplibre-gl/package.json")), "dist");
const out = join(import.meta.dirname, "..", "public", "maplibre");
mkdirSync(out, { recursive: true });
copyFileSync(join(dist, "maplibre-gl-worker.mjs"), join(out, "maplibre-gl-worker.mjs"));
console.log("copied maplibre worker to public/maplibre/");
