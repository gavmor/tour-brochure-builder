/** Sanity-checks the derived figures quoted in ADR 0001 against the report. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(
  readFileSync(resolve(HERE, "../docs/adr/0001-measurements.json"), "utf8"),
);
const row = (needle) => report.rows.find((r) => r.label.includes(needle));

const B = row("CHOSEN");
const A5 = row("polyline5 geometry, full");
const noProfile = row("no profile");
const noDesc = row("minus stop descriptions");
const coordsOnly = row("coords + titles only");
const simplified = row("simplified");

const geomJson = A5.jsonChars - B.jsonChars;
const geomUrl = A5.urlChars - B.urlChars;

console.log("geometry added, raw JSON chars   :", geomJson);
console.log("geometry added, final URL chars  :", geomUrl);
console.log("=> lz-string on geometry         :", `${(((geomUrl - geomJson) / geomJson) * 100).toFixed(1)}% change`);
console.log("lz-string on tour prose (B)      :", `${((1 - B.encodedChars / B.jsonChars) * 100).toFixed(1)}% smaller`);
console.log("A / B size ratio                 :", (A5.urlChars / B.urlChars).toFixed(2));
console.log("A as % of 8k                     :", A5.pctOfMax);
console.log("simplified as % of 8k            :", simplified.pctOfMax);
console.log("cost of the profile field (URL)  :", B.urlChars - noProfile.urlChars);
console.log("descriptions as % of B payload   :", `${(((B.urlChars - noDesc.urlChars) / B.urlChars) * 100).toFixed(1)}%`);
console.log("ids+copy floor (coords+titles)   :", coordsOnly.urlChars);
console.log("polyline5 chars, all routes      :", report.tour.routes.reduce((n, r) => n + r.polyline5Chars, 0));
console.log("total stops / routes             :", report.tour.totalStops, "/", report.tour.routes.length);
