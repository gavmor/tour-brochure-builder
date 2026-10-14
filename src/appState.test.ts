import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeView,
  editCopyFlow,
  editCopyPrompt,
  showBrochure,
  showEditor,
  viewMode,
  workingTourAtRisk,
} from "./appState";
import { twoRouteTour } from "./tour/fixtures";
import { clearStoredTour, saveTour } from "./tour/persistence";
import { createRoute, createStop, createTour } from "./tour/schema";
import { loadTour, readOnly, resetStore, tour } from "./tour/store";

beforeEach(() => {
  resetStore();
  clearStoredTour();
  viewMode.value = "editor";
  window.location.hash = "";
});

afterEach(() => {
  clearStoredTour();
});

describe("activeView", () => {
  it("follows the author's choice for an editable tour", () => {
    expect(activeView.value).toBe("editor");
    showBrochure();
    expect(activeView.value).toBe("brochure");
    showEditor();
    expect(activeView.value).toBe("editor");
  });

  it("forces the brochure for a read-only share link (SPEC D2)", () => {
    loadTour(twoRouteTour(), { readOnly: true });
    expect(activeView.value).toBe("brochure");
    // Even an explicit request for the editor is refused while locked: a
    // shared link has no editing affordances at all.
    showEditor();
    expect(activeView.value).toBe("brochure");
  });
});

describe("workingTourAtRisk", () => {
  it("is null when nothing is saved", () => {
    expect(workingTourAtRisk()).toBe(null);
  });

  it("is null when the saved tour is the one being viewed", () => {
    const current = twoRouteTour();
    loadTour(current);
    saveTour(tour.value);
    expect(workingTourAtRisk()).toBe(null);
  });

  it("is null when the saved tour is empty — nothing to lose", () => {
    saveTour(createTour({ id: "tour_empty", title: "Untitled tour" }));
    loadTour(twoRouteTour(), { readOnly: true });
    expect(workingTourAtRisk()).toBe(null);
  });

  it("reports a different saved tour that has stops", () => {
    saveTour(
      createTour({
        id: "tour_mine",
        title: "My draft",
        routes: [createRoute({ stops: [createStop({ lat: 1, lng: 2 })] })],
      }),
    );
    loadTour(twoRouteTour(), { readOnly: true });
    expect(workingTourAtRisk()?.title).toBe("My draft");
  });
});

describe("editCopyFlow", () => {
  function openSharedTour() {
    loadTour(twoRouteTour(), { readOnly: true });
  }

  it("copies under a fresh id, unlocks editing and opens the editor", () => {
    openSharedTour();
    const sharedId = tour.value.id;
    viewMode.value = "brochure";

    const copy = editCopyFlow({ confirm: () => true });

    expect(copy).not.toBe(null);
    expect(tour.value.id).not.toBe(sharedId);
    expect(readOnly.value).toBe(false);
    expect(viewMode.value).toBe("editor");
    expect(tour.value.title).toBe("Downtown Tour (copy)");
  });

  it("asks before overwriting a different saved tour, and backs off on no", () => {
    saveTour(
      createTour({
        id: "tour_mine",
        title: "My draft",
        routes: [createRoute({ stops: [createStop({ lat: 1, lng: 2 })] })],
      }),
    );
    openSharedTour();
    const sharedId = tour.value.id;
    const confirm = vi.fn((_message: string) => false);

    const copy = editCopyFlow({ confirm });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain("My draft");
    expect(copy).toBe(null);
    // Nothing moved: still the shared tour, still read-only.
    expect(tour.value.id).toBe(sharedId);
    expect(readOnly.value).toBe(true);
  });

  it("does not ask when there is nothing at risk", () => {
    openSharedTour();
    const confirm = vi.fn(() => true);
    editCopyFlow({ confirm });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("drops the share payload from the URL without re-opening it", () => {
    const hash = "#view&t=abc123";
    window.history.replaceState(null, "", `${window.location.pathname}${hash}`);
    openSharedTour();

    editCopyFlow({ confirm: () => true });

    // replaceState (not location.hash = "") — assigning would fire hashchange
    // and the store's watcher would reload the shared tour read-only.
    expect(window.location.hash).toBe("");
    expect(readOnly.value).toBe(false);
  });
});

describe("editCopyPrompt", () => {
  it("names the tour and its size so the choice is informed", () => {
    const stored = createTour({
      title: "My draft",
      routes: [createRoute({ stops: [createStop({ lat: 1, lng: 2 })] })],
    });
    const message = editCopyPrompt(stored);
    expect(message).toContain("My draft");
    expect(message).toContain("1 stop");
  });
});
