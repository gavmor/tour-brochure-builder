/**
 * What the brochure prints, derived from a tour.
 *
 * SPEC D6 gives a stop two presentations: the itinerary column prints the
 * one-line `blurb`, and the full detail card (image + paragraph) moves to the
 * continuation pages. These helpers decide what appears where, so the renderer
 * and its tests agree on one rule.
 */

import { eachStop, type Route, type Stop, type Tour } from "../tour";

export interface StopEntry {
  route: Route;
  stop: Stop;
  /** 1-based index within the route (SPEC D5 — numbering restarts per route). */
  index: number;
}

/**
 * Routes that get an itinerary section: the ones with stops.
 *
 * A route with no stops still appears in the legend — the reference brochure's
 * "NIGHT TOUR" is keyed but has no stop list (SPEC §5 item 3 is open; printing
 * an empty heading would be worse than either answer).
 */
export function itineraryRoutes(tour: Tour): Route[] {
  return tour.routes.filter((route) => route.stops.length > 0);
}

/** Every route, in order — the legend keys them all. */
export function legendRoutes(tour: Tour): Route[] {
  return tour.routes;
}

/** Routes that get an itinerary section: the ones with stops. */
export interface ItineraryRow {
  stop: Stop;
  /** 1-based index within the route — the number on the map marker. */
  index: number;
  /** Position across the whole itinerary, in print order. */
  flatIndex: number;
}

export interface ItinerarySection {
  route: Route;
  rows: ItineraryRow[];
}

/**
 * The itinerary column's sections, each row carrying both its per-route number
 * and its position across the whole list — the latter is what the print
 * spill-over split is expressed in (SPEC §5 item 6).
 */
export function itinerarySections(tour: Tour): ItinerarySection[] {
  let flatIndex = 0;
  return itineraryRoutes(tour).map((route) => ({
    route,
    rows: route.stops.map((stop, index) => ({
      stop,
      index: index + 1,
      flatIndex: flatIndex++,
    })),
  }));
}

/** A stop earns a detail card only when it has something a card would show. */
export function hasCardContent(stop: Stop): boolean {
  return Boolean(stop.description?.trim() || stop.imageUrl?.trim());
}

/**
 * Detail cards, in print order (route order, then itinerary order). Stops with
 * neither description nor image are omitted; they live only in the itinerary.
 */
export function detailEntries(tour: Tour): StopEntry[] {
  return eachStop(tour).filter((entry) => hasCardContent(entry.stop));
}

/** Points the map must show: every stop, plus any `via` shape points. */
export function tourPoints(tour: Tour): [number, number][] {
  const points: [number, number][] = [];
  for (const route of tour.routes) {
    for (const stop of route.stops) points.push([stop.lat, stop.lng]);
    for (const via of route.via ?? []) points.push([via[0], via[1]]);
  }
  return points;
}

/**
 * Image URLs are hotlinked author input (SPEC D3). The store already drops
 * non-https values, but a decoded share link is untrusted enough to re-check
 * before the URL reaches `src` — `javascript:` and `data:` must never get there.
 */
export function printableImageUrl(stop: Stop): string | null {
  const raw = stop.imageUrl?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** "3 stops · 2 routes", for the chrome. Plural-correct, no i18n pretence. */
export function tourSummaryLine(tour: Tour): string {
  const stops = tour.routes.reduce((n, route) => n + route.stops.length, 0);
  const routes = itineraryRoutes(tour).length;
  const stopWord = stops === 1 ? "stop" : "stops";
  const routeWord = routes === 1 ? "route" : "routes";
  return `${stops} ${stopWord} · ${routes} ${routeWord}`;
}
