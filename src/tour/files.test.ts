import { describe, expect, it } from "vitest";
import {
  downloadTour,
  readTourFile,
  TOUR_FILE_MIME,
  tourBlob,
  tourFilename,
} from "./files";
import { bigTour, twoRouteTour } from "./fixtures";
import { createTour } from "./schema";
import { serializeTour } from "./validate";

describe("tourFilename", () => {
  it.each([
    ["Downtown Tour", "downtown-tour.tour.json"],
    ["  Gav's  Walking Tour!  ", "gav-s-walking-tour.tour.json"],
    ["", "tour.tour.json"],
    ["***", "tour.tour.json"],
  ])("slugifies %j", (title, expected) => {
    expect(tourFilename(createTour({ title }))).toBe(expected);
  });

  it("caps very long titles", () => {
    const name = tourFilename(createTour({ title: "a".repeat(200) }));
    expect(name.length).toBeLessThanOrEqual(60 + ".tour.json".length);
  });
});

describe("file export/import round-trip", () => {
  it("round-trips a two-route tour through a .json blob", async () => {
    const tour = twoRouteTour();
    const blob = tourBlob(tour);
    expect(blob.type).toBe(TOUR_FILE_MIME);

    const result = await readTourFile(blob);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tour).toEqual(tour);
    expect(serializeTour(result.tour)).toBe(serializeTour(tour));
  });

  it("round-trips a 20-stop tour", async () => {
    const tour = bigTour(20, 2);
    const result = await readTourFile(tourBlob(tour));
    expect(result.ok && result.tour).toEqual(tour);
  });

  it("writes human-readable, re-importable JSON", async () => {
    const text = await tourBlob(twoRouteTour()).text();
    expect(text).toContain('"version": 2');
    expect(text.split("\n").length).toBeGreaterThan(10);
  });

  it("reports an error for a file that is not a tour", async () => {
    const junk = new Blob(["<html>nope</html>"], { type: "text/html" });
    const result = await readTourFile(junk);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/not valid json/i);
  });

  it("migrates a v1 file on import", async () => {
    const legacy = new Blob([
      JSON.stringify({
        version: 1,
        id: "t",
        title: "Old",
        stops: [{ id: "s", lat: 1, lng: 2, title: "A" }],
      }),
    ]);
    const result = await readTourFile(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.migratedFrom).toBe(1);
  });
});

describe("downloadTour", () => {
  it("names the file after the tour and leaves no anchor behind", () => {
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;
    const revoked: string[] = [];
    URL.createObjectURL = () => "blob:fake";
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
    try {
      const filename = downloadTour(twoRouteTour());
      expect(filename).toBe("downtown-tour.tour.json");
      expect(document.querySelectorAll("a[download]")).toHaveLength(0);
    } finally {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    }
  });

  it("accepts an explicit filename", () => {
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = () => "blob:fake";
    try {
      expect(downloadTour(twoRouteTour(), "custom.json")).toBe("custom.json");
    } finally {
      URL.createObjectURL = createObjectURL;
    }
  });
});
