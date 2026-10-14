import { describe, expect, it } from "vitest";
import { CACHE_STORAGE_PREFIX, cacheKey, createRoutingCache } from "./cache";
import { memoryStorage } from "./testDoubles";
import type { LatLng } from "./types";

const COORDS: LatLng[] = [
  [41.8781, -87.6298],
  [41.8919, -87.6051],
];

describe("cacheKey", () => {
  it("includes the profile", () => {
    expect(cacheKey(COORDS, "foot")).not.toBe(cacheKey(COORDS, "driving"));
  });

  it("rounds stops to ~1m, so sub-metre jitter still hits", () => {
    const jittered: LatLng[] = [
      [41.87810001, -87.62980004],
      [41.8919, -87.6051],
    ];
    expect(cacheKey(jittered, "foot")).toBe(cacheKey(COORDS, "foot"));
  });

  it("changes when a stop really moves", () => {
    const moved: LatLng[] = [[41.879, -87.6298], COORDS[1]];
    expect(cacheKey(moved, "foot")).not.toBe(cacheKey(COORDS, "foot"));
  });

  it("is order-sensitive — reordering stops is a different route", () => {
    expect(cacheKey([COORDS[1], COORDS[0]], "foot")).not.toBe(
      cacheKey(COORDS, "foot"),
    );
  });

  it("covers via points, because they are routing waypoints too (ADR 0001)", () => {
    const withVia: LatLng[] = [COORDS[0], [41.885, -87.617], COORDS[1]];
    expect(cacheKey(withVia, "foot")).not.toBe(cacheKey(COORDS, "foot"));
  });

  it("holds no route name, color or stop copy, so those edits never refetch", () => {
    // The key is derived from waypoints + profile only; this is the whole
    // reason renaming a route does not invalidate its geometry.
    expect(cacheKey(COORDS, "foot")).toBe(
      "foot|41.8781,-87.6298;41.8919,-87.6051",
    );
  });
});

describe("createRoutingCache", () => {
  it("serves from memory", () => {
    const cache = createRoutingCache({ storage: null });
    expect(cache.get("k")).toBeUndefined();
    cache.set("k", COORDS);
    expect(cache.get("k")).toEqual(COORDS);
    expect(cache.has("k")).toBe(true);
    expect(cache.size).toBe(1);
  });

  it("ignores an empty geometry", () => {
    const cache = createRoutingCache({ storage: null });
    cache.set("k", []);
    expect(cache.size).toBe(0);
  });

  it("mirrors to storage and rehydrates a fresh instance", () => {
    const storage = memoryStorage();
    createRoutingCache({ storage }).set("k", COORDS);

    expect(storage.map.has(`${CACHE_STORAGE_PREFIX}k`)).toBe(true);
    const reloaded = createRoutingCache({ storage });
    expect(reloaded.get("k")).toEqual(COORDS);
    // Promoted into the memory tier on the way through.
    expect(reloaded.size).toBe(1);
  });

  it("treats a corrupt mirror entry as a miss", () => {
    const storage = memoryStorage();
    storage.map.set(`${CACHE_STORAGE_PREFIX}k`, "{not json");
    storage.map.set(`${CACHE_STORAGE_PREFIX}j`, '[["a","b"]]');
    const cache = createRoutingCache({ storage });
    expect(cache.get("k")).toBeUndefined();
    expect(cache.get("j")).toBeUndefined();
  });

  it("survives a storage that refuses writes", () => {
    const cache = createRoutingCache({
      storage: memoryStorage({ failOnSet: true }),
    });
    expect(() => cache.set("k", COORDS)).not.toThrow();
    expect(cache.get("k")).toEqual(COORDS);
  });

  it("evicts the mirror oldest-first to stay inside its budget", () => {
    const storage = memoryStorage();
    // Each entry costs key + JSON + prefix; 120 chars fits two, not three.
    const cache = createRoutingCache({ storage, maxStorageChars: 120 });

    cache.set("one", COORDS);
    cache.set("two", COORDS);
    const afterTwo = storage.map.size;
    cache.set("three", COORDS);

    expect(cache.storedChars).toBeLessThanOrEqual(120);
    expect(afterTwo).toBeGreaterThan(0);
    // "one" is gone from the mirror; "three" is there.
    expect(storage.map.has(`${CACHE_STORAGE_PREFIX}one`)).toBe(false);
    expect(storage.map.has(`${CACHE_STORAGE_PREFIX}three`)).toBe(true);
    // The memory tier is untouched by mirror eviction.
    expect(cache.get("one")).toEqual(COORDS);
  });

  it("carries the mirror budget across a reload", () => {
    const storage = memoryStorage();
    createRoutingCache({ storage, maxStorageChars: 120 }).set("one", COORDS);

    const reloaded = createRoutingCache({ storage, maxStorageChars: 120 });
    expect(reloaded.storedChars).toBeGreaterThan(0);
    reloaded.set("two", COORDS);
    reloaded.set("three", COORDS);
    expect(reloaded.storedChars).toBeLessThanOrEqual(120);
  });

  it("skips the mirror for a single route bigger than the whole budget", () => {
    const storage = memoryStorage();
    const cache = createRoutingCache({ storage, maxStorageChars: 10 });
    cache.set("k", COORDS);
    expect(storage.map.has(`${CACHE_STORAGE_PREFIX}k`)).toBe(false);
    expect(cache.get("k")).toEqual(COORDS); // memory tier still serves it
  });

  it("evicts the least recently used entry past the cap", () => {
    const cache = createRoutingCache({ storage: null, maxEntries: 2 });
    cache.set("a", COORDS);
    cache.set("b", COORDS);
    cache.get("a"); // 'a' is now the most recent
    cache.set("c", COORDS);

    expect(cache.size).toBe(2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toEqual(COORDS);
    expect(cache.get("c")).toEqual(COORDS);
  });

  it("deletes and clears", () => {
    const storage = memoryStorage();
    const cache = createRoutingCache({ storage });
    cache.set("a", COORDS);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    expect(storage.map.has(`${CACHE_STORAGE_PREFIX}a`)).toBe(false);
    expect(cache.storedChars).toBe(0);

    cache.set("b", COORDS);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(storage.map.has(`${CACHE_STORAGE_PREFIX}b`)).toBe(false);
    expect(cache.storedChars).toBe(0);
  });
});
