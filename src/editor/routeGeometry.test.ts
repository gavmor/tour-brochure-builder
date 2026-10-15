/**
 * The layer between the routing service and Leaflet.
 *
 * What is worth testing here is not "does OSRM answer" — `src/routing` owns
 * that — but the decisions this module makes on the view's behalf: when a
 * request is worth making, what the views draw while they wait, what they
 * draw when the answer never comes, and which edits are free.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoutingService } from "../routing";
import {
  deferredFetch,
  encodePolyline,
  type FetchSpy,
  fakeResponse,
  osrmBody,
} from "../routing/testDoubles";
import type { LatLng } from "../routing/types";
import {
  createRoute,
  createStop,
  createTour,
  routeProfile,
  type Tour,
} from "../tour";
import {
  approximateReason,
  approximateTooltip,
  geometryFor,
  resetRouteGeometry,
  routeDrawBounds,
  routeGeometry,
  routesSettled,
  setRoutingService,
  syncRouteGeometry,
} from "./routeGeometry";

const SHERATON: [number, number] = [41.8902, -87.6185];
const BRIDGE: [number, number] = [41.8885, -87.6241];
const SKYDECK: [number, number] = [41.8789, -87.6359];

/** Road geometry that bulges well north of the straight line. */
const ROAD: LatLng[] = [
  [41.8902, -87.6185],
  [41.8951, -87.6212],
  [41.8885, -87.6241],
];

let spy: FetchSpy;

function install(overrides: Parameters<typeof createRoutingService>[0] = {}) {
  spy = deferredFetch();
  setRoutingService(
    createRoutingService({
      fetchImpl: spy.impl,
      storage: null,
      debounceMs: 0,
      minRequestIntervalMs: 0,
      ...overrides,
    }),
  );
}

/**
 * The debounce timer is a real `setTimeout`, so draining microtasks is not
 * enough: each tick here yields to the macrotask queue as well, which is what
 * lets debounce → queue → politeness window → fetch actually run.
 */
async function flush(ticks = 8) {
  for (let i = 0; i < ticks; i++) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

function tourWith(routes: Parameters<typeof createRoute>[0][]): Tour {
  return createTour({
    id: "tour_geo",
    title: "Geometry",
    routes: routes.map((init) => createRoute(init)),
  });
}

function twoStopRoute(init: Parameters<typeof createRoute>[0] = {}) {
  return {
    id: "route_a",
    name: "Route A",
    color: "#1E8449",
    stops: [
      createStop({ id: "s1", lat: SHERATON[0], lng: SHERATON[1] }),
      createStop({ id: "s2", lat: BRIDGE[0], lng: BRIDGE[1] }),
    ],
    ...init,
  };
}

beforeEach(() => {
  resetRouteGeometry();
  install();
});

afterEach(() => {
  resetRouteGeometry();
});

describe("routeProfile", () => {
  it("reads an absent profile as foot — the one read site (ADR 0001)", () => {
    expect(routeProfile(createRoute(twoStopRoute()))).toBe("foot");
  });

  it("passes the stored names through", () => {
    expect(
      routeProfile(createRoute(twoStopRoute({ profile: "driving" }))),
    ).toBe("driving");
    expect(routeProfile(createRoute(twoStopRoute({ profile: "bike" })))).toBe(
      "bike",
    );
  });

  it("degrades a hand-edited profile to foot rather than failing", () => {
    const route = createRoute(twoStopRoute());
    (route as { profile?: string }).profile = "teleport";
    expect(routeProfile(route)).toBe("foot");
  });

  it("reads the pre-routing build's wording as its new equivalent", () => {
    const route = createRoute(twoStopRoute());
    (route as { profile?: string }).profile = "cycling";
    expect(routeProfile(route)).toBe("bike");
    (route as { profile?: string }).profile = "walking";
    expect(routeProfile(route)).toBe("foot");
  });
});

describe("syncRouteGeometry", () => {
  it("makes no request for a route that is not a route yet", async () => {
    syncRouteGeometry(
      tourWith([
        {
          id: "route_a",
          stops: [createStop({ id: "s1", lat: SHERATON[0], lng: SHERATON[1] })],
        },
      ]),
    );
    await flush();
    expect(spy.calls).toHaveLength(0);
    expect(geometryFor("route_a").approximate).toBe(false);
  });

  it("replaces the straight placeholder with road geometry on success", async () => {
    syncRouteGeometry(tourWith([twoStopRoute()]));
    await flush();

    // Until the router answers there is no geometry, which is what makes the
    // views keep drawing the straight line.
    expect(geometryFor("route_a").coords).toBeNull();
    expect(geometryFor("route_a").pending).toBe(true);

    spy.resolve(0, fakeResponse(osrmBody(encodePolyline(ROAD))));
    await flush();

    const geo = geometryFor("route_a");
    expect(geo.coords).toEqual(ROAD);
    expect(geo.approximate).toBe(false);
    expect(geo.pending).toBe(false);
  });

  it("keeps the straight line and flags it approximate when the network is down", async () => {
    syncRouteGeometry(tourWith([twoStopRoute()]));
    await flush();
    spy.reject(0, new TypeError("Failed to fetch"));
    await flush();

    const geo = geometryFor("route_a");
    // Null coords is the contract with the views: fall back, never blank.
    expect(geo.coords).toBeNull();
    expect(geo.approximate).toBe(true);
    expect(geo.reason).toBe("network-error");
  });

  it("flags a rate-limited route approximate too", async () => {
    syncRouteGeometry(tourWith([twoStopRoute()]));
    await flush();
    spy.resolve(0, fakeResponse({}, { status: 429 }));
    await flush();
    expect(geometryFor("route_a").reason).toBe("rate-limited");
  });

  it("sends each profile to its own host — a walk is not a drive", async () => {
    syncRouteGeometry(tourWith([twoStopRoute()]));
    await flush();
    expect(spy.calls[0]).toContain("/routed-foot/route/v1/foot/");

    install();
    resetRouteGeometry();
    syncRouteGeometry(tourWith([twoStopRoute({ profile: "driving" })]));
    await flush();
    expect(spy.calls[0]).toContain("/routed-car/route/v1/driving/");
  });

  it("hands `via` shape points to the router as intermediate waypoints", async () => {
    syncRouteGeometry(tourWith([twoStopRoute({ via: [[41.8951, -87.6212]] })]));
    await flush();
    // The shape point is on the wire: `routeLatLngs`, not `stopLatLngs`
    // (ADR 0001 — `via` reaches the router as a waypoint).
    expect(spy.calls[0]).toContain("41.8951");
  });

  it("does not re-request when a route is only renamed or recolored", async () => {
    const tour = tourWith([twoStopRoute()]);
    syncRouteGeometry(tour);
    await flush();
    spy.resolve(0, fakeResponse(osrmBody(encodePolyline(ROAD))));
    await flush();
    expect(spy.calls).toHaveLength(1);

    const renamed = tourWith([
      twoStopRoute({ name: "Scenic Route", color: "#C0392B" }),
    ]);
    syncRouteGeometry(renamed);
    await flush();
    expect(spy.calls).toHaveLength(1);
    expect(geometryFor("route_a").coords).toEqual(ROAD);
  });

  it("re-requests when a stop moves", async () => {
    syncRouteGeometry(tourWith([twoStopRoute()]));
    await flush();
    spy.resolve(0, fakeResponse(osrmBody(encodePolyline(ROAD))));
    await flush();

    syncRouteGeometry(
      tourWith([
        {
          id: "route_a",
          stops: [
            createStop({ id: "s1", lat: SHERATON[0], lng: SHERATON[1] }),
            createStop({ id: "s2", lat: SKYDECK[0], lng: SKYDECK[1] }),
          ],
        },
      ]),
    );
    await flush();
    expect(spy.calls).toHaveLength(2);
    expect(geometryFor("route_a").pending).toBe(true);
  });

  it("re-requests when the profile changes", async () => {
    syncRouteGeometry(tourWith([twoStopRoute()]));
    await flush();
    spy.resolve(0, fakeResponse(osrmBody(encodePolyline(ROAD))));
    await flush();

    syncRouteGeometry(tourWith([twoStopRoute({ profile: "bike" })]));
    await flush();
    expect(spy.calls).toHaveLength(2);
    expect(spy.calls[1]).toContain("/routed-bike/");
  });

  it("lets a superseded answer land without clobbering the newer state", async () => {
    syncRouteGeometry(tourWith([twoStopRoute()]));
    await flush();

    // Move a stop before the first answer arrives.
    syncRouteGeometry(
      tourWith([
        {
          id: "route_a",
          stops: [
            createStop({ id: "s1", lat: SHERATON[0], lng: SHERATON[1] }),
            createStop({ id: "s2", lat: SKYDECK[0], lng: SKYDECK[1] }),
          ],
        },
      ]),
    );
    await flush();

    // The stale request fails. It must not paint the route approximate — a
    // newer answer is already on its way.
    spy.reject(0, new TypeError("Failed to fetch"));
    await flush();
    expect(geometryFor("route_a").approximate).toBe(false);

    spy.resolve(1, fakeResponse(osrmBody(encodePolyline(ROAD))));
    await flush();
    expect(geometryFor("route_a").coords).toEqual(ROAD);
  });

  it("serves a cache hit synchronously, with no request and no flicker", async () => {
    syncRouteGeometry(tourWith([twoStopRoute()]));
    await flush();
    spy.resolve(0, fakeResponse(osrmBody(encodePolyline(ROAD))));
    await flush();

    // A reload: the component state is gone, but the service's cache (its
    // sessionStorage mirror in the browser) still holds the geometry.
    resetRouteGeometry();
    syncRouteGeometry(tourWith([twoStopRoute()]));

    // Synchronously, before any await: the brochure draws roads immediately.
    expect(geometryFor("route_a").coords).toEqual(ROAD);
    expect(geometryFor("route_a").pending).toBe(false);
    expect(spy.calls).toHaveLength(1);
  });

  it("forgets a route that leaves the tour", async () => {
    syncRouteGeometry(
      tourWith([
        twoStopRoute(),
        {
          id: "route_b",
          stops: [
            createStop({ id: "s3", lat: BRIDGE[0], lng: BRIDGE[1] }),
            createStop({ id: "s4", lat: SKYDECK[0], lng: SKYDECK[1] }),
          ],
        },
      ]),
    );
    await flush();
    spy.resolve(0, fakeResponse(osrmBody(encodePolyline(ROAD))));
    spy.resolve(1, fakeResponse(osrmBody(encodePolyline(ROAD))));
    await flush();
    expect(Object.keys(routeGeometry.value).sort()).toEqual([
      "route_a",
      "route_b",
    ]);

    syncRouteGeometry(tourWith([twoStopRoute()]));
    await flush();
    expect(Object.keys(routeGeometry.value)).toEqual(["route_a"]);
  });

  it("drops the indicator when a route is cut back below two stops", async () => {
    syncRouteGeometry(tourWith([twoStopRoute()]));
    await flush();
    spy.reject(0, new TypeError("Failed to fetch"));
    await flush();
    expect(geometryFor("route_a").approximate).toBe(true);

    syncRouteGeometry(
      tourWith([
        {
          id: "route_a",
          stops: [createStop({ id: "s1", lat: SHERATON[0], lng: SHERATON[1] })],
        },
      ]),
    );
    await flush();
    expect(geometryFor("route_a").approximate).toBe(false);
  });
});

describe("routesSettled", () => {
  it("resolves only once every request has settled", async () => {
    syncRouteGeometry(tourWith([twoStopRoute()]));
    await flush();

    let settled = false;
    const waiting = routesSettled({ timeout: 1000 }).then((outcome) => {
      settled = true;
      return outcome;
    });
    await flush();
    expect(settled).toBe(false);

    spy.resolve(0, fakeResponse(osrmBody(encodePolyline(ROAD))));
    expect(await waiting).toBe("ready");
  });

  it("is ready immediately when nothing is outstanding", async () => {
    expect(await routesSettled({ timeout: 1000 })).toBe("ready");
  });

  it("gives up rather than holding a print forever", async () => {
    syncRouteGeometry(tourWith([twoStopRoute()]));
    await flush();
    expect(await routesSettled({ timeout: 20 })).toBe("timeout");
  });
});

describe("routeDrawBounds", () => {
  it("includes road geometry so a bulging route is not clipped", async () => {
    const route = createRoute(twoStopRoute());
    expect(routeDrawBounds(route)).toHaveLength(2);

    syncRouteGeometry(tourWith([twoStopRoute()]));
    await flush();
    spy.resolve(0, fakeResponse(osrmBody(encodePolyline(ROAD))));
    await flush();

    const bounds = routeDrawBounds(route);
    expect(bounds).toHaveLength(2 + ROAD.length);
    // The vertex north of both stops is in the fit.
    expect(bounds.some(([lat]) => lat === 41.8951)).toBe(true);
  });
});

describe("approximate wording", () => {
  it("names the cause the author can act on", () => {
    expect(approximateReason("network-error")).toContain("no connection");
    expect(approximateReason("no-route")).toContain("no road");
    expect(approximateReason("rate-limited")).toContain("rate-limiting");
  });

  it("still says something useful for an unknown reason", () => {
    expect(approximateReason(undefined)).toContain("unavailable");
    expect(approximateTooltip("timeout")).toContain("Approximate route");
    expect(approximateTooltip("timeout")).toContain("straight between stops");
  });
});
