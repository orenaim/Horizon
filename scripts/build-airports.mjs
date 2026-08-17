import { mkdir, readFile, writeFile } from "node:fs/promises";

// Bakes real-world airport geometry into the simulator's world coordinates.
//
//   Runway thresholds  OurAirports (public domain), derived from FAA/national AIP data
//   Ground features    OpenStreetMap via Overpass (ODbL)
//
// The projection is read back out of the terrain metadata so airports land on
// exactly the same grid as the USGS elevation model.

const runwaySource = "https://davidmegginson.github.io/ourairports-data/runways.csv";
const overpassMirrors = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const outputDirectory = new URL("../public/airports/", import.meta.url);

const FEET_TO_METRES = 0.3048;

// Each flyable area is its own world with its own projection, so airports are
// baked per area against that area's terrain metadata. `terrain` names the
// metadata that fixes the frame; for an area spanning several meshes it is
// whichever one the others were projected against.
//
// Field elevations are the published aerodrome elevations, which the graded
// airfield pads are levelled to.
const REGIONS = [
  {
    id: "hawaii",
    terrain: "oahu-terrain.json",
    output: "hawaii-airports.json",
    airfields: [
      {
        code: "PHNL",
        name: "Daniel K. Inouye International",
        elevationFt: 13,
        bounds: [21.295, -157.96, 21.348, -157.884],
        primaryRunway: "08R",
      },
      {
        code: "PHJR",
        name: "Kalaeloa (John Rodgers Field)",
        elevationFt: 33,
        bounds: [21.293, -158.09, 21.325, -158.048],
        primaryRunway: "04R",
      },
      {
        code: "PHDH",
        name: "Dillingham Airfield",
        elevationFt: 14,
        bounds: [21.569, -158.225, 21.59, -158.168],
        primaryRunway: "08",
      },
      {
        code: "PHLI",
        name: "Līhuʻe Airport",
        elevationFt: 153,
        bounds: [21.95, -159.385, 22.005, -159.305],
        primaryRunway: "03",
      },
      {
        code: "PHPA",
        name: "Port Allen Airport",
        elevationFt: 24,
        bounds: [21.88, -159.625, 21.915, -159.575],
        primaryRunway: "09",
      },
    ],
  },
  {
    id: "grand-canyon",
    terrain: "grand-canyon-terrain.json",
    output: "grand-canyon-airports.json",
    airfields: [
      {
        code: "KGCN",
        name: "Grand Canyon National Park Airport",
        elevationFt: 6609,
        bounds: [35.938, -112.166, 35.968, -112.128],
        primaryRunway: "03",
      },
    ],
  },
  {
    id: "grand-teton",
    terrain: "grand-teton-terrain.json",
    output: "grand-teton-airports.json",
    airfields: [
      {
        code: "KJAC",
        name: "Jackson Hole Airport",
        elevationFt: 6451,
        bounds: [43.594, -110.748, 43.622, -110.727],
        primaryRunway: "01",
      },
      {
        code: "KDIJ",
        name: "Driggs-Reed Memorial Airport",
        elevationFt: 6229,
        bounds: [43.731, -111.114, 43.756, -111.086],
        primaryRunway: "04",
      },
    ],
  },
  {
    id: "rainier",
    terrain: "rainier-terrain.json",
    output: "rainier-airports.json",
    airfields: [
      {
        code: "KPLU",
        name: "Pierce County–Thun Field",
        elevationFt: 538,
        bounds: [47.095, -122.294, 47.113, -122.28],
        primaryRunway: "17",
      },
      {
        code: "55S",
        name: "Packwood Airport",
        elevationFt: 1057,
        bounds: [46.597, -121.685, 46.611, -121.674],
        primaryRunway: "01",
      },
      {
        code: "39P",
        name: "Strom Field",
        elevationFt: 941,
        bounds: [46.546, -122.274, 46.556, -122.259],
        primaryRunway: "07",
      },
    ],
  },
  {
    id: "moab",
    terrain: "moab-terrain.json",
    output: "moab-airports.json",
    airfields: [
      {
        code: "KCNY",
        name: "Canyonlands Regional Airport",
        elevationFt: 4557,
        bounds: [38.742, -109.77, 38.772, -109.742],
        primaryRunway: "03",
      },
      {
        code: "UT53",
        name: "Sky Ranch Airport",
        elevationFt: 4875,
        bounds: [38.48, -109.459, 38.496, -109.439],
        primaryRunway: "12",
      },
    ],
  },
  {
    id: "tahoe",
    terrain: "tahoe-terrain.json",
    output: "tahoe-airports.json",
    airfields: [
      {
        code: "KTVL",
        name: "Lake Tahoe Airport",
        elevationFt: 6264,
        bounds: [38.878, -120.003, 38.908, -119.983],
        primaryRunway: "18",
      },
      {
        code: "KTRK",
        name: "Truckee Tahoe Airport",
        elevationFt: 5900,
        bounds: [39.31, -120.158, 39.331, -120.125],
        primaryRunway: "11",
      },
      {
        code: "KMEV",
        name: "Minden-Tahoe Airport",
        elevationFt: 4722,
        bounds: [38.994, -119.766, 39.016, -119.744],
        primaryRunway: "16",
      },
      {
        code: "KCXP",
        name: "Carson Airport",
        elevationFt: 4697,
        bounds: [39.186, -119.752, 39.203, -119.719],
        primaryRunway: "09",
      },
    ],
  },
];

// One world unit is ten metres, matching the terrain and flight model.
const METRES_TO_WORLD = 0.1;

/** Equirectangular projection for one area, read out of its terrain metadata. */
function projector({ sourceBounds, worldSize }) {
  const [minLongitude, minLatitude, maxLongitude, maxLatitude] = sourceBounds;
  const [worldWidth, worldDepth] = worldSize;
  return (longitude, latitude) => [
    ((longitude - minLongitude) / (maxLongitude - minLongitude) - 0.5) * worldWidth,
    ((maxLatitude - latitude) / (maxLatitude - minLatitude) - 0.5) * worldDepth,
  ];
}

const round = (value, places = 2) => Number(value.toFixed(places));
const roundPoint = ([x, z]) => [round(x), round(z)];

async function fetchWithRetry(label, attempt, tries = 4) {
  let lastError;
  for (let index = 0; index < tries; index += 1) {
    try {
      return await attempt(index);
    } catch (error) {
      lastError = error;
      const wait = 4000 * (index + 1);
      console.warn(`  ${label}: attempt ${index + 1} failed (${error.message}); retrying in ${wait / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw lastError;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") field += character;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  return rows
    .filter((entry) => entry.length === header.length)
    .map((entry) => Object.fromEntries(header.map((key, column) => [key, entry[column]])));
}

console.log("Fetching runway thresholds from OurAirports");
const runwayRows = await fetchWithRetry("runways.csv", async () => {
  const response = await fetch(runwaySource);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseCsv(await response.text());
});

async function queryOverpass(query) {
  return fetchWithRetry("overpass", async (attempt) => {
    const endpoint = overpassMirrors[attempt % overpassMirrors.length];
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // Overpass rejects requests from unidentified clients with 406.
        "User-Agent": "horizon-flight/0.1 (scenery build script)",
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(240000),
    });
    const text = await response.text();
    if (!response.ok || !text.startsWith("{")) {
      throw new Error(text.includes("too busy") ? "server busy" : `HTTP ${response.status}`);
    }
    return JSON.parse(text);
  });
}

// Bearing between two geographic points, in degrees true.
function bearing([lon1, lat1], [lon2, lat2]) {
  const toRadians = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * toRadians) * Math.cos(lat2 * toRadians);
  const x =
    Math.cos(lat1 * toRadians) * Math.sin(lat2 * toRadians) -
    Math.sin(lat1 * toRadians) * Math.cos(lat2 * toRadians) * Math.cos((lon2 - lon1) * toRadians);
  return (Math.atan2(y, x) / toRadians + 360) % 360;
}

const number = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function buildRunways(code, fieldElevationM, toWorld) {
  const rows = runwayRows.filter((row) => row.airport_ident === code && row.closed !== "1");
  return rows.filter((row) => {
    // OurAirports carries some strips — usually unpaved glider and ultralight
    // runways, such as Minden's 12G/30G — with no surveyed thresholds at all.
    // Projecting a missing coordinate puts the runway a thousand kilometres off
    // the airfield, which then drags the imagery inset's bounding box out with
    // it, so they are dropped rather than placed at a guess.
    const placed = ["le_longitude_deg", "le_latitude_deg", "he_longitude_deg", "he_latitude_deg"]
      .every((key) => number(row[key]) != null);
    if (!placed) {
      console.warn(`  ${code} ${row.le_ident}/${row.he_ident}: no surveyed thresholds, skipped`);
    }
    return placed;
  }).map((row) => {
    const lowLon = number(row.le_longitude_deg);
    const lowLat = number(row.le_latitude_deg);
    const highLon = number(row.he_longitude_deg);
    const highLat = number(row.he_latitude_deg);
    const surface = row.surface.toUpperCase();
    const water = surface.includes("WATER");
    // Published headings are integer-rounded; the threshold pair is the more
    // precise source, so prefer the geodesic bearing when both ends are known.
    const trueHeading = lowLon != null && highLon != null
      ? bearing([lowLon, lowLat], [highLon, highLat])
      : number(row.le_heading_degT) ?? 0;
    const lowElevation = number(row.le_elevation_ft);
    const highElevation = number(row.he_elevation_ft);
    return {
      designator: `${row.le_ident}/${row.he_ident}`,
      water,
      lighted: row.lighted === "1",
      surface,
      lengthM: round(number(row.length_ft) * FEET_TO_METRES, 1),
      widthM: round(number(row.width_ft) * FEET_TO_METRES, 1),
      headingTrue: round(trueHeading, 2),
      ends: [
        {
          ident: row.le_ident,
          world: roundPoint(toWorld(lowLon, lowLat)),
          elevationM: round(lowElevation != null ? lowElevation * FEET_TO_METRES : fieldElevationM, 2),
          displacedM: round((number(row.le_displaced_threshold_ft) ?? 0) * FEET_TO_METRES, 1),
        },
        {
          ident: row.he_ident,
          world: roundPoint(toWorld(highLon, highLat)),
          elevationM: round(highElevation != null ? highElevation * FEET_TO_METRES : fieldElevationM, 2),
          displacedM: round((number(row.he_displaced_threshold_ft) ?? 0) * FEET_TO_METRES, 1),
        },
      ],
    };
  });
}

// Storey height used to turn `building:levels` into metres. Airport structures
// run taller than housing stock, but 3.6 m is the OSM-wide convention and
// overshooting reads worse from the air than undershooting.
const METRES_PER_LEVEL = 3.6;

// Metres of extrusion for an OSM footprint, falling back to typical heights per
// feature class when the building is untagged.
function featureHeight(tags, kind) {
  const explicit = number(tags.height ?? tags["building:height"]);
  if (explicit) return explicit;
  const levels = number(tags["building:levels"]);
  if (levels) return levels * METRES_PER_LEVEL;
  if (kind === "tower") return 40;
  if (kind === "terminal") return 16;
  if (kind === "hangar") return 14;
  if (kind === "parking") return 15;
  return 8;
}

// Roof shapes the runtime knows how to build. Anything else OSM offers is
// mapped onto the nearest one rather than silently falling back to flat, since
// a wrong pitch still reads better than a slab.
const ROOF_SHAPES = new Set(["flat", "gabled", "hipped", "skillion", "round"]);

const ROOF_ALIASES = {
  pyramidal: "hipped",
  "half-hipped": "hipped",
  gambrel: "gabled",
  mansard: "hipped",
  saltbox: "gabled",
  "side_hipped": "hipped",
  dome: "round",
  onion: "round",
  barrel: "round",
  arched: "round",
  "double_saltbox": "gabled",
  "quadruple_saltbox": "gabled",
  "lean_to": "skillion",
  "shed": "skillion",
};

// Untagged roofs get the shape typical of their class. Hangars are the one that
// matters: a barrel or gabled span is what makes a hangar legible as a hangar
// from the air, and a flat-topped box never will be.
const DEFAULT_ROOF_SHAPE = {
  hangar: "round",
  terminal: "flat",
  parking: "flat",
  tower: "flat",
  building: "flat",
};

/**
 * Roof shape, rise, and ridge orientation for a footprint.
 *
 * `heightM` is measured down from the total building height, matching the OSM
 * Simple 3D Buildings convention, so walls stand at `height - roof.heightM`.
 */
function featureRoof(tags, kind, ring, totalHeight) {
  const raw = (tags["roof:shape"] ?? "").toLowerCase();
  const shape = ROOF_SHAPES.has(raw)
    ? raw
    : ROOF_ALIASES[raw] ?? DEFAULT_ROOF_SHAPE[kind] ?? "flat";
  if (shape === "flat") return { shape: "flat", heightM: 0, orientation: null };

  const explicit = number(tags["roof:height"]);
  const levels = number(tags["roof:levels"]);
  let rise = explicit ?? (levels != null ? levels * METRES_PER_LEVEL : null);

  if (rise == null) {
    // Pitch scales with the span the roof has to cross, which is the short axis
    // of the footprint for a ridge running down the long one. A quarter of the
    // span is roughly a 27-degree pitch — typical for a large clear-span shed.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    // Rings are in world units of ten metres.
    const span = Math.min(maxX - minX, maxZ - minZ) * 10;
    rise = shape === "skillion" ? span * 0.12 : span * 0.25;
  }

  // A roof that eats the whole building leaves no wall to stand on.
  rise = Math.max(0.5, Math.min(rise, totalHeight * 0.6, 14));
  const orientation = tags["roof:orientation"] === "across" ? "across" : "along";
  return { shape, heightM: round(rise, 1), orientation };
}

// OSM colours are either hex or a CSS colour name. Only the names that actually
// turn up on building tagging are worth carrying.
const COLOUR_NAMES = {
  white: "#e8e6e0",
  grey: "#9b9b96",
  gray: "#9b9b96",
  silver: "#c0c0bb",
  black: "#3a3a38",
  brown: "#7a6046",
  beige: "#d6c9ad",
  cream: "#e4dcc4",
  tan: "#c8ab7d",
  red: "#9c3b31",
  darkred: "#6f2a23",
  blue: "#3f5f86",
  lightblue: "#8fa8c4",
  green: "#4a6b4c",
  yellow: "#d3b64a",
  sand: "#d2bd94",
  concrete: "#b8b6b0",
};

function colour(value) {
  if (!value) return null;
  const text = String(value).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  }
  return COLOUR_NAMES[text] ?? null;
}

function classify(tags) {
  if (tags.aeroway === "terminal") return "terminal";
  if (tags.aeroway === "hangar") return "hangar";
  if (tags.aeroway === "tower" || tags.man_made === "tower") return "tower";
  if (tags.building === "hangar") return "hangar";
  if (tags.building === "parking" || tags.parking === "multi-storey") return "parking";
  return "building";
}

const signedArea = (ring) => {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, z1] = ring[index];
    const [x2, z2] = ring[(index + 1) % ring.length];
    total += x1 * z2 - x2 * z1;
  }
  return total / 2;
};

// Drop collinear/duplicate vertices so the runtime extrudes fewer triangles.
function simplify(ring, tolerance) {
  const output = [];
  for (const point of ring) {
    const previous = output[output.length - 1];
    if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > tolerance) {
      output.push(point);
    }
  }
  if (output.length > 2) {
    const first = output[0];
    const last = output[output.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= tolerance) output.pop();
  }
  return output;
}

async function buildGroundFeatures(field, toWorld) {
  const geometryToWorld = (geometry) => geometry.map(({ lon, lat }) => toWorld(lon, lat));
  const [south, west, north, east] = field.bounds;
  const box = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:200];
(
  way["aeroway"~"^(terminal|hangar|apron|taxiway|taxilane|runway|tower|helipad|aerodrome|parking_position)$"](${box});
  way["building"](${box});
  way["man_made"="tower"](${box});
  node["aeroway"~"^(windsock|tower|navigationaid|gate)$"](${box});
);
out geom;`;

  const data = await queryOverpass(query);
  const buildings = [];
  const pavements = [];
  const taxiways = [];
  const stands = [];
  const markers = [];
  let boundary = null;

  for (const element of data.elements) {
    const tags = element.tags ?? {};
    if (element.type === "node") {
      markers.push({
        kind: tags.aeroway,
        name: tags.ref ?? tags.name ?? null,
        world: roundPoint(toWorld(element.lon, element.lat)),
      });
      continue;
    }
    if (!element.geometry || element.geometry.length < 2) continue;
    const points = geometryToWorld(element.geometry);
    const closed = points.length > 3 &&
      Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < 0.2;

    if (tags.aeroway === "aerodrome") {
      if (closed) boundary = simplify(points, 2).map(roundPoint);
      continue;
    }

    if (tags.aeroway === "taxiway" || tags.aeroway === "taxilane") {
      // OSM maps taxiways as centrelines; width falls back to a typical
      // 23 m taxiway for airline aircraft, 15 m for a taxilane.
      taxiways.push({
        widthM: number(tags.width) ?? (tags.aeroway === "taxilane" ? 15 : 23),
        name: tags.ref ?? tags.name ?? null,
        path: simplify(points, 1.2).map(roundPoint),
      });
      continue;
    }

    // Stand centrelines. OSM maps these as the lead-in line an aircraft's nose
    // gear follows onto the stand, so the ref is the gate number painted on it.
    if (tags.aeroway === "parking_position") {
      stands.push({
        ref: tags.ref ?? tags.name ?? null,
        aircraft: tags.aircraft ?? null,
        path: simplify(points, 0.6).map(roundPoint),
      });
      continue;
    }

    if (tags.aeroway === "apron" || tags.aeroway === "helipad") {
      if (!closed) continue;
      pavements.push({
        kind: tags.aeroway,
        polygon: simplify(points, 1.5).map(roundPoint),
      });
      continue;
    }

    if (tags.aeroway === "runway") continue; // Threshold data is authoritative.

    if (!closed) continue;
    const kind = classify(tags);
    const ring = simplify(points, 0.8);
    if (ring.length < 3) continue;
    // Skip slivers; small sheds add draw calls without reading at flight scale.
    const area = Math.abs(signedArea(ring)) * 100;
    if (area < 220) continue;
    const heightM = round(featureHeight(tags, kind), 1);
    const levels = number(tags["building:levels"]);
    buildings.push({
      // OSM way id, so a hand-authored landmark model can override this
      // footprint by id without depending on array order.
      id: element.id,
      kind,
      name: tags.name ?? null,
      heightM,
      // Floor count drives the window banding on the procedural facade. Derive
      // it from the height when untagged rather than leaving the facade blank.
      levels: levels ?? Math.max(1, Math.round(heightM / METRES_PER_LEVEL)),
      roof: featureRoof(tags, kind, ring, heightM),
      wallColor: colour(tags["building:colour"]),
      roofColor: colour(tags["roof:colour"]),
      material: tags["building:material"] ?? null,
      roofMaterial: tags["roof:material"] ?? null,
      area: Math.round(area),
      polygon: (signedArea(ring) < 0 ? ring.slice().reverse() : ring).map(roundPoint),
    });
  }

  buildings.sort((a, b) => b.area - a.area);
  return { boundary, buildings, pavements, taxiways, stands, markers };
}

await mkdir(outputDirectory, { recursive: true });

const only = process.argv[2];
for (const region of REGIONS) {
  if (only && region.id !== only) continue;
  const metadata = JSON.parse(
    await readFile(new URL(`../public/terrain/${region.terrain}`, import.meta.url), "utf8"),
  );
  const toWorld = projector(metadata);
  console.log(`\n${region.id}`);

  const airports = [];
  for (const field of region.airfields) {
    console.log(`Building ${field.code}`);
    const elevationM = field.elevationFt * FEET_TO_METRES;
    const runways = buildRunways(field.code, elevationM, toWorld);
    const ground = await buildGroundFeatures(field, toWorld);
    const paved = runways.filter((runway) => !runway.water);
    const centre = paved.length
      ? paved
          .flatMap((runway) => runway.ends.map((end) => end.world))
          .reduce(
            (total, [x, z], _index, list) => [total[0] + x / list.length, total[1] + z / list.length],
            [0, 0],
          )
      : [0, 0];

    console.log(
      `  ${runways.length} runways (${paved.length} paved), ${ground.buildings.length} buildings, ` +
        `${ground.taxiways.length} taxiways, ${ground.pavements.length} aprons, ` +
        `${ground.stands.length} stands`,
    );

    airports.push({
      code: field.code,
      name: field.name,
      elevationM: round(elevationM, 2),
      primaryRunway: field.primaryRunway,
      centre: roundPoint(centre),
      runways,
      ...ground,
    });
  }

  const output = {
    generated: new Date().toISOString().slice(0, 10),
    sources: {
      runways: "OurAirports (public domain)",
      ground: "OpenStreetMap contributors (ODbL 1.0)",
    },
    projection: {
      sourceBounds: metadata.sourceBounds,
      worldSize: metadata.worldSize,
      metresToWorld: METRES_TO_WORLD,
    },
    airports,
  };
  await writeFile(new URL(region.output, outputDirectory), `${JSON.stringify(output)}\n`);
  console.log(`Wrote ${airports.length} airports to ${region.output}`);
}
