/**
 * Render tests for the brochure's paper parts. The map is excluded on purpose:
 * Leaflet needs a real layout engine, so it is verified in a browser instead.
 */

import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hiddenRouteIds } from "../editor/uiState";
import { twoRouteTour } from "../tour/fixtures";
import { createRoute, createStop, createTour } from "../tour/schema";
import { loadTour, resetStore, selectedStopId, tour } from "../tour/store";
import { ItineraryColumn, ItinerarySpill } from "./ItineraryColumn";
import { Legend } from "./Legend";
import { printPrep } from "./printing";
import { StopCards } from "./StopCards";
import { clearSpill, spillFromIndex } from "./spill";

let host: HTMLDivElement;

beforeEach(() => {
  resetStore();
  hiddenRouteIds.value = [];
  printPrep.value = false;
  clearSpill();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

function text(selector: string): string[] {
  return Array.from(host.querySelectorAll(selector)).map((node) =>
    (node.textContent ?? "").trim(),
  );
}

/** Let Preact flush a queued state update before asserting on the DOM. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ItineraryColumn", () => {
  beforeEach(() => {
    loadTour(twoRouteTour());
    render(<ItineraryColumn />, host);
  });

  it("puts the tour title in the ribbon, with tagline and subtitle", () => {
    expect(host.querySelector(".bro-ribbon__title")?.textContent).toBe(
      "Downtown Tour",
    );
    expect(host.querySelector(".bro-itinerary__subtitle")?.textContent).toBe(
      "Chicago",
    );
    expect(host.querySelector(".bro-itinerary__tagline")?.textContent).toBe(
      "Hop on and hop off to experience both routes!",
    );
  });

  it("opens one section per route, named in the route's color", () => {
    const names = text(".bro-route__name");
    expect(names).toEqual(["Green Route", "Red Route"]);
    const green = host.querySelector(".bro-route__name") as HTMLElement;
    expect(green.style.color).toBe("rgb(30, 132, 73)"); // #1E8449
  });

  it("restarts numbering inside each route (SPEC D5)", () => {
    const sections = Array.from(
      host.querySelectorAll(".bro-route"),
    ) as HTMLElement[];
    const badges = sections.map((section) =>
      Array.from(section.querySelectorAll(".stop-badge")).map(
        (badge) => badge.textContent,
      ),
    );
    expect(badges[0]).toEqual(["1", "2", "3"]);
    expect(badges[1][0]).toBe("1");
  });

  it("prints the blurb, falling back to a trimmed description (D6)", () => {
    const blurbs = text(".bro-row__blurb");
    expect(blurbs).toContain(
      "Northeast corner of Columbus and North Water, across from the NBC Tower",
    );
    // Skydeck has no blurb: the description is cut at a word boundary.
    const skydeck = blurbs.find((blurb) => blurb.startsWith("The 103rd-floor"));
    expect(skydeck).toBeDefined();
    expect(skydeck).toMatch(/…$/);
    expect((skydeck ?? "").length).toBeLessThanOrEqual(82);
  });

  it("selects a stop when its row is clicked (two-way sync, SPEC §3)", () => {
    const row = host.querySelector(".bro-row") as HTMLButtonElement;
    row.click();
    expect(selectedStopId.value).toBe(tour.value.routes[0].stops[0].id);
  });

  it("marks the selected row for the map→list direction", () => {
    selectedStopId.value = tour.value.routes[0].stops[1].id;
    render(<ItineraryColumn />, host);
    const selected = host.querySelector(".bro-row--selected");
    expect(selected?.getAttribute("data-stop-id")).toBe(
      tour.value.routes[0].stops[1].id,
    );
  });

  it("says so when the tour has no stops yet", () => {
    loadTour(createTour({ title: "Empty" }));
    render(<ItineraryColumn />, host);
    expect(host.querySelector(".bro-itinerary__empty")).not.toBe(null);
    expect(host.querySelectorAll(".bro-route")).toHaveLength(0);
  });

  it("marks spilled rows and announces the continuation", () => {
    spillFromIndex.value = 3; // first two routes' rows 1–3 stay, the rest spill
    render(<ItineraryColumn />, host);
    const spilledRows = host.querySelectorAll(".bro-route__stop--spilled");
    expect(spilledRows).toHaveLength(2); // the Red Route's two stops
    expect(
      host.querySelector(".bro-route--spilled .bro-route__name")?.textContent,
    ).toBe("Red Route");
    expect(host.querySelector(".bro-itinerary__continued")).not.toBe(null);
  });
});

describe("ItinerarySpill", () => {
  beforeEach(() => {
    loadTour(twoRouteTour());
  });

  it("renders nothing until a print measurement says the column overflowed", () => {
    render(<ItinerarySpill />, host);
    expect(host.querySelector(".bro-spill")).toBe(null);
  });

  it("carries exactly the spilled rows, with their own numbering", () => {
    spillFromIndex.value = 3;
    render(<ItinerarySpill />, host);
    expect(text(".bro-route__name")).toEqual(["Red Route"]);
    expect(
      text(".bro-row__title").map((t) => t.replace(/^Stop \d+:\s*/, "")),
    ).toEqual(["Sheraton Hotel", "Navy Pier"]);
    expect(text(".stop-badge")).toEqual(["1", "2"]);
  });

  it("covers every stop between the column and the continuation", () => {
    spillFromIndex.value = 2;
    render(<ItineraryColumn />, host);
    const kept = Array.from(
      host.querySelectorAll(".bro-route__stop:not(.bro-route__stop--spilled)"),
    ).length;
    render(<ItinerarySpill />, host);
    const spilled = host.querySelectorAll(".bro-row").length;
    expect(kept + spilled).toBe(5); // nothing is lost in the split
  });
});

describe("Legend", () => {
  it("keys every route, including one with no stops", () => {
    loadTour(
      createTour({
        routes: [
          createRoute({
            name: "Green Route",
            color: "#1E8449",
            stops: [createStop({ lat: 1, lng: 2 })],
          }),
          createRoute({ name: "Night Tour", color: "#1F3A5F", stops: [] }),
        ],
      }),
    );
    render(<Legend />, host);
    expect(text(".bro-legend__name")).toEqual(["Green Route", "Night Tour"]);
    expect(text(".bro-legend__meta")).toEqual(["key only"]);
  });

  it("toggles route visibility on screen", () => {
    loadTour(twoRouteTour());
    render(<Legend />, host);
    const first = host.querySelector(
      ".bro-legend__button",
    ) as HTMLButtonElement;
    expect(first.getAttribute("aria-pressed")).toBe("true");
    first.click();
    render(<Legend />, host);
    expect(hiddenRouteIds.value).toEqual(["route_green"]);
    expect(
      host
        .querySelector(".bro-legend__button")
        ?.classList.contains("bro-legend__button--off"),
    ).toBe(true);
  });

  it("sanitises a hostile route color before it reaches an inline style", () => {
    loadTour(
      createTour({
        routes: [
          createRoute({
            name: "Nasty",
            color: "red; background-image:url(https://evil.example/x.png)",
            stops: [createStop({ lat: 1, lng: 2 })],
          }),
        ],
      }),
    );
    render(<Legend />, host);
    const dot = host.querySelector(".bro-legend__dot") as HTMLElement;
    // The hostile URL never reaches the style; the color falls back.
    expect(dot.style.backgroundImage).not.toContain("evil.example");
    expect(dot.style.background).toBe("rgb(30, 132, 73)"); // default, not "red;…"
  });
});

describe("StopCards", () => {
  it("renders a card only for stops with a description or image", () => {
    loadTour(twoRouteTour());
    render(<StopCards />, host);
    const titles = text(".bro-card__title");
    expect(titles).toContain("Sheraton Hotel");
    expect(titles).toContain("Skydeck");
    expect(titles).not.toContain("Michigan Avenue Bridge");
  });

  it("renders nothing at all when no stop has card content", () => {
    loadTour(
      createTour({
        routes: [
          createRoute({
            stops: [createStop({ lat: 1, lng: 2, title: "Bare", blurb: "x" })],
          }),
        ],
      }),
    );
    render(<StopCards />, host);
    expect(host.querySelector(".bro-cards")).toBe(null);
  });

  it("lazy-loads images and hotlinks them without a referrer (D3)", () => {
    loadTour(twoRouteTour());
    render(<StopCards />, host);
    const image = host.querySelector(".bro-card__image") as HTMLImageElement;
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image.getAttribute("src")).toBe("https://example.com/sheraton.jpg");
  });

  it("loads images eagerly while a print is being staged", () => {
    loadTour(twoRouteTour());
    printPrep.value = true;
    render(<StopCards />, host);
    const image = host.querySelector(".bro-card__image") as HTMLImageElement;
    expect(image.getAttribute("loading")).toBe("eager");
  });

  it("collapses a broken image and keeps the card's text", async () => {
    loadTour(twoRouteTour());
    render(<StopCards />, host);
    const image = host.querySelector(".bro-card__image") as HTMLImageElement;
    image.dispatchEvent(new Event("error"));
    await flush(); // Preact commits state updates on a microtask
    expect(host.querySelector(".bro-card__figure")).toBe(null);
    expect(text(".bro-card__title")).toContain("Sheraton Hotel");
  });

  it("drops a non-https image URL rather than putting it in src", () => {
    const stop = createStop({
      lat: 1,
      lng: 2,
      title: "Sketchy",
      description: "Has a bad image.",
    });
    // Bypass the store's https check the way a hand-edited share payload would.
    (stop as { imageUrl?: string }).imageUrl = "javascript:alert(1)";
    loadTour(createTour({ routes: [createRoute({ stops: [stop] })] }));
    render(<StopCards />, host);
    expect(host.querySelector(".bro-card__image")).toBe(null);
    expect(text(".bro-card__description")).toEqual(["Has a bad image."]);
  });
});
