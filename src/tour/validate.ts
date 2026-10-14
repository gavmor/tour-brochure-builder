/**
 * Runtime validation, repair and migration for tour data arriving from
 * untrusted places: a pasted share URL or an uploaded .json file.
 *
 * Policy: repair what is unambiguously repairable (missing ids, missing
 * titles, a `version: 1` flat tour, a single bad stop in an otherwise good
 * route) and report it as a warning; reject only what cannot be salvaged
 * (not an object, unknown schema version, unparseable JSON).
 */

import { z } from "zod";
import {
  createRoute,
  DEFAULT_ROUTE_PROFILE,
  DEFAULT_STOP_CATEGORY,
  isRouteProfile,
  isStopCategory,
  newId,
  normalizeProfile,
  ROUTE_COLORS,
  ROUTE_PROFILES,
  type Route,
  type RouteProfile,
  type Stop,
  TOUR_SCHEMA_VERSION,
  type Tour,
  type TourSettings,
} from "./schema";

/**
 * Runtime validation, repair and migration for tour data arriving from
 * untrusted places: a pasted share URL or an uploaded .json file.
 *
 * Policy: repair what is unambiguously repairable (missing ids, missing
 * titles, a `version: 1` flat tour, a single bad stop in an otherwise good
 * route) and report it as a warning; reject only what cannot be salvaged
 * (not an object, unknown schema version, unparseable JSON).
 */

/** Strict shape of a canonical, already-repaired tour. */
const stopSchema = z.object({
  id: z.string().min(1),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  title: z.string(),
  blurb: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  category: z
    .enum([
      "attraction",
      "museum",
      "historic",
      "viewpoint",
      "food",
      "nature",
      "shop",
      "transit",
      "poi",
    ])
    .optional(),
});

const routeSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  color: z.string().min(1),
  stops: z.array(stopSchema),
  // Additive in v2 (ADR 0001): a tour without `profile` is still a valid v2
  // tour, so `TOUR_SCHEMA_VERSION` does not move and old links keep loading.
  // The enum is the routing layer's canonical id list, not a second copy.
  profile: z.enum(ROUTE_PROFILES).optional(),
  via: z.array(z.tuple([z.number(), z.number()])).optional(),
});

const tourSchema = z.object({
  version: z.literal(TOUR_SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string(),
  subtitle: z.string().optional(),
  tagline: z.string().optional(),
  description: z.string().optional(),
  routes: z.array(routeSchema),
  settings: z
    .object({
      pageSize: z.enum(["letter", "a4"]).optional(),
      basemap: z.string().optional(),
    })
    .optional(),
});

export interface ParseOk {
  ok: true;
  tour: Tour;
  /** Non-fatal repairs applied, in the order they happened. */
  warnings: string[];
  /** Set when the input used an older schema version. */
  migratedFrom?: number;
}

export interface ParseError {
  ok: false;
  errors: string[];
}

export type ParseResult = ParseOk | ParseError;

/** Strict type guard — true only for already-canonical data. */
export function isTour(value: unknown): value is Tour {
  return tourSchema.safeParse(value).success;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Accepts numeric strings too — CSV/paste sources routinely produce them. */
function coerceNumber(v: unknown): number | undefined {
  if (isFiniteNumber(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function cleanString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** SPEC D3: images are hotlinked, so `https:` only — `http:` is mixed content. */
export function isUsableImageUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.trim() === "") return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

function repairStop(
  raw: unknown,
  warn: (m: string) => void,
  where: string,
): Stop | null {
  if (!isRecord(raw)) {
    warn(`${where}: dropped a stop that was not an object`);
    return null;
  }
  const lat = coerceNumber(raw.lat);
  const lng = coerceNumber(raw.lng);
  if (lat === undefined || lng === undefined) {
    warn(`${where}: dropped a stop with missing or non-numeric coordinates`);
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    warn(
      `${where}: dropped a stop with out-of-range coordinates (${lat}, ${lng})`,
    );
    return null;
  }

  const id = cleanString(raw.id);
  const title = cleanString(raw.title);
  if (!id) warn(`${where}: stop was missing an id; generated one`);
  if (!title) warn(`${where}: stop was missing a title; used "Untitled stop"`);

  const stop: Stop = {
    id: id ?? newId("stop"),
    lat,
    lng,
    title: title ?? "Untitled stop",
  };
  const blurb = cleanString(raw.blurb);
  if (blurb) stop.blurb = blurb;
  const description = cleanString(raw.description);
  if (description) stop.description = description;
  if (
    raw.imageUrl !== undefined &&
    raw.imageUrl !== null &&
    raw.imageUrl !== ""
  ) {
    if (isUsableImageUrl(raw.imageUrl)) {
      stop.imageUrl = raw.imageUrl;
    } else {
      warn(`${where}: dropped a non-https image URL on "${stop.title}"`);
    }
  }
  // Keep only a recognised, non-default category; anything else resolves to the
  // default (poi) at read time, so it is simply omitted here (§3c, §6).
  if (raw.category !== undefined && raw.category !== null) {
    if (isStopCategory(raw.category)) {
      if (raw.category !== DEFAULT_STOP_CATEGORY) stop.category = raw.category;
    } else {
      warn(
        `${where}: dropped an unknown category "${String(raw.category)}" on "${stop.title}"`,
      );
    }
  }
  return stop;
}

function repairVia(raw: unknown, warn: (m: string) => void, where: string) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    warn(`${where}: dropped a non-array "via"`);
    return undefined;
  }
  const points: [number, number][] = [];
  let dropped = 0;
  for (const point of raw) {
    const lat = Array.isArray(point) ? coerceNumber(point[0]) : undefined;
    const lng = Array.isArray(point) ? coerceNumber(point[1]) : undefined;
    if (
      lat === undefined ||
      lng === undefined ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      dropped++;
      continue;
    }
    points.push([lat, lng]);
  }
  if (dropped) warn(`${where}: dropped ${dropped} malformed "via" point(s)`);
  return points.length ? points : undefined;
}

/**
 * Travel mode, repaired in the same spirit as everything else here: a value
 * we do not recognise warns and falls back to the default, it never fails the
 * parse (ADR 0001 — a hand-edited URL must still render).
 *
 * Two values are *not* unrecognised, they are legacy: the choice-first build
 * shipped `walking` and `cycling` while the profile was still cosmetic.
 * `normalizeProfile` maps them to `foot` and `bike` silently, so every link
 * that build emitted keeps its travel mode instead of being reset to walking.
 *
 * An explicit `"foot"` is dropped rather than kept, because `createRoute`
 * omits the default: canonical output has to be the same whether a route came
 * from the factory or from a parse, or share links stop round-tripping
 * byte-identically.
 */
function repairProfile(
  raw: unknown,
  warn: (m: string) => void,
  where: string,
): RouteProfile | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const normalized = normalizeProfile(raw);
  // `normalizeProfile` answers `foot` both for a real foot/walking value and
  // for nonsense, so the warning is gated on the input being known wording.
  if (!isRouteProfile(raw) && !isLegacyProfileName(raw)) {
    warn(
      `${where}: unknown routing profile "${String(raw)}"; used "${DEFAULT_ROUTE_PROFILE}"`,
    );
    return undefined;
  }
  return normalized === DEFAULT_ROUTE_PROFILE ? undefined : normalized;
}

/** Travel-mode wording from the pre-routing choice-first build (t_2c1641fe). */
const LEGACY_PROFILE_NAMES = ["walking", "cycling", "walk", "car", "bicycle"];

function isLegacyProfileName(raw: unknown): boolean {
  return (
    typeof raw === "string" && LEGACY_PROFILE_NAMES.includes(raw.toLowerCase())
  );
}

function repairRoute(
  raw: unknown,
  index: number,
  warn: (m: string) => void,
): Route | null {
  if (!isRecord(raw)) {
    warn(`Route ${index + 1}: dropped, it was not an object`);
    return null;
  }
  const name = cleanString(raw.name) ?? `Route ${index + 1}`;
  const where = `Route "${name}"`;
  const id = cleanString(raw.id);
  if (!id) warn(`${where}: missing an id; generated one`);
  const color = cleanString(raw.color);
  if (!color) warn(`${where}: missing a color; used the default palette`);

  const rawStops = Array.isArray(raw.stops) ? raw.stops : [];
  if (!Array.isArray(raw.stops))
    warn(`${where}: "stops" was not an array; used an empty list`);

  const stops: Stop[] = [];
  for (const rawStop of rawStops) {
    const stop = repairStop(rawStop, warn, where);
    if (stop) stops.push(stop);
  }

  const route: Route = {
    id: id ?? newId("route"),
    name,
    color: color ?? ROUTE_COLORS[index % ROUTE_COLORS.length],
    stops,
  };
  // Keep only a recognised, non-default profile; everything else — absent,
  // legacy wording, nonsense — resolves to the default at read time, so it is
  // simply omitted here (§3a, §6, ADR 0001).
  const profile = repairProfile(raw.profile, warn, where);
  if (profile) route.profile = profile;
  const via = repairVia(raw.via, warn, where);
  if (via) route.via = via;
  return route;
}

function repairSettings(
  raw: unknown,
  warn: (m: string) => void,
): TourSettings | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    warn('Dropped a non-object "settings"');
    return undefined;
  }
  const settings: TourSettings = {};
  if (raw.pageSize === "letter" || raw.pageSize === "a4")
    settings.pageSize = raw.pageSize;
  else if (raw.pageSize !== undefined)
    warn(`Dropped an unknown page size "${String(raw.pageSize)}"`);
  const basemap = cleanString(raw.basemap);
  if (basemap) settings.basemap = basemap;
  return Object.keys(settings).length ? settings : undefined;
}

/**
 * `version: 1` → `version: 2`: wrap the flat `stops[]` in one default route.
 * This is the one migration the validator will realistically see.
 */
export function migrateV1ToV2(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const { stops, version: _version, ...rest } = raw;
  return {
    ...rest,
    version: TOUR_SCHEMA_VERSION,
    routes: [
      {
        id: newId("route"),
        name: "Tour route",
        color: ROUTE_COLORS[0],
        stops: Array.isArray(stops) ? stops : [],
      },
    ],
  };
}

/** Infers the schema version of data whose `version` field is missing. */
function detectVersion(raw: Record<string, unknown>): number | null {
  if (raw.version === undefined || raw.version === null) {
    if (Array.isArray(raw.routes)) return TOUR_SCHEMA_VERSION;
    if (Array.isArray(raw.stops)) return 1;
    return TOUR_SCHEMA_VERSION;
  }
  const version = coerceNumber(raw.version);
  return version === undefined || !Number.isInteger(version) ? null : version;
}

/**
 * Validate, repair and migrate arbitrary input into a canonical `Tour`.
 * Never throws.
 */
export function parseTour(input: unknown): ParseResult {
  if (!isRecord(input)) {
    return { ok: false, errors: ["Not a tour: expected a JSON object."] };
  }

  const version = detectVersion(input);
  if (version === null) {
    return {
      ok: false,
      errors: [`Unrecognised tour version: ${String(input.version)}.`],
    };
  }
  if (version > TOUR_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        `This tour was saved by a newer version of the app (schema v${version}; this build understands v${TOUR_SCHEMA_VERSION}).`,
      ],
    };
  }
  if (version < 1) {
    return { ok: false, errors: [`Unrecognised tour version: ${version}.`] };
  }

  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);

  let raw = input;
  let migratedFrom: number | undefined;
  if (version === 1) {
    raw = migrateV1ToV2(input);
    migratedFrom = 1;
    warn(
      "Migrated a version 1 tour: the flat stop list became a single route.",
    );
  }

  const id = cleanString(raw.id);
  if (!id) warn("Tour was missing an id; generated one.");
  const title = cleanString(raw.title);
  if (!title) warn('Tour was missing a title; used "Untitled tour".');

  const rawRoutes = Array.isArray(raw.routes) ? raw.routes : [];
  if (!Array.isArray(raw.routes))
    warn('Tour "routes" was not an array; used an empty list.');

  const routes: Route[] = [];
  rawRoutes.forEach((rawRoute, i) => {
    const route = repairRoute(rawRoute, i, warn);
    if (route) routes.push(route);
  });
  if (routes.length === 0) {
    routes.push(createRoute());
    warn("Tour had no usable routes; started an empty default route.");
  }

  const subtitle = cleanString(raw.subtitle);
  const tagline = cleanString(raw.tagline);
  const description = cleanString(raw.description);
  const settings = repairSettings(raw.settings, warn);

  // Key order must match `createTour`, so a tour serializes byte-identically
  // whether it came from the factory or from a parse.
  const tour: Tour = {
    version: TOUR_SCHEMA_VERSION,
    id: id ?? newId("tour"),
    title: title ?? "Untitled tour",
    ...(subtitle ? { subtitle } : {}),
    ...(tagline ? { tagline } : {}),
    ...(description ? { description } : {}),
    routes,
    ...(settings ? { settings } : {}),
  };

  // Self-check: repair must always produce canonical data.
  const check = tourSchema.safeParse(tour);
  if (!check.success) {
    return {
      ok: false,
      errors: check.error.issues.map(
        (i) => `${i.path.join(".") || "tour"}: ${i.message}`,
      ),
    };
  }

  return migratedFrom === undefined
    ? { ok: true, tour, warnings }
    : { ok: true, tour, warnings, migratedFrom };
}

/** `parseTour` over a JSON string. Never throws. */
export function parseTourJson(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      errors: [
        `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  return parseTour(data);
}

/** Canonical JSON for export/share. Key order is stable across round-trips. */
export function serializeTour(tour: Tour, pretty = false): string {
  return JSON.stringify(tour, null, pretty ? 2 : 0);
}
