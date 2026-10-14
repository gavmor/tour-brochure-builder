/**
 * Edit panel for the selected stop.
 *
 * Text fields write straight through to the store on input (it is the only
 * copy of the tour, and autosave is debounced downstream). The image URL is
 * the exception: it is held as a draft until it is a usable `https:` URL, so
 * half-typed addresses never reach the store and never reach the share link.
 */

import { useEffect, useState } from "preact/hooks";
import {
  categoryMeta,
  DEFAULT_STOP_CATEGORY,
  deleteStop,
  findStop,
  isUsableImageUrl,
  moveStop,
  moveStopToRoute,
  readOnly,
  STOP_CATEGORIES,
  selectedStopId,
  stopCategory,
  tour,
  updateStop,
} from "../tour";
import { safeColor } from "./markers";
import { round6 } from "./uiState";

export function StopPanel() {
  const current = tour.value;
  const selected = selectedStopId.value;
  const locked = readOnly.value;
  const found = selected ? findStop(current, selected) : undefined;

  const [imageDraft, setImageDraft] = useState("");
  const [imageBroken, setImageBroken] = useState(false);

  const stopId = found?.stop.id ?? null;
  const storedImage = found?.stop.imageUrl ?? "";

  // Re-seed the draft when the selection changes or the stored value moves
  // underneath us (import, undo of a sort, share-link load).
  useEffect(() => {
    setImageDraft(storedImage);
    setImageBroken(false);
  }, [stopId, storedImage]);

  if (!found) {
    return (
      <section class="stop-panel stop-panel--empty" aria-label="Stop details">
        <p>
          Select a stop — on the map or in the itinerary — to edit its title,
          blurb, description and image.
        </p>
      </section>
    );
  }

  const { stop, route, index } = found;
  const color = safeColor(route.color);
  const category = stopCategory(stop);
  const categoryInfo = categoryMeta(category);
  const trimmedDraft = imageDraft.trim();
  const imageInvalid = trimmedDraft !== "" && !isUsableImageUrl(trimmedDraft);

  const onImageInput = (value: string) => {
    setImageDraft(value);
    setImageBroken(false);
    const next = value.trim();
    if (next === "") updateStop(stop.id, { imageUrl: undefined });
    else if (isUsableImageUrl(next)) updateStop(stop.id, { imageUrl: next });
  };

  const onCoord = (axis: "lat" | "lng", raw: string) => {
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return;
    const lat = axis === "lat" ? value : stop.lat;
    const lng = axis === "lng" ? value : stop.lng;
    moveStop(stop.id, round6(lat), round6(lng));
  };

  return (
    <section class="stop-panel" aria-label={`Editing ${stop.title}`}>
      <header class="stop-panel__header">
        <span class="stop-badge" style={{ background: color }}>
          {index}
        </span>
        <span class="stop-panel__category-icon" aria-hidden="true">
          {categoryInfo.icon}
        </span>
        <h2>{stop.title || "Untitled stop"}</h2>
        <button
          type="button"
          class="danger"
          disabled={locked}
          onClick={() => deleteStop(stop.id)}
        >
          Delete stop
        </button>
      </header>

      <label class="field">
        <span class="field__label">Title</span>
        <input
          type="text"
          value={stop.title}
          disabled={locked}
          onInput={(e) =>
            updateStop(stop.id, { title: (e.target as HTMLInputElement).value })
          }
        />
      </label>

      <div class="field">
        <span class="field__label" id={`stop-category-${stop.id}`}>
          Category <em>sets the icon</em>
        </span>
        <div class="field-row field-row--tight">
          <select
            class="field--grow"
            value={category}
            disabled={locked}
            aria-labelledby={`stop-category-${stop.id}`}
            onChange={(e) => {
              const value = (e.target as HTMLSelectElement).value;
              // The default (poi) is stored as absence, so clear instead of set.
              updateStop(stop.id, {
                category:
                  value === DEFAULT_STOP_CATEGORY
                    ? undefined
                    : (value as (typeof STOP_CATEGORIES)[number]["id"]),
              });
            }}
          >
            {STOP_CATEGORIES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.icon} {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            class="link-button"
            disabled={locked || category === DEFAULT_STOP_CATEGORY}
            title="Reset to the default category"
            onClick={() => updateStop(stop.id, { category: undefined })}
          >
            Reset
          </button>
        </div>
      </div>

      <label class="field">
        <span class="field__label">
          Blurb <em>one line, prints in the itinerary column</em>
        </span>
        <input
          type="text"
          value={stop.blurb ?? ""}
          disabled={locked}
          placeholder="Northeast corner of Columbus and North Water"
          onInput={(e) => {
            const value = (e.target as HTMLInputElement).value;
            updateStop(stop.id, { blurb: value === "" ? undefined : value });
          }}
        />
      </label>

      <label class="field">
        <span class="field__label">
          Description <em>paragraph, prints on the detail card</em>
        </span>
        <textarea
          rows={4}
          value={stop.description ?? ""}
          disabled={locked}
          onInput={(e) => {
            const value = (e.target as HTMLTextAreaElement).value;
            updateStop(stop.id, {
              description: value === "" ? undefined : value,
            });
          }}
        />
      </label>

      <label class="field">
        <span class="field__label">
          Image URL <em>https only — images are hotlinked, never uploaded</em>
        </span>
        <input
          type="url"
          value={imageDraft}
          disabled={locked}
          placeholder="https://example.com/photo.jpg"
          aria-invalid={imageInvalid ? "true" : undefined}
          onInput={(e) => onImageInput((e.target as HTMLInputElement).value)}
        />
      </label>
      {imageInvalid ? (
        <p class="field__error" role="alert">
          Not saved: an image URL must be an absolute <code>https://</code>
          address. <code>http:</code> is blocked as mixed content on GitHub
          Pages.
        </p>
      ) : null}

      {stop.imageUrl && !imageBroken ? (
        <figure class="stop-panel__preview">
          <img
            src={stop.imageUrl}
            alt={`Preview of ${stop.title}`}
            loading="lazy"
            referrerpolicy="no-referrer"
            onError={() => setImageBroken(true)}
          />
        </figure>
      ) : null}
      {stop.imageUrl && imageBroken ? (
        <p class="field__error" role="status">
          That image did not load. The URL is saved; the host may block
          hotlinking or the link may have rotted.
        </p>
      ) : null}

      <details class="disclosure stop-panel__advanced">
        <summary>Advanced: exact coordinates</summary>
        <p class="field__hint">
          Drag the marker on the map to move this stop. These fields are for
          fine positioning only.
        </p>
        <div class="field-row">
          <label class="field">
            <span class="field__label">Latitude</span>
            <input
              type="number"
              step="0.000001"
              value={stop.lat}
              disabled={locked}
              onChange={(e) =>
                onCoord("lat", (e.target as HTMLInputElement).value)
              }
            />
          </label>
          <label class="field">
            <span class="field__label">Longitude</span>
            <input
              type="number"
              step="0.000001"
              value={stop.lng}
              disabled={locked}
              onChange={(e) =>
                onCoord("lng", (e.target as HTMLInputElement).value)
              }
            />
          </label>
        </div>
      </details>

      {current.routes.length > 1 ? (
        <label class="field">
          <span class="field__label">Route</span>
          <select
            value={route.id}
            disabled={locked}
            onChange={(e) =>
              moveStopToRoute(stop.id, (e.target as HTMLSelectElement).value)
            }
          >
            {current.routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </section>
  );
}
