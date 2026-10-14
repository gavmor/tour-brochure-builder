import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOsrmUrl,
  formatWaypoints,
  parseGeometry,
  parseRetryAfter,
  requestOsrmLeg,
  requestRouteGeometry,
} from "./osrm";
import {
  deferredFetch,
  encodePolyline,
  fakeResponse,
  geoJsonGeometry,
  osrmBody,
} from "./testDoubles";
import type { LatLng } from "./types";

const A: LatLng = [41.8781, -87.6298];
const B: LatLng = [41.8919, -87.6051];
const LINE: LatLng[] = [A, [41.885, -87.617], B];

function okFetch(points: LatLng[] = LINE) {
  return vi.fn(async () => fakeResponse(osrmBody(encodePolyline(points))));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("url construction", () => {
  it("writes waypoints in OSRM's lon,lat order", () => {
    expect(formatWaypoints([A, B])).toBe("-87.6298,41.8781;-87.6051,41.8919");
  });

  it("maps each profile to its own host AND path (ADR 0001)", () => {
    expect(buildOsrmUrl([A, B], "foot")).toContain(
      "https://routing.openstreetmap.de/routed-foot/route/v1/foot/",
    );
    expect(buildOsrmUrl([A, B], "bike")).toContain(
      "https://routing.openstreetmap.de/routed-bike/route/v1/bike/",
    );
    expect(buildOsrmUrl([A, B], "driving")).toContain(
      "https://routing.openstreetmap.de/routed-car/route/v1/driving/",
    );
  });

  it("never points a walking route at the car-only demo server", () => {
    expect(buildOsrmUrl([A, B], "foot")).not.toContain(
      "router.project-osrm.org",
    );
  });

  it("asks for full polyline geometry", () => {
    const url = buildOsrmUrl([A, B], "foot");
    expect(url).toContain("overview=full");
    expect(url).toContain("geometries=polyline");
    expect(url).not.toContain("overview=simplified");
  });
});

describe("parseGeometry", () => {
  it("decodes an encoded polyline", () => {
    expect(parseGeometry(encodePolyline(LINE))).toEqual(LINE);
  });

  it("still accepts a GeoJSON geometry object", () => {
    expect(parseGeometry(geoJsonGeometry(LINE))).toEqual(LINE);
  });

  it("rejects anything else", () => {
    expect(parseGeometry(undefined)).toBeNull();
    expect(parseGeometry(12)).toBeNull();
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds", () => {
    expect(parseRetryAfter("3")).toBe(3000);
  });

  it("reads an HTTP-date relative to now", () => {
    const now = Date.parse("2026-10-14T00:00:00Z");
    expect(parseRetryAfter("Wed, 14 Oct 2026 00:00:10 GMT", now)).toBe(10_000);
  });

  it("ignores junk and absence", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});

describe("requestOsrmLeg", () => {
  it("returns road geometry as [lat, lng]", async () => {
    const fetchImpl = okFetch();
    const result = await requestOsrmLeg([A, B], "foot", { fetchImpl });

    expect(result).toEqual({ ok: true, fromCache: false, coords: LINE });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("makes no request for fewer than two waypoints", async () => {
    const fetchImpl = okFetch();
    expect(await requestOsrmLeg([A], "foot", { fetchImpl })).toEqual({
      ok: false,
      reason: "too-few-stops",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("times out via AbortController instead of hanging", async () => {
    vi.useFakeTimers();
    const spy = deferredFetch();
    const pending = requestOsrmLeg([A, B], "foot", {
      fetchImpl: spy.impl,
      timeoutMs: 8_000,
    });

    await vi.advanceTimersByTimeAsync(7_999);
    expect(spy.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toEqual({ ok: false, reason: "timeout" });
    expect(spy.pending).toBe(0);
  });

  it("reports 429 with the Retry-After budget", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse(
        { message: "slow down" },
        { status: 429, headers: { "retry-after": "2" } },
      ),
    );
    expect(await requestOsrmLeg([A, B], "foot", { fetchImpl })).toEqual({
      ok: false,
      reason: "rate-limited",
      status: 429,
      retryAfterMs: 2_000,
    });
  });

  it("reports other HTTP failures with their status", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(null, { status: 503 }));
    expect(await requestOsrmLeg([A, B], "foot", { fetchImpl })).toEqual({
      ok: false,
      reason: "http-error",
      status: 503,
    });
  });

  it("reports a body that is not JSON", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse(null, { invalidJson: true }),
    );
    const result = await requestOsrmLeg([A, B], "foot", { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("malformed-response");
  });

  it.each([
    ["missing code", { routes: [] }],
    [
      "a geometry that is not a polyline",
      { code: "Ok", routes: [{ geometry: 7 }] },
    ],
    ["a corrupt polyline", { code: "Ok", routes: [{ geometry: "!!!" }] }],
    [
      "non-numeric GeoJSON coordinates",
      { code: "Ok", routes: [{ geometry: { coordinates: [["a", "b"]] } }] },
    ],
    [
      "a single-point geometry",
      { code: "Ok", routes: [{ geometry: { coordinates: [[1, 2]] } }] },
    ],
  ])("rejects %s as malformed", async (_label, body) => {
    const fetchImpl = vi.fn(async () => fakeResponse(body));
    const result = await requestOsrmLeg([A, B], "foot", { fetchImpl });
    expect(result.ok === false && result.reason).toBe("malformed-response");
  });

  it("maps OSRM's own error codes", async () => {
    const noRoute = vi.fn(async () =>
      fakeResponse({ code: "NoRoute", message: "Impossible route" }),
    );
    expect(
      await requestOsrmLeg([A, B], "foot", { fetchImpl: noRoute }),
    ).toEqual({
      ok: false,
      reason: "no-route",
      detail: "NoRoute: Impossible route",
    });

    const invalid = vi.fn(async () => fakeResponse({ code: "InvalidQuery" }));
    expect(
      await requestOsrmLeg([A, B], "foot", { fetchImpl: invalid }),
    ).toEqual({
      ok: false,
      reason: "api-error",
      detail: "InvalidQuery",
    });
  });

  it("treats an Ok body with no routes as no-route", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ code: "Ok", routes: [] }),
    );
    expect(await requestOsrmLeg([A, B], "foot", { fetchImpl })).toMatchObject({
      ok: false,
      reason: "no-route",
    });
  });

  it("reports a rejected fetch as a network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await requestOsrmLeg([A, B], "foot", { fetchImpl })).toEqual({
      ok: false,
      reason: "network-error",
      detail: "Failed to fetch",
    });
  });

  it("reports caller cancellation as cancelled, not as an error", async () => {
    const spy = deferredFetch();
    const controller = new AbortController();
    const pending = requestOsrmLeg([A, B], "foot", {
      fetchImpl: spy.impl,
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toEqual({ ok: false, reason: "cancelled" });
  });

  it("does not fire when the caller's signal is already aborted", async () => {
    const fetchImpl = okFetch();
    const controller = new AbortController();
    controller.abort();
    expect(
      await requestOsrmLeg([A, B], "foot", {
        fetchImpl,
        signal: controller.signal,
      }),
    ).toEqual({ ok: false, reason: "cancelled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("requestRouteGeometry", () => {
  const waypoints: LatLng[] = [
    [41.1, -87.1],
    [41.2, -87.2],
    [41.3, -87.3],
    [41.4, -87.4],
    [41.5, -87.5],
  ];

  it("sends one request when the waypoints fit", async () => {
    const fetchImpl = okFetch();
    const result = await requestRouteGeometry(waypoints, "foot", { fetchImpl });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("chunks past the waypoint limit and stitches the legs", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      const leg =
        calls.length === 1 ? waypoints.slice(0, 3) : waypoints.slice(2, 5);
      return fakeResponse(osrmBody(encodePolyline(leg)));
    });

    const result = await requestRouteGeometry(waypoints, "foot", {
      fetchImpl,
      maxWaypointsPerRequest: 3,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(calls[0]).toContain("-87.1,41.1;-87.2,41.2;-87.3,41.3");
    expect(calls[1]).toContain("-87.3,41.3;-87.4,41.4;-87.5,41.5");
    // Seam point 41.3,-87.3 appears once, not twice.
    expect(result).toEqual({ ok: true, fromCache: false, coords: waypoints });
  });

  it("fails the whole route when a leg fails", async () => {
    const fetchImpl = vi
      .fn<(url: string) => Promise<Response>>()
      .mockResolvedValueOnce(
        fakeResponse(osrmBody(encodePolyline(waypoints.slice(0, 3)))),
      )
      .mockResolvedValueOnce(fakeResponse(null, { status: 500 }));

    expect(
      await requestRouteGeometry(waypoints, "foot", {
        fetchImpl,
        maxWaypointsPerRequest: 3,
      }),
    ).toEqual({ ok: false, reason: "http-error", status: 500 });
  });

  it("waits between legs when asked to", async () => {
    const fetchImpl = okFetch();
    const onBetweenLegs = vi.fn(async () => {});
    await requestRouteGeometry(waypoints, "foot", {
      fetchImpl,
      maxWaypointsPerRequest: 3,
      onBetweenLegs,
    });
    expect(onBetweenLegs).toHaveBeenCalledTimes(1);
  });

  it("short-circuits a one-stop route", async () => {
    const fetchImpl = okFetch();
    expect(await requestRouteGeometry([A], "foot", { fetchImpl })).toEqual({
      ok: false,
      reason: "too-few-stops",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
