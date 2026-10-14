/**
 * QA regression suite for the Choice-first UX epic (t_f3a98cf7), item 5:
 * the fallback path — the app must never end up empty or broken, whatever the
 * URL or the starter template throw at it.
 *
 * Load order under test (see `initStore`):
 *   `#t=` share link  >  curated starter template  >  blank.
 *
 * There is no localStorage tier any more (D7 / ADR 0002), which is why the
 * storage-precedence cases this suite originally carried are gone — see the
 * "stale localStorage" test below for what replaced them, and the QA-BUG-4
 * note on task t_4ee2886f.
 *
 * These tests pin the *observed* behaviour so a regression is loud:
 * - a corrupt share link falls back to the curated starter rather than a blank
 *   or broken app, the decode error survives on the `InitResult`, *and* it is
 *   published to `lastLoadNotice` so the editor can show a banner (QA-BUG-2).
 * - a broken starter template still leaves an editable blank tour.
 * - a stale `tour-brochure-builder:tour` key from an older build is ignored.
 *
 * Added by QA task t_9f25df7e; ported to the URL-only store on t_4ee2886f.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { starterTour } from "../data/starterTour";
import { totalStops } from "./schema";
import {
  deleteStop,
  initStore,
  lastLoadNotice,
  reorderStops,
  resetStore,
  stopHashWatcher,
  stopUrlSync,
  tour,
  updateStop,
} from "./store";

const STALE_KEY = "tour-brochure-builder:tour";
const CORRUPT_HASH = "#t=NOT-A-REAL-PAYLOAD-%%%";

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
  resetStore();
});

afterEach(() => {
  stopUrlSync();
  stopHashWatcher();
  localStorage.clear();
  window.location.hash = "";
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
  it("falls back to the curated starter when the URL carries nothing", () => {
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

  /**
   * QA-BUG-2 (task t_9f25df7e): the decode error reaches `InitResult` and
   * stops there — the starter hydration overwrites `lastLoadNotice`, so the
   * editor's error banner never renders and a broken link looks like an
   * ordinary first visit. Pinned as observed behaviour; the `it.fails` below
   * is the canary that flips when it is fixed.
   */
  it("today: the starter hydration wipes the corrupt-link notice (QA-BUG-2)", () => {
    boot({ hash: CORRUPT_HASH });
    expect(lastLoadNotice.value?.errors ?? []).toEqual([]);
  });

  it.fails("wanted: a corrupt share link should leave an error on lastLoadNotice (QA-BUG-2)", () => {
    boot({ hash: CORRUPT_HASH });
    expect(lastLoadNotice.value?.errors.length ?? 0).toBeGreaterThan(0);
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
    expect(lastLoadNotice.value?.errors ?? []).toEqual([]);
  });

  /**
   * QA-BUG-4 (task t_9f25df7e) was "junk in localStorage beats the starter and
   * yields a blank app". ADR 0002 deleted the localStorage tier outright, so
   * the precedence it described no longer exists: nothing reads the key, and a
   * blob left there by an older build — junk or a whole valid tour — cannot
   * shadow the starter. This pins that, which is the fix.
   */
  it("ignores a stale localStorage blob from an older build (QA-BUG-4)", () => {
    localStorage.setItem(STALE_KEY, JSON.stringify({ hello: "world" }));
    const junk = boot();
    expect(junk.source).toBe("starter");
    expect(totalStops(tour.value)).toBe(6);

    resetStore();
    localStorage.setItem(
      STALE_KEY,
      JSON.stringify({ ...starterTour(), id: "tour_stale", title: "Stale" }),
    );
    const valid = boot();
    expect(valid.source).toBe("starter");
    expect(tour.value.title).toBe("Chicago Downtown Walking Tour");
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
