import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { asset } from "./asset.js";
import { BuildingTextures, buildStructure, minAreaRect } from "./airport-buildings.js";
import { landmarkFor } from "./airport-landmarks.js";
import {
  SignageBuilder,
  TaxiwayGraph,
  holdCrossings,
  planHoldMarkings,
  planSigns,
} from "./airport-signs.js";

// Builds the Oʻahu and Kauaʻi airfields from the baked OurAirports/OpenStreetMap
// data in public/airports/hawaii-airports.json.
//
// Everything here works in world units, where one unit is ten metres, so the
// helper `m()` converts the real-world dimensions quoted from FAA advisory
// circular 150/5340-1 (runway markings) into scene units.

const WORLD_PER_METRE = 0.1;
const m = (metres) => metres * WORLD_PER_METRE;

// Height of each painted or paved layer above the graded field, chosen to clear
// the depth buffer without reading as a visible step from the cockpit.
const LAYER = {
  apron: m(0.12),
  taxiway: m(0.18),
  taxiwayLine: m(0.24),
  holdMarking: m(0.26),
  runway: m(0.3),
  sign: m(0.4),
};

// Height of the runway surface above the graded field. Every other paved layer
// sits below it, and `rollingHeightAt` puts the wheels on whichever one is
// drawn at a point.
export const PAVEMENT_RISE = LAYER.runway;

const PAVEMENT_COLOR = 0x6a6d70;
const TAXIWAY_COLOR = 0x5d6164;
const SHOULDER_COLOR = 0x4a4d50;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Orthonormal frame for a runway. `forward` runs from the low-numbered
 * threshold to the high one; `right` is the pilot's right hand on that heading.
 */
function runwayFrame(runway) {
  const [ax, az] = runway.ends[0].world;
  const [bx, bz] = runway.ends[1].world;
  const span = Math.hypot(bx - ax, bz - az) || 1;
  const forward = new THREE.Vector2((bx - ax) / span, (bz - az) / span);
  return {
    centre: new THREE.Vector2((ax + bx) / 2, (az + bz) / 2),
    forward,
    right: new THREE.Vector2(-forward.y, forward.x),
    // Surveyed thresholds are published to a coarser precision than the
    // runway length, so the stated length wins.
    halfLength: m(runway.lengthM) / 2,
    halfWidth: m(runway.widthM) / 2,
  };
}

/**
 * Fills a runway-aligned rectangle into a mask canvas. `toPixel` maps world
 * coordinates to the canvas, `scale` is pixels per world unit.
 */
function fillOrientedRect(context, frame, halfLength, halfWidth, toPixelX, toPixelZ, scale) {
  context.save();
  context.translate(toPixelX(frame.centre.x), toPixelZ(frame.centre.y));
  context.rotate(Math.atan2(frame.forward.y, frame.forward.x));
  context.fillRect(
    -halfLength * scale,
    -halfWidth * scale,
    halfLength * 2 * scale,
    halfWidth * 2 * scale,
  );
  context.restore();
}

/** A flat rectangle in the XZ plane, oriented by a runway-style frame. */
function orientedQuad(frame, halfLength, halfWidth, y, withUv = false) {
  const { centre, forward, right } = frame;
  const positions = [];
  const uvs = [];
  const corners = [
    [-halfLength, -halfWidth, 0, 1],
    [halfLength, -halfWidth, 1, 1],
    [halfLength, halfWidth, 1, 0],
    [-halfLength, halfWidth, 0, 0],
  ];
  for (const [along, across, u, v] of corners) {
    positions.push(
      centre.x + forward.x * along + right.x * across,
      y,
      centre.y + forward.y * along + right.y * across,
    );
    uvs.push(u, v);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (withUv) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  geometry.computeVertexNormals();
  return geometry;
}

/** Turns an OSM centreline into a flat ribbon of the given width. */
function ribbonGeometry(path, width, y) {
  const positions = [];
  const indices = [];
  const half = width / 2;
  for (let i = 0; i < path.length - 1; i += 1) {
    const [x1, z1] = path[i];
    const [x2, z2] = path[i + 1];
    const length = Math.hypot(x2 - x1, z2 - z1);
    if (length < 1e-4) continue;
    const nx = (-(z2 - z1) / length) * half;
    const nz = ((x2 - x1) / length) * half;
    const base = positions.length / 3;
    positions.push(
      x1 - nx, y, z1 - nz,
      x2 - nx, y, z2 - nz,
      x2 + nx, y, z2 + nz,
      x1 + nx, y, z1 + nz,
    );
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);

    // A square patch over each interior joint keeps corners from splitting open.
    if (i > 0) {
      const centre = positions.length / 3;
      positions.push(
        x1 - half, y, z1 - half,
        x1 + half, y, z1 - half,
        x1 + half, y, z1 + half,
        x1 - half, y, z1 + half,
      );
      indices.push(centre, centre + 2, centre + 1, centre, centre + 3, centre + 2);
    }
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Flat polygon fill from an OSM ring of [x, z] world points. */
function polygonGeometry(ring, y) {
  if (ring.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(ring[0][0], -ring[0][1]);
  for (const [x, z] of ring.slice(1)) shape.lineTo(x, -z);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

/** Paints a flat vertex colour over a geometry so it can survive merging. */
function tintGeometry(geometry, color) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function mergeAll(geometries) {
  const valid = geometries.filter(Boolean);
  if (!valid.length) return null;
  const merged = mergeGeometries(valid, false);
  valid.forEach((geometry) => geometry.dispose());
  return merged;
}

// ---------------------------------------------------------------------------
// Runway surface texture
// ---------------------------------------------------------------------------

/**
 * Paints an entire runway — asphalt, rubber, and every FAA marking — into one
 * canvas. The texture's U axis runs from the low-numbered threshold to the
 * high one and V runs across the strip, matching `orientedQuad`.
 */
function createRunwayTexture(runway) {
  const lengthM = runway.lengthM;
  const widthM = runway.widthM;
  const pixelsPerMetre = 2;
  const width = Math.min(8192, Math.round(lengthM * pixelsPerMetre));
  const height = Math.max(64, Math.round(widthM * pixelsPerMetre));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  const alongScale = width / lengthM;
  const acrossScale = height / widthM;
  const U = (metres) => metres * alongScale;
  const V = (offset) => height / 2 + offset * acrossScale;
  const concrete = runway.surface.includes("CON");

  context.fillStyle = concrete ? "#8a8b87" : "#4a4d50";
  context.fillRect(0, 0, width, height);

  // Paving lanes and patch repairs.
  const lanes = Math.max(4, Math.round(widthM / 6));
  for (let lane = 0; lane < lanes; lane += 1) {
    const shade = 6 - Math.abs((lane % 4) - 1.5) * 3;
    context.fillStyle = `rgba(255,255,255,${(shade / 255).toFixed(3)})`;
    context.fillRect(0, (lane / lanes) * height, width, height / lanes);
  }
  context.fillStyle = "rgba(0,0,0,.032)";
  for (let i = 0; i < 1100; i += 1) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    context.fillRect(x, y, Math.random() * U(24) + U(4), Math.random() * height * 0.025);
  }
  context.fillStyle = "rgba(255,255,255,.02)";
  for (let i = 0; i < 900; i += 1) {
    context.fillRect(Math.random() * width, Math.random() * height, U(14), acrossScale * 0.7);
  }

  const paint = concrete ? "#f2f0e6" : "#eceadf";
  // Distances inside this function are metres, not world units.
  const drawEnd = (end, flip) => {
    const threshold = end.displacedM;
    // Distance from this end, converted to a canvas rectangle.
    const band = (startM, spanM, offsetM, acrossM) => {
      const start = flip ? lengthM - startM - spanM : startM;
      context.fillRect(U(start), V(offsetM - acrossM / 2), U(spanM), acrossM * acrossScale);
    };

    if (end.displacedM > 6) {
      // Displaced threshold: arrows up to the usable surface, then an arrowhead
      // bar across the strip.
      context.fillStyle = paint;
      const arrows = Math.max(1, Math.floor((end.displacedM - 60) / 90));
      for (let i = 0; i < arrows; i += 1) {
        const base = 30 + i * 90;
        band(base, 60, 0, 1.2);
        for (const side of [-1, 1]) {
          const tail = flip ? lengthM - base - 60 : base + 60;
          context.save();
          context.beginPath();
          context.moveTo(U(tail), V(0));
          context.lineTo(U(flip ? tail + 16 : tail - 16), V(side * 5.5));
          context.lineTo(U(flip ? tail + 20 : tail - 20), V(side * 4.4));
          context.lineTo(U(flip ? tail + 4 : tail - 4), V(0));
          context.closePath();
          context.fill();
          context.restore();
        }
      }
      band(end.displacedM - 3, 3, 0, widthM - 3);
    }

    context.fillStyle = paint;

    // Threshold bars: 1.75 m wide, 45.7 m long, in pairs about the centreline.
    const stripes = widthM >= 60 ? 16 : widthM >= 45 ? 12 : widthM >= 30 ? 8 : 4;
    const stripeWidth = 1.75;
    const stripeSpan = stripes * stripeWidth * 2 - stripeWidth;
    for (let i = 0; i < stripes; i += 1) {
      const offset = -stripeSpan / 2 + i * stripeWidth * 2 + stripeWidth / 2;
      band(threshold + 6.1, 45.7, offset, stripeWidth);
    }

    // Designation: 18.3 m numerals with any parallel-runway letter beneath, so
    // the letter is the marking nearest the pilot on short final.
    const glyphs = (text, startM, sizeM, squeeze) => {
      const centreAlong = startM + sizeM / 2;
      context.save();
      context.translate(U(flip ? lengthM - centreAlong : centreAlong), V(0));
      context.rotate(flip ? -Math.PI / 2 : Math.PI / 2);
      // Work in metres from here so glyphs stay square on either axis.
      context.scale(acrossScale, alongScale);
      context.font = `900 ${sizeM}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      const measured = context.measureText(text).width;
      const target = text.length * sizeM * squeeze;
      context.scale(target / measured, 1);
      context.fillText(text, 0, 0);
      context.restore();
    };

    const digits = end.ident.replace(/\D/g, "");
    const letter = end.ident.replace(/[^LRC]/g, "");
    if (letter) {
      glyphs(letter, threshold + 62, 18.3, 0.62);
      glyphs(digits, threshold + 86, 18.3, 0.42);
    } else {
      glyphs(digits, threshold + 68, 18.3, 0.42);
    }

    const usable = lengthM - end.displacedM;

    // Aiming point: 45.7 m bars 306 m down the runway.
    if (usable > 1200) {
      for (const side of [-1, 1]) band(threshold + 306, 45.7, side * 12.2, 6.1);
    }

    // Touchdown zone groups; the 300 m pair is replaced by the aiming point.
    const zones = [[150, 3], [450, 2], [600, 2], [750, 1], [900, 1]];
    for (const [distance, count] of zones) {
      if (distance + 23 > usable / 2) continue;
      for (let i = 0; i < count; i += 1) {
        const inner = 10.5 + i * 3.3;
        for (const side of [-1, 1]) {
          band(threshold + distance, 22.9, side * (inner + 0.9), 1.8);
        }
      }
    }

    // Rubber laid down over the touchdown zone: soft overlapping smudges, so
    // the deposit fades into the surface instead of ending on a hard edge.
    const smudge = (centreM, radiusM, alpha) => {
      if (centreM > usable) return;
      const along = flip ? lengthM - centreM : centreM;
      const radius = U(radiusM);
      context.save();
      context.translate(U(along), V(0));
      context.scale(1, (widthM * 0.34 * acrossScale) / radius);
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
      gradient.addColorStop(0, `rgba(20,18,16,${alpha})`);
      gradient.addColorStop(0.6, `rgba(20,18,16,${alpha * 0.45})`);
      gradient.addColorStop(1, "rgba(20,18,16,0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fill();
      context.restore();
    };
    smudge(threshold + 300, 230, 0.34);
    smudge(threshold + 520, 180, 0.18);
    context.fillStyle = paint;
  };

  // Continuous side stripes.
  context.fillStyle = paint;
  for (const side of [-1, 1]) {
    context.fillRect(0, V(side * (widthM / 2 - 0.9) - 0.45), width, 0.9 * acrossScale);
  }

  // Centreline: 30 m stripe, 20 m gap, centred on the runway midpoint.
  const cycle = 50;
  const count = Math.floor(lengthM / cycle);
  const offset = (lengthM - count * cycle) / 2;
  for (let i = 0; i < count; i += 1) {
    context.fillRect(U(offset + i * cycle + 10), V(-0.45), U(30), 0.9 * acrossScale);
  }

  drawEnd(runway.ends[0], false);
  drawEnd(runway.ends[1], true);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/** Soft round sprite used for every runway and approach light. */
function createLightTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(255,255,255,.85)");
  gradient.addColorStop(0.6, "rgba(255,255,255,.22)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

// ---------------------------------------------------------------------------
// Graded airfield ground
// ---------------------------------------------------------------------------

const GRID_METRES = 12;
const FEATHER_PIXELS = 9;

// The pavement mask is a second, unfeathered raster on its own finer grid. Six
// metres a cell keeps a taxiway several cells wide, which the grading grid —
// deliberately coarse and blurred — cannot manage.
const PAVEMENT_GRID_METRES = 6;

// Structure heights are stored as one byte per grid cell, in half-metre steps.
const OBSTACLE_STEP_METRES = 0.5;
const OBSTACLE_SCALE = m(OBSTACLE_STEP_METRES);

/**
 * A coverage mask per airfield, rasterised once on a 2D canvas. The renderer
 * and the flight model both sample it so the visible ground and the surface the
 * aircraft rolls on can never disagree.
 *
 * Without this the Reef Runway — which is built on a coral platform the 1/3
 * arc-second DEM samples as open ocean — sits half underwater.
 */
export class AirfieldGround {
  constructor(airports) {
    this.fields = airports.map((airport) => this.rasterise(airport)).filter(Boolean);
  }

  rasterise(airport) {
    const points = [];
    for (const runway of airport.runways) {
      if (runway.water) continue;
      const frame = runwayFrame(runway);
      const reach = frame.halfLength + m(220);
      points.push(
        [frame.centre.x - reach, frame.centre.y - reach],
        [frame.centre.x + reach, frame.centre.y + reach],
      );
    }
    for (const pavement of airport.pavements) points.push(...pavement.polygon);
    for (const taxiway of airport.taxiways) points.push(...taxiway.path);
    if (!points.length) return null;

    const margin = m(240);
    const minX = Math.min(...points.map(([x]) => x)) - margin;
    const maxX = Math.max(...points.map(([x]) => x)) + margin;
    const minZ = Math.min(...points.map(([, z]) => z)) - margin;
    const maxZ = Math.max(...points.map(([, z]) => z)) + margin;

    // One isotropic scale for both axes, so rotated runway rectangles stay
    // rectangular in the mask.
    const scale = 1 / m(GRID_METRES);
    const width = Math.ceil((maxX - minX) * scale);
    const height = Math.ceil((maxZ - minZ) * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const toPixelX = (x) => (x - minX) * scale;
    const toPixelZ = (z) => (z - minZ) * scale;

    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#fff";
    context.strokeStyle = "#fff";
    context.lineJoin = "round";
    context.lineCap = "round";

    for (const runway of airport.runways) {
      if (runway.water) continue;
      const frame = runwayFrame(runway);
      // The graded strip: runway plus shoulders and the cleared safety area.
      const along = frame.halfLength + m(120);
      const across = frame.halfWidth + m(90);
      fillOrientedRect(context, frame, along, across, toPixelX, toPixelZ, scale);
    }

    for (const pavement of airport.pavements) {
      if (pavement.polygon.length < 3) continue;
      context.beginPath();
      context.moveTo(toPixelX(pavement.polygon[0][0]), toPixelZ(pavement.polygon[0][1]));
      for (const [x, z] of pavement.polygon.slice(1)) context.lineTo(toPixelX(x), toPixelZ(z));
      context.closePath();
      context.fill();
    }

    for (const taxiway of airport.taxiways) {
      if (taxiway.path.length < 2) continue;
      context.lineWidth = Math.max(2, m(taxiway.widthM + 50) * scale);
      context.beginPath();
      context.moveTo(toPixelX(taxiway.path[0][0]), toPixelZ(taxiway.path[0][1]));
      for (const [x, z] of taxiway.path.slice(1)) context.lineTo(toPixelX(x), toPixelZ(z));
      context.stroke();
    }

    // Blur the mask so the graded field eases into natural terrain instead of
    // ending at a cliff.
    const blurred = document.createElement("canvas");
    blurred.width = width;
    blurred.height = height;
    const blurContext = blurred.getContext("2d", { willReadFrequently: true });
    blurContext.filter = `blur(${FEATHER_PIXELS}px)`;
    blurContext.drawImage(canvas, 0, 0);

    const image = blurContext.getImageData(0, 0, width, height).data;
    const mask = new Float32Array(width * height);
    for (let i = 0; i < mask.length; i += 1) mask[i] = image[i * 4] / 255;

    return {
      code: airport.code,
      elevation: m(airport.elevationM),
      minX,
      maxX,
      minZ,
      maxZ,
      width,
      height,
      mask,
      pavement: this.rasterisePavement(airport, { minX, maxX, minZ, maxZ }),
      obstacles: this.rasteriseObstacles(airport, {
        minX,
        maxX,
        minZ,
        maxZ,
        width,
        height,
        scale,
      }),
    };
  }

  /**
   * The pavement that is actually drawn, rasterised unfeathered on its own grid:
   * one channel for coverage and one for the layer the surface sits on.
   *
   * The grading mask cannot answer this. It is blurred by more than a runway is
   * wide — deliberately, so the field eases into the hillside around it — which
   * leaves it reading about two thirds on a runway centreline rather than one.
   * Deriving the height of the tarmac from it put the surface the wheels roll on
   * the better part of a metre below the surface the pilot can see.
   */
  rasterisePavement(airport, bounds) {
    const { minX, maxX, minZ, maxZ } = bounds;
    const scale = 1 / m(PAVEMENT_GRID_METRES);
    const width = Math.ceil((maxX - minX) * scale);
    const height = Math.ceil((maxZ - minZ) * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const toPixelX = (x) => (x - minX) * scale;
    const toPixelZ = (z) => (z - minZ) * scale;
    context.lineJoin = "round";
    context.lineCap = "round";

    // Grey carries the layer, full white being the runway. Lower layers go down
    // first, so wherever two of them overlap the taller one is what is left.
    const shade = (rise) => {
      const level = Math.round((rise / PAVEMENT_RISE) * 255);
      context.fillStyle = `rgb(${level},${level},${level})`;
      context.strokeStyle = context.fillStyle;
    };
    const runways = airport.runways.filter((runway) => !runway.water);

    shade(LAYER.apron);
    for (const pavement of airport.pavements) {
      if (pavement.polygon.length < 3) continue;
      context.beginPath();
      context.moveTo(toPixelX(pavement.polygon[0][0]), toPixelZ(pavement.polygon[0][1]));
      for (const [x, z] of pavement.polygon.slice(1)) context.lineTo(toPixelX(x), toPixelZ(z));
      context.closePath();
      context.fill();
    }
    for (const runway of runways) {
      const frame = runwayFrame(runway);
      // The shoulders, which are drawn on the apron layer.
      fillOrientedRect(
        context,
        frame,
        frame.halfLength + m(60),
        frame.halfWidth + m(7.5),
        toPixelX,
        toPixelZ,
        scale,
      );
    }

    shade(LAYER.taxiway);
    for (const taxiway of airport.taxiways) {
      if (taxiway.path.length < 2) continue;
      context.lineWidth = Math.max(1, m(taxiway.widthM) * scale);
      context.beginPath();
      context.moveTo(toPixelX(taxiway.path[0][0]), toPixelZ(taxiway.path[0][1]));
      for (const [x, z] of taxiway.path.slice(1)) context.lineTo(toPixelX(x), toPixelZ(z));
      context.stroke();
    }

    shade(LAYER.runway);
    for (const runway of runways) {
      const frame = runwayFrame(runway);
      fillOrientedRect(
        context,
        frame,
        frame.halfLength,
        frame.halfWidth,
        toPixelX,
        toPixelZ,
        scale,
      );
    }

    const pixels = context.getImageData(0, 0, width, height).data;
    const cover = new Uint8Array(width * height);
    const layer = new Uint8Array(width * height);
    let painted = 0;
    for (let i = 0; i < cover.length; i += 1) {
      cover[i] = pixels[i * 4 + 3];
      layer[i] = pixels[i * 4];
      if (cover[i]) painted += 1;
    }
    return painted ? { minX, maxX, minZ, maxZ, width, height, cover, layer } : null;
  }

  /**
   * Structure heights on the same grid as the ground mask. Shorter buildings are
   * drawn first so a taller neighbour overwrites them and each cell ends up
   * holding the tallest thing standing on it.
   */
  rasteriseObstacles(airport, grid) {
    if (!airport.buildings?.length) return null;
    const canvas = document.createElement("canvas");
    canvas.width = grid.width;
    canvas.height = grid.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "#000";
    context.fillRect(0, 0, grid.width, grid.height);

    const ordered = [...airport.buildings].sort((a, b) => a.heightM - b.heightM);
    for (const building of ordered) {
      if (building.polygon.length < 3) continue;
      const steps = Math.min(255, Math.round(building.heightM / OBSTACLE_STEP_METRES));
      if (steps <= 0) continue;
      context.fillStyle = `rgb(${steps},${steps},${steps})`;
      context.beginPath();
      context.moveTo(
        (building.polygon[0][0] - grid.minX) * grid.scale,
        (building.polygon[0][1] - grid.minZ) * grid.scale,
      );
      for (const [x, z] of building.polygon.slice(1)) {
        context.lineTo((x - grid.minX) * grid.scale, (z - grid.minZ) * grid.scale);
      }
      context.closePath();
      context.fill();
    }

    const pixels = context.getImageData(0, 0, grid.width, grid.height).data;
    const heights = new Uint8Array(grid.width * grid.height);
    let occupied = 0;
    for (let i = 0; i < heights.length; i += 1) {
      heights[i] = pixels[i * 4];
      if (heights[i]) occupied += 1;
    }
    return occupied ? heights : null;
  }

  sample(grid, x, z, data = grid.mask) {
    const u = ((x - grid.minX) / (grid.maxX - grid.minX)) * grid.width - 0.5;
    const v = ((z - grid.minZ) / (grid.maxZ - grid.minZ)) * grid.height - 0.5;
    if (u < 0 || v < 0 || u > grid.width - 1 || v > grid.height - 1) return 0;
    const x0 = Math.floor(u);
    const z0 = Math.floor(v);
    const x1 = Math.min(grid.width - 1, x0 + 1);
    const z1 = Math.min(grid.height - 1, z0 + 1);
    const tx = u - x0;
    const tz = v - z0;
    const top = THREE.MathUtils.lerp(
      data[z0 * grid.width + x0],
      data[z0 * grid.width + x1],
      tx,
    );
    const bottom = THREE.MathUtils.lerp(
      data[z1 * grid.width + x0],
      data[z1 * grid.width + x1],
      tx,
    );
    return THREE.MathUtils.lerp(top, bottom, tz);
  }

  /**
   * Height of the tallest structure standing at a point, in world units above
   * whatever ground is under it, or zero in the open. Sampled nearest-neighbour
   * and unblurred: a terminal has a wall, and interpolating it into a ramp
   * would let an aircraft ride up the side of the building instead of hitting
   * it.
   */
  obstacleHeightAt(x, z) {
    let tallest = 0;
    for (const field of this.fields) {
      if (!field.obstacles) continue;
      if (x < field.minX || x > field.maxX || z < field.minZ || z > field.maxZ) continue;
      const column = Math.round(((x - field.minX) / (field.maxX - field.minX)) * field.width - 0.5);
      const row = Math.round(((z - field.minZ) / (field.maxZ - field.minZ)) * field.height - 0.5);
      if (column < 0 || row < 0 || column >= field.width || row >= field.height) continue;
      const stored = field.obstacles[row * field.width + column];
      if (stored) tallest = Math.max(tallest, stored * OBSTACLE_SCALE);
    }
    return tallest;
  }

  /**
   * Height of the surface an aircraft rolls on: the top of the drawn pavement
   * wherever there is any, and the graded field everywhere else.
   *
   * Pavement is drawn dead flat at the published field elevation, so this reads
   * that elevation directly rather than the graded terrain underneath it. The
   * two disagree by most of a metre on a runway, and taking the graded figure
   * left the wheels buried in the tarmac they were visibly rolling on.
   */
  rollingHeightAt(x, z, gradedHeight) {
    let height = gradedHeight;
    for (const field of this.fields) {
      const grid = field.pavement;
      if (!grid) continue;
      if (x < grid.minX || x > grid.maxX || z < grid.minZ || z > grid.maxZ) continue;
      const coverage = this.sample(grid, x, z, grid.cover) / 255;
      if (coverage <= 0.002) continue;
      // The layer channel is stored unmultiplied, so dividing by coverage reads
      // the layer itself at an edge cell rather than a value fading to zero.
      const layer = Math.min(1, this.sample(grid, x, z, grid.layer) / 255 / coverage);
      const surface = field.elevation + layer * PAVEMENT_RISE;
      // Coverage carries the shoulder off the pavement onto open ground over a
      // cell or two, instead of a step at the edge of the tarmac.
      height = Math.max(height, THREE.MathUtils.lerp(gradedHeight, surface, coverage));
    }
    return height;
  }

  /** Strongest graded-airfield coverage at a point; zero outside every field. */
  coverageAt(x, z) {
    let best = 0;
    for (const field of this.fields) {
      if (x < field.minX || x > field.maxX || z < field.minZ || z > field.maxZ) continue;
      best = Math.max(best, this.sample(field, x, z));
    }
    return best;
  }

  /**
   * Blends the natural terrain height towards the published field elevation.
   * `naturalHeight` may be the deep ocean skirt, so the blend first lifts the
   * sea bed to a shelf and only then grades up to the apron.
   */
  heightAt(x, z, naturalHeight) {
    let height = naturalHeight;
    for (const field of this.fields) {
      if (x < field.minX || x > field.maxX || z < field.minZ || z > field.maxZ) continue;
      const coverage = this.sample(field, x, z);
      if (coverage <= 0.002) continue;
      // Lift the sea bed to a shelf first, then grade up to the apron, so a
      // runway built out on a reef gets a solid causeway instead of a cliff.
      const shelf = Math.max(height, m(-8));
      const lifted = THREE.MathUtils.lerp(height, shelf, THREE.MathUtils.clamp(coverage / 0.25, 0, 1));
      height = THREE.MathUtils.lerp(lifted, field.elevation, coverage);
    }
    return height;
  }
}

// ---------------------------------------------------------------------------
// Scenery
// ---------------------------------------------------------------------------

const BUILDING_STYLES = {
  terminal: { wall: 0xd8d5cc, roof: 0xb4b2ab, cast: true },
  hangar: { wall: 0xc3c6c7, roof: 0x9ea3a5, cast: true },
  tower: { wall: 0xd2cec4, roof: 0x5c6367, cast: true },
  parking: { wall: 0xb9b6ae, roof: 0xa5a29a, cast: true },
  building: { wall: 0xcac6bb, roof: 0xa9a69c, cast: false },
};

const MAX_BUILDINGS_PER_FIELD = 900;

export class AirportScenery {
  constructor(data) {
    this.data = data;
    this.group = new THREE.Group();
    this.group.name = "airports";
    this.lightTexture = createLightTexture();
    this.buildingTextures = new BuildingTextures();
    // One atlas and one pair of meshes for every sign on every field.
    this.signage = new SignageBuilder();
    this.runwayIndex = new Map();

    for (const airport of data.airports) this.buildAirport(airport);

    const signs = this.signage.finish();
    if (signs) this.group.add(signs);
  }

  /**
   * Releases every buffer and texture the fields allocated. Areas are swapped
   * rather than accumulated, so an undisposed set of airfields is a leak of a
   * few hundred meshes and a handful of canvas atlases per switch.
   */
  dispose() {
    const geometries = new Set();
    const materials = new Set();
    this.group.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of [object.material].flat()) if (material) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) {
      for (const key of ["map", "alphaMap", "emissiveMap", "normalMap", "roughnessMap"]) {
        material[key]?.dispose();
      }
      material.dispose();
    }
    // The atlases cache by feature kind, so they can be holding a canvas no
    // surviving material happens to reference.
    this.buildingTextures?.dispose();
    this.signage?.atlas?.texture?.dispose();
    this.lightTexture?.dispose();
    this.runwayIndex.clear();
  }

  buildAirport(airport) {
    const base = m(airport.elevationM);
    const group = new THREE.Group();
    group.name = airport.code;

    this.buildPavement(airport, base, group);
    this.buildRunways(airport, base, group);
    this.buildBuildings(airport, base, group);
    this.buildLights(airport, base, group);
    this.buildSigns(airport, base, group);
    this.buildWindsocks(airport, base, group);

    this.group.add(group);
  }

  // -- Aprons and taxiways --------------------------------------------------

  buildPavement(airport, base, group) {
    const aprons = mergeAll(
      airport.pavements.map((pavement) => polygonGeometry(pavement.polygon, base + LAYER.apron)),
    );
    if (aprons) {
      const mesh = new THREE.Mesh(
        aprons,
        new THREE.MeshStandardMaterial({
          color: PAVEMENT_COLOR,
          roughness: 0.95,
          metalness: 0,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    const surfaces = [];
    const centrelines = [];
    for (const taxiway of airport.taxiways) {
      surfaces.push(ribbonGeometry(taxiway.path, m(taxiway.widthM), base + LAYER.taxiway));
      centrelines.push(ribbonGeometry(taxiway.path, m(0.9), base + LAYER.taxiwayLine));
    }

    const taxiwayGeometry = mergeAll(surfaces);
    if (taxiwayGeometry) {
      const mesh = new THREE.Mesh(
        taxiwayGeometry,
        new THREE.MeshStandardMaterial({
          color: TAXIWAY_COLOR,
          roughness: 0.96,
          metalness: 0,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
        }),
      );
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    const lineGeometry = mergeAll(centrelines);
    if (lineGeometry) {
      group.add(
        new THREE.Mesh(
          lineGeometry,
          new THREE.MeshBasicMaterial({
            color: 0xd8b833,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
          }),
        ),
      );
    }
  }

  // -- Runways --------------------------------------------------------------

  buildRunways(airport, base, group) {
    const shoulders = [];
    for (const runway of airport.runways) {
      if (runway.water) continue;
      const frame = runwayFrame(runway);

      shoulders.push(
        orientedQuad(
          frame,
          frame.halfLength + m(60),
          frame.halfWidth + m(7.5),
          base + LAYER.apron,
        ),
      );

      const mesh = new THREE.Mesh(
        orientedQuad(frame, frame.halfLength, frame.halfWidth, base + LAYER.runway, true),
        new THREE.MeshStandardMaterial({
          map: createRunwayTexture(runway),
          roughness: 0.88,
          metalness: 0,
          polygonOffset: true,
          polygonOffsetFactor: -6,
          polygonOffsetUnits: -6,
        }),
      );
      mesh.receiveShadow = true;
      mesh.name = `${airport.code}-${runway.designator}`;
      group.add(mesh);

      for (const end of runway.ends) {
        this.runwayIndex.set(`${airport.code}/${end.ident}`, { airport, runway, end, frame });
      }
    }

    const shoulderGeometry = mergeAll(shoulders);
    if (shoulderGeometry) {
      const mesh = new THREE.Mesh(
        shoulderGeometry,
        new THREE.MeshStandardMaterial({
          color: SHOULDER_COLOR,
          roughness: 0.98,
          metalness: 0,
          polygonOffset: true,
          polygonOffsetFactor: -5,
          polygonOffsetUnits: -5,
        }),
      );
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // -- Structures -----------------------------------------------------------

  buildBuildings(airport, base, group) {
    // Walls batch per building class so each can wear its own facade; roofs and
    // rooftop plant batch per surface type across the whole field. That keeps
    // the whole airfield's structures inside a handful of draw calls even
    // though every footprint now carries three separate surfaces.
    const walls = new Map();
    const roofs = new Map();
    const clutter = [];

    for (const raw of airport.buildings.slice(0, MAX_BUILDINGS_PER_FIELD)) {
      const landmark = landmarkFor(raw);
      if (landmark) {
        const object = landmark(raw, base, { textures: this.buildingTextures, m, minAreaRect });
        if (object) {
          group.add(object);
          continue;
        }
        // A landmark that declines to build falls through to the procedural
        // path rather than leaving a hole in the field.
      }

      const structure = buildStructure(raw, base);
      if (!structure) continue;
      const { building, roofKind } = structure;
      const style = BUILDING_STYLES[building.kind] ?? BUILDING_STYLES.building;

      // A little tonal drift stops merged blocks reading as one flat mass.
      const drift = ((building.polygon[0][0] * 37 + building.polygon[0][1] * 17) % 1000) / 1000;
      const wall = new THREE.Color(building.wallColor ?? style.wall).offsetHSL(
        0,
        0,
        (drift - 0.5) * 0.08,
      );
      const roof = new THREE.Color(building.roofColor ?? style.roof).offsetHSL(
        0,
        0,
        (drift - 0.5) * 0.05,
      );

      tintGeometry(structure.walls, wall);
      if (!walls.has(building.kind)) walls.set(building.kind, []);
      walls.get(building.kind).push(structure.walls);

      // The parapet is wall geometry but reads as part of the roof, so it takes
      // the roof tint and the roof's surface.
      for (const piece of [structure.roof, structure.parapet]) {
        if (!piece) continue;
        tintGeometry(piece, roof);
        if (!roofs.has(roofKind)) roofs.set(roofKind, []);
        roofs.get(roofKind).push(piece);
      }

      for (const piece of structure.clutter) {
        tintGeometry(piece, roof.clone().offsetHSL(0, 0, -0.06));
        clutter.push(piece);
      }
    }

    for (const [kind, geometries] of walls) {
      const merged = mergeAll(geometries);
      if (!merged) continue;
      const style = BUILDING_STYLES[kind] ?? BUILDING_STYLES.building;
      const mesh = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({
          map: this.buildingTextures.facade(kind),
          vertexColors: true,
          roughness: kind === "hangar" ? 0.55 : 0.86,
          metalness: kind === "hangar" ? 0.22 : 0.04,
        }),
      );
      mesh.castShadow = style.cast;
      mesh.receiveShadow = true;
      mesh.name = `${kind}-walls`;
      group.add(mesh);
    }

    for (const [kind, geometries] of roofs) {
      const merged = mergeAll(geometries);
      if (!merged) continue;
      const mesh = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({
          map: this.buildingTextures.roof(kind),
          vertexColors: true,
          roughness: kind === "metal" ? 0.6 : 0.95,
          metalness: kind === "metal" ? 0.25 : 0.02,
        }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `${kind}-roofs`;
      group.add(mesh);
    }

    const clutterGeometry = mergeAll(clutter);
    if (clutterGeometry) {
      const mesh = new THREE.Mesh(
        clutterGeometry,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = "roof-plant";
      group.add(mesh);
    }
  }

  // -- Lighting -------------------------------------------------------------

  buildLights(airport, base, group) {
    const positions = [];
    const colors = [];
    const add = (x, y, z, color) => {
      positions.push(x, y, z);
      colors.push(color.r, color.g, color.b);
    };

    const white = new THREE.Color(0xfff6de);
    const amber = new THREE.Color(0xffb228);
    const green = new THREE.Color(0x35e07a);
    const red = new THREE.Color(0xff3b30);
    const height = base + m(0.4);

    for (const runway of airport.runways) {
      if (runway.water) continue;
      const frame = runwayFrame(runway);
      const { centre, forward, right, halfLength, halfWidth } = frame;
      const at = (along, across, y = height) => [
        centre.x + forward.x * along + right.x * across,
        y,
        centre.y + forward.y * along + right.y * across,
      ];
      const lengthM = runway.lengthM;

      // Edge lights every 60 m, turning amber over the final 600 m.
      const spacing = m(60);
      for (let along = -halfLength; along <= halfLength + 1e-6; along += spacing) {
        const remaining = m(lengthM) / 2 - Math.abs(along);
        const color = remaining < m(600) ? amber : white;
        for (const side of [-1, 1]) add(...at(along, side * (halfWidth + m(3))), color);
      }

      // Centreline lights. Real fixtures show white one way and red the other
      // over the final stretch; a single omnidirectional point cannot do both,
      // and white is what a pilot sees for most of the roll.
      for (let along = -halfLength; along <= halfLength + 1e-6; along += m(30)) {
        add(...at(along, 0), white);
      }

      for (const [index, end] of runway.ends.entries()) {
        const sign = index === 0 ? -1 : 1;
        const threshold = sign * (halfLength - m(end.displacedM));

        // Threshold bar.
        for (let i = -7; i <= 7; i += 1) {
          add(...at(threshold, (i / 7) * halfWidth), green);
        }

        // Approach lighting reaching 720 m out from the threshold, with the
        // 300 m crossbar that gives the system its distinctive shape.
        for (let distance = 30; distance <= 720; distance += 30) {
          const along = threshold + sign * m(distance);
          add(...at(along, 0), white);
          if (distance === 300) {
            for (let i = -4; i <= 4; i += 1) {
              if (i !== 0) add(...at(along, i * m(4.5)), white);
            }
          }
        }
      }

      // PAPI: four boxes 300 m in from each threshold, off the left edge.
      for (const [index] of runway.ends.entries()) {
        const sign = index === 0 ? -1 : 1;
        const along = sign * (halfLength - m(300));
        for (let i = 0; i < 4; i += 1) {
          add(...at(along, -(halfWidth + m(15) + i * m(9))), i < 2 ? white : red);
        }
      }
    }

    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: m(4),
        map: this.lightTexture,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    points.name = "lights";
    group.add(points);
  }

  // -- Signage --------------------------------------------------------------

  /**
   * Plants the field's guidance signs and paints the holding-position bars they
   * refer to. Both come off the same taxiway graph, so a sign and the markings
   * it protects can never end up in different places.
   */
  buildSigns(airport, base, group) {
    const frames = airport.runways
      .filter((runway) => !runway.water)
      .map((runway) => ({ runway, frame: runwayFrame(runway) }));
    if (!frames.length) return;

    const graph = new TaxiwayGraph(airport.taxiways);
    const crossings = holdCrossings(graph, frames);

    this.signage.add(planSigns(airport, frames, graph, crossings), base + LAYER.sign);

    const stripes = planHoldMarkings(crossings).map(
      ({ centre, along, across, halfLength, halfWidth }) =>
        orientedQuad(
          // A bar runs across the taxiway, so `across` is its long axis. The
          // right-hand partner of that axis is the reverse of the direction of
          // travel — pairing it with `along` instead builds a left-handed frame
          // and the stripe ends up facing into the pavement, invisible.
          { centre, forward: across, right: along.clone().negate() },
          halfLength,
          halfWidth,
          base + LAYER.holdMarking,
        ),
    );
    const markings = mergeAll(stripes);
    if (markings) {
      const mesh = new THREE.Mesh(
        markings,
        new THREE.MeshBasicMaterial({
          color: 0xd8b833,
          polygonOffset: true,
          polygonOffsetFactor: -7,
          polygonOffsetUnits: -7,
        }),
      );
      mesh.name = "hold-markings";
      group.add(mesh);
    }
  }

  // -- Windsocks ------------------------------------------------------------

  buildWindsocks(airport, base, group) {
    const sockMaterial = new THREE.MeshStandardMaterial({
      color: 0xf06a1e,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0xdedad0, roughness: 0.6 });

    const sites = airport.markers.filter((marker) => marker.kind === "windsock");
    // Every field gets at least one, set beside the primary runway's midpoint.
    if (!sites.length) {
      const runway = airport.runways.find((entry) => !entry.water);
      if (!runway) return;
      const frame = runwayFrame(runway);
      sites.push({
        world: [
          frame.centre.x + frame.right.x * (frame.halfWidth + m(60)),
          frame.centre.y + frame.right.y * (frame.halfWidth + m(60)),
        ],
      });
    }

    for (const site of sites.slice(0, 6)) {
      const windsock = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(m(0.08), m(0.1), m(5), 8), poleMaterial);
      pole.position.y = m(2.5);
      windsock.add(pole);

      const sock = new THREE.Mesh(
        new THREE.ConeGeometry(m(0.5), m(3.6), 10, 1, true),
        sockMaterial,
      );
      sock.rotation.z = Math.PI / 2;
      sock.rotation.y = Math.PI;
      sock.position.set(m(1.8), m(4.7), 0);
      windsock.add(sock);

      windsock.position.set(site.world[0], base, site.world[1]);
      windsock.rotation.y = Math.PI * 0.45;
      group.add(windsock);
    }
  }

  // -- Queries --------------------------------------------------------------

  /**
   * Start position and true heading for a runway end, on the centreline just
   * beyond the threshold bars and designation numbers.
   */
  runwayStart(code, ident) {
    const entry = this.runwayIndex.get(`${code}/${ident}`);
    if (!entry) return null;
    const { runway, end, frame } = entry;
    const index = runway.ends.indexOf(end);
    const sign = index === 0 ? -1 : 1;
    const along = sign * (frame.halfLength - m(end.displacedM + 140));
    const direction = sign === -1 ? frame.forward : frame.forward.clone().negate();
    return {
      position: new THREE.Vector3(
        frame.centre.x + frame.forward.x * along,
        m(entry.airport.elevationM),
        frame.centre.y + frame.forward.y * along,
      ),
      // The flight model's forward vector is (sin h, 0, -cos h).
      heading: Math.atan2(direction.x, -direction.y),
    };
  }
}

export async function loadAirports(url = "/airports/hawaii-airports.json") {
  url = asset(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Airport data responded ${response.status}`);
  return response.json();
}
