/**
 * QA regression suite for the Choice-first UX epic (t_f3a98cf7), item 5:
 * the fallback path — the app must never end up empty or broken, whatever the
 * URL, localStorage or the starter template throw at it.
 *
 * Load order under test (see `initStore`):
 *   `#t=` share link  >  localStorage  >  curated starter template  >  blank.
 *
 * These tests pin the *observed* behaviour so a regression is loud:
 * - a corrupt share link falls back to the curated starter rather than a blank
 *   or broken app, and the decode error is still reported on the InitResult.
 *   NOTE: as of this run the editor does NOT surface that error to the user
 *   (QA-BUG-2, filed from task t_9f25df7e) — the error reaching InitResult is
 *   what a future fix will hang the notice on, so it is asserted here.
 * - unreadable localStorage falls back the same way.
 * - a broken starter template still leaves an editable blank tour.
 *
 * Added by QA task t_9f25df7e.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { starterTour } from "../data/starterTour";
import { clearStoredTour, STORAGE_KEY } from "./persistence";
import { totalStops } from "./schema";
import {
  deleteStop,
  initStore,
  reorderStops,
  resetStore,
  stopAutosave,
  tour,
  updateStop,
} from "./store";

const KEY = "tour-brochure-builder:qa-fallback";
const CORRUPT_HASH = "#t=NOT-A-REAL-PAYLOAD-%%%";

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

afterEach(() => {
  stopAutosave();
  clearStoredTour(KEY);
  clearStoredTour(STORAGE_KEY);
  localStorage.clear();
  resetStore();
});

function boot(options: { hash?: string } = {}) {
  return initStore({
    hash: options.hash ?? "",
    key: KEY,
    autosave: false,
    watchHash: false,
    fallback: starterTour,
  });
}

describe("fallback path: the app is never empty (epic item 5)", () => {
  it("falls back to the curated starter when there is no URL and no storage", () => {
    const result = boot();
    expect(result.source).toBe("starter");
    expect(totalStops(tour.value)).toBe(6);
  });

  it("falls back to the curated starter when the share link is corrupt", () => {
    const result = boot({ hash: CORRUPT_HASH });

    // Never blank, never broken.
    expect(result.source).toBe("starter");
    expect(totalStops(tour.value)).toBe(6);
    expect(tour.value.title).toBe("Chicago Downtown Walking Tour");

    // The failure is still reported, so the UI can show a non-blocking notice.
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(" ")).toMatch(/corrupt|truncated|Empty/i);
  });

  it("falls back to the curated starter when localStorage holds junk", () => {
    localStorage.setItem(KEY, "{not json at all");
    const result = boot();
    expect(result.source).toBe("starter");
    expect(totalStops(tour.value)).toBe(6);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  /**
   * QA-BUG-4 (task t_9f25df7e): `parseTour` repairs *any* object into a valid
   * empty tour, so a non-tour blob at the storage key beats the curated
   * starter and the user lands on a blank app. Pinned as observed behaviour;
   * the `it.fails` below is the canary that flips green→red when it is fixed.
   */
  it("today: a non-tour object in storage is repaired into an EMPTY tour (QA-BUG-4)", () => {
    localStorage.setItem(KEY, JSON.stringify({ hello: "world" }));
    const result = boot();
    expect(result.source).toBe("storage");
    expect(totalStops(tour.value)).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(tour.value.routes.length).toBeGreaterThan(0); // still editable
  });

  it.fails("wanted: a storage blob that repairs to zero stops should yield the curated starter (QA-BUG-4)", () => {
    localStorage.setItem(KEY, JSON.stringify({ hello: "world" }));
    const result = boot();
    expect(result.source).toBe("starter");
    expect(totalStops(tour.value)).toBe(6);
  });

  it("still leaves an editable tour when the starter template itself is broken", () => {
    const result = initStore({
      hash: "",
      key: KEY,
      autosave: false,
      watchHash: false,
      fallback: () => ({ not: "a tour" }),
    });

    // Same leniency as above: the junk fallback is repaired rather than
    // rejected, so the source is reported as "starter" even though it seeded
    // nothing. What matters for the user is the last two assertions: the app
    // is editable, not broken.
    expect(result.source).toBe("starter");
    expect(tour.value.routes.length).toBeGreaterThan(0); // somewhere to add a stop
    expect(totalStops(tour.value)).toBe(0);
  });

  it("a corrupt link does not poison the next load", () => {
    boot({ hash: CORRUPT_HASH });
    resetStore();
    const second = boot();
    expect(second.source).toBe("starter");
    expect(second.errors).toEqual([]);
  });
});

describe("stops seeded by the fallback behave like any other stop (epic item 2)", () => {
  it("edits, reorders and deletes identically — no seeded/locked flag", () => {
    boot({ hash: CORRUPT_HASH });
    const route = tour.value.routes[0];
    const [first, second] = route.stops;

    // No marker distinguishes a seeded stop from a user-added one.
    for (const stop of route.stops) {
      expect(stop).not.toHaveProperty("seeded");
      expect(stop).not.toHaveProperty("locked");
      expect(stop).not.toHaveProperty("source");
    }

    expect(updateStop(first.id, { title: "Renamed" })).toBe(true);
    expect(tour.value.routes[0].stops[0].title).toBe("Renamed");

    expect(reorderStops(0, 1, route.id)).toBe(true);
    expect(tour.value.routes[0].stops[0].id).toBe(second.id);

    expect(deleteStop(first.id)).toBe(true);
    expect(totalStops(tour.value)).toBe(5);
  });
});
