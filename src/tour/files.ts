/**
 * Export/import a tour as a `.json` file. Download uses an object URL and a
 * synthetic anchor click; import reads a `File` from an `<input type="file">`
 * or a drop event. No backend is involved at any point.
 */

import type { Tour } from "./schema";
import { type ParseResult, parseTourJson, serializeTour } from "./validate";

export const TOUR_FILE_MIME = "application/json";

/** `My Walking Tour` → `my-walking-tour.tour.json` */
export function tourFilename(tour: Tour): string {
  const slug =
    tour.title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "tour";
  return `${slug}.tour.json`;
}

/** Pretty-printed JSON blob — these files get read and diffed by humans. */
export function tourBlob(tour: Tour): Blob {
  return new Blob([serializeTour(tour, true)], { type: TOUR_FILE_MIME });
}

/**
 * Trigger a download of the tour. Returns the filename used, or null when
 * there is no DOM (SSR, tests).
 */
export function downloadTour(
  tour: Tour,
  filename = tourFilename(tour),
): string | null {
  if (
    typeof document === "undefined" ||
    typeof URL.createObjectURL !== "function"
  )
    return null;
  const url = URL.createObjectURL(tourBlob(tour));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so Firefox has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return filename;
}

/** Validate an uploaded file. Never throws; bad files come back as errors. */
export async function readTourFile(file: Blob): Promise<ParseResult> {
  let text: string;
  try {
    text =
      typeof file.text === "function"
        ? await file.text()
        : await blobToText(file);
  } catch (error) {
    return {
      ok: false,
      errors: [
        `Could not read the file: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  return parseTourJson(text);
}

function blobToText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(blob);
  });
}
