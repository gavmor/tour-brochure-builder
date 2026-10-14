/**
 * App-level state shared by the editor and the brochure: which view is on
 * screen, and the "Edit a copy" flow.
 *
 * It lives above both feature folders on purpose. The editor's read-only
 * banner and the brochure's chrome both offer "Edit a copy", and putting the
 * flow in either folder would make the two import each other in a cycle.
 */

import { computed, signal } from "@preact/signals";
import { editCopy, readOnly, syncUrlNow, type Tour } from "./tour";

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
 * "Edit a copy" (SPEC D2 + §5 item 8): clone the viewed tour under a fresh id,
 * unlock editing and open the editor.
 *
 * No confirmation step any more, and nothing is at risk: the URL is the only
 * place state lives (ADR 0002), so the one thing a copy could overwrite is the
 * `#view&t=` link currently in the address bar — which the person doing the
 * copying is looking at, can still press Back to, and in any case still holds
 * wherever they were sent it. The old dialog guarded a localStorage slot that
 * no longer exists, so SPEC §5 item 8 is answered: no, it does not.
 *
 * Returns the copy. The `Tour | null` result is kept so a future prompt can
 * report a cancellation without churning the call sites.
 */
export function editCopyFlow(
  options: { titleSuffix?: string } = {},
): Tour | null {
  const copy = editCopy({ titleSuffix: options.titleSuffix ?? " (copy)" });
  // Swap `#view&t=…` for the copy's editable `#t=…` immediately, rather than
  // waiting out the URL writer's debounce, so the address bar is never
  // momentarily pointing at the tour that is no longer on screen.
  syncUrlNow();
  viewMode.value = "editor";
  return copy;
}
