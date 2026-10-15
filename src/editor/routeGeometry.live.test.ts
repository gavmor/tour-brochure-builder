/**
 * Live end-to-end check of the card's acceptance criterion: *every route in
 * the Chicago reference tour draws along streets, in its own color*.
 *
 * `src/routing/live.test.ts` proves the transport reaches FOSSGIS. This
 * proves the layer above it — profile resolution, `via` merging, the
 * per-route state the map draws from — works on the actual reference tours
 * rather than a fixture of two points.
 *
 * Skipped by default; CI must never lean on a donated third-party service.
 *
 * ```sh
 * ROUTING_LIVE=1 pnpm vitest run src/editor/routeGeometry.live.test.ts
 * ```
 */

import { beforeEach, describe, expect, it } from "vitest";
import { starterTour } from "../data/starterTour";
import { createRoutingService } from "../routing";
import { createRoute, type Tour } from "../tour";
import { twoRouteTour } from "../tour/fixtures";
import {
  geometryFor,
  resetRouteGeometry,
  routesSettled,
  setRoutingService,
  syncRouteGeometry,
} from "./routeGeometry";
import { routeLatLngs } from "./shape";

const LIVE = process.env.ROUTING_LIVE === "1";

async function draw(tour: Tour) {
  syncRouteGeometry(tour);
  expect(await routesSettled({ timeout: 60_000 })).toBe("ready");
}

describe.skipIf(!LIVE)("live road geometry for the reference tours", () => {
  beforeEach(() => {
    resetRouteGeometry();
    // The global test setup installs an offline service; this suite is the
    // one place that genuinely wants the network.
    setRoutingService(createRoutingService({ storage: null }));
  });

  it("draws the Chicago starter walk along the streets", async () => {
    const tour = starterTour();
    await draw(tour);

    for (const route of tour.routes) {
      const geo = geometryFor(route.id);
      expect(geo.approximate).toBe(false);
      expect(geo.coords).not.toBeNull();
      // A straight line would have exactly one vertex per stop; a six-stop
      // walk through the Loop is an order of magnitude more.
      expect(geo.coords?.length).toBeGreaterThan(route.stops.length * 5);
    }
  }, 90_000);

  it("draws every route of a two-route tour, each with its own geometry", async () => {
    const tour = twoRouteTour();
    await draw(tour);

    const drawn = tour.routes.map((route) => geometryFor(route.id).coords);
    expect(drawn.every((coords) => coords !== null)).toBe(true);
    expect(drawn[0]).not.toEqual(drawn[1]);
    // The green route carries `via` shape points; they must not be lost.
    expect(drawn[0]?.length).toBeGreaterThan(
      routeLatLngs(tour.routes[0]).length,
    );
  }, 90_000);

  it("gives a walking route a different line from a driving one", async () => {
    const base = twoRouteTour();
    const walk: Tour = {
      ...base,
      routes: [createRoute({ ...base.routes[0], id: "r_walk" })],
    };
    const drive: Tour = {
      ...base,
      routes: [
        createRoute({ ...base.routes[0], id: "r_drive", profile: "driving" }),
      ],
    };

    await draw(walk);
    await draw(drive);

    // If these match, the profile is not reaching a per-mode host — see
    // ADR 0001's warning about the OSRM demo server.
    expect(geometryFor("r_walk").coords).not.toEqual(
      geometryFor("r_drive").coords,
    );
  }, 90_000);
});
