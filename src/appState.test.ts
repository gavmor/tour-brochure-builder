import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activeView,
  editCopyFlow,
  showBrochure,
  showEditor,
  viewMode,
} from "./appState";
import { twoRouteTour } from "./tour/fixtures";
import {
  loadTour,
  readOnly,
  resetStore,
  stopHashWatcher,
  stopUrlSync,
  tour,
} from "./tour/store";
import { decodeTour, parseHash } from "./tour/urlShare";

beforeEach(() => {
  resetStore();
  viewMode.value = "editor";
  window.location.hash = "";
});

afterEach(() => {
  stopUrlSync();
  stopHashWatcher();
  window.location.hash = "";
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

describe("editCopyFlow", () => {
  function openSharedTour() {
    loadTour(twoRouteTour(), { readOnly: true });
  }

  it("copies under a fresh id, unlocks editing and opens the editor", () => {
    openSharedTour();
    const sharedId = tour.value.id;
    viewMode.value = "brochure";

    const copy = editCopyFlow();

    expect(copy).not.toBe(null);
    expect(tour.value.id).not.toBe(sharedId);
    expect(readOnly.value).toBe(false);
    expect(viewMode.value).toBe("editor");
    expect(tour.value.title).toBe("Downtown Tour (copy)");
  });

  it("swaps the read-only share hash for the copy's editable one", () => {
    const shared = twoRouteTour();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}#view&t=abc123`,
    );
    loadTour(shared, { readOnly: true });

    const copy = editCopyFlow();

    // replaceState (not location.hash = …), so no hashchange fires and the
    // watcher cannot re-open the shared tour read-only over the copy.
    const state = parseHash(window.location.hash);
    expect(state.view).toBe(false);
    expect(state.encoded).toBeTruthy();
    const decoded = decodeTour(state.encoded ?? "");
    expect(decoded.ok && decoded.tour.id).toBe(copy?.id);
    expect(readOnly.value).toBe(false);
  });
});
