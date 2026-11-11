# Seed data

## `osm-monrovia-landmarks.csv`

Named places (communities, markets, schools, clinics, churches, shops, hotels, …) and named streets
inside the Greater Monrovia service area, used for **type-ahead place search** (`public.landmarks`,
`suggest_places`) and for naming a pickup point (`nearest_place_label`).

- Source: OpenStreetMap, Geofabrik Liberia extract (`liberia-latest.osm.pbf`, downloaded 8 Nov 2026).
- Licence: © OpenStreetMap contributors, Open Database License (ODbL) 1.0 —
  <https://www.openstreetmap.org/copyright>. Keep this attribution; the app shows it under search results.
- Columns: `osm_id` (n = node, w = way), `name`, `category`, `locality` (nearest community within ~2.5 km),
  `lat`, `lng`, `alt_names` (`|`-separated).
- Streets are one point per street name (middle of its longest segment).

Load or refresh (idempotent):

```bash
node scripts/import-landmarks.mjs
```

QLS remains the location provider for addresses and for anything not in this list.
