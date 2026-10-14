/**
 * localStorage persistence: debounced autosave of the working tour, plus
 * restore on load. Everything degrades to a no-op when storage is missing or
 * blocked (Safari private mode, embedded webviews, quota exceeded).
 */

import type { Tour } from "./schema";
import { type ParseResult, parseTourJson, serializeTour } from "./validate";

export const STORAGE_KEY = "tour-brochure-builder:tour";
export const AUTOSAVE_DELAY_MS = 400;

function storage(): Storage | null {
  try {
    const store = globalThis.localStorage;
    if (!store) return null;
    // Touch it: some environments expose the object but throw on access.
    const probe = "__tbb_probe__";
    store.setItem(probe, "1");
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

export function isStorageAvailable(): boolean {
  return storage() !== null;
}

/** Write immediately. Returns false when storage is unavailable or full. */
export function saveTour(tour: Tour, key = STORAGE_KEY): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(key, serializeTour(tour));
    return true;
  } catch {
    return false;
  }
}

/** Read and validate the stored tour. `null` when nothing is stored. */
export function loadStoredTour(key = STORAGE_KEY): ParseResult | null {
  const store = storage();
  if (!store) return null;
  let text: string | null = null;
  try {
    text = store.getItem(key);
  } catch {
    return null;
  }
  if (!text) return null;
  return parseTourJson(text);
}

export function clearStoredTour(key = STORAGE_KEY): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}

export interface Debounced<T extends unknown[]> {
  (...args: T): void;
  /** Run a pending call right now. */
  flush(): void;
  /** Drop a pending call. */
  cancel(): void;
  /** True while a call is scheduled. */
  readonly pending: boolean;
}

export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  delay = AUTOSAVE_DELAY_MS,
): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: T | null = null;

  const run = () => {
    timer = null;
    const args = lastArgs;
    lastArgs = null;
    if (args) fn(...args);
  };

  const debounced = ((...args: T) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delay);
  }) as Debounced<T> & { pending: boolean };

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      run();
    }
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  Object.defineProperty(debounced, "pending", { get: () => timer !== null });
  return debounced;
}

/** Debounced autosave. Call `.flush()` on unload, `.cancel()` on teardown. */
export function createAutosaver(key = STORAGE_KEY, delay = AUTOSAVE_DELAY_MS) {
  return debounce<[Tour]>((tour) => {
    saveTour(tour, key);
  }, delay);
}
