/**
 * OSRM transport: one HTTP request in, one {@link RoutingResult} out.
 *
 * No cache, no debounce, no queue — those live in `service.ts`. Nothing here
 * throws at the caller; every failure mode becomes a structured
 * `{ ok: false, reason }`.
 */

import { type EndpointMap, endpointFor } from "./endpoints";
import {
  chunkWaypoints,
  geoJsonToLatLngs,
  joinLegs,
  roundCoord,
} from "./geometry";
import { decodePolyline } from "./polyline";
import {
  DEFAULT_MAX_WAYPOINTS,
  DEFAULT_TIMEOUT_MS,
  type LatLng,
  type RouteProfile,
  type RoutingFailure,
  type RoutingResult,
} from "./types";

export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<Response>;

export interface OsrmRequestOptions {
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  /** Abort budget for a single HTTP request. Default 8s. */
  timeoutMs?: number;
  /** Caller cancellation (supersede, unmount). */
  signal?: AbortSignal;
  endpoints?: EndpointMap;
  /** Waypoints per request before chunking. Default 100. */
  maxWaypointsPerRequest?: number;
  /** Awaited between chunked leg requests, for endpoint politeness. */
  onBetweenLegs?: () => Promise<void>;
}

/** `lon,lat;lon,lat;…` — OSRM's coordinate list is GeoJSON-ordered. */
export function formatWaypoints(waypoints: LatLng[]): string {
  return waypoints
    .map(([lat, lng]) => `${roundCoord(lng)},${roundCoord(lat)}`)
    .join(";");
}

export function buildOsrmUrl(
  waypoints: LatLng[],
  profile: RouteProfile,
  endpoints?: EndpointMap,
): string {
  const endpoint = endpointFor(profile, endpoints);
  const path = `${endpoint.baseUrl}/route/v1/${endpoint.pathProfile}/${formatWaypoints(waypoints)}`;
  // ADR 0001: `overview=full` (simplified is too coarse at city-block zoom)
  // and `geometries=polyline` (~3x smaller on the wire than GeoJSON coords).
  // `continue_straight=false` lets the router turn around at a waypoint
  // instead of overshooting it — correct for tour stops on a one-way street.
  return `${path}?overview=full&geometries=polyline&continue_straight=false`;
}

/** `Retry-After` is seconds or an HTTP-date. Returns ms, or undefined. */
export function parseRetryAfter(
  header: string | null,
  now = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(header);
  if (Number.isNaN(when)) return undefined;
  return Math.max(0, when - now);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function mapOsrmCode(code: string, message?: string): RoutingFailure {
  const reason =
    code === "NoRoute" || code === "NoSegment" ? "no-route" : "api-error";
  return { ok: false, reason, detail: message ? `${code}: ${message}` : code };
}

/**
 * Single OSRM `/route/v1` call for 2…N waypoints.
 *
 * `waypoints` is the ordered routing input — a route's stops *plus* any `via`
 * shape points, already merged in itinerary order by the caller (ADR 0001:
 * `via` points are passed to the router, not discarded).
 *
 * Exported for tests and for callers that have already chunked; most code
 * should use {@link requestRouteGeometry}.
 */
export async function requestOsrmLeg(
  waypoints: LatLng[],
  profile: RouteProfile,
  options: OsrmRequestOptions = {},
): Promise<RoutingResult> {
  const {
    fetchImpl = globalThis.fetch?.bind(globalThis) as FetchLike | undefined,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    endpoints,
  } = options;

  if (waypoints.length < 2) return { ok: false, reason: "too-few-stops" };
  if (!fetchImpl) {
    return { ok: false, reason: "network-error", detail: "fetch unavailable" };
  }
  if (signal?.aborted) return { ok: false, reason: "cancelled" };

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    // No custom headers: anything beyond a simple GET triggers a CORS
    // preflight the public endpoints do not answer.
    const response = await fetchImpl(
      buildOsrmUrl(waypoints, profile, endpoints),
      {
        signal: controller.signal,
      },
    );

    if (response.status === 429) {
      return {
        ok: false,
        reason: "rate-limited",
        status: 429,
        retryAfterMs: parseRetryAfter(
          response.headers?.get?.("Retry-After") ?? null,
        ),
      };
    }
    if (!response.ok) {
      return { ok: false, reason: "http-error", status: response.status };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      return {
        ok: false,
        reason: "malformed-response",
        detail: errorDetail(error),
      };
    }
    return parseOsrmBody(body);
  } catch (error) {
    if (timedOut) return { ok: false, reason: "timeout" };
    if (signal?.aborted || isAbortError(error)) {
      return { ok: false, reason: "cancelled" };
    }
    return { ok: false, reason: "network-error", detail: errorDetail(error) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

/**
 * OSRM's `geometry` field, in whichever shape `geometries=` asked for.
 *
 * We request `polyline` (ADR 0001), but GeoJSON is still accepted so the
 * parser keeps working if a caller overrides the query or a mirror answers
 * differently.
 */
export function parseGeometry(geometry: unknown): LatLng[] | null {
  if (typeof geometry === "string") return decodePolyline(geometry);
  if (typeof geometry === "object" && geometry !== null) {
    return geoJsonToLatLngs(
      (geometry as { coordinates?: unknown }).coordinates,
    );
  }
  return null;
}

/** Validate an OSRM response body and extract its first route's geometry. */
export function parseOsrmBody(body: unknown): RoutingResult {
  if (typeof body !== "object" || body === null) {
    return {
      ok: false,
      reason: "malformed-response",
      detail: "body is not an object",
    };
  }
  const payload = body as {
    code?: unknown;
    message?: unknown;
    routes?: unknown;
  };

  if (typeof payload.code !== "string") {
    return { ok: false, reason: "malformed-response", detail: "missing code" };
  }
  if (payload.code !== "Ok") {
    return mapOsrmCode(
      payload.code,
      typeof payload.message === "string" ? payload.message : undefined,
    );
  }

  const routes = payload.routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    return { ok: false, reason: "no-route", detail: "Ok with no routes" };
  }
  const geometry = (routes[0] as { geometry?: unknown })?.geometry;
  const coords = parseGeometry(geometry);
  if (!coords) {
    return { ok: false, reason: "malformed-response", detail: "bad geometry" };
  }
  if (coords.length < 2) {
    return {
      ok: false,
      reason: "malformed-response",
      detail: "geometry too short",
    };
  }
  return { ok: true, coords, fromCache: false };
}

/**
 * Road geometry for an ordered waypoint list (stops plus any `via` points),
 * chunking into overlapping legs when there are more waypoints than one
 * request should carry.
 *
 * The first failing leg aborts the whole route: half a line is worse than a
 * documented fallback to the straight polyline.
 */
export async function requestRouteGeometry(
  waypoints: LatLng[],
  profile: RouteProfile,
  options: OsrmRequestOptions = {},
): Promise<RoutingResult> {
  if (waypoints.length < 2) return { ok: false, reason: "too-few-stops" };

  const chunks = chunkWaypoints(
    waypoints,
    options.maxWaypointsPerRequest ?? DEFAULT_MAX_WAYPOINTS,
  );
  const legs: LatLng[][] = [];
  for (const [index, chunk] of chunks.entries()) {
    if (index > 0 && options.onBetweenLegs) await options.onBetweenLegs();
    if (options.signal?.aborted) return { ok: false, reason: "cancelled" };
    const result = await requestOsrmLeg(chunk, profile, options);
    if (!result.ok) return result;
    legs.push(result.coords);
  }
  return { ok: true, coords: joinLegs(legs), fromCache: false };
}
