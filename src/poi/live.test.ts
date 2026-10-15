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
  clearPoiCache,
  DEFAULTS,
  findPois,
  forgetOutage,
  geocode,
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
});
