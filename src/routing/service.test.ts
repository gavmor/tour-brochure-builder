import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoutingService, shouldDegrade } from "./service";
import {
  deferredFetch,
  encodePolyline,
  fakeResponse,
  memoryStorage,
  osrmBody,
} from "./testDoubles";
import type { LatLng } from "./types";

const ROUTE_A: LatLng[] = [
  [41.8781, -87.6298],
  [41.8919, -87.6051],
];
const ROUTE_B: LatLng[] = [
  [41.8781, -87.6298],
  [41.8905, -87.6176],
  [41.8919, -87.6051],
];

const GEOMETRY_A = osrmBody(encodePolyline(ROUTE_A));
const GEOMETRY_B = osrmBody(encodePolyline(ROUTE_B));

function service(overrides: Parameters<typeof createRoutingService>[0] = {}) {
  return createRoutingService({
    storage: null,
    minRequestIntervalMs: 0,
    ...overrides,
  });
}

/**
 * Let the queue → politeness-window → fetch chain settle. It spans several
 * microtask ticks, so one `await Promise.resolve()` is not enough.
 */
async function flush(ticks = 10) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("route", () => {
  it("fetches, flips and returns road geometry", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(GEOMETRY_A));
    const result = await service({ fetchImpl }).route(ROUTE_A, "foot");
    expect(result).toEqual({ ok: true, fromCache: false, coords: ROUTE_A });
  });

  it("serves a repeat render from cache without touching the network", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(GEOMETRY_A));
    const routing = service({ fetchImpl });

    await routing.route(ROUTE_A, "foot");
    const second = await routing.route(ROUTE_A, "foot");

    expect(second).toEqual({ ok: true, fromCache: true, coords: ROUTE_A });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keys the cache on the profile", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(GEOMETRY_A));
    const routing = service({ fetchImpl });

    await routing.route(ROUTE_A, "foot");
    await routing.route(ROUTE_A, "driving");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("defaults to foot when the route has no profile", async () => {
    const spy = deferredFetch();
    const routing = service({ fetchImpl: spy.impl });

    routing.route(ROUTE_A, undefined);
    await flush();

    expect(spy.calls[0]).toContain("/routed-foot/route/v1/foot/");
  });

  it("accepts the UI's wording: 'car' is the driving profile", async () => {
    const spy = deferredFetch();
    const routing = service({ fetchImpl: spy.impl });

    routing.route(ROUTE_A, "car");
    await flush();
    expect(spy.calls[0]).toContain("/routed-car/route/v1/driving/");

    // …and shares a cache entry with the canonical name, so the editor's
    // "car" and the URL's "driving" never double-fetch.
    spy.resolve(0, fakeResponse(GEOMETRY_A));
    await flush();
    expect(await routing.route(ROUTE_A, "driving")).toMatchObject({
      fromCache: true,
    });
    expect(spy.calls).toHaveLength(1);
  });

  it("degrades an unknown profile to foot instead of failing", async () => {
    const spy = deferredFetch();
    const routing = service({ fetchImpl: spy.impl });

    routing.route(ROUTE_A, "hovercraft");
    await flush();

    expect(spy.calls[0]).toContain("/routed-foot/route/v1/foot/");
  });

  it("can mirror the cache through sessionStorage", async () => {
    const storage = memoryStorage();
    const fetchImpl = vi.fn(async () => fakeResponse(GEOMETRY_A));

    await service({ fetchImpl, storage }).route(ROUTE_A, "foot");
    const afterReload = await service({ fetchImpl, storage }).route(
      ROUTE_A,
      "foot",
    );

    expect(afterReload).toEqual({ ok: true, fromCache: true, coords: ROUTE_A });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    const fetchImpl = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(fakeResponse(null, { status: 500 }))
      .mockResolvedValueOnce(fakeResponse(GEOMETRY_A));
    const routing = service({ fetchImpl });

    expect(await routing.route(ROUTE_A, "foot")).toMatchObject({ ok: false });
    expect(await routing.route(ROUTE_A, "foot")).toMatchObject({ ok: true });
  });

  it("answers a one-stop route without a request", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(GEOMETRY_A));
    expect(await service({ fetchImpl }).route([ROUTE_A[0]], "foot")).toEqual({
      ok: false,
      reason: "too-few-stops",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("de-duplicates identical concurrent requests", async () => {
    const spy = deferredFetch();
    const routing = service({ fetchImpl: spy.impl });

    const both = Promise.all([
      routing.route(ROUTE_A, "foot"),
      routing.route(ROUTE_A, "foot"),
    ]);
    await flush();
    expect(spy.calls).toHaveLength(1);

    spy.resolve(0, fakeResponse(GEOMETRY_A));
    const [first, second] = await both;
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
  });

  it("serialises requests, so the public endpoint sees one at a time", async () => {
    const spy = deferredFetch();
    const routing = service({ fetchImpl: spy.impl, maxConcurrency: 1 });

    const first = routing.route(ROUTE_A, "foot");
    const second = routing.route(ROUTE_B, "foot");
    await flush();
    expect(spy.calls).toHaveLength(1);

    spy.resolve(0, fakeResponse(GEOMETRY_A));
    expect(await first).toMatchObject({ ok: true });
    await flush();
    expect(spy.calls).toHaveLength(2);

    spy.resolve(1, fakeResponse(GEOMETRY_B));
    expect(await second).toMatchObject({ ok: true, coords: ROUTE_B });
  });

  it("aborts the HTTP request when the caller's signal fires", async () => {
    const spy = deferredFetch();
    const controller = new AbortController();
    const pending = service({ fetchImpl: spy.impl }).route(ROUTE_A, "foot", {
      signal: controller.signal,
    });
    await flush();

    controller.abort();
    expect(await pending).toEqual({ ok: false, reason: "cancelled" });
    expect(spy.signals[0]?.aborted).toBe(true);
  });

  it("waits out a 429 before the next request", async () => {
    vi.useFakeTimers();
    const spy = deferredFetch();
    const routing = service({
      fetchImpl: spy.impl,
      rateLimitCooldownMs: 5_000,
    });

    const first = routing.route(ROUTE_A, "foot");
    await vi.advanceTimersByTimeAsync(0);
    spy.resolve(0, fakeResponse({}, { status: 429 }));
    expect(await first).toMatchObject({ ok: false, reason: "rate-limited" });

    const second = routing.route(ROUTE_B, "foot");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(spy.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(spy.calls).toHaveLength(2);
    spy.resolve(1, fakeResponse(GEOMETRY_B));
    expect(await second).toMatchObject({ ok: true });
  });
});

describe("routeDebounced", () => {
  it("collapses a burst of edits into one request", async () => {
    vi.useFakeTimers();
    const spy = deferredFetch();
    const routing = service({ fetchImpl: spy.impl, debounceMs: 800 });

    const first = routing.routeDebounced("r1", ROUTE_A, "foot");
    await vi.advanceTimersByTimeAsync(300);
    const second = routing.routeDebounced("r1", ROUTE_A, "foot");
    await vi.advanceTimersByTimeAsync(300);
    const third = routing.routeDebounced("r1", ROUTE_B, "foot");

    expect(spy.calls).toHaveLength(0);
    expect(await first).toEqual({ ok: false, reason: "superseded" });
    expect(await second).toEqual({ ok: false, reason: "superseded" });

    await vi.advanceTimersByTimeAsync(800);
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]).toContain("-87.6176,41.8905");

    spy.resolve(0, fakeResponse(GEOMETRY_B));
    expect(await third).toEqual({
      ok: true,
      fromCache: false,
      coords: ROUTE_B,
    });
    expect(routing.pendingKeys).toEqual([]);
  });

  it("debounces each route key independently, still one request at a time", async () => {
    vi.useFakeTimers();
    const spy = deferredFetch();
    const routing = service({ fetchImpl: spy.impl, debounceMs: 800 });

    const a = routing.routeDebounced("r1", ROUTE_A, "foot");
    const b = routing.routeDebounced("r2", ROUTE_B, "foot");
    await vi.advanceTimersByTimeAsync(800);

    // Both keys fired, but concurrency is 1: the second waits its turn, which
    // is what keeps a 5-route tour from flooding the public endpoint.
    expect(spy.calls).toHaveLength(1);
    spy.resolve(0, fakeResponse(GEOMETRY_A));
    expect(await a).toMatchObject({ ok: true, coords: ROUTE_A });

    await vi.advanceTimersByTimeAsync(0);
    expect(spy.calls).toHaveLength(2);
    spy.resolve(1, fakeResponse(GEOMETRY_B));
    expect(await b).toMatchObject({ ok: true, coords: ROUTE_B });
  });

  it("cancels an in-flight request that a newer edit superseded", async () => {
    vi.useFakeTimers();
    const spy = deferredFetch();
    const routing = service({ fetchImpl: spy.impl, debounceMs: 800 });

    const first = routing.routeDebounced("r1", ROUTE_A, "foot");
    await vi.advanceTimersByTimeAsync(800);
    expect(spy.calls).toHaveLength(1);
    expect(spy.pending).toBe(1);

    const second = routing.routeDebounced("r1", ROUTE_B, "foot");
    expect(await first).toEqual({ ok: false, reason: "superseded" });
    expect(spy.signals[0]?.aborted).toBe(true);
    expect(spy.pending).toBe(0);

    await vi.advanceTimersByTimeAsync(800);
    spy.resolve(1, fakeResponse(GEOMETRY_B));
    expect(await second).toMatchObject({ ok: true, coords: ROUTE_B });
  });

  it("cancel() settles the pending promise and never fetches", async () => {
    vi.useFakeTimers();
    const spy = deferredFetch();
    const routing = service({ fetchImpl: spy.impl, debounceMs: 800 });

    const pending = routing.routeDebounced("r1", ROUTE_A, "foot");
    expect(routing.pendingKeys).toEqual(["r1"]);
    routing.cancel("r1");

    expect(await pending).toEqual({ ok: false, reason: "cancelled" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(spy.calls).toHaveLength(0);
    expect(routing.pendingKeys).toEqual([]);
  });

  it("cancelAll() drops every key", async () => {
    vi.useFakeTimers();
    const spy = deferredFetch();
    const routing = service({ fetchImpl: spy.impl, debounceMs: 800 });

    const a = routing.routeDebounced("r1", ROUTE_A, "foot");
    const b = routing.routeDebounced("r2", ROUTE_B, "foot");
    routing.cancelAll();

    expect(await a).toEqual({ ok: false, reason: "cancelled" });
    expect(await b).toEqual({ ok: false, reason: "cancelled" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(spy.calls).toHaveLength(0);
  });

  it("reports a timeout to the caller that is still waiting", async () => {
    vi.useFakeTimers();
    const spy = deferredFetch();
    const routing = service({
      fetchImpl: spy.impl,
      debounceMs: 800,
      timeoutMs: 8_000,
    });

    const pending = routing.routeDebounced("r1", ROUTE_A, "foot");
    await vi.advanceTimersByTimeAsync(800 + 8_000);
    expect(await pending).toEqual({ ok: false, reason: "timeout" });
  });
});

describe("shouldDegrade", () => {
  it("is true for real failures the UI must show", () => {
    expect(shouldDegrade({ ok: false, reason: "timeout" })).toBe(true);
    expect(shouldDegrade({ ok: false, reason: "rate-limited" })).toBe(true);
    expect(shouldDegrade({ ok: false, reason: "no-route" })).toBe(true);
    expect(shouldDegrade({ ok: false, reason: "too-few-stops" })).toBe(true);
  });

  it("is false while a newer answer is still coming", () => {
    expect(shouldDegrade({ ok: false, reason: "superseded" })).toBe(false);
    expect(shouldDegrade({ ok: false, reason: "cancelled" })).toBe(false);
  });

  it("is false for success", () => {
    expect(shouldDegrade({ ok: true, coords: ROUTE_A, fromCache: false })).toBe(
      false,
    );
  });
});

describe("attribution", () => {
  it("exposes the credit the UI has to render", () => {
    const routing = service();
    expect(routing.attribution).toContain("OSRM");
    expect(routing.attribution).toContain("OpenStreetMap");
    expect(routing.attributionHtml).toContain("<a href=");
  });
});
