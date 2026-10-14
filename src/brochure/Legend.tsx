/**
 * The legend box: the key to the route colors, lower-left of the map panel in
 * the reference brochure.
 *
 * On screen it doubles as the route visibility toggle (SPEC §3) and reuses the
 * editor's `hiddenRouteIds` rather than inventing a second source of truth. In
 * print it is a static key — and the print always draws every route, because a
 * brochure that silently omitted a route the author had toggled off on screen
 * would be a quietly wrong artifact.
 */

import { safeColor } from "../editor/markers";
import { hiddenRouteIds, toggleRouteVisible } from "../editor/uiState";
import { tour } from "../tour";
import { legendRoutes } from "./content";

export function Legend() {
  const routes = legendRoutes(tour.value);
  const hidden = hiddenRouteIds.value;
  if (routes.length === 0) return null;

  return (
    <div class="bro-legend">
      <ul class="bro-legend__list">
        {routes.map((route) => {
          const off = hidden.includes(route.id);
          const stops = route.stops.length;
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
                  class="bro-legend__dot"
                  style={`background:${safeColor(route.color)}`}
                  aria-hidden="true"
                />
                <span class="bro-legend__name">{route.name}</span>
                {stops === 0 ? (
                  <span class="bro-legend__meta">key only</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p class="bro-legend__note no-print">
        Clicking a route hides it on this screen only — every route is printed.
      </p>
    </div>
  );
}
