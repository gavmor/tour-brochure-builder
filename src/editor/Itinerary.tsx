/**
 * The itinerary sidebar: one section per route, each a drag-reorderable list.
 *
 * SortableJS owns the DOM while a drag is in flight, which Preact's virtual DOM
 * will not tolerate — so on drop we put the node back exactly where it started
 * and let the store action re-render the new order. The store stays the single
 * source of truth and the vdom never diffs against DOM it did not write.
 */

import { useEffect, useRef } from "preact/hooks";
import Sortable from "sortablejs";
import {
  activeRoute,
  activeRouteId,
  categoryMeta,
  deleteStop,
  moveStopToRoute,
  type Route,
  readOnly,
  reorderStops,
  selectedStopId,
  stopBlurb,
  stopCategory,
  tour,
} from "../tour";
import { safeColor } from "./markers";
import { hiddenRouteIds, toggleRouteVisible } from "./uiState";

/** Undo SortableJS's DOM mutation so Preact's tree stays authoritative. */
function revertDomMove(event: Sortable.SortableEvent): void {
  const { item, from, oldIndex } = event;
  item.remove();
  const anchor = from.children[oldIndex ?? from.children.length] ?? null;
  from.insertBefore(item, anchor);
}

export function Itinerary() {
  const current = tour.value;
  const total = current.routes.reduce((n, r) => n + r.stops.length, 0);

  return (
    <section class="itinerary" aria-label="Itinerary">
      <h2 class="sidebar__heading">
        Itinerary <span class="sidebar__count">{total} stops</span>
      </h2>
      {current.routes.map((route) => (
        <RouteSection key={route.id} route={route} />
      ))}
    </section>
  );
}

function RouteSection({ route }: { route: Route }) {
  const listRef = useRef<HTMLOListElement>(null);
  const locked = readOnly.value;
  const selected = selectedStopId.value;
  const isActive = activeRoute.value?.id === route.id;
  const hidden = hiddenRouteIds.value.includes(route.id);
  const color = safeColor(route.color);

  useEffect(() => {
    const list = listRef.current;
    if (!list || locked) return;
    const sortable = Sortable.create(list, {
      // One shared group, so a stop can also be dragged into another route.
      group: "tour-stops",
      handle: ".itinerary-row__grip",
      draggable: ".itinerary-row",
      animation: 150,
      ghostClass: "itinerary-row--ghost",
      chosenClass: "itinerary-row--chosen",
      onEnd: (event) => {
        revertDomMove(event);
        const stopId = event.item.dataset.stopId;
        const from = event.oldIndex ?? -1;
        const to = event.newIndex ?? -1;
        const fromRoute = (event.from as HTMLElement).dataset.routeId;
        const toRoute = (event.to as HTMLElement).dataset.routeId;
        if (!stopId || from < 0 || to < 0 || !fromRoute || !toRoute) return;
        if (fromRoute === toRoute) reorderStops(from, to, fromRoute);
        else moveStopToRoute(stopId, toRoute, to);
      },
    });
    return () => sortable.destroy();
  }, [locked]);

  // Clicking a marker selects a stop; bring its row into view (SPEC §3).
  useEffect(() => {
    if (!selected) return;
    const row = listRef.current?.querySelector(`[data-stop-id="${selected}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <article
      class={`route-section${isActive ? " route-section--active" : ""}`}
      style={{ "--route-color": color }}
    >
      <header class="route-section__header">
        <button
          type="button"
          class="route-section__select"
          onClick={() => {
            activeRouteId.value = route.id;
          }}
          aria-pressed={isActive}
          title={isActive ? "Editing this route" : "Edit this route"}
        >
          <span class="route-dot" style={{ background: color }} />
          <span class="route-section__name">{route.name}</span>
          <span class="sidebar__count">{route.stops.length}</span>
        </button>
        <label class="route-section__visibility">
          <input
            type="checkbox"
            checked={!hidden}
            onChange={() => toggleRouteVisible(route.id)}
          />
          <span>Show</span>
        </label>
      </header>

      <ol class="itinerary-list" ref={listRef} data-route-id={route.id}>
        {route.stops.map((stop, index) => {
          const isSelected = stop.id === selected;
          return (
            <li
              key={stop.id}
              data-stop-id={stop.id}
              class={`itinerary-row${isSelected ? " itinerary-row--selected" : ""}`}
            >
              <span
                class="itinerary-row__grip"
                aria-hidden="true"
                title="Drag to reorder"
              >
                ⠿
              </span>
              <button
                type="button"
                class="itinerary-row__main"
                aria-current={isSelected ? "true" : undefined}
                onClick={() => {
                  activeRouteId.value = route.id;
                  selectedStopId.value = stop.id;
                }}
              >
                <span class="stop-badge" style={{ background: color }}>
                  {index + 1}
                </span>
                <span class="itinerary-row__text">
                  <span class="itinerary-row__title">
                    <span
                      class="itinerary-row__category-icon"
                      aria-hidden="true"
                    >
                      {categoryMeta(stopCategory(stop)).icon}
                    </span>
                    {stop.title}
                  </span>
                  <span class="itinerary-row__blurb">{stopBlurb(stop)}</span>
                </span>
              </button>
              <span class="itinerary-row__actions">
                <button
                  type="button"
                  disabled={locked || index === 0}
                  aria-label={`Move ${stop.title} up`}
                  title="Move up"
                  onClick={() => reorderStops(index, index - 1, route.id)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={locked || index === route.stops.length - 1}
                  aria-label={`Move ${stop.title} down`}
                  title="Move down"
                  onClick={() => reorderStops(index, index + 1, route.id)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="danger"
                  disabled={locked}
                  aria-label={`Delete ${stop.title}`}
                  title="Delete stop"
                  onClick={() => deleteStop(stop.id)}
                >
                  ✕
                </button>
              </span>
            </li>
          );
        })}
      </ol>

      {route.stops.length === 0 ? (
        <p class="itinerary-empty">
          No stops yet — press <strong>Add stop</strong>, then click the map.
        </p>
      ) : null}
    </article>
  );
}
