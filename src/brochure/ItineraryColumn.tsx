/**
 * Panel 3 of the brochure: the itinerary column, plus its spill-over sheet.
 *
 * Ribbon banner with the tour title, the tagline under it, then one section
 * per route — route name in the route's color, then rows of
 * `number badge + STOP NAME + one grey line of blurb` (SPEC §2, D6). The
 * badge is the shared `.stop-badge`, so the map marker, the row and the detail
 * card read as one system.
 *
 * Rows are buttons on screen (clicking one selects the stop and pans the map,
 * SPEC §3) and print as plain text — a brochure should not look like a form.
 *
 * A tour with more entries than the 7.8in column holds does not lose them:
 * `spillFromIndex` (measured while staging the print) moves the tail to
 * `ItinerarySpill`, which prints ahead of the detail cards (SPEC §5 item 6).
 */

import { useEffect, useRef } from "preact/hooks";
import { safeColor } from "../editor/markers";
import {
  type Route,
  type Stop,
  selectedStopId,
  stopBlurb,
  tour,
} from "../tour";
import { itinerarySections } from "./content";
import { spillFromIndex } from "./spill";

interface RowProps {
  route: Route;
  stop: Stop;
  /** 1-based index within the route — the number on the map marker. */
  index: number;
  /** Position across the whole itinerary, used to decide what spills. */
  flatIndex: number;
  spilled: boolean;
  selected: boolean;
}

function StopRow({ route, stop, index, spilled, selected }: RowProps) {
  const blurb = stopBlurb(stop);
  return (
    <li
      class={
        spilled ? "bro-route__stop bro-route__stop--spilled" : "bro-route__stop"
      }
    >
      <button
        type="button"
        data-stop-id={stop.id}
        class={`bro-row${selected ? " bro-row--selected" : ""}`}
        aria-current={selected ? "true" : undefined}
        onClick={() => {
          selectedStopId.value = stop.id;
        }}
      >
        <span
          class="stop-badge"
          style={`background:${safeColor(route.color)}`}
          aria-hidden="true"
        >
          {index}
        </span>
        <span class="bro-row__text">
          <span class="bro-row__title">
            <span class="visually-hidden">Stop {index}: </span>
            {stop.title}
          </span>
          {blurb ? <span class="bro-row__blurb">{blurb}</span> : null}
        </span>
      </button>
    </li>
  );
}

export function ItineraryColumn() {
  const current = tour.value;
  const selected = selectedStopId.value;
  const spill = spillFromIndex.value;
  const sections = itinerarySections(current);
  const listRef = useRef<HTMLElement>(null);

  // When the selection came from the map, bring its row into view. `nearest`
  // keeps the column still if the row is already visible, so clicking a row
  // never makes the page jump under the pointer.
  //
  // The row is found by scanning rather than by building a selector: stop ids
  // come from imported tours, so they are untrusted strings and need not be
  // valid CSS identifiers.
  useEffect(() => {
    if (!selected) return;
    const rows =
      listRef.current?.querySelectorAll<HTMLElement>("[data-stop-id]");
    if (!rows) return;
    for (const row of Array.from(rows)) {
      if (row.dataset.stopId !== selected) continue;
      row.scrollIntoView({ block: "nearest" });
      return;
    }
  }, [selected]);

  const spilled = (flatIndex: number) => spill !== null && flatIndex >= spill;

  return (
    <aside class="bro-itinerary" ref={listRef}>
      <div class="bro-ribbon">
        <h1 class="bro-ribbon__title">{current.title}</h1>
      </div>

      {current.subtitle ? (
        <p class="bro-itinerary__subtitle">{current.subtitle}</p>
      ) : null}
      {current.tagline ? (
        <p class="bro-itinerary__tagline">{current.tagline}</p>
      ) : null}
      {current.description ? (
        <p class="bro-itinerary__intro">{current.description}</p>
      ) : null}

      {sections.length === 0 ? (
        <p class="bro-itinerary__empty">
          This tour has no stops yet. Add some in the editor and they will
          appear here.
        </p>
      ) : null}

      {sections.map((section) => {
        // A route whose every row spilled would otherwise print a bare heading.
        const allSpilled = section.rows.every((row) => spilled(row.flatIndex));
        return (
          <section
            class={allSpilled ? "bro-route bro-route--spilled" : "bro-route"}
            key={section.route.id}
          >
            <h2
              class="bro-route__name"
              style={`color:${safeColor(section.route.color)}`}
            >
              {section.route.name}
            </h2>
            <ol class="bro-route__stops">
              {section.rows.map((row) => (
                <StopRow
                  key={row.stop.id}
                  route={section.route}
                  stop={row.stop}
                  index={row.index}
                  flatIndex={row.flatIndex}
                  spilled={spilled(row.flatIndex)}
                  selected={row.stop.id === selected}
                />
              ))}
            </ol>
          </section>
        );
      })}

      {spill !== null ? (
        <p class="bro-itinerary__continued">Itinerary continues overleaf →</p>
      ) : null}
    </aside>
  );
}

/**
 * The spilled tail of the itinerary, printed on its own sheet before the
 * detail cards. Renders nothing until a print measurement says the column
 * overflowed, and is hidden on screen (the column simply scrolls there).
 */
export function ItinerarySpill() {
  const current = tour.value;
  const spill = spillFromIndex.value;
  if (spill === null) return null;

  const sections = itinerarySections(current)
    .map((section) => ({
      route: section.route,
      rows: section.rows.filter((row) => row.flatIndex >= spill),
    }))
    .filter((section) => section.rows.length > 0);
  if (sections.length === 0) return null;

  return (
    <section class="bro-spill" aria-hidden="true">
      <h2 class="bro-cards__heading">{current.title} — itinerary continued</h2>
      {sections.map((section) => (
        <section class="bro-route" key={section.route.id}>
          <h2
            class="bro-route__name"
            style={`color:${safeColor(section.route.color)}`}
          >
            {section.route.name}
          </h2>
          <ol class="bro-route__stops">
            {section.rows.map((row) => (
              <StopRow
                key={row.stop.id}
                route={section.route}
                stop={row.stop}
                index={row.index}
                flatIndex={row.flatIndex}
                spilled={false}
                selected={false}
              />
            ))}
          </ol>
        </section>
      ))}
    </section>
  );
}
