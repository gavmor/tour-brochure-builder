/**
 * "Add sites near a location" — the dialog.
 *
 * The choice-first shape of this flow (epic t_f3a98cf7, part 1): the user
 * names a place or drops a pin, the app proposes up to ten notable sites
 * **already selected**, and the user unchecks the ones they do not want. Every
 * accepted proposal goes through the store's ordinary `addStop()`, so it is a
 * real, fully editable stop the moment it lands — no "seeded" state, nothing
 * locked, nothing to undo but the stop itself.
 *
 * Nothing here is a dead end:
 * - the request can be cancelled, and times out on its own (one shared
 *   deadline for geocode + Overpass, see `poi/net.ts`);
 * - any failure — offline, rate-limited, no match, nothing found — swaps in
 *   the curated fallback list with the reason shown, instead of an empty box;
 * - closing the dialog adds nothing.
 *
 * The OSM attribution below the results is a licence term, not decoration.
 */

import { useEffect, useId, useRef, useState } from "preact/hooks";
import {
  bboxFromCenter,
  bboxRadiusMeters,
  type Candidate,
  CURATED_SET_LABEL,
  candidateToStopInit,
  categoryLabel,
  curatedFor,
  DEFAULTS,
  describeError,
  forgetOutage,
  formatDistance,
  isCancellation,
  isSameSite,
  type PoiService,
  poiService,
} from "../poi";
import { activeRouteId, addStop, eachStop, readOnly, tour } from "../tour";
import {
  closeNearby,
  nearbyCenter,
  nearbyOpen,
  nearbyPinMode,
  nearbyProposals,
  requestFit,
} from "./uiState";

type Phase = "idle" | "searching" | "proposed";

interface Status {
  text: string;
  tone: "info" | "ok" | "warn";
}

export interface NearbyPanelProps {
  /** Injectable for tests; defaults to the real Overpass/Nominatim client. */
  service?: PoiService;
}

export function NearbyPanel({ service = poiService }: NearbyPanelProps = {}) {
  const open = nearbyOpen.value;
  const picking = nearbyPinMode.value;
  const centre = nearbyCenter.value;
  const locked = readOnly.value;

  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [fallback, setFallback] = useState(false);
  const [status, setStatus] = useState<Status>({
    text: "Name a place and press Search, or drop a pin on the map.",
    tone: "info",
  });

  const controllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * The centre this component set itself (after geocoding a place name), as
   * opposed to one the user dropped on the map. Without this the pin effect
   * below would fire a second search that cancels the first one.
   */
  const ownCentreRef = useRef<{ lat: number; lng: number } | null>(null);
  const listId = useId();

  // Mounting *is* the reset: the editor renders this component only while the
  // dialog is open (see Editor.tsx), so every open starts from the `useState`
  // defaults above. Resetting in an effect instead would race the user — on a
  // slow first frame the effect lands after their first click and wipes it.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Abandon an in-flight request if the dialog goes away under it.
  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  // Escape closes, like every other dismissible layer in the editor.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      cancel();
      closeNearby();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // A pin dropped on the map is itself the "go" gesture.
  useEffect(() => {
    if (!open || !centre) return;
    // Ignore the centre we set ourselves after geocoding a place name: that
    // search is already in flight, and restarting it would cancel it.
    const own = ownCentreRef.current;
    if (own && own.lat === centre.lat && own.lng === centre.lng) return;
    void search({
      bbox: bboxFromCenter(centre.lat, centre.lng),
      cacheQuery: `pin:${centre.lat.toFixed(4)},${centre.lng.toFixed(4)}`,
      label: "the dropped pin",
    });
    // `centre` identity changes only when a new centre is chosen.
  }, [centre]);

  // Mirror the checklist onto the map, so "which sites?" has a visual answer
  // as well as a textual one (choice-first UX §2). Cleared on unmount, so
  // closing the dialog takes the provisional markers with it.
  useEffect(() => {
    nearbyProposals.value =
      phase === "proposed"
        ? candidates.map((c) => ({
            id: c.osmId,
            lat: c.lat,
            lng: c.lng,
            title: c.title,
            chosen: chosen.has(c.osmId),
          }))
        : [];
  }, [phase, candidates, chosen]);

  useEffect(() => {
    return () => {
      nearbyProposals.value = [];
    };
  }, []);

  if (!open) return null;

  function cancel(): void {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }

  /**
   * Is this proposal already a stop in the tour? Same rule the ranking uses
   * (`isSameSite`), so the list and the tour cannot disagree about what counts
   * as the same site — in particular, a neighbour 40 m away with an unrelated
   * name is *not* "Already added".
   */
  function alreadyInTour(candidate: Candidate): boolean {
    return eachStop(tour.value).some(({ stop }) => isSameSite(stop, candidate));
  }

  /** Offer the curated set instead of leaving the user with nothing. */
  function offerCurated(reason: string): void {
    const list = curatedFor(query);
    const fresh = list.filter((c) => !alreadyInTour(c));
    setCandidates(list);
    setChosen(new Set(fresh.map((c) => c.osmId)));
    setFallback(true);
    setPhase("proposed");
    setStatus({
      text:
        `${reason} Showing ${CURATED_SET_LABEL} instead` +
        (fresh.length === 0
          ? " — every one is already in your tour."
          : " — keep the ones you want."),
      tone: "warn",
    });
  }

  function propose(list: Candidate[], cached: boolean, hidden: number): void {
    const fresh = list.filter((c) => !alreadyInTour(c));
    const duplicates = list.length - fresh.length;
    setCandidates(list);
    // Pre-select everything the tour does not already have. Proposing a stop
    // the user already placed, ticked, is how you get accidental duplicates.
    setChosen(new Set(fresh.map((c) => c.osmId)));
    setFallback(false);
    setPhase("proposed");
    // "all pre-selected — uncheck any you don't want" is nonsense when nothing
    // was pre-selected, so that sentence only exists when there is something
    // to uncheck.
    const headline =
      fresh.length === 0
        ? `Every site found here (${list.length}) is already in your tour — tick one to add it again.`
        : `${fresh.length} site${fresh.length === 1 ? "" : "s"} proposed, all pre-selected — ` +
          `uncheck any you don't want.` +
          (duplicates > 0
            ? ` ${duplicates} already in your tour ${duplicates === 1 ? "is" : "are"} listed unticked.`
            : "");
    setStatus({
      text:
        headline +
        // Never drop results silently: say how many near-identical entries
        // were folded into the ones on screen.
        (hidden > 0
          ? ` ${hidden} nearby duplicate${hidden === 1 ? "" : "s"} hidden.`
          : "") +
        (cached ? " (from this session's cache)" : ""),
      tone: fresh.length === 0 ? "warn" : "ok",
    });
  }

  async function search(request: {
    bbox: { south: number; west: number; north: number; east: number };
    cacheQuery: string;
    label: string;
  }): Promise<void> {
    cancel();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase("searching");
    setFallback(false);
    setStatus({
      text: `Looking for notable sites near ${request.label}…`,
      tone: "info",
    });

    try {
      const result = await service.findPois(request.bbox, {
        signal: controller.signal,
        cacheQuery: request.cacheQuery,
        deadlineAt: Date.now() + DEFAULTS.proposalDeadlineMs,
      });
      if (controller.signal.aborted) return;
      if (result.candidates.length === 0) {
        offerCurated(
          `No notable sites are mapped within ${formatDistance(
            bboxRadiusMeters(request.bbox),
          )} of ${request.label}.`,
        );
        return;
      }
      propose(result.candidates, result.cached, result.hidden);
    } catch (error) {
      if (isCancellation(error) || controller.signal.aborted) {
        setPhase("idle");
        setStatus({ text: "Search cancelled.", tone: "warn" });
        return;
      }
      offerCurated(`Could not reach OpenStreetMap (${describeError(error)}).`);
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  async function searchByName(): Promise<void> {
    const place = query.trim();
    if (!place) {
      setStatus({ text: "Type a place name first.", tone: "warn" });
      inputRef.current?.focus();
      return;
    }
    cancel();
    const controller = new AbortController();
    controllerRef.current = controller;
    const deadlineAt = Date.now() + DEFAULTS.proposalDeadlineMs;
    setPhase("searching");
    setFallback(false);
    setStatus({ text: `Finding "${place}"…`, tone: "info" });

    let found: Awaited<ReturnType<PoiService["geocode"]>>;
    try {
      found = await service.geocode(place, {
        signal: controller.signal,
        deadlineAt,
      });
    } catch (error) {
      if (isCancellation(error) || controller.signal.aborted) {
        setPhase("idle");
        setStatus({ text: "Search cancelled.", tone: "warn" });
        return;
      }
      offerCurated(`Could not find "${place}" (${describeError(error)}).`);
      return;
    }
    if (controller.signal.aborted) return;

    nearbyCenter.value = { lat: found.lat, lng: found.lng };
    ownCentreRef.current = { lat: found.lat, lng: found.lng };
    // The pin effect skips this centre (see `ownCentreRef`); search here with
    // the real bbox Nominatim gave us, which beats a radius around the point.
    const poiController = new AbortController();
    controllerRef.current = poiController;
    setStatus({
      text: `Found ${found.displayName || place}. Looking for notable sites…`,
      tone: "info",
    });
    try {
      const result = await service.findPois(found.bbox, {
        signal: poiController.signal,
        cacheQuery: place,
        deadlineAt,
      });
      if (poiController.signal.aborted) return;
      if (result.candidates.length === 0) {
        offerCurated(
          `No notable sites are mapped within ${formatDistance(
            bboxRadiusMeters(found.bbox),
          )} of ${place}.`,
        );
        return;
      }
      propose(result.candidates, result.cached, result.hidden);
    } catch (error) {
      if (isCancellation(error) || poiController.signal.aborted) {
        setPhase("idle");
        setStatus({ text: "Search cancelled.", tone: "warn" });
        return;
      }
      offerCurated(`Could not reach OpenStreetMap (${describeError(error)}).`);
    } finally {
      if (controllerRef.current === poiController) controllerRef.current = null;
    }
  }

  function toggle(osmId: string): void {
    const next = new Set(chosen);
    if (next.has(osmId)) next.delete(osmId);
    else next.add(osmId);
    setChosen(next);
  }

  function setAll(on: boolean): void {
    setChosen(on ? new Set(candidates.map((c) => c.osmId)) : new Set());
  }

  /** The one write this dialog performs, through the ordinary store action. */
  function addChosen(): void {
    const routeId = activeRouteId.value ?? undefined;
    let added = 0;
    for (const candidate of candidates) {
      if (!chosen.has(candidate.osmId)) continue;
      if (addStop(candidateToStopInit(candidate), routeId)) added += 1;
    }
    closeNearby();
    if (added > 0) requestFit();
  }

  const selectedCount = candidates.filter((c) => chosen.has(c.osmId)).length;

  return (
    <div
      class="nearby"
      role="dialog"
      aria-modal="false"
      aria-label="Add sites near a location"
    >
      <header class="nearby__header">
        <h2 class="nearby__title">Add sites near a location</h2>
        <button
          type="button"
          class="nearby__close"
          aria-label="Close"
          onClick={() => {
            cancel();
            closeNearby();
          }}
        >
          ✕
        </button>
      </header>

      <div class="nearby__search">
        <input
          ref={inputRef}
          type="text"
          class="nearby__input"
          value={query}
          placeholder="Chicago, Lisbon, Kyoto…"
          aria-label="Place to search near"
          disabled={locked}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void searchByName();
            }
          }}
        />
        <button
          type="button"
          class="primary"
          disabled={locked || phase === "searching"}
          onClick={() => void searchByName()}
        >
          Search
        </button>
        <button
          type="button"
          class={picking ? "primary primary--on" : ""}
          aria-pressed={picking}
          disabled={locked || phase === "searching"}
          title="Click the map to choose the centre of the search"
          onClick={() => {
            nearbyPinMode.value = !nearbyPinMode.value;
          }}
        >
          {picking ? "Click the map…" : "Drop a pin"}
        </button>
      </div>

      <p class={`nearby__status nearby__status--${status.tone}`} role="status">
        {status.text}
      </p>

      {phase === "searching" ? (
        <div class="nearby__loading">
          <span class="nearby__spinner" aria-hidden="true" />
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        </div>
      ) : null}

      {phase === "proposed" && candidates.length > 0 ? (
        <>
          <div class="nearby__bulk">
            <button
              type="button"
              class="link-button"
              onClick={() => setAll(true)}
            >
              Select all
            </button>
            <button
              type="button"
              class="link-button"
              onClick={() => setAll(false)}
            >
              Select none
            </button>
          </div>

          <ul class="nearby__results" id={listId}>
            {candidates.map((candidate) => {
              const on = chosen.has(candidate.osmId);
              const known = alreadyInTour(candidate);
              return (
                <li key={candidate.osmId} class="nearby__result">
                  <label class="nearby__row">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(candidate.osmId)}
                    />
                    <span class="nearby__name">{candidate.title}</span>
                    <span class="nearby__category">
                      {known
                        ? "Already added"
                        : categoryLabel(candidate.category)}
                    </span>
                    {candidate.hasWiki ? (
                      <span
                        class="nearby__wiki"
                        role="img"
                        title="Has a Wikipedia or Wikidata entry"
                        aria-label="Has a Wikipedia or Wikidata entry"
                      >
                        📖
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>

          <div class="nearby__actions">
            <button
              type="button"
              class="primary"
              disabled={locked || selectedCount === 0}
              onClick={addChosen}
            >
              Add {selectedCount} stop{selectedCount === 1 ? "" : "s"}
            </button>
            {fallback ? (
              <button
                type="button"
                class="link-button"
                title="Forget the last failure and query OpenStreetMap again"
                onClick={() => {
                  forgetOutage();
                  void searchByName();
                }}
              >
                Try OpenStreetMap again
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      <p class="nearby__attribution">
        Site data ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMap
        </a>{" "}
        contributors, via Overpass and Nominatim.
      </p>
    </div>
  );
}
