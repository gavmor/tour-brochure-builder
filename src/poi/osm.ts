/**
 * "Add sites near a location" — the pure half.
 *
 * Ported from the `~/Documents/tour-builder` spike (`osm.js`, task t_0e197ca6)
 * into this app by task t_40ec912a, and adapted to the real tour model:
 * `{lat, lng}` instead of `{lat, lon}`, `title` instead of `name`, and OSM tags
 * resolved to the app's `StopCategory` presets (choice-first UX §3c). No DOM,
 * no `fetch`, no storage — all of that lives in `net.ts`, so everything here is
 * directly unit-testable.
 *
 * Why OSM at all: it is keyless and client-side, which is the whole constraint
 * (static GitHub Pages, no backend, no secrets). The usage policies that come
 * with that — a server-side `timeout:` in the query, a bbox clamp so one
 * request cannot ask for a continent, >= 1 s between Nominatim calls, and
 * visible attribution — are enforced here and in `net.ts`, not left to the UI.
 */

import {
  categoryMeta,
  isStopCategory,
  type Stop,
  type StopCategory,
} from "../tour/schema";

/** Overpass mirrors, tried in order (the first is the canonical instance). */
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
] as const;

export const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

export const DEFAULTS = {
  /** How many proposals to put in front of the user, all pre-selected. */
  topN: 12,
  /** Server-side budget inside the Overpass QL. */
  overpassTimeoutS: 25,
  /** Client-side abort budget for any single request. */
  fetchTimeoutMs: 10_000,
  /**
   * The narrowest any search box may be, whoever built it.
   *
   * This is a *floor*, not just the drop-a-pin radius. Nominatim's bounding
   * box for a named place describes the feature's own footprint, which for a
   * point-like match can be metres across ("Navy Pier (River Route)" came back
   * as a 10 m x 10 m box, and Overpass found nothing inside it). Searching
   * that literally produces "no notable sites are mapped here" for a place
   * ringed by museums, so every box is widened to at least this radius around
   * the point the user actually asked about.
   */
  radiusMeters: 1500,
  /** Two results closer than this are treated as the same site. */
  proximityMeters: 60,
  /** Nominatim usage policy: at most one request per second. */
  nominatimMinIntervalMs: 1000,
  /** Debounce on the place input, so typing does not geocode per keystroke. */
  debounceMs: 500,
  /**
   * One shared budget for the whole "propose sites" step (geocode + Overpass).
   *
   * Sized from measurement, not taste: from a development network the only
   * reachable mirror answered a small bbox in ~20 s (the canonical instance
   * rate-limited us, the second timed out). A 12 s budget therefore *always*
   * fell back, however healthy the data was. 20 s with a visible Cancel, and
   * the curated set waiting at the end, beats pretending OSM is down.
   */
  proposalDeadlineMs: 20_000,
  /**
   * How long to wait for a mirror before *also* trying the next one, keeping
   * the earlier request alive (hedging). A mirror that is merely slow still
   * wins; one that is dead costs this much, not the whole budget. Scaled down
   * automatically when the remaining budget is smaller.
   */
  hedgeDelayMs: 4_000,
  /**
   * How long a total Overpass outage is remembered for (per session). Without
   * this, every repeat of a query made during an outage pays the full deadline
   * again before falling back.
   */
  outageMemoMs: 60_000,
  /** Longest OSM `description` kept, so a proposal cannot bloat the share URL. */
  descriptionMaxChars: 200,
} as const;

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  bbox: BBox;
  displayName: string;
  /** True when the answer came from the session cache rather than the network. */
  cached?: boolean;
}

/** A proposed site, before the user accepts it and it becomes a real `Stop`. */
export interface Candidate {
  /** `node/123`, `way/456`… — stable per OSM object, used for dedupe only. */
  osmId: string;
  title: string;
  lat: number;
  lng: number;
  category: StopCategory;
  /** One-line locator for the itinerary column. */
  blurb: string;
  /** Paragraph for the detail card; only present when OSM had real prose. */
  description?: string;
  /** Has a Wikipedia/Wikidata/website tag — shown as a quality hint. */
  hasWiki: boolean;
}

// ---------------------------------------------------------------- geometry

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Expand a centre point into a bbox roughly `radiusMeters` on each side. */
export function bboxFromCenter(
  lat: number,
  lng: number,
  radiusMeters: number = DEFAULTS.radiusMeters,
): BBox {
  const dLat = radiusMeters / 111_320;
  const dLng =
    radiusMeters / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return {
    south: lat - dLat,
    west: lng - dLng,
    north: lat + dLat,
    east: lng + dLng,
  };
}

/**
 * Narrow a search box to something one Overpass query can serve, *and* widen
 * it to something that can plausibly contain a site.
 *
 * Two independent limits, both measured:
 *
 * - **Maximum.** A city bbox from Nominatim can span a whole metro area; a
 *   single Overpass query over that is both slow and rude — against the
 *   canonical instance, 0.25° of Porto was refused with a server-side timeout
 *   after ~9 s, while 0.10° (~11 km across, which is as far as anyone walks a
 *   brochure tour) came back in under 3 s.
 * - **Minimum.** `DEFAULTS.radiusMeters`, so a point-like Nominatim match is
 *   not searched as a 10 m box. See the note on that constant.
 *
 * `center` is the point the clamp is applied around. Pass the geocoded point:
 * clamping around the *midpoint of the bounding box* instead moves the search
 * wherever the feature's footprint happens to be lopsided — measured, a plain
 * `Chicago` search landed 10.06 km from the point Nominatim returned, out in
 * Archer Heights, and proposed nothing in the Loop. Defaults to the box's own
 * midpoint for callers that have no better point (a box is all they have).
 */
export function clampBbox(
  bbox: BBox,
  opts: {
    center?: { lat: number; lng: number };
    maxSpanDeg?: number;
    minRadiusMeters?: number;
  } = {},
): BBox {
  const maxSpanDeg = opts.maxSpanDeg ?? 0.1;
  const minRadiusMeters = opts.minRadiusMeters ?? DEFAULTS.radiusMeters;
  const cLat = opts.center?.lat ?? (bbox.south + bbox.north) / 2;
  const cLng = opts.center?.lng ?? (bbox.west + bbox.east) / 2;

  const floor = bboxFromCenter(cLat, cLng, minRadiusMeters);
  // Order matters: widen to the floor, then let the server-side maximum have
  // the last word, so a floor larger than the cap can never produce a box the
  // mirrors will refuse.
  const halfLat = Math.min(
    Math.max((bbox.north - bbox.south) / 2, (floor.north - floor.south) / 2),
    maxSpanDeg / 2,
  );
  const halfLng = Math.min(
    Math.max((bbox.east - bbox.west) / 2, (floor.east - floor.west) / 2),
    maxSpanDeg / 2,
  );
  return {
    south: cLat - halfLat,
    north: cLat + halfLat,
    west: cLng - halfLng,
    east: cLng + halfLng,
  };
}

/**
 * Roughly how far from its centre a box reaches, so the UI can say what was
 * actually searched instead of asserting "nothing is mapped near here".
 */
export function bboxRadiusMeters(bbox: BBox): number {
  const lat = (bbox.south + bbox.north) / 2;
  const halfLat = ((bbox.north - bbox.south) / 2) * 111_320;
  const halfLng =
    ((bbox.east - bbox.west) / 2) *
    111_320 *
    Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return Math.max(halfLat, halfLng);
}

/** A distance a person would say out loud: "800 m", "1.5 km", "11 km". */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "0 m";
  if (meters < 1000) return `${Math.round(meters / 50) * 50} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

// --------------------------------------------------------------- Nominatim

export function nominatimUrl(query: string, endpoint = NOMINATIM_ENDPOINT) {
  const url = new URL(endpoint);
  url.searchParams.set("format", "json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");
  return url.toString();
}

interface NominatimRow {
  lat?: string;
  lon?: string;
  boundingbox?: string[];
  display_name?: string;
  name?: string;
}

/**
 * Normalise the first Nominatim row. Its `boundingbox` is
 * `["south","north","west","east"]` as strings; anything missing or
 * unparseable falls back to a radius around the point.
 *
 * The box is *not* kept verbatim. Nominatim's box is the matched feature's
 * footprint, which is the wrong thing to search in both directions: too small
 * for a point-like match (a 10 m box finds nothing), and, for a city, centred
 * on a footprint midpoint that can be kilometres from the point it returned.
 * `clampBbox` is applied here, around `lat`/`lng`, so the box this result
 * carries is already the box that should be searched.
 */
export function parseNominatim(results: unknown): GeocodeResult | null {
  if (!Array.isArray(results) || results.length === 0) return null;
  const row = results[0] as NominatimRow;
  const lat = Number.parseFloat(String(row?.lat));
  const lng = Number.parseFloat(String(row?.lon));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let bbox: BBox | null = null;
  if (Array.isArray(row.boundingbox) && row.boundingbox.length === 4) {
    const [s, n, w, e] = row.boundingbox.map(Number);
    if ([s, n, w, e].every(Number.isFinite)) {
      bbox = { south: s, north: n, west: w, east: e };
    }
  }
  return {
    lat,
    lng,
    bbox: clampBbox(bbox ?? bboxFromCenter(lat, lng), {
      center: { lat, lng },
    }),
    displayName: row.display_name ?? row.name ?? "",
  };
}

// ----------------------------------------------------------------- Overpass

/**
 * Overpass QL for a bbox: nodes, ways and relations tagged as a visitable
 * site, with `out center` so ways/relations come back with a point.
 */
export function buildOverpassQuery(
  bbox: BBox,
  opts: { overpassTimeoutS?: number } = {},
): string {
  const timeout = opts.overpassTimeoutS ?? DEFAULTS.overpassTimeoutS;
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const filters = [
    '["tourism"~"^(attraction|museum|viewpoint)$"]',
    '["historic"]',
  ];
  const parts: string[] = [];
  for (const filter of filters) {
    for (const element of ["node", "way", "relation"]) {
      parts.push(`  ${element}${filter}(${b});`);
    }
  }
  return `[out:json][timeout:${timeout}];\n(\n${parts.join("\n")}\n);\nout center tags;`;
}

export function overpassBody(query: string): string {
  return `data=${encodeURIComponent(query)}`;
}

// ------------------------------------------- element -> candidate -> stop

export type OsmTags = Record<string, string | undefined>;

export interface OverpassElement {
  type?: string;
  id?: number | string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: OsmTags;
}

/**
 * OSM tags -> one of the app's preset categories (§3c). Unrecognised tagging
 * resolves to the schema default (`poi`) rather than inventing a category.
 */
export function categoryFromTags(tags: OsmTags = {}): StopCategory {
  if (tags.tourism === "museum") return "museum";
  if (tags.tourism === "viewpoint") return "viewpoint";
  if (tags.tourism === "attraction") return "attraction";
  if (tags.historic) return "historic";
  if (tags.leisure === "park" || tags.natural) return "nature";
  const fromTag = tags.category;
  return isStopCategory(fromTag) ? fromTag : "poi";
}

export function categoryLabel(category: StopCategory): string {
  return categoryMeta(category).label;
}

/** The itinerary one-liner: short, printable, never the full OSM prose. */
export function blurbFromTags(tags: OsmTags = {}): string {
  const category = categoryFromTags(tags);
  if (category === "historic" && tags.historic && tags.historic !== "yes") {
    return `Historic ${String(tags.historic).replace(/_/g, " ")}`;
  }
  return categoryLabel(category);
}

/** The detail-card paragraph, when OSM actually carries one. */
export function descriptionFromTags(tags: OsmTags = {}): string | undefined {
  const raw =
    tags.description ?? tags["description:en"] ?? tags.inscription ?? null;
  if (!raw) return undefined;
  const text = String(raw).trim();
  if (!text) return undefined;
  return text.length > DEFAULTS.descriptionMaxChars
    ? `${text.slice(0, DEFAULTS.descriptionMaxChars).trimEnd()}…`
    : text;
}

export function hasWikiTag(tags: OsmTags = {}): boolean {
  return Boolean(
    tags.wikipedia || tags.wikidata || tags["wikipedia:en"] || tags.website,
  );
}

/** A node's own point, or a way/relation's `out center` point. */
export function elementPoint(
  element: OverpassElement,
): { lat: number; lng: number } | null {
  if (Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
    return { lat: element.lat as number, lng: element.lon as number };
  }
  const center = element.center;
  if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) {
    return { lat: center.lat as number, lng: center.lon as number };
  }
  return null;
}

export function elementToCandidate(
  element: OverpassElement,
): (Candidate & { tags: OsmTags; hasTitle: boolean }) | null {
  const point = elementPoint(element);
  if (!point) return null;
  const tags = element.tags ?? {};
  const title = (tags.name ?? tags["name:en"] ?? "").trim();
  const description = descriptionFromTags(tags);
  return {
    osmId: `${element.type ?? "node"}/${element.id ?? ""}`,
    title,
    lat: point.lat,
    lng: point.lng,
    category: categoryFromTags(tags),
    blurb: blurbFromTags(tags),
    ...(description !== undefined ? { description } : {}),
    hasWiki: hasWikiTag(tags),
    tags,
    hasTitle: Boolean(title),
  };
}

export function normalizeTitle(title: string): string {
  return (title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Do these two names plausibly describe the *same* site?
 *
 * The question only arises for two entries sitting within `proximityMeters` of
 * each other. Distance alone is not an answer: measured on a 1.5 km box over
 * the Chicago Loop, collapsing purely on proximity threw away 17 differently
 * named sites — the whole of Navy Pier's funfair vanished into "Centennial
 * Wheel" (32–50 m), and "The Ledge" and "Color Factory" vanished into
 * "SkyDeck Chicago Willis Tower". A city block holds distinct museums.
 *
 * What proximity dedupe is actually for is OSM carrying one site as a node
 * *and* a way (and sometimes a relation), or as a building plus the thing
 * inside it. Those agree on the name, or one name contains the other
 * ("Willis Tower" / "Willis Tower Skydeck"), so that is the test:
 *
 * - identical once normalised; or
 * - every word of the shorter name appears in the longer one; or
 * - at least 60% of the shorter name's words do.
 *
 * It errs towards showing both. Two genuinely adjacent sites in the list costs
 * the user one unticked checkbox; a silently swallowed one costs them the site.
 */
export function titlesLikelySameSite(a: string, b: string): boolean {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return false;
  if (left === right) return true;

  const leftWords = new Set(left.split(" "));
  const rightWords = new Set(right.split(" "));
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  if (shared === 0) return false;
  const shorter = Math.min(leftWords.size, rightWords.size);
  return shared / shorter >= 0.6;
}

/**
 * The one rule for "these two are the same site", shared by the proposal
 * ranking and the dialog's "Already added" marker so the list and the tour
 * cannot disagree about what counts as a duplicate.
 */
export function isSameSite(
  a: { title: string; lat: number; lng: number },
  b: { title: string; lat: number; lng: number },
  proximityMeters: number = DEFAULTS.proximityMeters,
): boolean {
  if (normalizeTitle(a.title) === normalizeTitle(b.title)) {
    return Boolean(normalizeTitle(a.title));
  }
  return (
    haversineMeters(a, b) <= proximityMeters &&
    titlesLikelySameSite(a.title, b.title)
  );
}

/** Crude notability proxy: a name, then a wiki link, then real prose. */
export function scoreCandidate(c: {
  hasTitle: boolean;
  hasWiki: boolean;
  tags?: OsmTags;
}): number {
  let score = 0;
  if (c.hasTitle) score += 100;
  if (c.hasWiki) score += 50;
  if (c.tags?.description || c.tags?.["description:en"]) score += 10;
  if (c.tags?.wikidata) score += 5;
  return score;
}

export interface RankedCandidates {
  candidates: Candidate[];
  /**
   * How many entries were collapsed into one that *is* being shown. Surfaced
   * in the dialog: silently dropping results is how a user ends up trusting a
   * list that is not telling them everything.
   */
  hidden: number;
}

/**
 * Rank by notability, then drop duplicates: OSM routinely carries the same
 * site as a node *and* a way (and sometimes a relation), which would otherwise
 * put "Art Institute of Chicago" in the list three times. `isSameSite` decides
 * what counts as a duplicate — a shared name, or proximity *plus* name
 * affinity, never proximity on its own.
 */
export function rankAndDedupe(
  elements: OverpassElement[] | null | undefined,
  opts: { topN?: number; proximityMeters?: number } = {},
): RankedCandidates {
  const topN = opts.topN ?? DEFAULTS.topN;
  const proximity = opts.proximityMeters ?? DEFAULTS.proximityMeters;

  const candidates = (elements ?? [])
    .map(elementToCandidate)
    .filter((c): c is NonNullable<ReturnType<typeof elementToCandidate>> =>
      Boolean(c),
    )
    // An unnamed POI makes a poor pre-selected proposal — nothing to show the
    // user but a dot — so the proposal list is named sites only.
    .filter((c) => c.hasTitle);

  candidates.sort(
    (a, b) =>
      scoreCandidate(b) - scoreCandidate(a) || a.title.localeCompare(b.title),
  );

  const kept: Candidate[] = [];
  let hidden = 0;
  for (const candidate of candidates) {
    if (kept.some((k) => isSameSite(k, candidate, proximity))) {
      hidden += 1;
      continue;
    }
    const { tags: _tags, hasTitle: _hasTitle, ...clean } = candidate;
    kept.push(clean);
    if (kept.length >= topN) break;
  }
  return { candidates: kept, hidden };
}

/** Coordinates are stored to ~0.1 m; more precision just inflates share URLs. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * A candidate as arguments for the store's ordinary `addStop()`. Nothing here
 * marks the stop as "from OSM": an accepted proposal is byte-for-byte the same
 * shape as a stop added by clicking the map, so it edits, reorders, deletes and
 * serialises identically (epic item 2).
 */
export function candidateToStopInit(
  candidate: Candidate,
): Partial<Stop> & Pick<Stop, "lat" | "lng"> {
  return {
    lat: round6(candidate.lat),
    lng: round6(candidate.lng),
    title: candidate.title || "Untitled stop",
    blurb: candidate.blurb,
    ...(candidate.description !== undefined
      ? { description: candidate.description }
      : {}),
    category: candidate.category,
  };
}

export function sessionCacheKey(kind: "geo" | "pois", query: string): string {
  return `tbb:near:${kind}:${normalizeTitle(query)}`;
}
