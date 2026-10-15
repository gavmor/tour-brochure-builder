/**
 * Live smoke test against the real Nominatim and Overpass endpoints. Skipped
 * by default, in the same spirit as `src/routing/live.test.ts`: CI must never
 * lean on donated third-party services, and the mirrors are regularly
 * rate-limited or down — a red build would say nothing about this code.
 *
 * ```sh
 * POI_LIVE=1 pnpm vitest run src/poi/live.test.ts
 * ```
 *
 * Run it when the endpoint list, the query, or the latency budget in
 * `osm.ts` is in doubt. A failure here means "the free OSM services were not
 * reachable from this network", which is exactly the condition the curated
 * fallback exists for — see `curated.ts` and `NearbyPanel.tsx`.
 */

import { describe, expect, it } from "vitest";
import {
  bboxRadiusMeters,
  clearPoiCache,
  DEFAULTS,
  findPois,
  forgetOutage,
  formatDistance,
  geocode,
  haversineMeters,
  resetNominatimGate,
} from "./index";

const LIVE = process.env.POI_LIVE === "1";

describe.skipIf(!LIVE)("live OSM services", () => {
  it("geocodes a city through Nominatim", async () => {
    clearPoiCache();
    resetNominatimGate();
    const place = await geocode("Porto, Portugal");
    expect(place.displayName.toLowerCase()).toContain("porto");
    expect(place.lat).toBeGreaterThan(40);
    expect(place.lat).toBeLessThan(42);
  }, 30_000);

  it("proposes real sites through Overpass inside the deadline", async () => {
    clearPoiCache();
    forgetOutage();
    const started = Date.now();
    const result = await findPois(
      { south: 41.139, west: -8.629, north: 41.166, east: -8.593 },
      { deadlineAt: started + DEFAULTS.proposalDeadlineMs },
    );
    const elapsed = Date.now() - started;

    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.title.trim()).not.toBe("");
      expect(Number.isFinite(candidate.lat)).toBe(true);
      expect(Number.isFinite(candidate.lng)).toBe(true);
    }
    expect(elapsed).toBeLessThanOrEqual(DEFAULTS.proposalDeadlineMs + 1_000);
    // eslint-disable-next-line no-console
    console.log(
      `[live] ${result.candidates.length} sites from ${result.endpoint} in ${elapsed} ms`,
    );
  }, 40_000);

  /**
   * The three searches task t_cde077ad was filed for (BUG-10, BUG-11). Each
   * went through geocode -> findPois on the live services and came back wrong
   * in a way no unit test could see, because the defect was in the *shape of
   * the box* the two steps hand to each other.
   */
  describe.each([
    { place: "Navy Pier, Chicago", bug: "BUG-10" },
    { place: "Willis Tower, Chicago", bug: "BUG-10" },
    { place: "Chicago", bug: "BUG-11" },
  ])("$place ($bug)", ({ place }) => {
    // Nominatim only: this is the regression itself, and it does not depend on
    // an Overpass mirror being healthy.
    it("builds a usable search box around the geocoded point", async () => {
      clearPoiCache();
      resetNominatimGate();
      const found = await geocode(place, {
        deadlineAt: Date.now() + DEFAULTS.proposalDeadlineMs,
      });

      // BUG-11: the box must sit on the point Nominatim returned, not on the
      // midpoint of its bounding box (measured 10.06 km away for "Chicago").
      const centre = {
        lat: (found.bbox.north + found.bbox.south) / 2,
        lng: (found.bbox.east + found.bbox.west) / 2,
      };
      expect(haversineMeters(centre, found)).toBeLessThan(1);

      // BUG-10: and it must be wide enough to contain anything at all — the
      // match for "Navy Pier, Chicago" is a 10 m box over a trail connector.
      expect(bboxRadiusMeters(found.bbox)).toBeGreaterThanOrEqual(
        DEFAULTS.radiusMeters - 1,
      );
      // eslint-disable-next-line no-console
      console.log(
        `[live] ${place}: "${found.displayName}" -> ` +
          `${formatDistance(bboxRadiusMeters(found.bbox))} box on the point`,
      );
    }, 60_000);

    // The other half, end to end. Subject to the same caveat as every test in
    // this file: a failure here means the mirrors would not answer, which is
    // what the curated fallback exists for.
    it("finds real sites in that box", async () => {
      clearPoiCache();
      forgetOutage();
      resetNominatimGate();
      const found = await geocode(place, {
        deadlineAt: Date.now() + DEFAULTS.proposalDeadlineMs,
      });
      const result = await findPois(found.bbox, {
        deadlineAt: Date.now() + DEFAULTS.proposalDeadlineMs * 3,
      });
      expect(result.candidates.length).toBeGreaterThan(0);
      // eslint-disable-next-line no-console
      console.log(
        `[live] ${place}: ${result.candidates.length} proposed, ` +
          `${result.hidden} hidden — ` +
          result.candidates
            .slice(0, 6)
            .map((c) => c.title)
            .join(", "),
      );
    }, 120_000);
  });
});
