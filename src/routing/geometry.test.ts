import { describe, expect, it } from "vitest";
import {
  chunkWaypoints,
  geoJsonToLatLngs,
  joinLegs,
  roundCoord,
  toLineString,
} from "./geometry";
import type { LatLng } from "./types";

describe("roundCoord", () => {
  it("keeps 5 decimals and normalises -0", () => {
    expect(roundCoord(41.881832123)).toBe(41.88183);
    expect(roundCoord(-87.623177987)).toBe(-87.62318);
    expect(roundCoord(-0.000001)).toBe(0);
  });
});

describe("geoJsonToLatLngs", () => {
  it("flips [lon, lat] to [lat, lng] and rounds", () => {
    expect(
      geoJsonToLatLngs([
        [-87.6298123, 41.8781456],
        [-87.6051, 41.8919],
      ]),
    ).toEqual([
      [41.87815, -87.62981],
      [41.8919, -87.6051],
    ]);
  });

  it("rejects anything that is not a list of finite numeric pairs", () => {
    expect(geoJsonToLatLngs("nope")).toBeNull();
    expect(geoJsonToLatLngs([[1]])).toBeNull();
    expect(geoJsonToLatLngs([["a", "b"]])).toBeNull();
    expect(geoJsonToLatLngs([[Number.NaN, 1]])).toBeNull();
  });

  it("maps an empty list to an empty list, not a failure", () => {
    expect(geoJsonToLatLngs([])).toEqual([]);
  });
});

describe("toLineString", () => {
  it("round-trips back to GeoJSON order", () => {
    const coords: LatLng[] = [
      [41.88, -87.63],
      [41.89, -87.61],
    ];
    expect(toLineString(coords)).toEqual({
      type: "LineString",
      coordinates: [
        [-87.63, 41.88],
        [-87.61, 41.89],
      ],
    });
    expect(geoJsonToLatLngs(toLineString(coords).coordinates)).toEqual(coords);
  });
});

describe("chunkWaypoints", () => {
  const stops = (n: number): LatLng[] =>
    Array.from({ length: n }, (_, i) => [41 + i / 100, -87] as LatLng);

  it("leaves a short list alone", () => {
    expect(chunkWaypoints(stops(3), 100)).toHaveLength(1);
  });

  it("overlaps chunks by one stop so legs meet", () => {
    const chunks = chunkWaypoints(stops(7), 3);
    expect(chunks.map((c) => c.length)).toEqual([3, 3, 3]);
    expect(chunks[0][2]).toEqual(chunks[1][0]);
    expect(chunks[1][2]).toEqual(chunks[2][0]);
    expect(chunks[2][2]).toEqual(stops(7)[6]);
  });

  it("never emits a one-stop trailing chunk", () => {
    for (const n of [4, 5, 6, 8, 9, 10, 11]) {
      for (const max of [2, 3, 4, 5]) {
        const chunks = chunkWaypoints(stops(n), max);
        expect(chunks.every((c) => c.length >= 2)).toBe(true);
        const last = chunks[chunks.length - 1];
        expect(last[last.length - 1]).toEqual(stops(n)[n - 1]);
      }
    }
  });
});

describe("joinLegs", () => {
  it("drops the duplicated point at each seam", () => {
    expect(
      joinLegs([
        [
          [1, 1],
          [2, 2],
        ],
        [
          [2, 2],
          [3, 3],
        ],
      ]),
    ).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("keeps both points when the legs do not touch", () => {
    expect(
      joinLegs([
        [
          [1, 1],
          [2, 2],
        ],
        [
          [2.5, 2.5],
          [3, 3],
        ],
      ]),
    ).toHaveLength(4);
  });
});
