/**
 * QA regression suite for the Choice-first UX epic (t_f3a98cf7), item 5:
 * the fallback path — the app must never end up empty or broken, whatever the
 * URL or the starter template throw at it.
 *
 * Load order under test (see `initStore`):
 *   `#t=` share link  >  curated starter template  >  blank.
 *
 * Originally written by QA task t_9f25df7e against the localStorage-era store.
 * Re-based onto the single-store model (ADR 0002, PR #3): `persistence.ts` is
 * gone and no code path reads or writes localStorage, so the three
 * storage-shaped cases — junk in storage, the QA-BUG-4 "non-tour blob in
 * storage beats the starter" pin and its `it.fails` canary — describe a layer
 * that no longer exists and are dropped rather than rewritten. The guard that
 * replaces them is the last test here: a stale key from an older build is
 * ignored outright. (CI also fails the build on `localStorage` in src/.)
 *
 * The URL-shaped cases are the ones that still matter and are kept verbatim:
 * - a corrupt share link falls back to the curated starter rather than a blank
 *   or broken app, and the decode error is still reported on the InitResult.
 *   NOTE: as of this run the editor does NOT surface that error to the user
 *   (QA-BUG-2, filed from task t_9f25df7e) — the error reaching InitResult is
 *   what a future fix will hang the notice on, so it is asserted here.
 * - a broken starter template still leaves an editable blank tour.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { starterTour } from "../data/starterTour";
import { totalStops } from "./schema";
import {
  deleteStop,
  initStore,
  reorderStops,
  resetStore,
  stopHashWatcher,
  stopUrlSync,
  tour,
  updateStop,
} from "./store";

const CORRUPT_HASH = "#t=NOT-A-REAL-PAYLOAD-%%%";

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

afterEach(() => {
  stopUrlSync();
  stopHashWatcher();
  localStorage.clear();
  resetStore();
});

function boot(options: { hash?: string } = {}) {
  return initStore({
    hash: options.hash ?? "",
    urlSync: false,
    watchHash: false,
    fallback: starterTour,
  });
}

describe("fallback path: the app is never empty (epic item 5)", () => {
  it("falls back to the curated starter when there is no URL state", () => {
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

  it("still leaves an editable tour when the starter template itself is broken", () => {
    const result = initStore({
      hash: "",
      urlSync: false,
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

  it("ignores a stale localStorage key left by an older build (ADR 0002)", () => {
    // The pre-PR#3 autosave key. A returning visitor who still has it must get
    // the curated starter, not a resurrected empty tour (the blank-map bug).
    localStorage.setItem(
      "tour-brochure-builder:tour",
      JSON.stringify({ version: 2, id: "t", title: "Stale", routes: [] }),
    );
    const result = boot();
    expect(result.source).toBe("starter");
    expect(tour.value.title).toBe("Chicago Downtown Walking Tour");
    expect(totalStops(tour.value)).toBe(6);
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
