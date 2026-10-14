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

There is no backend. A tour lives in browser memory, in `localStorage`, in an
exported `.json` file, or in a share URL.

| File | What it holds |
|------|---------------|
| `schema.ts` | The `Tour → Route[] → Stop[]` model (schema `version: 2`), factories, the route palette, and `stopBlurb` (SPEC D6 itinerary fallback). |
| `validate.ts` | `parseTour` / `parseTourJson`: validation, graceful repair, and the `version: 1 → 2` migration. Never throws. |
| `store.ts` | Preact signals (`tour`, `readOnly`, `activeRouteId`, `selectedStopId`, `shareLink`, …) and every action. |
| `persistence.ts` | Debounced `localStorage` autosave and restore. |
| `urlShare.ts` | lz-string encode/decode and `#view&t=…` hash parsing. |
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
Route { id, name, color, stops: Stop[], via?: [number, number][] }
Stop  { id, lat, lng, title, blurb?, description?, imageUrl? }
```

Array order is itinerary order, and a stop's printed number is its index
**within its route**, so numbering restarts at 1 for each route (SPEC D5).
A `version: 1` tour (flat `stops[]`) is migrated by wrapping the list in one
default route.

Imported data is repaired where it can be (missing ids and titles are
generated, unusable stops and non-`https:` image URLs are dropped, each with a
warning in `lastLoadNotice`) and rejected only when it is not an object, is a
newer schema version, or is not valid JSON.

### Load order and sharing

On startup `initStore()` applies, in order:

1. a `#t=` / `#view&t=` share link in the URL hash,
2. the autosaved tour in `localStorage`,
3. a blank tour.

`#view` opens the tour **read-only** (SPEC D2): mutating actions are refused
and autosave is suppressed, so opening someone else's link can never overwrite
your own working tour. `editCopy()` clones the viewed tour under a fresh
`tour.id`, unlocks editing, and saves it as the working tour. A share link
pasted into the address bar of an already-open app is picked up by the hash
watcher.

Share URLs are lz-string-compressed and have a practical ceiling around 8,000
characters (SPEC §6). The store exposes `shareEncodedLength`, `shareUrlLength`
and `shareUrlWarning` (`"ok" | "warn" | "too-long"`) so the UI can warn above
6,000 instead of emitting a link that silently truncates.

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
- [zod](https://zod.dev/) — runtime validation
- [lz-string](https://pieroxy.net/blog/pages/lz-string/index.html) — share-URL compression
- [Biome](https://biomejs.dev/) — linting
- pnpm — package manager
- GitHub Pages — hosting
