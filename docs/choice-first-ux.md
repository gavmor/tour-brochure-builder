# Choice-first UX — design spec

**Epic:** Choice-first UX (t_f3a98cf7) · **Base app:** Tour Brochure Builder (t_442984bb)
**Status:** spec (implementation-ready) · **Scope:** static GitHub Pages site, Preact + Vite + Leaflet/OSM, **no backend**, all tour state serialized into the share URL.

## Design principle (the thing every decision must satisfy)

AI-generated UIs over-rely on blank text inputs. This app instead presents **choices that are already made** and lets the user back out of them by **clearing, deleting, or editing**. The screen is never empty and never demands typing to become useful. Every seeded value is a real, first-class, reversible object — not a locked placeholder.

Three rules derived from the principle, referenced throughout:

- **R1 — Never blank.** A fresh visit renders a complete, usable tour. No empty map, no required text field blocking progress.
- **R2 — Always reversible.** Everything seeded or defaulted can be cleared, deleted, or edited with the same affordances as user-created data. No "locked" or "system" flag.
- **R3 — Pick, don't type.** Where a sensible option set exists, the user selects from presets (chips, swatches, lists, map clicks). Free text is the rare exception (§5), and even then it is pre-filled.

---

## 1. Starter experience decision

**Open question:** On first visit / empty tour, do we (a) ship a static curated starter template, (b) run Overpass on load to propose nearby sites, or (c) both?

**Decision: (a) — a static curated starter template loads on first visit. CONFIRMED.** Overpass is **not** called on load; it is an explicit, on-demand "Add sites near a location" action (§2).

### Rationale

- **Instant & deterministic (R1).** A bundled template renders with zero network round-trips. Overpass-on-load would show a spinner, can time out or rate-limit, and would make first paint non-deterministic — the opposite of "a choice already made."
- **Offline & print-correct.** The app is a brochure builder; print output must render deterministically. A static template guarantees the same brochure every time, offline, and in the print path. Overpass results vary run-to-run as OSM data changes.
- **Respects OSM usage policy.** Hitting Overpass on every cold load (including bots/crawlers of a public Pages site) is abusive volume. On-demand keeps us well inside policy.
- **URL-as-state stays clean.** First load has **no** URL params and still shows a full tour. A shared URL deterministically reconstructs the exact tour; it never silently re-queries Overpass to "refresh" content.

### What ships as the starter template

- Reuse the **existing Chicago reference stops** as `starterTour` — a small, hand-curated, ordered set of real stops (name, blurb, coords, category, icon), plus default route profile and color.
- It is a **plain tour object**, identical in shape to any user tour. It is seeded into state on first load **only when there is no tour in the URL**. The moment the user edits/clears/adds, it is just their tour.
- Shipped as a static JS/JSON module imported at build time (e.g. `src/data/starterTour.ts`). No fetch.

### Load precedence (deterministic)

1. **URL has tour state** → decode and render that tour. (Shared/bookmarked brochure. Starter is ignored.)
2. **No URL state, localStorage has a tour** → render the user's last session (R1: returning user resumes).
3. **No URL state, no localStorage** → seed `starterTour` into state and render it (first-ever visit).

> localStorage is a convenience cache only; the URL remains the single source of truth. "Reset to starter" (a top-level action) clears the URL + localStorage tour and re-seeds `starterTour`.

---

## 2. "Add sites near a location" flow

An explicit action (toolbar button **"➕ Add sites near a location"**), never automatic. It proposes POIs from OSM, **all pre-selected**, and the user trims the set (R3).

### Steps

1. **Choose a center.** Three ways, all preset-first:
   - Default proposal: the **current map center** is offered as the center ("Search around *here*") — a choice already made (R1/R3). One tap accepts it.
   - Or type a city/place → geocoded via **Nominatim** (`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5`), results shown as a **pick-list of candidates** (not a raw text commit). User picks one.
   - Or **drop a center pin** by clicking the map.
2. **Propose sites.** Query **Overpass** around the center (parameters below). Results render as a scrollable list **with every item checked**, plus provisional numbered markers on the map.
3. **Deselect.** User unchecks the ones they don't want. "Select all / none" shortcut provided. Live count: "7 of 12 selected."
4. **Confirm.** Kept sites are appended as **normal Stops** (§4) — fully editable, deletable, reorderable, indistinguishable from any other stop. Unkept proposals are discarded.

### Defaults & parameters

| Parameter | Default | Notes |
|---|---|---|
| **N (proposed sites)** | **12**, capped | Rank by presence of `name` tag, then `wikidata`/`wikipedia` tag, then proximity to center. Drop unnamed nodes. If Overpass returns >12 keep the top 12; if <12 keep all. |
| **OSM categories** | `tourism=attraction`, `tourism=museum`, `historic=*`, `tourism=viewpoint` | Union of all four. `historic=*` matches any value. |
| **Search shape** | **radius 1500 m** around center (`around:1500,lat,lng`) | Walkable-tour scale. If a geocoded place carries a `boundingbox`, offer "search this whole area" using that bbox instead of the radius (optional secondary action). |
| **Query timeout** | `[timeout:25]` in Overpass QL | Matches the error state below. |
| **Endpoint** | `https://overpass-api.de/api/interpreter` | POST the QL body. |
| **De-dupe** | Drop proposals whose name+coords match an existing stop within ~25 m | Avoid re-adding a stop the user already has. |

**Overpass QL (center = lat,lng, radius 1500):**

```
[out:json][timeout:25];
(
  node["tourism"="attraction"](around:1500,{lat},{lng});
  node["tourism"="museum"](around:1500,{lat},{lng});
  node["historic"](around:1500,{lat},{lng});
  node["tourism"="viewpoint"](around:1500,{lat},{lng});
  way["tourism"="attraction"](around:1500,{lat},{lng});
  way["tourism"="museum"](around:1500,{lat},{lng});
  way["historic"](around:1500,{lat},{lng});
  way["tourism"="viewpoint"](around:1500,{lat},{lng});
);
out center tags 60;
```

> `out center` returns a representative lat/lng for ways; request 60 raw then rank down to N=12.

### Category → app category/icon mapping

| OSM tag | App category (§3) | Icon |
|---|---|---|
| `tourism=museum` | Museum | 🏛️ |
| `historic=*` | Historic | 🏰 |
| `tourism=viewpoint` | Viewpoint | 🌄 |
| `tourism=attraction` | Attraction | ⭐ |
| (fallback / unknown) | Point of interest | 📍 |

### UI states

- **Loading.** Non-blocking panel: skeleton rows + "Finding notable sites near *{place}*…", a cancel button, and the map still interactive. Debounce Nominatim typing (≥500 ms) and never fire more than one in-flight Overpass request.
- **Empty (0 results).** "No notable sites found within 1.5 km of *{place}*." Offer: **widen the search** (bump radius to 5 km, one tap) · **move the center pin** · **add a stop by clicking the map**. Never a dead end (R1).
- **Error / timeout / rate-limited.** "Couldn't reach OpenStreetMap right now." Offer **Retry** and, for 429/timeout, suggest trying again shortly. The existing tour is untouched. Nominatim and Overpass failures are reported separately so the user knows which step failed.
- **Partial / truncated.** If results were capped, footnote: "Showing the 12 most notable — widen or move the center for others."

### Usage-policy compliance

- Attribution: "© OpenStreetMap contributors" on the map (already required by Leaflet/OSM) and a line crediting Nominatim/Overpass in the About/credits.
- Debounce geocoding input; cache both Nominatim and Overpass responses in-session (keyed by normalized query / rounded center+radius) so re-opening the panel doesn't re-query.
- Set a descriptive `Referer`/`User-Agent` where the browser allows; one in-flight request at a time; no automatic/background polling.

---

## 3. Preset controls

Every control below ships with (i) a defined **option set**, (ii) a **default already selected**, and (iii) a **reset/clear affordance**. None is a free text box.

### 3a. Route profile — segmented control / chips

- **Options:** `walking` · `driving` · `cycling` (exactly these three; they map to future OSRM profiles and to polyline styling).
- **Control:** segmented control (single-select chips). Always exactly one selected — there is no "unset."
- **Default:** inherited from the tour (starter template default = **walking**).
- **Reset:** a "Reset to default" affordance on the route panel returns it to **walking**. (There is no "clear to empty" — a route always has a profile.)
- **Effect:** choice is cosmetic for the smoke scope (polyline style/label); semantics reserved for real routing later.

### 3b. Route color — swatch palette

- **Options (10 accessible swatches):** chosen for contrast against OSM tiles and for mutual distinguishability (incl. for common color-vision deficiencies); each ≥3:1 against the basemap. Palette (hex, index 0–9):

  | idx | name | hex |
  |---|---|---|
  | 0 | Crimson | `#E6194B` |
  | 1 | Orange | `#F58231` |
  | 2 | Amber | `#FFC000` |
  | 3 | Green | `#3CB44B` |
  | 4 | Teal | `#008080` |
  | 5 | Blue | `#4363D8` |
  | 6 | Indigo | `#4B0082` |
  | 7 | Magenta | `#911EB4` |
  | 8 | Brown | `#9A6324` |
  | 9 | Slate | `#2F4858` |

- **Control:** swatch grid (single-select). Selected swatch shows a ring + checkmark (not color alone — accessibility).
- **Default:** tour default (starter = index **5, Blue**).
- **Custom escape hatch:** **included** — it is cheap. A native `<input type="color">` tucked behind a "Custom…" affordance. When used, the route color serializes as a full hex (see §6); otherwise it serializes as the 1-char palette index. Keep the palette primary; custom is secondary.
- **Reset:** "Reset color" returns to the tour default palette index (5).

### 3c. Stop category / icon — preset list

- **Options (category → icon):**

  | category id | label | icon |
  |---|---|---|
  | `attraction` | Attraction | ⭐ |
  | `museum` | Museum | 🏛️ |
  | `historic` | Historic | 🏰 |
  | `viewpoint` | Viewpoint | 🌄 |
  | `food` | Food & drink | 🍽️ |
  | `nature` | Park / nature | 🌳 |
  | `shop` | Shop | 🛍️ |
  | `transit` | Transit | 🚉 |
  | `poi` | Point of interest | 📍 (default) |

- **Control:** dropdown/list of icon + label; marker on the map reflects the icon.
- **Default:** `poi` (📍) for a hand-added stop; POIs added via §2 are pre-set from the OSM mapping.
- **Reset:** "Reset category" → `poi`.

### 3d. Stop add — choose from proposed POIs or click the map

- **Primary ways to add a stop:**
  1. **"Add sites near a location"** (§2) — pick from pre-selected proposals.
  2. **Click the map** — drops a stop at the clicked point, pre-named (reverse-geocoded via Nominatim when available, else "Stop N"), category `poi`.
- **Manual lat/lng entry is REMOVED from the primary UI.** No coordinate text boxes. (Editing an existing stop's position is done by **dragging its marker**; a precise numeric editor may live behind an "advanced" disclosure but is out of the primary flow and out of smoke scope.)
- **Reset/clear:** a stop is removed with its **Delete** affordance (§4); there is no separate "clear coordinates."

---

## 4. Reversibility rules

- **R2 applies to everything.** Every seeded stop, default profile, default color, default category, and generated title/blurb is **clearable, deletable, or editable**.
- **Seeded == user-created.** A stop from the starter template or from Overpass is the **same object shape** as a hand-added stop. Same edit form, same delete button, same drag-to-move, same reorder handle, same category/icon control. **No `locked`, `seeded`, `system`, or `readonly` flag exists on a stop.** (An ephemeral `proposedFrom: 'overpass'` marker may exist *only* on the pre-confirm proposal list in §2; once confirmed into a Stop it is dropped.)
- **Tour-level reset.** "Reset to starter" (clears to the curated template) and "Clear tour" (empties to a minimal 1-stop or truly empty state) are both available; "Clear tour" is reversible via undo within the session and never auto-fires.
- **Undo.** Deleting a stop offers a transient **Undo** (toast) within the session. Reordering and edits are likewise session-undoable where cheap.
- **No destructive surprise.** Re-running §2 **appends**; it never replaces or wipes existing stops.

---

## 5. Free-text policy

Free text is allowed **only** for:

1. **Stop blurb / description** — seeded with a default: the OSM `name`/`description` tag when available, else "" with a visible placeholder prompt (but an empty blurb is valid; the brochure just omits it).
2. **Tour title and tagline** — seeded with defaults: title = starter template title (or "{City} Tour" when created via §2), tagline = a generated line (e.g. "{N} stops · {profile} route").

Everything else (profile, color, category/icon, coordinates, add-method) is **preset or map-driven**, never a blank field. Where a free-text field is offered it is **pre-filled with a sensible default** the user can accept, edit, or clear — editing a good default, not confronting a blank box.

---

## 6. URL-state implications

All tour state already serializes to the share URL (base app). This epic adds three per-object fields plus per-tour defaults. Keep it **compact** so brochures with many stops stay under practical URL limits.

### New fields

| Field | Scope | Values | Serialized as |
|---|---|---|---|
| **profile** | tour (route) | `walking`/`driving`/`cycling` | 1 char: `w` / `d` / `c` |
| **color** | tour (route) | palette index 0–9, or custom hex | `0`–`9` (palette) **or** `#RRGGBB` → stored as 6 hex chars prefixed `x` (e.g. `xE6194B`) |
| **category** | per stop | category id (§3c) | 1 char code: `a`=attraction, `m`=museum, `h`=historic, `v`=viewpoint, `f`=food, `n`=nature, `s`=shop, `t`=transit, `p`=poi (default) |

### Serialization rules

- **Omit defaults.** Don't emit `profile` when it equals `walking`, `color` when it equals the default index `5`, or a stop `category` when it equals `p` (poi). Decoder fills defaults on absence. This keeps the common case byte-free.
- **Stop encoding.** Extend the existing per-stop tuple with a trailing optional `category` char. Suggested compact per-stop record (pipe/comma-delimited inside the existing stops param), ordered `lat,lng,category?,name?,blurb?`; numeric fields rounded to 5 decimals (~1 m). Omit trailing empty fields.
- **Color.** If palette index → single char `0`–`9`. If custom → `x` + 6 hex (uppercase, no `#`). Decoder: leading `x` ⇒ custom hex; single digit ⇒ palette index.
- **Compression.** Keep the base app's existing scheme (recommended: JSON → LZ-based compress → URL-safe Base64 in a single `?t=` / `#t=` param). The three new fields add at most ~1 char/stop (category) + ~2 chars/tour (profile+color), negligible under compression. **Prefer the hash fragment (`#t=`)** for the tour blob so it isn't sent to the Pages server and has a larger practical length budget.
- **Backward/forward compatible.** Missing new fields decode to defaults; unknown category chars decode to `poi`. Never throw on an unrecognized field — degrade to default (R1: still renders a tour).

### Example

`#t=` → decoded tour: `{title, tagline, profile:'c', color:3, stops:[{lat,lng,category:'m',name,blurb}, …]}`
Route is cycling, green; first stop is a museum. A tour using all defaults (walking, blue, poi stops) emits none of the three new fields.

---

## Acceptance checklist (maps to task criteria)

- [x] **Doc exists** at `docs/choice-first-ux.md`.
- [x] **Every control has an option set + reset behavior** — §3a profile (reset→walking), §3b color (reset→index 5, custom hatch included), §3c category (reset→poi), §3d add (delete to remove; no lat/lng box).
- [x] **Open question has an explicit answer** — §1: static curated starter template on load, Overpass on-demand only. Confirmed with rationale.
- [x] **Implementation tasks can proceed without guessing** — N=12, radius 1500 m, exact Overpass QL + categories, Nominatim endpoint, state machine for loading/empty/error, palette hex table, category↔icon map, URL field codes and omit-default rules all specified.

## Handoff notes for implementers

- **t_d7de7a2a (static starter):** build `starterTour` from the existing Chicago reference stops as a plain tour object (no `locked` flags); wire the §1 load-precedence (URL → localStorage → starter) and a "Reset to starter" action.
- **t_0e197ca6 (POI proposal flow):** implement §2 exactly — Nominatim pick-list geocode, the Overpass QL above, N=12 ranking, all-preselected trim list, the three UI states, append-not-replace, de-dupe, in-session caching + debounce.
- **t_4c696e9d (choice-first controls):** implement §3 controls and §6 serialization; remove manual lat/lng from the primary UI; keep marker-drag + map-click add.
- **t_9f25df7e (verify):** check against the acceptance checklist and R1–R3.
