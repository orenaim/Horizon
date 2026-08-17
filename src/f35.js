import * as THREE from "three";

// Lockheed Martin F-35A Lightning II.
//
// Built in metres with the nose along -Z, matching the other aircraft in the
// sim; `modelScale` of 0.1 converts straight to world units, so every dimension
// below can be read against the published airframe:
//
//   length 15.7 m · span 10.7 m · height 4.36 m · wing area 42.7 m²
//
// The shapes that make an F-35 recognisable are the chine running from the
// radome to the wing root, the diverterless inlets with their compression
// bumps, the outward-canted tails, and the sawtooth edges on every door and
// panel. Those are modelled explicitly rather than approximated with a tube.

const DEG = THREE.MathUtils.degToRad;

const LENGTH = 15.7;
const HALF_SPAN = 5.35;

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
 * Radar-absorbent finish: a mid grey broken up by slightly mismatched panels,
 * with sawtooth edges on the larger ones. The tonal patchwork is the single
 * most recognisable thing about a real F-35's skin up close.
 */
function skinTexture() {
  return canvasTexture(1024, 1024, (context, width, height) => {
    context.fillStyle = "#5b636c";
    context.fillRect(0, 0, width, height);

    let seed = 20240;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    // Mismatched coating panels.
    for (let i = 0; i < 90; i += 1) {
      const w = 60 + random() * 190;
      const h = 45 + random() * 150;
      const x = random() * width;
      const y = random() * height;
      const shade = 0.88 + random() * 0.22;
      context.fillStyle = `rgba(${Math.round(91 * shade)},${Math.round(99 * shade)},${Math.round(108 * shade)},0.75)`;
      context.beginPath();
      // Sawtooth along the trailing edge of the panel.
      const teeth = 5 + Math.floor(random() * 5);
      context.moveTo(x, y);
      context.lineTo(x + w, y);
      for (let t = 0; t < teeth; t += 1) {
        const step = h / teeth;
        context.lineTo(x + w - (t % 2 ? 0 : 14), y + step * (t + 1));
      }
      context.lineTo(x, y + h);
      context.closePath();
      context.fill();
    }

    // Panel lines and fastener rows.
    context.strokeStyle = "rgba(38,43,49,0.5)";
    context.lineWidth = 1.4;
    for (let i = 0; i < 60; i += 1) {
      const vertical = random() > 0.5;
      const at = random() * (vertical ? width : height);
      const from = random() * (vertical ? height : width);
      const span = 90 + random() * 380;
      context.beginPath();
      if (vertical) {
        context.moveTo(at, from);
        context.lineTo(at, from + span);
      } else {
        context.moveTo(from, at);
        context.lineTo(from + span, at);
      }
      context.stroke();
    }
    context.fillStyle = "rgba(44,49,56,0.35)";
    for (let i = 0; i < 900; i += 1) {
      context.fillRect(random() * width, random() * height, 1.6, 1.6);
    }
  }, [3, 2]);
}

function buildMaterials() {
  const skin = skinTexture();
  return {
    skin: new THREE.MeshStandardMaterial({
      map: skin,
      color: 0xffffff,
      roughness: 0.66,
      metalness: 0.22,
    }),
    // Radome and dielectric panels read slightly darker and flatter.
    radome: new THREE.MeshStandardMaterial({ color: 0x474d55, roughness: 0.82, metalness: 0.05 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2f353b, roughness: 0.7, metalness: 0.3 }),
    // The canopy's indium-tin-oxide coating is what gives it the gold cast.
    canopy: new THREE.MeshPhysicalMaterial({
      color: 0xe0be86,
      roughness: 0.04,
      metalness: 0.12,
      transmission: 0.94,
      transparent: true,
      opacity: 0.34,
      ior: 1.52,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      side: THREE.DoubleSide,
    }),
    sensor: new THREE.MeshPhysicalMaterial({
      color: 0x1b2026,
      roughness: 0.12,
      metalness: 0.55,
      clearcoat: 1,
    }),
    nozzle: new THREE.MeshStandardMaterial({ color: 0x8d8377, roughness: 0.44, metalness: 0.92 }),
    burnt: new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.58, metalness: 0.7 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa1a6, roughness: 0.32, metalness: 0.85 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.95 }),
    cockpit: new THREE.MeshStandardMaterial({ color: 0x32383e, roughness: 0.85 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x30353a, roughness: 0.8 }),
    marking: new THREE.MeshStandardMaterial({ color: 0x6e767f, roughness: 0.75 }),
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Lofts a fuselage whose cross-section carries a hard chine: a sharp lateral
 * edge with a separately shaped deck above it and belly below. Sweeping the
 * chine's height and the section's flatness along the body is what produces the
 * faceted forward fuselage instead of a cigar.
 */
function chinedLoft(rings, material, { halfSegments = 14, capNose = true, capTail = false } = {}) {
  const perRing = halfSegments * 2;
  const positions = [];
  const uvs = [];
  const indices = [];

  const section = (ring) => {
    const points = [];
    for (let i = 0; i <= halfSegments; i += 1) {
      const angle = (i / halfSegments) * Math.PI;
      points.push([
        Math.cos(angle) * ring.rx,
        ring.chineY + Math.sin(angle) ** (ring.topPower ?? 1) * ring.top,
      ]);
    }
    for (let i = 1; i < halfSegments; i += 1) {
      const angle = (i / halfSegments) * Math.PI;
      points.push([
        -Math.cos(angle) * ring.rx,
        ring.chineY - Math.sin(angle) ** (ring.bottomPower ?? 1) * ring.bottom,
      ]);
    }
    return points;
  };

  const span = rings.at(-1).z - rings[0].z;
  rings.forEach((ring, index) => {
    const points = section(ring);
    const v = (ring.z - rings[0].z) / span;
    points.forEach(([x, y], i) => {
      positions.push(x, y, ring.z);
      uvs.push(i / perRing, v);
    });
  });

  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let i = 0; i < perRing; i += 1) {
      const next = (i + 1) % perRing;
      const a = ring * perRing + i;
      const b = ring * perRing + next;
      const c = (ring + 1) * perRing + next;
      const d = (ring + 1) * perRing + i;
      indices.push(a, b, d, b, c, d);
    }
  }

  if (capNose) {
    const centre = positions.length / 3;
    positions.push(0, rings[0].chineY, rings[0].z);
    uvs.push(0.5, 0);
    for (let i = 0; i < perRing; i += 1) {
      indices.push(centre, (i + 1) % perRing, i);
    }
  }
  if (capTail) {
    const centre = positions.length / 3;
    const last = rings.at(-1);
    positions.push(0, last.chineY, last.z);
    uvs.push(0.5, 1);
    const base = (rings.length - 1) * perRing;
    for (let i = 0; i < perRing; i += 1) {
      indices.push(centre, base + i, base + ((i + 1) % perRing));
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

/**
 * A swept, tapered lifting surface with a thin supersonic section. Chord and
 * thickness are interpolated from root to tip, so one call covers the wing, the
 * stabilators and the fins.
 */
function liftingSurface({
  side = 1,
  rootX,
  tipX,
  rootLeadZ,
  rootTrailZ,
  tipLeadZ,
  tipTrailZ,
  rootY = 0,
  tipY = 0,
  rootThickness,
  tipThickness,
  material,
  spanSegments = 10,
  chordSegments = 16,
}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const row = chordSegments + 1;

  for (const underside of [false, true]) {
    for (let s = 0; s <= spanSegments; s += 1) {
      const t = s / spanSegments;
      const x = side * THREE.MathUtils.lerp(rootX, tipX, t);
      const lead = THREE.MathUtils.lerp(rootLeadZ, tipLeadZ, t);
      const trail = THREE.MathUtils.lerp(rootTrailZ, tipTrailZ, t);
      const y = THREE.MathUtils.lerp(rootY, tipY, t);
      const thick = THREE.MathUtils.lerp(rootThickness, tipThickness, t);
      for (let c = 0; c <= chordSegments; c += 1) {
        const ct = c / chordSegments;
        // Biconvex-ish profile: max thickness near 40% chord, sharp edges.
        const profile = Math.sin(Math.PI * ct ** 0.85) ** 1.15;
        positions.push(
          x,
          y + profile * thick * (underside ? -0.5 : 0.5),
          THREE.MathUtils.lerp(lead, trail, ct),
        );
        uvs.push(ct, t);
      }
    }
  }

  const half = (spanSegments + 1) * row;
  const top = (s, c) => s * row + c;
  const bottom = (s, c) => half + s * row + c;
  for (let s = 0; s < spanSegments; s += 1) {
    for (let c = 0; c < chordSegments; c += 1) {
      indices.push(top(s, c), top(s + 1, c), top(s, c + 1));
      indices.push(top(s, c + 1), top(s + 1, c), top(s + 1, c + 1));
      indices.push(bottom(s, c), bottom(s, c + 1), bottom(s + 1, c));
      indices.push(bottom(s, c + 1), bottom(s + 1, c + 1), bottom(s + 1, c));
    }
  }
  // Close the tip.
  for (let c = 0; c < chordSegments; c += 1) {
    indices.push(top(spanSegments, c), top(spanSegments, c + 1), bottom(spanSegments, c));
    indices.push(bottom(spanSegments, c), top(spanSegments, c + 1), bottom(spanSegments, c + 1));
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

/** Flat plate from an outline in the XZ plane, given a thickness. */
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

/** Hinged control surface: a plate whose pivot sits on its leading edge. */
function controlSurface(name, points, thickness, material, pivot) {
  const group = new THREE.Group();
  group.name = name;
  const plate = platePrism(points.map(([x, z]) => [x - pivot[0], z - pivot[1]]), thickness, material);
  group.add(plate);
  group.position.set(pivot[0], 0, pivot[1]);
  return group;
}

// ---------------------------------------------------------------------------
// Exterior
// ---------------------------------------------------------------------------

// Fuselage stations. `top`/`bottom` are measured from the chine, which is the
// widest point of the section and the sharp edge down each side.
const STATIONS = [
  { z: -7.85, rx: 0.03, top: 0.03, bottom: 0.03, chineY: 0.10, topPower: 0.9, bottomPower: 0.9 },
  { z: -7.45, rx: 0.20, top: 0.16, bottom: 0.16, chineY: 0.06, topPower: 0.8, bottomPower: 0.85 },
  { z: -6.90, rx: 0.40, top: 0.24, bottom: 0.32, chineY: -0.02, topPower: 0.74, bottomPower: 0.8 },
  { z: -6.25, rx: 0.62, top: 0.34, bottom: 0.46, chineY: -0.08, topPower: 0.7, bottomPower: 0.76 },
  { z: -5.60, rx: 0.80, top: 0.44, bottom: 0.56, chineY: -0.12, topPower: 0.68, bottomPower: 0.74 },
  { z: -4.95, rx: 0.92, top: 0.56, bottom: 0.64, chineY: -0.14, topPower: 0.66, bottomPower: 0.72 },
  { z: -4.20, rx: 1.02, top: 0.66, bottom: 0.68, chineY: -0.14, topPower: 0.66, bottomPower: 0.72 },
  { z: -3.40, rx: 1.16, top: 0.72, bottom: 0.76, chineY: -0.18, topPower: 0.68, bottomPower: 0.72 },
  { z: -2.60, rx: 1.36, top: 0.78, bottom: 0.86, chineY: -0.20, topPower: 0.72, bottomPower: 0.74 },
  { z: -1.60, rx: 1.52, top: 0.82, bottom: 0.94, chineY: -0.22, topPower: 0.78, bottomPower: 0.78 },
  { z: -0.40, rx: 1.58, top: 0.84, bottom: 0.98, chineY: -0.22, topPower: 0.8, bottomPower: 0.8 },
  { z: 1.00, rx: 1.57, top: 0.82, bottom: 0.98, chineY: -0.22, topPower: 0.8, bottomPower: 0.8 },
  { z: 2.40, rx: 1.47, top: 0.78, bottom: 0.92, chineY: -0.20, topPower: 0.78, bottomPower: 0.78 },
  { z: 3.80, rx: 1.30, top: 0.72, bottom: 0.82, chineY: -0.16, topPower: 0.76, bottomPower: 0.76 },
  { z: 5.20, rx: 1.08, top: 0.64, bottom: 0.70, chineY: -0.10, topPower: 0.8, bottomPower: 0.8 },
  { z: 6.50, rx: 0.86, top: 0.58, bottom: 0.60, chineY: -0.05, topPower: 0.88, bottomPower: 0.88 },
  { z: 7.30, rx: 0.70, top: 0.54, bottom: 0.55, chineY: -0.02, topPower: 0.95, bottomPower: 0.95 },
  { z: 7.62, rx: 0.63, top: 0.50, bottom: 0.52, chineY: 0.00, topPower: 1, bottomPower: 1 },
];

function addChine(group, materials) {
  // The chine is a thin shelf standing proud of the section's widest point,
  // running from behind the radome back into the wing leading-edge root.
  const outline = [
    [0.05, -7.60],
    [0.62, -6.60],
    [0.95, -5.60],
    [1.16, -4.60],
    [1.34, -3.55],
    [1.52, -2.55],
    [1.62, -1.95],
    [1.30, -1.95],
    [1.22, -2.55],
    [1.06, -3.55],
    [0.90, -4.60],
    [0.72, -5.60],
    [0.44, -6.60],
    [0.04, -7.60],
  ];
  for (const side of [1, -1]) {
    const plate = platePrism(outline.map(([x, z]) => [x * side, z]), 0.055, materials.skin);
    plate.position.y = -0.10;
    group.add(plate);
  }
}

function addInlets(group, materials) {
  for (const side of [1, -1]) {
    const inlet = new THREE.Group();
    // The aperture is raked: its outboard lip stands forward of the inboard one,
    // and the whole opening leans outward from the fuselage side.
    const rake = side * DEG(22);

    // Diverterless compression bump. There is no splitter plate on this
    // aircraft — this swelling does the boundary-layer work instead, so it is
    // large, smooth, and merges into the forebody.
    const bump = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), materials.skin);
    bump.scale.set(0.46, 0.62, 1.25);
    bump.position.set(side * 1.20, -0.12, -3.15);
    inlet.add(bump);

    // Cheek fairing carrying the duct back into the wing root.
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), materials.skin);
    cheek.scale.set(0.40, 0.66, 1.15);
    cheek.position.set(side * 1.30, -0.14, -1.85);
    inlet.add(cheek);

    // Aperture: a tall rounded oval, roughly a metre across.
    const aperture = new THREE.Group();
    aperture.position.set(side * 1.34, -0.10, -2.46);
    aperture.rotation.y = rake;

    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.085, 12, 28), materials.skin);
    lip.scale.set(0.98, 0.86, 1);
    aperture.add(lip);

    const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 1.35, 24, 1, true), materials.dark);
    duct.rotation.x = Math.PI / 2;
    duct.scale.set(0.98, 1, 0.86);
    duct.position.z = 0.66;
    aperture.add(duct);

    const throat = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), materials.dark);
    throat.scale.set(0.98, 0.86, 1);
    throat.position.z = 1.3;
    throat.rotation.y = Math.PI;
    aperture.add(throat);

    inlet.add(aperture);
    group.add(inlet);
  }
}

function addNozzle(group, materials, controls) {
  const nozzle = new THREE.Group();
  nozzle.position.z = 7.55;

  const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.63, 0.58, 0.5, 24, 1, true), materials.burnt);
  shroud.rotation.x = Math.PI / 2;
  nozzle.add(shroud);

  // Convergent petals with the sawtooth trailing edge.
  const petalCount = 15;
  for (let i = 0; i < petalCount; i += 1) {
    const angle = (i / petalCount) * Math.PI * 2;
    const petal = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.62, 4, 1, true), materials.nozzle);
    petal.rotation.x = Math.PI / 2 + DEG(9);
    petal.rotation.z = angle;
    petal.position.set(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, 0.36);
    nozzle.add(petal);
  }

  const throat = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), materials.dark);
  throat.position.z = 0.62;
  nozzle.add(throat);

  // Afterburner plume, driven from the throttle by the flight loop.
  const flameMaterial = new THREE.MeshBasicMaterial({
    color: 0x8fb8ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.36, 3.2, 18, 1, true), flameMaterial);
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = 2.1;
  flame.visible = false;
  // The plume is not part of the airframe, so it must not count towards the
  // aircraft's measured extent.
  flame.userData.noBounds = true;
  nozzle.add(flame);

  const coreMaterial = flameMaterial.clone();
  coreMaterial.color = new THREE.Color(0xffd9a8);
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.19, 1.5, 14, 1, true), coreMaterial);
  core.rotation.x = -Math.PI / 2;
  core.position.z = 1.0;
  core.visible = false;
  core.userData.noBounds = true;
  nozzle.add(core);

  let level = 0;
  controls.afterburner = {
    setThrust(throttle, dt) {
      // Reheat only lights in the top of the range, then flickers.
      const target = THREE.MathUtils.clamp((throttle - 0.72) / 0.28, 0, 1);
      level += (target - level) * Math.min(1, dt * 6);
      const flicker = 0.86 + Math.sin(performance.now() * 0.045) * 0.14;
      flame.visible = level > 0.02;
      core.visible = level > 0.02;
      flameMaterial.opacity = level * 0.5 * flicker;
      coreMaterial.opacity = level * 0.8 * flicker;
      flame.scale.set(1, 0.45 + level * 0.85, 1);
      core.scale.set(1, 0.5 + level * 0.8, 1);
    },
  };

  group.add(nozzle);
}

function addCanopy(group, materials) {
  // Windscreen and one-piece bubble, blown from the same profile.
  const rings = [
    { z: -5.75, rx: 0.26, top: 0.08, bottom: 0, chineY: 0.40, topPower: 0.8 },
    { z: -5.45, rx: 0.44, top: 0.40, bottom: 0, chineY: 0.38, topPower: 0.72 },
    { z: -5.05, rx: 0.54, top: 0.62, bottom: 0, chineY: 0.42, topPower: 0.7 },
    { z: -4.60, rx: 0.59, top: 0.74, bottom: 0, chineY: 0.44, topPower: 0.72 },
    { z: -4.10, rx: 0.60, top: 0.76, bottom: 0, chineY: 0.46, topPower: 0.75 },
    { z: -3.60, rx: 0.56, top: 0.68, bottom: 0, chineY: 0.48, topPower: 0.8 },
    { z: -3.15, rx: 0.46, top: 0.40, bottom: 0, chineY: 0.49, topPower: 0.85 },
    { z: -2.85, rx: 0.36, top: 0.20, bottom: 0, chineY: 0.50, topPower: 0.9 },
  ];
  const glass = chinedLoft(rings, materials.canopy, { halfSegments: 16, capNose: false });
  glass.castShadow = false;
  group.add(glass);

  // Forward bow frame.
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.026, 8, 22, Math.PI), materials.dark);
  bow.position.set(0, 0.28, -5.66);
  bow.rotation.x = DEG(-24);
  group.add(bow);

  // Spine fairing behind the canopy.
  const spine = chinedLoft([
    { z: -3.00, rx: 0.34, top: 0.22, bottom: 0, chineY: 0.50, topPower: 0.9 },
    { z: -1.90, rx: 0.38, top: 0.18, bottom: 0, chineY: 0.58, topPower: 0.95 },
    { z: -0.40, rx: 0.36, top: 0.12, bottom: 0, chineY: 0.60, topPower: 1 },
    { z: 1.40, rx: 0.30, top: 0.06, bottom: 0, chineY: 0.58, topPower: 1 },
    { z: 3.00, rx: 0.24, top: 0.03, bottom: 0, chineY: 0.53, topPower: 1 },
  ], materials.skin, { halfSegments: 10, capNose: false });
  group.add(spine);
}

function addSeat(group, materials) {
  const seat = new THREE.Group();
  seat.position.set(0, -0.02, -3.98);

  const pan = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.52), materials.seat);
  pan.position.set(0, 0.34, 0.06);
  seat.add(pan);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.86, 0.14), materials.seat);
  back.position.set(0, 0.76, 0.30);
  back.rotation.x = DEG(-14);
  seat.add(back);

  const headbox = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.24), materials.dark);
  headbox.position.set(0, 1.22, 0.36);
  seat.add(headbox);

  // Helmet, which is most of what you see through the canopy from outside.
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), materials.dark);
  helmet.scale.set(1, 1.06, 1.12);
  helmet.position.set(0, 1.02, 0.06);
  seat.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.163, 16, 12, 0, Math.PI, 0.7, 1.0), materials.sensor);
  visor.scale.set(1, 1.06, 1.12);
  visor.rotation.y = -Math.PI / 2;
  visor.position.copy(helmet.position);
  seat.add(visor);

  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.34, 0.3), materials.cockpit);
  shoulders.position.set(0, 0.72, 0.1);
  seat.add(shoulders);

  group.add(seat);
}

function addSensors(group, materials) {
  // Electro-optical targeting system: the faceted prism under the radome.
  const eots = new THREE.Group();
  eots.position.set(0, -0.34, -6.55);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.22, 0.62, 7), materials.dark);
  body.rotation.x = Math.PI / 2;
  body.rotation.z = DEG(25);
  eots.add(body);
  const window = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.1, 7), materials.sensor);
  window.rotation.x = Math.PI / 2;
  window.rotation.z = DEG(25);
  window.position.z = -0.28;
  eots.add(window);
  group.add(eots);

  // Distributed aperture windows: six flat sensor faces around the airframe.
  const apertures = [
    [0.52, 0.24, -6.05], [-0.52, 0.24, -6.05],
    [0.62, -0.46, -5.35], [-0.62, -0.46, -5.35],
    [0.30, 0.58, -2.65], [-0.30, 0.58, -2.65],
  ];
  for (const [x, y, z] of apertures) {
    const pane = new THREE.Mesh(new THREE.CircleGeometry(0.11, 6), materials.sensor);
    pane.position.set(x, y, z);
    pane.lookAt(x * 4, y * 4, z - 1);
    group.add(pane);
  }

  // Refuelling receptacle door on the spine.
  const receptacle = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.46), materials.dark);
  receptacle.position.set(0.34, 0.55, -2.1);
  group.add(receptacle);
}

function addGear(group, materials, gearAssemblies) {
  const wheel = (radius, width) => {
    const assembly = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 18), materials.rubber);
    tyre.rotation.z = Math.PI / 2;
    assembly.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, width * 1.05, 12), materials.metal);
    hub.rotation.z = Math.PI / 2;
    assembly.add(hub);
    return assembly;
  };

  // Nose gear, offset to the left and raked forward as on the real aircraft.
  const nose = new THREE.Group();
  const noseLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.92, 10), materials.metal);
  noseLeg.position.set(0, -0.86, -5.25);
  noseLeg.rotation.x = DEG(-6);
  nose.add(noseLeg);
  const noseWheel = wheel(0.30, 0.20);
  noseWheel.position.set(0, -1.32, -5.32);
  nose.add(noseWheel);
  const noseDoor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 1.5), materials.skin);
  noseDoor.position.set(0.30, -0.55, -5.3);
  noseDoor.rotation.z = DEG(72);
  nose.add(noseDoor);
  group.add(nose);
  gearAssemblies.push(nose);

  for (const side of [1, -1]) {
    const main = new THREE.Group();
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.98, 10), materials.metal);
    leg.position.set(side * 1.16, -0.92, -0.35);
    leg.rotation.z = DEG(side * 5);
    main.add(leg);
    const mainWheel = wheel(0.38, 0.26);
    mainWheel.position.set(side * 1.24, -1.36, -0.35);
    main.add(mainWheel);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.62, 1.6), materials.skin);
    door.position.set(side * 1.42, -0.62, -0.35);
    main.add(door);
    group.add(main);
    gearAssemblies.push(main);
  }
}

function addMarkings(group, materials) {
  // Low-visibility national insignia: two bars and a star, all in grey.
  const insignia = (x, y, z, scale, faceUp) => {
    const mark = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.16), materials.marking);
    bar.position.x = -0.42;
    mark.add(bar);
    const bar2 = bar.clone();
    bar2.position.x = 0.42;
    mark.add(bar2);
    const star = new THREE.Mesh(new THREE.CircleGeometry(0.24, 5), materials.marking);
    mark.add(star);
    mark.scale.setScalar(scale);
    mark.position.set(x, y, z);
    mark.rotation.x = faceUp ? -Math.PI / 2 : Math.PI / 2;
    mark.rotation.z = faceUp ? 0 : Math.PI;
    group.add(mark);
  };
  insignia(-2.9, 0.09, 1.1, 1, true);
  insignia(2.9, -0.09, 1.1, 1, false);

  // Tail codes on the outer face of each fin.
  const codeTexture = canvasTexture(256, 128, (context, width, height) => {
    context.fillStyle = "rgba(0,0,0,0)";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#6f777f";
    context.font = "700 92px 'Barlow Condensed', Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("LM", width / 2, height / 2);
  });
  const codeMaterial = new THREE.MeshStandardMaterial({
    map: codeTexture,
    transparent: true,
    roughness: 0.8,
  });
  for (const side of [1, -1]) {
    const code = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), codeMaterial);
    code.position.set(side * 1.86, 1.35, 4.5);
    code.rotation.y = side * (Math.PI / 2 - DEG(25));
    group.add(code);
  }
}

function buildExterior(materials, controls, gearAssemblies) {
  const exterior = new THREE.Group();

  exterior.add(chinedLoft(STATIONS, materials.skin, { halfSegments: 16 }));
  addChine(exterior, materials);

  // Radome, slightly darker than the airframe.
  const radome = chinedLoft(STATIONS.slice(0, 5), materials.radome, { halfSegments: 16 });
  radome.scale.setScalar(1.004);
  exterior.add(radome);

  // --- Wing --------------------------------------------------------------
  // 34° leading-edge sweep, forward-swept trailing edge, 5.5 m root chord.
  for (const side of [1, -1]) {
    exterior.add(liftingSurface({
      side,
      rootX: 1.35,
      tipX: HALF_SPAN,
      rootLeadZ: -2.30,
      rootTrailZ: 3.20,
      tipLeadZ: 0.40,
      tipTrailZ: 2.28,
      rootY: -0.08,
      tipY: 0.16,
      rootThickness: 0.30,
      tipThickness: 0.09,
      material: materials.skin,
    }));

    // Leading-edge flap, hinged along the wing's leading edge.
    const slat = controlSurface(`slat${side > 0 ? "R" : "L"}`, [
      [side * 1.5, -2.16], [side * HALF_SPAN, 0.46], [side * HALF_SPAN, 0.86], [side * 1.5, -1.78],
    ], 0.07, materials.skin, [0, -1.0]);
    exterior.add(slat);
    controls[`slat${side > 0 ? "R" : "L"}`] = slat;

    // Flaperon: this one surface is both the aileron and the flap.
    const flaperon = controlSurface(`flaperon${side > 0 ? "R" : "L"}`, [
      [side * 1.45, 3.18], [side * 3.75, 2.62], [side * 3.75, 3.12], [side * 1.45, 3.72],
    ], 0.07, materials.skin, [0, 2.9]);
    exterior.add(flaperon);
    controls[`flaperon${side > 0 ? "R" : "L"}`] = flaperon;

    // Outboard aileron section.
    const aileron = controlSurface(`aileron${side > 0 ? "R" : "L"}`, [
      [side * 3.85, 2.60], [side * 5.30, 2.26], [side * 5.30, 2.62], [side * 3.85, 3.08],
    ], 0.06, materials.skin, [0, 2.6]);
    exterior.add(aileron);
    controls[`aileron${side > 0 ? "R" : "L"}`] = aileron;
  }

  // --- Stabilators -------------------------------------------------------
  // All-moving, so the whole surface is the control.
  for (const side of [1, -1]) {
    const stabilator = new THREE.Group();
    stabilator.name = `elevator${side > 0 ? "R" : "L"}`;
    stabilator.add(liftingSurface({
      side,
      rootX: 1.18,
      tipX: 3.45,
      rootLeadZ: 3.55 - 4.35,
      rootTrailZ: 6.30 - 4.35,
      tipLeadZ: 5.10 - 4.35,
      tipTrailZ: 6.20 - 4.35,
      rootY: 0,
      tipY: 0.06,
      rootThickness: 0.17,
      tipThickness: 0.06,
      material: materials.skin,
      spanSegments: 8,
    }));
    stabilator.position.set(0, -0.22, 4.35);
    exterior.add(stabilator);
    controls[`elevator${side > 0 ? "R" : "L"}`] = stabilator;
  }

  // --- Vertical tails ----------------------------------------------------
  // Canted 25° outward, which is the aircraft's clearest identifying feature
  // from behind.
  const rudders = new THREE.Group();
  rudders.name = "rudder";
  for (const side of [1, -1]) {
    const fin = new THREE.Group();
    fin.add(liftingSurface({
      side: 1,
      rootX: 0,
      tipX: 2.05,
      rootLeadZ: 2.55,
      rootTrailZ: 6.10,
      tipLeadZ: 5.05,
      tipTrailZ: 6.20,
      rootThickness: 0.16,
      tipThickness: 0.06,
      material: materials.skin,
      spanSegments: 8,
    }));
    fin.rotation.z = DEG(side > 0 ? 65 : 115);
    fin.position.set(side * 1.14, 0.48, 0);
    exterior.add(fin);

    // The rudder is the aft third of each fin, hinged on the fin's own axis.
    const rudder = new THREE.Group();
    rudder.add(liftingSurface({
      side: 1,
      rootX: 0.1,
      tipX: 1.95,
      rootLeadZ: 0,
      rootTrailZ: 0.72,
      tipLeadZ: 0.22,
      tipTrailZ: 0.5,
      rootThickness: 0.1,
      tipThickness: 0.04,
      material: materials.skin,
      spanSegments: 6,
    }));
    rudder.rotation.z = DEG(side > 0 ? 65 : 115);
    rudder.position.set(side * 1.14, 0.48, 5.9);
    rudders.add(rudder);
  }
  exterior.add(rudders);
  controls.rudder = rudders;

  addInlets(exterior, materials);
  addNozzle(exterior, materials, controls);
  addCanopy(exterior, materials);
  addSeat(exterior, materials);
  addSensors(exterior, materials);
  addMarkings(exterior, materials);
  addGear(exterior, materials, gearAssemblies);

  // Weapons bay doors, closed, with the sawtooth edges they actually have.
  for (const side of [1, -1]) {
    const door = platePrism([
      [side * 0.42, -1.85], [side * 1.38, -1.72], [side * 1.38, 1.62], [side * 0.42, 1.72],
    ], 0.04, materials.skin);
    door.position.y = -0.98;
    exterior.add(door);
  }

  return exterior;
}

// ---------------------------------------------------------------------------
// Cockpit
// ---------------------------------------------------------------------------

/**
 * The panoramic cockpit display: one wide touchscreen replacing the usual
 * cluster of instruments, split into selectable pages. There is no head-up
 * display in an F-35 — that job belongs to the helmet.
 */
function panoramicDisplayTexture() {
  return canvasTexture(2048, 768, (context, width, height) => {
    context.fillStyle = "#05090c";
    context.fillRect(0, 0, width, height);

    const panel = (x, w, title) => {
      context.strokeStyle = "#1d3b46";
      context.lineWidth = 3;
      context.strokeRect(x, 12, w, height - 24);
      context.fillStyle = "#3ec6a4";
      context.font = "600 26px 'Barlow Condensed', Arial";
      context.fillText(title, x + 16, 48);
    };

    // Left: tactical situation display.
    panel(16, 640, "TSD");
    context.strokeStyle = "#1f4e46";
    context.lineWidth = 2;
    for (let r = 80; r < 340; r += 80) {
      context.beginPath();
      context.arc(336, 430, r, 0, Math.PI * 2);
      context.stroke();
    }
    context.fillStyle = "#5be0b4";
    context.beginPath();
    context.moveTo(336, 400);
    context.lineTo(322, 452);
    context.lineTo(350, 452);
    context.closePath();
    context.fill();
    context.fillStyle = "#d8f36a";
    [[236, 300], [430, 350], [400, 540]].forEach(([x, y]) => {
      context.beginPath();
      context.moveTo(x, y - 12);
      context.lineTo(x + 12, y);
      context.lineTo(x, y + 12);
      context.lineTo(x - 12, y);
      context.closePath();
      context.fill();
    });

    // Centre: primary flight display with attitude ball and tapes.
    panel(672, 700, "PFD");
    const cx = 1022;
    const cy = 400;
    context.save();
    context.beginPath();
    context.rect(742, 120, 560, 500);
    context.clip();
    context.fillStyle = "#2a6ea8";
    context.fillRect(742, 120, 560, 280);
    context.fillStyle = "#6b4a2c";
    context.fillRect(742, 400, 560, 220);
    context.strokeStyle = "#eef4f6";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(742, 400);
    context.lineTo(1302, 400);
    context.stroke();
    context.lineWidth = 2;
    for (let p = -3; p <= 3; p += 1) {
      if (!p) continue;
      const y = cy - p * 52;
      const w = p % 2 ? 44 : 88;
      context.beginPath();
      context.moveTo(cx - w, y);
      context.lineTo(cx + w, y);
      context.stroke();
    }
    context.restore();
    // Fixed aircraft symbol.
    context.strokeStyle = "#f7e04b";
    context.lineWidth = 6;
    context.beginPath();
    context.moveTo(cx - 90, cy);
    context.lineTo(cx - 30, cy);
    context.moveTo(cx + 30, cy);
    context.lineTo(cx + 90, cy);
    context.moveTo(cx - 8, cy);
    context.lineTo(cx + 8, cy);
    context.stroke();

    const tape = (x, values, label) => {
      context.fillStyle = "rgba(6,20,24,0.85)";
      context.fillRect(x, 150, 104, 500);
      context.strokeStyle = "#3ec6a4";
      context.lineWidth = 2;
      context.strokeRect(x, 150, 104, 500);
      context.fillStyle = "#c9f5e6";
      context.font = "500 30px 'Barlow Condensed', Arial";
      context.textAlign = "center";
      values.forEach((value, i) => context.fillText(value, x + 52, 210 + i * 62));
      context.fillStyle = "#3ec6a4";
      context.font = "600 22px 'Barlow Condensed', Arial";
      context.fillText(label, x + 52, 178);
      context.textAlign = "left";
    };
    tape(700, ["420", "400", "380", "360", "340", "320"], "KCAS");
    tape(1268, ["24", "22", "20", "18", "16", "14"], "ALT");

    // Right: engine and stores.
    panel(1388, 644, "ENG / STORES");
    context.fillStyle = "#3ec6a4";
    context.font = "500 30px 'Barlow Condensed', Arial";
    ["FAN 96%", "N2 101%", "FTIT 742 C", "FUEL 12 480 LB", "NOZ 34%"].forEach((row, i) => {
      context.fillText(row, 1416, 130 + i * 54);
    });
    context.strokeStyle = "#25525c";
    context.strokeRect(1416, 420, 580, 180);
    context.fillStyle = "#7fe3c4";
    context.font = "500 26px 'Barlow Condensed', Arial";
    ["BAY L: 2 GBU-31", "BAY R: 2 AIM-120", "GUN: 181 RDS"].forEach((row, i) => {
      context.fillText(row, 1436, 460 + i * 46);
    });
  });
}

function buildCockpit(materials) {
  const cockpit = new THREE.Group();

  // Tub: floor and side consoles that box the pilot in.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 1.9), materials.cockpit);
  floor.position.set(0, 0.08, -4.4);
  cockpit.add(floor);

  for (const side of [1, -1]) {
    const console = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.42, 1.7), materials.cockpit);
    console.position.set(side * 0.46, 0.22, -4.3);
    cockpit.add(console);
  }

  // Glareshield and the canted panel the display sits in.
  const glareshield = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.08, 0.26), materials.dark);
  glareshield.position.set(0, 0.72, -5.22);
  glareshield.rotation.x = DEG(14);
  cockpit.add(glareshield);

  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.42, 0.05), materials.dark);
  bezel.position.set(0, 0.56, -5.08);
  bezel.rotation.x = DEG(20);
  cockpit.add(bezel);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.82, 0.34),
    new THREE.MeshBasicMaterial({ map: panoramicDisplayTexture(), toneMapped: false }),
  );
  screen.position.set(0, 0.56, -5.05);
  screen.rotation.x = DEG(20);
  cockpit.add(screen);

  // Standby instrument below the main screen.
  const standby = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.16),
    new THREE.MeshBasicMaterial({ color: 0x0b2b2a, toneMapped: false }),
  );
  standby.position.set(-0.3, 0.33, -4.97);
  standby.rotation.x = DEG(26);
  cockpit.add(standby);

  // Right-hand side stick — the F-35 has no centre stick.
  const stick = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.24, 10), materials.dark);
  grip.position.y = 0.12;
  stick.add(grip);
  const stickTop = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10), materials.dark);
  stickTop.position.y = 0.24;
  stick.add(stickTop);
  stick.position.set(0.42, 0.42, -4.16);
  cockpit.add(stick);

  // Throttle on the left console.
  const throttle = new THREE.Group();
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.22), materials.dark);
  lever.position.z = -0.08;
  throttle.add(lever);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), materials.dark);
  knob.position.z = -0.19;
  throttle.add(knob);
  throttle.position.set(-0.44, 0.46, -4.20);
  throttle.userData.restZ = -4.20;
  throttle.userData.travelZ = -0.16;
  cockpit.add(throttle);

  // Rudder pedals.
  for (const side of [1, -1]) {
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.04), materials.dark);
    pedal.position.set(side * 0.16, 0.26, -5.06);
    pedal.rotation.x = DEG(-22);
    cockpit.add(pedal);
  }

  return { cockpit, stick, throttle };
}

// ---------------------------------------------------------------------------

export function buildF35Model(modelScale = 0.1) {
  const aircraft = new THREE.Group();
  aircraft.name = "F35A";
  const materials = buildMaterials();
  const controls = {};
  const gearAssemblies = [];

  const exterior = buildExterior(materials, controls, gearAssemblies);
  aircraft.add(exterior);

  const { cockpit, stick, throttle } = buildCockpit(materials);
  cockpit.visible = false;
  aircraft.add(cockpit);

  controls.sideStick = stick;
  controls.throttle = throttle;
  controls.gearAssemblies = gearAssemblies;

  aircraft.traverse((node) => {
    if (node.isMesh && node.material !== materials.canopy) node.castShadow = true;
  });

  aircraft.userData.controls = controls;
  aircraft.userData.exterior = exterior;
  aircraft.userData.cockpitInterior = cockpit;
  // Pilot's eye, under the canopy and looking out over the radome.
  aircraft.userData.cockpitEye = new THREE.Vector3(0, 0.95, -4.42);
  aircraft.userData.cockpitLook = new THREE.Vector3(0, -2.6, -30);
  aircraft.userData.modelScale = modelScale;

  aircraft.rotation.order = "YXZ";
  aircraft.scale.setScalar(modelScale);
  return aircraft;
}

export const F35_LENGTH_METRES = LENGTH;
