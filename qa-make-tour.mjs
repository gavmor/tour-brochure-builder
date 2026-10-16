// QA helper (not committed): build a share URL for a tour big enough to force
// an itinerary spill sheet + multi-page stop detail cards.
import lzString from "lz-string";
const { compressToEncodedURIComponent } = lzString;

const BASE = process.argv[2] ?? "http://127.0.0.1:4288/tour-brochure-builder/";
const N = Number(process.argv[3] ?? 14);

const blurbs = [
  "Northeast corner of Columbus Drive and East North Water Street",
  "Northwest corner of West Wacker Drive and North Michigan Avenue",
  "South side of East Jackson Boulevard between State and Dearborn",
  "West side of North Franklin Street at the river walk stair",
  "Under the elevated tracks at Lake and Wabash, east stair",
];
const descriptions = [
  "A long enough paragraph of copy that the printed detail card has real body text to lay out, which is what makes the break-inside rule worth testing at all rather than a one-line stub.",
  "The observation deck high above South Wacker Drive, with glass ledges that cantilever out over the street far below and a queue that wraps the lobby on a summer afternoon.",
  "A riverfront plaza whose terraces step down to the water, lined with cafe tables in the warm months and completely empty under a February wind off the lake.",
];

function stops(prefix, lat0, lng0, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `${prefix}_s${i}`,
      lat: +(lat0 + (i % 7) * 0.0022 - (i % 3) * 0.0011).toFixed(5),
      lng: +(lng0 + (i % 5) * 0.0031 - (i % 4) * 0.0014).toFixed(5),
      title: `${prefix === "g" ? "Green" : "Red"} Stop ${i + 1} — a fairly long stop name`,
      blurb: blurbs[i % blurbs.length],
      description: descriptions[i % descriptions.length],
    });
  }
  return out;
}

const tour = {
  version: 2,
  id: "tour_qa_fullbleed",
  title: "QA Full-Bleed Verification Tour",
  subtitle: "Chicago",
  tagline: "Hop on and hop off to experience both routes!",
  description:
    "A deliberately oversized two-route loop used to force the itinerary spill sheet and multiple pages of stop detail cards.",
  settings: { pageSize: "letter" },
  routes: [
    {
      id: "route_green",
      name: "Green Route",
      color: "#1E8449",
      stops: stops("g", 41.8896, -87.6208, N),
    },
    {
      id: "route_red",
      name: "Red Route",
      color: "#C0392B",
      stops: stops("r", 41.8789, -87.6359, N),
    },
  ],
};

const encoded = compressToEncodedURIComponent(JSON.stringify(tour));
const url = `${BASE}#view&t=${encoded}`;
console.log(
  JSON.stringify(
    { stops: N * 2, payloadChars: encoded.length, urlChars: url.length, url },
    null,
    0,
  ),
);
