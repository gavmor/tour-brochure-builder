import { describe, expect, it } from "vitest";
import { bigTour, twoRouteTour, v1Tour } from "./fixtures";
import { TOUR_SCHEMA_VERSION } from "./schema";
import { isTour, parseTour, parseTourJson, serializeTour } from "./validate";

function ok(result: ReturnType<typeof parseTour>) {
  if (!result.ok)
    throw new Error(`expected a valid tour, got: ${result.errors.join("; ")}`);
  return result;
}

describe("JSON round-trip", () => {
  it("round-trips a two-route tour identically", () => {
    const tour = twoRouteTour();
    const back = ok(parseTourJson(serializeTour(tour))).tour;
    expect(back).toEqual(tour);
    expect(serializeTour(back)).toBe(serializeTour(tour));
  });

  it("round-trips a 20-stop tour identically", () => {
    const tour = bigTour(20, 2);
    const back = ok(parseTourJson(serializeTour(tour))).tour;
    expect(back).toEqual(tour);
    expect(back.routes.flatMap((r) => r.stops)).toHaveLength(20);
  });

  it("is stable over repeated serialize/parse cycles", () => {
    const first = serializeTour(twoRouteTour());
    const second = serializeTour(ok(parseTourJson(first)).tour);
    const third = serializeTour(ok(parseTourJson(second)).tour);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("pretty mode is readable and parses back the same", () => {
    const tour = twoRouteTour();
    const pretty = serializeTour(tour, true);
    expect(pretty).toContain("\n  ");
    expect(ok(parseTourJson(pretty)).tour).toEqual(tour);
  });
});

describe("migration", () => {
  it("wraps a version 1 flat stops[] in one default route", () => {
    const result = ok(parseTour(v1Tour()));
    expect(result.migratedFrom).toBe(1);
    expect(result.tour.version).toBe(TOUR_SCHEMA_VERSION);
    expect(result.tour.routes).toHaveLength(1);
    expect(result.tour.routes[0].stops.map((s) => s.title)).toEqual([
      "First",
      "Second",
    ]);
    expect(result.tour.id).toBe("tour_legacy");
    expect(result.tour.subtitle).toBe("Saved by an older build");
    expect(result.warnings.join(" ")).toMatch(/version 1/i);
    expect("stops" in result.tour).toBe(false);
  });

  it("treats a version-less flat tour as v1", () => {
    const { version: _v, ...noVersion } = v1Tour();
    const result = ok(parseTour(noVersion));
    expect(result.tour.routes[0].stops).toHaveLength(2);
  });

  it("treats a version-less nested tour as v2", () => {
    const { version: _v, ...noVersion } = twoRouteTour();
    const result = ok(parseTour(noVersion));
    expect(result.migratedFrom).toBeUndefined();
    expect(result.tour.routes).toHaveLength(2);
  });

  it("refuses data from a newer schema rather than mangling it", () => {
    const future = { ...twoRouteTour(), version: 99 };
    const result = parseTour(future);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/newer version/i);
  });
});

describe("rejecting bad input", () => {
  it.each([
    ["null", null],
    ["a string", "just a string"],
    ["a number", 42],
    ["an array", [{ lat: 1, lng: 2 }]],
  ])("rejects %s", (_label, input) => {
    const result = parseTour(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/expected a JSON object/i);
  });

  it("rejects malformed JSON text", () => {
    const result = parseTourJson("{ not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/not valid json/i);
  });

  it("rejects a non-integer version", () => {
    expect(parseTour({ version: "banana", routes: [] }).ok).toBe(false);
  });
});

describe("repairing salvageable input", () => {
  it("drops stops with missing or non-numeric coordinates", () => {
    const result = ok(
      parseTour({
        version: 2,
        id: "t",
        title: "Patchy",
        routes: [
          {
            id: "r",
            name: "R",
            color: "#000",
            stops: [
              { id: "a", lat: 41.8, lng: -87.6, title: "Good" },
              { id: "b", lng: -87.6, title: "No lat" },
              { id: "c", lat: "nope", lng: -87.6, title: "Bad lat" },
              "not an object",
              { id: "d", lat: 999, lng: -87.6, title: "Off the planet" },
            ],
          },
        ],
      }),
    );
    expect(result.tour.routes[0].stops.map((s) => s.title)).toEqual(["Good"]);
    expect(result.warnings).toHaveLength(4);
  });

  it("accepts numeric strings for coordinates", () => {
    const result = ok(
      parseTour({
        version: 2,
        id: "t",
        title: "Strings",
        routes: [
          {
            id: "r",
            name: "R",
            color: "#000",
            stops: [{ id: "a", lat: "41.8", lng: "-87.6", title: "Coerced" }],
          },
        ],
      }),
    );
    expect(result.tour.routes[0].stops[0]).toMatchObject({
      lat: 41.8,
      lng: -87.6,
    });
  });

  it("generates missing ids and titles instead of failing", () => {
    const result = ok(
      parseTour({
        version: 2,
        routes: [{ name: "R", stops: [{ lat: 1, lng: 2 }] }],
      }),
    );
    expect(result.tour.id).toBeTruthy();
    expect(result.tour.title).toBe("Untitled tour");
    expect(result.tour.routes[0].id).toBeTruthy();
    expect(result.tour.routes[0].color).toBeTruthy();
    expect(result.tour.routes[0].stops[0].title).toBe("Untitled stop");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("drops non-https image URLs (SPEC D3)", () => {
    const result = ok(
      parseTour({
        version: 2,
        id: "t",
        title: "Images",
        routes: [
          {
            id: "r",
            name: "R",
            color: "#000",
            stops: [
              {
                id: "a",
                lat: 1,
                lng: 2,
                title: "Insecure",
                imageUrl: "http://example.com/a.jpg",
              },
              {
                id: "b",
                lat: 1,
                lng: 2,
                title: "Nonsense",
                imageUrl: "not a url",
              },
              {
                id: "c",
                lat: 1,
                lng: 2,
                title: "Fine",
                imageUrl: "https://example.com/c.jpg",
              },
            ],
          },
        ],
      }),
    );
    const stops = result.tour.routes[0].stops;
    expect(stops[0].imageUrl).toBeUndefined();
    expect(stops[1].imageUrl).toBeUndefined();
    expect(stops[2].imageUrl).toBe("https://example.com/c.jpg");
    expect(result.warnings.filter((w) => /image/i.test(w))).toHaveLength(2);
  });

  it("keeps well-formed via points and drops malformed ones", () => {
    const result = ok(
      parseTour({
        version: 2,
        id: "t",
        title: "Via",
        routes: [
          {
            id: "r",
            name: "R",
            color: "#000",
            stops: [],
            via: [[41.9, -87.6], [1], ["a", "b"], [41.8, -87.7]],
          },
        ],
      }),
    );
    expect(result.tour.routes[0].via).toEqual([
      [41.9, -87.6],
      [41.8, -87.7],
    ]);
  });

  it("gives a routeless tour an empty default route", () => {
    const result = ok(
      parseTour({ version: 2, id: "t", title: "Empty", routes: [] }),
    );
    expect(result.tour.routes).toHaveLength(1);
    expect(result.tour.routes[0].stops).toEqual([]);
  });

  it("strips unknown keys", () => {
    const result = ok(
      parseTour({
        version: 2,
        id: "t",
        title: "T",
        routes: [],
        evil: "<script>",
        rank: 3,
      }),
    );
    expect("evil" in result.tour).toBe(false);
    expect("rank" in result.tour).toBe(false);
  });

  it("drops an unknown page size but keeps the rest of settings", () => {
    const result = ok(
      parseTour({
        version: 2,
        id: "t",
        title: "T",
        routes: [],
        settings: { pageSize: "poster", basemap: "osm" },
      }),
    );
    expect(result.tour.settings).toEqual({ basemap: "osm" });
  });
});

describe("isTour", () => {
  it("accepts canonical tours and rejects raw input", () => {
    expect(isTour(twoRouteTour())).toBe(true);
    expect(isTour(v1Tour())).toBe(false);
    expect(isTour({ version: 2, id: "t", title: "T" })).toBe(false);
    expect(isTour(null)).toBe(false);
  });
});

/**
 * ADR 0001's four backward-compatibility cases. `profile` is additive inside
 * schema v2, so every link ever shared — and every link an older deployed
 * build emits — has to keep loading.
 */
describe("Route.profile (ADR 0001)", () => {
  const base = {
    version: 2,
    id: "t",
    title: "T",
    routes: [{ id: "r1", name: "R", color: "#1E8449", stops: [] }],
  };

  function withProfile(profile: unknown) {
    return {
      ...base,
      routes: [{ ...base.routes[0], profile }],
    };
  }

  it("case 1: a v2 tour with no profile loads and behaves as foot", () => {
    const result = ok(parseTour(base));
    expect(result.warnings).toEqual([]);
    expect("profile" in result.tour.routes[0]).toBe(false);
    expect(result.tour.routes[0].profile ?? "foot").toBe("foot");
  });

  it("keeps a non-default profile", () => {
    expect(ok(parseTour(withProfile("driving"))).tour.routes[0].profile).toBe(
      "driving",
    );
    expect(ok(parseTour(withProfile("bike"))).tour.routes[0].profile).toBe(
      "bike",
    );
  });

  it("case 2: a junk profile warns and falls back, it never fails the parse", () => {
    const result = ok(parseTour(withProfile("teleport")));
    expect(result.tour.routes[0].profile).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("teleport");
    expect(result.warnings.join(" ")).toContain("foot");
  });

  it("does not reject a profile of the wrong type either", () => {
    expect(
      ok(parseTour(withProfile(7))).tour.routes[0].profile,
    ).toBeUndefined();
    expect(ok(parseTour(withProfile(null))).warnings).toEqual([]);
  });

  it("case 3: a v1 flat-stops tour migrates and takes the default", () => {
    const result = ok(parseTour(v1Tour()));
    expect(result.migratedFrom).toBe(1);
    expect("profile" in result.tour.routes[0]).toBe(false);
  });

  it("drops an explicit default so a parse matches the factory exactly", () => {
    // `createRoute` omits `foot`; if repair kept it, a tour would serialize
    // differently depending on where it came from.
    const result = ok(parseTour(withProfile("foot")));
    expect("profile" in result.tour.routes[0]).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("case 4: a mixed-profile tour round-trips byte-identically", () => {
    const mixed = {
      ...base,
      routes: [
        { ...base.routes[0], id: "r1", profile: "driving" },
        { id: "r2", name: "R2", color: "#C0392B", stops: [], profile: "bike" },
        { id: "r3", name: "R3", color: "#1F3A5F", stops: [] },
      ],
    };
    const once = ok(parseTour(mixed)).tour;
    const twice = ok(parseTourJson(serializeTour(once))).tour;
    expect(serializeTour(twice)).toBe(serializeTour(once));
    expect(once.routes.map((r) => r.profile)).toEqual([
      "driving",
      "bike",
      undefined,
    ]);
    // Only the two non-default routes spend URL budget on a profile key.
    expect(serializeTour(once).match(/"profile"/g)).toHaveLength(2);
  });

  it("keeps the schema version at 2 — an old build must not reject new links", () => {
    expect(ok(parseTour(withProfile("driving"))).tour.version).toBe(
      TOUR_SCHEMA_VERSION,
    );
    expect(TOUR_SCHEMA_VERSION).toBe(2);
  });
});
