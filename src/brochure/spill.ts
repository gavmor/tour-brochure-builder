/**
 * Itinerary spill-over (SPEC §5 item 6).
 *
 * Panel 3 is a fixed 7.8in column, so a tour with more entries than fit would
 * have its tail clipped by `overflow: hidden` — stops silently missing from
 * the printed brochure, which is the one failure mode a printed artifact must
 * not have. Instead the column keeps what fits and the remainder prints as an
 * "itinerary continued" sheet ahead of the detail cards.
 *
 * The split can only be measured once the sheet is in print geometry, so the
 * print flow measures, re-renders, and only then prints. The arithmetic is
 * kept pure here so it can be tested without a layout engine.
 */

import { signal } from "@preact/signals";

/**
 * Flat index (across routes, in print order) of the first itinerary row that
 * no longer fits in panel 3. `null` means everything fits.
 */
export const spillFromIndex = signal<number | null>(null);

/** Slack under the last row: room for the "continues overleaf" line. */
export const SPILL_RESERVE_PX = 18;

/**
 * First index whose bottom edge passes `limit`, or null when they all fit.
 *
 * Rows are in document order, but the comparison does not assume monotonic
 * bottoms — once one row overflows, everything after it moves too, so the
 * first overflowing row wins even if a later one happens to measure shorter.
 */
export function firstRowBeyond(
  bottoms: number[],
  limit: number,
): number | null {
  for (let index = 0; index < bottoms.length; index += 1) {
    if (bottoms[index] > limit) return index;
  }
  return null;
}

/**
 * Measure the rendered column and record where it has to break. Call it only
 * while the sheet is in print geometry; on screen the column scrolls and
 * nothing spills.
 *
 * A measurement is refused while a spill is already applied: the rows it would
 * measure are the ones still displayed, so it would conclude "everything fits"
 * and undo the split. (`Page.printToPDF` and Ctrl+P both fire `beforeprint`
 * after our own staging pass has measured — this is the guard that stops the
 * second pass from wiping the first.) Pass `force` after clearing the spill.
 */
export function measureSpill(
  column: HTMLElement | null,
  options: { force?: boolean } = {},
): number | null {
  if (!options.force && spillFromIndex.peek() !== null) {
    return spillFromIndex.peek();
  }
  if (!column) {
    spillFromIndex.value = null;
    return null;
  }
  const rows = Array.from(column.querySelectorAll<HTMLElement>(".bro-row"));
  if (rows.length === 0) {
    spillFromIndex.value = null;
    return null;
  }
  const box = column.getBoundingClientRect();
  const padding = Number.parseFloat(
    getComputedStyle(column).paddingBottom || "0",
  );
  const limit = box.bottom - padding - SPILL_RESERVE_PX;
  const index = firstRowBeyond(
    rows.map((row) => row.getBoundingClientRect().bottom),
    limit,
  );
  spillFromIndex.value = index;
  return index;
}

export function clearSpill(): void {
  spillFromIndex.value = null;
}
