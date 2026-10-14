/**
 * Copy-to-clipboard with a fallback.
 *
 * `navigator.clipboard` needs a secure context and a user gesture. On
 * GitHub Pages (https) it is there, but a brochure opened from `file://`, an
 * http preview or an embedded webview has to fall back to the old
 * selection + `execCommand` trick — and a share link nobody can copy is a
 * share feature that does not work.
 */

export type CopyOutcome = "clipboard" | "fallback" | "failed";

export async function copyText(text: string): Promise<CopyOutcome> {
  if (!text) return "failed";

  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return "clipboard";
    } catch {
      // Permission denied or no gesture — fall through to the legacy path.
    }
  }

  return copyViaTextarea(text) ? "fallback" : "failed";
}

function copyViaTextarea(text: string): boolean {
  if (typeof document === "undefined" || !document.body) return false;
  const area = document.createElement("textarea");
  area.value = text;
  // Off-screen but still focusable; `display:none` would not be selectable.
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand?.("copy") ?? false;
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
