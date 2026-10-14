/**
 * App-level state shared by the editor and the brochure: which view is on
 * screen, and the "Edit a copy" flow.
 *
 * It lives above both feature folders on purpose. The editor's read-only
 * banner and the brochure's chrome both offer "Edit a copy", and putting the
 * flow in either folder would make the two import each other in a cycle.
 */

import { computed, signal } from "@preact/signals";
import {
  editCopy,
  loadStoredTour,
  readOnly,
  type Tour,
  totalStops,
  tour,
} from "./tour";

export type ViewMode = "editor" | "brochure";

/** What the author last chose. Ignored while a read-only share link is open. */
export const viewMode = signal<ViewMode>("editor");

/**
 * The view actually rendered. A `#view&t=` link is read-only (SPEC D2), and a
 * read-only tour has no editing affordances at all — so it always lands in the
 * brochure, whatever the author's last choice was.
 */
export const activeView = computed<ViewMode>(() =>
  readOnly.value ? "brochure" : viewMode.value,
);

export function showEditor(): void {
  if (readOnly.peek()) return;
  viewMode.value = "editor";
}

export function showBrochure(): void {
  viewMode.value = "brochure";
}

/**
 * The tour sitting in localStorage, when it is a *different* tour with work in
 * it. That is the only case where "Edit a copy" would destroy something.
 */
export function workingTourAtRisk(current: Tour = tour.peek()): Tour | null {
  const stored = loadStoredTour();
  if (!stored?.ok) return null;
  if (stored.tour.id === current.id) return null;
  if (totalStops(stored.tour) === 0) return null;
  return stored.tour;
}

export function editCopyPrompt(stored: Tour): string {
  const stops = totalStops(stored);
  return (
    `Editing a copy replaces the tour saved in this browser — ` +
    `“${stored.title}”, ${stops} stop${stops === 1 ? "" : "s"}.\n\n` +
    `Export it first if you want to keep it. Continue?`
  );
}

/**
 * Drop the share payload from the address bar without reloading the tour.
 * `replaceState` does not fire `hashchange`, so the store's hash watcher stays
 * quiet — otherwise clearing the hash would immediately re-open the shared
 * tour read-only and undo the copy.
 */
function clearShareHash(): void {
  if (typeof window === "undefined" || !window.location.hash) return;
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", `${pathname}${search}`);
}

/**
 * "Edit a copy" (SPEC D2 + §5 item 8): clone the viewed tour under a fresh id,
 * unlock editing and open the editor — asking first when that would overwrite
 * a different tour already saved in this browser.
 *
 * Returns the copy, or null when the author backed out.
 */
export function editCopyFlow(
  options: {
    confirm?: (message: string) => boolean;
    titleSuffix?: string;
  } = {},
): Tour | null {
  const ask =
    options.confirm ??
    (typeof window === "undefined"
      ? () => true
      : (message: string) => window.confirm(message));

  const atRisk = workingTourAtRisk();
  if (atRisk && !ask(editCopyPrompt(atRisk))) return null;

  const copy = editCopy({ titleSuffix: options.titleSuffix ?? " (copy)" });
  clearShareHash();
  viewMode.value = "editor";
  return copy;
}
