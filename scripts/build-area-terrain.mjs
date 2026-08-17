import { mkdir, writeFile } from "node:fs/promises";
import { fromArrayBuffer } from "geotiff";

// Terrain for one flyable area: a detail mesh over the area itself, and a
// coarse mesh carrying the ground out to the horizon. See README, "Areas
// without a coast".
//
// Unlike the Oʻahu, Kauaʻi and Grand Canyon builders this one needs nothing in
// `data/raw/`. Those read one-degree 1/3 arc-second tiles off disk, which for a
// box like Tahoe's would be four downloads of four hundred megabytes each — and
// every one of them resampled straight back down to eighty metres. The 3DEP
// image service does that resampling server-side, so the same ground arrives as
// two requests totalling about thirty megabytes. New areas belong here.
//
//   node scripts/build-area-terrain.mjs tahoe
const elevationService =
  "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage";
const outputDirectory = new URL("../public/terrain/", import.meta.url);

const AREAS = {
  tahoe: {
    name: "Lake Tahoe",
    farName: "Sierra Nevada",
    // South Lake Tahoe up to Truckee, and east far enough to give Minden and
    // Carson room to depart into. The whole lake sits inside it.
    bounds: [-120.35, 38.78, -119.62, 39.44],
    samplesX: 721,
    airports: {
      KTVL: [-119.995, 38.8939],
      KTRK: [-120.1406, 39.3186],
      KMEV: [-119.751, 39.0003],
      KCXP: [-119.7343, 39.1943],
    },
  },
  rainier: {
    name: "Mount Rainier",
    farName: "Cascade Range",
    // The volcano centred, with room west to Thun Field in the Puyallup lowland
    // and south-east to the strip at Packwood. Stops short of Puget Sound, so
    // there is no saltwater in the box.
    bounds: [-122.36, 46.5, -121.42, 47.17],
    samplesX: 769,
    airports: {
      KPLU: [-122.287, 47.1089],
      "55S": [-121.68, 46.6013],
      "39P": [-122.267, 46.5504],
    },
  },
  moab: {
    name: "Moab",
    farName: "Canyon Country",
    // The confluence of the Green and the Colorado north past Island in the Sky
    // and Dead Horse Point to Arches and Canyonlands Field. The La Sals sit just
    // outside, and turn up on the horizon in the far mesh anyway.
    bounds: [-110.05, 38.15, -109.35, 38.85],
    samplesX: 673,
    airports: {
      KCNY: [-109.755, 38.755],
      UT53: [-109.4466, 38.4938],
    },
  },
  "grand-teton": {
    name: "Grand Teton",
    farName: "Greater Yellowstone",
    // The whole range from Teton Pass north past Jackson Lake, the length of
    // Jackson Hole, and over the crest into Teton Valley for Driggs.
    bounds: [-111.15, 43.42, -110.45, 44.02],
    samplesX: 673,
    airports: {
      KJAC: [-110.738, 43.6073],
      KDIJ: [-111.0968, 43.7427],
    },
  },
};

const areaId = process.argv[2];
const area = AREAS[areaId];
if (!area) {
  console.error(`Usage: node scripts/build-area-terrain.mjs <${Object.keys(AREAS).join("|")}>`);
  process.exit(1);
}
const geographicBounds = area.bounds;
const samplesX = area.samplesX;

// Half of this has to stay inside the sky dome, a 150 km sphere centred on the
// camera. The spans are trimmed per area so neither axis reaches past it.
const FAR_SAMPLES_X = 441;
const FAR_REACH = 10950;

// Terrain is all edges — a ridgeline read straight down to the target grid
// point-samples into a staircase. Reading finer and box averaging back down
// turns each output sample into a real area mean.
const OVERSAMPLE = 3;

const [minLongitude, minLatitude, maxLongitude, maxLatitude] = geographicBounds;
const meanLatitudeRadians = ((minLatitude + maxLatitude) / 2) * (Math.PI / 180);
const geographicWidthKm = (maxLongitude - minLongitude) * 111.32 * Math.cos(meanLatitudeRadians);
const geographicDepthKm = (maxLatitude - minLatitude) * 111.32;
// Simulator convention: one Three.js world unit represents ten physical metres.
const worldWidth = geographicWidthKm * 100;
const worldDepth = geographicDepthKm * 100;
const samplesY = Math.round((samplesX - 1) * (worldDepth / worldWidth)) + 1;

// Every area is its own world, centred on its own origin. See REGIONS in
// src/main.js for why they cannot share a frame.
const worldPerLongitude = worldWidth / (maxLongitude - minLongitude);
const worldPerLatitude = worldDepth / (maxLatitude - minLatitude);
const centreLongitude = (minLongitude + maxLongitude) / 2;
const centreLatitude = (minLatitude + maxLatitude) / 2;

/**
 * Elevation for a box, resampled onto `targetX` × `targetY`.
 *
 * The request has to be made on a pixel grid whose aspect matches the box
 * measured *in degrees*: ask for anything else and the service quietly widens
 * the box about its centre until it fits, which lands the terrain a kilometre
 * off everything baked against the projection. The world grid wanted here has a
 * different aspect — it carries the cos(latitude) factor — so the fetch and the
 * resample are two separate steps.
 */
async function fetchElevation(label, bounds, targetX, targetY) {
  const [west, south, east, north] = bounds;
  const lonSpan = east - west;
  const latSpan = north - south;
  let fineX = targetX * OVERSAMPLE;
  let fineY = Math.round(fineX * (latSpan / lonSpan));
  // Oversampling is meant to average several source samples into each output
  // one; if the degree aspect leaves too few rows for that, ask for more.
  while (fineY < targetY * 2) {
    fineX = Math.round(fineX * 1.5);
    fineY = Math.round(fineX * (latSpan / lonSpan));
  }

  const parameters = new URLSearchParams({
    bbox: bounds.join(","),
    bboxSR: "4326",
    imageSR: "4326",
    size: `${fineX},${fineY}`,
    format: "tiff",
    pixelType: "F32",
    interpolation: "RSP_BilinearInterpolation",
    f: "json",
  });
  console.log(`${label}: requesting ${fineX}×${fineY} for a ${targetX}×${targetY} grid`);
  const described = await (await fetch(`${elevationService}?${parameters}`, {
    headers: { "User-Agent": "horizon-flight/0.1 (scenery build script)" },
    signal: AbortSignal.timeout(300000),
  })).json();
  if (!described.href) throw new Error(`${label}: no elevation returned: ${JSON.stringify(described).slice(0, 200)}`);

  const { xmin, ymin, xmax, ymax } = described.extent;
  const drift = Math.max(
    Math.abs(xmin - west), Math.abs(xmax - east),
    Math.abs(ymin - south), Math.abs(ymax - north),
  );
  // One source pixel of slack absorbs the integer rounding of the pixel count.
  if (drift > Math.min(lonSpan / fineX, latSpan / fineY)) {
    throw new Error(
      `${label}: service rendered ${xmin},${ymin},${xmax},${ymax} instead of the requested ` +
        `${bounds.join(",")} — the requested pixel size does not match the box aspect in degrees`,
    );
  }

  const buffer = Buffer.from(
    await (await fetch(described.href, { signal: AbortSignal.timeout(300000) })).arrayBuffer(),
  );
  const raster = await (await (await fromArrayBuffer(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  )).getImage()).readRasters({ interleave: true });

  // Area average. Both grids are uniform over the same box, so each fine sample
  // belongs to exactly one output cell.
  const totals = new Float64Array(targetX * targetY);
  const counts = new Uint32Array(targetX * targetY);
  let voids = 0;
  for (let y = 0; y < fineY; y += 1) {
    const targetRow = Math.min(targetY - 1, Math.floor((y * targetY) / fineY));
    for (let x = 0; x < fineX; x += 1) {
      const value = Number(raster[y * fineX + x]);
      // 3DEP marks voids with a large negative sentinel; nothing in the Sierra
      // is below sea level.
      if (!Number.isFinite(value) || value < -100) {
        voids += 1;
        continue;
      }
      const cell = targetRow * targetX + Math.min(targetX - 1, Math.floor((x * targetX) / fineX));
      totals[cell] += value;
      counts[cell] += 1;
    }
  }
  if (voids) console.warn(`  ${voids} void samples`);

  const heights = new Float32Array(targetX * targetY);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < heights.length; i += 1) {
    // A cell with nothing but voids falls back to its western neighbour, which
    // is already resolved by the time we reach it.
    const elevation = counts[i] ? totals[i] / counts[i] : heights[Math.max(0, i - 1)];
    heights[i] = elevation;
    minimum = Math.min(minimum, elevation);
    maximum = Math.max(maximum, elevation);
  }
  console.log(`  ${label} elevation range ${minimum.toFixed(1)}–${maximum.toFixed(1)} m`);
  return { heights, elevationRange: [minimum, maximum] };
}

await mkdir(outputDirectory, { recursive: true });

console.log(
  `${area.name}: ${(worldWidth / 100).toFixed(1)}×${(worldDepth / 100).toFixed(1)} km at ` +
    `${samplesX}×${samplesY} (${(worldWidth * 10 / (samplesX - 1)).toFixed(0)} m per sample)`,
);
const detail = await fetchElevation("detail", geographicBounds, samplesX, samplesY);

// Published aerodrome positions, for the metadata cross-check only; the airport
// builder derives its own coordinates from the same projection.
const airportCoordinates = area.airports;
const toWorld = ([longitude, latitude]) => ({
  x: ((longitude - minLongitude) / (maxLongitude - minLongitude) - 0.5) * worldWidth,
  z: ((maxLatitude - latitude) / (maxLatitude - minLatitude) - 0.5) * worldDepth,
});

await writeFile(new URL(`${areaId}-dem.f32`, outputDirectory), Buffer.from(detail.heights.buffer));
await writeFile(
  new URL(`${areaId}-terrain.json`, outputDirectory),
  `${JSON.stringify({
    id: areaId,
    name: area.name,
    source: "USGS 3DEP elevation image service",
    projection: "EPSG:4326",
    sourceBounds: geographicBounds,
    samples: [samplesX, samplesY],
    worldSize: [worldWidth, worldDepth],
    worldBounds: [-worldWidth / 2, -worldDepth / 2, worldWidth / 2, worldDepth / 2],
    worldOrigin: [0, 0],
    verticalScale: 0.1,
    elevationRange: detail.elevationRange,
    airports: Object.fromEntries(
      Object.entries(airportCoordinates).map(([code, coordinate]) => [code, toWorld(coordinate)]),
    ),
  }, null, 2)}\n`,
);

// Reach the same distance in every direction, in world units, whatever the
// area's own aspect happens to be.
const farLongitudeSpan = (FAR_REACH * 2) / worldPerLongitude;
const farLatitudeSpan = (FAR_REACH * 2) / worldPerLatitude;
const farBounds = [
  centreLongitude - farLongitudeSpan / 2,
  centreLatitude - farLatitudeSpan / 2,
  centreLongitude + farLongitudeSpan / 2,
  centreLatitude + farLatitudeSpan / 2,
];
const farWorldWidth = farLongitudeSpan * worldPerLongitude;
const farWorldDepth = farLatitudeSpan * worldPerLatitude;
const farSamplesY = Math.round((FAR_SAMPLES_X - 1) * (farWorldDepth / farWorldWidth)) + 1;

console.log(
  `Far terrain: ${(farWorldWidth / 100).toFixed(0)}×${(farWorldDepth / 100).toFixed(0)} km at ` +
    `${FAR_SAMPLES_X}×${farSamplesY} (${(farWorldWidth * 10 / (FAR_SAMPLES_X - 1)).toFixed(0)} m per sample)`,
);
const far = await fetchElevation("far", farBounds, FAR_SAMPLES_X, farSamplesY);

await writeFile(new URL(`${areaId}-far-dem.f32`, outputDirectory), Buffer.from(far.heights.buffer));
await writeFile(
  new URL(`${areaId}-far-terrain.json`, outputDirectory),
  `${JSON.stringify({
    id: `${areaId}-far`,
    name: area.farName,
    source: "USGS 3DEP elevation image service",
    projection: "EPSG:4326",
    projectionReference: `${areaId}-terrain.json`,
    sourceBounds: farBounds,
    samples: [FAR_SAMPLES_X, farSamplesY],
    worldSize: [farWorldWidth, farWorldDepth],
    worldBounds: [-farWorldWidth / 2, -farWorldDepth / 2, farWorldWidth / 2, farWorldDepth / 2],
    worldOrigin: [0, 0],
    verticalScale: 0.1,
    elevationRange: far.elevationRange,
  }, null, 2)}\n`,
);

console.log(`Wrote ${area.name} terrain`);
