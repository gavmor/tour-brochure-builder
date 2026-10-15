# Tour Brochure Builder

Interactive tour brochure authoring with Leaflet and OpenStreetMap.

Layout, sharing and data decisions live in [`docs/SPEC.md`](docs/SPEC.md).

## Local development

```
pnpm install
pnpm dev          # starts Vite dev server (http://localhost:5173)
pnpm build        # production build → dist/
pnpm preview      # preview the production build locally
pnpm typecheck    # run TypeScript type checking
pnpm lint         # run Biome linter
pnpm test         # run the Vitest suite once
pnpm test:watch   # re-run tests on change
```

## Tour data and state (`src/tour/`)

There is no backend, and **no localStorage**: a tour lives in browser memory,
in the URL hash, or in an exported `.json` file. The URL is the single source
of truth — see [ADR 0002](docs/adr/0002-url-sole-source-of-truth.md).

| File | What it holds |
|------|---------------|
| `schema.ts` | The `Tour → Route[] → Stop[]` model (schema `version: 2`), factories, the route palette, and `stopBlurb` (SPEC D6 itinerary fallback). |
| `validate.ts` | `parseTour` / `parseTourJson`: validation, graceful repair, and the `version: 1 → 2` migration. Never throws. |
| `store.ts` | Preact signals (`tour`, `readOnly`, `activeRouteId`, `selectedStopId`, `shareLink`, …), every action, and the URL writer (`startUrlSync`). |
| `debounce.ts` | The debounce the URL writer coalesces keystrokes with. |
| `urlShare.ts` | lz-string encode/decode, `#view&t=…` hash parsing, and `replaceLocationHash`. |
| `files.ts` | `.json` download and upload. |

```ts
import { addStop, initStore, reorderStops, shareLink, tour } from "./tour";

initStore();                                  // called once in main.tsx
addStop({ lat: 41.88, lng: -87.62, title: "Skydeck" });
reorderStops(2, 0);                           // within the active route
console.log(tour.value.title, shareLink.value.url);
```

### Schema

```jsonc
Tour  { version: 2, id, title, subtitle?, tagline?, description?, routes: Route[], settings? }
Route { id, name, color, stops: Stop[], via?: [number, number][], profile?: "foot" | "bike" | "driving" }
Stop  { id, lat, lng, title, blurb?, description?, imageUrl? }
```

Array order is itinerary order, and a stop's printed number is its index
**within its route**, so numbering restarts at 1 for each route (SPEC D5).
A `version: 1` tour (flat `stops[]`) is migrated by wrapping the list in one
default route.

`Route.profile` selects the road-routing profile and is **optional — absent
means `"foot"`**, so share URLs made before it existed keep loading unchanged
([ADR 0001](docs/adr/0001-route-geometry-storage.md)). Road geometry itself is
never serialized: it is recomputed at view time and cached for the session,
because storing it would be 143 % of the share-URL ceiling.

Imported data is repaired where it can be (missing ids and titles are
generated, unusable stops and non-`https:` image URLs are dropped, each with a
warning in `lastLoadNotice`) and rejected only when it is not an object, is a
newer schema version, or is not valid JSON.

### Load order and sharing

The URL hash is the only place a tour lives. On startup `initStore()` applies,
in order:

1. a `#t=` / `#view&t=` share link in the URL hash,
2. the curated Chicago starter template,
3. a blank tour (only when no template is injected).

There is no localStorage step, so **a bare URL always opens the starter** — a
returning visitor can never land on a blank map because of something an older
build wrote. A stale `tour-brochure-builder:tour` key left over from before is
simply ignored; nothing reads or writes it.

Every mutation — add/move/delete/reorder a stop, a text edit, a route change —
is re-encoded into the hash and written with `history.replaceState`, debounced
by 300 ms so a burst of keystrokes costs one write. `replaceState` (never
`pushState`) keeps the history stack flat: editing does not fill up the Back
button. While the working tour still equals the starter template byte for byte
there is no diff to record, so the hash stays empty.

Clearing the hash throws the work away: the hash watcher resets the store to
the starter template. The app's own writes cannot trigger that — `replaceState`
does not fire `hashchange`, and the writer additionally ignores an echo of the
hash it just wrote.

`#view` opens the tour **read-only** (SPEC D2): mutating actions are refused
and the URL writer is suppressed, so opening someone else's link never rewrites
it. `editCopy()` clones the viewed tour under a fresh `tour.id`, unlocks
editing, and immediately takes over the address bar as an editable `#t=` link —
the original `#view` link keeps working, because nothing shared is mutated.

Share URLs are lz-string-compressed and have a practical ceiling around 8,000
characters (SPEC §6). The store exposes `shareEncodedLength`, `shareUrlLength`
and `shareUrlWarning` (`"ok" | "warn" | "too-long"`), recomputed from the live
tour — which is to say, from what is in the address bar — so the UI can warn
above 6,000 instead of emitting a link that silently truncates.

## Map editor (`src/editor/`)

The editing surface: a Leaflet map beside an itinerary sidebar. Leaflet is
driven directly through `useRef`/`useEffect` — react-leaflet needs the
preact/compat alias and the direct API is a better fit anyway, since the store
is the source of truth and the effects just reconcile layers against it, keyed
by id (so typing in the title field does not tear down every marker).

| File | What it holds |
|------|---------------|
| `Editor.tsx` | Shell: tour title/subtitle/tagline, Add-stop and Fit controls, read-only banner. |
| `MapEditor.tsx` | The Leaflet map: tiles, markers, one polyline per route, shape handles, bounds fitting. |
| `NearbyPanel.tsx` | "Add sites near a location": the pre-selected proposal checklist (see below). |
| `Itinerary.tsx` | Per-route stop lists: SortableJS drag-reorder, up/down buttons, delete. |
| `StopPanel.tsx` | Edit panel for the selected stop: title, blurb, description, image URL + preview, coordinates, route. |
| `RoutePanel.tsx` | Add / rename / recolor / delete a route and toggle shape points. |
| `leafletSetup.ts` | OSM tile layer options and the Vite default-icon fix. |
| `markers.ts` | Numbered badge `divIcon` and `safeColor` sanitising. |
| `shape.ts` | Polyline vertices, weaving `Route.via` shape points into the right segment. |

What an author can do:

- **Add** — press *Add stop*, then click the map (it stays armed for several
  stops; <kbd>Esc</kbd> disarms). With the map focused, <kbd>Enter</kbd> adds a
  stop at the centre of the view.
- **Move** — drag a marker, or type coordinates in the edit panel.
- **Reorder** — drag an itinerary row by its grip, or use the ↑/↓ buttons
  (the buttons exist so reordering is not mouse-only). Dragging a row onto
  another route's list moves the stop between routes.
- **Edit** — click a row or a marker; the two selections are two-way, and the
  map pans to the stop while the row scrolls into view.
- **Routes** — numbering restarts at 1 per route, each route draws its own
  polyline in its own color, and the *Show* checkbox hides one from the map.
- **Shape points** (SPEC D4) — v1 draws straight segments, with no routing
  service. Turn on *Shape points* and <kbd>Shift</kbd>-click the active route's
  line to drop a handle, drag it to bend the line, <kbd>Shift</kbd>-click it to
  remove it. They are stored as `Route.via` and woven into the nearest segment,
  so reordering stops re-flows them instead of scrambling the line.

Image URLs are `https:`-only (SPEC D3) — a non-`https` value is reported and
never written to the store. The preview is lazy, sent with
`referrerpolicy="no-referrer"`, in a fixed 16:9 box, and collapses with an
explanation if the image fails to load.

The OSM attribution is part of the tile layer, so it is present wherever the
map is: it is a licence term, not decoration. Tile `maxZoom` is 19 and nothing
prefetches tiles.

## "Add sites near a location" (`src/poi/`)

The choice-first way to fill a tour: instead of typing coordinates, name a
place (or drop a pin on the map) and get up to twelve notable OpenStreetMap
sites back **already selected** — untick the ones you do not want and press
*Add*. Accepted proposals go through the store's ordinary `addStop()`, so they
are indistinguishable from stops placed by hand: same edit, delete, reorder and
share-URL behaviour, with no `seeded`, `locked` or `source` flag anywhere.

| File | What it holds |
|------|---------------|
| `osm.ts` | Pure: bbox maths, the Overpass QL, Nominatim parsing, ranking/dedupe, and the OSM-tags → `StopCategory` mapping. No fetch, no DOM. |
| `net.ts` | Fetch, cancellation, timeouts, the Nominatim rate gate, session caching, mirror fallback and the outage memo. |
| `curated.ts` | The offline fallback, derived from the curated starter tour so the two cannot drift. |

Everything the free OSM services oblige us to do is in this layer, not left to
the UI:

- **On demand only.** Nothing is queried on load — a first visit renders the
  curated starter with zero network calls (`docs/choice-first-ux.md` §1).
- **One request at a time**, at least 1 s between Nominatim calls, a bbox
  clamped to 0.10° (~11 km — measured: 0.25° of Porto was refused by the
  canonical instance after ~9 s, 0.10° answered in under 3 s), and
  `[timeout:25]` inside the query itself.
- **One shared deadline (20 s)** for the whole proposal step, geocode plus
  Overpass, with a visible Cancel throughout. Mirrors are **hedged, not raced**:
  the next one is only brought in after 4 s of silence, with the earlier request
  still running, and losers are aborted the moment someone answers — so a mirror
  that is merely slow still wins, and the extra load only lands when one is
  being slow. A total outage is remembered for a minute, so a repeat search
  falls back instantly instead of waiting the deadline out again.
- **Never a dead end.** Offline, rate-limited, no match, nothing found: the
  curated Chicago set appears instead, with the reason shown and a *Try
  OpenStreetMap again* button. Sites already in the tour are listed unticked as
  *Already added*, so a second search cannot silently duplicate stops.
- **Attribution** for Overpass/Nominatim is shown in the dialog, next to the
  results it applies to.

Session caching uses `sessionStorage`, keyed by the normalised query. That is a
cache for someone else's API, not app state — the tour still lives only in the
URL (ADR 0002), and losing the cache costs one refetch.

A live smoke test against the real services is kept out of CI, like the routing
one:

```sh
POI_LIVE=1 pnpm vitest run src/poi/live.test.ts
```

Run it when the endpoint list, the query or the latency budget is in doubt. A
failure there means the free OSM services were unreachable from that network —
which is the condition the curated fallback exists for, not a broken build.

## Printing (`src/brochure/`)

The brochure prints **full bleed** on US Letter landscape: `@page { size: letter
landscape; margin: 0 }`, so the CSS content box *is* the 11 in × 8.5 in sheet
and the map, the cream itinerary panel, the ribbon and every background fill run
to all four edges. There is no white frame.

The tri-fold geometry is stated once, as tokens in `brochure.css`, and is exact
rather than approximate: the three panels are `calc(11in / 3)` each (1056 px / 3
= 352 px at 96 dpi), so the folds land on 3.667 in and 7.333 in and the second
fold is exactly where the map stops and the itinerary column starts. All inner
gutters are padding *inside* a panel, so a padding change can never move a fold.

Two things deliberately stay off the trim, because they are text and a printer
would eat them:

- the legend and the OSM credit are inset by `--bleed-safe` (0.22 in). The credit
  is a tile-licence obligation, so it floats over the map's bottom-right corner
  rather than riding in a white band across the bleed edge.
- the continuation sheets (itinerary spill, stop detail cards) keep the same
  0.22 in inset. They are white on white — there is no background to bleed —
  so an inset costs nothing and running body copy into the edge would lose text.

### Printer caveat

`margin: 0` is what the CSS asks for; it is not what every device delivers. Most
physical printers have a **non-printable hardware margin** (typically 3–6 mm, and
more along the trailing edge), so a sheet from a desk inkjet will usually still
have a thin white border unless the device supports borderless printing. For
genuine edge-to-edge output:

- turn on **Borderless** / **Edge-to-edge** in the printer driver, if it has it;
- turn **off** "Fit to page" / "Shrink to fit" and keep **Scale: 100 %** — scaling
  re-introduces a margin *and* shifts the fold lines off 3.667 in / 7.333 in;
- leave **Margins: None** (Chromium) or **Default** if None is unavailable.

The reliable reference output is **Save as PDF** from Chromium with *Margins:
None*, *Scale: 100 %* and **Background graphics enabled** — without background
graphics the browser drops the fills and the brochure prints as line art. The
CSS sets `print-color-adjust: exact` on the brochure root and on every element
that carries a fill, which covers the engines that honour it, but Chromium's
checkbox still wins.

### How the print flow works

A Leaflet map cannot simply be handed to `window.print()`: tiles are async, so a
naive print snapshots a half-grey map. `printing.ts` stages the sheet into its
print geometry *on screen* first, lets the map re-measure
(`map.invalidateSize()`) and request tiles for exactly the box that will be
printed, waits for tiles and lazy images to settle (both bounded), measures
where the itinerary column overflows so the tail prints on a continuation sheet
instead of being clipped, and only then prints. Ctrl+P bypasses the button and
gets a best-effort version of the same staging via `beforeprint`.

## Deployment

Pushes to `main` automatically deploy to GitHub Pages via the workflow in
`.github/workflows/deploy.yml`. The workflow:
1. Installs dependencies with `pnpm install --frozen-lockfile`
2. Runs `pnpm build` (includes typecheck)
3. Uploads `dist/` as a Pages artifact and deploys

The live site is at `https://<owner>.github.io/<repo-name>/`.

### Changing the base path

The Vite `base` config controls the URL prefix for all assets. It defaults to
`/tour-brochure-builder/` in `vite.config.ts`. To change it:

- **Edit the constant:** change `REPO_NAME` in `vite.config.ts`
- **Or set at build time:** `VITE_BASE=/my-other-path/ pnpm build`

### SPA fallback

GitHub Pages returns a 404 for deep-link URLs that don't match a real file.
A Vite plugin copies `index.html` to `404.html` at build time, so GitHub Pages
serves the app shell for any route, enabling client-side routing.

## Stack

- [Preact](https://preactjs.com/) + [@preact/signals](https://preactjs.com/guide/v10/signals/) — UI and state
- [Vite](https://vite.dev/) — build tool
- [Vitest](https://vitest.dev/) — tests
- [Leaflet](https://leafletjs.com/) + OpenStreetMap — map rendering
- [SortableJS](https://sortablejs.github.io/Sortable/) — itinerary drag-reorder
- [zod](https://zod.dev/) — runtime validation
- [lz-string](https://pieroxy.net/blog/pages/lz-string/index.html) — share-URL compression
- [Biome](https://biomejs.dev/) — linting
- pnpm — package manager
- GitHub Pages — hosting
