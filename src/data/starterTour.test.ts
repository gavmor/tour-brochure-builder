import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { totalStops } from "../tour/schema";
import {
  addStop,
  deleteStop,
  initStore,
  reorderStops,
  resetStore,
  stopCount,
  stopHashWatcher,
  stopUrlSync,
  tour,
  updateStop,
} from "../tour/store";
import { buildHash, decodeTour, encodeTour, parseHash } from "../tour/urlShare";
import {
  isTour,
  parseTour,
  parseTourJson,
  serializeTour,
} from "../tour/validate";
import { STARTER_TOUR_ID, starterTour } from "./starterTour";

beforeEach(() => {
  window.location.hash = "";
  resetStore();
});

afterEach(() => {
  stopUrlSync();
  stopHashWatcher();
  window.location.hash = "";
  vi.useRealTimers();
});

describe("starterTour template", () => {
  it("is already canonical, valid tour data", () => {
    const t = starterTour();
    expect(isTour(t)).toBe(true);
    const parsed = parseTour(t);
    expect(parsed.ok).toBe(true);
    // A curated template must need no repair.
    if (parsed.ok) expect(parsed.warnings).toEqual([]);
  });

  it("holds 5-8 stops with the required fields", () => {
    const t = starterTour();
    const count = totalStops(t);
    expect(count).toBeGreaterThanOrEqual(5);
    expect(count).toBeLessThanOrEqual(8);
    for (const route of t.routes) {
      for (const stop of route.stops) {
        expect(stop.title.trim()).not.toBe("");
        expect(Number.isFinite(stop.lat)).toBe(true);
        expect(Number.isFinite(stop.lng)).toBe(true);
        expect(stop.blurb?.trim()).toBeTruthy();
      }
    }
  });

  it("sets a title, tagline and a palette color", () => {
    const t = starterTour();
    expect(t.id).toBe(STARTER_TOUR_ID);
    expect(t.title.trim()).not.toBe("");
    expect(t.tagline?.trim()).toBeTruthy();
    expect(t.routes[0].color).toMatch(/^#/);
  });

  it("carries no 'seeded' or 'locked' flags on stops or routes", () => {
    const t = starterTour();
    const allowedStopKeys = new Set([
      "id",
      "lat",
      "lng",
      "title",
      "blurb",
      "description",
      "imageUrl",
      "category",
    ]);
    for (const route of t.routes) {
      for (const stop of route.stops) {
        for (const key of Object.keys(stop)) {
          expect(allowedStopKeys.has(key)).toBe(true);
        }
      }
    }
  });

  it("returns an independent object graph on every call", () => {
    const a = starterTour();
    const b = starterTour();
    expect(a).toEqual(b);
    a.routes[0].stops[0].title = "mutated";
    expect(b.routes[0].stops[0].title).not.toBe("mutated");
  });
});

describe("starterTour round-trips", () => {
  it("survives serialize -> parse byte-for-byte", () => {
    const t = starterTour();
    const json = serializeTour(t);
    const parsed = parseTourJson(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeTour(parsed.tour)).toBe(json);
  });

  it("survives URL encode -> decode exactly", () => {
    const t = starterTour();
    const decoded = decodeTour(encodeTour(t));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.tour).toEqual(t);
  });
});

describe("starterTour is a fully-editable, ordinary tour", () => {
  beforeEach(() => {
    initStore({
      hash: "",
      urlSync: false,
      watchHash: false,
      fallback: starterTour,
    });
  });

  it("every seeded stop can be edited", () => {
    const stop = tour.value.routes[0].stops[0];
    expect(updateStop(stop.id, { title: "Renamed" })).toBe(true);
    expect(tour.value.routes[0].stops[0].title).toBe("Renamed");
  });

  it("every seeded stop can be deleted", () => {
    const before = stopCount.value;
    const stop = tour.value.routes[0].stops[1];
    expect(deleteStop(stop.id)).toBe(true);
    expect(stopCount.value).toBe(before - 1);
  });

  it("seeded stops can be reordered", () => {
    const first = tour.value.routes[0].stops[0].id;
    expect(reorderStops(0, 2)).toBe(true);
    expect(tour.value.routes[0].stops[2].id).toBe(first);
  });

  it("a new stop lands next to the seeded ones (same code path)", () => {
    const before = stopCount.value;
    const added = addStop({ lat: 41.85, lng: -87.65, title: "My stop" });
    expect(added).not.toBeNull();
    expect(stopCount.value).toBe(before + 1);
  });
});

describe("initStore hydrates the starter template", () => {
  it("opens the starter tour on a bare URL (no hash, no storage anywhere)", () => {
    const result = initStore({
      hash: "",
      urlSync: false,
      watchHash: false,
      fallback: starterTour,
    });
    expect(result.source).toBe("starter");
    expect(result.readOnly).toBe(false);
    expect(tour.value.id).toBe(STARTER_TOUR_ID);
    expect(stopCount.value).toBeGreaterThanOrEqual(5);
  });

  it("still opens a blank tour when no fallback is supplied", () => {
    const result = initStore({ hash: "", urlSync: false, watchHash: false });
    expect(result.source).toBe("new");
    expect(stopCount.value).toBe(0);
  });

  it("a share link in the URL wins over the starter template", () => {
    const shared = starterTour();
    shared.id = "tour_shared";
    shared.title = "Shared tour";
    const result = initStore({
      hash: buildHash(shared),
      urlSync: false,
      watchHash: false,
      fallback: starterTour,
    });
    expect(result.source).toBe("url");
    expect(tour.value.id).toBe("tour_shared");
  });

  it("a stale localStorage blob cannot shadow the starter any more", () => {
    // The old build autosaved here. A returning visitor who still has that key
    // must get the starter on a bare URL, not a resurrected blank map.
    localStorage.setItem(
      "tour-brochure-builder:tour",
      serializeTour({ ...starterTour(), id: "tour_stale", title: "Stale" }),
    );
    try {
      const result = initStore({
        hash: "",
        urlSync: false,
        watchHash: false,
        fallback: starterTour,
      });
      expect(result.source).toBe("starter");
      expect(tour.value.id).toBe(STARTER_TOUR_ID);
    } finally {
      localStorage.clear();
    }
  });

  it("editing the starter puts the edit — not the template — in the URL", () => {
    vi.useFakeTimers();
    // First visit: starter template, URL sync on.
    initStore({ hash: "", watchHash: false, fallback: starterTour });
    expect(tour.value.id).toBe(STARTER_TOUR_ID);
    vi.advanceTimersByTime(1000);
    // Untouched starter == no diff == bare URL.
    expect(window.location.hash).toBe("");

    updateStop(tour.value.routes[0].stops[0].id, { title: "I edited this" });
    addStop({ lat: 41.9, lng: -87.6, title: "My own stop" });
    vi.advanceTimersByTime(1000);
    const afterEdit = serializeTour(tour.value);

    const { encoded } = parseHash(window.location.hash);
    expect(encoded).toBeTruthy();

    resetStore(); // simulate a reload: only the address bar survives
    const result = initStore({
      urlSync: false,
      watchHash: false,
      fallback: starterTour,
    });
    expect(result.source).toBe("url");
    expect(serializeTour(tour.value)).toBe(afterEdit);
    expect(serializeTour(tour.value)).not.toBe(serializeTour(starterTour()));
  });
});
