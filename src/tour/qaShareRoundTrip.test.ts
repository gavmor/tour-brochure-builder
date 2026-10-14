/**
 * QA regression suite for the Choice-first UX epic (t_f3a98cf7), item 7:
 * URL round-trip of a *seeded-then-edited* tour.
 *
 * The existing suites cover the pieces (presets.test.ts: field-level
 * (de)serialization; starterTour.test.ts: hydration; urlShare.test.ts: the
 * codec). This one covers the user-visible journey end to end:
 *
 *   first load with no URL state -> curated starter hydrates
 *   -> the user edits it (rename, recategorize, reorder, recolor, reprofile,
 *      add a map-click stop, retitle the tour)
 *   -> "Copy share link" produces a URL
 *   -> a *fresh* browser load of that URL reproduces the tour exactly.
 *
 * Plus the back-compat direction: share URLs minted before the preset work
 * (no `profile`, no `category`) and the legacy `version: 1` payload must keep
 * decoding, resolving to the documented defaults.
 *
 * Added by QA task t_9f25df7e.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { starterTour } from "../data/starterTour";
import { v1Tour } from "./fixtures";
import {
  cloneTour,
  DEFAULT_ROUTE_PROFILE,
  DEFAULT_STOP_CATEGORY,
  ROUTE_COLORS,
  routeProfile,
  stopCategory,
  type Tour,
  totalStops,
} from "./schema";
import {
  addStop,
  initStore,
  readOnly,
  reorderStops,
  resetStore,
  setTourMeta,
  shareLink,
  stopHashWatcher,
  stopUrlSync,
  tour,
  updateRoute,
  updateStop,
} from "./store";
import { buildHash, decodeTour, encodeTour, parseHash } from "./urlShare";

/** Boot the app the way `main.tsx` does, with nothing in the URL. */
function firstLoad() {
  return initStore({
    hash: "",
    urlSync: false,
    watchHash: false,
    fallback: starterTour,
  });
}

/** Everything a user can change through the choice-first controls. */
function editTheSeededTour(): Tour {
  const route = tour.value.routes[0];
  const [first, second] = route.stops;

  updateStop(first.id, {
    title: "Cloud Gate (renamed)",
    category: "attraction",
  });
  updateStop(second.id, { category: "museum", blurb: "Edited blurb" });
  reorderStops(1, 0, route.id); // drag the museum to the top
  updateRoute(route.id, { color: ROUTE_COLORS[6], profile: "cycling" });
  addStop({ lat: 41.8705, lng: -87.6505, title: "Stop 7" }, route.id); // map click
  setTourMeta({ title: "QA edited tour", tagline: "Edited tagline" });

  return cloneTour(tour.value);
}

beforeEach(() => {
  window.location.hash = "";
  resetStore();
});

afterEach(() => {
  stopUrlSync();
  stopHashWatcher();
  window.location.hash = "";
  resetStore();
});

describe("seeded -> edited -> share URL -> fresh load (epic item 7)", () => {
  it("hydrates the curated starter when there is no URL state", () => {
    const boot = firstLoad();
    expect(boot.source).toBe("starter");
    expect(boot.errors).toEqual([]);
    expect(totalStops(tour.value)).toBe(6);
    expect(tour.value.title).toBe("Chicago Downtown Walking Tour");
  });

  it("round-trips an edited seeded tour through the share URL byte for byte", () => {
    firstLoad();
    const edited = editTheSeededTour();

    // What "Copy share link" puts on the clipboard.
    const { url } = shareLink.value;
    const hash = url.slice(url.indexOf("#"));
    const parsed = parseHash(hash);
    expect(parsed.view).toBe(true);
    expect(parsed.encoded).toBeTruthy();

    const decoded = decodeTour(parsed.encoded as string);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.tour).toEqual(edited);
  });

  it("a fresh load of that URL reproduces the tour exactly", () => {
    firstLoad();
    const edited = editTheSeededTour();
    const hash = buildHash(edited, { view: true });

    // A different browser: nothing but the pasted URL.
    resetStore();
    const boot = initStore({
      hash,
      urlSync: false,
      watchHash: false,
      fallback: starterTour,
    });

    expect(boot.source).toBe("url");
    expect(boot.errors).toEqual([]);
    expect(readOnly.value).toBe(true); // shared links open read-only
    expect(tour.value).toEqual(edited);

    // The edits, not the template.
    expect(tour.value.title).toBe("QA edited tour");
    expect(totalStops(tour.value)).toBe(7);
    expect(routeProfile(tour.value.routes[0])).toBe("cycling");
    expect(tour.value.routes[0].color).toBe(ROUTE_COLORS[6]);
    expect(stopCategory(tour.value.routes[0].stops[0])).toBe("museum");
  });

  it("keeps the edited share URL inside the length budget", () => {
    firstLoad();
    editTheSeededTour();
    expect(shareLink.value.tooLong).toBe(false);
    expect(shareLink.value.warn).toBe(false);
  });
});

describe("pre-existing share URLs still decode (epic item 7)", () => {
  it("decodes a v2 link minted before the preset fields existed", () => {
    const legacy = {
      version: 2,
      id: "tour_legacy_v2",
      title: "Legacy v2 share",
      subtitle: "Chicago",
      routes: [
        {
          id: "route_legacy",
          name: "Old Route",
          color: "#1E8449",
          stops: [
            { id: "s1", lat: 41.8827, lng: -87.6233, title: "Cloud Gate" },
            { id: "s2", lat: 41.8796, lng: -87.6237, title: "Art Institute" },
          ],
        },
      ],
    };

    const decoded = decodeTour(
      encodeTour(legacy as unknown as Parameters<typeof encodeTour>[0]),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const route = decoded.tour.routes[0];
    expect(route.profile).toBeUndefined();
    expect(routeProfile(route)).toBe(DEFAULT_ROUTE_PROFILE);
    for (const stop of route.stops) {
      expect(stop.category).toBeUndefined();
      expect(stopCategory(stop)).toBe(DEFAULT_STOP_CATEGORY);
    }
  });

  it("decodes a legacy version:1 payload through the migration", () => {
    const decoded = decodeTour(
      encodeTour(v1Tour() as unknown as Parameters<typeof encodeTour>[0]),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.tour.version).toBe(2);
    expect(totalStops(decoded.tour)).toBe(2);
  });

  it("preserves an off-palette custom color instead of snapping it", () => {
    const custom = {
      version: 2,
      id: "tour_offpalette",
      title: "Off-palette",
      routes: [
        {
          id: "r1",
          name: "Pink route",
          color: "#FF00AA",
          stops: [{ id: "s1", lat: 41.88, lng: -87.62, title: "Somewhere" }],
        },
      ],
    };

    const decoded = decodeTour(
      encodeTour(custom as unknown as Parameters<typeof encodeTour>[0]),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.tour.routes[0].color).toBe("#FF00AA");
  });
});
