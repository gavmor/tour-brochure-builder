/**
 * The brochure shell, rendered for real — including the Leaflet map, which is
 * why this file stubs `ResizeObserver` (jsdom has none). The assertions stay
 * on the chrome and the licence credit: things that must not quietly
 * disappear, and that a browser pass would only catch by eye.
 */

import { render } from "preact";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { twoRouteTour } from "../tour/fixtures";
import { loadTour, resetStore } from "../tour/store";
import { Brochure } from "./Brochure";
import { clearSpill } from "./spill";

let host: HTMLDivElement;

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  resetStore();
  clearSpill();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

function buttonLabels(): string[] {
  return Array.from(
    host.querySelectorAll(".brochure__chrome-actions button"),
  ).map((button) => (button.textContent ?? "").trim());
}

describe("Brochure", () => {
  it("prints its own OSM credit, not just Leaflet's control", () => {
    // Leaflet's attribution control is hidden in print because Firefox does
    // not reliably include it; the credit is a tile-licence obligation.
    loadTour(twoRouteTour());
    render(<Brochure />, host);
    const credit = host.querySelector(".brochure__attribution");
    expect(credit?.textContent).toContain("OpenStreetMap");
    expect(credit?.querySelector("a")?.getAttribute("href")).toContain(
      "openstreetmap.org/copyright",
    );
  });

  it("offers Editor / Print / Copy share link while editable", () => {
    loadTour(twoRouteTour());
    render(<Brochure />, host);
    expect(buttonLabels()).toEqual(["← Editor", "Print", "Copy share link"]);
    expect(host.querySelector(".brochure__banner")).toBe(null);
  });

  it("drops the editor affordance and offers Edit a copy when read-only", () => {
    // SPEC D2: a shared link has no editing affordances at all.
    loadTour(twoRouteTour(), { readOnly: true });
    render(<Brochure />, host);
    expect(buttonLabels()).toEqual(["Print", "Copy share link", "Edit a copy"]);
    expect(host.querySelector(".brochure__banner")?.textContent).toContain(
      "read-only",
    );
  });

  it("assembles the sheet: map panel, legend, itinerary, detail cards", () => {
    loadTour(twoRouteTour(), { readOnly: true });
    render(<Brochure />, host);
    expect(host.querySelector(".brochure__page--main")).not.toBe(null);
    expect(host.querySelector(".brochure-map")).not.toBe(null);
    expect(host.querySelector(".bro-legend")).not.toBe(null);
    expect(host.querySelector(".bro-ribbon__title")?.textContent).toBe(
      "Downtown Tour",
    );
    expect(host.querySelectorAll(".bro-card").length).toBeGreaterThan(0);
  });
});
