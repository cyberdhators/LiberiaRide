# QLS Integration

Quantum Location Services (QLS / QuantumLoc) is LiberiaRide's **primary** location provider.
This document records what the QLS rideshare package actually offers, how LiberiaRide uses it,
and where we had to fill gaps.

**Source of truth:** "QuantumLoc · Cyberdhators rideshare API" customer package, dated 7 November 2026
(PDF supplied by the account owner, kept outside the repository because it contains a one-time credit code).
The public URL `https://api.quantumloc.io/docs` did not resolve from our build environment (DNS NXDOMAIN, 9 Nov 2026).

Nothing in this file is invented. Anything not stated in the package is marked **UNVERIFIED** and must be
confirmed against a live response before production.

---

## 1. Account & authentication

| Item | Value |
|---|---|
| Production base URL | `https://qls-global-api-15562653385.europe-west1.run.app` |
| Auth | Header `x-api-key: qls_…` (secret, created in User Portal → Settings → API Settings → API Keys Management) |
| Transport | `POST`, `Content-Type: application/json` |
| Key location | Server only (`QLS_API_KEY`). Never shipped to the browser. Never sent alongside a QuantumLoc browser session. |
| Liberia country id | `0b2f0b78-152d-408d-b357-1af1ae4d2a49` (header `x-qls-country-id` for address search) |
| Country list | `GET /api/v1/tenancy/countries` — no key, no credit |

Account activation (owner action, one time): sign up → QLS admin grants API access → redeem credit code
→ create API key. Signing up alone does **not** grant API access.

## 2. Billing model (drives the architecture)

* Each valid call = **1 credit**, including misses (ping off, place not found, empty address result).
* Malformed requests (400) and missing key (401) cost nothing.
* Directions **refunds** the credit when `status != "OK"`, `steps` is empty, or the call fails.
* Credits exhausted → `403 api_inactive` (no charge). The call that spends the last credit succeeds.
* Starter pack: 100 credits for USD 10.00 → **≈ USD 0.10 per call**.

**Consequences for LiberiaRide:**

1. **No search-as-you-type against QLS.** Search fires on explicit submit (button / Enter), min 3 chars,
   server-side debounced and **cached** (`qls_lookup_cache`, see §6) so repeated landmark lookups are free.
2. **Live driver distance/ETA is computed in PostGIS**, not by polling QLS `driver-distance`.
   Polling QLS every few seconds per active ride would cost ~USD 0.10 per poll. The QLS endpoint is only
   straight-line distance anyway, which `ST_Distance` reproduces exactly. QLS `driver-distance` is still
   wired (`QLSLocationProvider.driverDistance`) and used for **one-off** checks (e.g. admin diagnostics),
   never on a timer. This is a documented cost decision, not a silent replacement.
3. **Directions is called once per fare estimate**, and the result (distance, duration, encoded path)
   is stored on the `fare_estimates` row and reused for booking, driver navigation and route display.
4. Server tracks credit failures; on `api_inactive` the app degrades (see §7) and alerts admins.

## 3. Endpoint capability matrix

| Capability required by spec | QLS package | Endpoint | LiberiaRide module | Status |
|---|---|---|---|---|
| Shared live pin → coordinates | ✅ | `POST /api/v1/search/ping` | `QLSLocationProvider.resolvePing` | Implemented |
| Place / landmark search (geocoding) | ✅ single best match | `POST /api/v1/search/places` | `QLSGeocodingProvider.searchPlace` | Implemented |
| Street address lookup / validation | ✅ list, max 50 | `POST /api/v1/search/addresses` | `QLSAddressProvider.searchAddresses` | Implemented |
| Digital address (QLS address) display | ✅ via address rows (`sourceId`, `formattedAddress`, `geobloc`, `validationStatus`) — verified live | addresses | `QLSAddressProvider` | Implemented |
| Road routing, distance, duration | ✅ | `POST /api/v1/navigation/directions` | `QLSRoutingProvider.directions` | Implemented |
| Turn-by-turn steps | ✅ `steps[]` | directions | `QLSRoutingProvider` | Implemented |
| Route geometry for drawing | ✅ `overviewPolyline` (verified live) | directions | `QLSRoutingProvider` | Implemented |
| Straight-line driver ↔ stop distance | ✅ | `POST /api/v1/search/driver-distance` | `QLSLocationProvider.driverDistance` | Implemented (on-demand only, §2) |
| **Reverse geocoding** (coords → address) | ❌ not in package | — | `ReverseGeocodingAdapter` | **GAP** — see §5 |
| **Map rendering / tiles** | ❌ not in package | — | `MapRenderAdapter` | **GAP** — see §5 |
| Autocomplete / suggestions | ❌ (place search returns one match; `/search/locations` is explicitly excluded) | — | — | Not offered; UX uses submit-to-search |
| Real-time location streaming | ❌ (Ping reads a pin; no push stream) | — | Supabase Realtime | Browser GPS → Supabase (by design) |
| Multi-stop routing (waypoints) | ❌ not stated | — | Sum of per-leg directions calls | Per-leg; each leg = 1 credit |
| Rate limits | Not stated | — | Server-side throttle 5 req/s/user | **UNVERIFIED** |
| Batch address search, satellite stills | Separate product, not needed | — | — | Not used |

Explicitly **not** to be used: `POST /api/v1/search/locations` (public place box, not part of the billed package).

## 4. Request / response contracts (as documented)

All success bodies are `{ "data": … }`; address search adds `{ "meta": { "count": n } }`.
All errors are `{ "error": { "code", "message", "details", "requestId" } }`.

### 4.1 Ping — `POST /api/v1/search/ping`
Request: `{ "pin": "<share link https://quantumloc.io/p/<id> or the id>" }` (aliases: `ping`, `pingId`, `ping_id`, `id`).
Response: `data.source = "ping"`, `data.id`, `data.label` + a location point (**shape UNVERIFIED**).
Errors: `409 ping_inactive` (credit spent; ride must not start), `400` empty pin (free).

### 4.2 Place search — `POST /api/v1/search/places`
Request: `{ "query": ">= 3 chars", "country": "LR" }` (`"LR"` or `"Liberia"`; **not** `"LBR"`).
Response: `data.source = "place"`, `data.name`, `data.placeId`, `data.label` + location point.
Errors: `404 place_not_found` (credit spent), `400 country_required` (free), query < 3 chars (free).

### 4.3 Address search — `POST /api/v1/search/addresses`
Headers: `x-qls-country-id: 0b2f0b78-152d-408d-b357-1af1ae4d2a49`.
Request: `{ "query": "street, city[, region]", "limit": 1..50 (default 20),
"components": { "country", "city", "streetName" }?, "matchAllTokens": false }`.
Query must be comma-separated through at least the city, each part ≥ 2 chars, total ≥ 6 chars —
otherwise `400` (free). We validate this client- and server-side before calling.
Response rows: `formattedAddress, buildingNumber, streetName, city, district, county, state, country,
postalCode, zipcode, validationStatus` + location point. Empty result = `200`, `data: []`, credit spent.

### 4.4 Driver distance — `POST /api/v1/search/driver-distance`
Request: `{ "driver" | "ping": <point>, "pickup" | "dropoff": <point> }` — exactly one of pickup/dropoff.
Points accept `{latitude, longitude}` or `{lat, lng}`.
Response: `data.kilometers`, `data.miles` (3 dp), `data.role` (`pickup` | `dropoff`).
Errors: both stops → `400` (free); missing point → free.

### 4.5 Directions — `POST /api/v1/navigation/directions`
Request: `{ "origin": <text | point>, "destination": <text | point>, "mode": "driving" }`
(`driving | walking | bicycling | transit`). We always send points we already resolved.
Response: `status`, `mode`, `originLabel`, `destinationLabel`, `distanceText`, `durationText`,
`distanceMeters`, `durationSeconds`, `crossBorder`, `steps[{instruction, distanceText, durationText, maneuver}]`
+ encoded path + per-step points (**field names UNVERIFIED**).
Errors: `400 invalid_directions_request` (free). Non-OK / empty steps → credit refunded.

### 4.6 Live observations (9 Nov 2026)
* `GET /api/v1/tenancy/countries` → `{"data":[{id,name,code,status,currency,...}]}` (free, no key).
* Address search `"Capitol Hill, Monrovia"` → HTTP 200, 1 row. **Verified row shape:**
  `id, userId, projectId, addressSource ("qls"), sourceId ("LI-MON-MON-1848-RF86223M" — the QLS digital
  address code), formattedAddress, buildingNumber, streetName, city, district, county, state, country,
  postalCode, zipcode, latitude, longitude, structureType, additionalInfo, geobloc, geoblocId,
  validationStatus, validatedBy, validatedAt, createdAt, updatedAt, createdByUser, project`.
  → Coordinates are **top-level `latitude` / `longitude`** (numbers).
  → `userId`, `createdByUser`, `projectId`, `project`, `validatedBy` are internal: the server
    **strips them** before anything reaches a browser (allow-list in `qls/parse.ts`).
  → We store `sourceId` as the stop's `qls_ref` and show it as the passenger-facing QLS code.
* Place search `"Capitol Building"` (the package's own example) → **404 `place_not_found`** (credit spent).
  Place coverage in Liberia is evidently partial; the UI therefore offers address search and map-pin
  as first-class alternatives, and the `address_aliases` landmark table fills local gaps.
* Directions (Executive Mansion → ELWA, driving) → HTTP 200, **verified shape:** `status, mode, originLabel,
  destinationLabel, distanceText, durationText, distanceMeters, durationSeconds, overviewPolyline` (Google-encoded,
  precision 5), `bounds{northeast,southwest}{lat,lng}`, `steps[]{instruction, distanceText, durationText, maneuver,
  start{lat,lng}, end{lat,lng}}`, `googleMapsUrl`, `crossBorder`. Example: 14.3 km / 33 min for a 11.8 km straight line
  → road factor ≈ 1.21 (our fallback `fare.road_factor` is 1.35 — tune after more samples).
* Ping, driver-distance: shapes still **UNVERIFIED** (no live call made yet — each costs a credit).
  `qls/parse.ts` accepts top-level `latitude/longitude` or `lat/lng`, or nested
  `location|point|coordinates|position` objects, or GeoJSON `[lng, lat]`, and rejects results with no valid coordinate.

## 5. Gaps and isolated adapters

The spec says: "If QLS does not provide a required capability, document the gap and implement a clearly
isolated adapter. Do not silently replace QLS." Two gaps exist.

### 5.1 Map rendering — `MapRenderAdapter`
QLS's rideshare package provides no tiles, style, or JS map SDK.
* Adapter: **MapLibre GL JS** (open-source, no vendor key) rendering an OpenStreetMap-based vector style
  (default: OpenFreeMap, configurable via `NEXT_PUBLIC_MAP_STYLE_URL`).
* Only *drawing* lives here. Every pin, address label, route line and distance shown on the map comes
  from QLS or from our own database — the tile layer never geocodes or routes.
* Swappable in one place (`packages/geospatial/src/adapters/map-render.ts`) the day QLS ships tiles.

### 5.2 Reverse geocoding — `ReverseGeocodingAdapter`
QLS's package has no coordinates → address call. When a passenger drops a pin or uses GPS, we resolve a label in this order:
1. Nearest verified `address_aliases` row within 75 m (our own Monrovia landmark table — free, local knowledge).
2. Nearest cached QLS result in `qls_lookup_cache` within 50 m.
3. Fallback: a neutral label "Pinned location" + coordinates; the passenger can type a landmark/address,
   which goes through QLS place/address search.

No third-party reverse geocoder is enabled by default. A Nominatim adapter exists behind
`REVERSE_GEOCODER=nominatim` for development only (its usage policy forbids heavy commercial use).

**Ask QLS:** whether reverse geocoding and map tiles can be added to the package.

## 6. Caching (`qls_lookup_cache`)

| Field | Purpose |
|---|---|
| `kind` | `place` / `address` / `ping` / `directions` |
| `query_hash` | SHA-256 of normalised request body |
| `response` | sanitised `data` payload |
| `location` | resolved point (spatial index for §5.2) |
| `expires_at` | places/addresses 30 days, directions 1 hour, ping never cached (pins are live) |

Cache writes happen only server-side (service role). Clients never read the cache table directly.

## 7. Failure handling

| QLS response | LiberiaRide behaviour |
|---|---|
| 401 `invalid_api_key` | Fail closed; admin alert; booking UI shows "Location search unavailable". |
| 403 `api_inactive` | Same as above + "QLS credits exhausted" banner in admin. Existing bookings continue (they hold stored routes). |
| 404 `place_not_found` / empty addresses | Show "No match in Liberia — try a landmark or street + city". |
| 409 `ping_inactive` | Block booking from that pin ("This Ping is off"). |
| Directions non-OK | Fare estimate falls back to PostGIS geodesic × configurable `road_factor` (config `fare.road_factor`, default 1.35), flagged `route_source = 'geodesic_fallback'` on the estimate. |
| 5xx / timeout (8 s) | One retry with jitter for idempotent lookups; then the same fallback as above. |

## 8. Module map

```
packages/geospatial/src/
  types.ts                 GeoPoint, ResolvedLocation, Route, provider interfaces
  qls/client.ts            fetch wrapper (server-only), error mapping, timeout, retry
  qls/parse.ts             tolerant point / route parsing
  qls/providers.ts         QLSGeocodingProvider, QLSAddressProvider, QLSLocationProvider, QLSRoutingProvider
  adapters/map-render.ts   MapRenderAdapter (MapLibre) — GAP adapter
  adapters/reverse.ts      ReverseGeocodingAdapter — GAP adapter
apps/web/app/api/geo/*     authenticated route handlers that call the providers
```

## 9. Real-time location (not a QLS responsibility)

* Driver browser → `navigator.geolocation.watchPosition` → `rpc('driver_update_location')`
  (authenticated, rate-limited, timestamp & accuracy validated server-side).
* Supabase stores the latest position (`driver_locations`) + history, and broadcasts to the
  private `booking:<id>` channel only while a ride is assigned.
* Freshness: positions older than `dispatch.location_fresh_seconds` (default 45 s) are treated as stale —
  excluded from dispatch and rendered greyed-out with "last seen" time.
* QLS Ping remains available for passengers who prefer to share a QuantumLoc pin as pickup.
