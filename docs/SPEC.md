# Tour Brochure Builder — Layout & Open-Question Spec

Status: v1 draft · Owner: pm · Task: t_913a080e · Date: 2026-10-14
Source of truth for: layout target, sharing mode, images, route lines, data shape.

Reference artifact: `reference-chicago-downtown-tour.jpg`, attached by Gavin to the root
task **t_442984bb**. It was attached — it did not need to be chased. Decision D1 below is
taken from the image itself plus Gavin's accompanying comment, so **D1 is confirmed, not
provisional**. D2–D4 are recommended defaults Gavin has not ruled on and are marked
**PROVISIONAL**.

---

## 1. Decisions

| # | Question | Decision | Status |
|---|----------|----------|--------|
| D1 | Layout target | Three-column, US Letter **landscape** tri-fold. Map spans the left two columns; itinerary occupies the right column. Full detail in §2–§4. | **Confirmed** (Gavin's reference + comment) |
| D2 | Static vs. live | Shared links open **read-only** in brochure view. A `Make a copy / Edit` action clones the tour into the editor under a new id. | PROVISIONAL |
| D3 | Images | **URL-only.** No upload backend, no bundled assets. | PROVISIONAL |
| D4 | Route lines | **Straight polylines** in v1, one per route, colored per route. Road-snapped routing (OSRM/GraphHopper) deferred. | **SUPERSEDED** by Gavin on t_d408c860 — routes must follow streets. Storage settled in [ADR 0001](adr/0001-route-geometry-storage.md): geometry is recomputed on load, never stored in the share URL. |
| D5 | Data shape *(forced by D1)* | `Tour → Route[] → Stop[]`. Numbering restarts at 1 within each route. **Supersedes the flat `Tour.stops[]` in card t_f9d14b37.** | **Confirmed** (implied by Gavin's comment) |
| D6 | Stop copy has two lengths | `Stop.blurb` (one line, itinerary) and `Stop.description` (paragraph, detail card). | PROVISIONAL |
| D7 | Where state lives | **The URL hash, and nowhere else.** No `localStorage`. Boot order: hash → starter template → blank; every mutation rewrites the hash via `replaceState`; clearing the hash returns to the starter. Rationale and costs in [ADR 0002](adr/0002-url-sole-source-of-truth.md). | **Confirmed** (Gavin, card t_0306d86f) — supersedes the localStorage-as-convenience-layer note on epic t_442984bb |

### D1 — Layout target (confirmed)

The reference is a Chicago "Downtown Tour" hop-on/hop-off brochure. Observed, in the image:

- **Format.** Landscape sheet, three panels, designed to fold. Gavin's comment fixes the
  page at **11 in landscape** → US Letter landscape, 11 in × 8.5 in, three ≈3.67 in panels.
- **Map**, left two panels, full-bleed with no gutter between them: illustrated street map
  with landmark art, water in teal, land in pale green.
- **Routes**: two polylines drawn on the map — red (north loop) and green (larger south
  loop) — following streets. Circular numbered markers in the route's own color.
  **Numbering restarts per route** (red 1–6, green 1–8); the same physical place appears
  as both "Green 1" and "Red 1" (Sheraton Hotel).
- **Legend**, white rounded box, lower-left of the map panel: three colored dots —
  GREEN ROUTE / RED ROUTE / NIGHT TOUR. Fine print below it.
- **Itinerary**, right panel, cream background:
  - red **ribbon banner** with the tour title in white caps;
  - tagline below it ("Hop on and hop off to experience both routes!");
  - a section per route: route name in the route's color, then numbered entries of
    **colored number badge + STOP NAME in bold caps + one grey line of location blurb**;
  - a hairline divider between route sections;
  - a strip of 2–3 photographs across the bottom of the panel.

Note what the reference does **not** have: no per-stop photos, no paragraph descriptions.
Its entries are one-liners. The project scope asks for cards with description and image,
so the spec carries both presentations — see D6 and §3.

### D2 — Static vs. live (provisional)

A share link is `…/#view&t=<encoded>`. It opens the brochure read-only: no map editing, no
marker drag, no edit panel, no add/delete. The header shows **Print** and
**Copy share link**, plus **Edit a copy**, which loads the decoded tour into the editor
with a fresh `tour.id` and takes over the address bar as an editable `#t=` link (D7; it
used to write the copy to localStorage, which no longer exists). The original
link keeps working, since the tour lives in the URL and nothing is mutated server-side.
Rationale: with no backend there is no auth, so an editable share link would mean anyone
with the URL silently forking the author's state inside their own browser — confusing, and
it invites "my edits vanished" bug reports. Read-only + explicit copy is honest about what
the data actually is.

### D3 — Images (provisional)

`Stop.imageUrl` is an absolute URL. Requirements: `https:` only (reject `http:` to avoid
mixed-content blocking on Pages), `loading="lazy"`, `referrerpolicy="no-referrer"`, a
fixed aspect-ratio box so layout does not jump, and `onerror` collapses the image leaving
the card text intact. No uploads, no drag-and-drop, no base64 inlining into the share URL
(it would blow the URL budget — see §6).
Known cost, accepted: images are hotlinks. They can rot, they may be blocked by the host's
referrer policy, they will not render offline, and a print taken on a bad network can lose
them. v1 accepts this; an export-to-self-contained-HTML path is the future fix.

### D4 — Route lines (provisional)

v1 draws `L.polyline` through a route's stops in order, straight segment to straight
segment, in `route.color`. **Honest gap:** the reference's routes trace streets, so a
straight-line render of a dense downtown loop will look visibly cruder than the reference —
lines will cut through blocks and across water. Two mitigations, in order of cost:
1. v1: allow optional `route.via: [lat,lng][]` shape points the author can drag in, which
   buys most of the visual fidelity with zero new dependencies and no API quota.
2. Later: OSRM public demo server or GraphHopper, snapped to roads, cached into
   `route.geometry` so the brochure stays a static artifact and does not re-fetch on view.
   Both are rate-limited external services; neither should be a hard dependency of a
   GitHub Pages build.

> **Superseded.** Gavin ruled on t_d408c860 that routes must follow streets, so (2) is now
> v1 scope rather than "later". Its *caching* proposal did not survive measurement:
> storing geometry in `route.geometry` costs 11,443 share-URL characters against an 8,000
> ceiling. [ADR 0001](adr/0001-route-geometry-storage.md) replaces it with a per-route
> `profile` field, recompute-on-load, and a session cache. `route.via` (1) is unchanged.

### D5 — Data shape (confirmed by implication)

```jsonc
Tour {
  version: 2,            // v1 = flat stops[]; migrate by wrapping in one default route
  id, title, subtitle?, tagline?, description?,
  routes: Route[],
  settings?: { pageSize?: "letter" | "a4", basemap?: string }
}
Route { id, name, color, stops: Stop[], via?: [number,number][] }
Stop  { id, lat, lng, title, blurb?, description?, imageUrl? }
```
Array order is itinerary order. Marker label = 1-based index **within the route**.
A tour with one route renders exactly like the single-route baseline, so the N=1 smoke
pass does not get harder — the editor may ship editing only the first route in v1, as long
as the schema, the store and the brochure renderer are route-plural from day one. Retrofit
cost later is a migration plus a rewrite of every marker/polyline/itinerary component;
paying it now costs one nesting level.

### D6 — Two copy lengths (provisional)

`blurb` is the one-line locator the reference uses ("Northeast corner of Columbus and North
Water, across from the NBC Tower"); it is what prints in the itinerary column. `description`
is the paragraph that appears on the detail card. If `blurb` is empty, fall back to the
first 80 characters of `description` at the nearest word boundary.

---

## 2. Print layout — page 1 (Letter landscape, 11 in × 8.5 in)

```
|<--------------------------------- 11 in ------------------------------------->|
+===============================+================+===============================+
| PANEL 1  3.67in               | PANEL 2 3.67in | PANEL 3  3.67in               |
|                               |                |  .-------------------------.  |
|                               |                | <     DOWNTOWN TOUR        >  | ribbon, tour.title
|   M A P  — spans panels 1+2, full bleed        |  `-------------------------'  |
|   no gutter between 1 and 2                    |   Hop on and hop off to       | tour.tagline
|                               |                |   experience both routes!     |
|   . OSM raster tiles          |       (2)      |                               |
|   . one polyline per route,   |                |  GREEN ROUTE ---------------- | route.name, route.color
|     stroke = route.color      |   (1)          |  (1) SHERATON HOTEL           | badge + stop.title
|   . numbered circular markers |                |      NE corner of Columbus... | stop.blurb
|     in route.color, label =   |                |  (2) MICHIGAN AVENUE BRIDGE   |
|     index within that route   |                |      NW corner of Wacker...   |
|        (3)                    |                |  (3) SKYDECK                  |
|                               |      (4)       |      On Jackson, across...    |
|                               |                |  (4) ART INSTITUTE            |
|  +---------------------+      |                |      Across from the museum   |
|  | LEGEND              |      |                |  - - - - - - - - - - - - - -  | hairline divider
|  | (o) GREEN ROUTE     |      |        (5)     |  RED ROUTE ------------------ |
|  | (o) RED ROUTE       |      |                |  (1) SHERATON HOTEL           | numbering restarts
|  | (o) NIGHT TOUR      |      |                |      NE corner of Columbus... |
|  +---------------------+      |                |  (2) NAVY PIER               |
|  small print / credits        |                |      River taxis, north side  |
|            (c) OpenStreetMap contributors      |                               |
+===============================+================+===============================+
            ^ fold                      ^ fold
```

- `@page { size: letter landscape; margin: 0; }` — the brochure prints **full bleed**:
  the content box *is* the sheet, and the map, the cream itinerary panel and every
  background fill run to all four edges. The three fold panels are exact thirds of
  the 11 in width (`calc(11in / 3)` = 3.667 in), so the folds fall at 3.667 in and
  7.333 in and the second fold is the map/itinerary boundary.
  True edge-to-edge output still depends on the printer — see README → Printing.
- Map is `height: 100%` of the content box, `break-inside: avoid`.
- OSM attribution sits bottom-right **inside** the map panel and must survive printing —
  it is a tile-licence obligation, not decoration. At zero page margin it is held
  `--bleed-safe` (0.22 in) off the trim so a non-printable hardware margin cannot
  clip it.
- Fold-safety: keep no text within 0.2 in of either fold line at x = 3.67 in and 7.33 in.
  The map tolerates folds; the itinerary column must not straddle one.
- The reference's bottom photo strip is **out of scope for v1** (see §5).

### Print — page 2+ (stop details, only if any stop has a description or image)

Itinerary one-liners rarely overflow one column; full stop cards always will. So detail
cards get their own continuation sheets, same page size, three balanced columns:

```
+===============================+================+===============================+
|  DOWNTOWN TOUR — stop details                                       page 2 / 3 |
+-------------------------------+----------------+-------------------------------+
| +---------------------------+ | +------------+ | +---------------------------+ |
| | (1) SHERATON HOTEL  GREEN | | | (3) SKYDECK| | | (5) HILTON CHICAGO        | |
| | +-----------------------+ | | | +--------+ | | | +-----------------------+ | |
| | |      image 16:9       | | | | | image  | | | | |      image 16:9       | | |
| | +-----------------------+ | | | +--------+ | | | +-----------------------+ | |
| | Description paragraph,    | | | Descrip... | | | Description paragraph...  | |
| | wrapping to a few lines.  | | |            | | |                           | |
| +---------------------------+ | +------------+ | +---------------------------+ |
| +---------------------------+ | +------------+ | +---------------------------+ |
| | (2) MICHIGAN AVE BRIDGE   | | | (4) ART... | | | (6) ADLER PLANETARIUM     | |
```

- `column-count: 3; column-gap: 0.3in`, cards `break-inside: avoid`.
- Card header carries the route-colored number badge, so a card is traceable to the map
  without flipping back.
- Stops with neither description nor image are omitted here; they live only in the
  itinerary column.

---

## 3. Screen layout

### Desktop, ≥ 1024 px

```
+--------------------------------------------------------------------------------+
| DOWNTOWN TOUR   Hop on and hop off...     [Editor] [Print] [Copy link] [Edit a copy]
+-----------------------------------------------------+--------------------------+
|                                                     |  GREEN ROUTE ----------- |
|                                                     |  (1) SHERATON HOTEL      |
|      MAP  (sticky, 100vh - header)                  |      NE corner of Col... |
|      ~64% width, mirrors the print 2:1              |  (2) MICHIGAN AVE BRIDGE |
|                                                     |      NW corner of Wac... |
|          (1)      (2)                               |  (3) SKYDECK             |
|                                                     |      On Jackson acro...  |
|                (3)                                  |  ----------------------- |
|   +------------------+                              |  RED ROUTE ------------- |
|   | (o) GREEN ROUTE  |                              |  (1) SHERATON HOTEL      |
|   | (o) RED ROUTE    |     (4)                      |  (2) NAVY PIER           |
|   +------------------+                              |      River taxis, nor... |
|              (c) OpenStreetMap contributors         |   ~36%, scrolls alone    |
+-----------------------------------------------------+--------------------------+
|  STOP DETAILS                                                                  |
|  +----------------+  +----------------+  +----------------+                    |
|  | img            |  | img            |  | img            |   3-up card grid   |
|  | (1) SHERATON   |  | (2) MICHIGAN   |  | (3) SKYDECK    |                    |
|  | description... |  | description... |  | description... |                    |
|  +----------------+  +----------------+  +----------------+                    |
+--------------------------------------------------------------------------------+
```

- Clicking an itinerary row pans/zooms the map to that stop and highlights the marker;
  clicking a marker scrolls the row into view. Both directions, both views.
- The legend doubles as a route visibility toggle on screen; it prints as a static key.

### Mobile, < 768 px

```
+----------------------+
| DOWNTOWN TOUR        |
| [Print] [Copy link]  |
| [Edit a copy]        |
+----------------------+
|        MAP           |
|       60 vh          |
|   (c) OpenStreetMap  |
+----------------------+
| (o)GREEN (o)RED      |  legend chips, horizontally scrollable
+----------------------+
| GREEN ROUTE          |
| (1) SHERATON HOTEL   |
|     NE corner of...  |
| (2) MICHIGAN AVE BR. |
+----------------------+
| STOP DETAILS         |
| +------------------+ |
| | image            | |
| | (1) SHERATON     | |
| | description...   | |
| +------------------+ |
+----------------------+
```

Breakpoints: stacked < 768 px; map-beside-list 768–1023 px at 55/45 with a shorter map;
full layout ≥ 1024 px.

---

## 4. Visual tokens

These are stand-ins, chosen to read like the reference; swap them if Gavin supplies brand
assets (see §5).

- Route colors, defaults offered in the editor's color picker:
  green `#1E8449`, red `#C0392B`, navy/night `#1F3A5F`, amber `#D68910`, violet `#7D3C98`.
  Every default was checked for ≥ 4.5:1 contrast against white for the badge text.
- Surfaces: itinerary panel `#FBF8F1` (cream), card `#FFFFFF`, hairline `#E0D9CC`.
- Ribbon banner: `#C0392B` background, white caps, with the notched tails from the
  reference rendered in CSS (clip-path), not an image.
- Type: headings `"Oswald", "Arial Narrow", sans-serif` (condensed caps, matching the
  reference's slab-ish headers); body `"Source Sans 3", system-ui, sans-serif`.
  Self-host the webfonts — Google Fonts' CDN is a third-party request and a GDPR nuisance,
  and a Pages build should be self-contained. Fall back to the system stack if a font fails.
- Number badge: 1.5 rem circle, route color fill, white bold numeral, in all three
  contexts (map marker divIcon, itinerary row, detail card header) so the three read as
  one system.

---

## 5. Unresolved — needs Gavin

Each of these is genuinely open. None blocks starting the scaffold, the store, or the
editor; the starred ones block final brochure sign-off.

1. **★ Illustrated map vs. OSM tiles — the biggest fidelity gap.** The reference map is a
   hand-illustrated, artist-drawn panel: custom landmark drawings, stylised water, hand-set
   street labels. OSM raster tiles cannot look like that. A brochure built on OSM will be
   recognisably a different, plainer product. Does Gavin accept standard OSM tiles for v1,
   or is "like this" specifically about that illustrated look? If the latter, this needs a
   vector basemap with a custom style (MapLibre + a styled tile provider), which changes
   the stack and the Leaflet decision in the root card. **Ask before the designer starts.**
2. **★ Page size.** "11 in landscape" is read here as US Letter landscape, 11 × 8.5 in.
   Confirm it is not A4 landscape (297 × 210 mm) or a true tri-fold stock with unequal
   panels (outer panels trimmed narrower so the flap tucks). Unequal panels would change
   the column math.
3. **★ "NIGHT TOUR" in the legend has no itinerary list in the reference.** Are legend-only
   routes a real feature — a route that draws on the map but prints no stop list, or appears
   in the key with no geometry at all? Affects whether `Route.stops` may be empty.
4. **Photo strip** across the bottom of the itinerary panel: is that tour content
   (`tour.gallery[]`, authored) or the print shop's decorative filler? Assumed decorative
   and dropped from v1.
5. **Brand assets.** Real fonts, logo, and exact palette. §4 is a reasoned guess.
6. **Spillover rule.** Proposed: ~12 itinerary entries fit one column at the reference's
   type size; beyond that the itinerary continues onto page 2 ahead of the detail cards.
   Confirm the cap rather than letting it silently overflow.
7. **Multi-route in the v1 editor UI.** D5 makes the *schema* and the *brochure renderer*
   route-plural. Whether the v1 **editor** lets a user create a second route, or only edits
   route 1, is a scope call. Recommendation: ship add/rename/recolor-route in v1, since the
   reference's whole point is two routes and a legend — but it is cuttable if the smoke
   pass is at risk.
8. ~~**Does "Edit a copy" need a confirm step** when it would overwrite an existing working
   tour in localStorage?~~ **Resolved by D7 / [ADR 0002](adr/0002-url-sole-source-of-truth.md):
   no. There is no localStorage slot to overwrite — the only thing a copy replaces is the
   hash currently on screen, which the user is looking at and still holds wherever they
   were sent it. The dialog is gone.

---

## 6. Constraints the implementers must respect

- **Share-URL budget.** Practical ceiling ~8 k characters before some proxies and chat
  clients truncate. With lz-string over `#t=`, 30 stops of title + blurb + description +
  image URL is near that line. The store should expose the encoded length, and the Copy
  link button should warn above 6 k rather than emit a link that silently dies.
  Since D7 the *working* URL is subject to the same budget, not just links that get sent.
- **No other store for tour state.** No `localStorage`, no cookies, no IndexedDB
  (D7 / ADR 0002). The address bar is the save file. This covers *tour state* only — a
  derived, recomputable cache (e.g. the route-geometry `sessionStorage` tier proposed in
  ADR 0001) is not tour state and is not forbidden by it.
- **OSM tile policy.** Visible `© OpenStreetMap contributors` on screen *and* in print,
  maxZoom 19, no bulk prefetch. Non-negotiable; it is the licence terms.
- **Print tile loading.** Tiles load async, so a Print button must wait for the map's
  `load`/`tileload` idle before calling `window.print()`, or the map prints half-grey.
- **No backend.** Nothing in this spec may introduce a server dependency at view time.

---

## 7. Impact on sibling cards

| Card | Change |
|------|--------|
| t_f9d14b37 (store) | Schema becomes `Tour.routes[].stops[]` per D5, `version: 2`; add `Stop.blurb` (D6), `Route.via` (D4); `#view` flag confirmed read-only (D2). Round-trip tests should cover a two-route tour. |
| t_aca4dadf (editor) | Markers number per route, not globally; one polyline per route in `route.color`; optional `via` shape points; `https:`-only image URLs (D3). |
| t_b8114d95 (brochure) | Build to §2–§4: Letter landscape, three columns, map over panels 1–2, itinerary in panel 3, legend box, ribbon banner, detail cards on continuation pages, `Edit a copy` on shared links. |
| t_9782805b (QA) | Add: a two-route tour renders correct per-route numbering and legend; print is Letter landscape, not portrait; attribution present in print. |
