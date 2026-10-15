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
  type Candidate,
  clampBbox,
  DEFAULTS,
  type GeocodeResult,
  buildOverpassQuery,
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
  const wait = Math.max(0, lastNominatimAt + DEFAULTS.nominatimMinIntervalMs - now);
  lastNominatimAt = now + wait;
  return new Promise((resolve) => setTimeout(resolve, wait));
}

/** Test seam: pretend no Nominatim request has been made yet. */
export function resetNominatimGate(): void {
  lastNominatimAt = 0;
}

// ------------------------------------------------------------------- fetch

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
      throw new PoiNetworkError("timeout", "deadline exceeded before geocoding");
    }
    budget = Math.min(DEFAULTS.fetchTimeoutMs, Math.ceil(remaining / 2));
  }

  const response = await fetchWithTimeout(nominatimUrl(query), {}, budget, signal);
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
 * Query Overpass for sites inside a bbox, trying each mirror until one
 * answers. Returns the ranked, deduped proposal list.
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
  let lastError: unknown = null;

  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i += 1) {
    const endpoint = OVERPASS_ENDPOINTS[i];
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      lastError =
        lastError ?? new PoiNetworkError("timeout", "Overpass deadline exceeded");
      break;
    }
    // Split what is left of the shared deadline across the mirrors not yet
    // tried: one that fails fast hands its unused budget to the next.
    const budget = Math.min(
      DEFAULTS.fetchTimeoutMs,
      Math.ceil(remaining / (OVERPASS_ENDPOINTS.length - i)),
    );
    try {
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: overpassBody(query),
        },
        budget,
        signal,
      );
      if (!response.ok) {
        lastError = new PoiNetworkError(
          "http",
          `Overpass HTTP ${response.status}`,
        );
        continue;
      }
      const json = (await response.json()) as { elements?: unknown };
      if (!json || !Array.isArray(json.elements)) {
        lastError = new PoiNetworkError("payload", "Overpass sent no elements");
        continue;
      }
      const candidates = rankAndDedupe(json.elements, { topN });
      if (key) cacheSet(key, candidates);
      forgetOutage(); // Overpass is answering again.
      return { candidates, cached: false, endpoint };
    } catch (error) {
      lastError = error;
      // A user cancellation is not a reason to try the next mirror, and must
      // not be remembered as an outage.
      if (isCancellation(error) || signal?.aborted) throw error;
    }
  }

  rememberOutage(lastError);
  throw lastError ?? new PoiNetworkError("http", "every Overpass mirror failed");
}

/** The real service. The UI takes this as a default so tests can swap it. */
export const poiService: PoiService = { geocode, findPois };
