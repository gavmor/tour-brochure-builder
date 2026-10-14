/**
 * The editor shell: tour metadata, the map, and the sidebar.
 *
 * The brochure card (t_b8114d95) owns the view switch, share/print chrome and
 * the printed legend; this file deliberately stops at the editing surface so
 * the two do not fight over `App.tsx`.
 */

import { useEffect } from "preact/hooks";
import { editCopyFlow, showBrochure } from "../appState";
import {
  lastLoadNotice,
  readOnly,
  setTourMeta,
  stopCount,
  tour,
} from "../tour";
import { Itinerary } from "./Itinerary";
import { MapEditor } from "./MapEditor";
import { RoutePanel } from "./RoutePanel";
import { StopPanel } from "./StopPanel";
import { addMode, requestFit, shapeMode } from "./uiState";
import "./editor.css";

export function Editor() {
  const current = tour.value;
  const locked = readOnly.value;
  const armed = addMode.value;
  const notice = lastLoadNotice.value;

  // Escape is the universal "stop what you are doing" key; without it, armed
  // add-mode is a trap for anyone who reached it by keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (addMode.peek()) addMode.value = false;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A read-only share link has nothing to arm.
  useEffect(() => {
    if (locked) {
      addMode.value = false;
      shapeMode.value = false;
    }
  }, [locked]);

  return (
    <div class="editor">
      <header class="editor__header">
        <div class="editor__meta">
          <input
            class="editor__title"
            type="text"
            value={current.title}
            disabled={locked}
            aria-label="Tour title"
            placeholder="Tour title"
            onInput={(e) =>
              setTourMeta({ title: (e.target as HTMLInputElement).value })
            }
          />
          <div class="editor__meta-row">
            <input
              type="text"
              value={current.subtitle ?? ""}
              disabled={locked}
              aria-label="Subtitle"
              placeholder="Subtitle (e.g. Chicago)"
              onInput={(e) => {
                const value = (e.target as HTMLInputElement).value;
                setTourMeta({ subtitle: value === "" ? undefined : value });
              }}
            />
            <input
              type="text"
              value={current.tagline ?? ""}
              disabled={locked}
              aria-label="Tagline"
              placeholder="Tagline (e.g. Hop on and hop off!)"
              onInput={(e) => {
                const value = (e.target as HTMLInputElement).value;
                setTourMeta({ tagline: value === "" ? undefined : value });
              }}
            />
          </div>
        </div>

        <div class="editor__tools">
          <button
            type="button"
            class={`primary${armed ? " primary--on" : ""}`}
            disabled={locked}
            aria-pressed={armed}
            onClick={() => {
              addMode.value = !addMode.value;
            }}
          >
            {armed ? "Click the map… (Esc)" : "+ Add stop"}
          </button>
          <button
            type="button"
            onClick={requestFit}
            disabled={stopCount.value === 0}
            title="Zoom the map to fit every stop"
          >
            Fit to stops
          </button>
          {/* The view switch (SPEC §3). The brochure owns Print, Copy share
              link and the printed legend; this is the way in. */}
          <button
            type="button"
            onClick={showBrochure}
            title="See the printable brochure for this tour"
          >
            Brochure →
          </button>
        </div>
      </header>

      {locked ? (
        <div class="editor__banner" role="status">
          <span>
            You are viewing a shared tour. Editing is disabled so your own
            working tour is not overwritten.
          </span>
          <button
            type="button"
            onClick={() => editCopyFlow({ titleSuffix: " (copy)" })}
          >
            Edit a copy
          </button>
        </div>
      ) : null}

      {notice && notice.errors.length > 0 ? (
        <div class="editor__banner editor__banner--error" role="alert">
          <span>Could not load that tour: {notice.errors.join(" ")}</span>
        </div>
      ) : null}

      <div class="editor__body">
        <MapEditor />
        <aside class="editor__sidebar">
          <RoutePanel />
          <Itinerary />
          <StopPanel />
        </aside>
      </div>
    </div>
  );
}
