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
  DEFAULT_ROUTE_PROFILE,
  deleteRoute,
  ROUTE_COLORS,
  ROUTE_PROFILES,
  type RouteProfile,
  readOnly,
  tour,
  updateRoute,
} from "../tour";
import { safeColor } from "./markers";
import { approximateReason, geometryFor, profileOf } from "./routeGeometry";
import { shapeMode } from "./uiState";

/** The selector's wording. The *stored* names are ADR 0001's (`driving`). */
const PROFILE_LABELS: Record<RouteProfile, string> = {
  foot: "Walk",
  bike: "Bike",
  driving: "Car",
};

export function RoutePanel() {
  const current = tour.value;
  const active = activeRoute.value;
  const locked = readOnly.value;
  const shaping = shapeMode.value;

  if (!active) return null;
  const color = safeColor(active.color);
  const profile = profileOf(active);
  const geometry = geometryFor(active.id);
  const routable = active.stops.length >= 2;

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

      <div class="field-row">
        <label class="field field--profile">
          <span class="field__label">
            Travel mode <em>how this route follows the streets</em>
          </span>
          <select
            value={profile}
            disabled={locked}
            onChange={(e) => {
              const next = (e.target as HTMLSelectElement)
                .value as RouteProfile;
              // The default is stored as *absence* (ADR 0001): writing
              // `"profile":"foot"` into every route is share-URL budget for
              // no information, and `updateRoute` deletes an undefined key.
              updateRoute(active.id, {
                profile: next === DEFAULT_ROUTE_PROFILE ? undefined : next,
              });
            }}
          >
            {ROUTE_PROFILES.map((option) => (
              <option key={option} value={option}>
                {PROFILE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p
        class={`route-status${geometry.approximate ? " route-status--approximate" : ""}`}
        role="status"
      >
        {routingStatus}
      </p>

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
