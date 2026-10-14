/**
 * The route editor's travel-mode selector, rendered for real.
 *
 * The point of these tests is the *storage* contract, not the markup: ADR
 * 0001 makes the default profile an absent key, and a selector that wrote
 * `"profile":"foot"` into every route would quietly spend share-URL budget on
 * no information. That is invisible in the UI and only shows up in the link.
 */

import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { twoRouteTour } from "../tour/fixtures";
import { loadTour, resetStore, tour, updateRoute } from "../tour/store";
import { serializeTour } from "../tour/validate";
import { RoutePanel } from "./RoutePanel";

let host: HTMLDivElement;

beforeEach(() => {
  resetStore();
  host = document.createElement("div");
  document.body.appendChild(host);
  loadTour(twoRouteTour());
});

afterEach(() => {
  render(null, host);
  host.remove();
});

function select(): HTMLSelectElement {
  const element = host.querySelector(".field--profile select");
  if (!(element instanceof HTMLSelectElement))
    throw new Error("no travel-mode selector rendered");
  return element;
}

function choose(value: string) {
  const element = select();
  element.value = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("RoutePanel travel mode", () => {
  it("offers walk / bike / car and defaults to walk", () => {
    render(<RoutePanel />, host);
    expect(Array.from(select().options).map((o) => o.value)).toEqual([
      "foot",
      "bike",
      "driving",
    ]);
    expect(Array.from(select().options).map((o) => o.textContent)).toEqual([
      "Walk",
      "Bike",
      "Car",
    ]);
    expect(select().value).toBe("foot");
  });

  it("stores the ADR name, not the UI wording", () => {
    render(<RoutePanel />, host);
    choose("driving");
    // "Car" is what the author reads; "driving" is what the URL carries.
    expect(tour.value.routes[0].profile).toBe("driving");
    expect(serializeTour(tour.value)).toContain('"profile":"driving"');
  });

  it("writes nothing at all when the author picks the default back", () => {
    render(<RoutePanel />, host);
    choose("bike");
    expect(tour.value.routes[0].profile).toBe("bike");
    choose("foot");
    expect("profile" in tour.value.routes[0]).toBe(false);
    expect(serializeTour(tour.value)).not.toContain("profile");
  });

  it("shows the active route's stored mode when the tour already has one", () => {
    updateRoute("route_green", { profile: "bike" });
    render(<RoutePanel />, host);
    expect(select().value).toBe("bike");
  });

  it("is disabled on a read-only share link", () => {
    loadTour(twoRouteTour(), { readOnly: true });
    render(<RoutePanel />, host);
    expect(select().disabled).toBe(true);
  });

  it("reports the routing state for the active route", () => {
    render(<RoutePanel />, host);
    const status = host.querySelector(".route-status");
    // The fixture's first route has three stops and no geometry yet.
    expect(status?.textContent).toContain("Straight line");
    expect(status?.className).not.toContain("route-status--approximate");
  });
});
