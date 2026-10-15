/**
 * Shared helpers for the acceptance specs.
 *
 * Kept deliberately small: a spec should read as the thing a person would do,
 * and everything here is either "stop the test from touching the public
 * internet" or "find a part of the map that is actually empty".
 */

import type { Page } from "@playwright/test";

export interface Point {
  x: number;
  y: number;
}

/**
 * Block every request that leaves the dev server.
 *
 * The editor pulls OSM tiles and asks the FOSSGIS routing endpoints for road
 * geometry. Neither affects scrolling, both are donated third-party services,
 * and letting CI hammer them would be rude as well as flaky. Leaflet renders a
 * grey tile grid and the app falls back to straight dashed lines — which is
 * exactly the degraded path the unit suite already covers.
 */
export async function blockExternalRequests(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    const local =
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.protocol === "data:" ||
      url.protocol === "blob:";
    return local ? route.continue() : route.abort();
  });
}

/** How far the document can scroll, and where it currently is. */
export async function scrollMetrics(page: Page): Promise<{
  scrollY: number;
  maxScroll: number;
  innerHeight: number;
}> {
  return page.evaluate(() => ({
    scrollY: window.scrollY,
    maxScroll: Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    ),
    innerHeight: window.innerHeight,
  }));
}

/**
 * A viewport point inside the map that hits bare map, not a marker, a route
 * line, a Leaflet control or the add-mode hint pill.
 *
 * Candidates are generated over the visible part of the map and sorted by
 * distance from its centre, then `elementFromPoint` decides: the first point
 * whose top-most element belongs to the map canvas and to nothing clickable
 * wins. Hard-coding "25% in from the left" would quietly start landing on a
 * marker the day the starter tour changes.
 */
export async function findEmptyMapPoint(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
): Promise<Point> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("No viewport: this spec needs one.");

  // Clip the map box to what is actually on screen, then inset: Leaflet's
  // zoom control sits top-left and the attribution bottom-right.
  const inset = 56;
  const left = Math.max(box.x, 0) + inset;
  const right = Math.min(box.x + box.width, viewport.width) - inset;
  const top = Math.max(box.y, 0) + inset;
  const bottom = Math.min(box.y + box.height, viewport.height) - inset;
  if (right <= left || bottom <= top) {
    throw new Error(
      `The map is not visibly on screen (clipped box ${left},${top} → ${right},${bottom}).`,
    );
  }

  const steps = 6;
  const centre = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const candidates: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      candidates.push({
        x: left + ((right - left) * i) / steps,
        y: top + ((bottom - top) * j) / steps,
      });
    }
  }
  candidates.sort(
    (a, b) =>
      (a.x - centre.x) ** 2 +
      (a.y - centre.y) ** 2 -
      ((b.x - centre.x) ** 2 + (b.y - centre.y) ** 2),
  );

  const found = await page.evaluate((points: Point[]) => {
    const blocked =
      ".leaflet-marker-icon, .leaflet-control-container, .leaflet-popup, .leaflet-interactive, .map-pane__hint";
    for (const point of points) {
      const element = document.elementFromPoint(point.x, point.y);
      if (!element) continue;
      if (element.closest(blocked)) continue;
      if (!element.closest(".map-pane__canvas")) continue;
      return point;
    }
    return null;
  }, candidates);

  if (!found) {
    throw new Error(
      "Could not find an empty spot on the visible map to click; every candidate hit a marker, a route line or a control.",
    );
  }
  return found;
}
