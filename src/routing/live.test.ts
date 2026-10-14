/**
 * Live smoke test against the real FOSSGIS endpoints. Skipped by default so
 * CI never leans on a donated third-party service (ADR 0001 keeps the
 * share-URL measurement script out of CI for the same reason):
 *
 * ```sh
 * ROUTING_LIVE=1 pnpm vitest run src/routing/live.test.ts
 * ```
 *
 * Run it when the endpoint choice in `endpoints.ts` is in doubt.
 */

import { describe, expect, it } from "vitest";
import { formatWaypoints, parseGeometry } from "./osrm";
import { createRoutingService } from "./service";
import type { LatLng } from "./types";

const LIVE = process.env.ROUTING_LIVE === "1";

/** Chicago: Willis Tower → Michigan Ave bridge → Navy Pier. */
const CHICAGO: LatLng[] = [
  [41.8789, -87.6359],
  [41.8881, -87.6245],
  [41.8919, -87.6051],
];

describe.skipIf(!LIVE)("live FOSSGIS routing", () => {
  it("returns street-following geometry with no API key", async () => {
    const routing = createRoutingService({ storage: null });
    const result = await routing.route(CHICAGO, "foot");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A straight three-point line would be 3 coordinates; a street-following
    // walk across the Loop is an order of magnitude more.
    expect(result.coords.length).toBeGreaterThan(30);
    for (const [lat, lng] of result.coords) {
      expect(lat).toBeGreaterThan(41.8);
      expect(lat).toBeLessThan(42.0);
      expect(lng).toBeGreaterThan(-87.7);
      expect(lng).toBeLessThan(-87.5);
    }
  }, 30_000);

  it("gives a different line per profile — the demo server does not", async () => {
    const routing = createRoutingService({ storage: null });
    const foot = await routing.route(CHICAGO, "foot");
    const driving = await routing.route(CHICAGO, "driving");

    expect(foot.ok && driving.ok).toBe(true);
    if (!foot.ok || !driving.ok) return;
    expect(foot.coords).not.toEqual(driving.coords);
  }, 30_000);

  it("decodes the polyline to the same line the server's GeoJSON gives", async () => {
    const routing = createRoutingService({ storage: null });
    const fromPolyline = await routing.route(CHICAGO, "foot");

    const url =
      "https://routing.openstreetmap.de/routed-foot/route/v1/foot/" +
      `${formatWaypoints(CHICAGO)}?overview=full&geometries=geojson&continue_straight=false`;
    const body = await (await fetch(url)).json();
    const fromGeoJson = parseGeometry(body.routes[0].geometry);

    expect(fromPolyline.ok).toBe(true);
    if (!fromPolyline.ok || !fromGeoJson) return;
    expect(fromPolyline.coords).toHaveLength(fromGeoJson.length);
    // polyline5 quantises deltas at 1e-5, so a point can land one unit in the
    // last place away from the independently rounded GeoJSON value — ~1.1 m,
    // the grain this module works at everywhere.
    for (const [i, [lat, lng]] of fromPolyline.coords.entries()) {
      expect(Math.abs(lat - fromGeoJson[i][0])).toBeLessThanOrEqual(2e-5);
      expect(Math.abs(lng - fromGeoJson[i][1])).toBeLessThanOrEqual(2e-5);
    }
  }, 30_000);
});
