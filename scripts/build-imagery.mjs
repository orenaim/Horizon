import { mkdir, readFile, writeFile } from "node:fs/promises";

// Bakes georeferenced aerial imagery for every flyable area and airfield.
//
// Source: USGS "NAIP Plus" orthoimagery, served by The National Map. It is US
// federal work in the public domain, so unlike Google Earth or Maps imagery it
// can be redistributed inside a custom renderer. See README for the reasoning.
//
// The service caps a single export at 4000x4000 px. Each terrain mesh fits in
// one request, so no tile stitching (and no image library) is needed.

const imageService =
  "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage";

// Areas are separate worlds with separate projections, so each one's airfield
// insets are placed against its own reference terrain. `reference` names the
// mesh whose frame the area's airport coordinates were baked in.
const REGIONS = [
  {
    id: "hawaii",
    terrains: ["oahu-terrain.json", "kauai-terrain.json"],
    reference: "oahu-terrain.json",
    airports: "hawaii-airports.json",
  },
  {
    id: "grand-canyon",
    terrains: ["grand-canyon-terrain.json", "grand-canyon-far-terrain.json"],
    reference: "grand-canyon-terrain.json",
    airports: "grand-canyon-airports.json",
  },
  {
    id: "grand-teton",
    terrains: ["grand-teton-terrain.json", "grand-teton-far-terrain.json"],
    reference: "grand-teton-terrain.json",
    airports: "grand-teton-airports.json",
  },
  {
    id: "rainier",
    terrains: ["rainier-terrain.json", "rainier-far-terrain.json"],
    reference: "rainier-terrain.json",
    airports: "rainier-airports.json",
  },
  {
    id: "moab",
    terrains: ["moab-terrain.json", "moab-far-terrain.json"],
    reference: "moab-terrain.json",
    airports: "moab-airports.json",
  },
  {
    id: "tahoe",
    terrains: ["tahoe-terrain.json", "tahoe-far-terrain.json"],
    reference: "tahoe-terrain.json",
    airports: "tahoe-airports.json",
  },
];

const outputDirectory = new URL("../public/imagery/", import.meta.url);

const GROUND_WIDTH = 4000;
// Airfields are flown over at low level, so they get the finest export the
// service allows (roughly two metres per pixel).
const AIRPORT_WIDTH = 4000;
// World units of padding around an airfield's runway envelope.
const AIRPORT_MARGIN = 90;
const MAX_SERVICE_PIXELS = 4000;

// The export is requested in EPSG:4326, so a pixel is a fixed number of degrees
// in each axis and the requested pixel grid has to have the same aspect as the
// bounding box measured in degrees. Sizing it by the world aspect instead —
// which carries the cos(latitude) factor that turns degrees into metres —
// leaves the two 7% apart, and the service silently widens the bounding box
// about its centre until it fits. That is what put the Oʻahu photograph a
// kilometre and a half north of the terrain along the south shore.
function exportSize(width, [west, south, east, north]) {
  const height = Math.round(width * ((north - south) / (east - west)));
  if (height <= MAX_SERVICE_PIXELS) return [width, height];
  return [Math.round(MAX_SERVICE_PIXELS * ((east - west) / (north - south))), MAX_SERVICE_PIXELS];
}

const readTerrain = (name) =>
  readFile(new URL(`../public/terrain/${name}`, import.meta.url), "utf8").then(JSON.parse);

const fetchWithRetry = async (url, label) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(300000),
        headers: { "User-Agent": "horizon-flight/0.1 (scenery build script)" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      console.warn(`  ${label}: attempt ${attempt + 1} failed (${error.message})`);
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
    }
  }
  throw new Error("unreachable");
};

async function exportImage(name, bounds, width, height) {
  const [west, south, east, north] = bounds;
  const parameters = new URLSearchParams({
    bbox: `${west},${south},${east},${north}`,
    bboxSR: "4326",
    imageSR: "4326",
    size: `${width},${height}`,
    format: "jpg",
    compressionQuality: "84",
    interpolation: "RSP_BilinearInterpolation",
    // Asking for the metadata first is what makes the georeferencing checkable:
    // the response reports the extent the service actually rendered, so a
    // silently widened bounding box fails the build instead of shipping a
    // photograph that sits a kilometre off the terrain.
    f: "json",
  });
  const described = await (await fetchWithRetry(`${imageService}?${parameters}`, name)).json();
  if (!described.href) throw new Error(`no image returned: ${JSON.stringify(described).slice(0, 200)}`);
  const { xmin, ymin, xmax, ymax } = described.extent;
  const drift = Math.max(
    Math.abs(xmin - west), Math.abs(xmax - east),
    Math.abs(ymin - south), Math.abs(ymax - north),
  );
  // Rounding the pixel count to an integer leaves the requested aspect a
  // fraction of a pixel off true, and the service nudges the box to match. One
  // pixel of slack absorbs that while still catching a rewritten frame.
  const tolerance = Math.min((east - west) / width, (north - south) / height);
  if (drift > tolerance) {
    throw new Error(
      `${name}: service rendered ${xmin},${ymin},${xmax},${ymax} instead of the requested `
      + `${west},${south},${east},${north} — the requested pixel size does not match the `
      + "bounding box aspect in degrees",
    );
  }

  const buffer = Buffer.from(await (await fetchWithRetry(described.href, name)).arrayBuffer());
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error(`not a JPEG: ${buffer.subarray(0, 160).toString("utf8")}`);
  }
  await writeFile(new URL(`${name}.jpg`, outputDirectory), buffer);
  console.log(`  ${name}.jpg  ${width}x${height}  ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
  return buffer.length;
}

await mkdir(outputDirectory, { recursive: true });

// One manifest covers every area; the runtime picks out the layers belonging to
// whichever one is resident.
const existing = await readFile(new URL("manifest.json", outputDirectory), "utf8")
  .then(JSON.parse)
  .catch(() => ({ layers: [] }));
const only = process.argv[2];
const layers = only ? existing.layers.filter((layer) => layer.region !== only) : [];

for (const region of REGIONS) {
  if (only && region.id !== only) continue;
  console.log(`\n${region.id}`);

  const terrains = await Promise.all(region.terrains.map(readTerrain));
  for (const terrain of terrains) {
    const [width, depth] = terrain.worldSize;
    await exportImage(terrain.id, terrain.sourceBounds, ...exportSize(GROUND_WIDTH, terrain.sourceBounds));
    layers.push({
      kind: "ground",
      region: region.id,
      name: terrain.id,
      bounds: terrain.worldBounds ?? [-width / 2, -depth / 2, width / 2, depth / 2],
    });
  }

  const reference = terrains.find(({ id }) => `${id}-terrain.json` === region.reference) ?? terrains[0];
  const [minLongitude, minLatitude, maxLongitude, maxLatitude] = reference.sourceBounds;
  const [worldWidth, worldDepth] = reference.worldSize;
  const toLongitude = (x) => minLongitude + (x / worldWidth + 0.5) * (maxLongitude - minLongitude);
  const toLatitude = (z) => maxLatitude - (z / worldDepth + 0.5) * (maxLatitude - minLatitude);

  let airportData = null;
  try {
    airportData = JSON.parse(
      await readFile(new URL(`../public/airports/${region.airports}`, import.meta.url), "utf8"),
    );
  } catch {
    console.warn(`  no airport data for ${region.id}; run \`npm run airports:build\` first.`);
  }

  for (const airport of airportData?.airports ?? []) {
    const points = airport.runways
      .filter((runway) => !runway.water)
      .flatMap((runway) => runway.ends.map((end) => end.world))
      .concat(airport.pavements.flatMap((pavement) => pavement.polygon));
    if (!points.length) continue;

    const west = Math.min(...points.map(([x]) => x)) - AIRPORT_MARGIN;
    const east = Math.max(...points.map(([x]) => x)) + AIRPORT_MARGIN;
    const north = Math.min(...points.map(([, z]) => z)) - AIRPORT_MARGIN;
    const south = Math.max(...points.map(([, z]) => z)) + AIRPORT_MARGIN;

    const bounds = [toLongitude(west), toLatitude(south), toLongitude(east), toLatitude(north)];
    console.log(`Exporting ${airport.code} inset (${Math.round((east - west) * 10)} m wide)`);
    await exportImage(airport.code, bounds, ...exportSize(AIRPORT_WIDTH, bounds));
    layers.push({
      kind: "airport",
      region: region.id,
      name: airport.code,
      bounds: [west, north, east, south].map((v) => Number(v.toFixed(2))),
    });
  }
}

await writeFile(
  new URL("manifest.json", outputDirectory),
  `${JSON.stringify(
    {
      source: "USGS NAIP Plus orthoimagery via The National Map (public domain)",
      generated: new Date().toISOString().slice(0, 10),
      // Bounds are [west, north, east, south] in world units, matching the
      // terrain's x/z axes so the runtime can map them straight onto UVs.
      layers,
    },
    null,
    2,
  )}\n`,
);
console.log(`\nWrote ${layers.length} imagery layers`);
