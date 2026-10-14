/**
 * The tour store: Preact signals plus the actions the map editor and the
 * brochure view consume. Mutations are immutable replacements of `tour.value`,
 * so every dependent signal/component re-renders.
 *
 * Read-only mode (a `#view` share link, SPEC D2) hard-blocks mutating actions
 * and autosave, so opening someone else's link can never shadow or overwrite
 * the working tour in localStorage. `editCopy()` is the explicit way out.
 */

import { batch, computed, effect, signal } from "@preact/signals";
import {
  AUTOSAVE_DELAY_MS,
  createAutosaver,
  loadStoredTour,
  STORAGE_KEY,
  saveTour,
} from "./persistence";
import {
  cloneTour,
  createRoute,
  createStop,
  createTour,
  newId,
  ROUTE_COLORS,
  type Route,
  type Stop,
  type Tour,
  type TourSettings,
  totalStops,
} from "./schema";
import {
  buildShareLink,
  decodeTour,
  parseHash,
  readLocationHash,
  type ShareLink,
} from "./urlShare";
import { type ParseResult, parseTour } from "./validate";

/** The working tour. Treat as read-only outside this module. */
export const tour = signal<Tour>(createTour());

/** True when the tour came from a `#view` share link. */
export const readOnly = signal(false);

/** Route the editor is currently acting on; defaults to the first route. */
export const activeRouteId = signal<string | null>(null);

/** Stop highlighted by the map/itinerary two-way selection (SPEC §3). */
export const selectedStopId = signal<string | null>(null);

/** Warnings/errors from the last load, for the UI to surface. */
export const lastLoadNotice = signal<{
  warnings: string[];
  errors: string[];
} | null>(null);

export const routes = computed<Route[]>(() => tour.value.routes);
export const stopCount = computed<number>(() => totalStops(tour.value));

export const activeRoute = computed<Route | undefined>(() => {
  const list = tour.value.routes;
  const id = activeRouteId.value;
  return (id ? list.find((r) => r.id === id) : undefined) ?? list[0];
});

/** Share link + length budget; the UI warns above `SHARE_URL_WARN` (SPEC §6). */
export const shareLink = computed<ShareLink>(() =>
  buildShareLink(tour.value, { view: true }),
);
export const shareUrlLength = computed<number>(() => shareLink.value.urlLength);
export const shareEncodedLength = computed<number>(
  () => shareLink.value.encodedLength,
);
export const shareUrlWarning = computed<"ok" | "warn" | "too-long">(() => {
  const link = shareLink.value;
  if (link.tooLong) return "too-long";
  return link.warn ? "warn" : "ok";
});

function canMutate(): boolean {
  return !readOnly.value;
}

/** Apply a mutation to a clone of the tour, then publish it. */
function mutate(fn: (draft: Tour) => void): boolean {
  if (!canMutate()) return false;
  const draft = cloneTour(tour.value);
  fn(draft);
  tour.value = draft;
  return true;
}

function resolveRoute(draft: Tour, routeId?: string | null): Route {
  const wanted = routeId ?? activeRouteId.value;
  return (
    (wanted ? draft.routes.find((r) => r.id === wanted) : undefined) ??
    draft.routes[0]
  );
}

function ensureRoute(draft: Tour): Route {
  if (draft.routes.length === 0) draft.routes.push(createRoute());
  return resolveRoute(draft);
}

// ---------------------------------------------------------------- stop actions

/** Append a stop to a route (the active route by default). */
export function addStop(
  init: Partial<Stop> & Pick<Stop, "lat" | "lng">,
  routeId?: string,
): Stop | null {
  if (!canMutate()) return null;
  const stop = createStop(init);
  const applied = mutate((draft) => {
    const route = routeId ? resolveRoute(draft, routeId) : ensureRoute(draft);
    route.stops.push(stop);
  });
  return applied ? stop : null;
}

/** Drag handler: reposition a stop without touching its copy. */
export function moveStop(stopId: string, lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  let found = false;
  mutate((draft) => {
    for (const route of draft.routes) {
      const stop = route.stops.find((s) => s.id === stopId);
      if (stop) {
        stop.lat = lat;
        stop.lng = lng;
        found = true;
        return;
      }
    }
  });
  return found;
}

/** Patch a stop's fields. `id` cannot be patched. */
export function updateStop(
  stopId: string,
  patch: Partial<Omit<Stop, "id">>,
): boolean {
  let found = false;
  mutate((draft) => {
    for (const route of draft.routes) {
      const index = route.stops.findIndex((s) => s.id === stopId);
      if (index === -1) continue;
      const next = { ...route.stops[index], ...patch, id: stopId };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete (next as Record<string, unknown>)[key];
      }
      route.stops[index] = next as Stop;
      found = true;
      return;
    }
  });
  return found;
}

export function deleteStop(stopId: string): boolean {
  let found = false;
  mutate((draft) => {
    for (const route of draft.routes) {
      const index = route.stops.findIndex((s) => s.id === stopId);
      if (index === -1) continue;
      route.stops.splice(index, 1);
      found = true;
      return;
    }
  });
  if (found && selectedStopId.value === stopId) selectedStopId.value = null;
  return found;
}

/**
 * Reorder within a route: remove the stop at `from`, re-insert it at `to`
 * (array-splice semantics, the one drag-and-drop lists expect).
 */
export function reorderStops(
  from: number,
  to: number,
  routeId?: string,
): boolean {
  let moved = false;
  mutate((draft) => {
    const route = resolveRoute(draft, routeId);
    if (!route) return;
    const { stops } = route;
    if (
      from < 0 ||
      from >= stops.length ||
      to < 0 ||
      to >= stops.length ||
      from === to
    )
      return;
    const [stop] = stops.splice(from, 1);
    stops.splice(to, 0, stop);
    moved = true;
  });
  return moved;
}

/** Move a stop to another route, optionally at a given index. */
export function moveStopToRoute(
  stopId: string,
  routeId: string,
  index?: number,
): boolean {
  let moved = false;
  mutate((draft) => {
    const target = draft.routes.find((r) => r.id === routeId);
    if (!target) return;
    for (const route of draft.routes) {
      const at = route.stops.findIndex((s) => s.id === stopId);
      if (at === -1) continue;
      if (route.id === routeId && index === undefined) return;
      const [stop] = route.stops.splice(at, 1);
      const insertAt =
        index === undefined
          ? target.stops.length
          : Math.max(0, Math.min(index, target.stops.length));
      target.stops.splice(insertAt, 0, stop);
      moved = true;
      return;
    }
  });
  return moved;
}

// --------------------------------------------------------------- route actions

export function addRoute(init: Partial<Route> = {}): Route | null {
  if (!canMutate()) return null;
  const index = tour.value.routes.length;
  const route = createRoute(
    { ...init, color: init.color ?? ROUTE_COLORS[index % ROUTE_COLORS.length] },
    index,
  );
  const applied = mutate((draft) => {
    draft.routes.push(route);
  });
  if (!applied) return null;
  activeRouteId.value = route.id;
  return route;
}

/**
 * Patch a route's fields. An `undefined` value *removes* the key rather than
 * writing `undefined` into it — `{ profile: undefined }` is how the editor
 * says "back to the default", and ADR 0001 requires the default to be absent
 * from the serialized tour, not present-and-undefined.
 */
export function updateRoute(
  routeId: string,
  patch: Partial<Omit<Route, "id" | "stops">>,
): boolean {
  let found = false;
  mutate((draft) => {
    const index = draft.routes.findIndex((r) => r.id === routeId);
    if (index === -1) return;
    const next: Record<string, unknown> = { ...draft.routes[index] };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    // Rebuilt through the factory, not assigned in place, so the key order
    // always matches `createRoute` — a patch that adds `via` to a route that
    // already carries `profile` would otherwise append it in the wrong place
    // and the share payload would stop being byte-stable.
    draft.routes[index] = createRoute(next as Partial<Route>, index);
    found = true;
  });
  return found;
}

/** Delete a route and its stops. The last remaining route cannot be deleted. */
export function deleteRoute(routeId: string): boolean {
  let removed = false;
  mutate((draft) => {
    if (draft.routes.length <= 1) return;
    const index = draft.routes.findIndex((r) => r.id === routeId);
    if (index === -1) return;
    draft.routes.splice(index, 1);
    removed = true;
  });
  if (removed && activeRouteId.value === routeId) activeRouteId.value = null;
  return removed;
}

export function reorderRoutes(from: number, to: number): boolean {
  let moved = false;
  mutate((draft) => {
    const list = draft.routes;
    if (
      from < 0 ||
      from >= list.length ||
      to < 0 ||
      to >= list.length ||
      from === to
    )
      return;
    const [route] = list.splice(from, 1);
    list.splice(to, 0, route);
    moved = true;
  });
  return moved;
}

// ---------------------------------------------------------------- tour actions

export function setTourMeta(
  patch: Partial<
    Pick<Tour, "title" | "subtitle" | "tagline" | "description">
  > & {
    settings?: TourSettings;
  },
): boolean {
  return mutate((draft) => {
    const target = draft as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete target[key];
      else target[key] = value;
    }
  });
}

/**
 * Replace the working tour. Accepts a canonical `Tour` or anything the
 * validator can repair (parsed JSON, a decoded share payload).
 */
export function loadTour(
  input: Tour | unknown,
  options: { readOnly?: boolean; keepSelection?: boolean } = {},
): ParseResult {
  const result = parseTour(input);
  if (!result.ok) {
    lastLoadNotice.value = { warnings: [], errors: result.errors };
    return result;
  }
  batch(() => {
    tour.value = result.tour;
    readOnly.value = options.readOnly ?? false;
    activeRouteId.value = result.tour.routes[0]?.id ?? null;
    if (!options.keepSelection) selectedStopId.value = null;
    lastLoadNotice.value = { warnings: result.warnings, errors: [] };
  });
  return result;
}

/** Start over with an empty, editable tour. */
export function newTour(init: Partial<Tour> = {}): Tour {
  const fresh = createTour(init);
  batch(() => {
    tour.value = fresh;
    readOnly.value = false;
    activeRouteId.value = fresh.routes[0]?.id ?? null;
    selectedStopId.value = null;
    lastLoadNotice.value = null;
  });
  return fresh;
}

/**
 * "Edit a copy" (SPEC D2): take the currently viewed tour, give it a fresh
 * `tour.id`, drop read-only, and make it the working tour. The shared link
 * keeps working because nothing shared is mutated.
 */
export function editCopy(options: { titleSuffix?: string } = {}): Tour {
  const copy = cloneTour(tour.value);
  copy.id = newId("tour");
  if (options.titleSuffix) copy.title = `${copy.title}${options.titleSuffix}`;
  batch(() => {
    tour.value = copy;
    readOnly.value = false;
    activeRouteId.value = copy.routes[0]?.id ?? null;
    selectedStopId.value = null;
  });
  saveTour(copy);
  return copy;
}

// -------------------------------------------------------------------- autosave

let disposeAutosave: (() => void) | null = null;

/**
 * Debounced localStorage autosave. Never writes in read-only mode, so a
 * shared link cannot clobber the viewer's own tour.
 */
export function startAutosave(
  options: { key?: string; delay?: number } = {},
): () => void {
  stopAutosave();
  const save = createAutosaver(
    options.key ?? STORAGE_KEY,
    options.delay ?? AUTOSAVE_DELAY_MS,
  );
  const dispose = effect(() => {
    const current = tour.value;
    if (readOnly.value) return;
    save(current);
  });
  disposeAutosave = () => {
    save.flush();
    dispose();
  };
  return stopAutosave;
}

export function stopAutosave(): void {
  disposeAutosave?.();
  disposeAutosave = null;
}

/** Force a synchronous save (e.g. on `beforeunload`). */
export function saveNow(key = STORAGE_KEY): boolean {
  if (readOnly.value) return false;
  return saveTour(tour.value, key);
}

// ------------------------------------------------------------------ bootstrap

export interface InitResult {
  /** Where the tour came from. `starter` is the curated template fallback. */
  source: "url" | "storage" | "starter" | "new";
  readOnly: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Apply a hash fragment to the store. Returns the parse result when the hash
 * carried a tour, or null when it carried none.
 */
export function applyHash(hash: string): ParseResult | null {
  const state = parseHash(hash);
  if (!state.encoded) return null;
  const decoded = decodeTour(state.encoded);
  if (!decoded.ok) {
    lastLoadNotice.value = { warnings: [], errors: decoded.errors };
    return decoded;
  }
  loadTour(decoded.tour, { readOnly: state.view });
  return decoded;
}

let disposeHashWatcher: (() => void) | null = null;

/**
 * React to in-session hash changes, so pasting a share link into the address
 * bar of an already-open app swaps the tour instead of doing nothing.
 */
export function startHashWatcher(): () => void {
  stopHashWatcher();
  if (typeof window === "undefined") return stopHashWatcher;
  const onHashChange = () => {
    applyHash(window.location.hash);
  };
  window.addEventListener("hashchange", onHashChange);
  disposeHashWatcher = () =>
    window.removeEventListener("hashchange", onHashChange);
  return stopHashWatcher;
}

export function stopHashWatcher(): void {
  disposeHashWatcher?.();
  disposeHashWatcher = null;
}

/**
 * Load order on startup: a `#t=` share link wins over localStorage, which
 * wins over the `fallback` (the curated starter template), which wins over a
 * blank tour. A `#view` link opens read-only and does not autosave.
 *
 * `fallback` keeps the generic tour layer free of any dependency on app content
 * (`src/data`): the caller — `main.tsx` — injects the starter template. When no
 * fallback is given, a first visit gets a blank editable tour, exactly as
 * before, so nothing here changes for tests or embedders that omit it.
 */
export function initStore(
  options: {
    hash?: string;
    key?: string;
    autosave?: boolean;
    watchHash?: boolean;
    /** Produces the tour to hydrate when there is no URL or stored tour. */
    fallback?: () => Tour | unknown;
  } = {},
): InitResult {
  const key = options.key ?? STORAGE_KEY;
  const hash =
    options.hash === undefined ? readLocationHash() : parseHash(options.hash);

  const result: InitResult = {
    source: "new",
    readOnly: false,
    warnings: [],
    errors: [],
  };
  const finish = () => {
    if (options.autosave !== false) startAutosave({ key });
    if (options.watchHash !== false) startHashWatcher();
    return result;
  };

  if (hash.encoded) {
    const decoded = decodeTour(hash.encoded);
    if (decoded.ok) {
      loadTour(decoded.tour, { readOnly: hash.view });
      result.source = "url";
      result.readOnly = hash.view;
      result.warnings = decoded.warnings;
      return finish();
    }
    result.errors.push(...decoded.errors);
  }

  const stored = loadStoredTour(key);
  if (stored?.ok) {
    loadTour(stored.tour);
    result.source = "storage";
    result.warnings = stored.warnings;
    return finish();
  }
  if (stored && !stored.ok) result.errors.push(...stored.errors);

  // No URL and no stored tour: hydrate the curated starter template, so a
  // first visit opens a populated, fully-editable tour instead of a blank map.
  if (options.fallback) {
    const seeded = loadTour(options.fallback());
    if (seeded.ok) {
      result.source = "starter";
      result.warnings = seeded.warnings;
      return finish();
    }
    // A broken fallback must never strand the user on an empty app.
    result.errors.push(...seeded.errors);
  }

  newTour();
  return finish();
}

/** Test seam: reset every signal to a pristine state. */
export function resetStore(): void {
  stopAutosave();
  stopHashWatcher();
  batch(() => {
    tour.value = createTour();
    readOnly.value = false;
    activeRouteId.value = tour.value.routes[0]?.id ?? null;
    selectedStopId.value = null;
    lastLoadNotice.value = null;
  });
}
