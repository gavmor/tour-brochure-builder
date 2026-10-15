/**
 * "Add sites near a location" — the network half.
 *
 * Ported from the `~/Documents/tour-builder` spike (`net.js`) by task
 * t_40ec912a. Everything that talks to the outside world is here so `osm.ts`
 * stays pure and the UI stays free of fetch plumbing.
 *
 * What this layer is responsible for, all of it required rather than nice to
 * have:
 * - a hard client-side timeout (10 s) on every request, plus cancellation, so
 *   a hung mirror cannot leave a spinner on screen forever;
 * - >= 1 s between Nominatim calls (their usage policy) and a session cache so
 *   repeating a search costs nothing;
 * - trying the Overpass mirrors in order, because the canonical instance is
 *   regularly rate-limited or down;
 * - never throwing for a *result* ("no sites here" is `candidates: []`), only
 *   for a genuine failure the UI should offer the curated fallback for.
 *
 * `sessionStorage` here is an HTTP cache for someone else's API, not app state:
 * the tour still lives only in the URL (ADR 0002). Losing it costs one refetch.
 */

import {
  type BBox,
  buildOverpassQuery,
  type Candidate,
  clampBbox,
  DEFAULTS,
  type GeocodeResult,
  nominatimUrl,
  OVERPASS_ENDPOINTS,
  overpassBody,
  parseNominatim,
  rankAndDedupe,
  sessionCacheKey,
} from "./osm";

export interface PoiResult {
  candidates: Candidate[];
  cached: boolean;
  /** Which mirror answered; useful in a bug report, ignored by the UI. */
  endpoint?: string;
}

/** Options shared by both calls, so one deadline covers geocode + Overpass. */
export interface PoiRequestOptions {
  signal?: AbortSignal;
  /** Absolute timestamp the whole proposal step must finish by. */
  deadlineAt?: number;
}

/** Injectable seam so tests (and the UI) can drive this without a network. */
export interface PoiService {
  geocode(query: string, opts?: PoiRequestOptions): Promise<GeocodeResult>;
  findPois(
    bbox: BBox,
    opts?: PoiRequestOptions & { topN?: number; cacheQuery?: string },
  ): Promise<PoiResult>;
}

// ------------------------------------------------------------ session cache

function cacheGet<T>(key: string): T | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Private mode, disabled storage, or a half-written entry: just refetch.
    return null;
  }
}

function cacheSet(key: string, value: unknown): void {
  try {
    globalThis.sessionStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Over quota is not worth failing a search over.
  }
}

function cacheDelete(key: string): void {
  try {
    globalThis.sessionStorage?.removeItem(key);
  } catch {
    // No storage, nothing to delete.
  }
}

// ----------------------------------------------------------- outage memory

const OUTAGE_KEY = "tbb:near:overpass-outage";

export interface OutageRecord {
  at: number;
  reason: string;
}

/**
 * The other half of the latency contract: remembering that Overpass was down.
 * Without it every repeat of a query made during an outage pays the whole
 * deadline again before the curated fallback appears.
 */
export function recentOutage(now = Date.now()): OutageRecord | null {
  const record = cacheGet<OutageRecord>(OUTAGE_KEY);
  if (!record || !Number.isFinite(record.at)) return null;
  if (now - record.at > DEFAULTS.outageMemoMs) return null;
  return record;
}

function rememberOutage(reason: unknown): void {
  cacheSet(OUTAGE_KEY, {
    at: Date.now(),
    reason: String(describeError(reason) || "every mirror failed"),
  });
}

/** The UI's recovery path ("Try again"), and a test seam. */
export function forgetOutage(): void {
  cacheDelete(OUTAGE_KEY);
}

/** Resolve a caller deadline into an absolute timestamp. */
export function resolveDeadline(deadlineAt?: number): number {
  return Number.isFinite(deadlineAt)
    ? (deadlineAt as number)
    : Date.now() + DEFAULTS.proposalDeadlineMs;
}

/** Test seam: forget everything this module cached in the session. */
export function clearPoiCache(): void {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return;
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith("tbb:near:")) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

// ----------------------------------------------------------- rate limiting

let lastNominatimAt = 0;

/** Hold the caller until at least `nominatimMinIntervalMs` has passed. */
function nominatimGate(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(
    0,
    lastNominatimAt + DEFAULTS.nominatimMinIntervalMs - now,
  );
  lastNominatimAt = now + wait;
  return new Promise((resolve) => setTimeout(resolve, wait));
}

/** Test seam: pretend no Nominatim request has been made yet. */
export function resetNominatimGate(): void {
  lastNominatimAt = 0;
}

// ------------------------------------------------------------------- fetch

/**
 * Identifies this app to the OSM services, as their usage policies require.
 *
 * Browsers forbid setting `User-Agent` and silently drop it — there a request
 * is identified by its `Referer`, which the browser sends for us. Outside a
 * browser (the live smoke test, any Node consumer) it is the difference
 * between a 200 and Nominatim's 403 for unidentified clients.
 */
const USER_AGENT =
  "tour-brochure-builder/0.1 (+https://github.com/gavmor/tour-brochure-builder)";

export class PoiNetworkError extends Error {
  readonly kind:
    | "timeout"
    | "cancelled"
    | "http"
    | "payload"
    | "empty"
    | "outage";
  /** The underlying DOMException/TypeError, when there was one. */
  readonly reason?: unknown;
  constructor(
    kind: PoiNetworkError["kind"],
    message: string,
    reason?: unknown,
  ) {
    super(message);
    this.name = "PoiNetworkError";
    this.kind = kind;
    this.reason = reason;
  }
}

export function describeError(error: unknown): string {
  if (!error) return "unknown error";
  if (error instanceof PoiNetworkError) {
    if (error.kind === "timeout") return "timed out";
    if (error.kind === "cancelled") return "cancelled";
    if (error.kind === "outage") return "unavailable a moment ago";
    return error.message;
  }
  const name = (error as { name?: string }).name;
  if (name === "TimeoutError") return "timed out";
  if (name === "AbortError") return "cancelled";
  return (error as { message?: string }).message ?? String(error);
}

export function isCancellation(error: unknown): boolean {
  if (error instanceof PoiNetworkError) return error.kind === "cancelled";
  return (error as { name?: string })?.name === "AbortError";
}

/**
 * `fetch` with its own abort timer, chained to an optional caller signal so
 * "Cancel" and the timeout use the same mechanism.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULTS.fetchTimeoutMs,
  external?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new PoiNetworkError(
        "timeout",
        `timed out after ${timeoutMs} ms`,
        error,
      );
    }
    if (external?.aborted || isCancellation(error)) {
      throw new PoiNetworkError("cancelled", "cancelled", error);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onExternalAbort);
  }
}

// --------------------------------------------------------------- geocoding

/**
 * Resolve a place name to a centre + bbox via Nominatim.
 *
 * No custom `User-Agent`: browsers forbid setting it, and Nominatim identifies
 * a web app by `Referer`, which the browser sends for us.
 */
export async function geocode(
  query: string,
  { signal, deadlineAt }: PoiRequestOptions = {},
): Promise<GeocodeResult> {
  const key = sessionCacheKey("geo", query);
  const cached = cacheGet<GeocodeResult>(key);
  if (cached) return { ...cached, cached: true };

  await nominatimGate();
  if (signal?.aborted) throw new PoiNetworkError("cancelled", "cancelled");

  // Geocoding may spend at most half of what is left of the shared deadline,
  // so the Overpass step that follows always keeps a usable share of it.
  let budget: number = DEFAULTS.fetchTimeoutMs;
  if (Number.isFinite(deadlineAt)) {
    const remaining = (deadlineAt as number) - Date.now();
    if (remaining <= 0) {
      throw new PoiNetworkError(
        "timeout",
        "deadline exceeded before geocoding",
      );
    }
    budget = Math.min(DEFAULTS.fetchTimeoutMs, Math.ceil(remaining / 2));
  }

  const response = await fetchWithTimeout(
    nominatimUrl(query),
    { headers: { "User-Agent": USER_AGENT } },
    budget,
    signal,
  );
  if (!response.ok) {
    throw new PoiNetworkError("http", `Nominatim HTTP ${response.status}`);
  }
  const parsed = parseNominatim(await response.json());
  if (!parsed) {
    throw new PoiNetworkError("empty", `no place matched "${query}"`);
  }
  cacheSet(key, parsed);
  return { ...parsed, cached: false };
}

// ------------------------------------------------------------------- POIs

/**
 * Query Overpass for sites inside a bbox.
 *
 * Mirrors are **hedged, not raced**: the first is asked straight away, and the
 * next is only brought in if that one has not answered within `hedgeDelayMs` —
 * with the first request still running, because a mirror that is merely slow
 * should still be allowed to win. Losers are aborted the moment someone
 * answers, so the extra load only lands while a mirror is being slow, never on
 * every query. The whole thing is bounded by one shared deadline.
 *
 * (The spike split the deadline evenly across the mirrors instead. That is
 * tidier but wrong: it guarantees failure whenever the only healthy mirror is
 * slower than its slice — exactly what happened in testing, where one mirror
 * answered in ~20 s and the other two were dead.)
 */
export async function findPois(
  bbox: BBox,
  {
    signal,
    deadlineAt,
    topN = DEFAULTS.topN,
    cacheQuery,
  }: PoiRequestOptions & { topN?: number; cacheQuery?: string } = {},
): Promise<PoiResult> {
  const key = cacheQuery ? sessionCacheKey("pois", cacheQuery) : null;
  if (key) {
    const cached = cacheGet<Candidate[]>(key);
    if (cached) return { candidates: cached, cached: true };
  }

  // Overpass was down a moment ago: do not make the user wait to learn that
  // again — fail at once so the curated fallback appears immediately.
  const outage = recentOutage();
  if (outage) {
    throw new PoiNetworkError(
      "outage",
      `Overpass was unavailable moments ago (${outage.reason})`,
    );
  }

  const deadline = resolveDeadline(deadlineAt);
  const query = buildOverpassQuery(clampBbox(bbox));
  /** Aborts every attempt still in flight: a winner, a cancel, or the deadline. */
  const hedge = new AbortController();
  const stopAll = () => hedge.abort();
  if (signal) {
    if (signal.aborted) throw new PoiNetworkError("cancelled", "cancelled");
    signal.addEventListener("abort", stopAll, { once: true });
  }

  let lastError: unknown = null;

  const ask = async (endpoint: string): Promise<PoiResult> => {
    // The shared deadline is the only cap that matters here: capping each
    // attempt at `fetchTimeoutMs` as well would cut off exactly the slow but
    // healthy mirror that hedging exists to let win.
    const budget = Math.max(1, deadline - Date.now());
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: overpassBody(query),
      },
      budget,
      hedge.signal,
    );
    if (!response.ok) {
      throw new PoiNetworkError("http", `Overpass HTTP ${response.status}`);
    }
    // An overloaded Overpass answers 200 with an XML error document, not JSON.
    // Read the body once and say so plainly, rather than letting a parser
    // error ("Unexpected token '<'") reach the user.
    const body = await response.text();
    let json: { elements?: unknown };
    try {
      json = JSON.parse(body) as { elements?: unknown };
    } catch {
      throw new PoiNetworkError(
        "payload",
        "Overpass returned an error page (it is probably overloaded)",
      );
    }
    if (!json || !Array.isArray(json.elements)) {
      throw new PoiNetworkError("payload", "Overpass sent no elements");
    }
    return {
      candidates: rankAndDedupe(json.elements, { topN }),
      cached: false,
      endpoint,
    };
  };

  const finish = (result: PoiResult): PoiResult => {
    if (key) cacheSet(key, result.candidates);
    forgetOutage(); // Overpass is answering again.
    return result;
  };

  const attempts: Promise<PoiResult>[] = [];
  try {
    for (let i = 0; i < OVERPASS_ENDPOINTS.length; i += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      attempts.push(
        ask(OVERPASS_ENDPOINTS[i]).catch((error) => {
          lastError = error;
          throw error;
        }),
      );
      if (i === OVERPASS_ENDPOINTS.length - 1) break;

      // Bring in the next mirror after the stagger — or at once if everything
      // in flight has already failed. Never wait past the deadline.
      const stagger = Math.min(
        DEFAULTS.hedgeDelayMs,
        Math.max(0, remaining / OVERPASS_ENDPOINTS.length),
      );
      const early = await Promise.race([
        anySettled(attempts),
        sleep(stagger).then(() => "stagger" as const),
      ]);
      if (early !== "stagger" && early !== null) return finish(early);
      if (hedge.signal.aborted) break;
    }

    const winner = await anySettled(attempts);
    if (winner) return finish(winner);
  } finally {
    signal?.removeEventListener("abort", stopAll);
    stopAll(); // whoever lost is no longer wanted
  }

  if (isCancellation(lastError) || signal?.aborted) {
    throw lastError ?? new PoiNetworkError("cancelled", "cancelled");
  }
  rememberOutage(lastError);
  throw (
    lastError ?? new PoiNetworkError("http", "every Overpass mirror failed")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The first attempt to succeed, or `null` once they have all failed. Unlike
 * `Promise.any`/`race` this never rejects, so one mirror failing fast cannot
 * end the wait for a slower one that is still going.
 */
function anySettled(attempts: Promise<PoiResult>[]): Promise<PoiResult | null> {
  if (attempts.length === 0) return Promise.resolve(null);
  let left = attempts.length;
  return new Promise<PoiResult | null>((resolve) => {
    for (const attempt of attempts) {
      attempt.then(
        (value) => resolve(value),
        () => {
          left -= 1;
          if (left === 0) resolve(null);
        },
      );
    }
  });
}

/** The real service. The UI takes this as a default so tests can swap it. */
export const poiService: PoiService = { geocode, findPois };
