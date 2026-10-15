/**
 * Global test setup.
 *
 * The map views now ask a routing service for road geometry the moment a tour
 * mounts (`src/editor/routeGeometry.ts`). The default service talks to the
 * public FOSSGIS endpoints over the real `fetch`, which is exactly right in a
 * browser and exactly wrong in a test run: component tests that merely render
 * a map would fire requests at donated community servers, and whether they
 * answered would decide whether the suite was flaky.
 *
 * So every test file starts with a service that cannot reach the network.
 * Tests that care about geometry install their own double with
 * `setRoutingService`; the rest simply never see a request.
 */

import { beforeEach } from "vitest";
import { resetRouteGeometry, setRoutingService } from "../editor/routeGeometry";
import { createRoutingService } from "../routing";

function offlineService() {
  return createRoutingService({
    fetchImpl: () => {
      throw new Error(
        "Unexpected network call in a test. Install a routing double with setRoutingService().",
      );
    },
    storage: null,
    debounceMs: 0,
    minRequestIntervalMs: 0,
  });
}

beforeEach(() => {
  resetRouteGeometry();
  setRoutingService(offlineService());
});
