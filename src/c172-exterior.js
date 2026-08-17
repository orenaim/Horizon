import * as THREE from "three";

// Exterior airframe for the Cessna 172S Skyhawk.
//
// Built in metres, so every dimension can be read against the real aircraft:
//
//   length 8.28 m · span 11.00 m · height 2.72 m · wing area 16.2 m²
//   constant 1.63 m wing chord · 1.93 m propeller · 2.5 m main gear track
//
// The shapes that make a 172 recognisable are the high wing on its single lift
// strut, the tubular spring-steel main legs, the swept fin with its long dorsal
// fillet, and the deep glasshouse cabin. Those are modelled rather than
// approximated, and nothing is left floating clear of the structure.

const DEG = THREE.MathUtils.degToRad;

const HALF_SPAN = 5.5;
const WING_LE = -1.55;
const WING_CHORD = 1.63;
const WING_Y = 0.86;

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

function canvasTexture(width, height, draw, repeat) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d"), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
  }
  return texture;
}

/**
 * Painted aluminium: an off-white base carrying the riveted seams that run the
 * length of a light aircraft's skin. Flat white reads as plastic, and the rivet
 * lines are most of what tells the eye this is a metal aeroplane.
 */
function skinTexture() {
  return canvasTexture(1024, 512, (context, width, height) => {
    context.fillStyle = "#f2f0ea";
    context.fillRect(0, 0, width, height);

    let seed = 8172;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    // Skin panel joins.
    context.strokeStyle = "rgba(150,148,140,0.45)";
    context.lineWidth = 1.6;
    for (let x = 64; x < width; x += 78) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 96; y < height; y += 118) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    // Rivet rows either side of each join.
    context.fillStyle = "rgba(132,130,124,0.5)";
    for (let x = 64; x < width; x += 78) {
      for (let y = 6; y < height; y += 13) {
        context.fillRect(x - 5, y, 1.7, 1.7);
        context.fillRect(x + 4, y, 1.7, 1.7);
      }
    }
    for (let y = 96; y < height; y += 118) {
      for (let x = 6; x < width; x += 13) {
        context.fillRect(x, y - 5, 1.7, 1.7);
        context.fillRect(x, y + 4, 1.7, 1.7);
      }
    }
    // Faint dirt and paint variation so the surface is never perfectly even.
    context.fillStyle = "rgba(196,192,182,0.3)";
    for (let i = 0; i < 220; i += 1) {
      context.fillRect(random() * width, random() * height, random() * 40 + 8, random() * 5 + 1);
    }
  }, [4, 2]);
}

export function buildMaterials() {
  const skin = skinTexture();
  return {
    skin: new THREE.MeshPhysicalMaterial({
      map: skin,
      color: 0xffffff,
      roughness: 0.31,
      metalness: 0.1,
      clearcoat: 0.6,
      clearcoatRoughness: 0.22,
    }),
    // Scheme colours. The 172's stripes wrap the fuselage and run out along the
    // fin, so they are painted as separate thin shells over the skin.
    navy: new THREE.MeshPhysicalMaterial({ color: 0x18384f, roughness: 0.3, clearcoat: 0.65 }),
    gold: new THREE.MeshPhysicalMaterial({ color: 0xc8873a, roughness: 0.32, clearcoat: 0.6 }),
    grey: new THREE.MeshStandardMaterial({ color: 0xb9b7b0, roughness: 0.5, metalness: 0.15 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x9fc0c8,
      roughness: 0.05,
      metalness: 0.02,
      transmission: 0.82,
      transparent: true,
      opacity: 0.42,
      ior: 1.52,
      clearcoat: 1,
      side: THREE.DoubleSide,
    }),
    black: new THREE.MeshStandardMaterial({ color: 0x1b1e20, roughness: 0.78 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x171a1a, roughness: 0.95 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb2b8b7, roughness: 0.24, metalness: 0.8 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x3a4143, roughness: 0.3, metalness: 0.7 }),
    prop: new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.36, metalness: 0.5 }),
    redLight: new THREE.MeshBasicMaterial({ color: 0xff3426, toneMapped: false }),
    greenLight: new THREE.MeshBasicMaterial({ color: 0x38f196, toneMapped: false }),
    clearLight: new THREE.MeshBasicMaterial({ color: 0xeafaff, toneMapped: false }),
  };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Lofts a body from rings whose section is a superellipse, so the same routine
 * gives the round tailcone and the square-shouldered cabin.
 */
function loftBody(rings, material, { segments = 28, capNose = true, capTail = true } = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const row = segments + 1;

  const span = rings.at(-1).z - rings[0].z;
  rings.forEach((ring) => {
    const v = (ring.z - rings[0].z) / span;
    const power = ring.power ?? 1;
    for (let i = 0; i <= segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      positions.push(
        Math.sign(cos) * Math.abs(cos) ** power * ring.rx,
        ring.y + Math.sign(sin) * Math.abs(sin) ** power * (sin >= 0 ? ring.top : ring.bottom),
        ring.z,
      );
      uvs.push(v, i / segments);
    }
  });

  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let i = 0; i < segments; i += 1) {
      const a = r * row + i;
      const b = r * row + i + 1;
      const c = (r + 1) * row + i + 1;
      const d = (r + 1) * row + i;
      indices.push(a, b, d, b, c, d);
    }
  }
  const cap = (ring, index, flip) => {
    const centre = positions.length / 3;
    positions.push(0, ring.y, ring.z);
    uvs.push(0.5, flip ? 0 : 1);
    const base = index * row;
    for (let i = 0; i < segments; i += 1) {
      if (flip) indices.push(centre, base + i + 1, base + i);
      else indices.push(centre, base + i, base + i + 1);
    }
  };
  if (capNose) cap(rings[0], 0, true);
  if (capTail) cap(rings.at(-1), rings.length - 1, false);

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

/** Cambered lifting surface. The 172's wing is a NACA 2412 at 12% thickness. */
function liftingSurface({ side = 1, panels, material, chordSegments = 16 }) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const row = chordSegments + 1;

  for (const underside of [false, true]) {
    panels.forEach((station) => {
      for (let c = 0; c <= chordSegments; c += 1) {
        const t = c / chordSegments;
        // Rounded leading edge falling to a sharp trailing edge.
        const thickness = Math.sin(Math.PI * t ** 0.55) ** 1.05;
        const camber = Math.sin(Math.PI * t ** 0.85) * station.thickness * 0.34;
        positions.push(
          side * station.x,
          station.y + camber + thickness * station.thickness * (underside ? -0.38 : 0.62),
          THREE.MathUtils.lerp(station.lead, station.trail, t),
        );
        uvs.push(t, station.x / HALF_SPAN);
      }
    });
  }

  const half = panels.length * row;
  const top = (s, c) => s * row + c;
  const bottom = (s, c) => half + s * row + c;
  for (let s = 0; s < panels.length - 1; s += 1) {
    for (let c = 0; c < chordSegments; c += 1) {
      indices.push(top(s, c), top(s + 1, c), top(s, c + 1));
      indices.push(top(s, c + 1), top(s + 1, c), top(s + 1, c + 1));
      indices.push(bottom(s, c), bottom(s, c + 1), bottom(s + 1, c));
      indices.push(bottom(s, c + 1), bottom(s + 1, c + 1), bottom(s + 1, c));
    }
  }
  const last = panels.length - 1;
  for (let c = 0; c < chordSegments; c += 1) {
    indices.push(top(last, c), top(last, c + 1), bottom(last, c));
    indices.push(bottom(last, c), top(last, c + 1), bottom(last, c + 1));
    indices.push(top(0, c), bottom(0, c), top(0, c + 1));
    indices.push(bottom(0, c), bottom(0, c + 1), top(0, c + 1));
  }
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
function plate(points, thickness, material) {
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
  group.add(plate(points.map(([x, z]) => [x, z - pivotZ]), thickness, material));
  group.position.z = pivotZ;
  return group;
}

/**
 * Streamlined strut with a proper closed section, oriented so its chord lies
 * fore-and-aft. A lift strut is a flattened aerofoil, not a rod, and it has to
 * be built as a solid or it renders as a sheet edge-on.
 */
function streamlinedStrut(from, to, chord, thickness, material) {
  const direction = to.clone().sub(from);
  const length = direction.length();
  const up = direction.clone().normalize();
  // Chord runs fore-and-aft, squared up against the strut's own axis.
  let chordAxis = new THREE.Vector3(0, 0, 1);
  chordAxis.sub(up.clone().multiplyScalar(chordAxis.dot(up)));
  if (chordAxis.lengthSq() < 1e-6) chordAxis = new THREE.Vector3(1, 0, 0);
  chordAxis.normalize();
  // up × chord, not chord × up: the basis has to stay right-handed or the
  // rotation pulled back out of it is meaningless.
  const thickAxis = new THREE.Vector3().crossVectors(up, chordAxis).normalize();

  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, length, 14, 1, false),
    material,
  );
  // Squash the cylinder into a lens: full chord fore-aft, thin across.
  mesh.geometry.scale(thickness, 1, chord);
  mesh.geometry.translate(0, length / 2, 0);
  mesh.castShadow = true;
  mesh.position.copy(from);
  mesh.setRotationFromMatrix(
    new THREE.Matrix4().makeBasis(thickAxis, up, chordAxis),
  );
  return mesh;
}

function tube(parent, from, to, radius, material, segments = 12) {
  const direction = to.clone().sub(from);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), segments),
    material,
  );
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------
// Airframe
// ---------------------------------------------------------------------------

// Cabin is square-shouldered and deep; the tailcone rounds off and tapers.
// `power` shapes the section: below one squares it off, one is an ellipse.
const STATIONS = [
  { z: -2.36, rx: 0.44, top: 0.46, bottom: 0.46, y: 0.05, power: 0.86 },
  { z: -2.10, rx: 0.50, top: 0.55, bottom: 0.52, y: 0.04, power: 0.82 },
  { z: -1.70, rx: 0.55, top: 0.66, bottom: 0.58, y: 0.02, power: 0.78 },
  { z: -1.20, rx: 0.57, top: 0.76, bottom: 0.63, y: 0.00, power: 0.74 },
  { z: -0.55, rx: 0.57, top: 0.80, bottom: 0.66, y: -0.01, power: 0.72 },
  { z: 0.15, rx: 0.55, top: 0.76, bottom: 0.63, y: -0.01, power: 0.74 },
  { z: 0.80, rx: 0.49, top: 0.66, bottom: 0.55, y: 0.00, power: 0.8 },
  { z: 1.55, rx: 0.40, top: 0.52, bottom: 0.44, y: 0.03, power: 0.88 },
  { z: 2.35, rx: 0.31, top: 0.39, bottom: 0.32, y: 0.07, power: 0.94 },
  { z: 3.15, rx: 0.23, top: 0.29, bottom: 0.23, y: 0.11, power: 1 },
  { z: 3.85, rx: 0.17, top: 0.22, bottom: 0.16, y: 0.15, power: 1 },
  { z: 4.23, rx: 0.13, top: 0.17, bottom: 0.12, y: 0.17, power: 1 },
];

// Constant chord out to the tip, as the 172's wing is.
const WING_PANELS = [
  { x: 0.56, lead: WING_LE, trail: WING_LE + WING_CHORD, y: WING_Y, thickness: 0.196 },
  { x: 2.40, lead: WING_LE, trail: WING_LE + WING_CHORD, y: WING_Y + 0.056, thickness: 0.19 },
  { x: 4.60, lead: WING_LE, trail: WING_LE + WING_CHORD, y: WING_Y + 0.122, thickness: 0.178 },
  { x: 5.28, lead: WING_LE + 0.06, trail: WING_LE + WING_CHORD - 0.02, y: WING_Y + 0.143, thickness: 0.15 },
  { x: HALF_SPAN, lead: WING_LE + 0.16, trail: WING_LE + WING_CHORD - 0.07, y: WING_Y + 0.152, thickness: 0.10 },
];

function addCowl(group, materials, controls) {
  // Cowling: flat-topped over the engine, tapering into the spinner.
  const cowl = loftBody([
    { z: -3.32, rx: 0.30, top: 0.30, bottom: 0.26, y: 0.06, power: 0.9 },
    { z: -3.05, rx: 0.38, top: 0.38, bottom: 0.33, y: 0.06, power: 0.82 },
    { z: -2.75, rx: 0.44, top: 0.44, bottom: 0.40, y: 0.05, power: 0.78 },
    { z: -2.36, rx: 0.44, top: 0.46, bottom: 0.46, y: 0.05, power: 0.86 },
  ], materials.skin, { segments: 26, capNose: false, capTail: false });
  group.add(cowl);

  // Cooling intakes either side of the spinner.
  for (const side of [1, -1]) {
    const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.1, 0.1, 16), materials.black);
    intake.rotation.x = Math.PI / 2;
    intake.scale.set(1, 1, 0.72);
    intake.position.set(side * 0.185, 0.02, -3.34);
    group.add(intake);
  }

  // Cowl seam and hinge line.
  const seam = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.008, 6, 34), materials.grey);
  seam.scale.set(1, 0.92, 1);
  seam.position.set(0, 0.05, -2.62);
  group.add(seam);

  // Spinner and two-blade propeller, 1.93 m diameter.
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.155, 0.42, 20), materials.skin);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.set(0, 0.06, -3.56);
  group.add(spinner);
  const backplate = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.05, 20), materials.skin);
  backplate.rotation.x = Math.PI / 2;
  backplate.position.set(0, 0.06, -3.34);
  group.add(backplate);

  const propeller = new THREE.Group();
  propeller.name = "propeller";
  propeller.position.set(0, 0.06, -3.42);
  const blades = [];
  for (const sign of [1, -1]) {
    const blade = new THREE.Group();
    const shape = [];
    const steps = 10;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const r = 0.14 + t * 0.825;
      const chord = 0.16 - t * 0.055 - Math.max(0, t - 0.86) * 0.5;
      shape.push({ r, chord, twist: DEG(26 - t * 18) });
    }
    shape.forEach((station, i) => {
      if (i === shape.length - 1) return;
      const next = shape[i + 1];
      const seg = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.02, (station.chord + next.chord) / 2), next.r - station.r, 0.016),
        materials.prop,
      );
      seg.position.set(0, sign * (station.r + next.r) / 2, 0);
      seg.rotation.y = sign * station.twist;
      seg.castShadow = true;
      blade.add(seg);
      blades.push(seg);
    });
    propeller.add(blade);
  }
  group.add(propeller);
  controls.propeller = propeller;
  controls.propellerBlade = blades[0];
  return { propeller, blades };
}

function addWings(group, materials, controls) {
  for (const side of [1, -1]) {
    group.add(liftingSurface({ side, panels: WING_PANELS, material: materials.skin }));

    // Wing root fairing into the cabin roof.
    const fairing = loftBody([
      { z: WING_LE - 0.04, rx: 0.1, top: 0.06, bottom: 0.06, y: WING_Y - 0.06, power: 0.8 },
      { z: WING_LE + 0.5, rx: 0.16, top: 0.1, bottom: 0.1, y: WING_Y - 0.09, power: 0.8 },
      { z: WING_LE + WING_CHORD, rx: 0.1, top: 0.06, bottom: 0.06, y: WING_Y - 0.06, power: 0.8 },
    ], materials.skin, { segments: 16 });
    fairing.position.x = side * 0.5;
    group.add(fairing);

    // Flap inboard, aileron outboard, both on the trailing edge.
    const flap = controlSurface(`flap${side > 0 ? "R" : "L"}`, [
      [side * 0.6, WING_LE + WING_CHORD - 0.02], [side * 2.85, WING_LE + WING_CHORD - 0.02],
      [side * 2.85, WING_LE + WING_CHORD + 0.42], [side * 0.6, WING_LE + WING_CHORD + 0.44],
    ], 0.05, materials.skin, WING_LE + WING_CHORD - 0.02);
    flap.position.y = WING_Y + 0.02;
    group.add(flap);
    controls[`flap${side > 0 ? "R" : "L"}`] = flap;

    const aileron = controlSurface(`aileron${side > 0 ? "R" : "L"}`, [
      [side * 2.95, WING_LE + WING_CHORD - 0.02], [side * 5.25, WING_LE + WING_CHORD - 0.06],
      [side * 5.25, WING_LE + WING_CHORD + 0.3], [side * 2.95, WING_LE + WING_CHORD + 0.38],
    ], 0.045, materials.skin, WING_LE + WING_CHORD - 0.02);
    aileron.position.y = WING_Y + 0.09;
    group.add(aileron);
    controls[`aileron${side > 0 ? "R" : "L"}`] = aileron;

    // Lift strut from the lower fuselage longeron to the mid-span spar, with
    // the short jury strut that braces it.
    const strutTop = new THREE.Vector3(side * 2.62, WING_Y + 0.02, WING_LE + 0.62);
    const strutBottom = new THREE.Vector3(side * 0.5, -0.52, WING_LE + 0.92);
    group.add(streamlinedStrut(strutBottom, strutTop, 0.15, 0.042, materials.skin));
    const jury = new THREE.Vector3(side * 1.62, WING_Y - 0.32, WING_LE + 0.78);
    tube(group, jury, new THREE.Vector3(side * 1.55, WING_Y - 0.02, WING_LE + 0.2), 0.014, materials.metal, 8);

    // Strut attach fittings, so the strut meets structure rather than air.
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.2), materials.grey);
    shoe.position.copy(strutBottom).add(new THREE.Vector3(0, 0.05, 0));
    group.add(shoe);

    // Navigation light recessed into the tip, and the strobe behind it.
    const nav = new THREE.Mesh(
      new THREE.SphereGeometry(0.038, 12, 8),
      side > 0 ? materials.greenLight : materials.redLight,
    );
    nav.position.set(side * (HALF_SPAN - 0.02), WING_Y + 0.152, WING_LE + 0.3);
    group.add(nav);
    const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), materials.clearLight);
    strobe.position.set(side * (HALF_SPAN - 0.03), WING_Y + 0.16, WING_LE + WING_CHORD - 0.2);
    group.add(strobe);

    // Fuel cap on the upper surface.
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.012, 14), materials.grey);
    cap.position.set(side * 1.75, WING_Y + 0.16, WING_LE + 0.26);
    group.add(cap);
  }

  // Landing light in the left leading edge.
  const light = new THREE.Mesh(new THREE.CircleGeometry(0.06, 14), materials.clearLight);
  light.position.set(-2.1, WING_Y + 0.02, WING_LE - 0.005);
  light.rotation.y = Math.PI;
  group.add(light);
}

function addTail(group, materials, controls) {
  // Dorsal fillet running forward from the fin, a 172 signature.
  const fillet = loftBody([
    { z: 1.85, rx: 0.02, top: 0.02, bottom: 0, y: 0.42, power: 1 },
    { z: 2.6, rx: 0.035, top: 0.1, bottom: 0, y: 0.4, power: 0.9 },
    { z: 3.3, rx: 0.05, top: 0.24, bottom: 0, y: 0.36, power: 0.85 },
    { z: 3.8, rx: 0.06, top: 0.36, bottom: 0, y: 0.34, power: 0.85 },
  ], materials.skin, { segments: 12, capNose: false, capTail: false });
  group.add(fillet);

  // Swept fin.
  const fin = liftingSurface({
    side: 1,
    panels: [
      { x: 0.02, lead: 3.35, trail: 4.3, y: 0, thickness: 0.13 },
      { x: 0.5, lead: 3.55, trail: 4.3, y: 0, thickness: 0.11 },
      { x: 1.0, lead: 3.86, trail: 4.29, y: 0, thickness: 0.075 },
      { x: 1.3, lead: 4.06, trail: 4.28, y: 0, thickness: 0.04 },
    ],
    material: materials.skin,
  });
  fin.rotation.z = DEG(90);
  fin.position.y = 0.2;
  group.add(fin);

  const rudder = new THREE.Group();
  rudder.name = "rudder";
  const rudderPanel = liftingSurface({
    side: 1,
    panels: [
      { x: 0.02, lead: 0, trail: 0.52, y: 0, thickness: 0.1 },
      { x: 0.62, lead: 0.02, trail: 0.44, y: 0, thickness: 0.075 },
      { x: 1.26, lead: 0.06, trail: 0.3, y: 0, thickness: 0.035 },
    ],
    material: materials.skin,
  });
  rudderPanel.rotation.z = DEG(90);
  rudder.add(rudderPanel);
  rudder.position.set(0, 0.24, 4.28);
  group.add(rudder);
  controls.rudder = rudder;

  // Horizontal stabiliser and elevator.
  for (const side of [1, -1]) {
    group.add(liftingSurface({
      side,
      panels: [
        { x: 0.1, lead: 3.42, trail: 4.26, y: 0, thickness: 0.1 },
        { x: 1.0, lead: 3.58, trail: 4.24, y: 0, thickness: 0.08 },
        { x: 1.7, lead: 3.76, trail: 4.2, y: 0.01, thickness: 0.045 },
      ],
      material: materials.skin,
    }));
    const elevator = controlSurface(`elevator${side > 0 ? "R" : "L"}`, [
      [side * 0.12, 4.24], [side * 1.66, 4.19], [side * 1.66, 4.52], [side * 0.12, 4.66],
    ], 0.04, materials.skin, 4.24);
    elevator.position.y = 0.19;
    group.add(elevator);
    controls[`elevator${side > 0 ? "R" : "L"}`] = elevator;
  }

  // Tail tie-down and beacon.
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), materials.redLight);
  beacon.position.set(0, 1.56, 4.16);
  group.add(beacon);
}

function addGear(group, materials) {
  // Main gear: tubular spring-steel legs, bowed outward, with a fairing over
  // the wheel. The curve is what makes a 172 sit the way it does.
  for (const side of [1, -1]) {
    const leg = new THREE.Group();
    const steps = 6;
    const from = new THREE.Vector3(side * 0.28, -0.42, 0.28);
    const to = new THREE.Vector3(side * 1.25, -1.02, 0.3);
    let previous = from.clone();
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const point = new THREE.Vector3(
        THREE.MathUtils.lerp(from.x, to.x, t),
        // Bowed: drops away steeply at the root, flattening outboard.
        from.y + (to.y - from.y) * (1 - (1 - t) ** 1.9),
        THREE.MathUtils.lerp(from.z, to.z, t),
      );
      tube(leg, previous, point, 0.036, materials.darkMetal, 10);
      previous = point;
    }
    group.add(leg);

    const wheel = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.062, 10, 20), materials.rubber);
    tyre.rotation.y = Math.PI / 2;
    wheel.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.1, 14), materials.metal);
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);
    wheel.position.set(side * 1.25, -1.05, 0.3);
    group.add(wheel);

    // Wheel fairing, sitting over the tyre rather than beside it.
    const fairing = loftBody([
      { z: 0.02, rx: 0.055, top: 0.06, bottom: 0.05, y: -1.0, power: 0.85 },
      { z: 0.22, rx: 0.105, top: 0.15, bottom: 0.14, y: -1.02, power: 0.8 },
      { z: 0.44, rx: 0.09, top: 0.13, bottom: 0.12, y: -1.03, power: 0.85 },
      { z: 0.62, rx: 0.04, top: 0.06, bottom: 0.05, y: -1.02, power: 0.9 },
    ], materials.skin, { segments: 16 });
    fairing.position.x = side * 1.25;
    group.add(fairing);
  }

  // Nose gear: oleo strut in a fairing, with a trailing fork.
  const nose = new THREE.Group();
  tube(nose, new THREE.Vector3(0, -0.28, -2.42), new THREE.Vector3(0, -0.78, -2.36), 0.05, materials.darkMetal);
  tube(nose, new THREE.Vector3(0, -0.78, -2.36), new THREE.Vector3(0, -0.95, -2.3), 0.036, materials.metal);
  for (const side of [1, -1]) {
    tube(nose, new THREE.Vector3(side * 0.06, -0.93, -2.3), new THREE.Vector3(side * 0.075, -1.03, -2.26), 0.018, materials.darkMetal, 8);
  }
  const noseTyre = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.052, 10, 20), materials.rubber);
  noseTyre.rotation.y = Math.PI / 2;
  noseTyre.position.set(0, -1.05, -2.26);
  nose.add(noseTyre);
  const noseHub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.085, 14), materials.metal);
  noseHub.rotation.z = Math.PI / 2;
  noseHub.position.set(0, -1.05, -2.26);
  nose.add(noseHub);
  const noseFairing = loftBody([
    { z: -2.48, rx: 0.045, top: 0.05, bottom: 0.045, y: -0.98, power: 0.85 },
    { z: -2.3, rx: 0.09, top: 0.12, bottom: 0.11, y: -1.0, power: 0.8 },
    { z: -2.12, rx: 0.075, top: 0.1, bottom: 0.09, y: -1.01, power: 0.85 },
    { z: -1.98, rx: 0.03, top: 0.045, bottom: 0.04, y: -1.0, power: 0.9 },
  ], materials.skin, { segments: 14 });
  nose.add(noseFairing);
  // Strut fairing up to the firewall: a slim shroud, sized directly rather
  // than scaled, so it cannot drag the airframe's lowest point down with it.
  const strutFairing = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.62, 0.17),
    materials.skin,
  );
  strutFairing.position.set(0, -0.56, -2.4);
  strutFairing.castShadow = true;
  nose.add(strutFairing);
  group.add(nose);
}

function addGlazing(group, materials) {
  // Windscreen: two panes either side of a centre post.
  for (const side of [1, -1]) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.6), materials.glass);
    pane.position.set(side * 0.26, 0.60, -1.98);
    pane.rotation.set(DEG(-32), side * DEG(12), 0);
    group.add(pane);
  }
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.72, 0.035), materials.skin);
  post.position.set(0, 0.60, -1.97);
  post.rotation.x = DEG(-32);
  group.add(post);

  // Door windows and the rear quarter lights.
  for (const side of [1, -1]) {
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.44), materials.glass);
    door.position.set(side * 0.575, 0.44, -1.28);
    door.rotation.y = side * DEG(90);
    group.add(door);

    const rear = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.36), materials.glass);
    rear.position.set(side * 0.555, 0.40, -0.44);
    rear.rotation.y = side * DEG(90);
    group.add(rear);

    // Door outline, drawn as a seam rather than a filled panel.
    const seam = (y, z, height, depth) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.008, height, depth), materials.grey);
      bar.position.set(side * 0.575, y, z);
      group.add(bar);
    };
    seam(0.72, -1.24, 0.02, 0.94);
    seam(-0.24, -1.24, 0.02, 0.94);
    seam(0.24, -1.71, 0.96, 0.02);
    seam(0.24, -0.77, 0.96, 0.02);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.12), materials.metal);
    handle.position.set(side * 0.585, 0.02, -0.9);
    group.add(handle);
  }
}

function addLivery(group, materials) {
  // Cessna-style sweep: a broad stripe down the fuselage side lifting into the
  // fin, painted as thin shells a millimetre proud of the skin.
  for (const side of [1, -1]) {
    const sweep = [
      [-2.30, -0.12], [-0.60, -0.16], [1.20, -0.06], [2.60, 0.12],
      [3.60, 0.32], [3.60, 0.20], [2.60, 0.00], [1.20, -0.18], [-0.60, -0.28], [-2.30, -0.24],
    ];
    const shape = new THREE.Shape();
    shape.moveTo(sweep[0][0], sweep[0][1]);
    sweep.slice(1).forEach(([z, y]) => shape.lineTo(z, y));
    shape.closePath();
    const stripe = new THREE.Mesh(new THREE.ShapeGeometry(shape), materials.navy);
    stripe.rotation.y = side * Math.PI / 2;
    stripe.position.x = side * 0.573;
    group.add(stripe);

    const thin = new THREE.Shape();
    const gold = [
      [-2.30, -0.27], [-0.60, -0.31], [1.20, -0.21], [2.60, -0.03], [3.60, 0.17],
      [3.60, 0.12], [2.60, -0.08], [1.20, -0.26], [-0.60, -0.36], [-2.30, -0.32],
    ];
    thin.moveTo(gold[0][0], gold[0][1]);
    gold.slice(1).forEach(([z, y]) => thin.lineTo(z, y));
    thin.closePath();
    const accent = new THREE.Mesh(new THREE.ShapeGeometry(thin), materials.gold);
    accent.rotation.y = side * Math.PI / 2;
    accent.position.x = side * 0.574;
    group.add(accent);
  }

  // Registration on the tailcone.
  const registration = canvasTexture(512, 128, (context, width, height) => {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#18384f";
    context.font = "700 84px 'Barlow Condensed', Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("N172HZ", width / 2, height / 2);
  });
  const material = new THREE.MeshStandardMaterial({ map: registration, transparent: true, roughness: 0.4 });
  for (const side of [1, -1]) {
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.23), material);
    mark.position.set(side * 0.34, 0.14, 2.5);
    mark.rotation.y = side * DEG(90);
    group.add(mark);
  }
}

function addDetails(group, materials) {
  // Pitot tube under the left wing.
  const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8), materials.metal);
  pitot.rotation.x = Math.PI / 2;
  pitot.position.set(-1.9, WING_Y - 0.06, WING_LE + 0.05);
  group.add(pitot);
  tube(group, new THREE.Vector3(-1.9, WING_Y - 0.02, WING_LE + 0.12),
    new THREE.Vector3(-1.9, WING_Y - 0.06, WING_LE + 0.12), 0.011, materials.metal, 8);

  // Stall warning vane in the left leading edge.
  const vane = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.012), materials.black);
  vane.position.set(-2.62, WING_Y + 0.03, WING_LE - 0.01);
  group.add(vane);

  // Comm antennas on the cabin roof and a GPS puck behind them.
  for (const z of [-0.9, -0.3]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.09), materials.black);
    blade.position.set(0, 0.80, z);
    blade.rotation.x = DEG(-8);
    group.add(blade);
  }
  const gps = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, 0.2), materials.skin);
  gps.position.set(0, 0.77, 0.25);
  group.add(gps);

  // Ventral antenna and beacon under the tailcone.
  const ventral = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.09, 0.07), materials.black);
  ventral.position.set(0, -0.48, 1.1);
  group.add(ventral);

  // Step and handle below the pilot's door.
  for (const side of [1, -1]) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.16), materials.darkMetal);
    step.position.set(side * 0.48, -0.64, 0.08);
    group.add(step);
  }

  // Exhaust stack below the cowl.
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.22, 10), materials.darkMetal);
  exhaust.rotation.set(Math.PI / 2, 0, 0);
  exhaust.position.set(0.16, -0.42, -2.5);
  group.add(exhaust);

  // Static wicks on the trailing edges.
  for (const side of [1, -1]) {
    for (const x of [3.4, 4.4, 5.1]) {
      const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.002, 0.11, 5), materials.black);
      wick.rotation.x = DEG(-84);
      wick.position.set(side * x, WING_Y + 0.1, WING_LE + WING_CHORD + 0.36);
      group.add(wick);
    }
  }
}

export function buildC172Exterior(materials) {
  const exterior = new THREE.Group();
  exterior.name = "C172 exterior";
  const controls = {};

  exterior.add(loftBody(STATIONS, materials.skin, { segments: 30, capNose: false }));
  addCowl(exterior, materials, controls);
  addWings(exterior, materials, controls);
  addTail(exterior, materials, controls);
  addGear(exterior, materials);
  addGlazing(exterior, materials);
  addLivery(exterior, materials);
  addDetails(exterior, materials);

  return { exterior, controls };
}
