/**
 * The tour store: Preact signals plus the actions the map editor and the
 * brochure view consume. Mutations are immutable replacements of `tour.value`,
 * so every dependent signal/component re-renders.
 *
 * **The URL hash is the only place a tour lives.** There is no localStorage
 * layer: every mutation is re-encoded into the hash via `history.replaceState`
 * (see `startUrlSync`), and clearing the hash clears the work and returns to
 * the starter template. See `docs/adr/0002-url-sole-source-of-truth.md`.
 *
 * Read-only mode (a `#view` share link, SPEC D2) hard-blocks mutating actions
 * and URL writes, so opening someone else's link can never rewrite the hash
 * out from under the link you were sent. `editCopy()` is the explicit way out.
 */

import { batch, computed, effect, signal } from "@preact/signals";
import { type Debounced, debounce, URL_SYNC_DELAY_MS } from "./debounce";
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
  buildHash,
  buildShareLink,
  decodeTour,
  parseHash,
  readLocationHash,
  replaceLocationHash,
  type ShareLink,
} from "./urlShare";
import {
  isUnrecognisedTour,
  type ParseResult,
  parseTour,
  serializeTour,
} from "./validate";

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
  /**
   * Set when the errors above are survivable: the load failed and this is
   * what was shown instead. Lets the editor say "showing the starter tour"
   * rather than implying the app is broken (QA-BUG-2).
   */
  fallback?: "starter" | "new";
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
 * keeps working because nothing shared is mutated — the copy simply takes over
 * the address bar as an editable `#t=` hash on the next URL sync.
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
  return copy;
}

// -------------------------------------------------------------------- URL sync

/**
 * The starter template, as the caller injected it and as canonical JSON.
 *
 * The snapshot is the "no diff yet" baseline: while the working tour still
 * serializes to exactly this, the hash stays empty, so a pristine app has a
 * bare, short, shareable URL. The first real edit puts a `#t=` hash there and
 * every later edit updates it.
 */
let fallbackFactory: (() => Tour | unknown) | null = null;

const fallbackSnapshot = signal<string | null>(null);

/**
 * True when there is a starter template to go back to and the working tour is
 * no longer it — i.e. "Restore starter tour" would do something. Nothing in
 * the app may be a one-way door (epic t_f3a98cf7), and "Start blank" was one
 * until this existed (QA-BUG-5).
 */
export const canRestoreStarter = computed<boolean>(() => {
  const snapshot = fallbackSnapshot.value;
  return snapshot !== null && serializeTour(tour.value) !== snapshot;
});

/** The last hash this module wrote, so the watcher can ignore its own echo. */
let lastWrittenHash: string | null = null;

let pendingUrlWrite: Debounced<[Tour]> | null = null;

let disposeUrlSync: (() => void) | null = null;

/** The hash a given tour should occupy: empty while it still is the starter. */
export function hashForTour(candidate: Tour): string {
  if (
    fallbackSnapshot.value !== null &&
    serializeTour(candidate) === fallbackSnapshot.value
  )
    return "";
  return buildHash(candidate, { view: false });
}

function writeHash(candidate: Tour): string | null {
  if (readOnly.peek()) return null;
  const hash = hashForTour(candidate);
  lastWrittenHash = hash;
  return replaceLocationHash(hash);
}

/**
 * Mirror every mutation into the URL hash, debounced so a burst of keystrokes
 * costs one `history.replaceState`. Never writes in read-only mode, so a
 * `#view` link is not rewritten into an editable one behind the viewer's back.
 */
export function startUrlSync(options: { delay?: number } = {}): () => void {
  stopUrlSync();
  const write = debounce<[Tour]>(
    (candidate) => writeHash(candidate),
    options.delay ?? URL_SYNC_DELAY_MS,
  );
  pendingUrlWrite = write;
  const dispose = effect(() => {
    const current = tour.value;
    if (readOnly.value) return;
    write(current);
  });
  disposeUrlSync = () => {
    write.cancel();
    dispose();
    if (pendingUrlWrite === write) pendingUrlWrite = null;
  };
  return stopUrlSync;
}

export function stopUrlSync(): void {
  disposeUrlSync?.();
  disposeUrlSync = null;
}

/**
 * Write the working tour to the address bar right now, skipping the debounce
 * (e.g. straight after "Edit a copy", so the `#view` link is replaced by an
 * editable one before the user can copy it).
 */
export function syncUrlNow(): string | null {
  pendingUrlWrite?.cancel();
  return writeHash(tour.peek());
}

// ------------------------------------------------------------------ bootstrap

export interface InitResult {
  /** Where the tour came from. `starter` is the curated template fallback. */
  source: "url" | "starter" | "new";
  readOnly: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * What the UI is told when a `#t=` payload decoded cleanly but described no
 * tour at all. Kept as a constant so the bootstrap and the hash watcher say
 * the same thing, and tests can assert on it.
 */
export const NOT_A_TOUR_ERROR =
  "That link did not contain a tour; opened the starter tour instead.";

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
  // Decoded, repairable, and still not a tour: treat it like a corrupt link
  // rather than letting it blank the app (see `isUnrecognisedTour`).
  if (isUnrecognisedTour(decoded)) {
    resetToFallback();
    lastLoadNotice.value = { warnings: [], errors: [NOT_A_TOUR_ERROR] };
    return { ok: false, errors: [NOT_A_TOUR_ERROR] };
  }
  loadTour(decoded.tour, { readOnly: state.view });
  return decoded;
}

/**
 * Hydrate the starter template (or a blank tour when no fallback was injected,
 * or when the injected one is unusable). Returns where the tour came from.
 *
 * Any errors already on `result` — a corrupt `#t=` payload, typically — are
 * republished to `lastLoadNotice` once the fallback is in place. `loadTour`
 * below writes its own (clean) notice, and letting that stand is what made a
 * broken share link fail silently: the user got the curated starter with no
 * hint their link was unreadable (QA-BUG-2).
 */
function hydrateFallback(result: InitResult): "starter" | "new" {
  let source: "starter" | "new" = "new";
  if (fallbackFactory) {
    const seeded = loadTour(fallbackFactory());
    if (seeded.ok) {
      result.warnings = seeded.warnings;
      source = "starter";
    } else {
      // A broken fallback must never strand the user on an empty app.
      result.errors.push(...seeded.errors);
    }
  }
  if (source === "new") newTour();
  if (result.errors.length > 0) {
    lastLoadNotice.value = {
      warnings: result.warnings,
      errors: result.errors,
      fallback: source,
    };
  }
  return source;
}

/**
 * Reset to the starter template. This is what "clearing the URL clears the
 * work" means: no hash, no diff.
 */
export function resetToFallback(): InitResult {
  const result: InitResult = {
    source: "new",
    readOnly: false,
    warnings: [],
    errors: [],
  };
  result.source = hydrateFallback(result);
  return result;
}

let disposeHashWatcher: (() => void) | null = null;

/**
 * React to hash changes the *user* makes: pasting a share link into the
 * address bar swaps the tour, and deleting the hash throws the work away and
 * returns to the starter.
 *
 * The app's own writes go through `history.replaceState`, which by spec does
 * not fire `hashchange` — and the echo guard below makes that belt-and-braces,
 * so a URL write can never feed back into a reload.
 */
export function startHashWatcher(): () => void {
  stopHashWatcher();
  if (typeof window === "undefined") return stopHashWatcher;
  const onHashChange = () => {
    const raw = window.location.hash;
    if (lastWrittenHash !== null && raw === lastWrittenHash) return;
    lastWrittenHash = null;
    if (parseHash(raw).encoded) applyHash(raw);
    else resetToFallback();
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
 * Load order on startup: a `#t=` / `#view&t=` hash wins over the `fallback`
 * (the curated starter template), which wins over a blank tour. There is no
 * localStorage step — a bare URL therefore *always* opens the starter, which
 * is what fixes "a returning visitor sees a blank map".
 *
 * `fallback` keeps the generic tour layer free of any dependency on app content
 * (`src/data`): the caller — `main.tsx` — injects the starter template. When no
 * fallback is given, a first visit gets a blank editable tour.
 */
export function initStore(
  options: {
    hash?: string;
    urlSync?: boolean;
    watchHash?: boolean;
    /** Produces the tour to hydrate when the URL carries none. */
    fallback?: () => Tour | unknown;
  } = {},
): InitResult {
  const hash =
    options.hash === undefined ? readLocationHash() : parseHash(options.hash);

  fallbackFactory = options.fallback ?? null;
  fallbackSnapshot.value = null;
  if (fallbackFactory) {
    const baseline = parseTour(fallbackFactory());
    if (baseline.ok) fallbackSnapshot.value = serializeTour(baseline.tour);
  }

  const result: InitResult = {
    source: "new",
    readOnly: false,
    warnings: [],
    errors: [],
  };
  const finish = () => {
    if (options.urlSync !== false) startUrlSync();
    if (options.watchHash !== false) startHashWatcher();
    return result;
  };

  if (hash.encoded) {
    const decoded = decodeTour(hash.encoded);
    if (decoded.ok && !isUnrecognisedTour(decoded)) {
      loadTour(decoded.tour, { readOnly: hash.view });
      result.source = "url";
      result.readOnly = hash.view;
      result.warnings = decoded.warnings;
      return finish();
    }
    // Neither a corrupt payload nor a decodable one that turned out not to be
    // a tour is worth stranding the user over: fall through to the starter,
    // and let the URL writer replace the broken hash.
    result.errors.push(...(decoded.ok ? [NOT_A_TOUR_ERROR] : decoded.errors));
  }

  result.source = hydrateFallback(result);
  return finish();
}

/** Test seam: reset every signal to a pristine state. */
export function resetStore(): void {
  stopUrlSync();
  stopHashWatcher();
  fallbackFactory = null;
  fallbackSnapshot.value = null;
  lastWrittenHash = null;
  batch(() => {
    tour.value = createTour();
    readOnly.value = false;
    activeRouteId.value = tour.value.routes[0]?.id ?? null;
    selectedStopId.value = null;
    lastLoadNotice.value = null;
  });
}
