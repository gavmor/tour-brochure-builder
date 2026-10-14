/**
 * Route geometry cache (ADR 0001 — "Caching").
 *
 * Two tiers, both optional at construction:
 *  - **Tier 1, in-memory `Map`** with LRU eviction: survives re-render, panel
 *    switches and the editor ⇄ brochure transition. This is what makes editing
 *    feel instant.
 *  - **Tier 2, `sessionStorage` mirror**: survives reload and print-preview
 *    navigation within the tab. Session-scoped on purpose — geometry is derived
 *    data with an upstream that can change, and `localStorage` is already the
 *    tour's own autosave slot.
 *
 * Keys are `profile|lat,lng;lat,lng;…` over the ordered waypoints (stops plus
 * any `via` points) at {@link COORD_PRECISION}. Renaming or recoloring a route,
 * or editing stop copy, does not invalidate it; moving a stop does.
 *
 * Geometry never travels back into the `Tour` object — the cache is keyed *off*
 * tour data and lives beside it. If geometry reached `serializeTour` the share
 * URL would go to 143 % of its ceiling (ADR 0001's measurements).
 *
 * The mirror is budgeted: oldest-first eviction past {@link DEFAULT_MAX_STORAGE_CHARS},
 * and a thrown quota exception must never break a render.
 */

import { roundCoord } from "./geometry";
import type { LatLng, RouteProfile } from "./types";

export const CACHE_STORAGE_PREFIX = "tbb.route.v1.";
/** Where the mirror's insertion order and size bookkeeping lives. */
export const CACHE_INDEX_KEY = `${CACHE_STORAGE_PREFIX}__index`;
export const DEFAULT_CACHE_MAX_ENTRIES = 200;
/** ~1 MB, counted in UTF-16 characters, which is how browsers bill storage. */
export const DEFAULT_MAX_STORAGE_CHARS = 1_000_000;

export function cacheKey(waypoints: LatLng[], profile: RouteProfile): string {
  const points = waypoints
    .map(([lat, lng]) => `${roundCoord(lat)},${roundCoord(lng)}`)
    .join(";");
  return `${profile}|${points}`;
}

/** Minimal `Storage` surface, so tests can pass a stub. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RoutingCache {
  get(key: string): LatLng[] | undefined;
  set(key: string, coords: LatLng[]): void;
  has(key: string): boolean;
  delete(key: string): void;
  /** Drops both tiers, including the mirror entries this cache knows about. */
  clear(): void;
  readonly size: number;
  /** Characters currently held in the mirror — diagnostics and tests. */
  readonly storedChars: number;
}

export interface RoutingCacheOptions {
  /** `null` disables the mirror. Defaults to `sessionStorage` when available. */
  storage?: StorageLike | null;
  maxEntries?: number;
  maxStorageChars?: number;
}

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    // Safari private mode / blocked third-party storage throws on access.
    return null;
  }
}

function parseCoords(raw: string | null): LatLng[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const coords: LatLng[] = [];
    for (const pair of parsed) {
      if (
        !Array.isArray(pair) ||
        typeof pair[0] !== "number" ||
        typeof pair[1] !== "number"
      ) {
        return undefined;
      }
      coords.push([pair[0], pair[1]]);
    }
    return coords.length > 0 ? coords : undefined;
  } catch {
    // A corrupt mirror entry is a cache miss, never an app-level error.
    return undefined;
  }
}

/** `[key, chars]` pairs, oldest first. */
type MirrorIndex = [string, number][];

function parseIndex(raw: string | null): MirrorIndex {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is [string, number] =>
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "number",
    );
  } catch {
    return [];
  }
}

export function createRoutingCache(
  options: RoutingCacheOptions = {},
): RoutingCache {
  const maxEntries = options.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
  const maxStorageChars = options.maxStorageChars ?? DEFAULT_MAX_STORAGE_CHARS;
  const storage =
    options.storage === undefined ? defaultStorage() : options.storage;
  const memory = new Map<string, LatLng[]>();

  /** Mirror bookkeeping, rehydrated so a reload keeps the budget accurate. */
  let index: MirrorIndex = [];
  let storedChars = 0;
  /** Flipped off only after a quota error survived an eviction retry. */
  let mirrorWrites = storage !== null;

  if (storage) {
    try {
      index = parseIndex(storage.getItem(CACHE_INDEX_KEY));
      storedChars = index.reduce((sum, [, chars]) => sum + chars, 0);
    } catch {
      index = [];
    }
  }

  function readStorage(key: string): string | null {
    if (!storage) return null;
    try {
      return storage.getItem(CACHE_STORAGE_PREFIX + key);
    } catch {
      return null;
    }
  }

  function removeFromStorage(key: string) {
    if (!storage) return;
    try {
      storage.removeItem(CACHE_STORAGE_PREFIX + key);
    } catch {
      // Nothing to do — the memory tier is already consistent.
    }
    const at = index.findIndex(([indexed]) => indexed === key);
    if (at >= 0) {
      storedChars -= index[at][1];
      index.splice(at, 1);
    }
  }

  function writeIndex() {
    if (!storage) return;
    try {
      storage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
    } catch {
      // The index is an optimisation; losing it only costs budget accuracy.
    }
  }

  /** Drop oldest entries until `needed` characters fit under the cap. */
  function evictStorage(needed: number) {
    while (index.length > 0 && storedChars + needed > maxStorageChars) {
      removeFromStorage(index[0][0]);
    }
  }

  function mirror(key: string, value: string) {
    if (!storage || !mirrorWrites) return;
    const chars = key.length + value.length + CACHE_STORAGE_PREFIX.length;
    if (chars > maxStorageChars) return; // a single route bigger than the budget
    removeFromStorage(key);
    evictStorage(chars);
    try {
      storage.setItem(CACHE_STORAGE_PREFIX + key, value);
    } catch {
      // Quota: make room by halving the mirror, then try once more.
      const half = Math.ceil(index.length / 2);
      for (let i = 0; i < half; i++) removeFromStorage(index[0][0]);
      try {
        storage.setItem(CACHE_STORAGE_PREFIX + key, value);
      } catch {
        // Storage is unusable (disabled, or full of someone else's data).
        // The memory tier still serves this session.
        mirrorWrites = false;
        writeIndex();
        return;
      }
    }
    index.push([key, chars]);
    storedChars += chars;
    writeIndex();
  }

  function touch(key: string, coords: LatLng[]) {
    memory.delete(key);
    memory.set(key, coords);
    while (memory.size > maxEntries) {
      const oldest = memory.keys().next().value;
      if (oldest === undefined) break;
      memory.delete(oldest);
    }
  }

  return {
    get(key) {
      const hit = memory.get(key);
      if (hit) {
        touch(key, hit);
        return hit;
      }
      const restored = parseCoords(readStorage(key));
      if (restored) touch(key, restored);
      return restored;
    },
    set(key, coords) {
      if (coords.length === 0) return;
      touch(key, coords);
      mirror(key, JSON.stringify(coords));
    },
    has(key) {
      return this.get(key) !== undefined;
    },
    delete(key) {
      memory.delete(key);
      removeFromStorage(key);
      writeIndex();
    },
    clear() {
      memory.clear();
      for (const [key] of [...index]) removeFromStorage(key);
      writeIndex();
    },
    get size() {
      return memory.size;
    },
    get storedChars() {
      return storedChars;
    },
  };
}
