import * as THREE from "three";

// Turns an OSM footprint into a structure that reads as a building rather than
// a block: walls carrying a tiled facade, a shaped roof, and the rooftop plant
// that is most of what you actually see from a cockpit.
//
// Everything works in world units, where one unit is ten metres.

const WORLD_PER_METRE = 0.1;
const m = (metres) => metres * WORLD_PER_METRE;

// Facade UVs are expressed in modules, not metres: U advances by one per window
// bay along the wall and V by one per storey. A facade tile drawn as a single
// bay then lines its windows up with the real floor count for free.
const BAY_METRES = 4.2;
const METRES_PER_LEVEL = 3.6;

// Non-flat roofs are built over the footprint's minimum-area rectangle. That is
// exact for the sheds and hangars it matters most for, but a terminal with a
// ragged outline would wear a roof hanging well past its walls, so anything
// that fills too little of its own bounding rectangle stays flat.
const RECTANGULARITY_FOR_PITCH = 0.82;

// ---------------------------------------------------------------------------
// Footprint analysis
// ---------------------------------------------------------------------------

function ringArea(ring) {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, z1] = ring[index];
    const [x2, z2] = ring[(index + 1) % ring.length];
    total += x1 * z2 - x2 * z1;
  }
  return Math.abs(total) / 2;
}

/** Andrew's monotone chain. Rings are small, so the sort dominates. */
function convexHull(points) {
  if (points.length < 4) return points.slice();
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const build = (list) => {
    const stack = [];
    for (const point of list) {
      while (stack.length >= 2 && cross(stack[stack.length - 2], stack[stack.length - 1], point) <= 0) {
        stack.pop();
      }
      stack.push(point);
    }
    stack.pop();
    return stack;
  };

  return [...build(sorted), ...build(sorted.slice().reverse())];
}

/**
 * Minimum-area bounding rectangle. The optimal rectangle always shares an edge
 * with the convex hull, so testing every hull edge direction finds it — and a
 * building ring's hull is short enough that the quadratic cost is irrelevant.
 *
 * `u` runs along the rectangle's long axis, which is the ridge line a gabled
 * roof wants.
 */
export function minAreaRect(ring) {
  const hull = convexHull(ring);
  if (hull.length < 3) return null;

  let best = null;
  for (let index = 0; index < hull.length; index += 1) {
    const [ax, az] = hull[index];
    const [bx, bz] = hull[(index + 1) % hull.length];
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 1e-6) continue;
    const ux = (bx - ax) / length;
    const uz = (bz - az) / length;

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, z] of hull) {
      const u = x * ux + z * uz;
      const v = -x * uz + z * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      best = { area, ux, uz, minU, maxU, minV, maxV };
    }
  }
  if (!best) return null;

  const { ux, uz, minU, maxU, minV, maxV } = best;
  const centreU = (minU + maxU) / 2;
  const centreV = (minV + maxV) / 2;
  let halfU = (maxU - minU) / 2;
  let halfV = (maxV - minV) / 2;
  let axisU = new THREE.Vector2(ux, uz);
  // Keep u as the long axis so callers can assume the ridge runs along it.
  if (halfV > halfU) {
    [halfU, halfV] = [halfV, halfU];
    axisU = new THREE.Vector2(-uz, ux);
  }

  return {
    centre: new THREE.Vector2(centreU * ux - centreV * uz, centreU * uz + centreV * ux),
    axisU,
    axisV: new THREE.Vector2(-axisU.y, axisU.x),
    halfU,
    halfV,
    area: best.area,
  };
}

function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Deterministic per-building noise, so a footprint looks the same every load. */
function seededRandom(seed) {
  let state = (seed | 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Geometry pieces
// ---------------------------------------------------------------------------

function geometryFrom(positions, uvs, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The wall band between `bottom` and `top`, with UVs in bay/storey modules.
 *
 * U accumulates real distance around the perimeter so the bay rhythm stays
 * continuous around corners instead of restarting on every face.
 */
function wallGeometry(ring, bottom, top) {
  if (ring.length < 3 || top <= bottom) return null;
  const positions = [];
  const uvs = [];
  const indices = [];
  const vTop = (top - bottom) / m(METRES_PER_LEVEL);

  let distance = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [ax, az] = ring[index];
    const [bx, bz] = ring[(index + 1) % ring.length];
    const span = Math.hypot(bx - ax, bz - az);
    if (span < 1e-6) continue;

    const u0 = distance / m(BAY_METRES);
    distance += span;
    const u1 = distance / m(BAY_METRES);

    const base = positions.length / 3;
    positions.push(ax, bottom, az, bx, bottom, bz, bx, top, bz, ax, top, az);
    uvs.push(u0, 0, u1, 0, u1, vTop, u0, vTop);
    // The build script normalises every ring to a positive signed area, which
    // in a Y-up world traces the footprint clockwise seen from above. Winding
    // each quad against that is what puts its front face on the outside —
    // wound the other way the walls survive merging but get backface-culled,
    // leaving roofs floating over open ground.
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  if (!indices.length) return null;
  return geometryFrom(positions, uvs, indices);
}

/** Triangulated cap over the footprint, UV-mapped in world metres. */
function capGeometry(ring, y, tileMetres) {
  if (ring.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(ring[0][0], -ring[0][1]);
  for (const [x, z] of ring.slice(1)) shape.lineTo(x, -z);
  shape.closePath();

  let geometry;
  try {
    geometry = new THREE.ShapeGeometry(shape);
  } catch {
    return null;
  }
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);

  const position = geometry.attributes.position;
  const uvs = new Float32Array(position.count * 2);
  const scale = 1 / m(tileMetres);
  for (let i = 0; i < position.count; i += 1) {
    uvs[i * 2] = position.getX(i) * scale;
    uvs[i * 2 + 1] = position.getZ(i) * scale;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A pitched or vaulted roof over the footprint's bounding rectangle.
 *
 * The roof is built as a strip of profile sections swept along the ridge, which
 * covers gabled, hipped, skillion, and barrel shapes with one path — only the
 * profile and the end treatment differ.
 */
function pitchedRoof(rect, eaves, rise, shape, orientation) {
  const { centre, axisU, axisV } = rect;
  // `roof:orientation=across` puts the ridge on the short axis instead.
  const along = orientation === "across" ? axisV : axisU;
  const across = orientation === "across" ? axisU : axisV;
  const halfAlong = orientation === "across" ? rect.halfV : rect.halfU;
  const halfAcross = orientation === "across" ? rect.halfU : rect.halfV;

  const at = (a, c, y) => [
    centre.x + along.x * a + across.x * c,
    y,
    centre.y + along.y * a + across.y * c,
  ];

  // Profile across the ridge, as (offset, height above eaves) pairs.
  let profile;
  if (shape === "skillion") {
    profile = [[-halfAcross, 0], [halfAcross, rise]];
  } else if (shape === "round") {
    const segments = 9;
    profile = [];
    for (let i = 0; i <= segments; i += 1) {
      const t = (i / segments) * Math.PI;
      profile.push([-Math.cos(t) * halfAcross, Math.sin(t) * rise]);
    }
  } else {
    profile = [[-halfAcross, 0], [0, rise], [halfAcross, 0]];
  }

  // A hipped roof pulls its ridge in from both gable ends; a gable runs the
  // ridge the full length and closes the ends with a vertical wall.
  const inset = shape === "hipped" ? Math.min(halfAcross, halfAlong * 0.5) : 0;
  const sections = [
    { a: -halfAlong, scale: shape === "hipped" ? 0 : 1 },
    { a: -halfAlong + inset, scale: 1 },
    { a: halfAlong - inset, scale: 1 },
    { a: halfAlong, scale: shape === "hipped" ? 0 : 1 },
  ];

  const positions = [];
  const uvs = [];
  const indices = [];
  const tile = 1 / m(3);

  for (const { a, scale } of sections) {
    for (const [offset, height] of profile) {
      const [x, y, z] = at(a, offset * (scale || 1e-3), eaves + height * scale);
      positions.push(x, y, z);
      uvs.push(a * tile, offset * tile);
    }
  }

  // `across` is the left normal of `along`, which makes the (along, across)
  // frame left-handed against a Y-up world — so the sweep has to wind the
  // opposite way from the obvious one to face its triangles skyward.
  const width = profile.length;
  for (let s = 0; s < sections.length - 1; s += 1) {
    for (let p = 0; p < width - 1; p += 1) {
      const base = s * width + p;
      indices.push(base, base + width + 1, base + width, base, base + 1, base + width + 1);
    }
  }

  // Gable ends: the triangle of wall between the eaves line and the profile.
  if (shape !== "hipped") {
    for (const end of [-1, 1]) {
      const a = end * halfAlong;
      const start = positions.length / 3;
      for (const [offset, height] of profile) {
        const [x, y, z] = at(a, offset, eaves + height);
        positions.push(x, y, z);
        uvs.push(offset * tile, height * tile);
      }
      const [ex, ey, ez] = at(a, 0, eaves);
      positions.push(ex, ey, ez);
      uvs.push(0, 0);
      const apex = positions.length / 3 - 1;
      // The gable fan keeps the winding the sweep does not: its plane is
      // normal to the ridge, so the handedness that flips the roof leaves the
      // ends alone.
      for (let p = 0; p < width - 1; p += 1) {
        if (end < 0) indices.push(start + p, start + p + 1, apex);
        else indices.push(start + p + 1, start + p, apex);
      }
    }
  }

  if (!indices.length) return null;
  return geometryFrom(positions, uvs, indices);
}

/** Upstand around a flat roof. Almost every flat roof has one, and its shadow
 *  line is what stops the roof reading as a painted lid. */
function parapetGeometry(ring, top, height) {
  return wallGeometry(ring, top, top + height);
}

/**
 * Plant, vents, and stair housings scattered over a flat roof.
 *
 * From a cockpit this is most of what distinguishes a building from a box, and
 * it is far cheaper than modelling the real thing: the eye reads the broken
 * silhouette, not the individual units.
 */
function roofClutter(ring, rect, top, seed, areaMetres) {
  const random = seededRandom(seed);
  const geometries = [];
  // Roughly one unit per 400 m² of roof, capped so a terminal does not become
  // a thousand boxes.
  const count = Math.min(26, Math.round(areaMetres / 400));
  if (count < 1) return geometries;

  const { centre, axisU, axisV, halfU, halfV } = rect;
  let placed = 0;
  for (let attempt = 0; attempt < count * 8 && placed < count; attempt += 1) {
    const u = (random() * 2 - 1) * halfU * 0.86;
    const v = (random() * 2 - 1) * halfV * 0.86;
    const x = centre.x + axisU.x * u + axisV.x * v;
    const z = centre.y + axisU.y * u + axisV.y * v;
    if (!pointInRing(ring, x, z)) continue;

    // A few tall stair or lift overruns among mostly low plant.
    const tall = random() < 0.18;
    const width = m(2.4 + random() * (tall ? 3.5 : 5.5));
    const depth = m(2.0 + random() * (tall ? 3.0 : 4.5));
    const height = m(tall ? 3.0 + random() * 2.2 : 1.0 + random() * 1.4);

    const box = new THREE.BoxGeometry(width, height, depth);
    box.translate(0, height / 2, 0);
    box.rotateY(-Math.atan2(axisU.y, axisU.x));
    box.translate(x, top, z);
    geometries.push(box);
    placed += 1;
  }
  return geometries;
}

// ---------------------------------------------------------------------------
// Facade and roof textures
// ---------------------------------------------------------------------------

// One bay wide, one storey tall. Drawn light so the per-building vertex tint
// multiplies over it rather than fighting it.
const FACADE_SIZE = 128;

function facadeCanvas(draw) {
  const canvas = document.createElement("canvas");
  canvas.width = FACADE_SIZE;
  canvas.height = FACADE_SIZE;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, FACADE_SIZE, FACADE_SIZE);
  draw(context, FACADE_SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const FACADE_PAINTERS = {
  // Curtain wall: a deep glazed band with a bright spandrel and mullions.
  terminal(context, size) {
    context.fillStyle = "#6f7d8a";
    context.fillRect(size * 0.06, size * 0.16, size * 0.88, size * 0.56);
    context.fillStyle = "rgba(255,255,255,0.22)";
    context.fillRect(size * 0.06, size * 0.16, size * 0.88, size * 0.12);
    context.strokeStyle = "#d5d3cd";
    context.lineWidth = size * 0.045;
    context.strokeRect(size * 0.06, size * 0.16, size * 0.88, size * 0.56);
    context.beginPath();
    context.moveTo(size * 0.5, size * 0.16);
    context.lineTo(size * 0.5, size * 0.72);
    context.stroke();
  },
  // Profiled steel: continuous vertical ribs, blind except for a clerestory
  // strip near the eaves.
  hangar(context, size) {
    for (let x = 0; x < size; x += size / 10) {
      context.fillStyle = "rgba(0,0,0,0.10)";
      context.fillRect(x, 0, size / 20, size);
      context.fillStyle = "rgba(255,255,255,0.55)";
      context.fillRect(x + size / 20, 0, size / 40, size);
    }
    context.fillStyle = "rgba(70,86,98,0.75)";
    context.fillRect(0, size * 0.06, size, size * 0.14);
  },
  // Open deck: a dark void band behind a light spandrel edge.
  parking(context, size) {
    context.fillStyle = "#3f4247";
    context.fillRect(0, size * 0.22, size, size * 0.5);
    context.fillStyle = "#cdcac2";
    context.fillRect(0, size * 0.66, size, size * 0.16);
    context.fillStyle = "rgba(0,0,0,0.18)";
    context.fillRect(size * 0.47, size * 0.22, size * 0.06, size * 0.5);
  },
  // Glazed cab over a service shaft.
  tower(context, size) {
    context.fillStyle = "#5d6b78";
    context.fillRect(size * 0.08, size * 0.12, size * 0.84, size * 0.64);
    context.strokeStyle = "#cfd2d4";
    context.lineWidth = size * 0.05;
    context.strokeRect(size * 0.08, size * 0.12, size * 0.84, size * 0.64);
  },
  // Punched openings in a solid wall — the generic case.
  building(context, size) {
    context.fillStyle = "#5a6470";
    context.fillRect(size * 0.18, size * 0.2, size * 0.28, size * 0.42);
    context.fillRect(size * 0.56, size * 0.2, size * 0.28, size * 0.42);
    context.fillStyle = "rgba(255,255,255,0.3)";
    context.fillRect(size * 0.18, size * 0.2, size * 0.28, size * 0.1);
    context.fillRect(size * 0.56, size * 0.2, size * 0.28, size * 0.1);
  },
};

const ROOF_PAINTERS = {
  // Ballasted membrane: fine gravel speckle.
  flat(context, size, random) {
    context.fillStyle = "#b9b6ae";
    context.fillRect(0, 0, size, size);
    for (let i = 0; i < 2600; i += 1) {
      const shade = 120 + Math.floor(random() * 90);
      context.fillStyle = `rgba(${shade},${shade},${shade - 6},0.5)`;
      context.fillRect(random() * size, random() * size, 2, 2);
    }
  },
  // Standing-seam metal: ribs running down the slope.
  metal(context, size) {
    context.fillStyle = "#a9aeb1";
    context.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += size / 8) {
      context.fillStyle = "rgba(255,255,255,0.4)";
      context.fillRect(x, 0, size / 40, size);
      context.fillStyle = "rgba(0,0,0,0.13)";
      context.fillRect(x + size / 40, 0, size / 30, size);
    }
  },
};

function roofCanvas(kind) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  ROOF_PAINTERS[kind](context, 128, seededRandom(kind === "flat" ? 9137 : 4211));
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Lazily built, shared across every airfield. */
export class BuildingTextures {
  constructor() {
    this.cache = new Map();
  }

  facade(kind) {
    const key = `facade:${kind}`;
    if (!this.cache.has(key)) {
      const painter = FACADE_PAINTERS[kind] ?? FACADE_PAINTERS.building;
      this.cache.set(key, facadeCanvas(painter));
    }
    return this.cache.get(key);
  }

  roof(kind) {
    const key = `roof:${kind}`;
    if (!this.cache.has(key)) this.cache.set(key, roofCanvas(kind));
    return this.cache.get(key);
  }

  dispose() {
    for (const texture of this.cache.values()) texture.dispose();
    this.cache.clear();
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const DEFAULT_ROOF_SHAPE = {
  hangar: "round",
  terminal: "flat",
  parking: "flat",
  tower: "flat",
  building: "flat",
};

const PARAPET_METRES = { terminal: 1.2, parking: 1.0, tower: 0.8, building: 0.7 };

/**
 * Fills in the roof and storey fields for footprints baked before the build
 * script started emitting them, so old data still renders.
 */
function normalise(building) {
  const heightM = building.heightM ?? 8;
  const roof = building.roof ?? {
    shape: DEFAULT_ROOF_SHAPE[building.kind] ?? "flat",
    heightM: 0,
    orientation: "along",
  };
  if (roof.shape !== "flat" && !roof.heightM) {
    roof.heightM = Math.max(0.5, Math.min(heightM * 0.35, 8));
  }
  return {
    ...building,
    heightM,
    roof,
    levels: building.levels ?? Math.max(1, Math.round(heightM / METRES_PER_LEVEL)),
  };
}

/**
 * Builds one footprint into merge-ready geometry.
 *
 * Returns walls, roof surface, and clutter separately because they take
 * different materials — the caller batches each stream across the whole field
 * so the added detail costs draw calls in the single digits.
 */
export function buildStructure(rawBuilding, baseY) {
  const building = normalise(rawBuilding);
  const ring = building.polygon;
  if (!ring || ring.length < 3) return null;

  const rect = minAreaRect(ring);
  if (!rect) return null;

  const total = m(building.heightM);
  const footprintArea = ringArea(ring);
  const rectangularity = rect.area > 0 ? footprintArea / rect.area : 0;

  let shape = building.roof.shape;
  // A pitched roof over a footprint that is not really a rectangle would
  // overhang its own walls, so those revert to flat.
  if (shape !== "flat" && rectangularity < RECTANGULARITY_FOR_PITCH) shape = "flat";

  const rise = shape === "flat" ? 0 : Math.min(m(building.roof.heightM), total * 0.6);
  const eaves = baseY + total - rise;

  const walls = wallGeometry(ring, baseY, eaves);
  if (!walls) return null;

  let roof = null;
  let parapet = null;
  let clutter = [];
  if (shape === "flat") {
    const parapetHeight = m(PARAPET_METRES[building.kind] ?? 0.7);
    roof = capGeometry(ring, eaves, 3);
    parapet = parapetGeometry(ring, eaves, parapetHeight);
    clutter = roofClutter(
      ring,
      rect,
      eaves,
      building.id ?? Math.round(ring[0][0] * 1000 + ring[0][1] * 7),
      footprintArea * 100,
    );
  } else {
    roof = pitchedRoof(rect, eaves, rise, shape, building.roof.orientation);
  }

  return { building, walls, roof, parapet, clutter, roofKind: shape === "flat" ? "flat" : "metal" };
}
