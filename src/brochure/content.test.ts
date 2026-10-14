import { describe, expect, it } from "vitest";
import { twoRouteTour } from "../tour/fixtures";
import { createRoute, createStop, createTour } from "../tour/schema";
import {
  detailEntries,
  hasCardContent,
  itineraryRoutes,
  itinerarySections,
  legendRoutes,
  printableImageUrl,
  tourPoints,
  tourSummaryLine,
} from "./content";

describe("itineraryRoutes / legendRoutes", () => {
  it("prints a section only for routes that have stops", () => {
    const tour = createTour({
      routes: [
        createRoute({ name: "Green", stops: [createStop({ lat: 1, lng: 2 })] }),
        createRoute({ name: "Night tour", stops: [] }),
      ],
    });
    expect(itineraryRoutes(tour).map((r) => r.name)).toEqual(["Green"]);
  });

  it("keys every route in the legend, including a stopless one", () => {
    // The reference brochure's NIGHT TOUR is legend-only (SPEC §5 item 3).
    const tour = createTour({
      routes: [
        createRoute({ name: "Green", stops: [createStop({ lat: 1, lng: 2 })] }),
        createRoute({ name: "Night tour", stops: [] }),
      ],
    });
    expect(legendRoutes(tour).map((r) => r.name)).toEqual([
      "Green",
      "Night tour",
    ]);
  });
});

describe("detailEntries", () => {
  it("omits stops with neither description nor image", () => {
    const tour = twoRouteTour();
    // The fixture's Michigan Avenue Bridge has a blurb only.
    const titles = detailEntries(tour).map((entry) => entry.stop.title);
    expect(titles).not.toContain("Michigan Avenue Bridge");
    expect(titles).toContain("Skydeck");
  });

  it("numbers cards per route, restarting at 1 (SPEC D5)", () => {
    const tour = twoRouteTour();
    const entries = detailEntries(tour);
    const byRoute = new Map<string, number[]>();
    for (const entry of entries) {
      const list = byRoute.get(entry.route.id) ?? [];
      list.push(entry.index);
      byRoute.set(entry.route.id, list);
    }
    // Every route's lowest card index is its own first stop's number, not a
    // continuation of the previous route's count.
    for (const indexes of byRoute.values()) {
      expect(Math.min(...indexes)).toBe(1);
    }
  });

  it("treats whitespace-only copy as no content", () => {
    expect(
      hasCardContent(createStop({ lat: 0, lng: 0, description: "   " })),
    ).toBe(false);
    expect(
      hasCardContent(createStop({ lat: 0, lng: 0, description: "Real copy." })),
    ).toBe(true);
  });
});

describe("printableImageUrl", () => {
  it("accepts https", () => {
    const stop = createStop({
      lat: 0,
      lng: 0,
      imageUrl: "https://example.com/a.jpg",
    });
    expect(printableImageUrl(stop)).toBe("https://example.com/a.jpg");
  });

  it("rejects anything that is not https (SPEC D3)", () => {
    const cases = [
      "http://example.com/a.jpg",
      "javascript:alert(1)",
      "data:image/svg+xml,<svg onload='alert(1)'/>",
      "not a url",
      "",
    ];
    for (const imageUrl of cases) {
      expect(printableImageUrl(createStop({ lat: 0, lng: 0, imageUrl }))).toBe(
        null,
      );
    }
  });
});

describe("tourPoints", () => {
  it("includes via shape points so the map fits the drawn line", () => {
    const tour = twoRouteTour();
    const points = tourPoints(tour);
    expect(points).toContainEqual([41.8902, -87.6185]);
    expect(points.length).toBeGreaterThan(
      tour.routes.reduce((n, route) => n + route.stops.length, 0),
    );
  });
});

describe("itinerarySections", () => {
  it("numbers rows per route and keeps a flat print order", () => {
    const sections = itinerarySections(twoRouteTour());
    expect(sections.map((s) => s.route.name)).toEqual([
      "Green Route",
      "Red Route",
    ]);
    expect(sections[0].rows.map((r) => r.index)).toEqual([1, 2, 3]);
    expect(sections[1].rows.map((r) => r.index)).toEqual([1, 2]);
    // flatIndex runs across routes — it is what the spill-over split uses.
    expect(sections.flatMap((s) => s.rows.map((r) => r.flatIndex))).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it("skips routes with no stops", () => {
    const tour = createTour({
      routes: [
        createRoute({ name: "Empty", stops: [] }),
        createRoute({ name: "Real", stops: [createStop({ lat: 1, lng: 2 })] }),
      ],
    });
    expect(itinerarySections(tour).map((s) => s.route.name)).toEqual(["Real"]);
  });
});

describe("tourSummaryLine", () => {
  it("counts stops and the routes that carry them", () => {
    expect(tourSummaryLine(twoRouteTour())).toMatch(/^\d+ stops · 2 routes$/);
  });

  it("is plural-correct for one stop on one route", () => {
    const tour = createTour({
      routes: [createRoute({ stops: [createStop({ lat: 1, lng: 2 })] })],
    });
    expect(tourSummaryLine(tour)).toBe("1 stop · 1 route");
  });
});
