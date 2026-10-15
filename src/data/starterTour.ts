/**
 * Curated static starter tour (task t_d7de7a2a).
 *
 * A first visit with no tour in the URL opens this populated, fully-editable
 * tour instead of a blank map — "choice-first UX": present a set of choices
 * already made that the user can trim, edit or clear, rather than an empty
 * form that demands typing (epic t_f3a98cf7). Since the URL is the only place
 * state lives (ADR 0002), a bare URL *always* lands here.
 *
 * It is a plain `Tour` built through the ordinary `createTour`/`createRoute`/
 * `createStop` factories, so every seeded stop is byte-for-byte the same shape
 * as a stop the user adds by clicking the map. There is no "seeded" or "locked"
 * flag anywhere: edit, delete and reorder all work identically, and the moment
 * the user changes anything the store encodes it into the share URL like any
 * other tour.
 *
 * Content: a six-stop downtown Chicago walking loop, mirroring the project's
 * reference brochure. Coordinates are real so the map and polyline render
 * sensibly on first load. The tour ships with a stable `id` so an untouched
 * starter round-trips deterministically through save/share.
 *
 * Note on "default route profile (walking)": the v2 schema (src/tour/schema.ts)
 * does not model a routing profile — routes are straight-segment polylines with
 * an optional manual `via`. The walking intent is therefore carried in the
 * route name and tagline; when the preset-controls work adds a profile field to
 * the schema, seed it here too.
 */

import {
  createRoute,
  createStop,
  createTour,
  DEFAULT_ROUTE_COLOR,
  type Tour,
} from "../tour/schema";

/** Stable id so an untouched starter saves/shares deterministically. */
export const STARTER_TOUR_ID = "tour_starter_chicago";

/**
 * Build a fresh copy of the curated starter tour. Returns a new object graph on
 * every call (the factories deep-copy), so mutating the result never leaks back
 * into the template.
 */
export function starterTour(): Tour {
  return createTour({
    id: STARTER_TOUR_ID,
    title: "Chicago Downtown Walking Tour",
    subtitle: "Chicago",
    tagline: "Six landmarks on foot — keep the ones you like, drop the rest.",
    description:
      "A curated starter walk through the Loop and the lakefront. " +
      "Every stop is editable: rename it, move the pin, add a photo, " +
      "reorder the list, or clear it all and start blank.",
    settings: { pageSize: "letter" },
    routes: [
      createRoute({
        id: "route_starter_walk",
        name: "Walking Route",
        color: DEFAULT_ROUTE_COLOR,
        stops: [
          createStop({
            id: "stop_cloud_gate",
            lat: 41.8827,
            lng: -87.6233,
            title: 'Cloud Gate ("The Bean")',
            category: "attraction",
            blurb: "Millennium Park, upper level off Michigan Avenue",
            description:
              "Anish Kapoor's mirror-polished stainless-steel sculpture, " +
              "reflecting the skyline and the crowds beneath its arch.",
          }),
          createStop({
            id: "stop_art_institute",
            lat: 41.8796,
            lng: -87.6237,
            title: "Art Institute of Chicago",
            category: "museum",
            blurb: "111 S Michigan Ave, guarded by the two bronze lions",
            description:
              "One of the oldest and largest art museums in the US, from " +
              "Impressionist masterpieces to the Thorne Miniature Rooms.",
          }),
          createStop({
            id: "stop_buckingham_fountain",
            lat: 41.8758,
            lng: -87.6189,
            title: "Buckingham Fountain",
            category: "historic",
            blurb: "Center of Grant Park, facing the lake",
          }),
          createStop({
            id: "stop_riverwalk",
            lat: 41.888,
            lng: -87.627,
            title: "Chicago Riverwalk",
            category: "nature",
            blurb: "South bank of the Chicago River at Michigan Avenue",
            description:
              "A pedestrian path hugging the river past cafes, kayak docks " +
              "and the city's celebrated architecture.",
          }),
          createStop({
            id: "stop_willis_skydeck",
            lat: 41.8789,
            lng: -87.6359,
            title: "Willis Tower Skydeck",
            category: "viewpoint",
            blurb: "233 S Wacker Dr, 103rd floor",
            description:
              "Glass-floored ledges that cantilever out over South Wacker " +
              "Drive, 412 metres below.",
          }),
          createStop({
            id: "stop_navy_pier",
            lat: 41.8917,
            lng: -87.6086,
            title: "Navy Pier",
            category: "attraction",
            blurb: "600 E Grand Ave, out over Lake Michigan",
            description:
              "A 1916 pier turned lakefront attraction: the Centennial " +
              "Wheel, boat tours and gardens.",
          }),
        ],
      }),
    ],
  });
}
