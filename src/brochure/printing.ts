/**
 * Getting a map onto paper.
 *
 * Two things make printing a Leaflet map different from printing a document:
 *
 * 1. **Tiles are async.** `window.print()` snapshots the page as it is, so a
 *    naive Print button prints a half-grey map (SPEC §6). The flow below puts
 *    the sheet into its print geometry *on screen* first, lets Leaflet request
 *    the tiles for that exact box, waits for them to settle, and only then
 *    prints.
 * 2. **Lazy images never load.** Detail-card images below the fold are
 *    `loading="lazy"`; the print would show empty frames. `printPrep` flips
 *    them to eager, and `whenImagesSettled` waits for them.
 *
 * Both waits are bounded: a dead tile server or a rotted image URL delays the
 * print by a few seconds, it never blocks it.
 */

import { signal } from "@preact/signals";

/**
 * True while the page is being staged for printing: the sheet switches to
 * print geometry, images load eagerly and every route draws (a route hidden
 * from the screen map is still part of the printed brochure).
 */
export const printPrep = signal(false);

export type SettleOutcome = "ready" | "timeout";

type Listener = (...args: unknown[]) => void;

/** The slice of `L.TileLayer` this module needs, so tests can fake it. */
export interface TileEmitter {
  on(type: string, fn: Listener): unknown;
  off(type: string, fn: Listener): unknown;
}

export interface SettleOptions {
  /** Hard ceiling; resolves "timeout" and lets the print proceed. */
  timeout?: number;
  /** Quiet period with nothing in flight before we call it settled. */
  quietFor?: number;
}

/**
 * Resolve once the tile layer has stopped loading tiles.
 *
 * Counts `tileloadstart` against `tileload`/`tileerror` rather than trusting a
 * single `load` event: `load` fires per batch, so a map that starts a second
 * batch (pan, zoom, resize) would otherwise look finished while half its tiles
 * are still in flight. Errors count as settled — a 404 tile is never coming.
 */
export function whenTilesSettled(
  layer: TileEmitter | null | undefined,
  options: SettleOptions = {},
): Promise<SettleOutcome> {
  const timeout = options.timeout ?? 8000;
  const quietFor = options.quietFor ?? 180;
  if (!layer) return Promise.resolve<SettleOutcome>("ready");

  return new Promise<SettleOutcome>((resolve) => {
    let pending = 0;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let done = false;

    const finish = (outcome: SettleOutcome) => {
      if (done) return;
      done = true;
      if (quietTimer !== null) clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      layer.off("tileloadstart", onStart);
      layer.off("tileload", onSettled);
      layer.off("tileerror", onSettled);
      resolve(outcome);
    };

    const armQuietTimer = () => {
      if (quietTimer !== null) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        if (pending === 0) finish("ready");
      }, quietFor);
    };

    const onStart = () => {
      pending += 1;
      if (quietTimer !== null) {
        clearTimeout(quietTimer);
        quietTimer = null;
      }
    };

    const onSettled = () => {
      pending = Math.max(0, pending - 1);
      if (pending === 0) armQuietTimer();
    };

    const hardTimer = setTimeout(() => finish("timeout"), timeout);

    layer.on("tileloadstart", onStart);
    layer.on("tileload", onSettled);
    layer.on("tileerror", onSettled);

    // Nothing may ever start (every tile already cached), so begin the quiet
    // countdown immediately rather than waiting for an event that never comes.
    armQuietTimer();
  });
}

interface ImageLike {
  complete: boolean;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

/**
 * Resolve once every `<img>` under `root` has loaded or failed. A broken image
 * URL (SPEC D3 accepts hotlink rot) settles via `error` and collapses itself.
 */
export function whenImagesSettled(
  root: { querySelectorAll(selector: string): ArrayLike<ImageLike> } | null,
  options: { timeout?: number } = {},
): Promise<SettleOutcome> {
  const timeout = options.timeout ?? 6000;
  if (!root) return Promise.resolve<SettleOutcome>("ready");

  const images = Array.from(root.querySelectorAll("img")).filter(
    (image) => !image.complete,
  );
  if (images.length === 0) return Promise.resolve<SettleOutcome>("ready");

  return new Promise<SettleOutcome>((resolve) => {
    let remaining = images.length;
    let done = false;
    const cleanups: (() => void)[] = [];

    const finish = (outcome: SettleOutcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const cleanup of cleanups) cleanup();
      resolve(outcome);
    };

    const timer = setTimeout(() => finish("timeout"), timeout);

    for (const image of images) {
      const onSettled = () => {
        remaining -= 1;
        if (remaining === 0) finish("ready");
      };
      image.addEventListener("load", onSettled);
      image.addEventListener("error", onSettled);
      cleanups.push(() => {
        image.removeEventListener("load", onSettled);
        image.removeEventListener("error", onSettled);
      });
    }
  });
}

/**
 * The map registers how to make itself print-ready (resize to the print box,
 * refit the stops, wait for tiles). A module-level hook rather than a prop,
 * because the Print button lives in the chrome and the map owns the Leaflet
 * instance; neither should have to thread a ref through the other.
 */
export type MapPrintPrepare = () => Promise<SettleOutcome>;

let mapPrintPrepare: MapPrintPrepare | null = null;

export function setMapPrintPrepare(prepare: MapPrintPrepare | null): void {
  mapPrintPrepare = prepare;
}

/** "ready" when there is no map to wait for, so callers need no special case. */
export async function runMapPrintPrepare(): Promise<SettleOutcome> {
  return (await mapPrintPrepare?.()) ?? "ready";
}

/** Two frames: one for Preact to commit, one for the browser to lay out. */
export function nextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * True while `printBrochure` owns the staging. The `beforeprint`/`afterprint`
 * fallbacks (for Ctrl+P) check this so they do not fight the button's flow —
 * in particular so `afterprint` does not unstage the sheet underneath it.
 */
let flowActive = false;

export function isPrintFlowActive(): boolean {
  return flowActive;
}

/**
 * Wait for the browser to finish with the print, then a moment longer.
 *
 * `window.print()` blocks until the dialog closes in Chrome, but returns
 * immediately in Firefox, which rasterises afterwards — unstaging on the next
 * line there printed a map Leaflet had already resized back to the screen box
 * (tiles covering only part of the panel). Bounded, because a browser that
 * never fires `afterprint` must not leave the page staged forever.
 */
export function waitForPrintToFinish(
  options: { timeout?: number; settle?: number } = {},
): Promise<"afterprint" | "timeout"> {
  const timeout = options.timeout ?? 15000;
  const settle = options.settle ?? 400;
  if (typeof window === "undefined") return Promise.resolve("timeout");

  return new Promise((resolve) => {
    let done = false;
    const finish = (outcome: "afterprint" | "timeout") => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener("afterprint", onAfterPrint);
      setTimeout(() => resolve(outcome), settle);
    };
    const onAfterPrint = () => finish("afterprint");
    const timer = setTimeout(() => finish("timeout"), timeout);
    window.addEventListener("afterprint", onAfterPrint);
  });
}

export interface PrintResult {
  tiles: SettleOutcome;
  images: SettleOutcome;
  printed: boolean;
  /** How the staged state ended: the browser told us, or we gave up waiting. */
  finished?: "afterprint" | "timeout";
}

/**
 * Stage the brochure and print it. Never throws: if staging fails we still
 * print, because a brochure with a grey map beats a Print button that does
 * nothing.
 */
export async function printBrochure(
  getSheet: () => Parameters<typeof whenImagesSettled>[0],
  deps: {
    print?: () => void;
    /**
     * Runs once the sheet is in print geometry, before anything is printed:
     * where layout-dependent decisions belong (the itinerary spill-over
     * measurement). Its re-render is given a frame to commit.
     */
    measure?: () => void;
    /** Runs after the print, staged or not. */
    cleanup?: () => void;
    /** Test seam for the hold-until-printed wait. */
    waitForFinish?: () => Promise<"afterprint" | "timeout">;
    imageTimeout?: number;
  } = {},
): Promise<PrintResult> {
  const print =
    deps.print ??
    (typeof window === "undefined" ? () => {} : () => window.print());

  if (printPrep.peek())
    return { tiles: "ready", images: "ready", printed: false };

  flowActive = true;
  printPrep.value = true;
  let tiles: SettleOutcome = "ready";
  let images: SettleOutcome = "ready";
  let finished: "afterprint" | "timeout" | undefined;
  try {
    await nextPaint();
    if (deps.measure) {
      deps.measure();
      await nextPaint();
    }
    tiles = await runMapPrintPrepare();
    images = await whenImagesSettled(getSheet(), {
      timeout: deps.imageTimeout ?? 6000,
    });
    print();
    // Hold the staged sheet until the browser is done with it (see
    // `waitForPrintToFinish`): Firefox rasterises after `print()` returns.
    finished = await (deps.waitForFinish ?? waitForPrintToFinish)();
  } finally {
    printPrep.value = false;
    flowActive = false;
    deps.cleanup?.();
  }
  return { tiles, images, printed: true, finished };
}
