import { describe, expect, it } from "vitest";
import { coordBlurb, round6 } from "./uiState";

describe("round6", () => {
  it("keeps six decimals and drops the rest", () => {
    expect(round6(41.88273456)).toBe(41.882735);
    expect(round6(-87.6)).toBe(-87.6);
  });
});

describe("coordBlurb (QA-BUG-6)", () => {
  it("never returns an empty string", () => {
    expect(coordBlurb(0, 0)).not.toBe("");
  });

  it("writes a map click as a hemispheric coordinate line", () => {
    expect(coordBlurb(41.8705, -87.6505)).toBe("41.8705°N, 87.6505°W");
    expect(coordBlurb(-33.8568, 151.2153)).toBe("33.8568°S, 151.2153°E");
  });

  it("rounds to ~10 m, which is all a printed line needs", () => {
    expect(coordBlurb(41.88273456, -87.62334999)).toBe("41.8827°N, 87.6233°W");
  });

  it("treats the equator and the prime meridian as positive", () => {
    expect(coordBlurb(0, 0)).toBe("0.0000°N, 0.0000°E");
  });
});
