import { describe, expect, it } from "vitest";
import { bigTour, twoRouteTour } from "./fixtures";
import {
  createRoute,
  createStop,
  createTour,
  eachStop,
  findStop,
  newId,
  ROUTE_COLORS,
  stopBlurb,
  TOUR_SCHEMA_VERSION,
  totalStops,
} from "./schema";

describe("factories", () => {
  it("creates a v2 tour with one default route", () => {
    const tour = createTour();
    expect(tour.version).toBe(TOUR_SCHEMA_VERSION);
    expect(tour.routes).toHaveLength(1);
    expect(tour.routes[0].color).toBe(ROUTE_COLORS[0]);
    expect(tour.routes[0].stops).toEqual([]);
  });

  it("gives every entity a distinct id", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId("x")));
    expect(ids.size).toBe(500);
    expect(createStop({ lat: 0, lng: 0 }).id).not.toBe(
      createStop({ lat: 0, lng: 0 }).id,
    );
  });

  it("colors routes from the palette by index", () => {
    expect(createRoute({}, 1).color).toBe(ROUTE_COLORS[1]);
    expect(createRoute({}, ROUTE_COLORS.length).color).toBe(ROUTE_COLORS[0]);
  });

  it("omits optional fields rather than writing undefined", () => {
    const stop = createStop({ lat: 1, lng: 2 });
    expect(Object.keys(stop).sort()).toEqual(["id", "lat", "lng", "title"]);
  });

  it("stores the default travel mode as absence (ADR 0001)", () => {
    // `"profile":"foot"` on every route is share-URL budget for no
    // information, so the factory spreads it conditionally the way `via` is.
    expect(Object.keys(createRoute())).toEqual([
      "id",
      "name",
      "color",
      "stops",
    ]);
    expect("profile" in createRoute({ profile: "foot" })).toBe(false);
    expect(createRoute({ profile: "driving" }).profile).toBe("driving");
  });

  it("keeps `profile` last, after `via`, so serialization is key-stable", () => {
    const route = createRoute({
      via: [[41.88, -87.62]],
      profile: "bike",
    });
    expect(Object.keys(route)).toEqual([
      "id",
      "name",
      "color",
      "stops",
      "via",
      "profile",
    ]);
  });
});

describe("itinerary numbering", () => {
  it("restarts at 1 within each route (SPEC D5)", () => {
    const entries = eachStop(twoRouteTour());
    expect(
      entries.map((e) => `${e.route.name} ${e.index} ${e.stop.title}`),
    ).toEqual([
      "Green Route 1 Sheraton Hotel",
      "Green Route 2 Michigan Avenue Bridge",
      "Green Route 3 Skydeck",
      "Red Route 1 Sheraton Hotel",
      "Red Route 2 Navy Pier",
    ]);
  });

  it("finds a stop with its route and per-route index", () => {
    const found = findStop(twoRouteTour(), "stop_navy_pier");
    expect(found?.route.id).toBe("route_red");
    expect(found?.index).toBe(2);
    expect(findStop(twoRouteTour(), "nope")).toBeUndefined();
  });

  it("counts stops across routes", () => {
    expect(totalStops(twoRouteTour())).toBe(5);
    expect(totalStops(bigTour(20, 2))).toBe(20);
  });
});

describe("stopBlurb (SPEC D6)", () => {
  it("prefers an explicit blurb", () => {
    const stop = createStop({
      lat: 0,
      lng: 0,
      blurb: "On the corner",
      description: "Long text.",
    });
    expect(stopBlurb(stop)).toBe("On the corner");
  });

  it("falls back to the first 80 chars of description at a word boundary", () => {
    const description =
      "The 103rd-floor observation deck of the Willis Tower, with glass ledges cantilevered over Wacker Drive.";
    const blurb = stopBlurb(createStop({ lat: 0, lng: 0, description }));
    expect(blurb.length).toBeLessThanOrEqual(81);
    expect(blurb.endsWith("…")).toBe(true);
    expect(blurb.slice(0, -1).trim().split(" ").pop()).toBe("ledges");
    expect(description.startsWith(blurb.slice(0, -1))).toBe(true);
  });

  it("returns a short description untouched", () => {
    expect(
      stopBlurb(createStop({ lat: 0, lng: 0, description: "Short." })),
    ).toBe("Short.");
  });

  it("returns an empty string when there is no copy at all", () => {
    expect(stopBlurb(createStop({ lat: 0, lng: 0 }))).toBe("");
    expect(stopBlurb(createStop({ lat: 0, lng: 0, blurb: "   " }))).toBe("");
  });
});
