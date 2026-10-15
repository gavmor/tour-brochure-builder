/**
 * The editor map's route lines, rendered through real Leaflet in jsdom.
 *
 * This is where the card's acceptance criteria actually live: every route
 * draws in its own color, a route whose geometry fails degrades to a straight
 * dashed line, and nothing ever ends up blank. The state layer is covered in
 * `routeGeometry.test.ts`; these tests check that what the state says reaches
 * the SVG.
 */

import { render } from "preact";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createRoutingService } from "../routing";
import {
  deferredFetch,
  encodePolyline,
  type FetchSpy,
  fakeResponse,
  osrmBody,
} from "../routing/testDoubles";
import type { LatLng } from "../routing/types";
import { twoRouteTour } from "../tour/fixtures";
import { loadTour, resetStore } from "../tour/store";
import { MapEditor } from "./MapEditor";
import { resetRouteGeometry, setRoutingService } from "./routeGeometry";

let host: HTMLDivElement;
let spy: FetchSpy;

/** Plausible road geometry for the fixture's green route. */
const ROAD: LatLng[] = [
  [41.8902, -87.6185],
  [41.8951, -87.6212],
  [41.8885, -87.6241],
];

/**
 * jsdom reports every element as 0×0, and a Leaflet map with no size clips
 * every polyline to `d="M0 0"` — which would make the geometry assertions
 * below vacuous. Give elements a viewport-sized box for this file.
 */
const sizeStubs = ["clientWidth", "clientHeight"] as const;
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  for (const name of sizeStubs) {
    originalDescriptors.set(
      name,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
    );
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get: () => (name === "clientWidth" ? 800 : 600),
    });
  }
});

afterAll(() => {
  for (const name of sizeStubs) {
    const original = originalDescriptors.get(name);
    if (original) Object.defineProperty(HTMLElement.prototype, name, original);
    else
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        value: 0,
      });
  }
});

beforeEach(() => {
  resetStore();
  resetRouteGeometry();
  spy = deferredFetch();
  setRoutingService(
    createRoutingService({
      fetchImpl: spy.impl,
      storage: null,
      debounceMs: 0,
      minRequestIntervalMs: 0,
    }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  resetRouteGeometry();
});

/**
 * Preact flushes effects on an animation frame, Leaflet lays out on the next
 * one, and the debounce timer is a real `setTimeout` — so a tick here has to
 * yield to both the frame callback and the macrotask queue.
 */
async function flush(ticks = 8) {
  for (let i = 0; i < ticks; i++) {
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === "function")
        requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

function paths(): SVGPathElement[] {
  return Array.from(
    host.querySelectorAll<SVGPathElement>(".leaflet-overlay-pane path"),
  );
}

/**
 * The service runs one request at a time, so a queued route has no settler
 * yet when the first one is answered. Settle repeatedly, letting the queue
 * advance between rounds, until every route has an answer.
 */
async function settleAll(settle: (index: number) => void, rounds = 4) {
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < spy.calls.length; i++) settle(i);
    await flush(2);
  }
}

const roadResponse = () => fakeResponse(osrmBody(encodePolyline(ROAD)));
const offline = () => new TypeError("Failed to fetch");

describe("MapEditor route lines", () => {
  it("draws a line per route in the route's own color, straight away", async () => {
    loadTour(twoRouteTour());
    render(<MapEditor />, host);
    await flush();
    // The router has been asked but has not answered: both routes already
    // have a solid, colored line on the map.
    expect(spy.pending).toBeGreaterThan(0);
    const strokes = paths().map((p) => p.getAttribute("stroke"));
    expect(strokes).toEqual(["#1E8449", "#C0392B"]);
    expect(paths().every((p) => p.getAttribute("d"))).toBe(true);
    expect(paths().some((p) => p.getAttribute("stroke-dasharray"))).toBe(false);
  });

  it("swaps in road geometry without changing the color or the line count", async () => {
    loadTour(twoRouteTour());
    render(<MapEditor />, host);
    await flush();

    const before = paths().map((p) => p.getAttribute("d"));
    spy.resolve(0, fakeResponse(osrmBody(encodePolyline(ROAD))));
    await flush();

    const after = paths().map((p) => p.getAttribute("d"));
    expect(after).toHaveLength(2);
    // The routed line is a different shape; the other route is untouched.
    expect(after[0]).not.toBe(before[0]);
    expect(paths()[0].getAttribute("stroke")).toBe("#1E8449");
    expect(paths()[0].getAttribute("stroke-dasharray")).toBeNull();
  });

  it("falls back to a straight dashed line when the endpoint is blocked", async () => {
    loadTour(twoRouteTour());
    render(<MapEditor />, host);
    await flush();

    const straight = paths().map((p) => p.getAttribute("d"));
    await settleAll((i) => spy.reject(i, offline()));

    // Never blank: both lines are still there, still colored, still the
    // straight geometry — now dashed to say so.
    expect(paths()).toHaveLength(2);
    expect(paths().map((p) => p.getAttribute("d"))).toEqual(straight);
    expect(paths().map((p) => p.getAttribute("stroke"))).toEqual([
      "#1E8449",
      "#C0392B",
    ]);
    expect(paths().map((p) => p.getAttribute("stroke-dasharray"))).toEqual([
      "7 7",
      "7 7",
    ]);
  });

  it("clears the dashes once a later request succeeds", async () => {
    loadTour(twoRouteTour());
    render(<MapEditor />, host);
    await flush();
    await settleAll((i) => spy.reject(i, offline()));
    expect(paths()[0].getAttribute("stroke-dasharray")).toBe("7 7");

    // Nudge a stop on the green route so a fresh request goes out, and let
    // the router answer this time.
    const nudged = twoRouteTour();
    nudged.routes[0].stops[0].lat += 0.001;
    loadTour(nudged);
    await flush();
    await settleAll((i) => spy.resolve(i, roadResponse()));

    expect(paths()[0].getAttribute("stroke-dasharray")).toBeNull();
  });

  it("credits the routing endpoints in Leaflet's attribution control", async () => {
    loadTour(twoRouteTour());
    render(<MapEditor />, host);
    await flush(2);
    const credit = host.querySelector(".leaflet-control-attribution");
    expect(credit?.textContent).toContain("OpenStreetMap");
    expect(credit?.textContent).toContain("OSRM");
  });
});
