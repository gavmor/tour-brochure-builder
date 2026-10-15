/**
 * The resilience path for "Add sites near a location".
 *
 * Ported from the spike's `tests/fallback.test.mjs` — QA's own suite from task
 * t_9f25df7e, including the QA-BUG-3 latency pins — by task t_40ec912a.
 *
 * The contract these hold down:
 * - a failure is *reported*, never swallowed, so the UI can offer the curated
 *   set instead of showing an empty dialog;
 * - the whole proposal step shares one deadline, so a total outage costs ~one
 *   deadline rather than one timeout per mirror;
 * - an outage is remembered briefly, so the next identical query falls back
 *   instantly instead of paying the deadline again;
 * - a cancel is immediate, and is not mistaken for an outage;
 * - a successful query is cached for the session.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPoiCache,
  DEFAULTS,
  describeError,
  findPois,
  forgetOutage,
  geocode,
  OVERPASS_ENDPOINTS,
  PoiNetworkError,
  recentOutage,
  resetNominatimGate,
} from "./index";

const BBOX = { south: 41.8, west: -87.7, north: 41.9, east: -87.6 };

const ONE_GOOD_RESULT = {
  elements: [
    {
      type: "node",
      id: 7,
      lat: 41.88,
      lon: -87.62,
      tags: { name: "Cloud Gate", tourism: "attraction", wikidata: "Q1" },
    },
  ],
};

let calls: string[] = [];

function installFetch(
  impl: (url: string, init?: RequestInit) => Promise<unknown>,
): void {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    return impl(String(url), init);
  });
}

function ok(json: unknown) {
  // The Overpass path reads `.text()` (an overloaded instance answers 200 with
  // an XML error page); the Nominatim path reads `.json()`.
  const body = JSON.stringify(json);
  return {
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => body,
  };
}

/** A 200 whose body is not JSON — what an overloaded Overpass actually sends. */
function errorPage() {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token '<'");
    },
    text: async () =>
      '<?xml version="1.0"?><osm-derived><remark>runtime error</remark></osm-derived>',
  };
}

/** A request that only the caller's own timeout (or a cancel) can end. */
let fetchStartedAt = 0;
function installHangingFetch(): void {
  installFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        fetchStartedAt = Date.now();
        const signal = init?.signal;
        if (!signal) return; // nothing can ever end this request
        const fail = () => reject(new DOMException("aborted", "AbortError"));
        if (signal.aborted) fail();
        else signal.addEventListener("abort", fail, { once: true });
      }),
  );
}

beforeEach(() => {
  clearPoiCache();
  forgetOutage();
  // The >= 1 s Nominatim gate would otherwise serialise the whole suite.
  resetNominatimGate();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearPoiCache();
});

describe("failures are reported, not swallowed", () => {
  it("rejects when Nominatim is unreachable, with no retry storm", async () => {
    installFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(geocode("Boston")).rejects.toThrow(/Failed to fetch/);
    expect(calls).toHaveLength(1);
  });

  it("rejects on an HTTP error status", async () => {
    installFetch(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    await expect(geocode("Boston")).rejects.toThrow(/Nominatim HTTP 503/);
  });

  it("rejects when the place has no match", async () => {
    installFetch(async () => ok([]));
    await expect(geocode("Nowheresville")).rejects.toThrow(/no place matched/);
  });

  it("tries every Overpass mirror before giving up", async () => {
    installFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(findPois(BBOX)).rejects.toThrow(/Failed to fetch/);
    expect(calls).toHaveLength(OVERPASS_ENDPOINTS.length);
  });

  it("falls through a bad payload to the next mirror", async () => {
    installFetch(async (url) =>
      url === OVERPASS_ENDPOINTS[0] ? ok({ nope: true }) : ok(ONE_GOOD_RESULT),
    );
    const { candidates } = await findPois(BBOX);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].title).toBe("Cloud Gate");
    expect(calls).toHaveLength(2); // stopped at the first mirror that worked
  });

  it("treats an Overpass error page as a failure, in plain words", async () => {
    installFetch(async (url) =>
      url === OVERPASS_ENDPOINTS[0] ? errorPage() : ok(ONE_GOOD_RESULT),
    );
    const { candidates, endpoint } = await findPois(BBOX);
    expect(candidates).toHaveLength(1);
    expect(endpoint).toBe(OVERPASS_ENDPOINTS[1]);

    // And when every mirror does it, the message says what happened rather
    // than leaking "Unexpected token '<'".
    installFetch(async () => errorPage());
    await expect(findPois(BBOX)).rejects.toThrow(/error page/);
  });

  it("describes a failure in words the UI can show", () => {
    expect(describeError(new PoiNetworkError("timeout", "x"))).toBe(
      "timed out",
    );
    expect(describeError(new PoiNetworkError("cancelled", "x"))).toBe(
      "cancelled",
    );
    expect(describeError(new TypeError("Failed to fetch"))).toBe(
      "you appear to be offline",
    );
    // Every browser words it differently; the user's situation is the same.
    expect(
      describeError(
        new TypeError("NetworkError when attempting to fetch resource."),
      ),
    ).toBe("you appear to be offline");
    expect(describeError(new TypeError("Load failed"))).toBe(
      "you appear to be offline",
    );
    // A TypeError that is not a dead network still says what it was.
    expect(describeError(new TypeError("x is not a function"))).toBe(
      "x is not a function",
    );
    expect(describeError(null)).toBe("unknown error");
  });
});

describe("cancellation", () => {
  it("stops trying further mirrors at once", async () => {
    const controller = new AbortController();
    installFetch(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(findPois(BBOX, { signal: controller.signal })).rejects.toThrow(
      /abort|cancel/i,
    );
    expect(calls).toHaveLength(1);
  });

  it("is not remembered as an outage", async () => {
    const controller = new AbortController();
    installFetch(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(findPois(BBOX, { signal: controller.signal })).rejects.toThrow(
      /abort|cancel/i,
    );
    expect(recentOutage()).toBeNull();
  });
});

describe("session cache", () => {
  it("serves a repeated query without a second request", async () => {
    installFetch(async () => ok(ONE_GOOD_RESULT));

    const first = await findPois(BBOX, { cacheQuery: "chicago" });
    expect(first.cached).toBe(false);
    const after = calls.length;

    const second = await findPois(BBOX, { cacheQuery: "chicago" });
    expect(second.cached).toBe(true);
    expect(calls).toHaveLength(after);
    expect(second.candidates).toEqual(first.candidates);
  });

  it("caches a geocode the same way", async () => {
    installFetch(async () =>
      ok([{ lat: "41.88", lon: "-87.63", display_name: "Chicago" }]),
    );
    const first = await geocode("Chicago");
    expect(first.cached).toBe(false);
    const second = await geocode("Chicago");
    expect(second.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe("hedged mirrors", () => {
  /** A fetch where each endpoint answers after its own delay. */
  function installTimedFetch(delays: Record<string, number>): void {
    installFetch(
      (url, init) =>
        new Promise((resolve, reject) => {
          const signal = init?.signal;
          const ms = delays[url];
          const timer =
            ms === undefined
              ? null
              : setTimeout(() => resolve(ok(ONE_GOOD_RESULT)), ms);
          signal?.addEventListener(
            "abort",
            () => {
              if (timer) clearTimeout(timer);
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    );
  }

  it("lets a slow but healthy mirror win instead of timing it out", async () => {
    // The first mirror is slower than its 1/3 share of the budget. Under the
    // old even split it could never answer; hedged, it still wins.
    installTimedFetch({ [OVERPASS_ENDPOINTS[0]]: 450 });
    const started = Date.now();
    const result = await findPois(BBOX, { deadlineAt: Date.now() + 900 });

    expect(result.endpoint).toBe(OVERPASS_ENDPOINTS[0]);
    expect(result.candidates).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(900);
  });

  it("brings in the next mirror when the first is slow, and takes the first answer", async () => {
    installTimedFetch({
      // The first never answers; the second does, once hedged in.
      [OVERPASS_ENDPOINTS[1]]: 50,
    });
    const result = await findPois(BBOX, { deadlineAt: Date.now() + 900 });

    expect(result.endpoint).toBe(OVERPASS_ENDPOINTS[1]);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(recentOutage()).toBeNull();
  });
});

describe("the documented latency budget (QA-BUG-3)", () => {
  it("keeps the per-request and politeness constants within policy", () => {
    expect(DEFAULTS.fetchTimeoutMs).toBeLessThanOrEqual(10_000);
    expect(DEFAULTS.nominatimMinIntervalMs).toBeGreaterThanOrEqual(1000);
    expect(DEFAULTS.debounceMs).toBeGreaterThanOrEqual(500);
  });

  it("beats the serial-timeout worst case by a wide margin", () => {
    const oldWorstCase = DEFAULTS.fetchTimeoutMs * OVERPASS_ENDPOINTS.length;
    expect(DEFAULTS.proposalDeadlineMs).toBeLessThanOrEqual(20_000);
    expect(DEFAULTS.proposalDeadlineMs).toBeGreaterThanOrEqual(5_000);
    expect(DEFAULTS.proposalDeadlineMs).toBeLessThan(oldWorstCase);
    expect(DEFAULTS.outageMemoMs).toBeGreaterThanOrEqual(30_000);
    // A hedged mirror must be brought in well inside the budget, or hedging
    // is decoration.
    expect(DEFAULTS.hedgeDelayMs).toBeLessThan(DEFAULTS.proposalDeadlineMs / 2);
  });

  it("spends one shared deadline on a total outage, not one per mirror", async () => {
    installHangingFetch();
    const deadline = 900;
    const started = Date.now();

    await expect(
      findPois(BBOX, { deadlineAt: started + deadline }),
    ).rejects.toThrow();

    const elapsed = Date.now() - started;
    expect(calls).toHaveLength(OVERPASS_ENDPOINTS.length);
    expect(elapsed).toBeLessThanOrEqual(deadline + 400);
    // The other direction: the mirrors really were given the budget, rather
    // than the loop bailing out on the first failure.
    expect(elapsed).toBeGreaterThanOrEqual(deadline * 0.5);
  });

  it("makes the next query after an outage fall back instantly", async () => {
    installHangingFetch();
    await expect(
      findPois(BBOX, { deadlineAt: Date.now() + 600 }),
    ).rejects.toThrow();
    const attemptsDuringOutage = calls.length;
    expect(recentOutage()).not.toBeNull();

    const started = Date.now();
    await expect(
      findPois(BBOX, { deadlineAt: Date.now() + 600 }),
    ).rejects.toThrow(/unavailable moments ago/);
    expect(Date.now() - started).toBeLessThan(100);
    expect(calls).toHaveLength(attemptsDuringOutage);
  });

  it("forgets an outage once a mirror answers again", async () => {
    installHangingFetch();
    await expect(
      findPois(BBOX, { deadlineAt: Date.now() + 400 }),
    ).rejects.toThrow();
    expect(recentOutage()).not.toBeNull();

    forgetOutage(); // what the UI's "Try again" does
    installFetch(async () => ok(ONE_GOOD_RESULT));
    const { candidates } = await findPois(BBOX);
    expect(candidates).toHaveLength(1);
    expect(recentOutage()).toBeNull();
  });

  it("never lets geocoding eat the whole proposal deadline", async () => {
    installHangingFetch();
    const deadlineAt = Date.now() + 1600;

    await expect(geocode("Chicago", { deadlineAt })).rejects.toThrow();

    // Measured from when the request actually went out, so the >= 1 s
    // Nominatim gate is excluded: geocoding may use at most half of what was
    // left at that moment, leaving the rest for Overpass.
    const allowed = (deadlineAt - fetchStartedAt) / 2;
    const used = Date.now() - fetchStartedAt;
    expect(used).toBeLessThanOrEqual(allowed + 250);
    expect(used).toBeGreaterThanOrEqual(allowed - 250);
  });
});
