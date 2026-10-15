/**
 * Bring a selected row into view *without ever moving the page*.
 *
 * `Element.scrollIntoView` scrolls every scrollable ancestor it can find, and
 * the document is one of them. That is fine on the wide editor layout, where
 * the sidebar is its own scroller — but under 860px the sidebar is
 * `overflow: visible` and the document is the only thing that scrolls, so
 * selecting a freshly tapped-in stop yanked the whole page down by several
 * hundred pixels (the map-tap-to-add scroll bug).
 *
 * So: find the nearest ancestor that actually scrolls and move only that one.
 * Writing `scrollTop` on an element cannot propagate out to the window. If
 * nothing between the row and the document scrolls, the row is left alone —
 * a still page beats a revealed row.
 */

/** Rows carry `data-stop-id`; ids come from imported tours, so no selectors. */
export function rowForStop(
  container: ParentNode | null | undefined,
  stopId: string,
): HTMLElement | null {
  const rows = container?.querySelectorAll<HTMLElement>("[data-stop-id]");
  if (!rows) return null;
  for (const row of Array.from(rows)) {
    if (row.dataset.stopId === stopId) return row;
  }
  return null;
}

/** The nearest ancestor that scrolls on its own, or null if only the page would. */
function scrollableAncestor(row: Element): Element | null {
  const doc = row.ownerDocument;
  const view = doc?.defaultView;
  if (!view) return null;
  let node = row.parentElement;
  while (node && node !== doc.body && node !== doc.documentElement) {
    const { overflowY } = view.getComputedStyle(node);
    const scrolls =
      overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
    if (scrolls && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * `scrollIntoView({ block: "nearest" })`, scoped to one scroll container:
 * a visible row is left where it is, and an off-screen one is moved the least
 * distance that reveals it.
 */
export function revealWithinScroller(row: Element): void {
  const scroller = scrollableAncestor(row);
  if (!scroller) return;

  const rowBox = row.getBoundingClientRect();
  const scrollerBox = scroller.getBoundingClientRect();
  // `getBoundingClientRect` spans the border box; the scrollport does not.
  const viewTop = scrollerBox.top + scroller.clientTop;
  const viewBottom = viewTop + scroller.clientHeight;

  if (rowBox.top >= viewTop && rowBox.bottom <= viewBottom) return;
  scroller.scrollTop +=
    rowBox.top < viewTop ? rowBox.top - viewTop : rowBox.bottom - viewBottom;
}
