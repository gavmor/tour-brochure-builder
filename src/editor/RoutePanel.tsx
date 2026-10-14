/**
 * Route controls: pick the route being edited, rename it, recolor it, add or
 * delete one, and toggle the shape-point handles.
 *
 * SPEC §5.7 left v1 multi-route editing as a scope call with "ship it" as the
 * recommendation — two routes and a legend are the whole point of the
 * reference brochure, so it ships.
 */

import {
  activeRoute,
  activeRouteId,
  addRoute,
  deleteRoute,
  ROUTE_COLORS,
  readOnly,
  tour,
  updateRoute,
} from "../tour";
import { safeColor } from "./markers";
import { shapeMode } from "./uiState";

export function RoutePanel() {
  const current = tour.value;
  const active = activeRoute.value;
  const locked = readOnly.value;
  const shaping = shapeMode.value;

  if (!active) return null;
  const color = safeColor(active.color);

  return (
    <section class="route-panel" aria-label="Routes">
      <h2 class="sidebar__heading">
        Routes <span class="sidebar__count">{current.routes.length}</span>
        <button
          type="button"
          class="sidebar__action"
          disabled={locked}
          onClick={() => addRoute()}
        >
          + Add route
        </button>
      </h2>

      <div class="field-row">
        <label class="field field--grow">
          <span class="field__label">Name of the route being edited</span>
          <input
            type="text"
            value={active.name}
            disabled={locked}
            onInput={(e) =>
              updateRoute(active.id, {
                name: (e.target as HTMLInputElement).value,
              })
            }
          />
        </label>
        <label class="field field--color">
          <span class="field__label">Color</span>
          <input
            type="color"
            value={color}
            disabled={locked}
            onInput={(e) =>
              updateRoute(active.id, {
                color: (e.target as HTMLInputElement).value,
              })
            }
          />
        </label>
      </div>

      <div class="swatches">
        {ROUTE_COLORS.map((preset) => (
          <button
            key={preset}
            type="button"
            class={`swatch${preset.toLowerCase() === color.toLowerCase() ? " swatch--on" : ""}`}
            style={{ background: preset }}
            disabled={locked}
            aria-label={`Use ${preset}`}
            title={preset}
            onClick={() => updateRoute(active.id, { color: preset })}
          />
        ))}
      </div>

      <div class="route-panel__actions">
        <label class="toggle">
          <input
            type="checkbox"
            checked={shaping}
            disabled={locked}
            onChange={() => {
              shapeMode.value = !shapeMode.value;
            }}
          />
          <span>
            Shape points <em>bend the line without a routing service</em>
          </span>
        </label>
        <button
          type="button"
          class="danger"
          disabled={locked || current.routes.length <= 1}
          title={
            current.routes.length <= 1
              ? "A tour keeps at least one route"
              : `Delete ${active.name} and its stops`
          }
          onClick={() => {
            if (deleteRoute(active.id)) activeRouteId.value = null;
          }}
        >
          Delete route
        </button>
      </div>
    </section>
  );
}
