/**
 * Encoded-polyline decoder (Google's algorithm, as OSRM's
 * `geometries=polyline` emits it at precision 5).
 *
 * ADR 0001 requires `overview=full&geometries=polyline`: `simplified` is too
 * coarse at city-block zoom (67–79 points for an 18 km loop), and polyline is
 * ~3× smaller on the wire than raw GeoJSON coordinates.
 *
 * Polyline order is already `[lat, lng]` — no flip, unlike GeoJSON.
 */

import { roundCoord } from "./geometry";
import type { LatLng } from "./types";

/** Returns `null` for anything that is not a well-formed encoded polyline. */
export function decodePolyline(
  encoded: unknown,
  precision = 5,
): LatLng[] | null {
  if (typeof encoded !== "string") return null;
  if (encoded.length === 0) return [];

  const factor = 10 ** precision;
  const coords: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    for (const target of ["lat", "lng"] as const) {
      shift = 0;
      result = 0;
      do {
        if (index >= encoded.length) return null; // truncated varint
        byte = encoded.charCodeAt(index++) - 63;
        if (byte < 0 || byte > 63) return null; // outside the ASCII alphabet
        result |= (byte & 0x1f) << shift;
        shift += 5;
        if (shift > 35) return null; // overlong varint
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (target === "lat") lat += delta;
      else lng += delta;
    }
    coords.push([roundCoord(lat / factor), roundCoord(lng / factor)]);
  }

  return coords;
}
