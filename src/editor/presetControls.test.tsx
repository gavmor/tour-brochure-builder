/**
 * Choice-first editor controls (§3): the preset UIs render and are reversible,
 * and no blank free-text input remains for profile, color, category or
 * coordinates. Leaflet itself is excluded (verified in a browser); these tests
 * exercise the sidebar panels only.
 */

import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activeRouteId,
  loadTour,
  resetStore,
  selectedStopId,
  tour,
} from "../tour";
import { twoRouteTour } from "../tour/fixtures";
import { RoutePanel } from "./RoutePanel";
import { StopPanel } from "./StopPanel";

let host: HTMLDivElement;

beforeEach(() => {
  resetStore();
  loadTour(twoRouteTour());
  activeRouteId.value = tour.value.routes[0].id;
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("RoutePanel preset controls", () => {
  beforeEach(() => {
    render(<RoutePanel />, host);
  });

  it("offers a segmented profile control, not a text field (§3a)", () => {
    const labels = Array.from(host.querySelectorAll(".segmented__option")).map(
      (b) => (b.textContent ?? "").trim(),
    );
    expect(labels).toEqual(["🚶Walking", "🚗Driving", "🚲Cycling"]);
  });

  it("offers a 10-swatch palette and marks the current selection (§3b)", () => {
    const swatches = host.querySelectorAll(".swatch");
    expect(swatches.length).toBe(10);
    const on = host.querySelectorAll(".swatch--on");
    expect(on.length).toBe(1);
    expect(on[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps hex/color entry out of the primary UI (behind a disclosure)", () => {
    // No free-text input for the color.
    const textInputs = Array.from(
      host.querySelectorAll('input[type="text"]'),
    ).map((i) => i.getAttribute("aria-label"));
    expect(textInputs).not.toContain("Custom route color");
    // The native color input exists only inside the <details> escape hatch.
    const colorInput = host.querySelector('input[type="color"]');
    expect(colorInput).not.toBeNull();
    expect(colorInput?.closest("details")).not.toBeNull();
  });

  it("switches and reverses the profile (§3a reversibility)", async () => {
    const driving = Array.from(
      host.querySelectorAll(".segmented__option"),
    ).find((b) =>
      (b.textContent ?? "").includes("Driving"),
    ) as HTMLButtonElement;
    driving.click();
    await flush();
    expect(tour.value.routes[0].profile).toBe("driving");

    const walking = Array.from(
      host.querySelectorAll(".segmented__option"),
    ).find((b) =>
      (b.textContent ?? "").includes("Walking"),
    ) as HTMLButtonElement;
    walking.click();
    await flush();
    // Reset to default stores it as absence.
    expect(tour.value.routes[0].profile).toBeUndefined();
  });
});

describe("StopPanel preset controls", () => {
  beforeEach(() => {
    selectedStopId.value = tour.value.routes[0].stops[0].id;
    render(<StopPanel />, host);
  });

  it("offers a category select covering every preset (§3c)", () => {
    const select = host.querySelector("select");
    expect(select).not.toBeNull();
    const options = Array.from(select?.options ?? []).map((o) => o.value);
    expect(options).toContain("museum");
    expect(options).toContain("poi");
    expect(options.length).toBeGreaterThanOrEqual(8);
  });

  it("removes raw lat/lng typing from the primary UI (§3d)", () => {
    const numberInputs = host.querySelectorAll('input[type="number"]');
    // Both coordinate inputs live behind the 'Advanced' disclosure.
    expect(numberInputs.length).toBe(2);
    for (const input of Array.from(numberInputs)) {
      expect(input.closest("details")).not.toBeNull();
    }
    const summary = host.querySelector(".stop-panel__advanced summary");
    expect(summary?.textContent).toContain("Advanced");
  });

  it("changes and resets the category (§3c reversibility)", async () => {
    const stopId = tour.value.routes[0].stops[0].id;
    const select = host.querySelector("select") as HTMLSelectElement;
    select.value = "food";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    const changed = tour.value.routes[0].stops.find((s) => s.id === stopId);
    expect(changed?.category).toBe("food");

    const reset = Array.from(host.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "Reset",
    ) as HTMLButtonElement;
    reset.click();
    await flush();
    const afterReset = tour.value.routes[0].stops.find((s) => s.id === stopId);
    expect(afterReset?.category).toBeUndefined();
  });
});
