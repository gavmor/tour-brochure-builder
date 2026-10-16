/**
 * @vitest-environment node
 *
 * The print sheet's geometry, asserted against the stylesheet itself.
 *
 * jsdom has no layout engine and does not resolve `calc()` or custom
 * properties, so the usual render test cannot see any of this — yet the
 * numbers here are the ones that decide whether a folded brochure has its
 * creases through the text. They are also the numbers most likely to be
 * nudged by someone tuning padding, so they get a test that reads the
 * declarations out of `brochure.css` and does the arithmetic.
 *
 * What is pinned:
 *   - full bleed: `@page { size: letter landscape; margin: 0 }`, nothing left
 *     anywhere that would print a white frame;
 *   - exact thirds: the panels are 11in/3, so the folds are at 11/3in and
 *     22/3in and the map/itinerary boundary is the second fold;
 *   - the *mechanism* that keeps the white-on-white continuation sheets off
 *     the trim on every fragment (a named `@page continuation`, not container
 *     padding) — the effect itself is measured on a real PDF by
 *     `e2e/print-bleed-safe.spec.ts`, because jsdom cannot fragment a page;
 *   - the print guarantees that must survive a geometry change: card
 *     break-avoidance, a visible OSM credit, and backgrounds that do not get
 *     dropped to save ink.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const raw = readFileSync(
  fileURLToPath(new URL("./brochure.css", import.meta.url)),
  "utf8",
);

/** Comments stripped: the prose explains the geometry and would otherwise be
    matched as if it were a declaration (it quotes `@page { margin: 0 }`). */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

const SHEET_WIDTH_IN = 11;
const SHEET_HEIGHT_IN = 8.5;

// ------------------------------------------------------------------ helpers

/** The value of a custom property, as written (each is declared once). */
function declaration(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  if (!match) throw new Error(`no declaration for ${name} in brochure.css`);
  return match[1].trim();
}

/** The body of the first rule whose selector list matches `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[\\s,])${escaped}\\s*\\{([^}]*)\\}`, "m").exec(
    css,
  );
  if (!match) throw new Error(`no rule for ${selector} in brochure.css`);
  return match[1];
}

/**
 * Arithmetic over `+ - * /` and parentheses. Deliberately tiny: it exists only
 * to evaluate the handful of `calc()` expressions the geometry tokens use.
 */
function evaluate(source: string): number {
  const tokens = source.match(/\d+\.?\d*|[()+\-*/]/g) ?? [];
  let at = 0;

  const primary = (): number => {
    const token = tokens[at++];
    if (token === "(") {
      const value = sum();
      if (tokens[at++] !== ")") throw new Error(`unbalanced ( in ${source}`);
      return value;
    }
    const value = Number(token);
    if (!Number.isFinite(value)) {
      throw new Error(`unexpected token ${token} in ${source}`);
    }
    return value;
  };

  const product = (): number => {
    let value = primary();
    while (tokens[at] === "*" || tokens[at] === "/") {
      const operator = tokens[at++];
      const right = primary();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };

  function sum(): number {
    let value = product();
    while (tokens[at] === "+" || tokens[at] === "-") {
      const operator = tokens[at++];
      const right = product();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  const result = sum();
  if (at !== tokens.length) throw new Error(`trailing tokens in ${source}`);
  return result;
}

/** Resolve a geometry token to inches, following `var()` and `calc()`. */
function inches(name: string): number {
  let expression = declaration(name);
  for (let guard = 0; expression.includes("var("); guard += 1) {
    if (guard > 20) throw new Error(`var() cycle resolving ${name}`);
    expression = expression.replace(
      /var\((--[\w-]+)\)/g,
      (_, reference: string) => `(${declaration(reference)})`,
    );
  }
  const unitless = expression
    .replace(/calc\(/g, "(")
    .replace(/([\d.]+)in\b/g, "$1");
  if (/[a-z%]/i.test(unitless)) {
    throw new Error(`${name} is not expressed in inches: ${expression}`);
  }
  return evaluate(unitless);
}

// -------------------------------------------------------------------- tests

describe("@page", () => {
  const page = /@page\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

  it("is US Letter landscape", () => {
    expect(page).toMatch(/size:\s*letter\s+landscape\s*;/);
  });

  it("has no page margin at all — the brochure is full bleed", () => {
    expect(page).toMatch(/margin:\s*0\s*;/);
    // Not "0.35in", not "0 0.35in", not a one-sided leftover.
    expect(page).not.toMatch(/margin[^:]*:\s*[^;]*\din/);
    expect(page).not.toMatch(/margin-(top|right|bottom|left)\s*:/);
  });

  it("declares exactly two pages: the full-bleed one and the continuation", () => {
    // Two `@page` rules now: the unnamed full-bleed one above, and the named
    // `continuation` page that insets the white-on-white sheets. The unnamed
    // one must still be the only rule that can set page 1's margin.
    const names = Array.from(css.matchAll(/@page\s*([\w-]*)\s*\{/g)).map(
      (match) => match[1],
    );
    expect(names).toEqual(["", "continuation"]);
  });
});

describe("sheet geometry", () => {
  it("is the whole sheet: the content box has no margin subtracted", () => {
    expect(inches("--sheet-w")).toBe(SHEET_WIDTH_IN);
    expect(inches("--sheet-h")).toBe(SHEET_HEIGHT_IN);
    expect(inches("--content-w")).toBe(SHEET_WIDTH_IN);
    expect(inches("--content-h")).toBe(SHEET_HEIGHT_IN);
  });

  it("splits the width into three exactly equal fold panels", () => {
    expect(inches("--panel-w")).toBeCloseTo(SHEET_WIDTH_IN / 3, 10);
    expect(inches("--panel-w") * 3).toBeCloseTo(SHEET_WIDTH_IN, 10);
  });

  it("puts the fold lines at 11/3in and 22/3in", () => {
    const panel = inches("--panel-w");
    expect(panel).toBeCloseTo(3.6667, 4);
    expect(panel * 2).toBeCloseTo(7.3333, 4);
  });

  it("lands the map/itinerary boundary on the second fold", () => {
    expect(inches("--map-w")).toBeCloseTo(inches("--panel-w") * 2, 10);
    expect(inches("--col-w")).toBeCloseTo(inches("--panel-w"), 10);
  });

  it("fills the width exactly: the two columns are the whole sheet", () => {
    expect(inches("--map-w") + inches("--col-w")).toBeCloseTo(
      SHEET_WIDTH_IN,
      10,
    );
  });

  it("keeps the itinerary's text clear of the fold (SPEC §2)", () => {
    // Panel 3 starts *on* the fold now, so its own padding is the clearance.
    expect(inches("--fold-safe")).toBeGreaterThan(0.2);
    expect(declaration("--paper-itin-pad-x")).toBe("var(--fold-safe)");
  });

  it("holds the readable overlays off the trim", () => {
    expect(inches("--bleed-safe")).toBeGreaterThan(0);
    expect(inches("--bleed-safe")).toBeLessThan(inches("--fold-safe"));
  });

  it("carries no leftover page-margin token", () => {
    expect(raw).not.toContain("--page-margin");
    expect(raw).not.toContain("0.35in");
  });
});

describe("the print sheet uses that geometry", () => {
  const main = ruleBody(".brochure__page--main");

  it("lays page 1 out as map columns plus the itinerary column", () => {
    const print = css.slice(css.indexOf("@media print"));
    expect(print).toMatch(
      /\.brochure__page--main\s*\{[^}]*grid-template-columns:\s*var\(--map-w\)\s+var\(--col-w\);/,
    );
    expect(print).toMatch(
      /\.brochure__page--main\s*\{[^}]*width:\s*var\(--sheet-w\);/,
    );
  });

  it("stages the same columns on screen, so Leaflet measures the paper box", () => {
    // The first `.brochure__page--main` rule is the screen one; the staging
    // override must still be expressed in the same tokens as the print one.
    expect(main).toContain("display: grid");
    expect(css).toMatch(
      /\.brochure--staging \.brochure__page--main\s*\{[^}]*grid-template-columns:\s*var\(--map-w\)\s+var\(--col-w\);/,
    );
    expect(css).toMatch(
      /\.brochure--staging \.brochure__sheet\s*\{[^}]*width:\s*var\(--content-w\);/,
    );
  });

  it("leaves nothing between the sheet and the paper", () => {
    const frame = /html,\s*body,\s*#app\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(frame).toMatch(/margin:\s*0;/);
    expect(frame).toMatch(/padding:\s*0;/);
    const print = css.slice(css.indexOf("@media print"));
    expect(print).toMatch(/\.brochure__sheet\s*\{[^}]*padding:\s*0;/);
  });
});

describe("print guarantees that must survive the bleed", () => {
  const print = css.slice(css.indexOf("@media print"));

  it("keeps backgrounds from being dropped to save ink", () => {
    // Inherited, so the root carries it; the filled elements state it too.
    expect(ruleBody(".brochure")).toMatch(/print-color-adjust:\s*exact;/);
    expect(ruleBody(".brochure")).toMatch(
      /-webkit-print-color-adjust:\s*exact;/,
    );
    for (const selector of [
      ".brochure__sheet",
      ".brochure__map-panel",
      ".bro-itinerary",
      ".bro-ribbon",
    ]) {
      expect(ruleBody(selector)).toMatch(/print-color-adjust:\s*exact;/);
    }
  });

  it("still refuses to split a detail card across pages", () => {
    expect(print).toMatch(/\.bro-card\s*\{[^}]*break-inside:\s*avoid;/);
    expect(print).toMatch(/\.bro-card\s*\{[^}]*page-break-inside:\s*avoid;/);
    expect(print).toMatch(
      /\.bro-route__stops li\s*\{[^}]*break-inside:\s*avoid;/,
    );
  });

  it("still prints the OSM credit, inset from the trim rather than clipped", () => {
    expect(print).toMatch(/\.brochure__attribution\s*\{[^}]*display:\s*block;/);
    expect(print).toMatch(
      /\.brochure__attribution\s*\{[^}]*margin:\s*var\(--bleed-safe\);/,
    );
    // In flow, not absolutely positioned: Firefox pushed an absolute credit
    // onto the following page.
    expect(print).not.toMatch(
      /\.brochure__attribution\s*\{[^}]*position:\s*absolute;/,
    );
  });

  it("insets the legend from the paper edge too", () => {
    expect(print).toMatch(/\.bro-legend\s*\{[^}]*left:\s*var\(--bleed-safe\);/);
    expect(print).toMatch(
      /\.bro-legend\s*\{[^}]*bottom:\s*var\(--bleed-safe\);/,
    );
  });

  it("gives the map the whole panel, so its tiles reach the sheet edge", () => {
    expect(print).toMatch(
      /\.brochure__map-panel\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\);/,
    );
    expect(print).toMatch(/\.brochure-map\s*\{[^}]*grid-area:\s*1 \/ 1;/);
  });

  it("keeps the white-on-white continuation sheets readable", () => {
    // The acceptance test for this is `e2e/print-bleed-safe.spec.ts`, which
    // prints a PDF and measures the ink; a stylesheet regex cannot fragment a
    // page. What *can* be pinned here is the mechanism, because the obvious
    // shape is the broken one: container padding. CSS fragmentation applies a
    // box's `padding-top` only to its first fragment and `padding-bottom` only
    // to its last, so `.bro-cards { padding: var(--bleed-safe) }` printed
    // every cards sheet after the first flush to the top trim.
    for (const selector of ["bro-cards", "bro-spill"]) {
      expect(
        print,
        `.${selector} must be assigned to the continuation page; a block-axis ` +
          "inset cannot come from container padding.",
      ).toMatch(
        new RegExp(`\\.${selector}[^{}]*\\{[^}]*page:\\s*continuation;`),
      );
    }

    const continuation =
      /@page\s+continuation\s*\{([^}]*)\}/.exec(print)?.[1] ?? "";
    expect(continuation, "no @page continuation rule in brochure.css").not.toBe(
      "",
    );

    // Top and bottom from the page (every fragment gets it), left and right
    // zero. A horizontal page margin here would make Chromium shrink the whole
    // document to its narrowest page and open a white band down page 1.
    expect(continuation).toMatch(/margin:\s*var\(--bleed-safe\)\s+0\s*;/);

    // …so the inline halves come from padding, which fragmentation does keep.
    expect(print).toMatch(
      /\.bro-cards,\s*\.bro-spill\s*\{[^}]*padding:\s*0 var\(--bleed-safe\);/,
    );

    // The one silent failure mode: `@page` resolves custom properties against
    // the *root element*, so a `--bleed-safe` declared on `.brochure` would
    // make the margin above compute to nothing and bring the bug straight
    // back, with every declaration still present and this file still green.
    expect(
      /:root\s*\{[^}]*--bleed-safe:/.test(css),
      "--bleed-safe must be declared on :root, or @page continuation's " +
        "margin silently resolves to 0 and the inset is lost again.",
    ).toBe(true);
  });

  it("does not try to carry the continuation inset in container padding", () => {
    // The regression this whole card is about: a four-sided padding shorthand,
    // or an explicit block-axis padding, on either continuation container.
    for (const selector of ["\\.bro-cards", "\\.bro-spill"]) {
      const rules = print.match(
        new RegExp(`${selector}[^{}]*\\{[^}]*\\}`, "g"),
      );
      for (const rule of rules ?? []) {
        expect(rule).not.toMatch(
          /padding(-top|-bottom)?:\s*var\(--bleed-safe\)/,
        );
      }
    }
  });
});
