/**
 * Coordinate plumbing: rounding, GeoJSON ↔ Leaflet order, leg stitching.
 *
 * Pure functions — no fetch, no timers, no Leaflet.
 */

import { COORD_PRECISION, type GeoJsonLineString, type LatLng } from "./types";

/** Round to {@link COORD_PRECISION} decimals (~1.1 m) and normalise `-0`. */
export function roundCoord(n: number, precision = COORD_PRECISION): number {
  const factor = 10 ** precision;
  const rounded = Math.round(n * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function isFiniteCoordPair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

/**
 * GeoJSON `[lon, lat]` → Leaflet `[lat, lng]`, rounded.
 *
 * Returns `null` if any element is not a finite numeric pair, so the caller
 * can report `malformed-response` instead of drawing `NaN` onto the map.
 */
export function geoJsonToLatLngs(coordinates: unknown): LatLng[] | null {
  if (!Array.isArray(coordinates)) return null;
  const out: LatLng[] = [];
  for (const pair of coordinates) {
    if (!isFiniteCoordPair(pair)) return null;
    out.push([roundCoord(pair[1]), roundCoord(pair[0])]);
  }
  return out;
}

/** Leaflet `[lat, lng]` → a GeoJSON LineString (`[lon, lat]`). */
export function toLineString(coords: LatLng[]): GeoJsonLineString {
  return {
    type: "LineString",
    coordinates: coords.map(([lat, lng]) => [lng, lat]),
  };
}

export function sameCoord(a: LatLng | undefined, b: LatLng | undefined) {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

/**
 * Split waypoints into overlapping chunks of at most `max`, so consecutive
 * chunks share the stop they meet at and the stitched line has no gap.
 *
 * `max = 3`, 7 stops → `[0,1,2] [2,3,4] [4,5,6]`.
 */
export function chunkWaypoints(stops: LatLng[], max: number): LatLng[][] {
  const limit = Math.max(2, Math.floor(max));
  if (stops.length <= limit) return [stops];
  const chunks: LatLng[][] = [];
  for (let start = 0; start < stops.length - 1; start += limit - 1) {
    chunks.push(stops.slice(start, start + limit));
  }
  return chunks;
}

/** Concatenate leg geometries, dropping the duplicated point at each seam. */
export function joinLegs(legs: LatLng[][]): LatLng[] {
  const out: LatLng[] = [];
  for (const leg of legs) {
    const start = sameCoord(out[out.length - 1], leg[0]) ? 1 : 0;
    for (let i = start; i < leg.length; i++) out.push(leg[i]);
  }
  return out;
}
