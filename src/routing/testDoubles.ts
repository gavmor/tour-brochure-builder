/**
 * Test doubles for the routing layer. Imported only by `*.test.ts` — it is not
 * part of the app bundle (nothing in `src/editor`, `src/brochure` or
 * `src/tour` imports it).
 */

import type { FetchLike } from "./osrm";
import type { LatLng } from "./types";

export interface FakeResponseInit {
  status?: number;
  headers?: Record<string, string>;
  /** Make `response.json()` reject, as a truncated body would. */
  invalidJson?: boolean;
}

export function fakeResponse(
  body: unknown,
  init: FakeResponseInit = {},
): Response {
  const status = init.status ?? 200;
  const headers = init.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => {
      if (init.invalidJson)
        throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
  } as unknown as Response;
}

/** A well-formed OSRM `/route/v1` body. `geometry` is whatever the query asked
 * for: an encoded polyline string (our default) or a GeoJSON object. */
export function osrmBody(geometry: unknown) {
  return {
    code: "Ok",
    routes: [
      {
        distance: 1234.5,
        duration: 678.9,
        geometry,
      },
    ],
    waypoints: [],
  };
}

/** GeoJSON geometry object for a line, from `[lat, lng]` points. */
export function geoJsonGeometry(points: LatLng[]) {
  return {
    type: "LineString",
    coordinates: points.map(([lat, lng]) => [lng, lat]),
  };
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

/**
 * Encode `[lat, lng]` points the way OSRM's `geometries=polyline` does.
 * Test-side counterpart of `decodePolyline`, so the decoder is checked against
 * an independent implementation as well as the canonical fixture.
 */
export function encodePolyline(points: LatLng[], precision = 5): string {
  const factor = 10 ** precision;
  let out = "";
  let prevLat = 0;
  let prevLng = 0;
  for (const [lat, lng] of points) {
    const iLat = Math.round(lat * factor);
    const iLng = Math.round(lng * factor);
    out += encodeValue(iLat - prevLat) + encodeValue(iLng - prevLng);
    prevLat = iLat;
    prevLng = iLng;
  }
  return out;
}

export interface FetchSpy {
  impl: FetchLike;
  calls: string[];
  signals: (AbortSignal | undefined)[];
  /** Resolve the Nth outstanding request. */
  resolve(index: number, response: Response): void;
  reject(index: number, error: unknown): void;
  readonly pending: number;
}

/**
 * A fetch double whose requests stay open until the test resolves them —
 * the only way to observe queueing, de-duplication and cancellation.
 */
export function deferredFetch(): FetchSpy {
  const calls: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const settlers: {
    resolve: (r: Response) => void;
    reject: (e: unknown) => void;
    done: boolean;
  }[] = [];

  const impl: FetchLike = (url, init) => {
    calls.push(url);
    signals.push(init?.signal);
    return new Promise<Response>((resolve, reject) => {
      const entry = { resolve, reject, done: false };
      settlers.push(entry);
      init?.signal?.addEventListener("abort", () => {
        if (entry.done) return;
        entry.done = true;
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        reject(error);
      });
    });
  };

  return {
    impl,
    calls,
    signals,
    resolve(index, response) {
      const entry = settlers[index];
      if (!entry || entry.done) return;
      entry.done = true;
      entry.resolve(response);
    },
    reject(index, error) {
      const entry = settlers[index];
      if (!entry || entry.done) return;
      entry.done = true;
      entry.reject(error);
    },
    get pending() {
      return settlers.filter((s) => !s.done).length;
    },
  };
}

/** In-memory `Storage` stand-in; `failOnSet` simulates an exceeded quota. */
export function memoryStorage(options: { failOnSet?: boolean } = {}) {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (options.failOnSet) throw new Error("QuotaExceededError");
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}
