/**
 * The curated fallback: the half of requirement 5 that is content rather than
 * error handling. Whatever the network does, this list is always there and
 * always turns into ordinary stops.
 */

import { describe, expect, it } from "vitest";
import { starterTour } from "../data/starterTour";
import { addStop, resetStore, tour } from "../tour";
import { stopCategory, totalStops } from "../tour/schema";
import { candidateToStopInit, curatedCandidates, curatedFor } from "./index";

describe("curated fallback proposals", () => {
  it("is non-empty for any query, including an unknown place", () => {
    for (const query of ["chicago", "Chicago", "Boston", "", undefined]) {
      expect(curatedFor(query).length).toBeGreaterThan(0);
    }
  });

  it("is derived from the starter tour, so the two cannot drift", () => {
    const starter = starterTour();
    const candidates = curatedCandidates();
    expect(candidates).toHaveLength(totalStops(starter));
    expect(candidates.map((c) => c.title)).toEqual(
      starter.routes.flatMap((r) => r.stops.map((s) => s.title)),
    );
    expect(candidates.map((c) => c.category)).toEqual(
      starter.routes.flatMap((r) => r.stops.map((s) => stopCategory(s))),
    );
  });

  it("proposes sites the user can actually tell apart", () => {
    for (const candidate of curatedCandidates()) {
      expect(candidate.title.trim()).not.toBe("");
      expect(candidate.blurb.trim()).not.toBe("");
      expect(Number.isFinite(candidate.lat)).toBe(true);
      expect(Number.isFinite(candidate.lng)).toBe(true);
    }
  });

  it("becomes ordinary stops through the shared store path", () => {
    resetStore();
    const accepted = curatedFor("Boston");
    for (const candidate of accepted) addStop(candidateToStopInit(candidate));

    const stops = tour.value.routes[0].stops;
    expect(stops).toHaveLength(accepted.length);

    // Structurally identical to a stop added by clicking the map: every key is
    // an ordinary Stop field, and nothing records that these came from the
    // fallback.
    const manual = addStop({ lat: 41.9, lng: -87.6, title: "Typed by hand" });
    expect(manual).not.toBeNull();
    const stopKeys = new Set([
      "id",
      "lat",
      "lng",
      "title",
      "blurb",
      "description",
      "imageUrl",
      "category",
    ]);
    for (const stop of stops) {
      for (const key of Object.keys(stop)) expect(stopKeys.has(key)).toBe(true);
      expect(stop).not.toHaveProperty("seeded");
      expect(stop).not.toHaveProperty("source");
      expect(stop).not.toHaveProperty("osmId");
    }
    resetStore();
  });
});
