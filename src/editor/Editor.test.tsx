/**
 * Editor shell behaviour that the preset-control tests do not reach: the
 * load-failure banner (QA-BUG-2) and the "Start blank" / "Restore starter
 * tour" pair (QA-BUG-5).
 *
 * Leaflet does not run usefully in jsdom, so the map pane is stubbed; every
 * assertion here is about the chrome around it.
 */

import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { starterTour } from "../data/starterTour";
import {
  initStore,
  lastLoadNotice,
  resetStore,
  stopCount,
  stopHashWatcher,
  stopUrlSync,
  tour,
} from "../tour";

vi.mock("./MapEditor", () => ({ MapEditor: () => null }));

const { Editor } = await import("./Editor");

const CORRUPT_HASH = "#t=NOT-A-REAL-PAYLOAD-%%%";

let host: HTMLDivElement;

beforeEach(() => {
  window.location.hash = "";
  resetStore();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  stopUrlSync();
  stopHashWatcher();
  window.location.hash = "";
  resetStore();
  vi.restoreAllMocks();
});

function boot(options: { hash?: string } = {}) {
  return initStore({
    hash: options.hash ?? "",
    urlSync: false,
    watchHash: false,
    fallback: starterTour,
  });
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function button(label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!match) throw new Error(`no button labelled "${label}"`);
  return match as HTMLButtonElement;
}

describe("load-failure banner (QA-BUG-2)", () => {
  it("tells the user a corrupt share link fell back to the starter", async () => {
    boot({ hash: CORRUPT_HASH });
    render(<Editor />, host);
    await flush();

    const banner = host.querySelector(".editor__banner--error");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("could not be read");
    expect(banner?.textContent).toContain("starter tour");
    // The fallback still happened: the curated tour is on screen.
    expect(stopCount.value).toBe(6);
  });

  it("shows no banner on an ordinary first load", async () => {
    boot();
    render(<Editor />, host);
    await flush();
    expect(host.querySelector(".editor__banner--error")).toBeNull();
  });

  it("is dismissible — it must not block the editor", async () => {
    boot({ hash: CORRUPT_HASH });
    render(<Editor />, host);
    await flush();

    button("Dismiss").click();
    await flush();

    expect(lastLoadNotice.value).toBeNull();
    expect(host.querySelector(".editor__banner--error")).toBeNull();
  });
});

describe("Start blank is reversible (QA-BUG-5)", () => {
  it("offers no restore while the starter is untouched", async () => {
    boot();
    render(<Editor />, host);
    await flush();
    expect(button("Restore starter tour").disabled).toBe(true);
  });

  it("restores the curated tour after Start blank", async () => {
    boot();
    render(<Editor />, host);
    await flush();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    button("Start blank").click();
    await flush();
    expect(stopCount.value).toBe(0);

    const restore = button("Restore starter tour");
    expect(restore.disabled).toBe(false);
    restore.click();
    await flush();

    expect(stopCount.value).toBe(6);
    expect(tour.value.title).toBe("Chicago Downtown Walking Tour");
    // And it is offered no more, because there is nothing to restore.
    expect(button("Restore starter tour").disabled).toBe(true);
  });

  it("confirms before discarding real work", async () => {
    boot();
    render(<Editor />, host);
    await flush();

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    button("Start blank").click();
    await flush();
    expect(stopCount.value).toBe(6); // declined, nothing lost

    confirm.mockReturnValue(true);
    button("Start blank").click();
    await flush();
    // A blank tour has nothing to lose, so restoring needs no second dialog.
    const before = confirm.mock.calls.length;
    button("Restore starter tour").click();
    await flush();
    expect(confirm.mock.calls.length).toBe(before);
    expect(stopCount.value).toBe(6);
  });
});
