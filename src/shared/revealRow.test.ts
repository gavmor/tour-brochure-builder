/**
 * jsdom has no layout engine, so the geometry every branch turns on is stubbed
 * explicitly. That is the point of the test: the rule is "move the nearest
 * element-level scroller and nothing else", and the regression it guards is a
 * page that scrolled when a stop was added from the map.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { revealWithinScroller, rowForStop } from "./revealRow";

interface Box {
  top: number;
  bottom: number;
}

function box({ top, bottom }: Box): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 0,
    width: 0,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** A scroller wrapping one row, with the geometry jsdom will not compute. */
function scene(options: {
  overflowY: string;
  scrollHeight: number;
  clientHeight: number;
  scrollerBox: Box;
  rowBox: Box;
  scrollTop?: number;
}) {
  const scroller = document.createElement("div");
  scroller.style.overflowY = options.overflowY;
  Object.defineProperty(scroller, "scrollHeight", {
    value: options.scrollHeight,
    configurable: true,
  });
  Object.defineProperty(scroller, "clientHeight", {
    value: options.clientHeight,
    configurable: true,
  });
  Object.defineProperty(scroller, "clientTop", {
    value: 0,
    configurable: true,
  });
  scroller.scrollTop = options.scrollTop ?? 0;
  scroller.getBoundingClientRect = () => box(options.scrollerBox);

  const row = document.createElement("li");
  row.dataset.stopId = "s1";
  row.getBoundingClientRect = () => box(options.rowBox);
  scroller.append(row);
  document.body.append(scroller);
  return { scroller, row };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("revealWithinScroller", () => {
  it("scrolls the nearest scrollable ancestor down to a row below it", () => {
    const { scroller, row } = scene({
      overflowY: "auto",
      scrollHeight: 2000,
      clientHeight: 400,
      scrollerBox: { top: 100, bottom: 500 },
      rowBox: { top: 560, bottom: 600 },
    });
    revealWithinScroller(row);
    // "nearest": the row's bottom lands on the scrollport's bottom.
    expect(scroller.scrollTop).toBe(100);
  });

  it("scrolls up to a row above the scrollport", () => {
    const { scroller, row } = scene({
      overflowY: "scroll",
      scrollHeight: 2000,
      clientHeight: 400,
      scrollerBox: { top: 100, bottom: 500 },
      rowBox: { top: 40, bottom: 80 },
      scrollTop: 300,
    });
    revealWithinScroller(row);
    expect(scroller.scrollTop).toBe(240);
  });

  it("leaves a row that is already visible alone", () => {
    const { scroller, row } = scene({
      overflowY: "auto",
      scrollHeight: 2000,
      clientHeight: 400,
      scrollerBox: { top: 100, bottom: 500 },
      rowBox: { top: 200, bottom: 240 },
      scrollTop: 120,
    });
    revealWithinScroller(row);
    expect(scroller.scrollTop).toBe(120);
  });

  it("does nothing when no ancestor scrolls — the page must not move", () => {
    // The narrow editor layout: the sidebar is `overflow: visible`, so the
    // document is the only scroller, and moving it is the bug.
    const { scroller, row } = scene({
      overflowY: "visible",
      scrollHeight: 2000,
      clientHeight: 2000,
      scrollerBox: { top: 100, bottom: 2100 },
      rowBox: { top: 1800, bottom: 1840 },
    });
    const pageScroll = vi.spyOn(window, "scrollTo");
    revealWithinScroller(row);
    expect(scroller.scrollTop).toBe(0);
    expect(pageScroll).not.toHaveBeenCalled();
  });

  it("ignores an overflow container that has nothing to scroll", () => {
    const { scroller, row } = scene({
      overflowY: "auto",
      scrollHeight: 400,
      clientHeight: 400,
      scrollerBox: { top: 100, bottom: 500 },
      rowBox: { top: 600, bottom: 640 },
    });
    revealWithinScroller(row);
    expect(scroller.scrollTop).toBe(0);
  });

  it("never calls scrollIntoView, which would scroll the document too", () => {
    const { row } = scene({
      overflowY: "auto",
      scrollHeight: 2000,
      clientHeight: 400,
      scrollerBox: { top: 100, bottom: 500 },
      rowBox: { top: 560, bottom: 600 },
    });
    // jsdom has no layout, so it does not implement scrollIntoView at all.
    const intoView = vi.fn();
    (row as unknown as { scrollIntoView: () => void }).scrollIntoView =
      intoView;
    revealWithinScroller(row);
    expect(intoView).not.toHaveBeenCalled();
  });
});

describe("rowForStop", () => {
  it("finds a row by data-stop-id", () => {
    const { scroller, row } = scene({
      overflowY: "auto",
      scrollHeight: 2000,
      clientHeight: 400,
      scrollerBox: { top: 100, bottom: 500 },
      rowBox: { top: 200, bottom: 240 },
    });
    expect(rowForStop(scroller, "s1")).toBe(row);
    expect(rowForStop(scroller, "nope")).toBeNull();
    expect(rowForStop(null, "s1")).toBeNull();
  });

  it("does not choke on an id that is not a valid CSS selector", () => {
    const { scroller } = scene({
      overflowY: "auto",
      scrollHeight: 2000,
      clientHeight: 400,
      scrollerBox: { top: 100, bottom: 500 },
      rowBox: { top: 200, bottom: 240 },
    });
    // Imported tours are untrusted input; a selector built from this throws.
    expect(() => rowForStop(scroller, '"] , script')).not.toThrow();
  });
});
