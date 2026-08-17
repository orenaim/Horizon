import { mkdir, writeFile } from "node:fs/promises";
import { fromFile } from "geotiff";

const westSourcePath = new URL("../data/raw/usgs-n22w159.tif", import.meta.url);
const eastSourcePath = new URL("../data/raw/usgs-n22w158.tif", import.meta.url);
const outputDirectory = new URL("../public/terrain/", import.meta.url);
const samplesX = 513;
const geographicBounds = [-158.32, 21.19, -157.62, 21.75];
const splitLongitude = -158;

const [westTiff, eastTiff] = await Promise.all([
  fromFile(westSourcePath.pathname),
  fromFile(eastSourcePath.pathname),
]);
const [westImage, eastImage] = await Promise.all([westTiff.getImage(), eastTiff.getImage()]);
const [minLongitude, minLatitude, maxLongitude, maxLatitude] = geographicBounds;
const meanLatitudeRadians = ((minLatitude + maxLatitude) / 2) * (Math.PI / 180);
const geographicWidthKm = (maxLongitude - minLongitude) * 111.32 * Math.cos(meanLatitudeRadians);
const geographicDepthKm = (maxLatitude - minLatitude) * 111.32;
// Simulator convention: one Three.js world unit represents ten physical metres.
const worldWidth = geographicWidthKm * 100;
const worldDepth = worldWidth * (geographicDepthKm / geographicWidthKm);
const samplesY = Math.max(257, Math.round((samplesX - 1) * (worldDepth / worldWidth)) + 1);
const splitIndex = Math.round(
  ((splitLongitude - minLongitude) / (maxLongitude - minLongitude)) * (samplesX - 1),
);
const westSamplesX = splitIndex + 1;
const eastSamplesX = samplesX - splitIndex;

console.log(
  `Reading two ${westImage.getWidth()}×${westImage.getHeight()} USGS seamless DEM tiles`,
);
console.log(`Cropping Oʻahu and resampling to ${samplesX}×${samplesY}`);

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

const [westRaster, eastRaster] = await Promise.all([
  westImage.readRasters({
    window: pixelWindow(westImage, [minLongitude, minLatitude, splitLongitude, maxLatitude]),
    width: westSamplesX,
    height: samplesY,
    interleave: true,
    resampleMethod: "bilinear",
  }),
  eastImage.readRasters({
    window: pixelWindow(eastImage, [splitLongitude, minLatitude, maxLongitude, maxLatitude]),
    width: eastSamplesX,
    height: samplesY,
    interleave: true,
    resampleMethod: "bilinear",
  }),
]);

const heights = new Float32Array(samplesX * samplesY);
let minimumElevation = Number.POSITIVE_INFINITY;
let maximumElevation = Number.NEGATIVE_INFINITY;
for (let y = 0; y < samplesY; y += 1) {
  for (let x = 0; x < samplesX; x += 1) {
    const value = x <= splitIndex
      ? Number(westRaster[y * westSamplesX + x])
      : Number(eastRaster[y * eastSamplesX + (x - splitIndex)]);
    const elevation = !Number.isFinite(value) || value < -100 ? -4 : value;
    heights[y * samplesX + x] = elevation;
    minimumElevation = Math.min(minimumElevation, elevation);
    maximumElevation = Math.max(maximumElevation, elevation);
  }
}

// Remove resampling spikes while preserving the coastline and true volcanic relief.
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
  PHNL: [-157.9225, 21.3187],
  PHJR: [-158.0703, 21.3074],
  PHDH: [-158.1973, 21.5795],
};

const toWorld = ([longitude, latitude]) => {
  return {
    x: ((longitude - minLongitude) / (maxLongitude - minLongitude) - 0.5) * worldWidth,
    z: ((maxLatitude - latitude) / (maxLatitude - minLatitude) - 0.5) * worldDepth,
  };
};

const metadata = {
  id: "oahu",
  name: "Oʻahu",
  source: "USGS 3DEP 1/3 arc-second seamless DEM",
  projection: "EPSG:4269",
  sourceBounds: geographicBounds,
  sourceSize: [
    [westImage.getWidth(), westImage.getHeight()],
    [eastImage.getWidth(), eastImage.getHeight()],
  ],
  samples: [samplesX, samplesY],
  worldSize: [worldWidth, worldDepth],
  // [west, north, east, south] in the shared simulator x/z frame. Oʻahu is
  // the projection reference and therefore remains centred on the origin.
  worldBounds: [-worldWidth / 2, -worldDepth / 2, worldWidth / 2, worldDepth / 2],
  worldOrigin: [0, 0],
  verticalScale: 0.1,
  elevationRange: [minimumElevation, maximumElevation],
  airports: Object.fromEntries(
    Object.entries(airportCoordinates).map(([code, coordinate]) => [code, toWorld(coordinate)]),
  ),
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL("oahu-dem.f32", outputDirectory), Buffer.from(heights.buffer));
await writeFile(
  new URL("oahu-terrain.json", outputDirectory),
  `${JSON.stringify(metadata, null, 2)}\n`,
);

console.log(`Wrote terrain with elevation range ${minimumElevation.toFixed(1)}–${maximumElevation.toFixed(1)} m`);
