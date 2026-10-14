/**
 * Numbered marker badges.
 *
 * The same badge — route-colored circle, white numeral, number is the stop's
 * 1-based index *within its route* (SPEC D5) — is used by the map marker, the
 * itinerary row and (later) the brochure detail card, so the three read as one
 * system.
 */

import * as L from "leaflet";
import { DEFAULT_ROUTE_COLOR } from "../tour";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NAMED = /^[a-z]{3,20}$/i;

/**
 * `Route.color` is only validated as "a non-empty string", and it is inlined
 * into a `divIcon`'s HTML and into inline styles. An imported tour is
 * untrusted input, so anything that is not a plain hex or bare CSS color name
 * (no parens, no `url(`, no semicolons) falls back to the default.
 */
export function safeColor(color: string | undefined | null): string {
  const value = (color ?? "").trim();
  if (HEX.test(value) || NAMED.test(value)) return value;
  return DEFAULT_ROUTE_COLOR;
}

export interface BadgeOptions {
  label: number;
  color: string;
  selected?: boolean;
  /** Routes other than the one being edited are drawn back a little. */
  muted?: boolean;
}

/** Identity of a rendered marker, so sync can skip untouched icons. */
export function badgeSignature(options: BadgeOptions): string {
  return [
    options.label,
    safeColor(options.color),
    options.selected ? "s" : "",
    options.muted ? "m" : "",
  ].join("|");
}

export function badgeHtml(options: BadgeOptions): string {
  const classes = ["stop-badge"];
  if (options.selected) classes.push("stop-badge--selected");
  if (options.muted) classes.push("stop-badge--muted");
  return `<span class="${classes.join(" ")}" style="background:${safeColor(
    options.color,
  )}">${Math.trunc(options.label)}</span>`;
}

export function stopIcon(options: BadgeOptions): L.DivIcon {
  return L.divIcon({
    html: badgeHtml(options),
    className: "stop-marker",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}
