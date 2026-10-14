/**
 * Share links: the whole tour lives in the URL hash, because there is no
 * backend (SPEC §6). `#view&t=<lz-string>` is read-only (SPEC D2).
 */

import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import { SHARE_URL_MAX, SHARE_URL_WARN, type Tour } from "./schema";
import { type ParseResult, parseTourJson, serializeTour } from "./validate";

export const TOUR_HASH_PARAM = "t";
export const VIEW_HASH_FLAG = "view";

/** Compress a tour into a hash-safe payload. */
export function encodeTour(tour: Tour): string {
  return compressToEncodedURIComponent(serializeTour(tour));
}

/**
 * Decompress + validate a hash payload. Never throws.
 *
 * lz-string's URI-safe alphabet contains `+`, which some chat clients and
 * proxies percent-encode (`%2B`) or form-decode (a space) in transit. Both
 * damaged forms are repaired here before giving up.
 */
export function decodeTour(encoded: string): ParseResult {
  if (!encoded) return { ok: false, errors: ["Empty share payload."] };
  for (const candidate of repairCandidates(encoded)) {
    let json: string | null;
    try {
      json = decompressFromEncodedURIComponent(candidate);
    } catch {
      json = null;
    }
    if (json) return parseTourJson(json);
  }
  return { ok: false, errors: ["Share link payload is corrupt or truncated."] };
}

function repairCandidates(encoded: string): string[] {
  const candidates = [encoded];
  if (encoded.includes("%")) {
    try {
      const decoded = decodeURIComponent(encoded);
      if (decoded !== encoded) candidates.push(decoded);
    } catch {
      /* not percent-encoded after all */
    }
  }
  return candidates;
}

export interface HashState {
  /** `#view` present → brochure opens read-only. */
  view: boolean;
  /** Raw `t=` payload, or null when the hash carries no tour. */
  encoded: string | null;
}

/**
 * Parse `#view&t=…`. Tolerates a leading `#`, `?`-style hashes, flag-only
 * segments and arbitrary ordering.
 */
export function parseHash(hash: string | undefined | null): HashState {
  const raw = (hash ?? "").replace(/^#/, "").replace(/^\?/, "");
  if (!raw) return { view: false, encoded: null };
  let view = false;
  let encoded: string | null = null;
  for (const segment of raw.split("&")) {
    if (!segment) continue;
    const eq = segment.indexOf("=");
    const key = eq === -1 ? segment : segment.slice(0, eq);
    const value = eq === -1 ? "" : segment.slice(eq + 1);
    if (key === VIEW_HASH_FLAG) view = true;
    else if (key === TOUR_HASH_PARAM && value) encoded = value;
  }
  return { view, encoded };
}

/** Build the hash fragment for a tour. Shared links default to read-only. */
export function buildHash(
  tour: Tour,
  options: { view?: boolean } = {},
): string {
  const view = options.view ?? true;
  const encoded = encodeTour(tour);
  return view
    ? `#${VIEW_HASH_FLAG}&${TOUR_HASH_PARAM}=${encoded}`
    : `#${TOUR_HASH_PARAM}=${encoded}`;
}

export interface ShareLink {
  url: string;
  /** Length of the compressed payload alone. */
  encodedLength: number;
  /** Length of the whole URL — what actually gets truncated. */
  urlLength: number;
  /** Above SHARE_URL_WARN: still works, but warn the author (SPEC §6). */
  warn: boolean;
  /** Above SHARE_URL_MAX: likely to be truncated by proxies or chat clients. */
  tooLong: boolean;
}

function currentBaseUrl(): string {
  if (typeof globalThis.location === "undefined") return "";
  const { origin, pathname, search } = globalThis.location;
  return `${origin}${pathname}${search}`;
}

/**
 * Full share URL plus the length budget the UI needs to warn on.
 * `baseUrl` defaults to the current document URL without its hash.
 */
export function buildShareLink(
  tour: Tour,
  options: { view?: boolean; baseUrl?: string } = {},
): ShareLink {
  const hash = buildHash(tour, options);
  const encodedLength = hash.slice(hash.indexOf("=") + 1).length;
  const url = `${options.baseUrl ?? currentBaseUrl()}${hash}`;
  return {
    url,
    encodedLength,
    urlLength: url.length,
    warn: url.length > SHARE_URL_WARN,
    tooLong: url.length > SHARE_URL_MAX,
  };
}

/** Read the current document hash. Returns an inert state outside a browser. */
export function readLocationHash(): HashState {
  if (typeof globalThis.location === "undefined")
    return { view: false, encoded: null };
  return parseHash(globalThis.location.hash);
}
