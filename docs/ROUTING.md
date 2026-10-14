# Road routing (`src/routing`)

Street-following geometry for a Route's ordered waypoints, fetched client-side
from a keyless public OSRM instance. No backend, no API key, no Leaflet
dependency — the module takes `[lat, lng]` pairs and a profile and hands back
coordinates or a reason.

Implements the routing half of
[ADR 0001 — Route geometry is recomputed, not stored in the share URL](./adr/0001-route-geometry-storage.md).

## Endpoint choice: FOSSGIS, not the OSRM demo server

`router.project-osrm.org` hosts **only the car graph**. It answers `/foot/` and
`/bike/` with HTTP 200 and `code: "Ok"` — and returns the driving route. There
is no error to detect; the failure mode is a plausible wrong answer, and the
default profile is `foot`, so a walking tour would be routed down Lower Wacker
and reported as success.

ADR 0001, Sheraton → Michigan Ave Bridge:

| host                  | profile | result            |
| --------------------- | ------- | ----------------- |
| OSRM demo             | foot    | 611 m / 138 s     |
| OSRM demo             | bike    | 611 m / 138 s     |
| OSRM demo             | driving | 611 m / 138 s     |
| FOSSGIS `routed-foot` | foot    | 1,647 m / 1,317 s |
| FOSSGIS `routed-bike` | bike    | 537 m / 241 s     |
| FOSSGIS `routed-car`  | driving | 611 m / 138 s     |

Re-measured independently on 2026-10-14 over a longer Chicago pair
(41.8781,-87.6298 → 41.8919,-87.6051, `overview=false`): the demo server
returned the same 3442.6 m / 328.9 s for `driving`, `walking`, `cycling`,
`foot`, `bike` *and* `car`, while FOSSGIS returned 3594.3 m / 2874.9 s (foot,
1.25 m/s), 3496.1 m / 1023.1 s (bike, 3.4 m/s) and 3442.6 m / 328.9 s (car).

So `profile` is a **(host, path)** pair:

| `profile` | endpoint                                                      |
| --------- | ------------------------------------------------------------- |
| `foot`    | `https://routing.openstreetmap.de/routed-foot/route/v1/foot/…` |
| `bike`    | `https://routing.openstreetmap.de/routed-bike/route/v1/bike/…` |
| `driving` | `https://routing.openstreetmap.de/routed-car/route/v1/driving/…` |

The OSRM demo server stays in `endpoints.ts` as `OSRM_DEMO_ENDPOINT`, a
documented secondary **for `driving` only**; nothing wires it in by default.

Both hosts send `access-control-allow-origin: *` — that is what makes the
keyless GitHub Pages deployment possible. **Do not add request headers**: any
non-simple header triggers a CORS preflight these servers do not answer.

## Usage policy

Donated, rate-limited, no-SLA community endpoints
(<https://routing.openstreetmap.de/about.html>). Failure is expected, not
exceptional; the straight-line fallback is the contract. The service is built
to be a polite client:

- concurrency 1 by default (`maxConcurrency`, keep at 1–2);
- `minRequestIntervalMs` (200 ms) spacing between requests;
- 800 ms debounce per route key, superseding and aborting stale requests;
- identical concurrent requests share one HTTP call;
- two-tier cache keyed by profile and 5-decimal waypoints;
- a 429 parks the queue for `Retry-After`, or 5 s if the server sends none.

`ROUTING_ATTRIBUTION` / `ROUTING_ATTRIBUTION_HTML` are the credit the UI must
display (Leaflet attribution control).

## API

```ts
import { createRoutingService, shouldDegrade } from "../routing";
import { routeLatLngs } from "../editor/shape";

const routing = createRoutingService();          // defaults are production-ready

// routeLatLngs() merges the route's `via` shape points into stop order — ADR
// 0001 requires them to reach the router as intermediate waypoints.
const result = await routing.routeDebounced(
  route.id,
  routeLatLngs(route),
  route.profile,                                 // undefined → "foot"
);

if (result.ok) {
  polyline.setLatLngs(result.coords);            // [lat, lng], Leaflet order
} else if (shouldDegrade(result)) {
  drawStraightDashedFallback(result.reason);     // SPEC D4 graceful degradation
}                                                 // superseded/cancelled: do nothing
```

- `route(waypoints, profile?, { signal })` — immediate, cache-first.
- `routeDebounced(key, waypoints, profile?)` — one request per burst per `key`
  (use `route.id`). An older call settles as
  `{ ok: false, reason: "superseded" }` and its in-flight request is aborted.
- `cancel(key)` / `cancelAll()` — settle pending work as `cancelled`.
- `cache`, `attribution`, `attributionHtml`, `pendingKeys`.

Nothing throws at the caller. Every path resolves to
`{ ok: true, coords, fromCache }` or
`{ ok: false, reason, status?, detail?, retryAfterMs? }` with `reason` one of:
`too-few-stops`, `timeout`, `rate-limited`, `http-error`, `no-route`,
`api-error`, `malformed-response`, `network-error`, `cancelled`, `superseded`.

`shouldDegrade(result)` is the one predicate the UI needs: `true` means "show
the approximate straight line", `false` means "a newer answer is coming, leave
the map alone".

### Profiles

`RouteProfile` is `"foot" | "bike" | "driving"` — the names ADR 0001 puts in the
share URL. `normalizeProfile` accepts `undefined` (→ `foot`), the UI's wording
(`"car"`, `"walk"`), legacy OSRM names (`"walking"`, `"cycling"`), and degrades
anything unknown to `foot` rather than failing a render. `"car"` and `"driving"`
resolve to the same endpoint *and the same cache entry*.

### Coordinate order

`coords` is `[lat, lng]` — Leaflet order, same as `Stop.lat`/`Stop.lng` and
`Route.via`. OSRM's polyline is decoded (and GeoJSON flipped) once, at the parse
boundary in `osrm.ts`. Use `toLineString(coords)` if a caller needs GeoJSON.
All coordinates are rounded to 5 decimals (~1.1 m), which is also the cache-key
grain.

### Caching (ADR 0001)

- **Key:** `profile|lat,lng;…` over the ordered waypoints at 5 decimals. Route
  rename, recolor and stop-copy edits do **not** invalidate it; moving a stop
  does.
- **Tier 1:** in-memory `Map`, LRU, 200 entries — survives re-render and the
  editor ⇄ brochure transition.
- **Tier 2:** `sessionStorage` mirror — survives reload and print preview.
  Budgeted at ~1 MB (`maxStorageChars`), evicted oldest-first, with the
  bookkeeping index rehydrated on load. A quota exception evicts and retries,
  then gives up silently: a full `sessionStorage` must never break a render.
- **Geometry never enters the `Tour` object.** The cache is keyed *off* tour
  data and lives beside it; if geometry reached `serializeTour` the share URL
  would go to 143 % of its ceiling.

### Other behaviour worth knowing

- Fewer than two waypoints → `too-few-stops`, no request.
- `overview=full&geometries=polyline` (ADR 0001): `simplified` is too coarse at
  city-block zoom, and polyline is ~3× smaller on the wire than GeoJSON. The
  parser still accepts a GeoJSON geometry if a caller overrides the query.
- More than `maxWaypointsPerRequest` (100) waypoints → overlapping chunked
  requests, stitched with the seam point de-duplicated. The public servers
  accepted 101 coordinates in testing, but the limit is undocumented.
- 8 s `AbortController` timeout per request.
- Failures are never cached.

## Tests

`pnpm test` covers success, timeout, 429 + cooldown, HTTP errors, malformed
bodies, corrupt polylines, OSRM error codes, chunk stitching, cache
hit/eviction/mirror budget, profile aliasing, debounce coalescing,
supersede-and-abort, cancellation and serialisation — all against a mocked
`fetch`.

`src/routing/live.test.ts` hits the real endpoints (including a
polyline-vs-GeoJSON cross-check) and is skipped unless `ROUTING_LIVE=1`, so CI
never leans on a donated service:

```sh
ROUTING_LIVE=1 pnpm vitest run src/routing/live.test.ts
```
