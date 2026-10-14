import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearStoredTour, saveTour } from "../tour/persistence";
import { totalStops } from "../tour/schema";
import {
  addStop,
  deleteStop,
  initStore,
  reorderStops,
  resetStore,
  stopAutosave,
  stopCount,
  tour,
  updateStop,
} from "../tour/store";
import { buildHash, decodeTour, encodeTour } from "../tour/urlShare";
import {
  isTour,
  parseTour,
  parseTourJson,
  serializeTour,
} from "../tour/validate";
import { STARTER_TOUR_ID, starterTour } from "./starterTour";

const TEST_KEY = "tour-brochure-builder:starter-test";

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

afterEach(() => {
  stopAutosave();
  vi.useRealTimers();
  localStorage.clear();
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
      key: TEST_KEY,
      autosave: false,
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
  it("opens the starter tour on a first visit (no URL, no storage)", () => {
    clearStoredTour(TEST_KEY);
    const result = initStore({
      hash: "",
      key: TEST_KEY,
      autosave: false,
      fallback: starterTour,
    });
    expect(result.source).toBe("starter");
    expect(result.readOnly).toBe(false);
    expect(tour.value.id).toBe(STARTER_TOUR_ID);
    expect(stopCount.value).toBeGreaterThanOrEqual(5);
  });

  it("still opens a blank tour when no fallback is supplied", () => {
    clearStoredTour(TEST_KEY);
    const result = initStore({ hash: "", key: TEST_KEY, autosave: false });
    expect(result.source).toBe("new");
    expect(stopCount.value).toBe(0);
  });

  it("a share link in the URL wins over the starter template", () => {
    const shared = starterTour();
    shared.id = "tour_shared";
    shared.title = "Shared tour";
    const result = initStore({
      hash: buildHash(shared),
      key: TEST_KEY,
      autosave: false,
      fallback: starterTour,
    });
    expect(result.source).toBe("url");
    expect(tour.value.id).toBe("tour_shared");
  });

  it("a saved tour in localStorage wins over the starter template", () => {
    const saved = starterTour();
    saved.id = "tour_saved";
    saved.title = "Saved work";
    saveTour(saved, TEST_KEY);
    resetStore();
    const result = initStore({
      hash: "",
      key: TEST_KEY,
      autosave: false,
      fallback: starterTour,
    });
    expect(result.source).toBe("storage");
    expect(tour.value.id).toBe("tour_saved");
  });

  it("editing the starter then reloading restores the edit, not the template", () => {
    vi.useFakeTimers();
    // First visit: starter template, autosave on.
    initStore({ hash: "", key: TEST_KEY, fallback: starterTour });
    expect(tour.value.id).toBe(STARTER_TOUR_ID);
    updateStop(tour.value.routes[0].stops[0].id, { title: "I edited this" });
    addStop({ lat: 41.9, lng: -87.6, title: "My own stop" });
    vi.advanceTimersByTime(1000);
    const afterEdit = serializeTour(tour.value);

    resetStore(); // simulate a reload
    const result = initStore({
      hash: "",
      key: TEST_KEY,
      autosave: false,
      fallback: starterTour,
    });
    expect(result.source).toBe("storage");
    expect(serializeTour(tour.value)).toBe(afterEdit);
    expect(serializeTour(tour.value)).not.toBe(serializeTour(starterTour()));
  });
});
