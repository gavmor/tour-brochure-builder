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
  /** Radius used when the user drops a centre pin instead of naming a place. */
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
 * A city bbox from Nominatim can span a whole metro area; a single Overpass
 * query over that is both slow and rude — measured against the canonical
 * instance, 0.25° of Porto was refused with a server-side timeout after ~9 s,
 * while 0.10° (~11 km across, which is as far as anyone walks a brochure tour)
 * came back in under 3 s. Clamp around the centre.
 */
export function clampBbox(bbox: BBox, maxSpanDeg = 0.1): BBox {
  const cLat = (bbox.south + bbox.north) / 2;
  const cLng = (bbox.west + bbox.east) / 2;
  const halfLat = Math.min((bbox.north - bbox.south) / 2, maxSpanDeg / 2);
  const halfLng = Math.min((bbox.east - bbox.west) / 2, maxSpanDeg / 2);
  return {
    south: cLat - halfLat,
    north: cLat + halfLat,
    west: cLng - halfLng,
    east: cLng + halfLng,
  };
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
    bbox: bbox ?? bboxFromCenter(lat, lng),
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

/**
 * Rank by notability, then drop duplicates: OSM routinely carries the same
 * site as a node *and* a way (and sometimes a relation), which would otherwise
 * put "Art Institute of Chicago" in the list three times. Two entries collide
 * when they share a normalised name, or when they sit within
 * `proximityMeters` of each other whatever they are called.
 */
export function rankAndDedupe(
  elements: OverpassElement[] | null | undefined,
  opts: { topN?: number; proximityMeters?: number } = {},
): Candidate[] {
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
  for (const candidate of candidates) {
    const key = normalizeTitle(candidate.title);
    const duplicate = kept.some(
      (k) =>
        normalizeTitle(k.title) === key ||
        haversineMeters(k, candidate) <= proximity,
    );
    if (duplicate) continue;
    const { tags: _tags, hasTitle: _hasTitle, ...clean } = candidate;
    kept.push(clean);
    if (kept.length >= topN) break;
  }
  return kept;
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
