/**
 * Acceptance: the white-on-white continuation sheets keep their `--bleed-safe`
 * inset on **every** page, not just the first one.
 *
 * PR #6 printed the brochure full bleed (`@page { margin: 0 }`). The tri-fold
 * sheet is supposed to run to the trim; the continuation sheets (itinerary
 * spill, stop detail cards) are not — there is no background to bleed there,
 * only body copy a printer's non-printable margin would eat.
 *
 * That inset used to be `.bro-cards { padding: var(--bleed-safe) }`, and
 * container padding is exactly the wrong tool: CSS fragmentation applies a
 * box's `padding-top` only to its *first* fragment. A tour big enough to need
 * two card sheets therefore printed the second one flush to the top trim, with
 * the card border on raster row 0. Nothing in the unit suite could see it —
 * the declaration was present, so a stylesheet regex passed while the effect
 * was absent.
 *
 * So this spec prints a real PDF through the real Print flow, rasterises it
 * with `pdftoppm` and looks at the ink. It asserts both halves of the bargain:
 *
 *   - every continuation sheet is clear of the trim by at least 0.2in;
 *   - page 1 still bleeds to all four edges.
 *
 * The second assertion is not padding: a page margin wide enough to inset the
 * continuation sheets horizontally makes Chromium shrink the *whole document*
 * to fit its narrowest page, which silently opened a white band down page 1's
 * right edge while the first assertion stayed green.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
// A default import, not the named one `src/tour/urlShare.ts` uses: lz-string
// ships CommonJS, and Playwright's Node loader cannot pull named bindings out
// of it the way Vite and Vitest can. The canonical serialisation is still the
// app's own `serializeTour`, so the payload is a real share link.
import lzString from "lz-string";
import type { Route, Stop, Tour } from "../src/tour/schema";
import { serializeTour } from "../src/tour/validate";
import { blockExternalRequests } from "./helpers";

/** Matches the QA measurement that found the bug, so the numbers compare. */
const DPI = 150;

/**
 * The guarantee, in inches. `--bleed-safe` is 0.22in; 0.2in is the number the
 * README promises as a floor and leaves room for the raster to round an
 * antialiased hairline into the row below.
 */
const MIN_CLEARANCE_IN = 0.2;

/** Enough stops to need more than one sheet of detail cards. */
const STOPS_PER_ROUTE = 14;

// ----------------------------------------------------------------- fixtures

const BLURB = "Northwest corner of West Wacker Drive and North Michigan Avenue";
const DESCRIPTION =
  "A long enough paragraph of copy that the printed detail card has real body " +
  "text to lay out, which is what makes this worth testing at all rather than " +
  "a one-line stub that would never fill a column.";

function stops(prefix: string, lat: number, lng: number, n: number): Stop[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}_s${i}`,
    lat: +(lat + (i % 7) * 0.0022 - (i % 3) * 0.0011).toFixed(5),
    lng: +(lng + (i % 5) * 0.0031 - (i % 4) * 0.0014).toFixed(5),
    title: `Stop ${i + 1} — a fairly long stop name to wrap`,
    blurb: BLURB,
    description: DESCRIPTION,
  }));
}

function oversizedTour(): Tour {
  const routes: Route[] = [
    {
      id: "route_green",
      name: "Green Route",
      color: "#1E8449",
      stops: stops("g", 41.8896, -87.6208, STOPS_PER_ROUTE),
    },
    {
      id: "route_red",
      name: "Red Route",
      color: "#C0392B",
      stops: stops("r", 41.8789, -87.6359, STOPS_PER_ROUTE),
    },
  ];
  return {
    version: 2,
    id: "tour_print_bleed_safe",
    title: "Continuation Sheet Verification Tour",
    subtitle: "Chicago",
    tagline: "Deliberately too long for one sheet.",
    description:
      "An oversized two-route loop, sized to force the itinerary spill sheet " +
      "and more than one page of stop detail cards.",
    routes,
  };
}

/** The `t=` payload of a read-only share link, built the way the app does. */
function shareHash(tour: Tour): string {
  return lzString.compressToEncodedURIComponent(serializeTour(tour));
}

// -------------------------------------------------------------- raster tools

interface Raster {
  width: number;
  height: number;
  pixels: Buffer;
}

/** Parse the binary P6 PPM `pdftoppm` writes. */
function readPpm(path: string): Raster {
  const data = readFileSync(path);
  if (data.subarray(0, 2).toString("latin1") !== "P6") {
    throw new Error(`${path} is not a binary PPM`);
  }
  const fields: number[] = [];
  let at = 2;
  const isSpace = (byte: number) =>
    byte === 32 || byte === 9 || byte === 10 || byte === 13;
  while (fields.length < 3) {
    while (at < data.length && isSpace(data[at])) at += 1;
    if (data[at] === 0x23) {
      while (at < data.length && data[at] !== 10) at += 1;
      continue;
    }
    const start = at;
    while (at < data.length && !isSpace(data[at])) at += 1;
    fields.push(Number(data.subarray(start, at).toString("latin1")));
  }
  at += 1; // the single whitespace byte after maxval
  const [width, height, maxval] = fields;
  if (maxval !== 255) throw new Error(`expected an 8-bit PPM, got ${maxval}`);
  return { width, height, pixels: data.subarray(at, at + width * height * 3) };
}

/** The QA threshold: a pixel counts as paper only if every channel is >= 250. */
function isPaper(raster: Raster, x: number, y: number): boolean {
  const offset = (y * raster.width + x) * 3;
  return (
    raster.pixels[offset] >= 250 &&
    raster.pixels[offset + 1] >= 250 &&
    raster.pixels[offset + 2] >= 250
  );
}

/** Width of the fully-unprinted band at one edge, in inches. */
function clearBandInches(raster: Raster, edge: Edge): number {
  const { width, height } = raster;
  const vertical = edge === "top" || edge === "bottom";
  const lines = vertical ? height : width;
  const across = vertical ? width : height;
  for (let step = 0; step < lines; step += 1) {
    const line = edge === "top" || edge === "left" ? step : lines - 1 - step;
    for (let other = 0; other < across; other += 1) {
      const x = vertical ? other : line;
      const y = vertical ? line : other;
      if (!isPaper(raster, x, y)) return step / DPI;
    }
  }
  return lines / DPI;
}

type Edge = "top" | "right" | "bottom" | "left";
const EDGES: Edge[] = ["top", "right", "bottom", "left"];

function hasPdftoppm(): boolean {
  const probe = spawnSync("pdftoppm", ["-v"]);
  return !probe.error;
}

// -------------------------------------------------------------------- spec

test.describe("printed continuation sheets", () => {
  // Printing is a property of the document, not of the input device, and
  // `page.pdf()` is Chromium-headless only. One project is the whole story.
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "page.pdf() is Chromium-only",
  );
  test.skip(
    () => test.info().project.name !== "desktop-chromium",
    "The print sheet does not vary by input device; run it once.",
  );

  // Staging waits on tiles and images before it prints; both are bounded, but
  // the default 60s budget is tight once rasterising is added.
  test.setTimeout(180_000);

  test("keep at least 0.2in of clear paper above every card sheet, while page 1 still bleeds", async ({
    page,
  }) => {
    if (!hasPdftoppm()) {
      const message =
        "pdftoppm (poppler-utils) is required to measure the printed PDF. " +
        "Install it with `sudo apt-get install -y poppler-utils`.";
      // Never silently skip the guard on CI: a missing tool there means the
      // acceptance criterion is simply not being checked.
      if (process.env.CI) throw new Error(message);
      test.skip(true, message);
    }

    await blockExternalRequests(page);

    // `window.print()` must not open a dialog, and must not report back: the
    // flow holds the sheet staged until `afterprint` or its 15s ceiling, and
    // the PDF has to be taken while it is still staged.
    await page.addInitScript(() => {
      Object.defineProperty(window, "print", {
        configurable: true,
        value: () => {
          (window as unknown as { __printed?: boolean }).__printed = true;
        },
      });
    });

    await page.goto(`/#view&t=${shareHash(oversizedTour())}`);
    await expect(page.locator(".brochure")).toBeVisible();

    // The real button, not `printBrochure` directly: staging, Leaflet's
    // `invalidateSize`, the tile settle and the spill measurement are the
    // flow, and the spill sheet only exists because the measurement ran.
    await page.getByRole("button", { name: "Print" }).click();
    await expect(page.locator(".brochure--staging")).toBeAttached();
    await page.waitForFunction(
      () => (window as unknown as { __printed?: boolean }).__printed === true,
      undefined,
      { timeout: 60_000 },
    );

    // The tour has to be big enough that the cards actually fragment,
    // otherwise this test passes without ever exercising the bug.
    await expect(page.locator(".bro-cards .bro-card")).toHaveCount(
      STOPS_PER_ROUTE * 2,
    );

    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      scale: 1,
      landscape: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    const dir = mkdtempSync(join(tmpdir(), "brochure-print-"));
    const pdfPath = join(dir, "brochure.pdf");
    writeFileSync(pdfPath, pdf);
    execFileSync("pdftoppm", ["-r", String(DPI), pdfPath, join(dir, "pg")]);

    const pages = readdirSync(dir)
      .filter((name) => name.endsWith(".ppm"))
      .sort()
      .map((name) => readPpm(join(dir, name)));

    // sheet + itinerary spill + two or more card sheets.
    expect(
      pages.length,
      "This tour must need more than one sheet of detail cards, or the " +
        "fragmentation this test exists for never happens.",
    ).toBeGreaterThanOrEqual(4);

    // ----------------------------------------------- page 1 is still bleed
    const first = pages[0];
    expect(first.width / DPI).toBeCloseTo(11, 2);
    expect(first.height / DPI).toBeCloseTo(8.5, 2);
    for (const edge of EDGES) {
      expect(
        clearBandInches(first, edge),
        `Page 1 is the full-bleed tri-fold sheet: its ${edge} edge must be ` +
          "inked to the trim. A white band here means the document was " +
          "scaled or inset — check for a horizontal @page margin.",
      ).toBe(0);
    }

    // ------------------------------- every continuation sheet is held off
    for (let index = 1; index < pages.length; index += 1) {
      const sheet = pages[index];
      for (const edge of EDGES) {
        // The last sheet's trailing edge is simply empty paper; a bottom
        // band there is the column ending, not an inset, and is fine.
        const clearance = clearBandInches(sheet, edge);
        expect(
          clearance,
          `Continuation sheet ${index + 1} of ${pages.length}: ink reaches ` +
            `within ${clearance.toFixed(4)}in of the ${edge} trim. These ` +
            "sheets are white on white and must stay at least " +
            `${MIN_CLEARANCE_IN}in clear of every edge, on every fragment.`,
        ).toBeGreaterThanOrEqual(MIN_CLEARANCE_IN);
      }
    }
  });
});
