/**
 * Route controls: pick the route being edited, rename it, choose its travel
 * profile and color from reversible presets, add or delete one, and toggle the
 * shape-point handles.
 *
 * Choice-first UX (§3a/§3b): the travel profile is a segmented control and the
 * color is a swatch palette — no free-text/hex entry in the primary UI. Both
 * are reversible: the profile defaults to walking and the color has an explicit
 * reset. A "Custom color" disclosure keeps an escape hatch without putting a
 * raw input in the main flow.
 *
 * SPEC §5.7 left v1 multi-route editing as a scope call with "ship it" as the
 * recommendation — two routes and a legend are the whole point of the
 * reference brochure, so it ships.
 */

import {
  activeRoute,
  activeRouteId,
  addRoute,
  COLOR_SWATCHES,
  colorName,
  DEFAULT_ROUTE_COLOR,
  DEFAULT_ROUTE_PROFILE,
  deleteRoute,
  ROUTE_PROFILE_OPTIONS,
  readOnly,
  routeProfile,
  tour,
  updateRoute,
} from "../tour";
import { safeColor } from "./markers";
import { approximateReason, geometryFor } from "./routeGeometry";
import { shapeMode } from "./uiState";

/**
 * Route controls: pick the route being edited, rename it, choose its travel
 * profile and color from reversible presets, add or delete one, and toggle the
 * shape-point handles.
 *
 * Choice-first UX (§3a/§3b): the travel profile is a segmented control and the
 * color is a swatch palette — no free-text/hex entry in the primary UI. Both
 * are reversible: the profile defaults to walking and the color has an explicit
 * reset. A "Custom color" disclosure keeps an escape hatch without putting a
 * raw input in the main flow.
 *
 * SPEC §5.7 left v1 multi-route editing as a scope call with "ship it" as the
 * recommendation — two routes and a legend are the whole point of the
 * reference brochure, so it ships.
 */

export function RoutePanel() {
  const current = tour.value;
  const active = activeRoute.value;
  const locked = readOnly.value;
  const shaping = shapeMode.value;

  if (!active) return null;
  const color = safeColor(active.color);
  const profile = routeProfile(active);
  const geometry = geometryFor(active.id);
  const routable = active.stops.length >= 2;
  const isPreset = COLOR_SWATCHES.some(
    (preset) => preset.toLowerCase() === color.toLowerCase(),
  );
  const isDefaultColor =
    color.toLowerCase() === DEFAULT_ROUTE_COLOR.toLowerCase();

  // What the map is actually drawing for this route, in words — the "Car"
  // button being pressed is not the same claim as "this line follows roads".
  const routingStatus = !routable
    ? "Add a second stop to follow the streets."
    : geometry.pending
      ? "Finding streets…"
      : geometry.approximate
        ? `Approximate — ${approximateReason(geometry.reason)}.`
        : geometry.coords
          ? "Following streets."
          : "Straight line for now.";

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
      </div>

      <fieldset class="field field--group">
        <legend class="field__label">Getting around</legend>
        <div class="segmented">
          {ROUTE_PROFILE_OPTIONS.map((option) => {
            const on = option.id === profile;
            return (
              <button
                key={option.id}
                type="button"
                class={`segmented__option${on ? " segmented__option--on" : ""}`}
                aria-pressed={on}
                disabled={locked}
                title={`${option.label} route`}
                onClick={() =>
                  updateRoute(active.id, {
                    // The default (foot) is stored as absence (§6, ADR 0001).
                    profile:
                      option.id === DEFAULT_ROUTE_PROFILE
                        ? undefined
                        : option.id,
                  })
                }
              >
                <span aria-hidden="true">{option.icon}</span>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
        <p
          class={`route-status${geometry.approximate ? " route-status--approximate" : ""}`}
          role="status"
        >
          {routingStatus}
        </p>
      </fieldset>

      <fieldset class="field field--group">
        <legend class="field__label">Route color</legend>
        <div class="swatches">
          {COLOR_SWATCHES.map((preset) => {
            const on = preset.toLowerCase() === color.toLowerCase();
            const name = colorName(preset);
            return (
              <button
                key={preset}
                type="button"
                class={`swatch${on ? " swatch--on" : ""}`}
                style={{ background: preset }}
                aria-pressed={on}
                disabled={locked}
                // A swatch is a color, not a hex code: a screen reader should
                // say "Use green", not spell out 1E8449 (QA-BUG-8).
                aria-label={`Use ${name}`}
                title={`${name} (${preset})`}
                onClick={() => updateRoute(active.id, { color: preset })}
              >
                {on ? (
                  <span class="swatch__check" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div class="swatches__controls">
          <button
            type="button"
            class="link-button"
            disabled={locked || isDefaultColor}
            title="Reset to the default route color"
            onClick={() =>
              updateRoute(active.id, { color: DEFAULT_ROUTE_COLOR })
            }
          >
            Reset color
          </button>
          <details class="disclosure">
            <summary>Custom color…</summary>
            <label class="field field--color">
              <span class="field__label">
                {isPreset ? "Pick any color" : `Custom: ${color}`}
              </span>
              <input
                type="color"
                value={color}
                disabled={locked}
                aria-label="Custom route color"
                onInput={(e) =>
                  updateRoute(active.id, {
                    color: (e.target as HTMLInputElement).value,
                  })
                }
              />
            </label>
          </details>
        </div>
      </fieldset>

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
            Shape points{" "}
            <em>bend the line by hand; the router treats them as waypoints</em>
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
