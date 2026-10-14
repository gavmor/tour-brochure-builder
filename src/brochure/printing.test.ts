import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPrintFlowActive,
  nextPaint,
  printBrochure,
  printPrep,
  runMapPrintPrepare,
  setMapPrintPrepare,
  type TileEmitter,
  waitForPrintToFinish,
  whenImagesSettled,
  whenTilesSettled,
} from "./printing";

/** Minimal stand-in for `L.TileLayer`'s event surface. */
function fakeLayer() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const layer: TileEmitter & {
    emit(type: string): void;
    listenerCount(): number;
  } = {
    on(type, fn) {
      const set = handlers.get(type) ?? new Set();
      set.add(fn);
      handlers.set(type, set);
      return layer;
    },
    off(type, fn) {
      handlers.get(type)?.delete(fn);
      return layer;
    },
    emit(type) {
      for (const fn of handlers.get(type) ?? []) fn();
    },
    listenerCount() {
      let total = 0;
      for (const set of handlers.values()) total += set.size;
      return total;
    },
  };
  return layer;
}

describe("whenTilesSettled", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("settles after a quiet period when nothing is in flight", async () => {
    const layer = fakeLayer();
    const settled = whenTilesSettled(layer, { quietFor: 100, timeout: 1000 });
    await vi.advanceTimersByTimeAsync(120);
    await expect(settled).resolves.toBe("ready");
    // Listeners are removed, so a later pan does not resolve a stale promise.
    expect(layer.listenerCount()).toBe(0);
  });

  it("waits for every in-flight tile, not just the first batch", async () => {
    const layer = fakeLayer();
    const settled = whenTilesSettled(layer, { quietFor: 100, timeout: 5000 });
    layer.emit("tileloadstart");
    layer.emit("tileloadstart");
    await vi.advanceTimersByTimeAsync(300);

    layer.emit("tileload");
    await vi.advanceTimersByTimeAsync(300);
    // One tile is still loading: not ready yet.
    let resolved: string | null = null;
    settled.then((outcome) => {
      resolved = outcome;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(null);

    layer.emit("tileload");
    await vi.advanceTimersByTimeAsync(120);
    await expect(settled).resolves.toBe("ready");
  });

  it("counts a failed tile as settled — a 404 is never coming", async () => {
    const layer = fakeLayer();
    const settled = whenTilesSettled(layer, { quietFor: 50, timeout: 5000 });
    layer.emit("tileloadstart");
    layer.emit("tileerror");
    await vi.advanceTimersByTimeAsync(60);
    await expect(settled).resolves.toBe("ready");
  });

  it("gives up rather than blocking the print forever", async () => {
    const layer = fakeLayer();
    const settled = whenTilesSettled(layer, { quietFor: 100, timeout: 500 });
    layer.emit("tileloadstart"); // never finishes
    await vi.advanceTimersByTimeAsync(600);
    await expect(settled).resolves.toBe("timeout");
    expect(layer.listenerCount()).toBe(0);
  });

  it("is a no-op without a layer", async () => {
    await expect(whenTilesSettled(null)).resolves.toBe("ready");
  });
});

describe("whenImagesSettled", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function root(images: { complete: boolean }[]) {
    const nodes = images.map((image) => {
      const listeners = new Map<string, () => void>();
      return {
        ...image,
        addEventListener: (type: string, fn: () => void) => {
          listeners.set(type, fn);
        },
        removeEventListener: (type: string) => {
          listeners.delete(type);
        },
        fire: (type: string) => listeners.get(type)?.(),
      };
    });
    return {
      nodes,
      querySelectorAll: () => nodes,
    };
  }

  it("resolves immediately when every image is already loaded", async () => {
    const { querySelectorAll } = root([{ complete: true }, { complete: true }]);
    await expect(whenImagesSettled({ querySelectorAll })).resolves.toBe(
      "ready",
    );
  });

  it("waits for pending images and treats a broken URL as settled", async () => {
    const { nodes, querySelectorAll } = root([
      { complete: false },
      { complete: false },
    ]);
    const settled = whenImagesSettled({ querySelectorAll }, { timeout: 1000 });
    nodes[0].fire("load");
    nodes[1].fire("error"); // hotlink rot (SPEC D3) must not stall the print
    await expect(settled).resolves.toBe("ready");
  });

  it("times out instead of hanging on a dead image host", async () => {
    const { querySelectorAll } = root([{ complete: false }]);
    const settled = whenImagesSettled({ querySelectorAll }, { timeout: 200 });
    await vi.advanceTimersByTimeAsync(250);
    await expect(settled).resolves.toBe("timeout");
  });
});

describe("printBrochure", () => {
  afterEach(() => {
    setMapPrintPrepare(null);
    printPrep.value = false;
  });

  it("stages the sheet, waits for the map, then prints — and unstages", async () => {
    const order: string[] = [];
    setMapPrintPrepare(async () => {
      // The sheet must already be in print geometry when the map re-measures.
      order.push(`prepare:staging=${printPrep.value}`);
      return "ready";
    });
    const print = vi.fn(() => order.push("print"));

    const result = await printBrochure(() => null, {
      print,
      waitForFinish: async () => {
        // Still staged while the browser is rasterising (Firefox prints after
        // `window.print()` returns).
        order.push(`waiting:staging=${printPrep.value}`);
        return "afterprint";
      },
    });

    expect(order).toEqual([
      "prepare:staging=true",
      "print",
      "waiting:staging=true",
    ]);
    expect(print).toHaveBeenCalledTimes(1);
    expect(result.printed).toBe(true);
    expect(result.finished).toBe("afterprint");
    expect(printPrep.value).toBe(false);
  });

  it("marks the flow active so the Ctrl+P fallbacks stand aside", async () => {
    const seen: boolean[] = [];
    setMapPrintPrepare(async () => {
      seen.push(isPrintFlowActive());
      return "ready";
    });
    expect(isPrintFlowActive()).toBe(false);
    await printBrochure(() => null, {
      print: () => seen.push(isPrintFlowActive()),
      waitForFinish: async () => "afterprint",
    });
    expect(seen).toEqual([true, true]);
    expect(isPrintFlowActive()).toBe(false);
  });

  it("reports a tile timeout so the UI can warn about a patchy map", async () => {
    setMapPrintPrepare(async () => "timeout");
    const result = await printBrochure(() => null, {
      print: () => {},
      waitForFinish: async () => "afterprint",
    });
    expect(result.tiles).toBe("timeout");
    expect(result.printed).toBe(true);
  });

  it("still prints when no map is mounted", async () => {
    const print = vi.fn();
    await printBrochure(() => null, {
      print,
      waitForFinish: async () => "afterprint",
    });
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("ignores a second press while a print is being staged", async () => {
    printPrep.value = true;
    const print = vi.fn();
    const result = await printBrochure(() => null, { print });
    expect(print).not.toHaveBeenCalled();
    expect(result.printed).toBe(false);
  });

  it("clears the staging flag even if the map hook throws", async () => {
    setMapPrintPrepare(async () => {
      throw new Error("leaflet exploded");
    });
    await expect(
      printBrochure(() => null, { print: () => {} }),
    ).rejects.toThrow("leaflet exploded");
    expect(printPrep.value).toBe(false);
  });
});

describe("runMapPrintPrepare", () => {
  it("is ready when nothing registered a map", async () => {
    setMapPrintPrepare(null);
    await expect(runMapPrintPrepare()).resolves.toBe("ready");
  });
});

describe("waitForPrintToFinish", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves once the browser reports the print is done", async () => {
    const settled = waitForPrintToFinish({ timeout: 5000, settle: 50 });
    window.dispatchEvent(new Event("afterprint"));
    await vi.advanceTimersByTimeAsync(60);
    await expect(settled).resolves.toBe("afterprint");
  });

  it("gives up rather than leaving the sheet staged forever", async () => {
    const settled = waitForPrintToFinish({ timeout: 200, settle: 10 });
    await vi.advanceTimersByTimeAsync(260);
    await expect(settled).resolves.toBe("timeout");
  });
});

describe("nextPaint", () => {
  it("resolves", async () => {
    await expect(nextPaint()).resolves.toBeUndefined();
  });
});
