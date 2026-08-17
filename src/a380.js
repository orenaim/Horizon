import * as THREE from "three";

// Airbus A380-800.
//
// Built in metres with the nose along -Z; `modelScale` of 0.1 converts straight
// to world units, so every dimension below can be read against the real
// aircraft:
//
//   length 72.7 m · span 79.75 m · height 24.1 m · wing area 845 m²
//
// What makes an A380 unmistakable is the cross-section rather than the
// planform: a double-bubble ovoid, two full-length passenger decks, a blunt
// drooped nose with the flight deck sunk between the decks, and twenty-two
// wheels under it. All of that is modelled explicitly.

const DEG = THREE.MathUtils.degToRad;

const LENGTH = 72.72;
const HALF_SPAN = 39.875;
// Vertical centre of the fuselage tube. The ground sits at GEAR_GROUND.
const GEAR_GROUND = -7.7;

// ---------------------------------------------------------------------------
// Cross-section
// ---------------------------------------------------------------------------

// Two overlapping circles, one per deck, whose outer envelope is the ovoid
// section. The main deck is the wider of the two and sits low, which is why the
// aircraft looks bottom-heavy from head on.
const UPPER = { y: 1.15, r: 2.80 };
const LOWER = { y: -1.00, r: 3.50 };
const SECTION_POINTS = 64;

/** Canonical half-section radius at an angle, from the wider of the two decks. */
function sectionRadius(angle) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best = 0;
  for (const deck of [UPPER, LOWER]) {
    // Distance from the section origin to the circle along this direction.
    const b = dy * deck.y;
    const c = deck.y * deck.y - deck.r * deck.r;
    const discriminant = b * b - c;
    if (discriminant < 0) continue;
    best = Math.max(best, b + Math.sqrt(discriminant));
  }
  return best;
}

const SECTION = Array.from({ length: SECTION_POINTS }, (unused, i) => {
  const angle = (i / SECTION_POINTS) * Math.PI * 2;
  const r = sectionRadius(angle);
  return [Math.cos(angle) * r, Math.sin(angle) * r];
});

/** Index around the section whose height best matches a deck's window line. */
function windowBand(height, rightSide) {
  let best = 0;
  let bestError = Infinity;
  SECTION.forEach(([x, y], i) => {
    if (rightSide ? x <= 0 : x >= 0) return;
    const error = Math.abs(y - height);
    if (error < bestError) {
      bestError = error;
      best = i;
    }
  });
  return best / SECTION_POINTS;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

function canvasTexture(width, height, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d"), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Fuselage skin. The texture's x axis runs nose to tail and its y axis runs
 * around the section, so a deck's window line is a straight row and the
 * windows themselves space out along it.
 */
function fuselageTexture() {
  const mainDeck = windowBand(-0.9, true);
  const mainDeckLeft = windowBand(-0.9, false);
  const upperDeck = windowBand(2.35, true);
  const upperDeckLeft = windowBand(2.35, false);

  return canvasTexture(2048, 512, (context, width, height) => {
    context.fillStyle = "#f4f5f7";
    context.fillRect(0, 0, width, height);

    // Grey belly: the lower third of the section, which wraps the bottom of the
    // texture because the section starts at the widest point.
    const bellyTop = windowBand(-3.2, true) * height;
    const bellyBottom = windowBand(-3.2, false) * height;
    context.fillStyle = "#c9ced6";
    context.fillRect(0, Math.min(bellyTop, bellyBottom), width, Math.abs(bellyBottom - bellyTop));

    // Cheatline along the main deck window line.
    context.fillStyle = "#1b3f74";
    context.fillRect(0, mainDeck * height + 16, width, 5);

    const windows = (band, from, to, spacing) => {
      const y = band * height;
      context.fillStyle = "#243244";
      for (let x = from; x < to; x += spacing) {
        context.fillRect(x, y - 5, 9, 11);
      }
    };
    // Two decks of windows, the upper one stopping short of the tail.
    for (const band of [mainDeck, mainDeckLeft]) windows(band, 210, 1880, 21);
    for (const band of [upperDeck, upperDeckLeft]) windows(band, 260, 1560, 21);

    // Door outlines: sixteen on the main deck, plus the upper deck pairs.
    context.strokeStyle = "rgba(70,80,95,0.5)";
    context.lineWidth = 2;
    const doors = (band, positions, tall) => {
      const y = band * height;
      for (const x of positions) context.strokeRect(x, y - (tall ? 20 : 16), 26, tall ? 40 : 32);
    };
    doors(mainDeck, [250, 620, 1010, 1400, 1760], true);
    doors(mainDeckLeft, [250, 620, 1010, 1400, 1760], true);
    doors(upperDeck, [300, 900, 1450], false);
    doors(upperDeckLeft, [300, 900, 1450], false);

    // Panel joins running around the section.
    context.strokeStyle = "rgba(150,158,170,0.4)";
    context.lineWidth = 1.5;
    for (let x = 120; x < width; x += 96) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }

    context.fillStyle = "#20304a";
    context.font = "700 26px 'Barlow Condensed', Arial";
    context.fillText("F-WWOW", 1660, mainDeck * height - 26);
  });
}

function buildMaterials() {
  return {
    skin: new THREE.MeshStandardMaterial({
      map: fuselageTexture(),
      roughness: 0.34,
      metalness: 0.08,
    }),
    paint: new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.33, metalness: 0.06 }),
    belly: new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.5, metalness: 0.1 }),
    livery: new THREE.MeshStandardMaterial({ color: 0x1b3f74, roughness: 0.36, metalness: 0.08 }),
    // Cockpit glass is all but clear; a heavy tint makes the view out of it
    // murky and is not what the pilot actually sees.
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xe6eef4,
      roughness: 0.02,
      metalness: 0,
      transmission: 0.97,
      transparent: true,
      opacity: 0.16,
      ior: 1.52,
      clearcoat: 1,
      side: THREE.DoubleSide,
    }),
    nacelle: new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.3, metalness: 0.16 }),
    intake: new THREE.MeshStandardMaterial({ color: 0x9aa2ac, roughness: 0.28, metalness: 0.85 }),
    fan: new THREE.MeshStandardMaterial({ color: 0x6f7780, roughness: 0.35, metalness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.72, metalness: 0.2 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa1a6, roughness: 0.32, metalness: 0.85 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.95 }),
    cockpit: new THREE.MeshStandardMaterial({ color: 0x4d545c, roughness: 0.85, emissive: 0x0a0c0f }),
    seat: new THREE.MeshStandardMaterial({ color: 0x2b3d5a, roughness: 0.8 }),
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Lofts the fuselage by scaling and offsetting the canonical section at each
 * station. UVs run nose-to-tail across the texture and around the section down
 * it, which is what lets the window rows be drawn as straight lines.
 */
function loftFuselage(stations, material) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const perRing = SECTION_POINTS;

  stations.forEach((station, ring) => {
    const v = ring / (stations.length - 1);
    for (let i = 0; i <= perRing; i += 1) {
      const [sx, sy] = SECTION[i % perRing];
      positions.push(
        sx * station.width,
        sy * station.height + station.offsetY,
        station.z,
      );
      uvs.push(v, i / perRing);
    }
  });

  const row = perRing + 1;
  for (let ring = 0; ring < stations.length - 1; ring += 1) {
    for (let i = 0; i < perRing; i += 1) {
      const a = ring * row + i;
      const b = ring * row + i + 1;
      const c = (ring + 1) * row + i + 1;
      const d = (ring + 1) * row + i;
      indices.push(a, b, d, b, c, d);
    }
  }


  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Swept, tapered lifting surface with a cambered subsonic section. */
function liftingSurface({
  side = 1,
  panels,
  material,
  chordSegments = 14,
}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const row = chordSegments + 1;
  const stations = [];

  // Expand the panel breakpoints into a station list.
  panels.forEach((panel, index) => {
    if (index === 0) stations.push(panel);
    else stations.push(panel);
  });

  for (const underside of [false, true]) {
    stations.forEach((station) => {
      for (let c = 0; c <= chordSegments; c += 1) {
        const t = c / chordSegments;
        // Rounded leading edge, sharp trailing edge, camber on the upper surface.
        const thickness = Math.sin(Math.PI * t ** 0.62) ** 1.1;
        const camber = Math.sin(Math.PI * t) * station.chordThickness * 0.16;
        positions.push(
          side * station.x,
          station.y + camber + thickness * station.chordThickness * (underside ? -0.42 : 0.58),
          THREE.MathUtils.lerp(station.lead, station.trail, t),
        );
        uvs.push(t, station.x / HALF_SPAN);
      }
    });
  }

  const half = stations.length * row;
  const top = (s, c) => s * row + c;
  const bottom = (s, c) => half + s * row + c;
  for (let s = 0; s < stations.length - 1; s += 1) {
    for (let c = 0; c < chordSegments; c += 1) {
      indices.push(top(s, c), top(s + 1, c), top(s, c + 1));
      indices.push(top(s, c + 1), top(s + 1, c), top(s + 1, c + 1));
      indices.push(bottom(s, c), bottom(s, c + 1), bottom(s + 1, c));
      indices.push(bottom(s, c + 1), bottom(s + 1, c + 1), bottom(s + 1, c));
    }
  }
  const last = stations.length - 1;
  for (let c = 0; c < chordSegments; c += 1) {
    indices.push(top(last, c), top(last, c + 1), bottom(last, c));
    indices.push(bottom(last, c), top(last, c + 1), bottom(last, c + 1));
    indices.push(top(0, c), bottom(0, c), top(0, c + 1));
    indices.push(bottom(0, c), bottom(0, c + 1), top(0, c + 1));
  }

  // Mirroring a surface across the centreline reverses its triangle winding, so
  // the left-hand panel needs its faces flipped back or it lights from inside.
  if (side < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const swap = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = swap;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Flat plate from an outline in the XZ plane. */
function platePrism(points, thickness, material) {
  const positions = [];
  const indices = [];
  points.forEach(([x, z]) => positions.push(x, thickness / 2, z));
  points.forEach(([x, z]) => positions.push(x, -thickness / 2, z));
  const n = points.length;
  for (let i = 1; i < n - 1; i += 1) {
    indices.push(0, i, i + 1);
    indices.push(n, n + i + 1, n + i);
  }
  for (let i = 0; i < n; i += 1) {
    const next = (i + 1) % n;
    indices.push(i, n + i, next, next, n + i, n + next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

function controlSurface(name, points, thickness, material, pivotZ) {
  const group = new THREE.Group();
  group.name = name;
  group.add(platePrism(points.map(([x, z]) => [x, z - pivotZ]), thickness, material));
  group.position.z = pivotZ;
  return group;
}

// ---------------------------------------------------------------------------
// Airframe
// ---------------------------------------------------------------------------

// width/height scale the canonical section; offsetY droops the nose and lifts
// the tail cone.
const STATIONS = [
  { z: -36.36, width: 0.02, height: 0.02, offsetY: -0.55 },
  { z: -35.60, width: 0.16, height: 0.15, offsetY: -0.70 },
  { z: -34.60, width: 0.34, height: 0.31, offsetY: -0.80 },
  { z: -33.40, width: 0.52, height: 0.48, offsetY: -0.78 },
  { z: -32.00, width: 0.68, height: 0.64, offsetY: -0.66 },
  { z: -30.40, width: 0.81, height: 0.78, offsetY: -0.48 },
  { z: -28.60, width: 0.90, height: 0.88, offsetY: -0.28 },
  { z: -26.40, width: 0.96, height: 0.95, offsetY: -0.12 },
  { z: -23.60, width: 0.99, height: 0.99, offsetY: -0.03 },
  { z: -19.00, width: 1.00, height: 1.00, offsetY: 0 },
  { z: -8.00, width: 1.00, height: 1.00, offsetY: 0 },
  { z: 4.00, width: 1.00, height: 1.00, offsetY: 0 },
  { z: 14.00, width: 1.00, height: 1.00, offsetY: 0 },
  { z: 19.00, width: 0.99, height: 0.99, offsetY: 0.04 },
  { z: 23.00, width: 0.95, height: 0.95, offsetY: 0.16 },
  { z: 26.50, width: 0.87, height: 0.86, offsetY: 0.38 },
  { z: 29.50, width: 0.75, height: 0.73, offsetY: 0.70 },
  { z: 32.20, width: 0.60, height: 0.57, offsetY: 1.10 },
  { z: 34.40, width: 0.44, height: 0.40, offsetY: 1.52 },
  { z: 35.90, width: 0.28, height: 0.24, offsetY: 1.88 },
  { z: 36.36, width: 0.17, height: 0.14, offsetY: 2.05 },
];

// Wing breakpoints: root, inboard kink, then the long outer panel.
const WING_PANELS = [
  { x: 3.60, lead: -9.60, trail: 8.30, y: -1.60, chordThickness: 2.20 },
  { x: 10.60, lead: -4.40, trail: 7.90, y: -1.05, chordThickness: 1.62 },
  { x: 17.50, lead: 0.20, trail: 9.60, y: -0.30, chordThickness: 1.18 },
  { x: 26.00, lead: 5.80, trail: 12.00, y: 0.62, chordThickness: 0.78 },
  { x: 34.00, lead: 11.10, trail: 15.00, y: 1.50, chordThickness: 0.48 },
  { x: 39.60, lead: 14.80, trail: 18.90, y: 2.10, chordThickness: 0.30 },
];

function addWings(group, materials, controls) {
  for (const side of [1, -1]) {
    group.add(liftingSurface({ side, panels: WING_PANELS, material: materials.paint }));

    // Wingtip fence: the A380 has a small upper and lower fence rather than a
    // blended winglet.
    const fence = new THREE.Group();
    const upper = platePrism([
      [0, 15.6], [0, 18.3], [0.35, 18.0], [0.35, 16.4],
    ], 0.18, materials.paint);
    upper.rotation.z = DEG(-88);
    upper.position.set(side * 39.8, 3.0, 0);
    fence.add(upper);
    const lower = platePrism([
      [0, 16.2], [0, 18.1], [0.22, 17.9], [0.22, 16.8],
    ], 0.16, materials.paint);
    lower.rotation.z = DEG(88);
    lower.position.set(side * 39.8, 1.3, 0);
    fence.add(lower);
    group.add(fence);

    // Flaps inboard, ailerons outboard.
    const flap = controlSurface(`flap${side > 0 ? "R" : "L"}`, [
      [side * 4.2, 8.4], [side * 16.8, 9.5], [side * 16.8, 12.0], [side * 4.2, 11.9],
    ], 0.3, materials.paint, 9.0);
    flap.position.y = -1.2;
    group.add(flap);
    controls[`flap${side > 0 ? "R" : "L"}`] = flap;

    const aileron = controlSurface(`aileron${side > 0 ? "R" : "L"}`, [
      [side * 27.2, 12.4], [side * 38.4, 18.0], [side * 38.4, 19.1], [side * 27.2, 13.8],
    ], 0.22, materials.paint, 12.9);
    aileron.position.y = 0.86;
    group.add(aileron);
    controls[`aileron${side > 0 ? "R" : "L"}`] = aileron;

    // Flap track fairings, one of the aircraft's clearest recognition features
    // from below and behind.
    for (const [x, z, length] of [[6.0, 9.4, 5.6], [10.4, 9.2, 5.2], [15.0, 10.2, 4.8]]) {
      const fairing = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.42, length, 6, 12),
        materials.paint,
      );
      fairing.rotation.x = Math.PI / 2;
      fairing.position.set(side * x, -1.85, z);
      fairing.castShadow = true;
      group.add(fairing);
    }
  }
}

function addEngine(group, materials, side, x, z, y) {
  const engine = new THREE.Group();
  engine.position.set(side * x, y, z);

  // Trent-class nacelle: 4.5 m fan, long cowl, separate core exhaust.
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.15, 7.0, 28, 1, true), materials.nacelle);
  cowl.rotation.x = Math.PI / 2;
  engine.add(cowl);

  const lip = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.16, 12, 28), materials.intake);
  lip.position.z = -3.5;
  engine.add(lip);

  const inletDuct = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.0, 1.6, 26, 1, true), materials.dark);
  inletDuct.rotation.x = Math.PI / 2;
  inletDuct.position.z = -2.8;
  engine.add(inletDuct);

  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.0, 14), materials.dark);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -2.3;
  engine.add(spinner);

  const fanPivot = new THREE.Group();
  fanPivot.position.z = -2.6;
  for (let i = 0; i < 22; i += 1) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.75, 0.5), materials.fan);
    const angle = (i / 22) * Math.PI * 2;
    blade.position.set(Math.cos(angle) * 1.15, Math.sin(angle) * 1.15, 0);
    blade.rotation.z = angle + DEG(28);
    fanPivot.add(blade);
  }
  engine.add(fanPivot);

  // Core exhaust and plug.
  const core = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.95, 2.6, 20, 1, true), materials.intake);
  core.rotation.x = Math.PI / 2;
  core.position.z = 4.4;
  engine.add(core);
  const plug = new THREE.Mesh(new THREE.ConeGeometry(0.72, 2.0, 16), materials.dark);
  plug.rotation.x = Math.PI / 2;
  plug.position.z = 5.4;
  engine.add(plug);

  // Pylon up to the wing.
  const pylon = platePrism([
    [0, -1.4], [0, 3.4], [0.34, 3.0], [0.34, -1.0],
  ], 0.55, materials.paint);
  pylon.rotation.z = Math.PI / 2;
  pylon.position.set(0, 1.9, 0.6);
  pylon.scale.set(1, 1, 1);
  engine.add(pylon);

  group.add(engine);
  return fanPivot;
}

function addTail(group, materials, controls) {
  // Vertical fin.
  const fin = liftingSurface({
    side: 1,
    panels: [
      { x: 0.2, lead: 20.0, trail: 33.6, y: 0, chordThickness: 1.5 },
      { x: 4.5, lead: 23.4, trail: 33.4, y: 0, chordThickness: 1.15 },
      { x: 9.4, lead: 27.0, trail: 33.2, y: 0, chordThickness: 0.75 },
      { x: 13.2, lead: 29.9, trail: 33.1, y: 0, chordThickness: 0.42 },
    ],
    material: materials.paint,
  });
  fin.rotation.z = DEG(90);
  fin.position.y = 3.3;
  group.add(fin);

  // Fin livery panel.
  const finPaint = platePrism([
    [0, 24.4], [0, 33.2], [12.0, 32.6], [12.0, 29.4],
  ], 0.9, materials.livery);
  finPaint.rotation.z = DEG(90);
  finPaint.position.y = 4.6;
  group.add(finPaint);

  const rudder = controlSurface("rudder", [
    [0.6, 33.2], [12.4, 32.6], [12.4, 34.0], [0.6, 35.2],
  ], 0.5, materials.paint, 33.4);
  rudder.rotation.z = DEG(90);
  rudder.position.y = 3.6;
  const rudderPivot = new THREE.Group();
  rudderPivot.name = "rudder";
  rudderPivot.add(rudder);
  group.add(rudderPivot);
  controls.rudder = rudderPivot;

  // Horizontal stabilisers, mounted low on the tail cone.
  for (const side of [1, -1]) {
    const stabiliser = liftingSurface({
      side,
      panels: [
        { x: 1.2, lead: 26.6, trail: 34.4, y: 0, chordThickness: 1.05 },
        { x: 8.0, lead: 30.0, trail: 34.6, y: 0.35, chordThickness: 0.65 },
        { x: 15.1, lead: 33.4, trail: 35.4, y: 0.72, chordThickness: 0.3 },
      ],
      material: materials.paint,
    });
    stabiliser.position.y = 1.5;
    group.add(stabiliser);

    const elevator = controlSurface(`elevator${side > 0 ? "R" : "L"}`, [
      [side * 1.6, 34.3], [side * 14.4, 35.3], [side * 14.4, 36.2], [side * 1.6, 36.0],
    ], 0.24, materials.paint, 34.5);
    elevator.position.y = 1.62;
    group.add(elevator);
    controls[`elevator${side > 0 ? "R" : "L"}`] = elevator;
  }

  // Auxiliary power unit exhaust in the tail cone.
  const apu = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.42, 0.9, 16, 1, true), materials.dark);
  apu.rotation.x = Math.PI / 2;
  apu.position.set(0, 2.05, 36.5);
  group.add(apu);
}

/** One bogie: a beam with an axle row either side. */
function bogie(materials, { wheels, radius, width, spacing, legLength, x, y, z }) {
  const assembly = new THREE.Group();
  assembly.position.set(x, y, z);

  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, legLength, 12), materials.metal);
  leg.position.y = legLength / 2;
  assembly.add(leg);

  const rows = wheels / 2;
  const beamLength = (rows - 1) * spacing + 1.2;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, beamLength), materials.dark);
  assembly.add(beam);

  for (let r = 0; r < rows; r += 1) {
    const az = (r - (rows - 1) / 2) * spacing;
    for (const side of [-1, 1]) {
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 18), materials.rubber);
      tyre.rotation.z = Math.PI / 2;
      tyre.position.set(side * 0.62, 0, az);
      tyre.castShadow = true;
      assembly.add(tyre);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, width * 1.06, 12), materials.metal);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(side * 0.62, 0, az);
      assembly.add(hub);
    }
  }
  return assembly;
}

/**
 * Twenty-two wheels: a two-wheel nose unit, a four-wheel bogie under each wing,
 * and a six-wheel bogie under the fuselage on each side. Getting the count and
 * the layout right matters more than any single part of the airframe — it is
 * what the aircraft is known for on the ground.
 */
function addGear(group, materials, gearAssemblies) {
  const wheelY = GEAR_GROUND + 0.62;

  const nose = new THREE.Group();
  nose.add(bogie(materials, {
    wheels: 2, radius: 0.62, width: 0.36, spacing: 0,
    legLength: 4.6, x: 0, y: wheelY, z: -27.4,
  }));
  const noseDoor = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.4, 4.0), materials.paint);
  noseDoor.position.set(1.0, -3.6, -27.4);
  nose.add(noseDoor);
  group.add(nose);
  gearAssemblies.push(nose);

  for (const side of [1, -1]) {
    const wing = new THREE.Group();
    wing.add(bogie(materials, {
      wheels: 4, radius: 0.68, width: 0.42, spacing: 1.7,
      legLength: 4.2, x: side * 6.6, y: wheelY, z: 4.6,
    }));
    group.add(wing);
    gearAssemblies.push(wing);

    const body = new THREE.Group();
    body.add(bogie(materials, {
      wheels: 6, radius: 0.68, width: 0.42, spacing: 1.7,
      legLength: 4.0, x: side * 2.9, y: wheelY, z: 7.4,
    }));
    const bodyDoor = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.2, 5.6), materials.paint);
    bodyDoor.position.set(side * 4.2, -3.5, 7.4);
    body.add(bodyDoor);
    group.add(body);
    gearAssemblies.push(body);
  }
}

function addFlightDeckWindows(group, materials) {
  // The A380's flight deck sits between the decks, and its windows wrap a
  // shallow brow rather than sitting flush.
  const pane = (x, y, z, w, h, yaw, pitch) => {
    const window = new THREE.Group();
    window.position.set(x, y, z);
    window.rotation.set(pitch, yaw, 0);

    window.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), materials.glass));

    // The surround is four bars, not a filled plate: a plate the size of the
    // window sitting just behind the glass blanks the view straight out of it.
    const bar = 0.09;
    for (const [bw, bh, bx, by] of [
      [w + bar * 2, bar, 0, h / 2 + bar / 2],
      [w + bar * 2, bar, 0, -h / 2 - bar / 2],
      [bar, h, -w / 2 - bar / 2, 0],
      [bar, h, w / 2 + bar / 2, 0],
    ]) {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), materials.dark);
      edge.position.set(bx, by, 0.012);
      window.add(edge);
    }
    group.add(window);
  };

  for (const side of [1, -1]) {
    pane(side * 0.52, 0.72, -33.30, 0.94, 0.86, side * DEG(18), DEG(-13));
    pane(side * 1.20, 0.62, -32.55, 0.86, 0.80, side * DEG(52), DEG(-6));
    pane(side * 1.48, 0.56, -31.60, 0.72, 0.70, side * DEG(76), DEG(-2));
  }
}

// ---------------------------------------------------------------------------
// Flight deck
// ---------------------------------------------------------------------------

/** One of the eight identical-format Airbus display units. */
function displayTexture(kind) {
  return canvasTexture(512, 384, (context, width, height) => {
    context.fillStyle = "#05090b";
    context.fillRect(0, 0, width, height);
    if (kind === "pfd") {
      context.fillStyle = "#2f6fa8";
      context.fillRect(96, 40, 300, 150);
      context.fillStyle = "#8a5a2a";
      context.fillRect(96, 190, 300, 150);
      context.strokeStyle = "#f2f4f6";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(96, 190);
      context.lineTo(396, 190);
      context.stroke();
      context.strokeStyle = "#111";
      context.fillStyle = "#000";
      context.fillRect(30, 40, 62, 300);
      context.fillRect(400, 40, 62, 300);
      context.fillStyle = "#3ad46a";
      context.font = "600 26px 'Barlow Condensed', Arial";
      ["300", "280", "260", "240", "220"].forEach((v, i) => context.fillText(v, 38, 96 + i * 56));
      ["380", "360", "340", "320", "300"].forEach((v, i) => context.fillText(v, 408, 96 + i * 56));
      context.strokeStyle = "#f0d000";
      context.lineWidth = 5;
      context.beginPath();
      context.moveTo(180, 190);
      context.lineTo(228, 190);
      context.moveTo(264, 190);
      context.lineTo(312, 190);
      context.stroke();
    } else if (kind === "nd") {
      context.strokeStyle = "#1f6f4a";
      context.lineWidth = 2;
      for (let r = 60; r <= 180; r += 60) {
        context.beginPath();
        context.arc(256, 300, r, Math.PI, Math.PI * 2);
        context.stroke();
      }
      context.fillStyle = "#3ad46a";
      context.beginPath();
      context.moveTo(256, 270);
      context.lineTo(240, 312);
      context.lineTo(272, 312);
      context.closePath();
      context.fill();
      context.fillStyle = "#d76ad7";
      context.font = "600 22px 'Barlow Condensed', Arial";
      context.fillText("HNL", 214, 120);
      context.fillText("CKH", 320, 190);
      context.strokeStyle = "#d76ad7";
      context.beginPath();
      context.moveTo(256, 300);
      context.lineTo(238, 130);
      context.stroke();
    } else {
      context.fillStyle = "#3ad46a";
      context.font = "600 24px 'Barlow Condensed', Arial";
      ["ENG 1  N1 92.4", "ENG 2  N1 92.1", "ENG 3  N1 92.6", "ENG 4  N1 92.3",
        "FOB  184 300 KG", "GW   402 100 KG"].forEach((row, i) => {
        context.fillText(row, 40, 70 + i * 48);
      });
    }
  });
}

function buildFlightDeck(materials) {
  const deck = new THREE.Group();

  // Main panel and its displays share one tilted frame, so the screens sit on
  // the panel's face instead of being buried inside the box.
  const panelFrame = new THREE.Group();
  panelFrame.position.set(0, -0.12, -33.05);
  panelFrame.rotation.x = DEG(12);
  deck.add(panelFrame);

  const panelBox = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.86, 0.22), materials.cockpit);
  panelFrame.add(panelBox);

  const screen = (kind, x, y, w, h) => {
    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: displayTexture(kind), toneMapped: false }),
    );
    // Just proud of the panel's aft face.
    display.position.set(x, y, 0.115);
    panelFrame.add(display);
  };

  // Two rows of four: primary flight and navigation either side, engine and
  // systems in the middle.
  screen("pfd", -0.95, 0.19, 0.36, 0.29);
  screen("nd", -0.55, 0.19, 0.36, 0.29);
  screen("eng", 0.55, 0.19, 0.36, 0.29);
  screen("nd", 0.95, 0.19, 0.36, 0.29);
  screen("eng", -0.2, -0.2, 0.36, 0.29);
  screen("pfd", 0.2, -0.2, 0.36, 0.29);

  // Glareshield with the flight control unit.
  const glareshield = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.16, 0.42), materials.dark);
  glareshield.position.set(0, 0.32, -33.14);
  glareshield.rotation.x = DEG(10);
  deck.add(glareshield);

  // Centre pedestal with the thrust levers.
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 1.9), materials.cockpit);
  pedestal.position.set(0, -0.52, -31.6);
  deck.add(pedestal);

  const thrust = new THREE.Group();
  for (let i = 0; i < 4; i += 1) {
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.34, 0.1), materials.dark);
    lever.position.set(-0.24 + i * 0.16, 0.42, 0);
    thrust.add(lever);
  }
  thrust.position.set(0, -0.34, -32.0);
  thrust.userData.restZ = -32.0;
  thrust.userData.travelZ = -0.34;
  deck.add(thrust);

  // Overhead panel.
  const overhead = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 0.16), materials.cockpit);
  overhead.position.set(0, 1.62, -32.3);
  overhead.rotation.x = DEG(72);
  deck.add(overhead);

  // Two seats and the side sticks that go with them — this is an Airbus, so
  // there is no yoke in front of either pilot.
  const sticks = [];
  for (const side of [-1, 1]) {
    const seat = new THREE.Group();
    const pan = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.62), materials.seat);
    pan.position.y = 0.05;
    seat.add(pan);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.05, 0.16), materials.seat);
    back.position.set(0, 0.6, 0.34);
    back.rotation.x = DEG(-9);
    seat.add(back);
    seat.position.set(side * 0.58, -0.66, -31.6);
    deck.add(seat);

    const stick = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.34, 10), materials.dark);
    grip.position.y = 0.17;
    stick.add(grip);
    stick.position.set(side * 1.06, -0.34, -32.0);
    deck.add(stick);
    sticks.push(stick);
  }

  // Side console walls, so the deck reads as an enclosed space.
  for (const side of [-1, 1]) {
    // Consoles only, kept under the window line so the side windows are usable.
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 3.4), materials.cockpit);
    wall.position.set(side * 1.33, -0.3, -32.0);
    deck.add(wall);
  }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.12, 3.6), materials.cockpit);
  floor.position.set(0, -0.76, -31.8);
  deck.add(floor);

  return { deck, thrust, sticks };
}

// ---------------------------------------------------------------------------

export function buildA380Model(modelScale = 0.1) {
  const aircraft = new THREE.Group();
  aircraft.name = "A380-800";
  const materials = buildMaterials();
  const controls = {};
  const gearAssemblies = [];

  const exterior = new THREE.Group();
  exterior.add(loftFuselage(STATIONS, materials.skin));
  addWings(exterior, materials, controls);
  addTail(exterior, materials, controls);
  addFlightDeckWindows(exterior, materials);

  // Four engines: the inboard pair sits further forward on the swept wing.
  const fans = [
    addEngine(exterior, materials, 1, 15.4, -5.9, -3.25),
    addEngine(exterior, materials, -1, 15.4, -5.9, -3.25),
    addEngine(exterior, materials, 1, 27.6, 1.6, -1.85),
    addEngine(exterior, materials, -1, 27.6, 1.6, -1.85),
  ];
  controls.propeller = { rotation: { get z() { return fans[0].rotation.z; }, set z(v) { fans.forEach((f) => { f.rotation.z = v; }); } } };

  addGear(exterior, materials, gearAssemblies);
  aircraft.add(exterior);

  const { deck, thrust, sticks } = buildFlightDeck(materials);
  deck.visible = false;
  aircraft.add(deck);

  controls.throttle = thrust;
  controls.sideStick = sticks[1];
  controls.gearAssemblies = gearAssemblies;

  aircraft.userData.controls = controls;
  aircraft.userData.exterior = exterior;
  aircraft.userData.cockpitInterior = deck;
  // Captain's eye, left seat, looking out over the brow.
  aircraft.userData.cockpitEye = new THREE.Vector3(-0.58, 0.62, -32.1);
  aircraft.userData.cockpitLook = new THREE.Vector3(-0.58, -4.8, -60);
  aircraft.userData.modelScale = modelScale;

  aircraft.traverse((node) => {
    if (node.isMesh) node.castShadow = true;
  });

  aircraft.rotation.order = "YXZ";
  aircraft.scale.setScalar(modelScale);
  return aircraft;
}

export const A380_LENGTH_METRES = LENGTH;
