/**
 * Tour data model — SPEC.md D5 (`Tour → Route[] → Stop[]`).
 *
 * Array order is itinerary order. A stop's printed number is its 1-based index
 * *within its route*, so numbering restarts at 1 for every route.
 */

import {
  DEFAULT_ROUTE_PROFILE,
  isRouteProfile,
  normalizeProfile,
  ROUTE_PROFILES,
  type RouteProfile,
} from "../routing/types";

/**
 * Re-exported, not redeclared (ADR 0001): the travel-mode union has exactly
 * one definition, in the routing layer, and `Route.profile` is the same type
 * the router is handed. `src/routing/types.ts` is a leaf module — plain types
 * and constants, no Leaflet, no fetch — so the tour layer picking it up costs
 * nothing and introduces no cycle.
 *
 * `ROUTE_PROFILES` is the canonical id list (what `z.enum` validates against);
 * {@link ROUTE_PROFILE_OPTIONS} below is the same set with the UI's wording.
 */
export {
  DEFAULT_ROUTE_PROFILE,
  isRouteProfile,
  normalizeProfile,
  ROUTE_PROFILES,
  type RouteProfile,
};

export const TOUR_SCHEMA_VERSION = 2 as const;

/** A single point on a route. */
export interface Stop {
  id: string;
  lat: number;
  lng: number;
  title: string;
  /** One-line locator printed in the itinerary column (SPEC D6). */
  blurb?: string;
  /** Paragraph printed on the detail card (SPEC D6). */
  description?: string;
  /** Absolute `https:` URL. Hotlinked, never uploaded (SPEC D3). */
  imageUrl?: string;
  /**
   * Preset category (choice-first UX §3c). Omitted when it is the default
   * (`poi`) so default tours stay byte-free in the share URL. Read through
   * {@link stopCategory} so absence resolves to the default.
   */
  category?: StopCategory;
}

/** An ordered, named, colored sequence of stops. */
export interface Route {
  id: string;
  name: string;
  /** CSS color used for the polyline, markers and legend chip. */
  color: string;
  stops: Stop[];
  /**
   * Travel mode for the route (choice-first UX §3a), and the mode the router
   * is actually asked for. **Absent means `foot`** — the default is never
   * written out, because `"profile":"foot"` on every route is share-URL
   * budget for no information (ADR 0001). Read through {@link routeProfile}
   * so absence, and anything unrecognised, resolve to the default.
   *
   * Geometry itself is deliberately *not* a field here: ADR 0001 measured a
   * geometry-bearing share URL at 143 % of the 8,000-char ceiling and chose
   * to recompute at view time instead.
   */
  profile?: RouteProfile;
  /**
   * Optional shape points for the polyline (SPEC D4). Author-drawn, and
   * unrelated to routing: where both exist the `via` points are handed to the
   * router as intermediate waypoints rather than discarded (ADR 0001).
   */
  via?: [number, number][];
}

export interface TourSettings {
  pageSize?: "letter" | "a4";
  basemap?: string;
}

export interface Tour {
  version: typeof TOUR_SCHEMA_VERSION;
  id: string;
  title: string;
  subtitle?: string;
  /** Line under the ribbon banner ("Hop on and hop off…"). */
  tagline?: string;
  description?: string;
  routes: Route[];
  settings?: TourSettings;
}

/** Legacy flat shape (`version: 1`), kept only so the migration can type it. */
export interface TourV1 {
  version: 1;
  id?: string;
  title?: string;
  subtitle?: string;
  description?: string;
  stops?: unknown[];
  settings?: TourSettings;
}

/**
 * Route color palette — 10 accessible swatches (choice-first UX §3b).
 *
 * The first five are the original base-app palette (kept so existing tours and
 * tests keep their exact colors); the next five extend it to a 10-swatch
 * choice-first palette. Every entry has >= 4.5:1 contrast against the white
 * badge numeral and the swatches are mutually distinguishable.
 */
export const ROUTE_COLORS = [
  "#1E8449", // green
  "#C0392B", // red
  "#1F3A5F", // navy
  "#D68910", // amber
  "#7D3C98", // violet
  "#0C6E6D", // teal
  "#2458A8", // blue
  "#A62A79", // magenta
  "#8B5A2B", // brown
  "#37474F", // slate
] as const;

/**
 * What each palette entry is called out loud.
 *
 * The names used to live only in the comments above, so the swatch buttons
 * labelled themselves `Use #1E8449` and a screen-reader user heard a hex
 * string spelled out (QA-BUG-8). Keyed by lowercase hex so a stored color
 * matches whatever case it was written in.
 */
export const ROUTE_COLOR_NAMES: Record<string, string> = {
  "#1e8449": "green",
  "#c0392b": "red",
  "#1f3a5f": "navy",
  "#d68910": "amber",
  "#7d3c98": "violet",
  "#0c6e6d": "teal",
  "#2458a8": "blue",
  "#a62a79": "magenta",
  "#8b5a2b": "brown",
  "#37474f": "slate",
};

/**
 * A speakable name for a color: the palette name when it is a preset,
 * otherwise "custom" — never a hex code read out digit by digit. The hex is
 * still worth showing beside it, which is the caller's business.
 */
export function colorName(color: string): string {
  return ROUTE_COLOR_NAMES[color.trim().toLowerCase()] ?? "custom";
}

/** Alias used by the color picker UI; the palette is the swatch set. */
export const COLOR_SWATCHES = ROUTE_COLORS;

export const DEFAULT_ROUTE_COLOR = ROUTE_COLORS[0];

/**
 * Travel modes offered as a segmented control (choice-first UX §3a).
 *
 * The *ids* are ADR 0001's, not the wording: `foot` / `bike` / `driving` are
 * what go in the share URL and what the routing endpoints are keyed on. The
 * choice-first work shipped this control with `walking` / `cycling` ids while
 * the profile was still cosmetic; those are now legacy values the validator
 * repairs (t_2c1641fe), so links from that build keep working.
 */
export const ROUTE_PROFILE_OPTIONS: {
  id: RouteProfile;
  label: string;
  icon: string;
}[] = [
  { id: "foot", label: "Walking", icon: "🚶" },
  { id: "driving", label: "Driving", icon: "🚗" },
  { id: "bike", label: "Cycling", icon: "🚲" },
];

/**
 * A route always has a profile; absence — and anything unrecognised, including
 * a hand-edited URL or a `walking` from the pre-routing build — resolves to
 * the default (§3a, ADR 0001). This is the single read site for
 * `Route.profile`.
 */
export function routeProfile(route: Pick<Route, "profile">): RouteProfile {
  return route.profile === undefined
    ? DEFAULT_ROUTE_PROFILE
    : normalizeProfile(route.profile);
}

/** Stop category preset list, each with its map/legend icon (choice-first UX §3c). */
export type StopCategory =
  | "attraction"
  | "museum"
  | "historic"
  | "viewpoint"
  | "food"
  | "nature"
  | "shop"
  | "transit"
  | "poi";

export const STOP_CATEGORIES: {
  id: StopCategory;
  label: string;
  icon: string;
}[] = [
  { id: "attraction", label: "Attraction", icon: "⭐" },
  { id: "museum", label: "Museum", icon: "🏛️" },
  { id: "historic", label: "Historic", icon: "🏰" },
  { id: "viewpoint", label: "Viewpoint", icon: "🌄" },
  { id: "food", label: "Food & drink", icon: "🍽️" },
  { id: "nature", label: "Park / nature", icon: "🌳" },
  { id: "shop", label: "Shop", icon: "🛍️" },
  { id: "transit", label: "Transit", icon: "🚉" },
  { id: "poi", label: "Point of interest", icon: "📍" },
];

export const DEFAULT_STOP_CATEGORY: StopCategory = "poi";

export function isStopCategory(v: unknown): v is StopCategory {
  return STOP_CATEGORIES.some((c) => c.id === v);
}

/** A stop always has a category; absence resolves to the default (§3c). */
export function stopCategory(stop: Pick<Stop, "category">): StopCategory {
  return isStopCategory(stop.category) ? stop.category : DEFAULT_STOP_CATEGORY;
}

/** Metadata (label + icon) for a stop's effective category. */
export function categoryMeta(category: StopCategory) {
  return (
    STOP_CATEGORIES.find((c) => c.id === category) ??
    STOP_CATEGORIES[STOP_CATEGORIES.length - 1]
  );
}

/** Practical share-URL ceiling before proxies/chat clients truncate (SPEC §6). */
export const SHARE_URL_MAX = 8000;

/** Warn the author above this encoded length (SPEC §6). */
export const SHARE_URL_WARN = 6000;

let idCounter = 0;

/** Collision-resistant id that works in browsers, jsdom and node. */
export function newId(prefix = "id"): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}_${uuid}${idCounter.toString(36)}`;
}

export function createStop(
  init: Partial<Stop> & Pick<Stop, "lat" | "lng">,
): Stop {
  return {
    id: init.id ?? newId("stop"),
    lat: init.lat,
    lng: init.lng,
    title: init.title ?? "Untitled stop",
    ...(init.blurb !== undefined ? { blurb: init.blurb } : {}),
    ...(init.description !== undefined
      ? { description: init.description }
      : {}),
    ...(init.imageUrl !== undefined ? { imageUrl: init.imageUrl } : {}),
    // Omit the category when it is the default (poi) so default tours stay
    // byte-free in the share URL (§6).
    ...(init.category !== undefined && init.category !== DEFAULT_STOP_CATEGORY
      ? { category: init.category }
      : {}),
  };
}

export function createRoute(init: Partial<Route> = {}, index = 0): Route {
  return {
    id: init.id ?? newId("route"),
    name: init.name ?? `Route ${index + 1}`,
    color: init.color ?? ROUTE_COLORS[index % ROUTE_COLORS.length],
    stops: init.stops ? init.stops.map((s) => ({ ...s })) : [],
    // Omit the profile when it is the default (foot) so default tours stay
    // byte-free in the share URL (§6, ADR 0001). Normalised on the way in, so
    // a legacy `walking`/`cycling` from the pre-routing build canonicalises
    // rather than being stored as-is.
    ...(init.profile !== undefined &&
    normalizeProfile(init.profile) !== DEFAULT_ROUTE_PROFILE
      ? { profile: normalizeProfile(init.profile) }
      : {}),
    ...(init.via
      ? { via: init.via.map((p) => [p[0], p[1]] as [number, number]) }
      : {}),
    // Spread conditionally, exactly as `via` is: the default profile is
    // *absent*, never serialized (ADR 0001).
    ...(init.profile !== undefined && init.profile !== DEFAULT_ROUTE_PROFILE
      ? { profile: init.profile }
      : {}),
  };
}

export function createTour(init: Partial<Tour> = {}): Tour {
  return {
    version: TOUR_SCHEMA_VERSION,
    id: init.id ?? newId("tour"),
    title: init.title ?? "Untitled tour",
    ...(init.subtitle !== undefined ? { subtitle: init.subtitle } : {}),
    ...(init.tagline !== undefined ? { tagline: init.tagline } : {}),
    ...(init.description !== undefined
      ? { description: init.description }
      : {}),
    routes: init.routes?.length
      ? init.routes.map((r) => createRoute(r))
      : [createRoute()],
    ...(init.settings !== undefined ? { settings: { ...init.settings } } : {}),
  };
}

/** Deep structural clone, independent of `structuredClone` availability. */
export function cloneTour(tour: Tour): Tour {
  return JSON.parse(JSON.stringify(tour)) as Tour;
}

/**
 * Itinerary one-liner for a stop (SPEC D6): `blurb`, else the first 80
 * characters of `description` cut at a word boundary, else "".
 */
export function stopBlurb(stop: Stop, limit = 80): string {
  const blurb = stop.blurb?.trim();
  if (blurb) return blurb;
  const description = stop.description?.trim();
  if (!description) return "";
  if (description.length <= limit) return description;
  const window = description.slice(0, limit + 1);
  const cut = window.lastIndexOf(" ");
  const head = (
    cut > 0 ? window.slice(0, cut) : description.slice(0, limit)
  ).trimEnd();
  return `${head.replace(/[,;:.!?-]+$/, "")}…`;
}

/** Flattened `(route, stop, 1-based index within route)` triples, in print order. */
export function eachStop(
  tour: Tour,
): { route: Route; stop: Stop; index: number }[] {
  const out: { route: Route; stop: Stop; index: number }[] = [];
  for (const route of tour.routes) {
    route.stops.forEach((stop, i) => {
      out.push({ route, stop, index: i + 1 });
    });
  }
  return out;
}

export function findStop(
  tour: Tour,
  stopId: string,
): { route: Route; stop: Stop; index: number } | undefined {
  return eachStop(tour).find((entry) => entry.stop.id === stopId);
}

export function totalStops(tour: Tour): number {
  return tour.routes.reduce((n, route) => n + route.stops.length, 0);
}
