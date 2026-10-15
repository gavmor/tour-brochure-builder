/**
 * Playwright acceptance tests (`e2e/`).
 *
 * These are the browser-level guards the unit suite cannot give us: jsdom has
 * no layout, no scrolling and no touch, and the bugs we care about here are
 * exactly about layout, scrolling and touch.
 *
 * Two projects, because the editor behaves differently under each:
 *
 * - `desktop-chromium` — a mouse, and a window narrow enough that the editor's
 *   responsive layout stacks the map above the sidebar and the *document*
 *   scrolls. Above 860px the editor pins itself to `100dvh` and only the
 *   sidebar scrolls, so a page-scroll assertion there is vacuously true.
 *   A narrow desktop window (split screen, half-width browser) is a real
 *   configuration and the one where page scroll is observable with a mouse.
 * - `mobile-chrome` — Pixel 5 with touch emulation, the configuration the
 *   tap-to-add bug was reported on.
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4771);
const HOST = "127.0.0.1";

export default defineConfig({
  testDir: "./e2e",
  // The specs assert on absolute scroll offsets; parallel pages are fine, a
  // retry that hides a real layout regression is not.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://${HOST}:${PORT}/`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 800, height: 720 },
        hasTouch: false,
        isMobile: false,
      },
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"],
        hasTouch: true,
      },
    },
  ],

  webServer: {
    // `VITE_BASE=/` drops the GitHub Pages sub-path so the specs can navigate
    // to "/" instead of hard-coding the repo name.
    command: `pnpm exec vite --host ${HOST} --port ${PORT} --strictPort`,
    url: `http://${HOST}:${PORT}/`,
    env: { VITE_BASE: "/" },
    // Never reuse: several worktrees of this repo run dev/preview servers on
    // neighbouring ports, and reusing a stranger's server silently tests the
    // wrong build. `--strictPort` turns a collision into a loud failure.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
