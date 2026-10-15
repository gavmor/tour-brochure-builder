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
  type BBox,
  bboxFromCenter,
  bboxRadiusMeters,
  blurbFromTags,
  buildOverpassQuery,
  candidateToStopInit,
  categoryFromTags,
  clampBbox,
  DEFAULTS,
  descriptionFromTags,
  elementToCandidate,
  formatDistance,
  hasWikiTag,
  haversineMeters,
  isSameSite,
  normalizeTitle,
  parseNominatim,
  rankAndDedupe,
  sessionCacheKey,
  titlesLikelySameSite,
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
  it("maps lat/lon and clamps the bbox around the point it returned", () => {
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
    // Not the raw Nominatim box: clamped to one query's worth, centred on the
    // point rather than the box's lopsided midpoint (BUG-11).
    const bbox = result?.bbox as BBox;
    expect((bbox.north + bbox.south) / 2).toBeCloseTo(41.87, 6);
    expect((bbox.east + bbox.west) / 2).toBeCloseTo(-87.62, 6);
    expect(bbox.north - bbox.south).toBeLessThanOrEqual(0.1001);
    expect(result?.displayName).toBe("Chicago");
  });

  it("does not search a city at the midpoint of its bounding box (BUG-11)", () => {
    // The live numbers: Nominatim answered `Chicago` with the point
    // 41.87556,-87.62442 and a box whose midpoint is 41.83379,-87.73211 —
    // 10.06 km away, out in Archer Heights. Every proposal came from there
    // and not one Loop landmark was offered.
    const result = parseNominatim([
      {
        lat: "41.87556",
        lon: "-87.62442",
        boundingbox: ["41.78", "41.8876", "-87.7877", "-87.6765"],
        display_name: "Chicago",
      },
    ]);
    const bbox = result?.bbox as BBox;
    const centre = {
      lat: (bbox.north + bbox.south) / 2,
      lng: (bbox.east + bbox.west) / 2,
    };
    expect(
      haversineMeters(centre, { lat: 41.87556, lng: -87.62442 }),
    ).toBeLessThan(1);
  });

  it("floors a point-like match at the default radius (BUG-10)", () => {
    // "Navy Pier, Chicago" matched "Navy Pier (River Route), Lakefront Trail
    // Connector": a 0.01 km x 0.01 km box, over which Overpass returned zero
    // elements — so the app claimed nothing was mapped at Navy Pier.
    const result = parseNominatim([
      {
        lat: "41.89058",
        lon: "-87.61221",
        boundingbox: ["41.89053", "41.89063", "-87.61226", "-87.61216"],
        display_name: "Navy Pier (River Route)",
      },
    ]);
    const bbox = result?.bbox as BBox;
    expect(bboxRadiusMeters(bbox)).toBeGreaterThanOrEqual(
      DEFAULTS.radiusMeters - 1,
    );
    expect(bbox.south).toBeLessThan(41.89058);
    expect(bbox.north).toBeGreaterThan(41.89058);
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

  it("clamps around an explicit centre, not the box midpoint", () => {
    const clamped = clampBbox(
      { south: 40, north: 43, west: -89, east: -86 },
      { center: { lat: 41.87556, lng: -87.62442 } },
    );
    expect((clamped.north + clamped.south) / 2).toBeCloseTo(41.87556, 6);
    expect((clamped.east + clamped.west) / 2).toBeCloseTo(-87.62442, 6);
  });

  it("widens a box too small to hold anything up to the default radius", () => {
    const pinhead = {
      south: 41.89053,
      north: 41.89063,
      west: -87.61226,
      east: -87.61216,
    };
    const clamped = clampBbox(pinhead);
    expect(bboxRadiusMeters(clamped)).toBeGreaterThanOrEqual(
      DEFAULTS.radiusMeters - 1,
    );
  });

  it("leaves a box that is already between the floor and the cap alone", () => {
    const small = { south: 41.85, north: 41.91, west: -87.66, east: -87.6 };
    const clamped = clampBbox(small);
    expect(clamped.north - clamped.south).toBeCloseTo(0.06, 6);
    expect(clamped.east - clamped.west).toBeCloseTo(0.06, 6);
  });

  it("never lets the floor push a box past the server-side cap", () => {
    const clamped = clampBbox(
      { south: 41.88, north: 41.88, west: -87.63, east: -87.63 },
      { minRadiusMeters: 50_000 },
    );
    expect(clamped.north - clamped.south).toBeLessThanOrEqual(0.1001);
  });

  it("says how far a box reaches, in words", () => {
    expect(formatDistance(1500)).toBe("1.5 km");
    expect(formatDistance(11_130)).toBe("11 km");
    expect(formatDistance(800)).toBe("800 m");
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

describe("what counts as the same site", () => {
  // The distinct-name sites the old proximity-only rule suppressed on a live
  // 1.5 km box over the Loop, with the name that swallowed each.
  const measuredFalseCollapses: [string, string][] = [
    ["Vietnam Veterans Memorial", "Heald Square Monument"],
    ["The Ledge", "SkyDeck Chicago Willis Tower"],
    ["Color Factory", "SkyDeck Chicago Willis Tower"],
    ["Carousel", "Centennial Wheel"],
    ["Drop Tower", "Centennial Wheel"],
    ["Tea Cups", "Centennial Wheel"],
    ["Wave Swinger", "Centennial Wheel"],
    ["Light Tower", "Centennial Wheel"],
    ["Pier Park Mini-Golf", "Centennial Wheel"],
    ["Site of Fort Dearborn", "McCormick Bridgehouse & Chicago River Museum"],
    ["Chicago Board of Trade Building Museum", "Money Museum"],
    ["Flyover", "Chicago Children's Museum"],
    ["Old Post Office Site", "Site of the Sauganash Hotel/Wigwam"],
    ["Oscar O. D'Angelo Park", "Grand Central Station"],
  ];

  it.each(measuredFalseCollapses)("keeps %s apart from %s (BUG-12)", (a, b) => {
    expect(titlesLikelySameSite(a, b)).toBe(false);
  });

  const measuredRealDuplicates: [string, string][] = [
    ["Art Institute of Chicago", "Art Institute of Chicago"],
    ["Willis Tower", "Willis Tower Skydeck"],
    ["Cloud Gate", "Cloud Gate (The Bean)"],
  ];

  it.each(measuredRealDuplicates)("collapses %s into %s", (a, b) => {
    expect(titlesLikelySameSite(a, b)).toBe(true);
  });

  it("needs both proximity and name affinity, never one alone", () => {
    const ledge = { title: "The Ledge", lat: 41.878565, lng: -87.63589 };
    const skydeck = {
      title: "SkyDeck Chicago Willis Tower",
      lat: 41.878876,
      lng: -87.635915,
    };
    // 35 m apart, unrelated names: two sites.
    expect(haversineMeters(ledge, skydeck)).toBeLessThan(60);
    expect(isSameSite(ledge, skydeck)).toBe(false);

    // Related names but kilometres apart: also two sites.
    expect(
      isSameSite(
        { title: "Willis Tower", lat: 41.8788, lng: -87.6359 },
        { title: "Willis Tower Skydeck", lat: 41.95, lng: -87.6359 },
      ),
    ).toBe(false);
  });

  it("matches on name at any distance, as it always did", () => {
    expect(
      isSameSite(
        { title: "Buckingham Fountain", lat: 41.8758, lng: -87.6189 },
        { title: "buckingham fountain", lat: 41.8759, lng: -87.6188 },
      ),
    ).toBe(true);
  });

  it("never calls two unnamed things the same site", () => {
    expect(
      isSameSite(
        { title: "", lat: 41.88, lng: -87.62 },
        { title: "", lat: 41.88, lng: -87.62 },
      ),
    ).toBe(false);
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
    expect(kept.candidates.map((c) => c.title)).toEqual([
      "Museum X",
      "Plain Park",
    ]);
    expect(kept.hidden).toBe(1);
  });

  it("keeps two differently-named sites that happen to be neighbours (BUG-12)", () => {
    // Measured on a live 1.5 km box over the Loop, collapsing on distance
    // alone threw away 17 distinct sites: "The Ledge" and "Color Factory"
    // vanished into "SkyDeck Chicago Willis Tower", and the whole of Navy
    // Pier's funfair vanished into "Centennial Wheel". 32-56 m apart is a
    // city block, not a duplicate.
    const kept = rankAndDedupe([
      {
        type: "node",
        id: 1,
        lat: 41.878876,
        lon: -87.635915,
        tags: { name: "SkyDeck Chicago Willis Tower", tourism: "attraction" },
      },
      {
        type: "node",
        id: 2,
        lat: 41.878565,
        lon: -87.63589,
        tags: { name: "The Ledge", tourism: "attraction" },
      },
      {
        type: "node",
        id: 3,
        lat: 41.879,
        lon: -87.635975,
        tags: { name: "Color Factory", tourism: "attraction" },
      },
    ]);
    expect(kept.candidates.map((c) => c.title)).toEqual([
      "Color Factory",
      "SkyDeck Chicago Willis Tower",
      "The Ledge",
    ]);
    expect(kept.hidden).toBe(0);
  });

  it("still collapses one site mapped twice under near-identical names", () => {
    // What the proximity rule is actually for: OSM carrying the same thing as
    // a node and a way, where the names agree or one contains the other.
    const kept = rankAndDedupe([
      {
        type: "node",
        id: 1,
        lat: 41.88,
        lon: -87.62,
        tags: { name: "Willis Tower", tourism: "attraction" },
      },
      {
        type: "way",
        id: 2,
        center: { lat: 41.880001, lon: -87.620001 },
        tags: { name: "Willis Tower Skydeck", tourism: "viewpoint" },
      },
    ]);
    expect(kept.candidates).toHaveLength(1);
    expect(kept.hidden).toBe(1);
  });

  it("reports what it hid, so the UI never drops a result silently", () => {
    const kept = rankAndDedupe([
      {
        type: "node",
        id: 1,
        lat: 41.88,
        lon: -87.62,
        tags: { name: "Art Institute of Chicago", tourism: "museum" },
      },
      {
        type: "way",
        id: 2,
        center: { lat: 41.880002, lon: -87.620002 },
        tags: { name: "Art Institute of Chicago", tourism: "museum" },
      },
      {
        type: "relation",
        id: 3,
        center: { lat: 41.880003, lon: -87.620003 },
        tags: { name: "Art Institute of Chicago", tourism: "museum" },
      },
    ]);
    expect(kept.candidates).toHaveLength(1);
    expect(kept.hidden).toBe(2);
  });

  it("respects topN", () => {
    const elements = Array.from({ length: 20 }, (_, i) => ({
      type: "node",
      id: i,
      lat: 41 + i * 0.01,
      lon: -87 - i * 0.01,
      tags: { name: `Site ${i}`, tourism: "attraction" },
    }));
    expect(rankAndDedupe(elements, { topN: 10 }).candidates).toHaveLength(10);
  });

  it("survives a null/empty element list", () => {
    expect(rankAndDedupe(null)).toEqual({ candidates: [], hidden: 0 });
    expect(rankAndDedupe([])).toEqual({ candidates: [], hidden: 0 });
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
    ]).candidates;
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
