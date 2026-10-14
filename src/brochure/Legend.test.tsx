/**
 * The brochure legend's "approximate" indicator.
 *
 * The brochure's polylines are `interactive: false`, so a dashed line there
 * has no tooltip to explain itself — and a reader holding the printed sheet
 * has no cursor at all. The key is the only place that can say what a dashed
 * route means, so it has to say it on paper, not just on screen.
 */

import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetRouteGeometry,
  setRoutingService,
  syncRouteGeometry,
} from "../editor/routeGeometry";
import { createRoutingService } from "../routing";
import { twoRouteTour } from "../tour/fixtures";
import { loadTour, resetStore, tour } from "../tour/store";
import { Legend } from "./Legend";

let host: HTMLDivElement;

/** Every request fails: the "endpoint blocked / network off" case. */
function offlineRouting() {
  setRoutingService(
    createRoutingService({
      fetchImpl: () => Promise.reject(new TypeError("Failed to fetch")),
      storage: null,
      debounceMs: 0,
      minRequestIntervalMs: 0,
    }),
  );
}

async function flush(ticks = 8) {
  for (let i = 0; i < ticks; i++) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

beforeEach(() => {
  resetStore();
  resetRouteGeometry();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  resetRouteGeometry();
});

describe("Legend", () => {
  it("says nothing about routing when every route followed the streets", () => {
    loadTour(twoRouteTour());
    render(<Legend />, host);
    expect(host.querySelector(".bro-legend__note--approximate")).toBeNull();
    expect(
      host.querySelectorAll(".bro-legend__meta--approximate"),
    ).toHaveLength(0);
  });

  it("marks the routes that fell back, and explains the dashes in print", async () => {
    offlineRouting();
    loadTour(twoRouteTour());
    syncRouteGeometry(tour.value);
    await flush();

    render(<Legend />, host);
    expect(
      host.querySelectorAll(".bro-legend__meta--approximate"),
    ).toHaveLength(2);

    const note = host.querySelector(".bro-legend__note--approximate");
    expect(note?.textContent).toContain("Dashed");
    // The explanation must survive onto paper, so it carries no `no-print`.
    expect(note?.className).not.toContain("no-print");
  });

  it("still lists every route, never a blank key", async () => {
    offlineRouting();
    loadTour(twoRouteTour());
    syncRouteGeometry(tour.value);
    await flush();

    render(<Legend />, host);
    const names = Array.from(host.querySelectorAll(".bro-legend__name")).map(
      (element) => element.textContent,
    );
    expect(names).toEqual(["Green Route", "Red Route"]);
  });
});
