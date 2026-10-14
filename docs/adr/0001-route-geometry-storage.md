# ADR 0001 — Route geometry is recomputed, not stored in the share URL

- **Status:** Accepted — awaiting Gavin's confirmation
- **Date:** 2026-10-14
- **Task:** t_44ae9cde (decision) · parents t_d408c860, t_442984bb
- **Supersedes:** SPEC.md D4's "cached into `route.geometry` so the brochure stays a static artifact"
- **Evidence:** [`0001-measurements.json`](./0001-measurements.json), reproducible via `node scripts/measure-share-url.mjs`

## Context

Routes must follow streets instead of straight segments (Gavin's decision on t_d408c860).
The app is static on GitHub Pages, so geometry comes from a public routing API called
client-side. That raises one question the implementation cards cannot answer for
themselves: **does the road geometry travel in the share URL, or is it recomputed when a
link is opened?**

The whole tour lives in the URL hash (`#view&t=<lz-string>`), and `src/tour/schema.ts`
fixes the budget:

```ts
export const SHARE_URL_MAX = 8000;   // proxies and chat clients truncate past here
export const SHARE_URL_WARN = 6000;  // Copy link warns above this
```

Options considered:

- **A — store geometry.** Encode the road polyline per route into the serialized tour.
  Deterministic rendering, works offline and in print with no network at view time.
- **B — store intent.** Store stops plus a per-route routing `profile`, recompute geometry
  on load, cache it for the session.
- **A− — hybrid.** Store a *simplified* geometry as a low-fidelity fallback.

## Measurement

Realistic input, matching the reference brochure's shape: a Chicago hop-on/hop-off tour,
**3 routes / 36 stops** (Green 14, Red 12, Night 10), blurbs on every stop, descriptions on
the headline stops, three hotlinked images. Road geometry fetched live from
`router.project-osrm.org`, measured through the app's own encoder
(`compressToEncodedURIComponent`) and the real base URL
`https://www.gavmor.com/tour-brochure-builder/#view&t=`.

Per route, as returned by OSRM:

| Route | Stops | Road km | Geometry pts | polyline5 | polyline6 | simplified |
|---|---|---|---|---|---|---|
| Green | 14 | 18.3 | 776 | 1,896 c | 2,615 c | 279 c (79 pts) |
| Red | 12 | 14.6 | 736 | 1,779 c | 2,529 c | 236 c (67 pts) |
| Night | 10 | 18.5 | 757 | 1,873 c | 2,610 c | 271 c (73 pts) |

Resulting share-URL length (JSON → lz-string → full URL):

| Variant | JSON | lz-string | **URL** | % of 8 k | Verdict |
|---|---|---|---|---|---|
| **B — stops + `profile`** | 7,696 | 5,142 | **5,195** | 64.9 % | fits, below the 6 k warning |
| v2 today, no `profile` | 7,636 | 5,128 | 5,181 | 64.8 % | baseline |
| A — polyline5, full | 13,325 | 11,390 | **11,443** | 143 % | **breaks the link** |
| A — polyline6, full | 15,539 | 14,767 | **14,820** | 185 % | **breaks the link** |
| A− — polyline5, simplified | 8,525 | 6,419 | **6,472** | 81 % | fits, but trips the warning |
| A — raw GeoJSON coords, 5 dp | 54,821 | 21,402 | **21,455** | 268 % | **breaks the link** |

Where B's 5,195 characters actually go — geometry is not the expensive part, prose is:

| Content | URL chars | % of 8 k |
|---|---|---|
| Full tour (B) | 5,195 | 64.9 % |
| …minus stop descriptions | 3,617 | 45.2 % |
| …coordinates + titles only | 2,125 | 26.6 % |

### What the numbers say

1. **Option A does not fit.** Road geometry adds 5,629 characters of JSON to this tour and
   **6,248 characters to the final URL** — 2.2× the size of option B and **43 % past the
   hard ceiling**. Note the direction: lz-string does not merely fail to help, it makes
   geometry *11 % bigger*. Polyline5 is already entropy-dense, so there is nothing left to
   squeeze, and lz-string's URI-safe output packs only 6 bits per character — the same
   encoder returns 33 % on the tour's prose. A is not "big"; it is structurally impossible
   at the size of tour this app is for.
2. **A is worse than it looks**, because the budget is shared with author copy. The same
   geometry on a tour with fuller descriptions pushes further over; and A grows with
   *route length*, a quantity the author cannot see or control, so the failure arrives
   without warning when someone drags a stop across town.
3. **The hybrid fits but costs the warning.** A− lands at 6,472 — inside the ceiling but
   above the 6 k warn line, so every author of a realistic tour gets scolded by the Copy
   link button. In exchange they get 67–79-point geometry: visibly coarser than the
   reference at city-block zoom, which is exactly the fidelity this whole change was
   supposed to buy. It fails on both ends.
4. **B's marginal cost is 14 characters.** Adding `profile` to all three routes costs
   5,195 − 5,181 = **14 URL characters** (~5 per route, since lz-string dedupes the
   repeated key). The decision is nearly free on the axis that matters.

## Decision

**Option B.** The share URL stores stops plus a per-route routing `profile`. Road geometry
is recomputed at view time and cached for the session. **Geometry is never serialized into
the share URL or the `.json` export.**

### Schema change

Additive, in `src/tour/schema.ts`. **`TOUR_SCHEMA_VERSION` stays at 2** — a v2 tour without
`profile` is still a valid v2 tour, so there is nothing to migrate and no reason to make
older builds reject new links.

```ts
/** Routing profile for road-snapped geometry. */
export type RouteProfile = "foot" | "bike" | "driving";

export const ROUTE_PROFILES = ["foot", "bike", "driving"] as const;
export const DEFAULT_ROUTE_PROFILE: RouteProfile = "foot";

export interface Route {
  id: string;
  name: string;
  color: string;
  stops: Stop[];
  /** Manual shape points (SPEC D4). Author-drawn; unrelated to routing. */
  via?: [number, number][];
  /** Road-routing profile. Absent means "foot" (ADR 0001). */
  profile?: RouteProfile;
}
```

Three rules the implementation must honour:

- **`profile` is optional in the type and omitted when it equals the default.** Do not
  write `"profile":"foot"` into every route — that is pure budget for no information.
  `createRoute` should spread it conditionally, the way `via` already is.
- **No `Route.geometry` field.** Explicitly rejected. If a future card needs deterministic
  offline output, the answer is a self-contained HTML/PDF export (SPEC D3 already
  anticipates one), not a longer URL.
- **`via` is unchanged and still wins.** It is author intent, it is small, and it predates
  routing. Where both exist, `via` points are passed to the router as intermediate
  waypoints rather than being discarded.

Validator (`src/tour/validate.ts`), in the same repair-don't-reject spirit as the rest of
the file:

```ts
const routeSchema = z.object({
  // …
  profile: z.enum(ROUTE_PROFILES).optional(),
});
```

```ts
// in repairRoute(), alongside the existing `via` handling
const profile = cleanString(raw.profile);
if (profile !== undefined && !ROUTE_PROFILES.includes(profile as RouteProfile)) {
  warn(`${where}: unknown routing profile "${profile}"; used "${DEFAULT_ROUTE_PROFILE}"`);
}
if (profile !== undefined && ROUTE_PROFILES.includes(profile as RouteProfile)) {
  route.profile = profile as RouteProfile;
}
```

### Backward compatibility

Every share URL emitted before this change lacks `profile`, and **must keep loading
unchanged**. Guaranteed by three properties:

| Case | Behaviour |
|---|---|
| v2 URL, no `profile` | Loads. `route.profile ?? "foot"` at the one read site in the routing service. |
| v2 URL, unknown `profile` (hand-edited, or a future value) | Loads with a warning, falls back to `"foot"`. Never rejected — `parseTour` only hard-fails on an unknown *schema version*. |
| v1 URL (flat `stops[]`) | Unaffected. `migrateV1ToV2` wraps stops in one default route, which then takes the default profile. |
| New URL opened by an **old deployed build** | Loads. `routeSchema` is a non-strict `z.object`, so the unknown `profile` key is stripped and the tour renders with straight lines. |

The last row is why the version stays at 2: GitHub Pages caches aggressively, and a
version bump would turn every freshly shared link into "saved by a newer version of the
app" for anyone holding a stale bundle.

**Default is `"foot"`, not `"driving"`,** even though the Chicago reference is a bus tour.
Walking tours are the common case for a hand-built brochure; the reference tour sets
`driving` explicitly on all three routes. Absent means foot.

### Caching

Recompute-on-load is only acceptable if it happens once. Required behaviour for
t_2c1641fe / t_5b1e3e49:

- **Key:** a stable hash of `profile` + the ordered stop coordinates rounded to 5 decimals
  (~1.1 m) + any `via` points. Route rename, recolor, or edits to stop copy must **not**
  invalidate it; moving a stop must.
- **Tier 1, in-memory `Map`** — survives re-render, panel switches, and the editor ⇄
  brochure transition. This is what makes editing feel instant.
- **Tier 2, `sessionStorage`** — survives reload and print-preview navigation within the
  tab. Session-scoped on purpose: geometry is derived data with an upstream that can
  change, and the tour itself is stored elsewhere. (At the time of writing that was the
  `localStorage` autosave; [ADR 0002](0002-url-sole-source-of-truth.md) has since moved
  the tour into the URL hash. The reasoning is unaffected: this tier caches *derived*
  data, and a `sessionStorage` cache of recomputable geometry is explicitly still allowed.)
- **Budget it:** cap the sessionStorage mirror (say 1 MB) and evict oldest-first;
  `sessionStorage` throws on quota and that must not break a render.
- **Never write geometry back into `Tour`.** The cache is keyed *off* tour data and lives
  beside it. If geometry enters the `Tour` object it will reach `serializeTour`, and the
  measurements above become a bug report.

### Endpoint constraint discovered while measuring

The same probe is in the script, because it changes what `profile` must mean:

| Host | Path profile | Result, Sheraton → Michigan Ave Bridge |
|---|---|---|
| `router.project-osrm.org` | `/foot/` | 611 m, 138 s, `weight_name: routability` |
| `router.project-osrm.org` | `/bike/` | 611 m, 138 s, `weight_name: routability` |
| `router.project-osrm.org` | `/driving/` | 611 m, 138 s, `weight_name: routability` |
| `routing.openstreetmap.de/routed-foot` | `/foot/` | **1,647 m, 1,317 s** |
| `routing.openstreetmap.de/routed-bike` | `/bike/` | **537 m, 241 s** |
| `routing.openstreetmap.de/routed-car` | `/driving/` | 611 m, 138 s |

**The OSRM demo server hosts only the car graph.** It answers `/foot/` and `/bike/` with
HTTP 200 and an `Ok` code, and silently returns the driving route — the failure mode is a
wrong answer, not an error. Since the chosen default is `foot`, a routing service pointed
at the demo server would send pedestrians down Lower Wacker and never report a problem.

Therefore `profile` maps to a **(host, path)** pair, not a path segment:

| `profile` | Endpoint |
|---|---|
| `foot` | `https://routing.openstreetmap.de/routed-foot/route/v1/foot/…` |
| `bike` | `https://routing.openstreetmap.de/routed-bike/route/v1/bike/…` |
| `driving` | `https://routing.openstreetmap.de/routed-car/route/v1/driving/…` (demo server acceptable as a secondary) |

Binding on t_5b1e3e49 (routing service module). Both hosts are rate-limited community
services with no SLA; treat failure as expected, per the fallback rule below.

## Consequences

Accepted costs:

- **Network at view time.** A shared brochure needs one request per route to draw real
  streets. This weakens "the URL is the whole artifact" — the URL is now the whole
  *authored* artifact, with rendering fidelity dependent on a third party.
- **Offline and cold-cache views degrade.** Straight dashed lines plus the "approximate
  route" indicator (t_2c1641fe). Never blank routes, never a blocked render.
- **Print is not deterministic by construction.** The Print button must wait for geometry
  to settle before `window.print()`, exactly as it already waits for tile idle (SPEC §6).
  A print taken on a dead network prints approximate lines, and must say so in the legend.
- **Dependence on a community endpoint.** Rate limits and outages are someone else's
  schedule. Mitigated by session caching, debounced refetch, and the fallback — not
  eliminated.

Bought:

- Share URLs stay at ~65 % of the ceiling for a 36-stop, 3-route tour, leaving room for the
  author copy that actually makes a brochure worth sharing.
- URL length stays proportional to *authored content*, not to how far the bus drives.
- Geometry improves when OSM data improves; a stored polyline would be frozen at the moment
  of sharing.

### Revisit if

- Print or offline determinism becomes a hard requirement → build the self-contained export,
  don't lengthen the URL.
- A tour legitimately exceeds the budget on option B → the fix is trimming copy or an
  export path; the measurements above show descriptions are 30 % of the payload.
- Both public endpoints become unusable → the decision to revisit is "which service",
  not "store geometry". A still does not fit.

## Reproducing

```bash
node scripts/measure-share-url.mjs            # live OSRM, rewrites 0001-measurements.json
node scripts/measure-share-url.mjs --offline  # replay the committed report
```

The script hits the public demo server a dozen times with pauses between calls. It is
deliberately **not** part of `pnpm test` or CI — these are rate-limited community services.

Note on reproducibility: the committed report uses deterministic stop ids
(`stop_green_01`), which compress better than the app's random `newId()` values. With real
runtime ids the same tour measures ~5,615 URL characters instead of 5,195 — still
comfortably inside the budget, and option A moves in the same direction (~11,900, still
~49 % over the ceiling). Stop ids are ~7 % of the payload, which is a cheap future saving
if a tour ever crowds the ceiling.
