import { mkdir, writeFile } from "node:fs/promises";
import { fromArrayBuffer, fromFile } from "geotiff";

// The Grand Canyon box straddles 36° N, so both adjacent 1/3 arc-second 3DEP
// tiles are required. Raw tiles are deliberately kept out of git; see README
// for their official USGS download URLs.
const southSourcePath = new URL("../data/raw/usgs-n36w113.tif", import.meta.url);
const northSourcePath = new URL("../data/raw/usgs-n37w113.tif", import.meta.url);
const outputDirectory = new URL("../public/terrain/", import.meta.url);

// West of the South Rim village round to Havasu, north far enough for the
// North Rim, and south far enough to give Grand Canyon National Park Airport
// room to depart into. Both tiles are w113, which keeps the raw download to
// two files instead of four.
const geographicBounds = [-112.8, 35.86, -112.02, 36.42];
const splitLatitude = 36;
const samplesX = 769;
// A canyon is all edges, and a bilinear read straight down to the target grid
// point-samples them into a staircase. Reading three times finer and box
// averaging back down turns each output sample into a real area mean, which is
// what keeps the rims clean.
const OVERSAMPLE = 3;

const [southTiff, northTiff] = await Promise.all([
  fromFile(southSourcePath.pathname),
  fromFile(northSourcePath.pathname),
]);
const [southImage, northImage] = await Promise.all([southTiff.getImage(), northTiff.getImage()]);
const [minLongitude, minLatitude, maxLongitude, maxLatitude] = geographicBounds;
const meanLatitudeRadians = ((minLatitude + maxLatitude) / 2) * (Math.PI / 180);
const geographicWidthKm = (maxLongitude - minLongitude) * 111.32 * Math.cos(meanLatitudeRadians);
const geographicDepthKm = (maxLatitude - minLatitude) * 111.32;
// Simulator convention: one Three.js world unit represents ten physical metres.
const worldWidth = geographicWidthKm * 100;
const worldDepth = worldWidth * (geographicDepthKm / geographicWidthKm);
const samplesY = Math.round((samplesX - 1) * (worldDepth / worldWidth)) + 1;

// Every area is its own world. Hawaiʻi and the Colorado Plateau are four
// thousand kilometres apart, which is far enough that a shared frame would push
// world coordinates past the precision a float32 position attribute has to
// spare, and there is nothing to fly between them anyway. So this area is
// centred on its own origin exactly as Oʻahu is on its.
const worldBounds = [-worldWidth / 2, -worldDepth / 2, worldWidth / 2, worldDepth / 2];

const readSamplesY = samplesY * OVERSAMPLE;
const readSamplesX = samplesX * OVERSAMPLE;
const splitRow = Math.round(((maxLatitude - splitLatitude) / (maxLatitude - minLatitude)) * readSamplesY);

console.log(
  `Reading ${southImage.getWidth()}×${southImage.getHeight()} and ` +
    `${northImage.getWidth()}×${northImage.getHeight()} USGS seamless DEM tiles`,
);
console.log(
  `Cropping the Grand Canyon and resampling to ${samplesX}×${samplesY} ` +
    `(${(worldWidth * 10 / (samplesX - 1)).toFixed(0)} m per sample) via ${readSamplesX}×${readSamplesY}`,
);

const pixelWindow = (image, [cropMinX, cropMinY, cropMaxX, cropMaxY]) => {
  const [imageMinX, imageMinY, imageMaxX, imageMaxY] = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();
  return [
    Math.max(0, Math.floor(((cropMinX - imageMinX) / (imageMaxX - imageMinX)) * width)),
    Math.max(0, Math.floor(((imageMaxY - cropMaxY) / (imageMaxY - imageMinY)) * height)),
    Math.min(width, Math.ceil(((cropMaxX - imageMinX) / (imageMaxX - imageMinX)) * width)),
    Math.min(height, Math.ceil(((imageMaxY - cropMinY) / (imageMaxY - imageMinY)) * height)),
  ];
};

const [northRaster, southRaster] = await Promise.all([
  northImage.readRasters({
    window: pixelWindow(northImage, [minLongitude, splitLatitude, maxLongitude, maxLatitude]),
    width: readSamplesX,
    height: splitRow,
    interleave: true,
    resampleMethod: "bilinear",
  }),
  southImage.readRasters({
    window: pixelWindow(southImage, [minLongitude, minLatitude, maxLongitude, splitLatitude]),
    width: readSamplesX,
    height: readSamplesY - splitRow,
    interleave: true,
    resampleMethod: "bilinear",
  }),
]);

const fine = new Float32Array(readSamplesX * readSamplesY);
let voids = 0;
for (let y = 0; y < readSamplesY; y += 1) {
  for (let x = 0; x < readSamplesX; x += 1) {
    const value = y < splitRow
      ? Number(northRaster[y * readSamplesX + x])
      : Number(southRaster[(y - splitRow) * readSamplesX + x]);
    // 3DEP marks voids with a large negative sentinel. Nothing in the Colorado
    // Plateau is below sea level, so anything under that is missing data.
    const valid = Number.isFinite(value) && value > -100;
    if (!valid) voids += 1;
    fine[y * readSamplesX + x] = valid ? value : Number.NaN;
  }
}
if (voids) console.warn(`  ${voids} void samples in the source window`);

const heights = new Float32Array(samplesX * samplesY);
let minimumElevation = Number.POSITIVE_INFINITY;
let maximumElevation = Number.NEGATIVE_INFINITY;
for (let y = 0; y < samplesY; y += 1) {
  for (let x = 0; x < samplesX; x += 1) {
    let total = 0;
    let count = 0;
    for (let dy = 0; dy < OVERSAMPLE; dy += 1) {
      const fy = Math.min(readSamplesY - 1, y * OVERSAMPLE + dy);
      for (let dx = 0; dx < OVERSAMPLE; dx += 1) {
        const fx = Math.min(readSamplesX - 1, x * OVERSAMPLE + dx);
        const sample = fine[fy * readSamplesX + fx];
        if (Number.isNaN(sample)) continue;
        total += sample;
        count += 1;
      }
    }
    // A cell with nothing but voids under it falls back to its western
    // neighbour, which is already resolved by the time we reach it.
    const elevation = count ? total / count : heights[y * samplesX + Math.max(0, x - 1)];
    heights[y * samplesX + x] = elevation;
    minimumElevation = Math.min(minimumElevation, elevation);
    maximumElevation = Math.max(maximumElevation, elevation);
  }
}

// No smoothing pass here, unlike the island builds. Theirs exists to kill
// resampling spikes left by a straight bilinear decimation; the box average
// above has already done that job, and a blur over a canyon would round off the
// rims that are the whole reason to fly here.

// Published aerodrome positions, used for the metadata cross-check only; the
// airport builder derives its own coordinates from the same projection.
const airportCoordinates = {
  KGCN: [-112.1469, 35.9524],
};

const toWorld = ([longitude, latitude]) => ({
  x: ((longitude - minLongitude) / (maxLongitude - minLongitude) - 0.5) * worldWidth,
  z: ((maxLatitude - latitude) / (maxLatitude - minLatitude) - 0.5) * worldDepth,
});

// ---------------------------------------------------------------------------
// Far terrain
// ---------------------------------------------------------------------------
//
// The survey above is seventy kilometres across, which is close enough that its
// edge lands on the horizon from anywhere inside it. Rather than dress that
// edge up, the area gets a second, much coarser mesh reaching a hundred and ten
// kilometres out in every direction — far enough that the haze closes over it
// well before it ends.
//
// It does not come from the raw tiles: covering that box at 1/3 arc-second
// would be sixteen more downloads of several hundred megabytes each. The 3DEP
// image service resamples on request, so the whole surround arrives as one
// float GeoTIFF of under a megabyte.
const elevationService =
  "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage";
// Half of this has to stay inside the sky dome, which is a 150 km sphere
// centred on the camera.
const FAR_SPAN = [2.44, 1.96];
const FAR_SAMPLES_X = 441;

// The same degrees-to-world scale as the detail mesh, so the two line up
// exactly rather than each deriving its own cos(latitude).
const worldPerLongitude = worldWidth / (maxLongitude - minLongitude);
const worldPerLatitude = worldDepth / (maxLatitude - minLatitude);
const centreLongitude = (minLongitude + maxLongitude) / 2;
const centreLatitude = (minLatitude + maxLatitude) / 2;
const farBounds = [
  centreLongitude - FAR_SPAN[0] / 2,
  centreLatitude - FAR_SPAN[1] / 2,
  centreLongitude + FAR_SPAN[0] / 2,
  centreLatitude + FAR_SPAN[1] / 2,
];
const farWorldWidth = FAR_SPAN[0] * worldPerLongitude;
const farWorldDepth = FAR_SPAN[1] * worldPerLatitude;
const farSamplesY = Math.round((FAR_SAMPLES_X - 1) * (farWorldDepth / farWorldWidth)) + 1;

console.log(
  `Requesting far terrain: ${(farWorldWidth / 100).toFixed(0)}×${(farWorldDepth / 100).toFixed(0)} km ` +
    `at ${FAR_SAMPLES_X}×${farSamplesY} (${(farWorldWidth * 10 / (FAR_SAMPLES_X - 1)).toFixed(0)} m per sample)`,
);

const farParameters = new URLSearchParams({
  bbox: farBounds.join(","),
  bboxSR: "4326",
  imageSR: "4326",
  size: `${FAR_SAMPLES_X},${farSamplesY}`,
  format: "tiff",
  pixelType: "F32",
  interpolation: "RSP_BilinearInterpolation",
  f: "json",
});
const described = await (await fetch(`${elevationService}?${farParameters}`, {
  headers: { "User-Agent": "horizon-flight/0.1 (scenery build script)" },
  signal: AbortSignal.timeout(300000),
})).json();
if (!described.href) throw new Error(`no far terrain returned: ${JSON.stringify(described).slice(0, 200)}`);
const farTiffBuffer = Buffer.from(
  await (await fetch(described.href, { signal: AbortSignal.timeout(300000) })).arrayBuffer(),
);
const farRaster = await (await (await fromArrayBuffer(
  farTiffBuffer.buffer.slice(farTiffBuffer.byteOffset, farTiffBuffer.byteOffset + farTiffBuffer.byteLength),
)).getImage()).readRasters({ interleave: true });

const farHeights = new Float32Array(FAR_SAMPLES_X * farSamplesY);
let farMinimum = Number.POSITIVE_INFINITY;
let farMaximum = Number.NEGATIVE_INFINITY;
for (let i = 0; i < farHeights.length; i += 1) {
  const value = Number(farRaster[i]);
  // The service returns its own void sentinel outside 3DEP coverage; nothing on
  // the plateau is below sea level.
  const elevation = Number.isFinite(value) && value > -100 ? value : 0;
  farHeights[i] = elevation;
  farMinimum = Math.min(farMinimum, elevation);
  farMaximum = Math.max(farMaximum, elevation);
}

const farMetadata = {
  id: "grand-canyon-far",
  name: "Colorado Plateau",
  source: "USGS 3DEP elevation image service",
  projection: "EPSG:4269",
  projectionReference: "grand-canyon-terrain.json",
  sourceBounds: farBounds,
  samples: [FAR_SAMPLES_X, farSamplesY],
  worldSize: [farWorldWidth, farWorldDepth],
  worldBounds: [-farWorldWidth / 2, -farWorldDepth / 2, farWorldWidth / 2, farWorldDepth / 2],
  worldOrigin: [0, 0],
  verticalScale: 0.1,
  elevationRange: [farMinimum, farMaximum],
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL("grand-canyon-far-dem.f32", outputDirectory), Buffer.from(farHeights.buffer));
await writeFile(
  new URL("grand-canyon-far-terrain.json", outputDirectory),
  `${JSON.stringify(farMetadata, null, 2)}\n`,
);
console.log(
  `Wrote far terrain with elevation range ${farMinimum.toFixed(1)}–${farMaximum.toFixed(1)} m`,
);

const metadata = {
  id: "grand-canyon",
  name: "Grand Canyon",
  source: "USGS 3DEP 1/3 arc-second seamless DEM",
  projection: "EPSG:4269",
  sourceBounds: geographicBounds,
  sourceSize: [
    [southImage.getWidth(), southImage.getHeight()],
    [northImage.getWidth(), northImage.getHeight()],
  ],
  samples: [samplesX, samplesY],
  worldSize: [worldWidth, worldDepth],
  worldBounds,
  worldOrigin: [0, 0],
  verticalScale: 0.1,
  elevationRange: [minimumElevation, maximumElevation],
  airports: Object.fromEntries(
    Object.entries(airportCoordinates).map(([code, coordinate]) => [code, toWorld(coordinate)]),
  ),
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL("grand-canyon-dem.f32", outputDirectory), Buffer.from(heights.buffer));
await writeFile(
  new URL("grand-canyon-terrain.json", outputDirectory),
  `${JSON.stringify(metadata, null, 2)}\n`,
);

console.log(
  `Wrote Grand Canyon terrain with elevation range ` +
    `${minimumElevation.toFixed(1)}–${maximumElevation.toFixed(1)} m`,
);
