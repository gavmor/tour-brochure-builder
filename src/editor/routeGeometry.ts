/**
 * Road geometry for the two map views.
 *
 * The routing service (`src/routing`) knows how to turn waypoints into a road
 * LineString. This module is the layer between it and Leaflet: it watches the
 * tour, asks for geometry when the *request* actually changes, and publishes
 * per-route state the editor and the brochure both draw from.
 *
 * ## What the views see
 *
 * Every route always has something to draw. `coords` is `null` until a road
 * answer arrives, and the views fall back to `routeLatLngs(route)` — the
 * straight line, drawn immediately as a placeholder (SPEC D4's old behaviour,
 * now the degraded state rather than the only state). `approximate` is the
 * flag for the dashed styling and the "approximate route" indicator.
 *
 * ## Why the state is module-level
 *
 * The editor and the brochure are never both mounted, but they show the same
 * tour, and a view switch must not re-fetch or flash straight lines. Keeping
 * the state (and the service, and the in-flight bookkeeping) outside the
 * component tree makes the transition free. `resetRouteGeometry()` is the
 * test seam.
 *
 * ## What this module deliberately does not do
 *
 * It never writes geometry back into the `Tour`. ADR 0001 measured a
 * geometry-bearing share URL at 11,443 characters against an 8,000 ceiling and
 * chose option B: recompute at view time, cache beside the tour, serialize
 * nothing but `profile`.
 */

import { computed, signal } from "@preact/signals";
import {
  cacheKey,
  createRoutingService,
  type LatLng,
  type RouteProfile,
  type RoutingFailureReason,
  type RoutingService,
  shouldDegrade,
} from "../routing";
import { type Route, routeProfile, type Tour } from "../tour";
import { routeBounds, routeLatLngs } from "./shape";

export interface RouteGeometry {
  /**
   * Road geometry in Leaflet order, or `null` when we have none — before the
   * first answer, and after a failure. A null here means "draw the straight
   * line", never "draw nothing".
   */
  coords: LatLng[] | null;
  /** The straight line is standing in for a road route that did not arrive. */
  approximate: boolean;
  /** Why it is approximate; drives the tooltip wording. */
  reason?: RoutingFailureReason;
  /** A request for this route is debouncing or in flight. */
  pending: boolean;
}

const BLANK: RouteGeometry = {
  coords: null,
  approximate: false,
  pending: false,
};

/** Per-route geometry state, keyed by `route.id`. */
export const routeGeometry = signal<Record<string, RouteGeometry>>({});

/** True while any route is still waiting on the router. */
export const geometryPending = computed(() =>
  Object.values(routeGeometry.value).some((entry) => entry.pending),
);

/** Routes currently drawn as approximate straight lines. */
export const approximateRouteIds = computed(() =>
  Object.entries(routeGeometry.value)
    .filter(([, entry]) => entry.approximate)
    .map(([id]) => id),
);

let service: RoutingService = createRoutingService();

/** Cache key of the request each route's current state came from. */
const signatures = new Map<string, string>();
/** Settled-tracking for `routesSettled()` — the print flow's dependency. */
const outstanding = new Set<Promise<unknown>>();

export function geometryFor(routeId: string): RouteGeometry {
  return routeGeometry.value[routeId] ?? BLANK;
}

/** Attribution the routing endpoints are owed, for Leaflet's control. */
export const routingAttributionHtml = service.attributionHtml;
/** Same, plain text — the brochure prints its own copy of the credit. */
export const routingAttribution = service.attribution;

function patch(routeId: string, next: Partial<RouteGeometry>): void {
  const all = routeGeometry.peek();
  const current = all[routeId] ?? BLANK;
  const merged: RouteGeometry = { ...current, ...next };
  if (
    routeId in all &&
    merged.coords === current.coords &&
    merged.approximate === current.approximate &&
    merged.reason === current.reason &&
    merged.pending === current.pending
  ) {
    return;
  }
  routeGeometry.value = { ...all, [routeId]: merged };
}

function forget(routeId: string): void {
  signatures.delete(routeId);
  service.cancel(routeId);
  const all = routeGeometry.peek();
  if (!(routeId in all)) return;
  const { [routeId]: _dropped, ...rest } = all;
  routeGeometry.value = rest;
}

async function request(
  routeId: string,
  waypoints: LatLng[],
  profile: RouteProfile,
  signature: string,
): Promise<void> {
  patch(routeId, { pending: true });
  const result = await service.routeDebounced(routeId, waypoints, profile);

  // A newer edit replaced this request while it was out. That request owns
  // the route's state now; writing ours would undo it.
  if (signatures.get(routeId) !== signature) return;

  if (result.ok) {
    patch(routeId, {
      coords: result.coords,
      approximate: false,
      reason: undefined,
      pending: false,
    });
    return;
  }
  if (shouldDegrade(result)) {
    // Keep the straight line and say so. `coords: null` is what makes the
    // view fall back rather than go blank.
    patch(routeId, {
      coords: null,
      approximate: true,
      reason: result.reason,
      pending: false,
    });
    return;
  }
  // `superseded` / `cancelled`: a newer answer is coming, or nobody is
  // waiting any more. Leave the drawing exactly as it is.
  patch(routeId, { pending: false });
}

/**
 * Reconcile the routing requests against the tour.
 *
 * Call it from an effect keyed on the tour. A request is only issued when the
 * *cache key* changes — profile plus waypoints at 5 decimals — so renaming or
 * recoloring a route, selecting a stop or editing a blurb costs nothing,
 * while adding, removing, reordering or moving a stop (and changing the
 * profile) re-requests. The service debounces bursts under `route.id`.
 */
export function syncRouteGeometry(tour: Tour): void {
  const live = new Set<string>();

  for (const route of tour.routes) {
    live.add(route.id);
    const waypoints = routeLatLngs(route);

    // Fewer than two points is not a route yet: no request, no indicator.
    if (waypoints.length < 2) {
      if (signatures.has(route.id) || route.id in routeGeometry.peek()) {
        forget(route.id);
      }
      continue;
    }

    const profile = routeProfile(route);
    const signature = cacheKey(waypoints, profile);
    if (signatures.get(route.id) === signature) continue;
    signatures.set(route.id, signature);

    // Synchronous cache hit: the editor ⇄ brochure switch, a reload served by
    // the sessionStorage mirror, or an undone edit. Drawing it now avoids a
    // debounce window of straight line over geometry we already have.
    const cached = service.cache.get(signature);
    if (cached) {
      service.cancel(route.id);
      patch(route.id, {
        coords: cached,
        approximate: false,
        reason: undefined,
        pending: false,
      });
      continue;
    }

    const pending = request(route.id, waypoints, profile, signature);
    outstanding.add(pending);
    void pending.finally(() => outstanding.delete(pending));
  }

  for (const routeId of [...signatures.keys()]) {
    if (!live.has(routeId)) forget(routeId);
  }
  for (const routeId of Object.keys(routeGeometry.peek())) {
    if (!live.has(routeId)) forget(routeId);
  }
}

/**
 * Resolve once every outstanding geometry request has settled — successfully
 * or into its straight-line fallback.
 *
 * The print flow needs this: geometry is the second async dependency on a
 * page that already waits for tiles, and a print fired mid-fetch shows roads
 * on some routes and straight lines on others. Bounded, and it re-checks
 * after each wait because a request can be superseded and replaced while we
 * are waiting.
 */
export async function routesSettled(
  options: { timeout?: number; now?: () => number } = {},
): Promise<"ready" | "timeout"> {
  const now = options.now ?? (() => Date.now());
  const deadline = now() + (options.timeout ?? 10_000);
  while (outstanding.size > 0) {
    const remaining = deadline - now();
    if (remaining <= 0) return "timeout";
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([...outstanding]),
      new Promise((resolve) => {
        timer = setTimeout(resolve, remaining);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
  }
  return "ready";
}

/** Human wording for the dashed line's tooltip and the legend note. */
export function approximateReason(reason?: RoutingFailureReason): string {
  switch (reason) {
    case "network-error":
      return "no connection to the routing service";
    case "timeout":
      return "the routing service did not answer in time";
    case "rate-limited":
      return "the routing service is rate-limiting us";
    case "no-route":
      return "the router found no road between these stops";
    case "http-error":
    case "api-error":
    case "malformed-response":
      return "the routing service returned an error";
    default:
      return "street routing was unavailable";
  }
}

/** Full tooltip text for an approximate route. */
export function approximateTooltip(reason?: RoutingFailureReason): string {
  return `Approximate route — ${approximateReason(reason)}. The line is drawn straight between stops.`;
}

/**
 * Dashed stroke for a route drawn as an approximate straight line. Long
 * enough to read as deliberate at city zoom, short enough to still read as
 * one line. Both map views use it, so there is one answer to "what does
 * dashed mean".
 */
export const APPROXIMATE_DASH = "7 7";

/**
 * Every point a route actually draws, for bounds fitting: its stops and
 * `via` handles, plus the road geometry when we have it. Road geometry
 * routinely bulges outside the stop bounding box (a one-way system, a bridge
 * approach), and a fit that ignored it would clip the line off the printed
 * map.
 */
export function routeDrawBounds(route: Route): LatLng[] {
  const stopsAndVia = routeBounds(route);
  const coords = routeGeometry.value[route.id]?.coords;
  return coords ? [...stopsAndVia, ...coords] : stopsAndVia;
}

/** Test seam: swap in a service backed by a fake fetch. */
export function setRoutingService(next: RoutingService): void {
  service.cancelAll();
  service = next;
}

/** Test seam: drop all geometry state and in-flight bookkeeping. */
export function resetRouteGeometry(): void {
  service.cancelAll();
  signatures.clear();
  outstanding.clear();
  routeGeometry.value = {};
}
