import { describe, expect, it } from "vitest";
import { decodePolyline } from "./polyline";
import { encodePolyline } from "./testDoubles";
import type { LatLng } from "./types";

describe("decodePolyline", () => {
  it("decodes the canonical Google fixture", () => {
    // From the Encoded Polyline Algorithm Format spec.
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it("round-trips street-scale coordinates at 5 decimals", () => {
    const line: LatLng[] = [
      [41.87815, -87.62981],
      [41.87902, -87.62977],
      [41.88104, -87.62812],
      [41.8919, -87.6051],
    ];
    expect(decodePolyline(encodePolyline(line))).toEqual(line);
  });

  it("handles precision 6 when asked", () => {
    const line: LatLng[] = [
      [41.878153, -87.629817],
      [41.891901, -87.605102],
    ];
    expect(decodePolyline(encodePolyline(line, 6), 6)).toEqual([
      [41.87815, -87.62982], // rounded to the module's 5-decimal grain
      [41.8919, -87.6051],
    ]);
  });

  it("returns an empty line for an empty string", () => {
    expect(decodePolyline("")).toEqual([]);
  });

  it("rejects non-strings", () => {
    expect(decodePolyline(undefined)).toBeNull();
    expect(decodePolyline(42)).toBeNull();
    expect(decodePolyline({ type: "LineString" })).toBeNull();
  });

  it("rejects a truncated varint instead of inventing a point", () => {
    const encoded = encodePolyline([
      [41.878, -87.629],
      [41.891, -87.605],
    ]);
    expect(decodePolyline(encoded.slice(0, encoded.length - 1))).toBeNull();
  });

  it("rejects characters outside the polyline alphabet", () => {
    expect(decodePolyline("_p~iF~ps|U\u2028")).toBeNull();
    expect(decodePolyline("!!!")).toBeNull();
  });
});
