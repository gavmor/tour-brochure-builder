/**
 * Unit tests for the pure half of "Add sites near a location".
 *
 * Ported from the spike's `tests/osm.test.mjs` (task t_0e197ca6) by task
 * t_40ec912a, with the assertions retargeted at this app's model: `lng` not
 * `lon`, `title` not `name`, and the preset `StopCategory` values from
 * `src/tour/schema.ts`.
 */

import { describe, expect, it } from "vitest";
import { addStop, resetStore, tour } from "../tour";
import { createStop, stopCategory } from "../tour/schema";
import {
  bboxFromCenter,
  blurbFromTags,
  buildOverpassQuery,
  candidateToStopInit,
  categoryFromTags,
  clampBbox,
  descriptionFromTags,
  elementToCandidate,
  hasWikiTag,
  haversineMeters,
  normalizeTitle,
  parseNominatim,
  rankAndDedupe,
  sessionCacheKey,
} from "./osm";

describe("Overpass query", () => {
  it("covers node/way/relation for both filters and asks for centers", () => {
    const query = buildOverpassQuery({ south: 1, west: 2, north: 3, east: 4 });
    for (const element of ["node", "way", "relation"]) {
      expect(query).toMatch(new RegExp(`${element}\\["tourism"`));
      expect(query).toMatch(new RegExp(`${element}\\["historic"\\]`));
    }
    expect(query).toMatch(/tourism"~"\^\(attraction\|museum\|viewpoint\)\$"/);
    expect(query).toMatch(/out center tags;/);
    expect(query).toContain("(1,2,3,4)");
  });

  it("carries a server-side timeout so a huge area cannot run forever", () => {
    expect(
      buildOverpassQuery({ south: 1, west: 2, north: 3, east: 4 }),
    ).toMatch(/\[timeout:\d+\]/);
  });
});

describe("Nominatim parsing", () => {
  it("maps lat/lon and the [south,north,west,east] bbox", () => {
    const result = parseNominatim([
      {
        lat: "41.87",
        lon: "-87.62",
        boundingbox: ["41.64", "42.02", "-87.94", "-87.52"],
        display_name: "Chicago",
      },
    ]);
    expect(result).not.toBeNull();
    expect(result?.lat).toBe(41.87);
    expect(result?.lng).toBe(-87.62);
    expect(result?.bbox).toEqual({
      south: 41.64,
      north: 42.02,
      west: -87.94,
      east: -87.52,
    });
    expect(result?.displayName).toBe("Chicago");
  });

  it("falls back to a radius bbox when Nominatim omits one", () => {
    const result = parseNominatim([{ lat: "41.88", lon: "-87.63" }]);
    expect(result?.bbox.north).toBeGreaterThan(41.88);
    expect(result?.bbox.south).toBeLessThan(41.88);
  });

  it("returns null for an empty or malformed answer", () => {
    expect(parseNominatim([])).toBeNull();
    expect(parseNominatim("nope")).toBeNull();
    expect(parseNominatim([{ lat: "x", lon: "y" }])).toBeNull();
  });
});

describe("bbox helpers", () => {
  it("clamps a metro-sized bbox down to one query's worth", () => {
    const clamped = clampBbox({ south: 40, north: 43, west: -89, east: -86 });
    expect(clamped.north - clamped.south).toBeLessThanOrEqual(0.1001);
    expect(clamped.east - clamped.west).toBeLessThanOrEqual(0.1001);
    // Still centred on what the user asked for.
    expect((clamped.north + clamped.south) / 2).toBeCloseTo(41.5, 6);
    expect((clamped.east + clamped.west) / 2).toBeCloseTo(-87.5, 6);
  });

  it("leaves a small bbox alone", () => {
    const small = { south: 41.87, north: 41.89, west: -87.64, east: -87.62 };
    const clamped = clampBbox(small);
    expect(clamped.north - clamped.south).toBeCloseTo(0.02, 6);
  });

  it("centres the bbox it builds from a dropped pin", () => {
    const bbox = bboxFromCenter(41.88, -87.63, 1500);
    expect(bbox.south).toBeLessThan(41.88);
    expect(bbox.north).toBeGreaterThan(41.88);
    expect(bbox.west).toBeLessThan(-87.63);
    expect(bbox.east).toBeGreaterThan(-87.63);
  });

  it("measures a real distance", () => {
    const metres = haversineMeters(
      { lat: 41.8796, lng: -87.6237 },
      { lat: 41.8826, lng: -87.6226 },
    );
    expect(metres).toBeGreaterThan(300);
    expect(metres).toBeLessThan(400);
  });
});

describe("tag mapping", () => {
  it("resolves OSM tags to the app's preset categories", () => {
    expect(categoryFromTags({ tourism: "museum" })).toBe("museum");
    expect(categoryFromTags({ tourism: "viewpoint" })).toBe("viewpoint");
    expect(categoryFromTags({ tourism: "attraction" })).toBe("attraction");
    expect(categoryFromTags({ historic: "monument" })).toBe("historic");
    expect(categoryFromTags({ leisure: "park" })).toBe("nature");
  });

  it("falls back to the schema default rather than inventing a category", () => {
    expect(categoryFromTags({})).toBe("poi");
    expect(categoryFromTags({ amenity: "bench" })).toBe("poi");
  });

  it("keeps the blurb a short printable locator", () => {
    expect(blurbFromTags({ historic: "castle" })).toBe("Historic castle");
    expect(blurbFromTags({ tourism: "museum" })).toBe("Museum");
    // OSM prose belongs on the detail card, not in the itinerary one-liner.
    expect(blurbFromTags({ description: "A very long story…" })).toBe(
      "Point of interest",
    );
  });

  it("puts OSM prose in the description, truncated", () => {
    expect(descriptionFromTags({ description: "Cool place" })).toBe(
      "Cool place",
    );
    expect(descriptionFromTags({ "description:en": "English prose" })).toBe(
      "English prose",
    );
    expect(descriptionFromTags({})).toBeUndefined();
    const long = descriptionFromTags({ description: "x".repeat(500) });
    expect(long?.length).toBeLessThanOrEqual(201);
    expect(long?.endsWith("…")).toBe(true);
  });

  it("detects a wiki/website quality hint", () => {
    expect(hasWikiTag({ wikidata: "Q1" })).toBe(true);
    expect(hasWikiTag({ wikipedia: "en:X" })).toBe(true);
    expect(hasWikiTag({ website: "https://example.org" })).toBe(true);
    expect(hasWikiTag({})).toBe(false);
  });

  it("folds case, punctuation and accents when comparing titles", () => {
    expect(normalizeTitle("Café  Déjà-Vu!")).toBe("cafe deja vu");
  });
});

describe("element -> candidate", () => {
  it("reads a node's own point and a way's `out center` point", () => {
    const node = elementToCandidate({
      type: "node",
      id: 1,
      lat: 41.1,
      lon: -87.1,
      tags: { name: "A" },
    });
    expect(node?.osmId).toBe("node/1");
    expect(node?.lat).toBe(41.1);
    expect(node?.lng).toBe(-87.1);

    const way = elementToCandidate({
      type: "way",
      id: 2,
      center: { lat: 41.2, lon: -87.2 },
      tags: { name: "B" },
    });
    expect(way?.osmId).toBe("way/2");
    expect(way?.lat).toBe(41.2);
  });

  it("drops an element with no usable geometry", () => {
    expect(
      elementToCandidate({ type: "relation", id: 3, tags: { name: "C" } }),
    ).toBeNull();
  });
});

describe("ranking and dedupe", () => {
  it("prefers named + wiki'd sites, drops unnamed ones and collapses duplicates", () => {
    const elements = [
      {
        type: "node",
        id: 1,
        lat: 41.88,
        lon: -87.62,
        tags: { name: "Museum X", tourism: "museum", wikidata: "Q1" },
      },
      // Unnamed: nothing to show the user but a dot.
      {
        type: "node",
        id: 2,
        lat: 41.881,
        lon: -87.621,
        tags: { tourism: "attraction" },
      },
      {
        type: "node",
        id: 3,
        lat: 41.882,
        lon: -87.622,
        tags: { name: "Plain Park", tourism: "attraction" },
      },
      // The same museum, mapped again as a way.
      {
        type: "way",
        id: 4,
        center: { lat: 41.8801, lon: -87.6201 },
        tags: { name: "Museum X", tourism: "museum" },
      },
    ];
    const kept = rankAndDedupe(elements, { topN: 10 });
    expect(kept.map((c) => c.title)).toEqual(["Museum X", "Plain Park"]);
  });

  it("collapses two differently-named points sitting on top of each other", () => {
    const kept = rankAndDedupe([
      {
        type: "node",
        id: 1,
        lat: 41.88,
        lon: -87.62,
        tags: { name: "Statue" },
      },
      {
        type: "node",
        id: 2,
        lat: 41.880001,
        lon: -87.620001,
        tags: { name: "Memorial" },
      },
    ]);
    expect(kept).toHaveLength(1);
  });

  it("respects topN", () => {
    const elements = Array.from({ length: 20 }, (_, i) => ({
      type: "node",
      id: i,
      lat: 41 + i * 0.01,
      lon: -87 - i * 0.01,
      tags: { name: `Site ${i}`, tourism: "attraction" },
    }));
    expect(rankAndDedupe(elements, { topN: 10 })).toHaveLength(10);
  });

  it("survives a null/empty element list", () => {
    expect(rankAndDedupe(null)).toEqual([]);
    expect(rankAndDedupe([])).toEqual([]);
  });

  it("leaves no OSM bookkeeping on the proposals it returns", () => {
    const [candidate] = rankAndDedupe([
      {
        type: "node",
        id: 1,
        lat: 41.88,
        lon: -87.62,
        tags: { name: "Museum X", tourism: "museum" },
      },
    ]);
    expect(candidate).not.toHaveProperty("tags");
    expect(candidate).not.toHaveProperty("hasTitle");
  });
});

describe("candidate -> stop (the shared code path)", () => {
  it("produces a stop identical in shape to a hand-added one", () => {
    resetStore();
    const manual = addStop({ lat: 41.9, lng: -87.6, title: "Typed by hand" });
    const fromPoi = addStop(
      candidateToStopInit({
        osmId: "node/9",
        title: "From OSM",
        lat: 41.91,
        lng: -87.61,
        category: "museum",
        blurb: "Museum",
        hasWiki: true,
      }),
    );
    expect(manual).not.toBeNull();
    expect(fromPoi).not.toBeNull();

    // No `source`, `osmId` or `seeded` marker rides along: once accepted, a
    // proposal is indistinguishable from any other stop.
    expect(Object.keys(fromPoi as object).sort()).toEqual(
      ["blurb", "category", "id", "lat", "lng", "title"].sort(),
    );
    expect(fromPoi).not.toHaveProperty("osmId");
    expect(stopCategory(fromPoi as never)).toBe("museum");
    expect(tour.value.routes[0].stops).toHaveLength(2);
    resetStore();
  });

  it("rounds coordinates to 6 dp so proposals do not bloat the share URL", () => {
    const init = candidateToStopInit({
      osmId: "node/1",
      title: "Precise",
      lat: 41.123456789,
      lng: -87.987654321,
      category: "poi",
      blurb: "Point of interest",
      hasWiki: false,
    });
    expect(init.lat).toBe(41.123457);
    expect(init.lng).toBe(-87.987654);
    // And it is accepted by the schema factory unchanged.
    expect(createStop(init).lat).toBe(41.123457);
  });

  it("names an unnamed candidate rather than creating a blank stop", () => {
    const init = candidateToStopInit({
      osmId: "node/1",
      title: "",
      lat: 1,
      lng: 2,
      category: "poi",
      blurb: "",
      hasWiki: false,
    });
    expect(init.title).toBe("Untitled stop");
  });

  it("keeps the default category out of the stop (share-URL budget)", () => {
    const stop = createStop(
      candidateToStopInit({
        osmId: "node/1",
        title: "Plain",
        lat: 1,
        lng: 2,
        category: "poi",
        blurb: "Point of interest",
        hasWiki: false,
      }),
    );
    expect(stop).not.toHaveProperty("category");
    expect(stopCategory(stop)).toBe("poi");
  });
});

describe("cache keys", () => {
  it("are stable across cosmetic differences in the query", () => {
    expect(sessionCacheKey("pois", "Chicago")).toBe(
      sessionCacheKey("pois", "  chicago "),
    );
    expect(sessionCacheKey("geo", "Chicago")).not.toBe(
      sessionCacheKey("pois", "Chicago"),
    );
  });
});
