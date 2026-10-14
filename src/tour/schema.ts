/**
 * Tour data model — SPEC.md D5 (`Tour → Route[] → Stop[]`).
 *
 * Array order is itinerary order. A stop's printed number is its 1-based index
 * *within its route*, so numbering restarts at 1 for every route.
 */

import {
  DEFAULT_ROUTE_PROFILE,
  isRouteProfile,
  ROUTE_PROFILES,
  type RouteProfile,
} from "../routing/types";

/**
 * Re-exported, not redeclared (ADR 0001): the travel-mode union has exactly
 * one definition, in the routing layer, and `Route.profile` is the same type
 * the router is handed. `src/routing/types.ts` is a leaf module — plain types
 * and constants, no Leaflet, no fetch — so the tour layer picking it up costs
 * nothing and introduces no cycle.
 */
export {
  DEFAULT_ROUTE_PROFILE,
  isRouteProfile,
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
}

/** An ordered, named, colored sequence of stops. */
export interface Route {
  id: string;
  name: string;
  /** CSS color used for the polyline, markers and legend chip. */
  color: string;
  stops: Stop[];
  /**
   * Optional shape points for the polyline (SPEC D4). Author-drawn, and
   * unrelated to routing: where both exist the `via` points are handed to the
   * router as intermediate waypoints rather than discarded (ADR 0001).
   */
  via?: [number, number][];
  /**
   * Road-routing travel mode. **Absent means `foot`** — the default is never
   * written out, because `"profile":"foot"` on every route is share-URL budget
   * for no information (ADR 0001). Read it as `route.profile ?? "foot"`, or
   * better, through `profileOf()` in `src/editor/routeGeometry.ts`.
   *
   * Geometry itself is deliberately *not* a field here: ADR 0001 measured a
   * geometry-bearing share URL at 143 % of the 8,000-char ceiling and chose to
   * recompute at view time instead.
   */
  profile?: RouteProfile;
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
 * Default route palette (SPEC §4). Every entry was picked for >= 4.5:1
 * contrast against white badge text.
 */
export const ROUTE_COLORS = [
  "#1E8449", // green
  "#C0392B", // red
  "#1F3A5F", // navy / night
  "#D68910", // amber
  "#7D3C98", // violet
] as const;

export const DEFAULT_ROUTE_COLOR = ROUTE_COLORS[0];

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
  };
}

export function createRoute(init: Partial<Route> = {}, index = 0): Route {
  return {
    id: init.id ?? newId("route"),
    name: init.name ?? `Route ${index + 1}`,
    color: init.color ?? ROUTE_COLORS[index % ROUTE_COLORS.length],
    stops: init.stops ? init.stops.map((s) => ({ ...s })) : [],
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
