/**
 * The route editor's travel-mode control, rendered for real.
 *
 * The point of these tests is the *storage* contract, not the markup. Two
 * cards wrote this field: the choice-first work shipped the segmented control
 * with `walking` / `cycling` ids while the profile was cosmetic, and the
 * routing work (ADR 0001) made it the name the FOSSGIS endpoints are keyed
 * on. The button labels stayed; the stored ids did not. If label and id ever
 * drift apart again it is invisible on screen, and only shows up as a walking
 * tour routed down a motorway.
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

function modes(): HTMLButtonElement[] {
  return Array.from(
    host.querySelectorAll<HTMLButtonElement>(".segmented__option"),
  );
}

function labels(): string[] {
  return modes().map((button) =>
    (button.textContent ?? "").replace(/\s+/g, ""),
  );
}

function pressed(): string | undefined {
  const on = modes().find(
    (button) => button.getAttribute("aria-pressed") === "true",
  );
  return on ? (on.textContent ?? "").replace(/[^A-Za-z]/g, "") : undefined;
}

function choose(label: string) {
  const button = modes().find((b) => (b.textContent ?? "").includes(label));
  if (!button) throw new Error(`no travel-mode button labelled ${label}`);
  button.click();
}

describe("RoutePanel travel mode", () => {
  it("offers walking / driving / cycling and defaults to walking", () => {
    render(<RoutePanel />, host);
    expect(labels()).toEqual(["🚶Walking", "🚗Driving", "🚲Cycling"]);
    expect(pressed()).toBe("Walking");
  });

  it("stores the ADR name, not the UI wording", () => {
    render(<RoutePanel />, host);
    choose("Driving");
    expect(tour.value.routes[0].profile).toBe("driving");

    choose("Cycling");
    // The button says "Cycling"; the share URL must say "bike", because that
    // is the name `src/routing/endpoints.ts` resolves to a host.
    expect(tour.value.routes[0].profile).toBe("bike");
    expect(serializeTour(tour.value)).toContain('"profile":"bike"');
    expect(serializeTour(tour.value)).not.toContain("cycling");
  });

  it("writes nothing at all when the author picks the default back", () => {
    render(<RoutePanel />, host);
    choose("Cycling");
    expect(tour.value.routes[0].profile).toBe("bike");
    choose("Walking");
    // ADR 0001: the default is stored as a missing key, not as "foot".
    expect("profile" in tour.value.routes[0]).toBe(false);
    expect(serializeTour(tour.value)).not.toContain("profile");
  });

  it("shows the active route's stored mode when the tour already has one", () => {
    updateRoute("route_green", { profile: "bike" });
    render(<RoutePanel />, host);
    expect(pressed()).toBe("Cycling");
  });

  it("shows a legacy `cycling` tour under the new id", () => {
    const legacy = twoRouteTour();
    (legacy.routes[0] as { profile?: string }).profile = "cycling";
    loadTour(legacy);
    render(<RoutePanel />, host);
    expect(pressed()).toBe("Cycling");
    expect(tour.value.routes[0].profile).toBe("bike");
  });

  it("is disabled on a read-only share link", () => {
    loadTour(twoRouteTour(), { readOnly: true });
    render(<RoutePanel />, host);
    expect(modes().every((button) => button.disabled)).toBe(true);
  });

  it("reports what the map is drawing, not just what is selected", () => {
    render(<RoutePanel />, host);
    const status = host.querySelector(".route-status");
    // No geometry has arrived for the fixture, so the honest answer is that
    // the line is still straight — pressing "Driving" does not change that.
    expect(status?.textContent).toContain("Straight line");
    expect(status?.className).not.toContain("route-status--approximate");
  });
});
