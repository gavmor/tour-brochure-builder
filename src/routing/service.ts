/**
 * The routing service the editor and the brochure call.
 *
 * Wraps the OSRM transport with everything a donated public endpoint needs us
 * to do: cache, debounce, de-duplicate, serialise, space out, back off, and
 * cancel work nobody is waiting for any more.
 *
 * ```ts
 * const routing = createRoutingService();
 * // routeLatLngs() merges the route's `via` shape points into stop order —
 * // ADR 0001 requires them to reach the router as intermediate waypoints.
 * const result = await routing.routeDebounced(
 *   route.id,
 *   routeLatLngs(route),
 *   route.profile,            // undefined → "foot"; "car" → "driving"
 * );
 * if (result.ok) draw(result.coords);
 * else if (shouldDegrade(result)) drawApproximate();  // superseded/cancelled: keep as-is
 * ```
 */

import {
  cacheKey,
  createRoutingCache,
  type RoutingCache,
  type StorageLike,
} from "./cache";
import {
  type EndpointMap,
  ROUTING_ATTRIBUTION,
  ROUTING_ATTRIBUTION_HTML,
} from "./endpoints";
import { type FetchLike, requestRouteGeometry } from "./osrm";
import {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_MAX_WAYPOINTS,
  DEFAULT_MIN_REQUEST_INTERVAL_MS,
  DEFAULT_RATE_LIMIT_COOLDOWN_MS,
  DEFAULT_TIMEOUT_MS,
  type LatLng,
  normalizeProfile,
  type RouteProfile,
  type RouteProfileInput,
  type RoutingResult,
} from "./types";

export interface RoutingServiceOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  debounceMs?: number;
  endpoints?: EndpointMap;
  maxWaypointsPerRequest?: number;
  /** Simultaneous requests to the public endpoint. Keep at 1–2. Default 1. */
  maxConcurrency?: number;
  /** Minimum gap between outbound requests. Default 200ms. */
  minRequestIntervalMs?: number;
  /** Pause after a 429 with no `Retry-After`. Default 5s. */
  rateLimitCooldownMs?: number;
  /** Supply your own, or `null` to disable caching entirely. */
  cache?: RoutingCache | null;
  /** sessionStorage mirror for the default cache; `null` disables it. */
  storage?: StorageLike | null;
  /** Mirror budget in characters (~1 MB default), evicted oldest-first. */
  maxStorageChars?: number;
  now?: () => number;
}

export interface RouteRequestOptions {
  signal?: AbortSignal;
}

export interface RoutingService {
  /**
   * Fetch now (cache first). Resolves, never rejects.
   *
   * `waypoints` is the route's stops **plus any `via` shape points**, already
   * merged in itinerary order (ADR 0001). `profile` accepts the canonical
   * names, `undefined` (→ `foot`) or UI wording like `"car"`.
   */
  route(
    waypoints: LatLng[],
    profile?: RouteProfileInput,
    options?: RouteRequestOptions,
  ): Promise<RoutingResult>;
  /**
   * Fetch after the debounce window. A newer call with the same `key` settles
   * this one as `{ ok: false, reason: "superseded" }` and aborts its request
   * if it already started. Use `route.id` as the key.
   */
  routeDebounced(
    key: string,
    waypoints: LatLng[],
    profile?: RouteProfileInput,
  ): Promise<RoutingResult>;
  /** Drop pending/in-flight work for one debounce key. */
  cancel(key: string): void;
  cancelAll(): void;
  readonly attribution: string;
  readonly attributionHtml: string;
  readonly cache: RoutingCache;
  /** Debounce keys with work outstanding — for tests and diagnostics. */
  readonly pendingKeys: string[];
}

/**
 * True when a failure should visibly degrade the UI (straight dashed line plus
 * the "approximate" indicator). `superseded` and `cancelled` mean "a newer
 * answer is coming, leave the map alone".
 */
export function shouldDegrade(result: RoutingResult): boolean {
  return (
    !result.ok &&
    result.reason !== "superseded" &&
    result.reason !== "cancelled"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Concurrency limiter with a minimum spacing between starts. */
function createQueue(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  async function acquire() {
    if (active < limit) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  }

  function release() {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}

interface Inflight {
  promise: Promise<RoutingResult>;
  controller: AbortController;
  subscribers: number;
}

interface Debounced {
  timer: ReturnType<typeof setTimeout> | undefined;
  controller: AbortController;
  settle: (result: RoutingResult) => void;
  settled: boolean;
}

export function createRoutingService(
  options: RoutingServiceOptions = {},
): RoutingService {
  const {
    fetchImpl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    endpoints,
    maxWaypointsPerRequest = DEFAULT_MAX_WAYPOINTS,
    maxConcurrency = 1,
    minRequestIntervalMs = DEFAULT_MIN_REQUEST_INTERVAL_MS,
    rateLimitCooldownMs = DEFAULT_RATE_LIMIT_COOLDOWN_MS,
    storage,
    maxStorageChars,
    now = () => Date.now(),
  } = options;

  const cache: RoutingCache =
    options.cache === null
      ? createRoutingCache({ storage: null, maxEntries: 0 })
      : (options.cache ?? createRoutingCache({ storage, maxStorageChars }));
  const cachingEnabled = options.cache !== null;

  const runQueued = createQueue(Math.max(1, maxConcurrency));
  const inflight = new Map<string, Inflight>();
  const debounced = new Map<string, Debounced>();
  /** Timestamp before which no new request may start (spacing + 429 cooldown). */
  let nextStartAt = 0;

  async function waitForWindow() {
    const delay = nextStartAt - now();
    if (delay > 0) await sleep(delay);
  }

  async function performRequest(
    waypoints: LatLng[],
    profile: RouteProfile,
    signal: AbortSignal,
  ): Promise<RoutingResult> {
    await waitForWindow();
    if (signal.aborted) return { ok: false, reason: "cancelled" };
    const result = await requestRouteGeometry(waypoints, profile, {
      fetchImpl,
      timeoutMs,
      endpoints,
      maxWaypointsPerRequest,
      signal,
      onBetweenLegs: waitForWindow,
    });
    nextStartAt =
      !result.ok && result.reason === "rate-limited"
        ? now() + (result.retryAfterMs ?? rateLimitCooldownMs)
        : now() + minRequestIntervalMs;
    return result;
  }

  function acquireInflight(
    key: string,
    waypoints: LatLng[],
    profile: RouteProfile,
  ): Inflight {
    const existing = inflight.get(key);
    if (existing) {
      existing.subscribers++;
      return existing;
    }
    const controller = new AbortController();
    const entry: Inflight = {
      controller,
      subscribers: 1,
      promise: runQueued(() =>
        performRequest(waypoints, profile, controller.signal),
      )
        .catch(
          // The transport is written not to throw; if it ever does, callers
          // still get a structured failure rather than an unhandled rejection.
          (error: unknown): RoutingResult => ({
            ok: false,
            reason: "network-error",
            detail: error instanceof Error ? error.message : String(error),
          }),
        )
        .then((result) => {
          if (result.ok && cachingEnabled) cache.set(key, result.coords);
          if (inflight.get(key) === entry) inflight.delete(key);
          return result;
        }),
    };
    inflight.set(key, entry);
    return entry;
  }

  /** Caller walked away: abort the request once nobody is listening. */
  function abandon(entry: Inflight) {
    entry.subscribers--;
    if (entry.subscribers <= 0) entry.controller.abort();
  }

  async function route(
    waypoints: LatLng[],
    profileInput?: RouteProfileInput,
    requestOptions: RouteRequestOptions = {},
  ): Promise<RoutingResult> {
    if (waypoints.length < 2) return { ok: false, reason: "too-few-stops" };

    const profile = normalizeProfile(profileInput);
    const key = cacheKey(waypoints, profile);
    if (cachingEnabled) {
      const cached = cache.get(key);
      if (cached) return { ok: true, coords: cached, fromCache: true };
    }

    const signal = requestOptions.signal;
    if (signal?.aborted) return { ok: false, reason: "cancelled" };

    const entry = acquireInflight(key, waypoints, profile);
    if (!signal) {
      const result = await entry.promise;
      entry.subscribers--;
      return result;
    }

    return new Promise<RoutingResult>((resolve) => {
      let done = false;
      const onAbort = () => {
        if (done) return;
        done = true;
        abandon(entry);
        resolve({ ok: false, reason: "cancelled" });
      };
      signal.addEventListener("abort", onAbort, { once: true });
      entry.promise.then((result) => {
        if (done) return;
        done = true;
        signal.removeEventListener("abort", onAbort);
        entry.subscribers--;
        resolve(result);
      });
    });
  }

  function settleDebounced(
    key: string,
    entry: Debounced,
    result: RoutingResult,
  ) {
    if (entry.settled) return;
    entry.settled = true;
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.controller.abort();
    if (debounced.get(key) === entry) debounced.delete(key);
    entry.settle(result);
  }

  function routeDebounced(
    key: string,
    waypoints: LatLng[],
    profile?: RouteProfileInput,
  ): Promise<RoutingResult> {
    const previous = debounced.get(key);
    if (previous) {
      settleDebounced(key, previous, { ok: false, reason: "superseded" });
    }

    return new Promise<RoutingResult>((resolve) => {
      const entry: Debounced = {
        timer: undefined,
        controller: new AbortController(),
        settle: resolve,
        settled: false,
      };
      entry.timer = setTimeout(() => {
        entry.timer = undefined;
        route(waypoints, profile, { signal: entry.controller.signal }).then(
          (result) => {
            if (entry.settled) return;
            entry.settled = true;
            if (debounced.get(key) === entry) debounced.delete(key);
            entry.settle(result);
          },
        );
      }, debounceMs);
      debounced.set(key, entry);
    });
  }

  return {
    route,
    routeDebounced,
    cancel(key) {
      const entry = debounced.get(key);
      if (entry)
        settleDebounced(key, entry, { ok: false, reason: "cancelled" });
    },
    cancelAll() {
      for (const [key, entry] of [...debounced]) {
        settleDebounced(key, entry, { ok: false, reason: "cancelled" });
      }
    },
    attribution: ROUTING_ATTRIBUTION,
    attributionHtml: ROUTING_ATTRIBUTION_HTML,
    cache,
    get pendingKeys() {
      return [...debounced.keys()];
    },
  };
}
