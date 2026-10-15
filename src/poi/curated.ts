/**
 * The curated fallback for "Add sites near a location".
 *
 * Overpass and Nominatim are free, keyless, best-effort services: they are
 * rate-limited, occasionally down, and always slower than a user is patient.
 * Requirement 5 of the epic is that none of that ever leaves the user with an
 * empty dialog — so whenever the network path fails, times out or simply finds
 * nothing, the same pre-selected checklist appears, filled from the curated
 * starter tour that already ships with the app.
 *
 * The proposals are *derived from* `starterTour()` rather than copied, so the
 * two can never drift: there is exactly one curated site list in this codebase.
 */

import { starterTour } from "../data/starterTour";
import { stopCategory } from "../tour/schema";
import type { Candidate } from "./osm";

/** Shown to the user so the fallback is never a silent substitution. */
export const CURATED_SET_LABEL = "Chicago downtown landmarks";

/**
 * The curated proposals, in starter-tour order.
 *
 * `osmId` is a synthetic `curated/<stop id>`: it exists only so the proposal
 * list has stable keys, and it is dropped when the proposal becomes a stop.
 */
export function curatedCandidates(): Candidate[] {
  const tour = starterTour();
  return tour.routes.flatMap((route) =>
    route.stops.map((stop) => ({
      osmId: `curated/${stop.id}`,
      title: stop.title,
      lat: stop.lat,
      lng: stop.lng,
      category: stopCategory(stop),
      blurb: stop.blurb ?? "",
      ...(stop.description !== undefined
        ? { description: stop.description }
        : {}),
      hasWiki: false,
    })),
  );
}

/**
 * The curated proposals to offer for a given query.
 *
 * There is one curated city, so every query gets it; the signature takes the
 * query anyway because that is the seam a second curated set would plug into,
 * and because the UI has to tell the user *which* set it fell back to.
 */
export function curatedFor(_query?: string): Candidate[] {
  return curatedCandidates();
}
