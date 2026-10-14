import { describe, expect, it } from "vitest";
import { createRoute, createStop } from "../tour";
import { routeBounds, routeLatLngs, stopLatLngs } from "./shape";

function route(points: [number, number][], via?: [number, number][]) {
  return createRoute({
    id: "r",
    name: "R",
    color: "#1E8449",
    stops: points.map(([lat, lng], i) =>
      createStop({ id: `s${i}`, lat, lng, title: `Stop ${i}` }),
    ),
    ...(via ? { via } : {}),
  });
}

describe("stopLatLngs", () => {
  it("follows itinerary order", () => {
    expect(
      stopLatLngs(
        route([
          [1, 1],
          [2, 2],
        ]),
      ),
    ).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });
});

describe("routeLatLngs", () => {
  it("is just the stops when there are no shape points", () => {
    expect(
      routeLatLngs(
        route([
          [41.88, -87.62],
          [41.89, -87.63],
        ]),
      ),
    ).toEqual([
      [41.88, -87.62],
      [41.89, -87.63],
    ]);
  });

  it("ignores shape points until there is a segment to bend", () => {
    expect(routeLatLngs(route([[41.88, -87.62]], [[41.885, -87.625]]))).toEqual(
      [[41.88, -87.62]],
    );
    expect(routeLatLngs(route([], [[41.885, -87.625]]))).toEqual([]);
  });

  it("inserts a shape point into the segment it lies nearest", () => {
    // Three stops in a line; the via point sits beside the SECOND segment.
    const line = routeLatLngs(
      route(
        [
          [41.88, -87.62],
          [41.88, -87.63],
          [41.88, -87.64],
        ],
        [[41.881, -87.635]],
      ),
    );
    expect(line).toEqual([
      [41.88, -87.62],
      [41.88, -87.63],
      [41.881, -87.635],
      [41.88, -87.64],
    ]);
  });

  it("orders several shape points on one segment by how far along they sit", () => {
    const line = routeLatLngs(
      route(
        [
          [41.88, -87.62],
          [41.88, -87.66],
        ],
        [
          // deliberately out of order in the array
          [41.881, -87.65],
          [41.881, -87.63],
          [41.881, -87.64],
        ],
      ),
    );
    expect(line).toEqual([
      [41.88, -87.62],
      [41.881, -87.63],
      [41.881, -87.64],
      [41.881, -87.65],
      [41.88, -87.66],
    ]);
  });

  it("re-flows shape points when the stops are reordered", () => {
    const forwards = route(
      [
        [41.88, -87.62],
        [41.88, -87.64],
        [41.9, -87.64],
      ],
      [[41.881, -87.63]],
    );
    const backwards = createRoute({
      ...forwards,
      stops: [...forwards.stops].reverse(),
    });
    // The point still lands between the two stops it is physically between,
    // whichever end of the itinerary they are now at.
    expect(routeLatLngs(backwards)).toEqual([
      [41.9, -87.64],
      [41.88, -87.64],
      [41.881, -87.63],
      [41.88, -87.62],
    ]);
  });

  it("keeps every vertex exactly once", () => {
    const r = route(
      [
        [41.88, -87.62],
        [41.88, -87.64],
        [41.9, -87.64],
      ],
      [
        [41.881, -87.63],
        [41.89, -87.641],
      ],
    );
    expect(routeLatLngs(r)).toHaveLength(5);
  });
});

describe("routeBounds", () => {
  it("covers stops and shape points, so fitting cannot clip a bend", () => {
    expect(
      routeBounds(
        route(
          [
            [41.88, -87.62],
            [41.88, -87.64],
          ],
          [[41.95, -87.63]],
        ),
      ),
    ).toEqual([
      [41.88, -87.62],
      [41.88, -87.64],
      [41.95, -87.63],
    ]);
  });
});
