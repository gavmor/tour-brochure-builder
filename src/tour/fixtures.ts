/** Shared fixtures for the tour store tests. */

import { createRoute, createStop, createTour, type Tour } from "./schema";

/** A two-route Chicago-ish tour, mirroring the reference brochure's shape. */
export function twoRouteTour(): Tour {
  return createTour({
    id: "tour_fixture",
    title: "Downtown Tour",
    tagline: "Hop on and hop off to experience both routes!",
    subtitle: "Chicago",
    description: "A two-route loop of the Loop.",
    settings: { pageSize: "letter" },
    routes: [
      createRoute({
        id: "route_green",
        name: "Green Route",
        color: "#1E8449",
        via: [
          [41.8902, -87.6185],
          [41.8885, -87.6201],
        ],
        stops: [
          createStop({
            id: "stop_sheraton_g",
            lat: 41.8896,
            lng: -87.6208,
            title: "Sheraton Hotel",
            blurb:
              "Northeast corner of Columbus and North Water, across from the NBC Tower",
            description: "The riverside hotel where both loops begin.",
            imageUrl: "https://example.com/sheraton.jpg",
          }),
          createStop({
            id: "stop_bridge",
            lat: 41.8882,
            lng: -87.6245,
            title: "Michigan Avenue Bridge",
            blurb: "Northwest corner of Wacker and Michigan",
          }),
          createStop({
            id: "stop_skydeck",
            lat: 41.8789,
            lng: -87.6359,
            title: "Skydeck",
            description:
              "The 103rd-floor observation deck of the Willis Tower, with glass ledges that cantilever out over South Wacker Drive far below.",
          }),
        ],
      }),
      createRoute({
        id: "route_red",
        name: "Red Route",
        color: "#C0392B",
        stops: [
          createStop({
            id: "stop_sheraton_r",
            lat: 41.8896,
            lng: -87.6208,
            title: "Sheraton Hotel",
            blurb: "Northeast corner of Columbus and North Water",
          }),
          createStop({
            id: "stop_navy_pier",
            lat: 41.8917,
            lng: -87.6086,
            title: "Navy Pier",
            blurb: "River taxis on the north side",
          }),
        ],
      }),
    ],
  });
}

/** A tour with `count` stops spread over `routeCount` routes. */
export function bigTour(count = 20, routeCount = 2): Tour {
  const routes = Array.from({ length: routeCount }, (_, r) =>
    createRoute({ id: `route_${r}`, name: `Route ${r + 1}`, stops: [] }, r),
  );
  for (let i = 0; i < count; i++) {
    routes[i % routeCount].stops.push(
      createStop({
        id: `stop_${i}`,
        lat: 41.8 + i * 0.001,
        lng: -87.6 - i * 0.001,
        title: `Stop number ${i + 1}`,
        blurb: `A one-line locator for stop ${i + 1}, on the corner of Nowhere and Elsewhere`,
        description: `A longer paragraph about stop ${i + 1}. `.repeat(3),
        imageUrl: `https://example.com/photos/stop-${i}.jpg`,
      }),
    );
  }
  return createTour({ id: "tour_big", title: "Twenty Stop Tour", routes });
}

/** Legacy `version: 1` payload, the one migration the validator will see. */
export function v1Tour() {
  return {
    version: 1,
    id: "tour_legacy",
    title: "Legacy Flat Tour",
    subtitle: "Saved by an older build",
    stops: [
      {
        id: "s1",
        lat: 41.88,
        lng: -87.62,
        title: "First",
        description: "First stop.",
      },
      { id: "s2", lat: 41.89, lng: -87.63, title: "Second" },
    ],
  };
}
