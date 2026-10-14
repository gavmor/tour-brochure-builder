/**
 * The legend box: the key to the route colors, lower-left of the map panel in
 * the reference brochure.
 *
 * On screen it doubles as the route visibility toggle (SPEC §3) and reuses the
 * editor's `hiddenRouteIds` rather than inventing a second source of truth. In
 * print it is a static key — and the print always draws every route, because a
 * brochure that silently omitted a route the author had toggled off on screen
 * would be a quietly wrong artifact.
 *
 * It is also where a reader learns what a dashed line means. The brochure's
 * polylines are `interactive: false`, so there is no tooltip to hover: an
 * approximate route has to say so in the key, on paper as well as on screen.
 */

import { safeColor } from "../editor/markers";
import { geometryFor } from "../editor/routeGeometry";
import { hiddenRouteIds, toggleRouteVisible } from "../editor/uiState";
import { tour } from "../tour";
import { legendRoutes } from "./content";

export function Legend() {
  const routes = legendRoutes(tour.value);
  const hidden = hiddenRouteIds.value;
  if (routes.length === 0) return null;

  const approximate = new Set(
    routes
      .filter((route) => geometryFor(route.id).approximate)
      .map((r) => r.id),
  );

  return (
    <div class="bro-legend">
      <ul class="bro-legend__list">
        {routes.map((route) => {
          const off = hidden.includes(route.id);
          const stops = route.stops.length;
          const isApproximate = approximate.has(route.id);
          return (
            <li class="bro-legend__item" key={route.id}>
              <button
                type="button"
                class={`bro-legend__button${off ? " bro-legend__button--off" : ""}`}
                aria-pressed={!off}
                title={
                  off
                    ? `Show ${route.name} on the map`
                    : `Hide ${route.name} on the map`
                }
                onClick={() => toggleRouteVisible(route.id)}
              >
                <span
                  class={`bro-legend__dot${isApproximate ? " bro-legend__dot--approximate" : ""}`}
                  style={`background:${safeColor(route.color)}`}
                  aria-hidden="true"
                />
                <span class="bro-legend__name">{route.name}</span>
                {stops === 0 ? (
                  <span class="bro-legend__meta">key only</span>
                ) : null}
                {isApproximate ? (
                  <span class="bro-legend__meta bro-legend__meta--approximate">
                    approximate
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      {approximate.size > 0 ? (
        <p class="bro-legend__note bro-legend__note--approximate">
          Dashed lines are approximate: street routing was unavailable, so those
          routes are drawn straight between stops.
        </p>
      ) : null}
      <p class="bro-legend__note no-print">
        Clicking a route hides it on this screen only — every route is printed.
      </p>
    </div>
  );
}
