import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bigTour, twoRouteTour, v1Tour } from "./fixtures";
import { clearStoredTour, loadStoredTour, saveTour } from "./persistence";
import { createStop, ROUTE_COLORS, type Tour } from "./schema";
import {
  activeRoute,
  activeRouteId,
  addRoute,
  addStop,
  applyHash,
  deleteRoute,
  deleteStop,
  editCopy,
  initStore,
  lastLoadNotice,
  loadTour,
  moveStop,
  moveStopToRoute,
  newTour,
  readOnly,
  reorderRoutes,
  reorderStops,
  resetStore,
  saveNow,
  selectedStopId,
  setTourMeta,
  shareEncodedLength,
  shareUrlWarning,
  startAutosave,
  startHashWatcher,
  stopAutosave,
  stopCount,
  stopHashWatcher,
  tour,
  updateRoute,
  updateStop,
} from "./store";
import { buildHash, encodeTour } from "./urlShare";
import { serializeTour } from "./validate";

const TEST_KEY = "tbb-test-key";

function titles(t: Tour, routeIndex = 0) {
  return t.routes[routeIndex].stops.map((s) => s.title);
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

afterEach(() => {
  stopAutosave();
  vi.useRealTimers();
});

describe("newTour / loadTour", () => {
  it("newTour starts a blank editable tour with one route", () => {
    loadTour(twoRouteTour(), { readOnly: true });
    const fresh = newTour({ title: "Fresh" });
    expect(tour.value.id).toBe(fresh.id);
    expect(tour.value.title).toBe("Fresh");
    expect(tour.value.routes).toHaveLength(1);
    expect(readOnly.value).toBe(false);
    expect(activeRouteId.value).toBe(fresh.routes[0].id);
    expect(stopCount.value).toBe(0);
  });

  it("loadTour accepts a canonical tour and selects its first route", () => {
    const result = loadTour(twoRouteTour());
    expect(result.ok).toBe(true);
    expect(tour.value.title).toBe("Downtown Tour");
    expect(activeRouteId.value).toBe("route_green");
    expect(activeRoute.value?.name).toBe("Green Route");
    expect(stopCount.value).toBe(5);
  });

  it("loadTour repairs and migrates untrusted input", () => {
    const result = loadTour(v1Tour());
    expect(result.ok).toBe(true);
    expect(tour.value.routes).toHaveLength(1);
    expect(stopCount.value).toBe(2);
    expect(lastLoadNotice.value?.warnings.join(" ")).toMatch(/version 1/i);
  });

  it("loadTour leaves the current tour alone when input is unusable", () => {
    loadTour(twoRouteTour());
    const before = serializeTour(tour.value);
    const result = loadTour("nonsense");
    expect(result.ok).toBe(false);
    expect(serializeTour(tour.value)).toBe(before);
    expect(lastLoadNotice.value?.errors.length).toBeGreaterThan(0);
  });

  it("loadTour can open read-only", () => {
    loadTour(twoRouteTour(), { readOnly: true });
    expect(readOnly.value).toBe(true);
  });
});

describe("stop actions", () => {
  beforeEach(() => {
    loadTour(twoRouteTour());
  });

  it("addStop appends to the active route", () => {
    const stop = addStop({
      lat: 41.87,
      lng: -87.62,
      title: "Buckingham Fountain",
    });
    expect(stop).not.toBeNull();
    expect(titles(tour.value)).toEqual([
      "Sheraton Hotel",
      "Michigan Avenue Bridge",
      "Skydeck",
      "Buckingham Fountain",
    ]);
    expect(stopCount.value).toBe(6);
  });

  it("addStop can target another route explicitly", () => {
    addStop({ lat: 41.87, lng: -87.62, title: "Adler" }, "route_red");
    expect(titles(tour.value, 1)).toEqual([
      "Sheraton Hotel",
      "Navy Pier",
      "Adler",
    ]);
    expect(titles(tour.value, 0)).toHaveLength(3);
  });

  it("moveStop repositions without touching the copy", () => {
    expect(moveStop("stop_skydeck", 41.0, -88.0)).toBe(true);
    const stop = tour.value.routes[0].stops[2];
    expect([stop.lat, stop.lng]).toEqual([41.0, -88.0]);
    expect(stop.title).toBe("Skydeck");
    expect(moveStop("missing", 1, 2)).toBe(false);
    expect(moveStop("stop_skydeck", Number.NaN, 2)).toBe(false);
  });

  it("updateStop patches fields and can clear an optional one", () => {
    expect(
      updateStop("stop_bridge", {
        title: "DuSable Bridge",
        description: "1920 bascule.",
      }),
    ).toBe(true);
    const stop = tour.value.routes[0].stops[1];
    expect(stop.title).toBe("DuSable Bridge");
    expect(stop.description).toBe("1920 bascule.");
    updateStop("stop_bridge", { blurb: undefined });
    expect("blurb" in tour.value.routes[0].stops[1]).toBe(false);
    expect(updateStop("missing", { title: "x" })).toBe(false);
  });

  it("updateStop cannot change the id", () => {
    updateStop("stop_bridge", { title: "Still here" } as never);
    expect(tour.value.routes[0].stops[1].id).toBe("stop_bridge");
  });

  it("deleteStop removes the stop and clears the selection", () => {
    selectedStopId.value = "stop_bridge";
    expect(deleteStop("stop_bridge")).toBe(true);
    expect(titles(tour.value)).toEqual(["Sheraton Hotel", "Skydeck"]);
    expect(selectedStopId.value).toBeNull();
    expect(deleteStop("stop_bridge")).toBe(false);
  });

  it("deletes from the correct route when ids collide across routes", () => {
    expect(deleteStop("stop_navy_pier")).toBe(true);
    expect(titles(tour.value, 0)).toHaveLength(3);
    expect(titles(tour.value, 1)).toEqual(["Sheraton Hotel"]);
  });

  it("moveStopToRoute moves a stop between routes", () => {
    expect(moveStopToRoute("stop_skydeck", "route_red", 0)).toBe(true);
    expect(titles(tour.value, 0)).toEqual([
      "Sheraton Hotel",
      "Michigan Avenue Bridge",
    ]);
    expect(titles(tour.value, 1)).toEqual([
      "Skydeck",
      "Sheraton Hotel",
      "Navy Pier",
    ]);
    expect(moveStopToRoute("stop_skydeck", "nope")).toBe(false);
  });
});

describe("reorderStops", () => {
  beforeEach(() => {
    loadTour(twoRouteTour());
  });

  it("moves a stop down the itinerary", () => {
    expect(reorderStops(0, 2)).toBe(true);
    expect(titles(tour.value)).toEqual([
      "Michigan Avenue Bridge",
      "Skydeck",
      "Sheraton Hotel",
    ]);
  });

  it("moves a stop up the itinerary", () => {
    expect(reorderStops(2, 0)).toBe(true);
    expect(titles(tour.value)).toEqual([
      "Skydeck",
      "Sheraton Hotel",
      "Michigan Avenue Bridge",
    ]);
  });

  it("is a no-op for out-of-range or identical indices", () => {
    const before = titles(tour.value);
    for (const [from, to] of [
      [0, 0],
      [-1, 1],
      [0, 9],
      [9, 0],
    ]) {
      expect(reorderStops(from, to)).toBe(false);
    }
    expect(titles(tour.value)).toEqual(before);
  });

  it("only touches the targeted route", () => {
    expect(reorderStops(0, 1, "route_red")).toBe(true);
    expect(titles(tour.value, 1)).toEqual(["Navy Pier", "Sheraton Hotel"]);
    expect(titles(tour.value, 0)).toEqual([
      "Sheraton Hotel",
      "Michigan Avenue Bridge",
      "Skydeck",
    ]);
  });

  it("preserves stop identity, not just titles", () => {
    const ids = tour.value.routes[0].stops.map((s) => s.id);
    reorderStops(0, 2);
    expect(tour.value.routes[0].stops.map((s) => s.id)).toEqual([
      ids[1],
      ids[2],
      ids[0],
    ]);
  });
});

describe("route actions", () => {
  beforeEach(() => {
    loadTour(twoRouteTour());
  });

  it("addRoute appends a palette-colored route and makes it active", () => {
    const route = addRoute({ name: "Night Tour" });
    expect(route).not.toBeNull();
    expect(tour.value.routes).toHaveLength(3);
    expect(tour.value.routes[2].name).toBe("Night Tour");
    expect(tour.value.routes[2].color).toBe(ROUTE_COLORS[2]);
    expect(activeRouteId.value).toBe(route?.id);
  });

  it("updateRoute renames and recolors", () => {
    expect(
      updateRoute("route_red", { name: "Crimson", color: "#ff0000" }),
    ).toBe(true);
    expect(tour.value.routes[1]).toMatchObject({
      name: "Crimson",
      color: "#ff0000",
    });
    expect(updateRoute("missing", { name: "x" })).toBe(false);
  });

  it("deleteRoute removes a route but never the last one", () => {
    expect(deleteRoute("route_red")).toBe(true);
    expect(tour.value.routes).toHaveLength(1);
    expect(deleteRoute("route_green")).toBe(false);
    expect(tour.value.routes).toHaveLength(1);
  });

  it("reorderRoutes changes the printed section order", () => {
    expect(reorderRoutes(0, 1)).toBe(true);
    expect(tour.value.routes.map((r) => r.id)).toEqual([
      "route_red",
      "route_green",
    ]);
    expect(reorderRoutes(0, 5)).toBe(false);
  });
});

describe("setTourMeta", () => {
  it("patches the brochure header fields", () => {
    loadTour(twoRouteTour());
    setTourMeta({ title: "Loop Tour", tagline: "Two routes, one ticket" });
    expect(tour.value.title).toBe("Loop Tour");
    expect(tour.value.tagline).toBe("Two routes, one ticket");
    expect(tour.value.routes).toHaveLength(2);
  });

  it("clears a field when patched with undefined", () => {
    loadTour(twoRouteTour());
    setTourMeta({ subtitle: undefined });
    expect("subtitle" in tour.value).toBe(false);
  });

  it("accepts settings", () => {
    loadTour(twoRouteTour());
    setTourMeta({ settings: { pageSize: "a4" } });
    expect(tour.value.settings).toEqual({ pageSize: "a4" });
  });
});

describe("read-only mode (SPEC D2)", () => {
  beforeEach(() => {
    loadTour(twoRouteTour(), { readOnly: true });
  });

  it("blocks every mutating action", () => {
    const before = serializeTour(tour.value);
    expect(addStop({ lat: 1, lng: 2 })).toBeNull();
    expect(addRoute()).toBeNull();
    expect(moveStop("stop_skydeck", 1, 2)).toBe(false);
    expect(updateStop("stop_skydeck", { title: "x" })).toBe(false);
    expect(deleteStop("stop_skydeck")).toBe(false);
    expect(reorderStops(0, 1)).toBe(false);
    expect(moveStopToRoute("stop_skydeck", "route_red")).toBe(false);
    expect(updateRoute("route_red", { name: "x" })).toBe(false);
    expect(deleteRoute("route_red")).toBe(false);
    expect(reorderRoutes(0, 1)).toBe(false);
    expect(setTourMeta({ title: "x" })).toBe(false);
    expect(serializeTour(tour.value)).toBe(before);
  });

  it("never writes to localStorage", () => {
    startAutosave({ key: TEST_KEY, delay: 0 });
    addStop({ lat: 1, lng: 2 });
    expect(saveNow(TEST_KEY)).toBe(false);
    expect(localStorage.getItem(TEST_KEY)).toBeNull();
  });
});

describe("editCopy", () => {
  it("clones the viewed tour under a fresh id and unlocks editing", () => {
    const shared = twoRouteTour();
    loadTour(shared, { readOnly: true });
    const copy = editCopy({ titleSuffix: " (copy)" });

    expect(copy.id).not.toBe(shared.id);
    expect(tour.value.id).toBe(copy.id);
    expect(tour.value.title).toBe("Downtown Tour (copy)");
    expect(readOnly.value).toBe(false);
    expect(stopCount.value).toBe(5);

    // The copy is independent of the shared tour object.
    addStop({ lat: 1, lng: 2, title: "New" });
    expect(shared.routes[0].stops).toHaveLength(3);
    expect(tour.value.routes[0].stops).toHaveLength(4);
  });

  it("writes the copy to localStorage as the working tour", () => {
    loadTour(twoRouteTour(), { readOnly: true });
    const copy = editCopy();
    const stored = loadStoredTour();
    expect(stored?.ok && stored.tour.id).toBe(copy.id);
  });
});

describe("share length signals", () => {
  it("tracks the encoded length as the tour grows", () => {
    newTour({ title: "Tiny" });
    const small = shareEncodedLength.value;
    expect(shareUrlWarning.value).toBe("ok");
    loadTour(bigTour(20, 2));
    expect(shareEncodedLength.value).toBeGreaterThan(small);
  });

  it("flips to a warning past the 6k budget", () => {
    const wordy = bigTour(20, 2);
    wordy.routes[0].stops[0].description = Array.from(
      { length: 4000 },
      (_, i) => `w${i.toString(36)}`,
    ).join(" ");
    loadTour(wordy);
    expect(["warn", "too-long"]).toContain(shareUrlWarning.value);
  });
});

describe("localStorage autosave", () => {
  it("debounces writes and persists the latest tour", () => {
    vi.useFakeTimers();
    newTour({ title: "Autosaved" });
    startAutosave({ key: TEST_KEY, delay: 400 });

    addStop({ lat: 41.1, lng: -87.1, title: "One" });
    addStop({ lat: 41.2, lng: -87.2, title: "Two" });
    expect(localStorage.getItem(TEST_KEY)).toBeNull(); // still debounced

    vi.advanceTimersByTime(400);
    const stored = loadStoredTour(TEST_KEY);
    expect(stored?.ok).toBe(true);
    if (stored?.ok) {
      expect(stored.tour.title).toBe("Autosaved");
      expect(stored.tour.routes[0].stops.map((s) => s.title)).toEqual([
        "One",
        "Two",
      ]);
    }
  });

  it("stops writing after stopAutosave", () => {
    vi.useFakeTimers();
    newTour({ title: "Transient" });
    startAutosave({ key: TEST_KEY, delay: 400 });
    stopAutosave();
    localStorage.removeItem(TEST_KEY);
    addStop({ lat: 1, lng: 2 });
    vi.advanceTimersByTime(1000);
    expect(localStorage.getItem(TEST_KEY)).toBeNull();
  });

  it("saveNow writes synchronously", () => {
    newTour({ title: "Immediate" });
    expect(saveNow(TEST_KEY)).toBe(true);
    const stored = loadStoredTour(TEST_KEY);
    expect(stored?.ok && stored.tour.title).toBe("Immediate");
  });
});

describe("initStore load order", () => {
  it("restores the last tour from localStorage (reload case)", () => {
    const saved = twoRouteTour();
    saveTour(saved, TEST_KEY);
    resetStore();

    const result = initStore({ hash: "", key: TEST_KEY, autosave: false });
    expect(result.source).toBe("storage");
    expect(result.readOnly).toBe(false);
    expect(tour.value).toEqual(saved);
  });

  it("prefers a URL tour over localStorage", () => {
    saveTour(twoRouteTour(), TEST_KEY);
    const shared = bigTour(6, 1);
    const result = initStore({
      hash: buildHash(shared),
      key: TEST_KEY,
      autosave: false,
    });
    expect(result.source).toBe("url");
    expect(result.readOnly).toBe(true);
    expect(readOnly.value).toBe(true);
    expect(tour.value.id).toBe(shared.id);
  });

  it("opens an editable share link without the view flag", () => {
    const result = initStore({
      hash: `#t=${encodeTour(twoRouteTour())}`,
      key: TEST_KEY,
      autosave: false,
    });
    expect(result.source).toBe("url");
    expect(result.readOnly).toBe(false);
    expect(readOnly.value).toBe(false);
  });

  it("falls back to localStorage when the share payload is corrupt", () => {
    const saved = twoRouteTour();
    saveTour(saved, TEST_KEY);
    const result = initStore({
      hash: "#view&t=!!!garbage!!!",
      key: TEST_KEY,
      autosave: false,
    });
    expect(result.source).toBe("storage");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(tour.value.id).toBe(saved.id);
  });

  it("falls back to a blank tour when storage is empty and junk", () => {
    clearStoredTour(TEST_KEY);
    localStorage.setItem(TEST_KEY, "{not json");
    const result = initStore({ hash: "", key: TEST_KEY, autosave: false });
    expect(result.source).toBe("new");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(stopCount.value).toBe(0);
  });

  it("reads window.location.hash when no hash is supplied", () => {
    const shared = twoRouteTour();
    window.location.hash = buildHash(shared);
    const result = initStore({ key: TEST_KEY, autosave: false });
    expect(result.source).toBe("url");
    expect(tour.value.id).toBe(shared.id);
    window.location.hash = "";
  });

  it("a reload after edits restores those edits", () => {
    vi.useFakeTimers();
    initStore({ hash: "", key: TEST_KEY });
    setTourMeta({ title: "Work In Progress" });
    addStop({ lat: 41.5, lng: -87.5, title: "Saved stop" });
    vi.advanceTimersByTime(1000);
    const beforeReload = serializeTour(tour.value);

    resetStore(); // simulate a page reload
    const result = initStore({ hash: "", key: TEST_KEY, autosave: false });
    expect(result.source).toBe("storage");
    expect(serializeTour(tour.value)).toBe(beforeReload);
  });
});

describe("hash watcher", () => {
  afterEach(() => {
    stopHashWatcher();
    window.location.hash = "";
  });

  it("applyHash swaps the tour and honours the view flag", () => {
    newTour({ title: "Working" });
    const shared = twoRouteTour();
    const result = applyHash(buildHash(shared));
    expect(result?.ok).toBe(true);
    expect(tour.value.id).toBe(shared.id);
    expect(readOnly.value).toBe(true);
  });

  it("applyHash ignores a hash with no tour", () => {
    newTour({ title: "Working" });
    expect(applyHash("#view")).toBeNull();
    expect(tour.value.title).toBe("Working");
  });

  it("applyHash reports a corrupt payload without replacing the tour", () => {
    newTour({ title: "Working" });
    const result = applyHash("#view&t=!!garbage!!");
    expect(result?.ok).toBe(false);
    expect(tour.value.title).toBe("Working");
    expect(lastLoadNotice.value?.errors.length).toBeGreaterThan(0);
  });

  it("picks up a share link pasted into the address bar mid-session", () => {
    newTour({ title: "Working" });
    startHashWatcher();
    const shared = twoRouteTour();

    window.location.hash = buildHash(shared);
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(tour.value.id).toBe(shared.id);
    expect(readOnly.value).toBe(true);
    expect(stopCount.value).toBe(5);
  });

  it("stops listening after stopHashWatcher", () => {
    newTour({ title: "Working" });
    startHashWatcher();
    stopHashWatcher();
    window.location.hash = buildHash(twoRouteTour());
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(tour.value.title).toBe("Working");
  });
});

describe("store immutability", () => {
  it("publishes a new tour object on every mutation", () => {
    loadTour(twoRouteTour());
    const before = tour.value;
    addStop({ lat: 1, lng: 2, title: "New" });
    expect(tour.value).not.toBe(before);
    expect(before.routes[0].stops).toHaveLength(3);
  });

  it("does not alias the object handed to loadTour", () => {
    const source = twoRouteTour();
    loadTour(source);
    addStop({ lat: 1, lng: 2, title: "New" });
    expect(source.routes[0].stops).toHaveLength(3);
  });

  it("does not alias a stop created by addStop", () => {
    loadTour(twoRouteTour());
    const created = createStop({ lat: 1, lng: 2, title: "Mutable" });
    addStop(created);
    created.title = "Changed outside the store";
    expect(tour.value.routes[0].stops[3].title).toBe("Mutable");
  });
});
