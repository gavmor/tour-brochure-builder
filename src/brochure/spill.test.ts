import { afterEach, describe, expect, it } from "vitest";
import {
  clearSpill,
  firstRowBeyond,
  measureSpill,
  SPILL_RESERVE_PX,
  spillFromIndex,
} from "./spill";

afterEach(clearSpill);

describe("firstRowBeyond", () => {
  it("is null when every row fits", () => {
    expect(firstRowBeyond([10, 20, 30], 40)).toBe(null);
  });

  it("finds the first row past the limit", () => {
    expect(firstRowBeyond([10, 20, 30, 40], 25)).toBe(2);
  });

  it("spills everything when even the first row overflows", () => {
    expect(firstRowBeyond([99], 10)).toBe(0);
  });

  it("treats a row ending exactly on the limit as fitting", () => {
    expect(firstRowBeyond([10, 20], 20)).toBe(null);
  });

  it("is null for an empty itinerary", () => {
    expect(firstRowBeyond([], 100)).toBe(null);
  });
});

describe("measureSpill", () => {
  /**
   * jsdom has no layout, so geometry is injected. The point under test is the
   * decision, not the measurement API.
   */
  function column(rowBottoms: number[], bottom: number, paddingBottom = 0) {
    const element = document.createElement("div");
    element.style.paddingBottom = `${paddingBottom}px`;
    element.getBoundingClientRect = () => ({ bottom }) as DOMRect;
    for (const rowBottom of rowBottoms) {
      const row = document.createElement("button");
      row.className = "bro-row";
      row.getBoundingClientRect = () => ({ bottom: rowBottom }) as DOMRect;
      element.appendChild(row);
    }
    document.body.appendChild(element);
    return element;
  }

  it("records no spill when the column holds every row", () => {
    const element = column([100, 200, 300], 500);
    expect(measureSpill(element)).toBe(null);
    expect(spillFromIndex.value).toBe(null);
    element.remove();
  });

  it("records the first row that does not fit", () => {
    const element = column([100, 200, 300, 400], 320);
    // Usable height is 320 − 0 padding − 18px reserve = 302, so the fourth row
    // (bottom 400) is the first to spill.
    expect(SPILL_RESERVE_PX).toBe(18);
    expect(measureSpill(element)).toBe(3);
    expect(spillFromIndex.value).toBe(3);
    element.remove();
  });

  it("keeps the column's bottom padding out of the usable height", () => {
    const padded = column([100], 120, 40);
    expect(measureSpill(padded)).toBe(0); // 120 − 40 − reserve < 100
    padded.remove();
  });

  it("is a no-op without a column or rows", () => {
    expect(measureSpill(null)).toBe(null);
    const empty = column([], 500);
    expect(measureSpill(empty)).toBe(null);
    empty.remove();
  });

  it("refuses to re-measure while a spill is applied", () => {
    const first = column([100, 200, 300, 400], 320);
    expect(measureSpill(first)).toBe(3);
    first.remove();

    // Second pass sees only the rows that are still displayed, so an
    // unguarded measurement would decide everything fits and undo the split.
    const afterSplit = column([100, 200], 320);
    expect(measureSpill(afterSplit)).toBe(3);
    expect(spillFromIndex.value).toBe(3);

    // …unless the caller explicitly asks for a fresh measurement.
    expect(measureSpill(afterSplit, { force: true })).toBe(null);
    afterSplit.remove();
  });
});
