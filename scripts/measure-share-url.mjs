/**
 * Measures the share-URL cost of storing road geometry in the URL (option A)
 * versus storing stops + a routing profile and recomputing on load (option B).
 *
 * Evidence for docs/adr/0001-route-geometry-storage.md. Re-run with:
 *   node scripts/measure-share-url.mjs            # live OSRM, writes the JSON report
 *   node scripts/measure-share-url.mjs --offline  # replay the committed report
 *
 * Hits the public OSRM demo server a handful of times; it is rate limited, so
 * this is a manual script, never part of `pnpm test` or CI.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import lzString from "lz-string";

const { compressToEncodedURIComponent } = lzString;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT = resolve(HERE, "../docs/adr/0001-measurements.json");

/** Mirrors src/tour/schema.ts. */
const SHARE_URL_WARN = 6000;
const SHARE_URL_MAX = 8000;
const BASE_URL = "https://www.gavmor.com/tour-brochure-builder/";
const HASH_PREFIX = "#view&t=";

const OSRM = "https://router.project-osrm.org/route/v1";

/**
 * A realistic Chicago hop-on/hop-off tour in the shape of the reference
 * brochure: three named, colored routes, 10-14 stops each, blurbs everywhere,
 * descriptions on the headline stops, a few hotlinked images.
 */
const TOUR_SOURCE = {
  id: "tour_chicago_downtown",
  title: "Chicago Downtown Tour",
  subtitle: "Chicago",
  tagline: "Hop on and hop off to experience all three routes!",
  description:
    "A hop-on/hop-off loop of the Loop, the Magnificent Mile and the Museum Campus, with an after-dark skyline run.",
  settings: { pageSize: "letter" },
  routes: [
    {
      id: "route_green",
      name: "Green Route",
      color: "#1E8449",
      profile: "driving",
      stops: [
        {
          lat: 41.8896,
          lng: -87.6208,
          title: "Sheraton Grand Chicago",
          blurb:
            "Northeast corner of Columbus and North Water, across from the NBC Tower",
          description:
            "The riverside hotel where every loop begins and ends. Buses board on the Columbus Drive side under the canopy.",
          imageUrl: "https://upload.wikimedia.org/sheraton-grand-chicago.jpg",
        },
        {
          lat: 41.8882,
          lng: -87.6245,
          title: "Michigan Avenue Bridge",
          blurb: "Northwest corner of Wacker and Michigan",
          description:
            "The double-deck bascule bridge at the original site of Fort Dearborn, with four carved tender houses at its corners.",
        },
        {
          lat: 41.8837,
          lng: -87.6248,
          title: "Chicago Cultural Center",
          blurb: "Washington and Michigan, east side of the street",
          description:
            "Free galleries under the world's largest Tiffany glass dome, in the city's former central library.",
        },
        {
          lat: 41.8826,
          lng: -87.6226,
          title: "Millennium Park",
          blurb: "Michigan Avenue at Madison, park entrance",
          description:
            "Cloud Gate, the Pritzker Pavilion bandshell and the Crown Fountain, all within a five-minute walk of the stop.",
          imageUrl: "https://upload.wikimedia.org/cloud-gate-chicago.jpg",
        },
        {
          lat: 41.8796,
          lng: -87.6237,
          title: "Art Institute of Chicago",
          blurb: "Michigan Avenue between Jackson and Monroe, at the lions",
          description:
            "American Gothic, Nighthawks and one of the great Impressionist collections outside Paris.",
        },
        {
          lat: 41.8758,
          lng: -87.6189,
          title: "Buckingham Fountain",
          blurb: "Columbus Drive at Congress Parkway, Grant Park",
          description:
            "The pink-marble centerpiece of Grant Park; the center jet runs 150 feet on the hour through the season.",
        },
        {
          lat: 41.8663,
          lng: -87.617,
          title: "Field Museum",
          blurb: "Museum Campus, north entrance on Lake Shore Drive",
          description:
            "Sue the Tyrannosaurus, the Hall of Gems and a block-long Egyptian tomb reconstruction.",
        },
        {
          lat: 41.8676,
          lng: -87.614,
          title: "Shedd Aquarium",
          blurb: "Museum Campus, Solidarity Drive",
        },
        {
          lat: 41.8663,
          lng: -87.6072,
          title: "Adler Planetarium",
          blurb: "End of Solidarity Drive, Northerly Island",
          description:
            "The skyline view from the planetarium steps is the postcard shot of the whole trip.",
        },
        {
          lat: 41.8623,
          lng: -87.6167,
          title: "Soldier Field",
          blurb: "McFetridge Drive, west side of the stadium",
        },
        {
          lat: 41.853,
          lng: -87.632,
          title: "Chinatown Gate",
          blurb: "Wentworth Avenue at Cermak Road",
          description:
            "The ceremonial gate into Chicago's Chinatown, two blocks of bakeries, tea shops and dim sum.",
        },
        {
          lat: 41.8789,
          lng: -87.6359,
          title: "Willis Tower Skydeck",
          blurb: "Jackson Boulevard entrance, west of Wacker",
          description:
            "The 103rd-floor observation deck, with glass ledges that cantilever out over South Wacker Drive far below.",
          imageUrl: "https://upload.wikimedia.org/willis-tower-skydeck.jpg",
        },
        {
          lat: 41.8789,
          lng: -87.6397,
          title: "Union Station",
          blurb: "Jackson and Canal, Great Hall entrance",
        },
        {
          lat: 41.8787,
          lng: -87.6473,
          title: "Greektown",
          blurb: "Halsted Street between Monroe and Van Buren",
        },
      ],
    },
    {
      id: "route_red",
      name: "Red Route",
      color: "#C0392B",
      profile: "driving",
      stops: [
        {
          lat: 41.8896,
          lng: -87.6208,
          title: "Sheraton Grand Chicago",
          blurb:
            "Northeast corner of Columbus and North Water, across from the NBC Tower",
        },
        {
          lat: 41.8917,
          lng: -87.6086,
          title: "Navy Pier",
          blurb: "Grand Avenue at Streeter, south drop-off",
          description:
            "Half a mile of lakefront pier: the Centennial Wheel, the Chicago Shakespeare Theater and the summer fireworks.",
          imageUrl: "https://upload.wikimedia.org/navy-pier-chicago.jpg",
        },
        {
          lat: 41.8903,
          lng: -87.6232,
          title: "Tribune Tower",
          blurb: "435 North Michigan, east side",
          description:
            "A neo-Gothic tower studded with fragments of the Parthenon, the Great Wall and the Alamo at street level.",
        },
        {
          lat: 41.8886,
          lng: -87.6246,
          title: "Wrigley Building",
          blurb: "400 North Michigan, west side of the avenue",
        },
        {
          lat: 41.8975,
          lng: -87.6245,
          title: "Water Tower Place",
          blurb: "Michigan Avenue at Pearson",
          description:
            "The 1869 pumping station across the street is one of the few buildings to survive the Great Fire.",
        },
        {
          lat: 41.8988,
          lng: -87.6229,
          title: "875 North Michigan Avenue",
          blurb: "Formerly the John Hancock Center, at Delaware",
          description:
            "The X-braced tower with the 94th-floor observatory and a tilting glass ledge over the avenue.",
        },
        {
          lat: 41.9029,
          lng: -87.6233,
          title: "Oak Street Beach",
          blurb: "Oak Street at Lake Shore Drive, pedestrian underpass",
        },
        {
          lat: 41.9114,
          lng: -87.6317,
          title: "Chicago History Museum",
          blurb: "Clark Street at North Avenue, Lincoln Park",
        },
        {
          lat: 41.9217,
          lng: -87.6337,
          title: "Lincoln Park Zoo",
          blurb: "Stockton Drive at Webster, free admission",
          description:
            "One of the last free zoos in the country, open since 1868, inside the city's largest park.",
        },
        {
          lat: 41.9113,
          lng: -87.6345,
          title: "The Second City",
          blurb: "1616 North Wells Street, Old Town",
          description:
            "The improv theater that produced most of a half-century of American sketch comedy.",
        },
        {
          lat: 41.8946,
          lng: -87.6265,
          title: "Rush Street",
          blurb: "Rush at Oak, the Viagra Triangle",
        },
        {
          lat: 41.893,
          lng: -87.624,
          title: "Magnificent Mile",
          blurb: "Michigan Avenue at Ohio Street",
        },
      ],
    },
    {
      id: "route_night",
      name: "Night Tour",
      color: "#1F3A5F",
      profile: "driving",
      stops: [
        {
          lat: 41.8896,
          lng: -87.6208,
          title: "Sheraton Grand Chicago",
          blurb: "Columbus Drive canopy, departs at dusk",
        },
        {
          lat: 41.8882,
          lng: -87.6245,
          title: "Michigan Avenue Bridge",
          blurb: "Wacker and Michigan, river level lit",
        },
        {
          lat: 41.8872,
          lng: -87.6345,
          title: "Marina City",
          blurb: "300 North State, the corncob towers",
        },
        {
          lat: 41.8872,
          lng: -87.6283,
          title: "Chicago Riverwalk",
          blurb: "Lower Wacker, between State and Michigan",
          description:
            "The river's edge promenade, best after sunset when the bridges and the Merchandise Mart light up.",
        },
        {
          lat: 41.8827,
          lng: -87.6233,
          title: "Cloud Gate",
          blurb: "Millennium Park, AT&T Plaza",
        },
        {
          lat: 41.8758,
          lng: -87.6189,
          title: "Buckingham Fountain",
          blurb: "Columbus at Congress, color show on the hour",
          description:
            "After dark the fountain runs a twenty-minute light and music show at the top of every hour.",
        },
        {
          lat: 41.8663,
          lng: -87.617,
          title: "Museum Campus",
          blurb: "Field Museum north steps",
        },
        {
          lat: 41.8663,
          lng: -87.6072,
          title: "Adler Planetarium",
          blurb: "Northerly Island, skyline viewpoint",
          description:
            "The single best place in the city to photograph the lit skyline across the harbor.",
        },
        {
          lat: 41.8917,
          lng: -87.6086,
          title: "Navy Pier Ferris Wheel",
          blurb: "Pier entrance, Centennial Wheel",
        },
        {
          lat: 41.8789,
          lng: -87.6359,
          title: "Willis Tower",
          blurb: "Wacker and Jackson, lit crown",
        },
      ],
    },
  ],
};

/** Canonical tour with generated ids, matching createStop/createRoute output. */
function buildTour(source) {
  return {
    version: 2,
    id: source.id,
    title: source.title,
    subtitle: source.subtitle,
    tagline: source.tagline,
    description: source.description,
    routes: source.routes.map((route) => ({
      id: route.id,
      name: route.name,
      color: route.color,
      profile: route.profile,
      stops: route.stops.map((stop, si) => ({
        id: `stop_${route.id.replace(/^route_/, "")}_${String(si + 1).padStart(2, "0")}`,
        lat: stop.lat,
        lng: stop.lng,
        title: stop.title,
        ...(stop.blurb ? { blurb: stop.blurb } : {}),
        ...(stop.description ? { description: stop.description } : {}),
        ...(stop.imageUrl ? { imageUrl: stop.imageUrl } : {}),
      })),
    })),
    settings: source.settings,
  };
}

/** Strip a key from every route (structural clone, no mutation). */
function withoutRouteKey(tour, key) {
  return {
    ...tour,
    routes: tour.routes.map((route) => {
      const { [key]: _drop, ...rest } = route;
      return rest;
    }),
  };
}

/** Strip author copy from every stop, to show where the budget actually goes. */
function withoutStopKeys(tour, keys) {
  return {
    ...tour,
    routes: tour.routes.map((route) => ({
      ...route,
      stops: route.stops.map((stop) => {
        const out = { ...stop };
        for (const key of keys) delete out[key];
        return out;
      }),
    })),
  };
}

/**
 * Does a public endpoint actually honour the profile, or does it silently
 * serve one graph for every path segment? Two stops 610 m apart by car.
 */
const PROFILE_ENDPOINTS = [
  ["OSRM demo", "foot", "https://router.project-osrm.org/route/v1/foot"],
  ["OSRM demo", "bike", "https://router.project-osrm.org/route/v1/bike"],
  ["OSRM demo", "driving", "https://router.project-osrm.org/route/v1/driving"],
  ["FOSSGIS", "foot", "https://routing.openstreetmap.de/routed-foot/route/v1/foot"],
  ["FOSSGIS", "bike", "https://routing.openstreetmap.de/routed-bike/route/v1/bike"],
  ["FOSSGIS", "driving", "https://routing.openstreetmap.de/routed-car/route/v1/driving"],
];

async function probeProfiles() {
  const pair = "-87.6208,41.8896;-87.6245,41.8882"; // Sheraton → Michigan Ave Bridge
  const out = [];
  for (const [host, profile, base] of PROFILE_ENDPOINTS) {
    try {
      const res = await fetch(`${base}/${pair}?overview=false`);
      const body = await res.json();
      const route = body.routes?.[0];
      out.push({
        host,
        profile,
        status: res.status,
        code: body.code,
        distanceM: route ? Math.round(route.distance) : null,
        durationS: route ? Math.round(route.duration) : null,
        weightName: route?.weight_name ?? null,
      });
    } catch (error) {
      out.push({ host, profile, status: null, error: String(error) });
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return out;
}

function measure(label, tour, note = "") {
  const json = JSON.stringify(tour);
  const encoded = compressToEncodedURIComponent(json);
  const url = `${BASE_URL}${HASH_PREFIX}${encoded}`;
  return {
    label,
    note,
    jsonChars: json.length,
    encodedChars: encoded.length,
    urlChars: url.length,
    overWarn: url.length > SHARE_URL_WARN,
    overMax: url.length > SHARE_URL_MAX,
    pctOfMax: Math.round((url.length / SHARE_URL_MAX) * 1000) / 10,
  };
}

async function fetchGeometry(stops, profile, overview, geometries) {
  const coords = stops.map((s) => `${s.lng},${s.lat}`).join(";");
  const url = `${OSRM}/${profile}/${coords}?overview=${overview}&geometries=${geometries}`;
  const res = await fetch(url, { headers: { "User-Agent": "tour-brochure-builder/adr-measurement" } });
  if (!res.ok) throw new Error(`OSRM ${res.status} for ${profile}/${overview}/${geometries}`);
  const body = await res.json();
  if (body.code !== "Ok") throw new Error(`OSRM ${body.code}: ${body.message ?? ""}`);
  const route = body.routes[0];
  return {
    geometry: route.geometry,
    distanceKm: Math.round(route.distance / 100) / 10,
    points:
      geometries === "geojson"
        ? route.geometry.coordinates.length
        : countPolylinePoints(route.geometry),
  };
}

/** Number of vertices in an encoded polyline, without fully decoding it. */
function countPolylinePoints(encoded) {
  let points = 0;
  let terminators = 0;
  for (const ch of encoded) {
    if (ch.charCodeAt(0) - 63 < 0x20) terminators++;
  }
  points = terminators / 2;
  return points;
}

/** Round every coordinate to 5 decimals (~1.1 m) — the cheap GeoJSON variant. */
function roundCoords(coordinates, decimals) {
  const f = 10 ** decimals;
  return coordinates.map(([lng, lat]) => [
    Math.round(lng * f) / f,
    Math.round(lat * f) / f,
  ]);
}

async function main() {
  const offline = process.argv.includes("--offline");
  if (offline) {
    const report = JSON.parse(readFileSync(REPORT, "utf8"));
    print(report);
    return;
  }

  const tour = buildTour(TOUR_SOURCE);
  const stopCount = tour.routes.reduce((n, r) => n + r.stops.length, 0);

  // --- Option B and its variants -----------------------------------------
  const rows = [];
  rows.push(
    measure(
      "B  stops + profile (CHOSEN)",
      tour,
      "geometry recomputed on load, cached in sessionStorage",
    ),
  );
  rows.push(
    measure(
      "   v2 baseline, no profile",
      withoutRouteKey(tour, "profile"),
      "what today's build emits; the delta is the cost of the profile field",
    ),
  );
  rows.push(
    measure(
      "   B minus stop descriptions",
      withoutStopKeys(tour, ["description"]),
      "shows how much of the budget is author prose",
    ),
  );
  rows.push(
    measure(
      "   B coords + titles only",
      withoutStopKeys(tour, ["description", "blurb", "imageUrl"]),
      "irreducible floor: ids, coordinates, titles, route metadata",
    ),
  );

  // --- Fetch real road geometry for every route ---------------------------
  const full5 = [];
  const full6 = [];
  const simplified5 = [];
  const geojson = [];
  for (const route of tour.routes) {
    const p = route.profile;
    const [a, b, c, d] = await Promise.all([
      fetchGeometry(route.stops, p, "full", "polyline"),
      fetchGeometry(route.stops, p, "full", "polyline6"),
      fetchGeometry(route.stops, p, "simplified", "polyline"),
      fetchGeometry(route.stops, p, "full", "geojson"),
    ]);
    full5.push(a);
    full6.push(b);
    simplified5.push(c);
    geojson.push(d);
    await new Promise((r) => setTimeout(r, 600)); // be polite to the demo server
  }

  const attach = (variants, key, pick) => ({
    ...tour,
    routes: tour.routes.map((route, i) => ({ ...route, [key]: pick(variants[i]) })),
  });

  rows.push(
    measure(
      "A  + polyline5 geometry, full",
      attach(full5, "geometry", (g) => g.geometry),
      "OSRM overview=full, geometries=polyline",
    ),
  );
  rows.push(
    measure(
      "A  + polyline6 geometry, full",
      attach(full6, "geometry", (g) => g.geometry),
      "higher precision, strictly larger",
    ),
  );
  rows.push(
    measure(
      "A- + polyline5 geometry, simplified",
      attach(simplified5, "geometry", (g) => g.geometry),
      "OSRM overview=simplified — visibly coarser at city-block zoom",
    ),
  );
  rows.push(
    measure(
      "A  + raw GeoJSON coords (worst case)",
      attach(geojson, "geometry", (g) => roundCoords(g.geometry.coordinates, 5)),
      "number arrays, 5 decimals — what a naive implementation stores",
    ),
  );

  const profileProbe = await probeProfiles();

  const report = {
    generatedAt: new Date().toISOString(),
    source: "https://router.project-osrm.org (public demo server)",
    profileProbe,
    budget: { warn: SHARE_URL_WARN, max: SHARE_URL_MAX, baseUrl: BASE_URL, hashPrefix: HASH_PREFIX },
    tour: {
      title: tour.title,
      routes: tour.routes.map((r, i) => ({
        name: r.name,
        profile: r.profile,
        stops: r.stops.length,
        roadKm: full5[i].distanceKm,
        geometryPoints: geojson[i].points,
        polyline5Chars: full5[i].geometry.length,
        polyline6Chars: full6[i].geometry.length,
        simplifiedPoints: simplified5[i].points,
        simplified5Chars: simplified5[i].geometry.length,
      })),
      totalStops: stopCount,
    },
    rows,
  };

  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  print(report);
  console.log(`\nwrote ${REPORT}`);
}

function print(report) {
  console.log(`Chicago reference tour — ${report.tour.totalStops} stops across ${report.tour.routes.length} routes`);
  console.log(`budget: warn ${report.budget.warn} / max ${report.budget.max} URL chars`);
  console.log(`measured ${report.generatedAt} against ${report.source}\n`);

  console.log("per route:");
  for (const r of report.tour.routes) {
    console.log(
      `  ${r.name.padEnd(12)} ${String(r.stops).padStart(2)} stops  ${String(r.roadKm).padStart(5)} km  ` +
        `${String(r.geometryPoints).padStart(4)} pts  polyline5 ${String(r.polyline5Chars).padStart(5)}c  ` +
        `polyline6 ${String(r.polyline6Chars).padStart(5)}c  simplified ${String(r.simplified5Chars).padStart(4)}c (${r.simplifiedPoints} pts)`,
    );
  }

  if (report.profileProbe) {
    console.log("\nprofile support probe (Sheraton -> Michigan Ave Bridge):");
    for (const probe of report.profileProbe) {
      console.log(
        `  ${probe.host.padEnd(10)} ${probe.profile.padEnd(8)} http=${probe.status} ${String(probe.code)}  ` +
          `${String(probe.distanceM).padStart(5)} m  ${String(probe.durationS).padStart(5)} s  weight=${probe.weightName}`,
      );
    }
  }

  console.log("\nshare URL length:");
  console.log(`  ${"variant".padEnd(38)} ${"json".padStart(7)} ${"lz".padStart(7)} ${"url".padStart(7)}  ${"% of 8k".padStart(8)}  verdict`);
  for (const row of report.rows) {
    const verdict = row.overMax ? "OVER MAX" : row.overWarn ? "over warn" : "ok";
    console.log(
      `  ${row.label.padEnd(38)} ${String(row.jsonChars).padStart(7)} ${String(row.encodedChars).padStart(7)} ` +
        `${String(row.urlChars).padStart(7)}  ${String(row.pctOfMax).padStart(7)}%  ${verdict}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
