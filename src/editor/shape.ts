/**
 * Polyline geometry for a route.
 *
 * v1 draws straight segments between stops (SPEC D4 — no routing service).
 * `Route.via` is the fidelity escape hatch: free shape points the author drags
 * onto the line to bend it around a block or off the water.
 *
 * `via` is a flat `[lat,lng][]` with no anchoring index, so where each point
 * belongs has to be derived. Each via point is assigned to the stop-to-stop
 * segment it lies nearest to, and points sharing a segment are ordered by how
 * far along that segment they project. That is stable under reload (the same
 * array yields the same line) and under dragging a handle a short distance,
 * and it means reordering stops re-flows the shape points instead of
 * scrambling the line.
 */

import type { Route } from "../tour";

export type LatLng = [number, number];

/** Equirectangular projection, good enough at city scale and cheap. */
function project(point: LatLng, cosLat: number): [number, number] {
  return [point[1] * cosLat, point[0]];
}

interface Assignment {
  segment: number;
  t: number;
  point: LatLng;
}

/**
 * Nearest point on segment a→b to p, as the parameter t in [0,1] plus the
 * squared distance. Degenerate (zero-length) segments return t = 0.
 */
function projectOntoSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): { t: number; d2: number } {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const len2 = abx * abx + aby * aby;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2));
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  return { t, d2: dx * dx + dy * dy };
}

/** Stop coordinates in itinerary order. */
export function stopLatLngs(route: Route): LatLng[] {
  return route.stops.map((stop) => [stop.lat, stop.lng] as LatLng);
}

/**
 * Vertices Leaflet should draw for this route: the stops in order with any
 * `via` shape points woven into the segment they belong to.
 *
 * With fewer than two stops there are no segments to bend, so `via` is
 * ignored (the line itself does not exist yet).
 */
export function routeLatLngs(route: Route): LatLng[] {
  const stops = stopLatLngs(route);
  const via = route.via ?? [];
  if (stops.length < 2 || via.length === 0) return stops;

  const cosLat =
    Math.cos(
      (stops.reduce((sum, p) => sum + p[0], 0) / stops.length) *
        (Math.PI / 180),
    ) || 1;
  const flat = stops.map((p) => project(p, cosLat));

  const assigned: Assignment[] = via.map((raw) => {
    const point: LatLng = [raw[0], raw[1]];
    const p = project(point, cosLat);
    let best: Assignment = { segment: 0, t: 0, point };
    let bestD2 = Number.POSITIVE_INFINITY;
    for (let i = 0; i < flat.length - 1; i++) {
      const { t, d2 } = projectOntoSegment(p, flat[i], flat[i + 1]);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { segment: i, t, point };
      }
    }
    return best;
  });

  const out: LatLng[] = [];
  for (let i = 0; i < stops.length; i++) {
    out.push(stops[i]);
    if (i === stops.length - 1) break;
    const inSegment = assigned
      .filter((a) => a.segment === i)
      .sort((a, b) => a.t - b.t);
    for (const a of inSegment) out.push(a.point);
  }
  return out;
}

/** Bounding box of everything a route draws, or null when it draws nothing. */
export function routeBounds(route: Route): LatLng[] {
  return [
    ...stopLatLngs(route),
    ...(route.via ?? []).map((p) => [p[0], p[1]] as LatLng),
  ];
}
