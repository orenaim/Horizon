import * as THREE from "three";
import { buildC172Exterior, buildMaterials } from "./c172-exterior.js";

const DEG = THREE.MathUtils.degToRad;

function canvasTexture(width, height, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  draw(context, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function makeLoft(rings, material, radialSegments = 32) {
  const vertices = [];
  const indices = [];

  rings.forEach((ring) => {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = segment / radialSegments * Math.PI * 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const shapedX = Math.sign(cosine) * Math.abs(cosine) ** (ring.sidePower ?? 1);
      vertices.push(
        shapedX * ring.rx,
        ring.y + sine * ring.ry,
        ring.z,
      );
    }
  });

  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments;
      const a = ring * radialSegments + segment;
      const b = ring * radialSegments + next;
      const c = (ring + 1) * radialSegments + next;
      const d = (ring + 1) * radialSegments + segment;
      indices.push(a, b, d, b, c, d);
    }
  }

  const frontCenter = vertices.length / 3;
  vertices.push(0, rings[0].y, rings[0].z);
  const rearCenter = vertices.length / 3;
  vertices.push(0, rings.at(-1).y, rings.at(-1).z);
  for (let segment = 0; segment < radialSegments; segment += 1) {
    const next = (segment + 1) % radialSegments;
    indices.push(frontCenter, next, segment);
    const rearStart = (rings.length - 1) * radialSegments;
    indices.push(rearCenter, rearStart + segment, rearStart + next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeAirfoilPanel({
  side,
  inner,
  outer,
  rootLeading,
  rootTrailing,
  tipLeading,
  tipTrailing,
  rootY,
  tipY,
  rootThickness,
  tipThickness,
  material,
  spanSegments = 8,
  chordSegments = 12,
}) {
  const vertices = [];
  const indices = [];
  const row = chordSegments + 1;

  for (let spanIndex = 0; spanIndex <= spanSegments; spanIndex += 1) {
    const spanT = spanIndex / spanSegments;
    const x = side * THREE.MathUtils.lerp(inner, outer, spanT);
    const leading = THREE.MathUtils.lerp(rootLeading, tipLeading, spanT);
    const trailing = THREE.MathUtils.lerp(rootTrailing, tipTrailing, spanT);
    const y = THREE.MathUtils.lerp(rootY, tipY, spanT);
    const thickness = THREE.MathUtils.lerp(rootThickness, tipThickness, spanT);

    for (let chordIndex = 0; chordIndex <= chordSegments; chordIndex += 1) {
      const chordT = chordIndex / chordSegments;
      const profile = Math.sin(Math.PI * chordT) ** 0.72;
      const camber = Math.sin(Math.PI * chordT) * thickness * 0.12;
      const z = THREE.MathUtils.lerp(leading, trailing, chordT);
      vertices.push(x, y + camber + profile * thickness * 0.5, z);
    }
    for (let chordIndex = 0; chordIndex <= chordSegments; chordIndex += 1) {
      const chordT = chordIndex / chordSegments;
      const profile = Math.sin(Math.PI * chordT) ** 0.72;
      const camber = Math.sin(Math.PI * chordT) * thickness * 0.12;
      const z = THREE.MathUtils.lerp(leading, trailing, chordT);
      vertices.push(x, y + camber - profile * thickness * 0.5, z);
    }
  }

  const surfaceSize = (spanSegments + 1) * row;
  const upper = (span, chord) => span * row + chord;
  const lower = (span, chord) => surfaceSize + span * row + chord;

  for (let span = 0; span < spanSegments; span += 1) {
    for (let chord = 0; chord < chordSegments; chord += 1) {
      const a = upper(span, chord);
      const b = upper(span + 1, chord);
      const c = upper(span + 1, chord + 1);
      const d = upper(span, chord + 1);
      indices.push(a, b, d, b, c, d);

      const la = lower(span, chord);
      const lb = lower(span, chord + 1);
      const lc = lower(span + 1, chord + 1);
      const ld = lower(span + 1, chord);
      indices.push(la, lb, ld, lb, lc, ld);
    }
  }

  for (let span = 0; span < spanSegments; span += 1) {
    indices.push(
      upper(span, 0), lower(span, 0), upper(span + 1, 0),
      lower(span, 0), lower(span + 1, 0), upper(span + 1, 0),
      upper(span, chordSegments), upper(span + 1, chordSegments), lower(span, chordSegments),
      lower(span, chordSegments), upper(span + 1, chordSegments), lower(span + 1, chordSegments),
    );
  }

  for (const span of [0, spanSegments]) {
    for (let chord = 0; chord < chordSegments; chord += 1) {
      if (span === 0) {
        indices.push(upper(span, chord), upper(span, chord + 1), lower(span, chord));
        indices.push(lower(span, chord), upper(span, chord + 1), lower(span, chord + 1));
      } else {
        indices.push(upper(span, chord), lower(span, chord), upper(span, chord + 1));
        indices.push(lower(span, chord), lower(span, chord + 1), upper(span, chord + 1));
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makePlanformPrism(points, thickness, material) {
  const vertices = [];
  const indices = [];
  points.forEach(([x, z]) => vertices.push(x, thickness * 0.5, z));
  points.forEach(([x, z]) => vertices.push(x, -thickness * 0.5, z));
  const count = points.length;

  for (let index = 1; index < count - 1; index += 1) {
    indices.push(0, index, index + 1);
    indices.push(count, count + index + 1, count + index);
  }
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(index, count + index, next);
    indices.push(next, count + index, count + next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

function makeVerticalPrism(points, thickness, material) {
  const vertices = [];
  const indices = [];
  points.forEach(([z, y]) => vertices.push(thickness * 0.5, y, z));
  points.forEach(([z, y]) => vertices.push(-thickness * 0.5, y, z));
  const count = points.length;

  for (let index = 1; index < count - 1; index += 1) {
    indices.push(0, index + 1, index);
    indices.push(count, count + index, count + index + 1);
  }
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(index, next, count + index);
    indices.push(next, count + next, count + index);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

function tubeBetween(parent, start, end, radius, material, segments = 10) {
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), segments),
    material,
  );
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeSideShape(points, material, side, x) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  points.slice(1).forEach(([z, y]) => shape.lineTo(z, y));
  shape.closePath();
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
  mesh.rotation.y = side * Math.PI / 2;
  mesh.position.x = side * x;
  return mesh;
}

function makeTextPlacard(text, foreground, background = null, fontSize = 54) {
  const texture = canvasTexture(512, 128, (context, width, height) => {
    context.clearRect(0, 0, width, height);
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
    }
    context.fillStyle = foreground;
    context.font = `700 ${fontSize}px "Arial Narrow", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, width / 2, height / 2 + 3);
  });
  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: !background,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function gaugeTexture(kind, value = 0) {
  return canvasTexture(192, 192, (context, width, height) => {
    const center = width / 2;
    context.fillStyle = "#101416";
    context.fillRect(0, 0, width, height);

    if (kind === "ATTITUDE") {
      context.save();
      context.beginPath();
      context.arc(center, center, 79, 0, Math.PI * 2);
      context.clip();
      context.fillStyle = "#438eb0";
      context.fillRect(0, 0, width, center);
      context.fillStyle = "#72513a";
      context.fillRect(0, center, width, center);
      context.strokeStyle = "#f4f0d5";
      context.lineWidth = 5;
      context.beginPath();
      context.moveTo(10, center);
      context.lineTo(width - 10, center);
      context.stroke();
      context.restore();
    }

    context.strokeStyle = "#d8ded6";
    context.fillStyle = "#d8ded6";
    context.lineCap = "round";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "700 15px sans-serif";
    for (let tick = 0; tick < 36; tick += 1) {
      const angle = tick / 36 * Math.PI * 2 - Math.PI / 2;
      const inner = tick % 3 === 0 ? 67 : 73;
      context.lineWidth = tick % 3 === 0 ? 3 : 1.5;
      context.beginPath();
      context.moveTo(center + Math.cos(angle) * inner, center + Math.sin(angle) * inner);
      context.lineTo(center + Math.cos(angle) * 80, center + Math.sin(angle) * 80);
      context.stroke();
    }

    if (kind !== "ATTITUDE") {
      const angle = DEG(value - 90);
      context.strokeStyle = "#f2f0df";
      context.lineWidth = 5;
      context.beginPath();
      context.moveTo(center - Math.cos(angle) * 14, center - Math.sin(angle) * 14);
      context.lineTo(center + Math.cos(angle) * 58, center + Math.sin(angle) * 58);
      context.stroke();
      context.fillStyle = "#e95e34";
      context.beginPath();
      context.arc(center, center, 7, 0, Math.PI * 2);
      context.fill();
    } else {
      context.strokeStyle = "#f0b43d";
      context.lineWidth = 5;
      context.beginPath();
      context.moveTo(43, center);
      context.lineTo(78, center);
      context.lineTo(center, center + 9);
      context.lineTo(114, center);
      context.lineTo(149, center);
      context.stroke();
    }

    context.fillStyle = "#eef0e8";
    context.font = "700 12px sans-serif";
    context.fillText(kind, center, 145);
  });
}

function radioTexture(label, digits) {
  return canvasTexture(384, 96, (context, width, height) => {
    context.fillStyle = "#111517";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#aaa99e";
    context.font = "700 19px sans-serif";
    context.textAlign = "left";
    context.fillText(label, 20, 25);
    context.fillStyle = "#ef9d42";
    context.font = "700 31px monospace";
    context.fillText(digits, 78, 68);
    context.fillStyle = "#4c5558";
    for (let x = 24; x < width; x += 68) {
      context.beginPath();
      context.arc(x, 70, 6, 0, Math.PI * 2);
      context.fill();
    }
  });
}

function panelPlateTexture() {
  return canvasTexture(1024, 640, (context, width, height) => {
    context.clearRect(0, 0, width, height);

    const label = (text, x, y, size = 13, align = "center", color = "#d8d7ce") => {
      context.fillStyle = color;
      context.font = `700 ${size}px "Arial Narrow", sans-serif`;
      context.textAlign = align;
      context.textBaseline = "middle";
      context.fillText(text, x, y);
    };

    context.fillStyle = "rgba(28, 30, 30, 0.96)";
    context.fillRect(8, 475, width - 16, 150);
    context.strokeStyle = "#8b8e8b";
    context.lineWidth = 2;
    context.strokeRect(10, 476, width - 20, 148);

    context.strokeStyle = "rgba(25, 28, 29, 0.72)";
    context.lineWidth = 3;
    context.strokeRect(18, 18, 970, 438);
    context.beginPath();
    context.moveTo(690, 28);
    context.lineTo(690, 455);
    context.stroke();

    label("CESSNA 172S  ·  SKYHAWK", 500, 36, 16);
    label("FLIGHT INSTRUMENTS", 265, 65, 12, "center", "#b7b8b1");
    label("AVIONICS", 615, 65, 12, "center", "#b7b8b1");
    label("ELECTRICAL / AUTOPILOT", 842, 65, 12, "center", "#b7b8b1");

    context.fillStyle = "rgba(18, 20, 21, 0.72)";
    context.fillRect(510, 85, 184, 300);
    context.fillRect(714, 85, 255, 300);
    context.strokeStyle = "#848783";
    context.lineWidth = 2;
    context.strokeRect(510, 85, 184, 300);
    context.strokeRect(714, 85, 255, 300);

    const radioRows = [
      ["COM 1", "118.30   121.90"],
      ["NAV 1", "114.60   110.50"],
      ["XPDR", "1200   ALT"],
      ["DME", "12.4 NM   095°"],
    ];
    radioRows.forEach(([name, digits], index) => {
      const top = 94 + index * 70;
      context.fillStyle = "#101415";
      context.fillRect(521, top, 162, 60);
      context.strokeStyle = "#595e5d";
      context.strokeRect(521, top, 162, 60);
      label(name, 531, top + 15, 10, "left", "#b9bbb5");
      label(digits, 602, top + 40, 16, "center", "#e29a4f");
    });

    context.fillStyle = "#101415";
    context.fillRect(727, 96, 229, 70);
    context.strokeStyle = "#595e5d";
    context.strokeRect(727, 96, 229, 70);
    label("AUTOPILOT", 741, 112, 10, "left", "#b9bbb5");
    label("HDG    NAV    APR    ALT", 842, 143, 14, "center", "#e29a4f");
    label("CIRCUIT BREAKERS", 841, 195, 10, "center", "#b9bbb5");
    context.fillStyle = "#c3c6c1";
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        context.beginPath();
        context.arc(752 + column * 27, 222 + row * 34, 7, 0, Math.PI * 2);
        context.fill();
      }
    }

    label("WARNING", 55, 102, 13, "left", "#e1b36f");
    const warningLines = [
      "CHECK FUEL QUANTITY",
      "BEFORE TAKEOFF",
      "USE FULL RICH MIXTURE",
      "BELOW 3000 FT",
      "MAX FLAP SPEED 110 KIAS",
    ];
    warningLines.forEach((text, index) => label(text, 55, 127 + index * 20, 10, "left", "#c7c7bf"));

    label("MASTER", 68, 525, 11);
    label("AVIONICS BUS 1 / 2", 210, 525, 11);
    label("LIGHTS", 402, 525, 11);
    label("PITOT HEAT", 538, 525, 11);
    label("FUEL PUMP", 645, 525, 11);
    label("CABIN AIR", 760, 525, 11);
    label("CABIN HEAT", 888, 525, 11);

    context.strokeStyle = "#adada5";
    context.lineWidth = 2;
    for (let index = 0; index < 17; index += 1) {
      const x = 46 + index * 57;
      context.beginPath();
      context.moveTo(x, 555);
      context.lineTo(x, 595);
      context.stroke();
      context.fillStyle = index < 2 ? "#b4342e" : "#b8b9b2";
      context.fillRect(x - 8, 566, 16, 23);
    }

    context.fillStyle = "#b9bbb5";
    for (const y of [24, 448, 488, 615]) {
      for (let x = 28; x < width - 20; x += 64) {
        context.beginPath();
        context.arc(x, y, 4, 0, Math.PI * 2);
        context.fill();
      }
    }

    label("SMOKING PROHIBITED", 865, 425, 11, "center", "#c8c8c1");
  });
}

function addGauge(parent, x, y, radius, kind, value, materials) {
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.83, 32),
    new THREE.MeshBasicMaterial({ map: gaugeTexture(kind, value), toneMapped: false }),
  );
  face.position.set(x, y, -1.286);
  parent.add(face);

  const bezel = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.91, radius * 0.075, 8, 32),
    materials.bezel,
  );
  bezel.position.set(x, y, -1.28);
  parent.add(bezel);

  for (const angle of [Math.PI / 4, Math.PI * 3 / 4, Math.PI * 5 / 4, Math.PI * 7 / 4]) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.008, 8), materials.metal);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(
      x + Math.cos(angle) * radius * 1.05,
      y + Math.sin(angle) * radius * 1.05,
      -1.273,
    );
    parent.add(screw);
  }
}

function addCockpit(aircraft, materials) {
  const cockpit = new THREE.Group();
  cockpit.name = "C172 cockpit interior";
  aircraft.add(cockpit);

  const panelAssembly = new THREE.Group();
  panelAssembly.name = "C172 baked panel assembly";
  panelAssembly.scale.setScalar(0.88);
  panelAssembly.position.set(0, 0.07, -0.01);
  cockpit.add(panelAssembly);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.055, 1.32), materials.carpet);
  floor.position.set(0, -0.31, -0.47);
  cockpit.add(floor);

  // The pilot sits just ahead of the wing leading edge. Keep the broad roof
  // liner behind the eye point so the first-person view opens onto the
  // windshield instead of looking into the underside of a ceiling slab.
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.028, 0.58), materials.headliner);
  ceiling.position.set(0, 0.585, -0.28);
  cockpit.add(ceiling);

  const panelShape = new THREE.Shape();
  panelShape.moveTo(-0.355, -0.225);
  panelShape.lineTo(-0.355, 0.205);
  panelShape.quadraticCurveTo(-0.31, 0.325, -0.21, 0.335);
  panelShape.lineTo(0.21, 0.335);
  panelShape.quadraticCurveTo(0.31, 0.325, 0.355, 0.205);
  panelShape.lineTo(0.355, -0.225);
  panelShape.closePath();
  const panelGeometry = new THREE.ExtrudeGeometry(panelShape, {
    depth: 0.065,
    bevelEnabled: true,
    bevelSize: 0.014,
    bevelThickness: 0.012,
    bevelSegments: 3,
  });
  panelGeometry.center();
  const panel = new THREE.Mesh(panelGeometry, materials.panel);
  panel.position.set(0, 0.05, -1.345);
  panel.castShadow = true;
  panelAssembly.add(panel);

  const panelPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.67, 0.46),
    new THREE.MeshBasicMaterial({
      map: panelPlateTexture(),
      transparent: true,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  panelPlate.position.set(0, 0.045, -1.292);
  panelAssembly.add(panelPlate);

  const glareShield = new THREE.Mesh(new THREE.BoxGeometry(0.71, 0.012, 0.075), materials.glare);
  glareShield.position.set(0, 0.355, -1.325);
  glareShield.rotation.x = DEG(-4);
  panelAssembly.add(glareShield);

  const gaugeMaterials = {
    bezel: materials.bezel,
    metal: materials.metal,
  };
  // 3.125-inch flight instruments scale to roughly 0.05 model units in this
  // cabin. Their old 0.075 radius made the six-pack read like dinner plates.
  addGauge(panelAssembly, -0.265, 0.225, 0.047, "AIRSPEED", 126, gaugeMaterials);
  addGauge(panelAssembly, -0.15, 0.225, 0.047, "ATTITUDE", 0, gaugeMaterials);
  addGauge(panelAssembly, -0.035, 0.225, 0.047, "ALT", 218, gaugeMaterials);
  addGauge(panelAssembly, -0.265, 0.105, 0.047, "TURN", 90, gaugeMaterials);
  addGauge(panelAssembly, -0.15, 0.105, 0.047, "HEADING", 35, gaugeMaterials);
  addGauge(panelAssembly, -0.035, 0.105, 0.047, "VSI", 96, gaugeMaterials);
  addGauge(panelAssembly, -0.265, -0.01, 0.032, "FUEL", 104, gaugeMaterials);
  addGauge(panelAssembly, -0.18, -0.01, 0.032, "OIL", 72, gaugeMaterials);

  const annunciatorMaterial = makeTextPlacard("OIL  VOLTS  VAC", "#f6a23f", "#161a1b", 37);
  const annunciator = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.038), annunciatorMaterial);
  annunciator.scale.setScalar(0.72);
  annunciator.position.set(-0.105, 0.325, -1.272);
  panelAssembly.add(annunciator);

  const switchStrip = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.105, 0.045), materials.lowerPanel);
  switchStrip.position.set(0, -0.205, -1.302);
  panelAssembly.add(switchStrip);
  for (let index = 0; index < 10; index += 1) {
    const toggle = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.05, 8), materials.metal);
    toggle.rotation.x = DEG(70);
    toggle.position.set(-0.275 + index * 0.061, -0.193, -1.245);
    panelAssembly.add(toggle);
  }

  const makeYoke = (x, name) => {
    const yoke = new THREE.Group();
    yoke.name = name;
    yoke.position.set(x, 0.01, -1.19);
    tubeBetween(yoke, new THREE.Vector3(0, 0, -0.16), new THREE.Vector3(0, 0, 0.025), 0.011, materials.yoke, 12);
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.046, 0.034), materials.yoke);
    hub.position.z = 0.025;
    yoke.add(hub);
    tubeBetween(yoke, new THREE.Vector3(-0.03, 0.015, 0.03), new THREE.Vector3(-0.077, 0.075, 0.03), 0.009, materials.yoke, 12);
    tubeBetween(yoke, new THREE.Vector3(0.03, 0.015, 0.03), new THREE.Vector3(0.077, 0.075, 0.03), 0.009, materials.yoke, 12);
    tubeBetween(yoke, new THREE.Vector3(-0.077, 0.075, 0.03), new THREE.Vector3(-0.105, -0.006, 0.03), 0.011, materials.yoke, 12);
    tubeBetween(yoke, new THREE.Vector3(0.077, 0.075, 0.03), new THREE.Vector3(0.105, -0.006, 0.03), 0.011, materials.yoke, 12);
    panelAssembly.add(yoke);
    return yoke;
  };
  const yokeL = makeYoke(-0.19, "yokeL");
  const yokeR = makeYoke(0.19, "yokeR");

  const centerConsole = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.24, 0.35), materials.console);
  centerConsole.position.set(0, -0.345, -1.0);
  centerConsole.rotation.x = DEG(-11);
  panelAssembly.add(centerConsole);
  const trimWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.025, 24), materials.trim);
  trimWheel.rotation.z = Math.PI / 2;
  trimWheel.position.set(0.064, -0.29, -0.98);
  panelAssembly.add(trimWheel);

  const makePushPull = (x, color, name) => {
    const control = new THREE.Group();
    control.name = name;
    control.position.set(x, -0.125, -1.255);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 8), materials.metal);
    stem.rotation.x = Math.PI / 2;
    stem.position.z = 0.038;
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.02, 16), color);
    knob.rotation.x = Math.PI / 2;
    knob.position.z = 0.085;
    control.add(stem, knob);
    panelAssembly.add(control);
    return control;
  };
  const throttle = makePushPull(0.09, materials.throttle, "throttleControl");
  makePushPull(0.16, materials.mixture, "mixtureControl");

  for (const x of [-0.19, 0.19]) {
    for (const pedalX of [-0.055, 0.055]) {
      const armStart = new THREE.Vector3(x + pedalX, -0.29, -1.24);
      const armEnd = new THREE.Vector3(x + pedalX, -0.22, -1.36);
      tubeBetween(cockpit, armStart, armEnd, 0.01, materials.metal, 8);
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, 0.09), materials.pedal);
      pedal.position.copy(armEnd);
      pedal.rotation.x = DEG(-28);
      cockpit.add(pedal);
    }
  }

  const seatCushion = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.1, 0.35), materials.seat);
  seatCushion.position.set(0.19, -0.21, -0.55);
  seatCushion.rotation.x = DEG(-4);
  cockpit.add(seatCushion);
  const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.45, 0.095), materials.seat);
  seatBack.position.set(0.19, 0.03, -0.35);
  seatBack.rotation.x = DEG(-8);
  cockpit.add(seatBack);
  const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.15, 0.1), materials.seat);
  headrest.position.set(0.19, 0.32, -0.29);
  cockpit.add(headrest);

  const sidePanelGeometry = new THREE.BoxGeometry(0.035, 0.35, 0.85);
  for (const side of [-1, 1]) {
    const sidePanel = new THREE.Mesh(sidePanelGeometry, materials.sidePanel);
    sidePanel.position.set(side * 0.33, -0.08, -0.5);
    cockpit.add(sidePanel);
    const armRest = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.055, 0.39), materials.armrest);
    armRest.position.set(side * 0.31, -0.02, -0.48);
    cockpit.add(armRest);
  }

  const framePoints = [
    [new THREE.Vector3(-0.34, 0.03, -1.33), new THREE.Vector3(-0.31, 0.58, -1.08)],
    [new THREE.Vector3(0.34, 0.03, -1.33), new THREE.Vector3(0.31, 0.58, -1.08)],
    [new THREE.Vector3(0, 0.35, -1.38), new THREE.Vector3(0, 0.58, -1.08)],
  ];
  framePoints.forEach(([start, end]) => tubeBetween(cockpit, start, end, 0.0045, materials.headliner, 10));
  tubeBetween(cockpit, new THREE.Vector3(-0.33, 0.58, -1.08), new THREE.Vector3(0.33, 0.58, -1.08), 0.006, materials.headliner, 10);

  const compassBody = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.04, 18), materials.bezel);
  compassBody.rotation.x = Math.PI / 2;
  compassBody.position.set(0, 0.47, -1.24);
  cockpit.add(compassBody);
  const compassFace = new THREE.Mesh(
    new THREE.CircleGeometry(0.022, 24),
    new THREE.MeshBasicMaterial({ map: gaugeTexture("HDG", 34), toneMapped: false }),
  );
  compassFace.position.set(0, 0.47, -1.217);
  cockpit.add(compassFace);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.009, 0.085), materials.visor);
  visor.position.set(-0.17, 0.53, -1.12);
  visor.rotation.x = DEG(8);
  cockpit.add(visor);

  aircraft.userData.cockpitInterior = cockpit;
  aircraft.userData.cockpitEye = new THREE.Vector3(-0.17, 0.5, -0.78);
  aircraft.userData.cockpitLook = new THREE.Vector3(-0.17, 0.56, -8);
  return { yokeL, yokeR, throttle };
}


// The cockpit above is authored in the model's original units. The exterior is
// now built in metres, so the interior is fitted to it rather than re-authored:
// the scale comes from the 172's real 1.0 m cabin width against the interior's
// authored 0.696 units, and the offset drops its roof under the cabin roof.
const COCKPIT_UNIT_METRES = 1.437;
const COCKPIT_DROP = -0.09;

export function buildC172Model(modelScale = 0.1) {
  const aircraft = new THREE.Group();
  aircraft.name = "C172S Skyhawk";

  const materials = {
    white: new THREE.MeshPhysicalMaterial({
      color: 0xf0eee7,
      roughness: 0.27,
      metalness: 0.06,
      clearcoat: 0.72,
      clearcoatRoughness: 0.2,
    }),
    offWhite: new THREE.MeshPhysicalMaterial({
      color: 0xdedbd2,
      roughness: 0.36,
      metalness: 0.08,
      clearcoat: 0.35,
    }),
    navy: new THREE.MeshStandardMaterial({ color: 0x163b52, roughness: 0.34 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xce5c2b, roughness: 0.36 }),
    black: new THREE.MeshStandardMaterial({ color: 0x171b1d, roughness: 0.82 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x171a1a, roughness: 0.94 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xaeb5b4, roughness: 0.24, metalness: 0.76 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x333a3c, roughness: 0.28, metalness: 0.68 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x9abac1,
      roughness: 0.08,
      metalness: 0.02,
      transmission: 0.62,
      thickness: 0.025,
      transparent: true,
      opacity: 0.42,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      side: THREE.DoubleSide,
    }),
    redLight: new THREE.MeshBasicMaterial({ color: 0xff3426, toneMapped: false }),
    greenLight: new THREE.MeshBasicMaterial({ color: 0x38f196, toneMapped: false }),
    clearLight: new THREE.MeshBasicMaterial({ color: 0xeafaff, toneMapped: false }),
    panel: new THREE.MeshStandardMaterial({ color: 0x5a5c5b, roughness: 0.76, side: THREE.DoubleSide }),
    lowerPanel: new THREE.MeshStandardMaterial({ color: 0x171a1b, roughness: 0.83 }),
    glare: new THREE.MeshStandardMaterial({ color: 0x101213, roughness: 0.96 }),
    radio: new THREE.MeshStandardMaterial({ color: 0x111415, roughness: 0.82 }),
    bezel: new THREE.MeshStandardMaterial({ color: 0x111415, roughness: 0.37, metalness: 0.42 }),
    carpet: new THREE.MeshStandardMaterial({ color: 0x262827, roughness: 1 }),
    headliner: new THREE.MeshStandardMaterial({ color: 0xb7afa1, roughness: 0.95 }),
    console: new THREE.MeshStandardMaterial({ color: 0x171918, roughness: 0.86 }),
    yoke: new THREE.MeshStandardMaterial({ color: 0x2b3031, roughness: 0.66, metalness: 0.12 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x242626, roughness: 0.92 }),
    throttle: new THREE.MeshStandardMaterial({ color: 0x151616, roughness: 0.72 }),
    mixture: new THREE.MeshStandardMaterial({ color: 0xbe382c, roughness: 0.55 }),
    pedal: new THREE.MeshStandardMaterial({ color: 0x3b4243, roughness: 0.65, metalness: 0.3 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x6f675d, roughness: 0.9 }),
    sidePanel: new THREE.MeshStandardMaterial({ color: 0x928a7d, roughness: 0.93 }),
    armrest: new THREE.MeshStandardMaterial({ color: 0x4c4944, roughness: 0.9 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x5e7777, transparent: true, opacity: 0.38, roughness: 0.2 }),
  };

  const { exterior, controls } = buildC172Exterior(buildMaterials());
  aircraft.add(exterior);

  const cabin = new THREE.Group();
  cabin.scale.setScalar(COCKPIT_UNIT_METRES);
  cabin.position.y = COCKPIT_DROP;
  const cockpitControls = addCockpit(cabin, materials);
  aircraft.add(cabin);

  aircraft.userData.cockpitInterior = cabin.userData.cockpitInterior;
  aircraft.userData.cockpitEye = cabin.userData.cockpitEye.clone()
    .multiplyScalar(COCKPIT_UNIT_METRES).add(new THREE.Vector3(0, COCKPIT_DROP, 0));
  // Sit the gaze 6° below level. Level puts the panel off the bottom of the
  // frame; this is roughly what you get over a 172's glareshield, with the
  // six-pack along the bottom and the horizon in the upper third.
  const gazeReach = 10.4;
  aircraft.userData.cockpitLook = aircraft.userData.cockpitEye.clone().add(
    new THREE.Vector3(0, -Math.tan(DEG(6)) * gazeReach, -gazeReach),
  );

  aircraft.userData.controls = {
    ...controls,
    yokeL: cockpitControls.yokeL,
    yokeR: cockpitControls.yokeR,
    throttle: cockpitControls.throttle,
  };
  aircraft.userData.exterior = exterior;
  aircraft.userData.modelScale = modelScale;
  aircraft.rotation.order = "YXZ";
  aircraft.traverse((node) => {
    if (node.isMesh && !node.material.transparent) node.castShadow = true;
  });
  aircraft.scale.setScalar(modelScale);
  return aircraft;
}
