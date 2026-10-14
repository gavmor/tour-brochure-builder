import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTE_COLOR } from "../tour";
import { badgeHtml, badgeSignature, safeColor } from "./markers";

describe("safeColor", () => {
  it("passes hex and bare color names through", () => {
    expect(safeColor("#1E8449")).toBe("#1E8449");
    expect(safeColor("#abc")).toBe("#abc");
    expect(safeColor("#1E844980")).toBe("#1E844980");
    expect(safeColor("rebeccapurple")).toBe("rebeccapurple");
    expect(safeColor("  #C0392B  ")).toBe("#C0392B");
  });

  it("falls back for anything that could break out of an inline style", () => {
    // `Route.color` is only validated as a non-empty string, and it is inlined
    // into the marker's HTML — an imported tour is untrusted input.
    for (const hostile of [
      "red; background-image:url(https://evil.test/x.png)",
      'red"><img src=x onerror=alert(1)>',
      "url(javascript:alert(1))",
      "var(--x)",
      "",
      "   ",
      undefined,
      null,
    ]) {
      expect(safeColor(hostile)).toBe(DEFAULT_ROUTE_COLOR);
    }
  });
});

describe("badgeHtml", () => {
  it("renders the per-route number on a route-colored badge", () => {
    const html = badgeHtml({ label: 3, color: "#C0392B" });
    expect(html).toContain(">3<");
    expect(html).toContain("background:#C0392B");
    expect(html).toContain('class="stop-badge"');
  });

  it("marks selection and muting with classes, not inline style", () => {
    const html = badgeHtml({
      label: 1,
      color: "#1E8449",
      selected: true,
      muted: true,
    });
    expect(html).toContain("stop-badge--selected");
    expect(html).toContain("stop-badge--muted");
  });

  it("never emits an unsanitised color", () => {
    const html = badgeHtml({ label: 1, color: "red;background:url(x)" });
    expect(html).not.toContain("url(");
    expect(html).toContain(DEFAULT_ROUTE_COLOR);
  });
});

describe("badgeSignature", () => {
  it("changes when anything visible changes, so sync can skip the rest", () => {
    const base = { label: 1, color: "#1E8449" };
    const sig = badgeSignature(base);
    expect(badgeSignature({ ...base })).toBe(sig);
    expect(badgeSignature({ ...base, label: 2 })).not.toBe(sig);
    expect(badgeSignature({ ...base, color: "#C0392B" })).not.toBe(sig);
    expect(badgeSignature({ ...base, selected: true })).not.toBe(sig);
    expect(badgeSignature({ ...base, muted: true })).not.toBe(sig);
  });
});
