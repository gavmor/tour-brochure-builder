/** Editor-only UI state. Tour data lives in the store; this is just chrome. */

import { signal } from "@preact/signals";

/** When armed, the next map click drops a stop. Stays armed for fast entry. */
export const addMode = signal(false);

/** Shows draggable `Route.via` shape handles for the active route (SPEC D4). */
export const shapeMode = signal(false);

/** Routes hidden from the map; the legend doubles as a visibility toggle. */
export const hiddenRouteIds = signal<string[]>([]);

export function isRouteVisible(routeId: string): boolean {
  return !hiddenRouteIds.value.includes(routeId);
}

export function toggleRouteVisible(routeId: string): void {
  const hidden = hiddenRouteIds.value;
  hiddenRouteIds.value = hidden.includes(routeId)
    ? hidden.filter((id) => id !== routeId)
    : [...hidden, routeId];
}

/**
 * Bumped by the "Fit to stops" control. The map fits automatically when a tour
 * loads; this lets the author ask for it again after editing.
 */
export const fitRequest = signal(0);

export function requestFit(): void {
  fitRequest.value += 1;
}

// ------------------------------------------- "Add sites near a location"

/** The POI proposal dialog is open. */
export const nearbyOpen = signal(false);

/** When armed, the next map click chooses the centre to search around. */
export const nearbyPinMode = signal(false);

/** The chosen search centre, drawn on the map until the dialog closes. */
export const nearbyCenter = signal<{ lat: number; lng: number } | null>(null);

/**
 * The proposals currently on offer, so the map can show the user *where* they
 * are while the checklist is open (choice-first UX §2). Ticked proposals are
 * drawn solid, unticked ones hollow; the list is the source of truth.
 */
export const nearbyProposals = signal<
  { id: string; lat: number; lng: number; title: string; chosen: boolean }[]
>([]);

export function openNearby(): void {
  // Two armed map-click modes at once would be a coin toss for the user.
  addMode.value = false;
  nearbyOpen.value = true;
}

export function closeNearby(): void {
  nearbyOpen.value = false;
  nearbyPinMode.value = false;
  nearbyCenter.value = null;
  nearbyProposals.value = [];
}

/** Coordinates are stored to ~0.1 m; more precision just inflates share URLs. */
export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
