import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fromFile } from "geotiff";

// Kauaʻi straddles 22° N, so both adjacent 1/3 arc-second 3DEP tiles are
// required. Raw tiles are deliberately kept out of git; see README for their
// official USGS download URLs.
const southSourcePath = new URL("../data/raw/usgs-n22w160.tif", import.meta.url);
const northSourcePath = new URL("../data/raw/usgs-n23w160.tif", import.meta.url);
const referenceMetadataPath = new URL("../public/terrain/oahu-terrain.json", import.meta.url);
const outputDirectory = new URL("../public/terrain/", import.meta.url);
const samplesX = 425;
const geographicBounds = [-159.83, 21.83, -159.25, 22.28];
const splitLatitude = 22;

const [southTiff, northTiff, referenceMetadata] = await Promise.all([
  fromFile(southSourcePath.pathname),
  fromFile(northSourcePath.pathname),
  readFile(referenceMetadataPath, "utf8").then(JSON.parse),
]);
const [southImage, northImage] = await Promise.all([southTiff.getImage(), northTiff.getImage()]);
const [minLongitude, minLatitude, maxLongitude, maxLatitude] = geographicBounds;

// Use Oʻahu's existing equirectangular frame as the one shared world
// projection. That preserves every current coordinate while placing Kauaʻi at
// its true distance and bearing from Oʻahu.
const [referenceMinLongitude, referenceMinLatitude, referenceMaxLongitude, referenceMaxLatitude] =
  referenceMetadata.sourceBounds;
const [referenceWorldWidth, referenceWorldDepth] = referenceMetadata.worldSize;
const longitudeScale = referenceWorldWidth / (referenceMaxLongitude - referenceMinLongitude);
const latitudeScale = referenceWorldDepth / (referenceMaxLatitude - referenceMinLatitude);
const toWorldX = (longitude) =>
  (longitude - referenceMinLongitude) * longitudeScale - referenceWorldWidth / 2;
const toWorldZ = (latitude) =>
  (referenceMaxLatitude - latitude) * latitudeScale - referenceWorldDepth / 2;

const worldBounds = [
  toWorldX(minLongitude),
  toWorldZ(maxLatitude),
  toWorldX(maxLongitude),
  toWorldZ(minLatitude),
];
const worldWidth = worldBounds[2] - worldBounds[0];
const worldDepth = worldBounds[3] - worldBounds[1];
const samplesY = Math.max(257, Math.round((samplesX - 1) * (worldDepth / worldWidth)) + 1);
const splitIndex = Math.round(
  ((maxLatitude - splitLatitude) / (maxLatitude - minLatitude)) * (samplesY - 1),
);
const northSamplesY = splitIndex + 1;
const southSamplesY = samplesY - splitIndex;

console.log(
  `Reading ${southImage.getWidth()}×${southImage.getHeight()} and ` +
    `${northImage.getWidth()}×${northImage.getHeight()} USGS seamless DEM tiles`,
);
console.log(`Cropping Kauaʻi and resampling to ${samplesX}×${samplesY}`);

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
    width: samplesX,
    height: northSamplesY,
    interleave: true,
    resampleMethod: "bilinear",
  }),
  southImage.readRasters({
    window: pixelWindow(southImage, [minLongitude, minLatitude, maxLongitude, splitLatitude]),
    width: samplesX,
    height: southSamplesY,
    interleave: true,
    resampleMethod: "bilinear",
  }),
]);

const heights = new Float32Array(samplesX * samplesY);
let minimumElevation = Number.POSITIVE_INFINITY;
let maximumElevation = Number.NEGATIVE_INFINITY;
for (let y = 0; y < samplesY; y += 1) {
  for (let x = 0; x < samplesX; x += 1) {
    const value = y <= splitIndex
      ? Number(northRaster[y * samplesX + x])
      : Number(southRaster[(y - splitIndex) * samplesX + x]);
    const elevation = !Number.isFinite(value) || value < -100 ? -4 : value;
    heights[y * samplesX + x] = elevation;
    minimumElevation = Math.min(minimumElevation, elevation);
    maximumElevation = Math.max(maximumElevation, elevation);
  }
}

// Match the Oʻahu build: remove resampling spikes while preserving the
// coastline and the island's deeply cut volcanic relief.
for (let pass = 0; pass < 2; pass += 1) {
  const smoothed = heights.slice();
  for (let y = 1; y < samplesY - 1; y += 1) {
    for (let x = 1; x < samplesX - 1; x += 1) {
      const index = y * samplesX + x;
      if (heights[index] <= 0) continue;
      let total = heights[index] * 4;
      let weight = 4;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const neighbor = heights[(y + offsetY) * samplesX + x + offsetX];
          if (neighbor > 0) {
            total += neighbor;
            weight += 1;
          }
        }
      }
      smoothed[index] = total / weight;
    }
  }
  heights.set(smoothed);
}

const airportCoordinates = {
  PHLI: [-159.3389, 21.976],
  PHPA: [-159.6028, 21.8969],
};
const metadata = {
  id: "kauai",
  name: "Kauaʻi",
  source: "USGS 3DEP 1/3 arc-second seamless DEM",
  projection: "EPSG:4269",
  projectionReference: "oahu-terrain.json",
  sourceBounds: geographicBounds,
  sourceSize: [
    [southImage.getWidth(), southImage.getHeight()],
    [northImage.getWidth(), northImage.getHeight()],
  ],
  samples: [samplesX, samplesY],
  worldSize: [worldWidth, worldDepth],
  worldBounds,
  worldOrigin: [(worldBounds[0] + worldBounds[2]) / 2, (worldBounds[1] + worldBounds[3]) / 2],
  verticalScale: referenceMetadata.verticalScale,
  elevationRange: [minimumElevation, maximumElevation],
  airports: Object.fromEntries(
    Object.entries(airportCoordinates).map(([code, [longitude, latitude]]) => [
      code,
      { x: toWorldX(longitude), z: toWorldZ(latitude) },
    ]),
  ),
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL("kauai-dem.f32", outputDirectory), Buffer.from(heights.buffer));
await writeFile(
  new URL("kauai-terrain.json", outputDirectory),
  `${JSON.stringify(metadata, null, 2)}\n`,
);

console.log(
  `Wrote Kauaʻi terrain with elevation range ` +
    `${minimumElevation.toFixed(1)}–${maximumElevation.toFixed(1)} m`,
);
