/**
 * Choice-first preset fields (§3a profile, §3c category) and their §6
 * serialization: defaults are omitted, known values round-trip through the
 * share URL, unknown values are dropped to the default, and old share URLs
 * (which carry neither field) still load.
 */

import { describe, expect, it } from "vitest";
import {
  categoryMeta,
  createRoute,
  createStop,
  createTour,
  DEFAULT_ROUTE_PROFILE,
  DEFAULT_STOP_CATEGORY,
  routeProfile,
  stopCategory,
} from "./schema";
import { decodeTour, encodeTour } from "./urlShare";
import { parseTour, serializeTour } from "./validate";

describe("route profile (§3a)", () => {
  it("defaults to walking and is omitted when default", () => {
    const route = createRoute();
    expect(route.profile).toBeUndefined();
    expect(routeProfile(route)).toBe("walking");
    expect(DEFAULT_ROUTE_PROFILE).toBe("walking");
  });

  it("keeps a non-default profile", () => {
    const route = createRoute({ profile: "cycling" });
    expect(route.profile).toBe("cycling");
    expect(routeProfile(route)).toBe("cycling");
  });

  it("does not serialize the default profile", () => {
    const route = createRoute({ profile: "walking" });
    expect(route.profile).toBeUndefined();
    expect(serializeTour(createTour({ routes: [route] }))).not.toContain(
      "profile",
    );
  });
});

describe("stop category (§3c)", () => {
  it("defaults to poi and is omitted when default", () => {
    const stop = createStop({ lat: 0, lng: 0 });
    expect(stop.category).toBeUndefined();
    expect(stopCategory(stop)).toBe("poi");
    expect(DEFAULT_STOP_CATEGORY).toBe("poi");
  });

  it("keeps a non-default category and exposes its icon", () => {
    const stop = createStop({ lat: 0, lng: 0, category: "museum" });
    expect(stop.category).toBe("museum");
    expect(categoryMeta(stopCategory(stop)).icon).toBe("🏛️");
  });
});

describe("validation / repair", () => {
  it("accepts a known profile and category", () => {
    const result = parseTour({
      version: 2,
      id: "t1",
      title: "Trip",
      routes: [
        {
          id: "r1",
          name: "Route 1",
          color: "#1E8449",
          profile: "driving",
          stops: [
            {
              id: "s1",
              lat: 1,
              lng: 2,
              title: "A",
              category: "food",
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tour.routes[0].profile).toBe("driving");
    expect(result.tour.routes[0].stops[0].category).toBe("food");
  });

  it("drops an unknown profile and category back to the default", () => {
    const result = parseTour({
      version: 2,
      id: "t1",
      title: "Trip",
      routes: [
        {
          id: "r1",
          name: "Route 1",
          color: "#1E8449",
          profile: "teleport",
          stops: [
            { id: "s1", lat: 1, lng: 2, title: "A", category: "spaceship" },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tour.routes[0].profile).toBeUndefined();
    expect(routeProfile(result.tour.routes[0])).toBe("walking");
    expect(result.tour.routes[0].stops[0].category).toBeUndefined();
    expect(stopCategory(result.tour.routes[0].stops[0])).toBe("poi");
    expect(result.warnings.some((w) => w.includes("profile"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("category"))).toBe(true);
  });

  it("omits the default profile/category even when supplied explicitly", () => {
    const result = parseTour({
      version: 2,
      id: "t1",
      title: "Trip",
      routes: [
        {
          id: "r1",
          name: "Route 1",
          color: "#1E8449",
          profile: "walking",
          stops: [{ id: "s1", lat: 1, lng: 2, title: "A", category: "poi" }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tour.routes[0].profile).toBeUndefined();
    expect(result.tour.routes[0].stops[0].category).toBeUndefined();
  });
});

describe("URL round-trip (§6)", () => {
  it("round-trips a non-default profile and category", () => {
    const tour = createTour({
      title: "Downtown",
      routes: [
        createRoute({
          name: "Loop",
          color: "#2458A8",
          profile: "cycling",
          stops: [
            createStop({
              lat: 41.88,
              lng: -87.62,
              title: "Pier",
              category: "viewpoint",
            }),
          ],
        }),
      ],
    });
    const decoded = decodeTour(encodeTour(tour));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.tour.routes[0].profile).toBe("cycling");
    expect(decoded.tour.routes[0].stops[0].category).toBe("viewpoint");
  });

  it("loads an old share URL with neither field (backward compatible)", () => {
    const legacy = {
      version: 2,
      id: "t_legacy",
      title: "Old tour",
      routes: [
        {
          id: "r1",
          name: "Route 1",
          color: "#C0392B",
          stops: [{ id: "s1", lat: 10, lng: 20, title: "Old stop" }],
        },
      ],
    };
    const encoded = encodeTour(legacy as never);
    const decoded = decodeTour(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const route = decoded.tour.routes[0];
    expect(route.profile).toBeUndefined();
    expect(routeProfile(route)).toBe("walking");
    expect(stopCategory(route.stops[0])).toBe("poi");
    // The legacy hex color is preserved verbatim.
    expect(route.color).toBe("#C0392B");
  });
});
