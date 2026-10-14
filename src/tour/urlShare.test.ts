import { describe, expect, it } from "vitest";
import { bigTour, twoRouteTour } from "./fixtures";
import { createTour, SHARE_URL_MAX, SHARE_URL_WARN } from "./schema";
import {
  buildHash,
  buildShareLink,
  decodeTour,
  encodeTour,
  parseHash,
} from "./urlShare";
import { serializeTour } from "./validate";

const BASE = "https://www.gavmor.com/tour-brochure-builder/";

describe("encode/decode round-trip", () => {
  it("round-trips a two-route tour identically", () => {
    const tour = twoRouteTour();
    const result = decodeTour(encodeTour(tour));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tour).toEqual(tour);
    expect(serializeTour(result.tour)).toBe(serializeTour(tour));
  });

  it("round-trips a 20-stop tour identically", () => {
    const tour = bigTour(20, 2);
    const result = decodeTour(encodeTour(tour));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tour).toEqual(tour);
    expect(result.tour.routes.flatMap((r) => r.stops)).toHaveLength(20);
  });

  it("survives a full buildHash → parseHash → decodeTour trip", () => {
    const tour = bigTour(20, 2);
    const hash = buildHash(tour);
    const state = parseHash(hash);
    expect(state.view).toBe(true);
    expect(state.encoded).toBeTruthy();
    const result = decodeTour(state.encoded ?? "");
    expect(result.ok && result.tour).toEqual(tour);
  });

  it("produces a payload with no hash delimiters", () => {
    const encoded = encodeTour(bigTour(20, 2));
    expect(encoded).not.toMatch(/[#&?/\s=]/);
  });

  it("survives a client that percent-encodes the payload in transit", () => {
    const tour = twoRouteTour();
    const mangled = encodeURIComponent(encodeTour(tour));
    const result = decodeTour(mangled);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tour).toEqual(tour);
  });

  it("survives a client that form-decodes + into a space", () => {
    const tour = bigTour(20, 2);
    const mangled = encodeTour(tour).replace(/\+/g, " ");
    const result = decodeTour(mangled);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tour).toEqual(tour);
  });

  it("compresses: the payload is smaller than the raw JSON", () => {
    const tour = bigTour(20, 2);
    expect(encodeTour(tour).length).toBeLessThan(serializeTour(tour).length);
  });

  it("rejects a corrupt or truncated payload instead of throwing", () => {
    const encoded = encodeTour(twoRouteTour());
    for (const bad of [
      "",
      "!!!!",
      encoded.slice(0, Math.floor(encoded.length / 2)),
    ]) {
      const result = decodeTour(bad);
      expect(result.ok).toBe(false);
    }
  });

  it("migrates a v1 payload carried in an old share link", () => {
    const legacy = {
      version: 1,
      id: "t",
      title: "Legacy",
      stops: [{ id: "s", lat: 1, lng: 2, title: "A" }],
    };
    const result = decodeTour(
      encodeTour(legacy as unknown as ReturnType<typeof createTour>),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(1);
    expect(result.tour.routes[0].stops[0].title).toBe("A");
  });
});

describe("parseHash", () => {
  it.each([
    ["#view&t=abc", { view: true, encoded: "abc" }],
    ["#t=abc&view", { view: true, encoded: "abc" }],
    ["#t=abc", { view: false, encoded: "abc" }],
    ["view&t=abc", { view: true, encoded: "abc" }],
    ["#view", { view: true, encoded: null }],
    ["#", { view: false, encoded: null }],
    ["", { view: false, encoded: null }],
    ["#other=1", { view: false, encoded: null }],
    ["#t=", { view: false, encoded: null }],
  ])("parses %s", (hash, expected) => {
    expect(parseHash(hash)).toEqual(expected);
  });

  it("keeps base64-ish payloads with = padding intact", () => {
    expect(parseHash("#view&t=aGVsbG8=").encoded).toBe("aGVsbG8=");
  });

  it("tolerates null/undefined", () => {
    expect(parseHash(null)).toEqual({ view: false, encoded: null });
    expect(parseHash(undefined)).toEqual({ view: false, encoded: null });
  });
});

describe("buildHash", () => {
  it("defaults shared links to read-only (SPEC D2)", () => {
    expect(buildHash(twoRouteTour()).startsWith("#view&t=")).toBe(true);
  });

  it("can emit an editable link explicitly", () => {
    const hash = buildHash(twoRouteTour(), { view: false });
    expect(hash.startsWith("#t=")).toBe(true);
    expect(parseHash(hash).view).toBe(false);
  });
});

describe("share-URL budget (SPEC §6)", () => {
  it("reports encoded and URL lengths", () => {
    const link = buildShareLink(twoRouteTour(), { baseUrl: BASE });
    expect(link.url.startsWith(`${BASE}#view&t=`)).toBe(true);
    expect(link.encodedLength).toBeGreaterThan(0);
    expect(link.urlLength).toBe(link.url.length);
    expect(link.encodedLength).toBeLessThan(link.urlLength);
  });

  it("stays quiet for a small tour", () => {
    const link = buildShareLink(createTour({ title: "Tiny" }), {
      baseUrl: BASE,
    });
    expect(link.warn).toBe(false);
    expect(link.tooLong).toBe(false);
    expect(link.urlLength).toBeLessThan(SHARE_URL_WARN);
  });

  it("warns above the 6k threshold and flags above 8k", () => {
    const warnTour = createTour({
      title: "Wordy",
      description: "x".repeat(SHARE_URL_WARN * 3),
    });
    // lz-string squashes repeats, so pad with incompressible text instead.
    warnTour.description = Array.from(
      { length: 4000 },
      (_, i) => `w${i.toString(36)}`,
    ).join(" ");
    const link = buildShareLink(warnTour, { baseUrl: BASE });
    expect(link.urlLength).toBeGreaterThan(SHARE_URL_WARN);
    expect(link.warn).toBe(true);
    expect(link.tooLong).toBe(link.urlLength > SHARE_URL_MAX);
    // However long it gets, it must still decode.
    expect(
      decodeTour(parseHash(link.url.slice(link.url.indexOf("#"))).encoded ?? "")
        .ok,
    ).toBe(true);
  });

  it("keeps a realistic 20-stop tour inside the hard ceiling", () => {
    const link = buildShareLink(bigTour(20, 2), { baseUrl: BASE });
    expect(link.urlLength).toBeLessThan(SHARE_URL_MAX);
  });
});
