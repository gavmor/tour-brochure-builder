/**
 * Routing service — public types.
 *
 * The service never throws at its callers: every path resolves to a
 * {@link RoutingResult}, either `{ ok: true, coords }` or
 * `{ ok: false, reason }`. Callers decide how to degrade (the editor and the
 * brochure fall back to the straight polyline — SPEC D4).
 */

/**
 * Travel mode for a route, and the value persisted as `Route.profile` in the
 * share URL. Names are fixed by ADR 0001 — `driving`, not `car`, is what goes
 * on the wire. Each profile maps to its own routing *host* (see
 * `endpoints.ts`), not just a path segment.
 */
export type RouteProfile = "foot" | "bike" | "driving";

/**
 * A `const` tuple, not a widened array (ADR 0001's snippet): `z.enum()` in
 * `src/tour/validate.ts` needs the literal members to build the share-URL
 * schema from this one list instead of redeclaring it.
 */
export const ROUTE_PROFILES = [
  "foot",
  "bike",
  "driving",
] as const satisfies readonly RouteProfile[];

/** Walking tours are the common case; absent `Route.profile` means foot. */
export const DEFAULT_ROUTE_PROFILE: RouteProfile = "foot";

export function isRouteProfile(value: unknown): value is RouteProfile {
  return (
    typeof value === "string" &&
    (ROUTE_PROFILES as readonly string[]).includes(value)
  );
}

/**
 * Anything a caller might reasonably hand us for a profile: the canonical
 * names, the UI's "car"/"walk" wording, or a legacy OSRM profile name.
 */
export type RouteProfileInput = RouteProfile | (string & {});

const PROFILE_ALIASES: Record<string, RouteProfile> = {
  car: "driving",
  drive: "driving",
  driving: "driving",
  walk: "foot",
  walking: "foot",
  foot: "foot",
  bike: "bike",
  bicycle: "bike",
  cycling: "bike",
};

/**
 * Normalise a profile to its canonical name, falling back to the default.
 *
 * The UI calls the driving profile "car" (t_2c1641fe's selector) while the
 * serialized form is `driving`; hand-edited URLs may carry anything at all.
 * Unknown input degrades to `foot` rather than failing the render.
 */
export function normalizeProfile(value: unknown): RouteProfile {
  if (typeof value !== "string") return DEFAULT_ROUTE_PROFILE;
  return PROFILE_ALIASES[value.toLowerCase()] ?? DEFAULT_ROUTE_PROFILE;
}

/**
 * `[lat, lng]` — Leaflet order, matching `Stop.lat`/`Stop.lng` and
 * `Route.via` in `src/tour/schema.ts`.
 *
 * OSRM speaks GeoJSON (`[lon, lat]`); the flip happens once, at the parse
 * boundary in `osrm.ts`, so no other module has to think about it. Use
 * {@link toLineString} from `./geometry` when a caller genuinely needs GeoJSON.
 */
export type LatLng = [number, number];

export type RoutingFailureReason =
  /** Fewer than two stops — nothing to route, no request was made. */
  | "too-few-stops"
  /** Our own AbortController fired (default 8s). */
  | "timeout"
  /** HTTP 429 from the public endpoint. */
  | "rate-limited"
  /** Any other non-2xx HTTP status. */
  | "http-error"
  /** OSRM answered `NoRoute` / `NoSegment` — stops are unreachable or off-grid. */
  | "no-route"
  /** OSRM answered with some other non-`Ok` `code`. */
  | "api-error"
  /** Body was not JSON, or not the shape OSRM documents. */
  | "malformed-response"
  /** fetch() rejected: offline, DNS, CORS, TLS. */
  | "network-error"
  /** Caller aborted via signal or `service.cancel()`. */
  | "cancelled"
  /** A newer debounced request for the same key replaced this one. */
  | "superseded";

export interface RoutingSuccess {
  ok: true;
  /** Road geometry as `[lat, lng]`, rounded to {@link COORD_PRECISION}. */
  coords: LatLng[];
  /** True when served from the in-memory / sessionStorage cache (no HTTP). */
  fromCache: boolean;
}

export interface RoutingFailure {
  ok: false;
  reason: RoutingFailureReason;
  /** HTTP status, when one was received. */
  status?: number;
  /** Free-text detail for logging — OSRM `code`/`message`, error text. */
  detail?: string;
  /** Parsed `Retry-After`, when the endpoint sent one with a 429. */
  retryAfterMs?: number;
}

export type RoutingResult = RoutingSuccess | RoutingFailure;

export interface GeoJsonLineString {
  type: "LineString";
  /** GeoJSON order: `[lon, lat]`. */
  coordinates: [number, number][];
}

/** Decimal places kept on every coordinate (~1.1 m). Also the cache key grain. */
export const COORD_PRECISION = 5;

/** Default request budget before the AbortController fires. */
export const DEFAULT_TIMEOUT_MS = 8_000;

/** Default editor debounce — one request per burst of edits. */
export const DEFAULT_DEBOUNCE_MS = 800;

/**
 * Waypoints per HTTP request. The public FOSSGIS servers accepted 101
 * coordinates in testing, but the limit is undocumented and URLs grow ~15
 * bytes per stop, so we chunk conservatively and stitch the legs together.
 */
export const DEFAULT_MAX_WAYPOINTS = 100;

/** Minimum gap between outbound requests — public-endpoint politeness. */
export const DEFAULT_MIN_REQUEST_INTERVAL_MS = 200;

/** Cooldown applied after a 429 when the server sends no `Retry-After`. */
export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 5_000;
