/**
 * The "Add sites near a location" dialog (epic t_f3a98cf7, part 1).
 *
 * Driven against a stub `PoiService`, so these exercise the real component
 * with no network: the proposal list arrives pre-selected, unchecking is how
 * you back out, accepting goes through the ordinary store path, and every
 * failure mode lands on the curated fallback instead of an empty dialog.
 */

import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BBox, GeocodeResult, PoiResult, PoiService } from "../poi";
import {
  clearPoiCache,
  curatedFor,
  forgetOutage,
  PoiNetworkError,
} from "../poi";
import { addStop, resetStore, tour } from "../tour";
import { totalStops } from "../tour/schema";
import { NearbyPanel } from "./NearbyPanel";
import { closeNearby, nearbyCenter, nearbyOpen } from "./uiState";

const CHICAGO: GeocodeResult = {
  lat: 41.88,
  lng: -87.63,
  bbox: { south: 41.8, west: -87.7, north: 41.9, east: -87.6 },
  displayName: "Chicago, Illinois",
};

const TWO_SITES: PoiResult = {
  cached: false,
  hidden: 0,
  candidates: [
    {
      osmId: "node/1",
      title: "Museum X",
      lat: 41.881,
      lng: -87.621,
      category: "museum",
      blurb: "Museum",
      hasWiki: true,
    },
    {
      osmId: "way/2",
      title: "Viewpoint Y",
      lat: 41.882,
      lng: -87.622,
      category: "viewpoint",
      blurb: "Viewpoint",
      hasWiki: false,
    },
  ],
};

function stubService(overrides: Partial<PoiService> = {}): PoiService {
  return {
    geocode: async () => CHICAGO,
    findPois: async () => TWO_SITES,
    ...overrides,
  };
}

let host: HTMLDivElement;

beforeEach(() => {
  resetStore();
  clearPoiCache();
  forgetOutage();
  nearbyOpen.value = true;
  nearbyCenter.value = null;
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  closeNearby();
  resetStore();
});

/** Let the component's promises and the next render settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Wait long enough for Preact's deferred effects to run. Preact schedules
 * `useEffect` on `requestAnimationFrame` with a ~100 ms timeout fallback, and
 * jsdom has no frames — so anything driven by an effect needs a real wait, not
 * a microtask flush.
 */
function settleEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

function mount(service: PoiService) {
  render(<NearbyPanel service={service} />, host);
}

function byText(selector: string, text: string): HTMLElement | undefined {
  return Array.from(host.querySelectorAll<HTMLElement>(selector)).find((el) =>
    (el.textContent ?? "").includes(text),
  );
}

async function searchFor(place: string): Promise<void> {
  const input = host.querySelector<HTMLInputElement>(".nearby__input");
  if (!input) throw new Error("no place input");
  input.value = place;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  // Let the controlled input's re-render land, so the Search button's handler
  // closes over the typed value rather than the empty one.
  await flush();
  byText("button", "Search")?.click();
  await flush();
  await flush();
}

function rows(): HTMLInputElement[] {
  return Array.from(
    host.querySelectorAll<HTMLInputElement>(
      '.nearby__row input[type="checkbox"]',
    ),
  );
}

describe("the proposal list", () => {
  it("is closed until the user asks for it", () => {
    nearbyOpen.value = false;
    mount(stubService());
    expect(host.querySelector(".nearby")).toBeNull();
  });

  it("arrives with every proposal already selected", async () => {
    mount(stubService());
    await searchFor("Chicago");

    const boxes = rows();
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.checked)).toBe(true);
    expect(byText(".nearby__status", "pre-selected")).toBeTruthy();
    expect(byText("button", "Add 2 stops")).toBeTruthy();
  });

  it("shows what each proposal is, in preset-category words", async () => {
    mount(stubService());
    await searchFor("Chicago");
    const labels = Array.from(host.querySelectorAll(".nearby__category")).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(["Museum", "Viewpoint"]);
  });

  it("lists a site the tour already has, unticked, instead of duplicating it", async () => {
    addStop({
      lat: TWO_SITES.candidates[0].lat,
      lng: TWO_SITES.candidates[0].lng,
      title: "Museum X",
    });
    mount(stubService());
    await searchFor("Chicago");

    const boxes = rows();
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(false); // already in the tour
    expect(boxes[1].checked).toBe(true);
    expect(byText(".nearby__category", "Already added")).toBeTruthy();
    expect(host.querySelector(".nearby__status")?.textContent).toMatch(
      /1 already in your tour/,
    );
    expect(byText("button", "Add 1 stop")).toBeTruthy();
  });

  it("lets the user back out of individual choices", async () => {
    mount(stubService());
    await searchFor("Chicago");

    const [first] = rows();
    first.checked = false;
    first.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(byText("button", "Add 1 stop")).toBeTruthy();
  });

  it("supports select all / select none", async () => {
    mount(stubService());
    await searchFor("Chicago");

    byText("button", "Select none")?.click();
    await flush();
    expect(rows().every((b) => !b.checked)).toBe(true);
    expect(
      host.querySelector<HTMLButtonElement>(".nearby__actions .primary")
        ?.disabled,
    ).toBe(true);

    byText("button", "Select all")?.click();
    await flush();
    expect(rows().every((b) => b.checked)).toBe(true);
  });

  it("keeps the OSM attribution on screen", () => {
    mount(stubService());
    const attribution = host.querySelector(".nearby__attribution");
    expect(attribution?.textContent).toMatch(/OpenStreetMap/);
    expect(attribution?.querySelector("a")?.getAttribute("href")).toBe(
      "https://www.openstreetmap.org/copyright",
    );
  });

  it("discloses duplicates the ranking folded away (BUG-12)", async () => {
    mount(
      stubService({
        findPois: async () => ({ ...TWO_SITES, hidden: 3 }),
      }),
    );
    await searchFor("Chicago");
    expect(host.querySelector(".nearby__status")?.textContent).toMatch(
      /3 nearby duplicates hidden/,
    );
  });

  it("says nothing about duplicates when none were hidden", async () => {
    mount(stubService());
    await searchFor("Chicago");
    expect(host.querySelector(".nearby__status")?.textContent).not.toMatch(
      /hidden/,
    );
  });

  it("does not claim 0 results are 'all pre-selected' (BUG-14)", async () => {
    // Everything found is already in the tour: there is nothing to untick, so
    // the uncheck-any-you-don't-want sentence must not appear.
    for (const candidate of TWO_SITES.candidates) {
      addStop({
        lat: candidate.lat,
        lng: candidate.lng,
        title: candidate.title,
      });
    }
    mount(stubService());
    await searchFor("Chicago");

    const status = host.querySelector(".nearby__status")?.textContent ?? "";
    expect(rows().every((b) => !b.checked)).toBe(true);
    expect(status).not.toMatch(/pre-selected/);
    expect(status).not.toMatch(/uncheck any/);
    expect(status).toMatch(/already in your tour/);
  });

  it("does not mark an unrelated neighbour as 'Already added' (BUG-12)", async () => {
    // "SkyDeck Chicago Willis Tower" is 44 m from the starter's "Willis Tower
    // Skydeck" and is the same site; "The Ledge" is 35 m away and is not.
    addStop({ lat: 41.878876, lng: -87.635915, title: "Willis Tower Skydeck" });
    mount(
      stubService({
        findPois: async () => ({
          cached: false,
          hidden: 0,
          candidates: [
            {
              osmId: "node/10",
              title: "SkyDeck Chicago Willis Tower",
              lat: 41.878876,
              lng: -87.635915,
              category: "viewpoint" as const,
              blurb: "Viewpoint",
              hasWiki: true,
            },
            {
              osmId: "node/11",
              title: "The Ledge",
              lat: 41.878565,
              lng: -87.63589,
              category: "attraction" as const,
              blurb: "Attraction",
              hasWiki: false,
            },
          ],
        }),
      }),
    );
    await searchFor("Chicago");

    const boxes = rows();
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(false); // the same Skydeck, under another name
    expect(boxes[1].checked).toBe(true); // a different site on the same floor
    expect(byText("button", "Add 1 stop")).toBeTruthy();
  });
});

describe("accepting proposals", () => {
  it("adds the checked ones as ordinary stops and closes", async () => {
    mount(stubService());
    await searchFor("Chicago");

    const [first] = rows();
    first.checked = false;
    first.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    byText(".nearby__actions button", "Add 1 stop")?.click();
    await flush();

    expect(totalStops(tour.value)).toBe(1);
    const stop = tour.value.routes[0].stops[0];
    expect(stop.title).toBe("Viewpoint Y");
    expect(stop.category).toBe("viewpoint");
    // Nothing marks it as POI-derived.
    expect(stop).not.toHaveProperty("osmId");
    expect(stop).not.toHaveProperty("source");
    expect(nearbyOpen.value).toBe(false);
  });

  it("adds nothing when the dialog is simply closed", async () => {
    mount(stubService());
    await searchFor("Chicago");
    byText(".nearby__close", "✕")?.click();
    await flush();
    expect(totalStops(tour.value)).toBe(0);
  });
});

describe("the fallback path (epic item 5)", () => {
  it("offers the curated set when Overpass fails, with the reason", async () => {
    mount(
      stubService({
        findPois: async () => {
          throw new PoiNetworkError("timeout", "timed out after 12000 ms");
        },
      }),
    );
    await searchFor("Chicago");

    expect(rows().length).toBeGreaterThan(0);
    expect(rows().every((b) => b.checked)).toBe(true);
    const status = host.querySelector(".nearby__status")?.textContent ?? "";
    expect(status).toMatch(/timed out/);
    expect(status).toMatch(/Chicago downtown landmarks/);
    expect(byText("button", "Try OpenStreetMap again")).toBeTruthy();
  });

  it("says so when the curated set is entirely already in the tour", async () => {
    for (const candidate of curatedFor()) {
      addStop({
        lat: candidate.lat,
        lng: candidate.lng,
        title: candidate.title,
      });
    }
    mount(
      stubService({
        findPois: async () => {
          throw new PoiNetworkError("http", "Overpass HTTP 504");
        },
      }),
    );
    await searchFor("Chicago");

    expect(rows().length).toBeGreaterThan(0);
    expect(rows().every((b) => !b.checked)).toBe(true);
    expect(host.querySelector(".nearby__status")?.textContent).toMatch(
      /every one is already in your tour/,
    );
  });

  it("offers the curated set when the place cannot be geocoded", async () => {
    mount(
      stubService({
        geocode: async () => {
          throw new PoiNetworkError("empty", 'no place matched "Atlantis"');
        },
      }),
    );
    await searchFor("Atlantis");
    expect(rows().length).toBeGreaterThan(0);
    expect(host.querySelector(".nearby__status")?.textContent).toMatch(
      /Could not find "Atlantis"/,
    );
  });

  it("offers the curated set when nothing is mapped nearby", async () => {
    mount(
      stubService({
        findPois: async (): Promise<PoiResult> => ({
          candidates: [],
          cached: false,
          hidden: 0,
        }),
      }),
    );
    await searchFor("Chicago");
    expect(rows().length).toBeGreaterThan(0);
    const status = host.querySelector(".nearby__status")?.textContent ?? "";
    expect(status).toMatch(/No notable sites/);
    // And it says how far it actually looked, rather than asserting that
    // nothing exists near the place (BUG-10).
    expect(status).toMatch(/within [\d.]+ ?(m|km) of Chicago/);
  });

  it("curated proposals become stops the same way live ones do", async () => {
    mount(
      stubService({
        findPois: async () => {
          throw new PoiNetworkError("http", "Overpass HTTP 429");
        },
      }),
    );
    await searchFor("Chicago");
    const proposed = rows().length;

    host.querySelector<HTMLButtonElement>(".nearby__actions .primary")?.click();
    await flush();

    expect(totalStops(tour.value)).toBe(proposed);
    for (const stop of tour.value.routes[0].stops) {
      expect(stop).not.toHaveProperty("seeded");
      expect(stop.title.trim()).not.toBe("");
    }
  });
});

describe("the search centre", () => {
  it("searches around a pin dropped on the map", async () => {
    let seen: BBox | null = null;
    mount(
      stubService({
        findPois: async (bbox) => {
          seen = bbox;
          return TWO_SITES;
        },
      }),
    );

    nearbyCenter.value = { lat: 41.9, lng: -87.65 };
    await settleEffects();
    await flush();

    expect(seen).not.toBeNull();
    const bbox = seen as unknown as BBox;
    expect(bbox.south).toBeLessThan(41.9);
    expect(bbox.north).toBeGreaterThan(41.9);
    expect(rows()).toHaveLength(2);
  });

  it("keeps a name-search result once the map pin effect settles", async () => {
    // Regression (found in a browser, not in jsdom): geocoding sets the search
    // centre to draw the pin, and the pin effect used to treat that as a new
    // request — cancelling the search the user was waiting on. The proposals
    // must survive a full effect flush, and exactly two requests must go out.
    let poiCalls = 0;
    mount(
      stubService({
        findPois: async () => {
          poiCalls += 1;
          return TWO_SITES;
        },
      }),
    );
    await searchFor("Chicago");
    await settleEffects();
    await flush();

    expect(rows()).toHaveLength(2);
    expect(poiCalls).toBe(1);
    expect(host.querySelector(".nearby__status")?.textContent).not.toMatch(
      /cancelled/i,
    );
  });

  it("refuses to search for an empty place name", async () => {
    let called = false;
    mount(
      stubService({
        geocode: async () => {
          called = true;
          return CHICAGO;
        },
      }),
    );
    byText("button", "Search")?.click();
    await flush();
    expect(called).toBe(false);
    expect(host.querySelector(".nearby__status")?.textContent).toMatch(
      /Type a place name/,
    );
  });
});
