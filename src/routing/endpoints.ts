/**
 * Which public server answers which profile, and the attribution the UI owes
 * them.
 *
 * ## Why `profile` is a (host, path) pair — ADR 0001, binding
 *
 * `router.project-osrm.org` hosts **only the car graph**. It answers `/foot/`
 * and `/bike/` with HTTP 200 and `code: "Ok"` — and returns the driving route.
 * There is no error to detect; the failure mode is a plausible wrong answer,
 * and the default profile is `foot`, so the demo server would route walking
 * tours down Lower Wacker and report success.
 *
 * Measured Sheraton → Michigan Ave Bridge (ADR 0001):
 *
 * | host                      | profile | result            |
 * |---------------------------|---------|-------------------|
 * | OSRM demo                 | foot    | 611 m / 138 s     |
 * | OSRM demo                 | bike    | 611 m / 138 s     |
 * | OSRM demo                 | driving | 611 m / 138 s     |
 * | FOSSGIS `routed-foot`     | foot    | 1647 m / 1317 s   |
 * | FOSSGIS `routed-bike`     | bike    | 537 m / 241 s     |
 * | FOSSGIS `routed-car`      | driving | 611 m / 138 s     |
 *
 * Independently re-measured 2026-10-14 over a longer Chicago pair
 * (41.8781,-87.6298 → 41.8919,-87.6051): the demo server returned the same
 * 3442.6 m / 328.9 s for `driving`, `walking`, `cycling`, `foot`, `bike` and
 * `car`, while FOSSGIS returned 3594.3 m / 2874.9 s (foot, 1.25 m/s),
 * 3496.1 m / 1023.1 s (bike, 3.4 m/s) and 3442.6 m / 328.9 s (car).
 *
 * So each profile gets its own host *and* its own path segment. The OSRM demo
 * server is acceptable only as a secondary for `driving`
 * ({@link OSRM_DEMO_ENDPOINT}); nothing wires it in by default.
 *
 * Both hosts send `access-control-allow-origin: *`, which is what makes the
 * keyless, backend-free GitHub Pages deployment possible. Do not add request
 * headers: a custom header would trigger a CORS preflight that these servers
 * do not answer.
 *
 * ## Usage policy
 *
 * These are donated, rate-limited, no-SLA community endpoints. Failure is
 * expected, not exceptional (ADR 0001). The service keeps concurrency at 1,
 * spaces requests, debounces editor bursts and caches aggressively; the UI
 * falls back to a straight dashed line. Heavy or commercial use should
 * self-host OSRM; see <https://routing.openstreetmap.de/about.html>.
 */

import type { RouteProfile } from "./types";

export interface RoutingEndpoint {
  /** Base URL, no trailing slash; `/route/v1/...` is appended. */
  baseUrl: string;
  /** Path profile segment this host expects (ADR 0001's table). */
  pathProfile: string;
}

export type EndpointMap = Record<RouteProfile, RoutingEndpoint>;

/** Default: one FOSSGIS OSRM instance per travel mode. */
export const FOSSGIS_ENDPOINTS: EndpointMap = {
  foot: {
    baseUrl: "https://routing.openstreetmap.de/routed-foot",
    pathProfile: "foot",
  },
  bike: {
    baseUrl: "https://routing.openstreetmap.de/routed-bike",
    pathProfile: "bike",
  },
  driving: {
    baseUrl: "https://routing.openstreetmap.de/routed-car",
    pathProfile: "driving",
  },
};

/**
 * The OSRM demo server: **car graph only**. Usable as a secondary for
 * `driving`, never for `foot` or `bike` (it would answer them, wrongly).
 */
export const OSRM_DEMO_ENDPOINT: RoutingEndpoint = {
  baseUrl: "https://router.project-osrm.org",
  pathProfile: "driving",
};

/** Plain-text attribution. */
export const ROUTING_ATTRIBUTION =
  "Routing by OSRM / FOSSGIS · Map data © OpenStreetMap contributors";

/** Same, as HTML for Leaflet's attribution control. */
export const ROUTING_ATTRIBUTION_HTML =
  'Routing by <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noreferrer">OSRM / FOSSGIS</a>';

export function endpointFor(
  profile: RouteProfile,
  endpoints: EndpointMap = FOSSGIS_ENDPOINTS,
): RoutingEndpoint {
  return endpoints[profile] ?? endpoints.foot;
}
