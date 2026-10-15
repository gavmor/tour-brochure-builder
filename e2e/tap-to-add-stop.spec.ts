/**
 * Acceptance: adding a stop by tapping/clicking the map must not scroll the
 * page.
 *
 * Reported by Gavin on a phone: tap the map to drop a stop and the page jumps.
 * The stop lands correctly — the viewport is what moves — so the unit suite
 * (jsdom, no layout, no scroll) cannot see it. Hence a real browser.
 *
 * The test is written to fail loudly rather than vacuously: it asserts the
 * document is genuinely scrollable and the map is genuinely on screen before
 * it touches anything, so a future layout change cannot turn this into a test
 * that passes because nothing can scroll.
 */

import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  blockExternalRequests,
  findEmptyMapPoint,
  scrollMetrics,
} from "./helpers";

/** Settling time for anything deferred — focus, `scrollIntoView`, re-render. */
const SETTLE_MS = 600;

/** Touch projects tap; the desktop project clicks. */
function usesTouch(): boolean {
  return test.info().project.use.hasTouch === true;
}

async function activate(locator: Locator): Promise<void> {
  if (usesTouch()) await locator.tap();
  else await locator.click();
}

async function openEditor(page: Page): Promise<void> {
  await blockExternalRequests(page);
  await page.goto("/");
  // A bare URL opens the curated starter tour (see src/main.tsx).
  await expect(page.getByTestId("map-canvas")).toBeVisible();
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.getByTestId("itinerary-row").first()).toBeVisible();
}

test.describe("map tap-to-add", () => {
  test("adding a stop by tapping the map leaves the page scroll untouched", async ({
    page,
  }) => {
    await openEditor(page);

    // ---------------------------------------------------- arm "+ Add stop"
    const addToggle = page.getByTestId("add-stop-toggle");
    await activate(addToggle);
    await expect(addToggle).toHaveAttribute("aria-pressed", "true");

    // ------------------------------------- the page must actually scroll…
    const before = await scrollMetrics(page);
    expect(
      before.maxScroll,
      "The editor page is not scrollable in this project, so a scroll " +
        "assertion would prove nothing. Check the responsive layout and the " +
        "project viewport in playwright.config.ts.",
    ).toBeGreaterThan(120);

    // …and we scroll it to a known non-zero offset, keeping the map in view.
    const target = Math.min(200, Math.round(before.maxScroll / 2));
    expect(target).toBeGreaterThan(0);
    await page.evaluate((y: number) => window.scrollTo(0, y), target);
    await page.waitForFunction(
      (y: number) => Math.abs(window.scrollY - y) <= 1,
      target,
    );
    const scrollBefore = (await scrollMetrics(page)).scrollY;
    expect(scrollBefore).toBeGreaterThan(0);

    // ------------------------------------------------------ add one stop
    const rows = page.getByTestId("itinerary-row");
    const countBefore = await rows.count();
    expect(countBefore).toBeGreaterThan(0);

    const mapBox = await page.getByTestId("map-canvas").boundingBox();
    if (!mapBox) throw new Error("The map has no layout box.");
    const point = await findEmptyMapPoint(page, mapBox);

    if (usesTouch()) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);

    await expect(rows).toHaveCount(countBefore + 1);

    // ----------------------------------------------------- the assertion
    // Give any deferred focus/scroll (the itinerary brings the selected row
    // into view) a chance to fire before reading the offset back.
    await page.waitForTimeout(SETTLE_MS);
    const scrollAfter = (await scrollMetrics(page)).scrollY;
    expect(
      scrollAfter,
      `Adding a stop scrolled the page from ${scrollBefore} to ${scrollAfter}.`,
    ).toBe(scrollBefore);

    // The stop is still usable: it is the one selected and being edited.
    await expect(page.locator(".itinerary-row--selected")).toHaveCount(1);
    await expect(rows.nth(countBefore)).toHaveClass(/itinerary-row--selected/);
    await expect(page.getByTestId("stop-panel")).toBeVisible();
  });
});
