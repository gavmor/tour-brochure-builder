/**
 * The continuation pages: one card per stop that has a description or an
 * image (SPEC §2). The reference brochure's itinerary entries are one-liners,
 * so the project's richer per-stop content lives here rather than crushing the
 * itinerary column — three balanced print columns, `break-inside: avoid`, so a
 * card is never split across a page.
 *
 * Images are hotlinked author input (SPEC D3): lazy by default, eager while a
 * print is being staged, `no-referrer` so referrer-blocking hosts still serve
 * them, inside a fixed 16:9 box so the column does not reflow as they arrive,
 * and collapsed entirely when the URL is dead.
 */

import { useState } from "preact/hooks";
import { safeColor } from "../editor/markers";
import { type Stop, selectedStopId, tour } from "../tour";
import { detailEntries, printableImageUrl, type StopEntry } from "./content";
import { printPrep } from "./printing";

function StopCard({ route, stop, index }: StopEntry) {
  const [broken, setBroken] = useState(false);
  const staging = printPrep.value;
  const selected = selectedStopId.value === stop.id;
  const imageUrl = printableImageUrl(stop);
  const color = safeColor(route.color);

  return (
    <article
      class={`bro-card${selected ? " bro-card--selected" : ""}`}
      data-stop-id={stop.id}
    >
      <header class="bro-card__header">
        <span
          class="stop-badge"
          style={`background:${color}`}
          aria-hidden="true"
        >
          {index}
        </span>
        <h3 class="bro-card__title">{stop.title}</h3>
        <span class="bro-card__route" style={`color:${color}`}>
          {route.name}
        </span>
      </header>

      {imageUrl && !broken ? (
        <figure class="bro-card__figure">
          <img
            class="bro-card__image"
            src={imageUrl}
            alt={`${stop.title}`}
            // Lazy on screen; eager while staging a print, or the cards below
            // the fold would print as empty frames.
            loading={staging ? "eager" : "lazy"}
            decoding="async"
            referrerpolicy="no-referrer"
            onError={() => setBroken(true)}
          />
        </figure>
      ) : null}

      {stop.description ? (
        <p class="bro-card__description">{stop.description}</p>
      ) : null}
    </article>
  );
}

/** Screen reader + print header for the continuation pages. */
function cardsHeading(title: string, count: number): string {
  return `${title} — stop details (${count})`;
}

export function StopCards() {
  const current = tour.value;
  const entries = detailEntries(current);
  if (entries.length === 0) return null;

  return (
    <section class="bro-cards" aria-label="Stop details">
      <h2 class="bro-cards__heading">
        {cardsHeading(current.title, entries.length)}
      </h2>
      <div class="bro-cards__grid">
        {entries.map((entry) => (
          <StopCard
            key={entry.stop.id}
            route={entry.route}
            stop={entry.stop as Stop}
            index={entry.index}
          />
        ))}
      </div>
    </section>
  );
}
