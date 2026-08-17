import * as THREE from "three";

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

function makeLoft(rings, material, radialSegments = 40) {
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
  spanSegments = 12,
  chordSegments = 14,
}) {
  const vertices = [];
  const indices = [];
  const row = chordSegments + 1;

  for (const lower of [false, true]) {
    for (let spanIndex = 0; spanIndex <= spanSegments; spanIndex += 1) {
      const spanT = spanIndex / spanSegments;
      const x = side * THREE.MathUtils.lerp(inner, outer, spanT);
      const leading = THREE.MathUtils.lerp(rootLeading, tipLeading, spanT);
      const trailing = THREE.MathUtils.lerp(rootTrailing, tipTrailing, spanT);
      const y = THREE.MathUtils.lerp(rootY, tipY, spanT);
      const thickness = THREE.MathUtils.lerp(rootThickness, tipThickness, spanT);
      for (let chordIndex = 0; chordIndex <= chordSegments; chordIndex += 1) {
        const chordT = chordIndex / chordSegments;
        const profile = Math.sin(Math.PI * chordT) ** 0.7;
        const camber = Math.sin(Math.PI * chordT) * thickness * 0.08;
        const z = THREE.MathUtils.lerp(leading, trailing, chordT);
        vertices.push(
          x,
          y + camber + profile * thickness * (lower ? -0.5 : 0.5),
          z,
        );
      }
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

function makeQuad(points, material) {
  const vertices = points.flatMap((point) => point.toArray());
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function makeSidePanel(points, material, side, x) {
  const vertices = points.flatMap(([z, y]) => [side * x, y, z]);
  const indices = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    indices.push(0, index, index + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
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

function makeControlSurface(name, points, hingeZ, y, thickness, material) {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.set(0, y, hingeZ);
  const surface = makePlanformPrism(
    points.map(([x, z]) => [x, z - hingeZ]),
    thickness,
    material.clone(),
  );
  surface.material.side = THREE.DoubleSide;
  pivot.add(surface);
  return pivot;
}

function makeVerticalControl(name, points, hingeZ, thickness, material) {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.z = hingeZ;
  const surface = makeVerticalPrism(
    points.map(([z, y]) => [z - hingeZ, y]),
    thickness,
    material.clone(),
  );
  surface.material.side = THREE.DoubleSide;
  pivot.add(surface);
  return pivot;
}

function addRoundedWindow(parent, side, x, y, z, width, height, material) {
  const window = new THREE.Mesh(new THREE.CircleGeometry(1, 28), material);
  window.rotation.y = side * Math.PI / 2;
  window.scale.set(width * 0.5, height * 0.5, 1);
  window.position.set(side * x, y, z);
  parent.add(window);
  return window;
}

function addWheel(parent, x, y, z, radius, width, materials) {
  const wheel = new THREE.Group();
  wheel.position.set(x, y, z);
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 20, 1),
    materials.rubber,
  );
  tire.rotation.z = Math.PI / 2;
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, width * 1.03, 18),
    materials.metal,
  );
  hub.rotation.z = Math.PI / 2;
  wheel.add(tire, hub);
  parent.add(wheel);
  return wheel;
}

function pfdTexture(course) {
  return canvasTexture(640, 480, (context, width, height) => {
    context.fillStyle = "#071218";
    context.fillRect(0, 0, width, height);

    const horizonY = 205;
    context.fillStyle = "#2787bd";
    context.fillRect(82, 30, width - 164, horizonY - 30);
    context.fillStyle = "#86653f";
    context.fillRect(82, horizonY, width - 164, 145);
    context.strokeStyle = "#f3f0df";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(82, horizonY);
    context.lineTo(width - 82, horizonY);
    context.stroke();

    context.strokeStyle = "rgba(255,255,255,.82)";
    context.fillStyle = "#f4f1dc";
    context.font = "600 18px Arial";
    context.textAlign = "center";
    for (let offset = -80; offset <= 80; offset += 20) {
      if (offset === 0) continue;
      const lineWidth = offset % 40 === 0 ? 82 : 46;
      context.beginPath();
      context.moveTo(width / 2 - lineWidth / 2, horizonY + offset);
      context.lineTo(width / 2 + lineWidth / 2, horizonY + offset);
      context.stroke();
      context.fillText(String(Math.abs(offset / 2)), width / 2 + lineWidth / 2 + 19, horizonY + offset + 5);
    }

    context.fillStyle = "#121b20";
    context.fillRect(0, 28, 75, 325);
    context.fillRect(width - 75, 28, 75, 325);
    context.fillStyle = "#f4f1dc";
    context.font = "700 21px Arial";
    context.textAlign = "center";
    for (let index = 0; index < 7; index += 1) {
      context.fillText(String(100 + index * 10), 38, 70 + index * 42);
      context.fillText(String(7800 - index * 100), width - 38, 70 + index * 42);
    }

    context.fillStyle = "#0e181d";
    context.fillRect(0, 356, width, 124);
    context.strokeStyle = "#55b5df";
    context.lineWidth = 4;
    context.beginPath();
    context.arc(width / 2, 434, 72, Math.PI, Math.PI * 2);
    context.stroke();
    context.fillStyle = "#f5f1dc";
    context.font = "700 23px Arial";
    context.fillText(`${course.toString().padStart(3, "0")}°`, width / 2, 422);

    context.strokeStyle = "#ffd34e";
    context.lineWidth = 6;
    context.beginPath();
    context.moveTo(width / 2 - 54, horizonY + 8);
    context.lineTo(width / 2 - 15, horizonY + 8);
    context.lineTo(width / 2, horizonY + 22);
    context.lineTo(width / 2 + 15, horizonY + 8);
    context.lineTo(width / 2 + 54, horizonY + 8);
    context.stroke();

    context.fillStyle = "#d9edf3";
    context.font = "700 17px Arial";
    context.textAlign = "left";
    context.fillText("GARMIN", 12, 21);
    context.textAlign = "right";
    context.fillText("OAT 26°C", width - 12, 21);
  });
}

function mfdTexture() {
  return canvasTexture(640, 480, (context, width, height) => {
    context.fillStyle = "#071218";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#174b43";
    context.beginPath();
    context.moveTo(95, 70);
    context.bezierCurveTo(190, 20, 300, 92, 360, 55);
    context.bezierCurveTo(455, 10, 535, 96, 555, 180);
    context.bezierCurveTo(575, 260, 510, 345, 404, 330);
    context.bezierCurveTo(330, 318, 270, 402, 170, 350);
    context.bezierCurveTo(70, 298, 42, 153, 95, 70);
    context.fill();
    context.strokeStyle = "#3a967b";
    context.lineWidth = 2;
    context.stroke();

    context.strokeStyle = "#65c8ef";
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(80, 386);
    context.bezierCurveTo(190, 300, 280, 282, 350, 190);
    context.bezierCurveTo(410, 112, 475, 115, 560, 65);
    context.stroke();
    context.fillStyle = "#f6cf4f";
    for (const [x, y] of [[115, 360], [245, 296], [350, 190], [470, 116], [555, 67]]) {
      context.beginPath();
      context.arc(x, y, 7, 0, Math.PI * 2);
      context.fill();
    }

    context.fillStyle = "#0d171b";
    context.fillRect(0, 0, 112, height);
    context.fillStyle = "#f1eee0";
    context.font = "700 18px Arial";
    context.fillText("ENGINE", 18, 28);
    const gauges = [
      ["TRQ", 92, "#70d7f2"],
      ["ITT", 768, "#f7d54f"],
      ["NG", 101, "#70d7f2"],
      ["FUEL", 62, "#74d89c"],
    ];
    gauges.forEach(([label, value, color], index) => {
      const y = 84 + index * 92;
      context.fillStyle = "#c9d5d8";
      context.font = "600 15px Arial";
      context.fillText(label, 14, y - 23);
      context.strokeStyle = color;
      context.lineWidth = 7;
      context.beginPath();
      context.arc(58, y, 32, Math.PI * 0.78, Math.PI * 2.22);
      context.stroke();
      context.fillStyle = "#f4f0df";
      context.font = "700 19px Arial";
      context.textAlign = "center";
      context.fillText(String(value), 58, y + 7);
      context.textAlign = "left";
    });
    context.fillStyle = "#e9f1ef";
    context.font = "700 17px Arial";
    context.textAlign = "right";
    context.fillText("PHNL  08L", width - 16, height - 18);
  });
}

function touchscreenTexture(label) {
  return canvasTexture(480, 260, (context, width, height) => {
    context.fillStyle = "#091419";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#d8e4e7";
    context.font = "700 20px Arial";
    context.fillText(label, 18, 28);
    const entries = [
      ["MAP", "#2a7897"],
      ["FLIGHT PLAN", "#1f586e"],
      ["WEATHER", "#765f2b"],
      ["SYSTEMS", "#235d4d"],
      ["AUDIO", "#4c4e56"],
      ["TRANSPONDER", "#4d365b"],
    ];
    entries.forEach(([text, color], index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = 15 + column * 152;
      const y = 48 + row * 92;
      context.fillStyle = color;
      context.fillRect(x, y, 140, 78);
      context.fillStyle = "#f4f1e5";
      context.font = "700 14px Arial";
      context.textAlign = "center";
      context.fillText(text, x + 70, y + 46);
    });
  });
}

function placardTexture(text) {
  return canvasTexture(640, 128, (context, width, height) => {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#17364d";
    context.font = "italic 700 66px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, width / 2, height / 2);
  });
}

function addCockpit(aircraft, materials) {
  const cockpit = new THREE.Group();
  cockpit.name = "TBM 930 cockpit interior";
  aircraft.add(cockpit);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.055, 2.1), materials.carpet);
  floor.position.set(0, -0.34, -0.92);
  cockpit.add(floor);

  const sidewallGeometry = new THREE.BoxGeometry(0.045, 0.42, 1.1);
  for (const side of [-1, 1]) {
    const sidewall = new THREE.Mesh(sidewallGeometry, materials.cabin);
    sidewall.position.set(side * 0.405, -0.11, -0.76);
    cockpit.add(sidewall);
    const armrest = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.075, 0.62), materials.leather);
    armrest.position.set(side * 0.37, -0.13, -0.62);
    cockpit.add(armrest);
  }

  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.61, 0.12), materials.panel);
  panel.position.set(0, 0.26, -2.09);
  panel.rotation.x = DEG(-2);
  cockpit.add(panel);

  for (const side of [-1, 1]) {
    const sideConsole = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.34, 0.4),
      materials.panel,
    );
    sideConsole.position.set(side * 0.39, 0.05, -2.15);
    cockpit.add(sideConsole);
  }
  const footwellBulkhead = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.3, 0.05),
    materials.lowerPanel,
  );
  footwellBulkhead.position.set(0, -0.19, -2.04);
  cockpit.add(footwellBulkhead);

  const glareShield = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.07, 0.26), materials.glare);
  glareShield.position.set(0, 0.595, -2.0);
  glareShield.rotation.x = DEG(-5);
  cockpit.add(glareShield);

  const screenFrames = [-0.25, 0, 0.25];
  const screenTextures = [pfdTexture(82), mfdTexture(), pfdTexture(82)];
  screenFrames.forEach((x, index) => {
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.255, 0.025), materials.bezel);
    bezel.position.set(x, 0.36, -2.02);
    cockpit.add(bezel);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.214, 0.224),
      new THREE.MeshBasicMaterial({ map: screenTextures[index], toneMapped: false }),
    );
    screen.position.set(x, 0.36, -2.005);
    cockpit.add(screen);
  });

  const autopilot = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.05, 0.034), materials.bezel);
  autopilot.position.set(0, 0.535, -2.006);
  cockpit.add(autopilot);
  for (let index = 0; index < 7; index += 1) {
    const button = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.016, 0.009), materials.switch);
    button.position.set(-0.106 + index * 0.035, 0.535, -1.984);
    cockpit.add(button);
  }

  const standby = new THREE.Mesh(
    new THREE.CircleGeometry(0.035, 24),
    new THREE.MeshBasicMaterial({ map: pfdTexture(82), toneMapped: false }),
  );
  standby.position.set(-0.355, 0.535, -2.004);
  cockpit.add(standby);

  const controllerTextureL = touchscreenTexture("GTC 580 · PILOT");
  const controllerTextureR = touchscreenTexture("GTC 580 · COPILOT");
  for (const [x, texture] of [[-0.12, controllerTextureL], [0.12, controllerTextureR]]) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.215, 0.105, 0.035), materials.bezel);
    body.position.set(x, 0.152, -2.012);
    cockpit.add(body);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.195, 0.086),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    screen.position.set(x, 0.152, -1.991);
    cockpit.add(screen);
  }

  const switchPanel = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.105, 0.05), materials.lowerPanel);
  switchPanel.position.set(0, -0.015, -2.03);
  cockpit.add(switchPanel);
  for (let index = 0; index < 12; index += 1) {
    const toggle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.009, 0.042, 8),
      index < 2 ? materials.redSwitch : materials.metal,
    );
    toggle.rotation.x = DEG(72);
    toggle.position.set(-0.3 + index * 0.055, -0.005, -1.99);
    cockpit.add(toggle);
  }

  const makeYoke = (x, name) => {
    const yoke = new THREE.Group();
    yoke.name = name;
    yoke.position.set(x, 0.105, -1.78);
    tubeBetween(yoke, new THREE.Vector3(0, 0, -0.18), new THREE.Vector3(0, 0, 0.015), 0.012, materials.darkMetal, 12);
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.06, 0.045), materials.yoke);
    hub.position.z = 0.02;
    yoke.add(hub);
    tubeBetween(yoke, new THREE.Vector3(-0.028, 0.018, 0.025), new THREE.Vector3(-0.09, 0.082, 0.025), 0.012, materials.yoke, 14);
    tubeBetween(yoke, new THREE.Vector3(0.028, 0.018, 0.025), new THREE.Vector3(0.09, 0.082, 0.025), 0.012, materials.yoke, 14);
    tubeBetween(yoke, new THREE.Vector3(-0.09, 0.082, 0.025), new THREE.Vector3(-0.112, -0.025, 0.025), 0.013, materials.yoke, 14);
    tubeBetween(yoke, new THREE.Vector3(0.09, 0.082, 0.025), new THREE.Vector3(0.112, -0.025, 0.025), 0.013, materials.yoke, 14);
    cockpit.add(yoke);
    return yoke;
  };
  const yokeL = makeYoke(-0.205, "yokeL");
  const yokeR = makeYoke(0.205, "yokeR");

  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.33, 0.92), materials.console);
  pedestal.position.set(0, -0.25, -0.94);
  pedestal.rotation.x = DEG(-6);
  cockpit.add(pedestal);

  const throttle = new THREE.Group();
  throttle.name = "throttleControl";
  throttle.position.set(0, -0.115, -1.255);
  const throttleStem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.19, 10),
    materials.metal,
  );
  throttleStem.rotation.x = DEG(-24);
  const throttleGrip = new THREE.Mesh(
    new THREE.BoxGeometry(0.075, 0.055, 0.115),
    materials.throttle,
  );
  throttleGrip.position.set(0, 0.095, -0.04);
  throttleGrip.rotation.x = DEG(-8);
  throttle.add(throttleStem, throttleGrip);
  cockpit.add(throttle);

  const flapLever = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.14, 8),
    materials.metal,
  );
  flapLever.rotation.x = DEG(-24);
  flapLever.position.set(0.055, -0.17, -0.97);
  cockpit.add(flapLever);
  const flapGrip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.07), materials.switch);
  flapGrip.position.set(0.055, -0.105, -1.0);
  cockpit.add(flapGrip);

  const trimWheel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.03, 28),
    materials.trim,
  );
  trimWheel.rotation.z = Math.PI / 2;
  trimWheel.position.set(0.102, -0.27, -0.72);
  cockpit.add(trimWheel);

  for (const x of [-0.205, 0.205]) {
    for (const pedalOffset of [-0.05, 0.05]) {
      const start = new THREE.Vector3(x + pedalOffset, -0.27, -1.78);
      const end = new THREE.Vector3(x + pedalOffset, -0.2, -1.96);
      tubeBetween(cockpit, start, end, 0.009, materials.darkMetal, 8);
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, 0.085), materials.pedal);
      pedal.position.copy(end);
      pedal.rotation.x = DEG(-25);
      cockpit.add(pedal);
    }
  }

  const copilotSeat = new THREE.Group();
  const seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.11, 0.38), materials.seat);
  seatBase.position.set(0.205, -0.23, -0.54);
  copilotSeat.add(seatBase);
  const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.48, 0.1), materials.seat);
  seatBack.position.set(0.205, 0.04, -0.34);
  seatBack.rotation.x = DEG(-9);
  copilotSeat.add(seatBack);
  const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.16, 0.11), materials.seat);
  headrest.position.set(0.205, 0.36, -0.29);
  copilotSeat.add(headrest);
  cockpit.add(copilotSeat);

  const overhead = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.02, 0.13), materials.lowerPanel);
  overhead.position.set(0, 1.14, -1.72);
  overhead.rotation.x = DEG(-3);
  cockpit.add(overhead);
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      const overheadSwitch = new THREE.Mesh(
        new THREE.BoxGeometry(0.014, 0.008, 0.018),
        column < 2 && row === 0 ? materials.redSwitch : materials.switch,
      );
      overheadSwitch.position.set(-0.0875 + column * 0.035, 1.127, -1.748 + row * 0.052);
      cockpit.add(overheadSwitch);
    }
  }

  const framePairs = [
    [new THREE.Vector3(-0.38, 0.25, -2.08), new THREE.Vector3(-0.33, 1.15, -1.7)],
    [new THREE.Vector3(0.38, 0.25, -2.08), new THREE.Vector3(0.33, 1.15, -1.7)],
    [new THREE.Vector3(0, 0.58, -2.1), new THREE.Vector3(0, 1.15, -1.7)],
  ];
  framePairs.forEach(([start, end]) => tubeBetween(cockpit, start, end, 0.009, materials.cabin, 10));
  tubeBetween(
    cockpit,
    new THREE.Vector3(-0.34, 1.15, -1.7),
    new THREE.Vector3(0.34, 1.15, -1.7),
    0.01,
    materials.cabin,
    10,
  );

  aircraft.userData.cockpitInterior = cockpit;
  aircraft.userData.cockpitEye = new THREE.Vector3(-0.205, 0.88, -1.18);
  aircraft.userData.cockpitLook = new THREE.Vector3(-0.205, 0.96, -9);
  return { yokeL, yokeR, throttle };
}

export function buildTbm930Model(modelScale = 0.24) {
  const aircraft = new THREE.Group();
  aircraft.name = "Daher TBM 930 high-fidelity";
  aircraft.rotation.order = "YXZ";

  const materials = {
    white: new THREE.MeshPhysicalMaterial({
      color: 0xeeeae1,
      roughness: 0.24,
      metalness: 0.08,
      clearcoat: 0.85,
      clearcoatRoughness: 0.16,
    }),
    pearl: new THREE.MeshPhysicalMaterial({
      color: 0xdadbd8,
      roughness: 0.28,
      metalness: 0.12,
      clearcoat: 0.72,
    }),
    navy: new THREE.MeshStandardMaterial({ color: 0x17384f, roughness: 0.34 }),
    graphite: new THREE.MeshStandardMaterial({ color: 0x343e43, roughness: 0.38, metalness: 0.18 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xc86730, roughness: 0.4 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x151819, roughness: 0.96 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xaab2b3, roughness: 0.24, metalness: 0.78 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x343b3e, roughness: 0.3, metalness: 0.7 }),
    exhaust: new THREE.MeshStandardMaterial({ color: 0x24292b, roughness: 0.42, metalness: 0.76 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x7097a5,
      roughness: 0.08,
      metalness: 0.02,
      transmission: 0.55,
      thickness: 0.03,
      transparent: true,
      opacity: 0.48,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      side: THREE.DoubleSide,
    }),
    blade: new THREE.MeshStandardMaterial({
      color: 0x1e2528,
      roughness: 0.34,
      metalness: 0.32,
      transparent: true,
      opacity: 1,
    }),
    redLight: new THREE.MeshBasicMaterial({ color: 0xff3528, toneMapped: false }),
    greenLight: new THREE.MeshBasicMaterial({ color: 0x35f09c, toneMapped: false }),
    clearLight: new THREE.MeshBasicMaterial({ color: 0xe7fbff, toneMapped: false }),
    panel: new THREE.MeshStandardMaterial({ color: 0x242b2e, roughness: 0.78 }),
    lowerPanel: new THREE.MeshStandardMaterial({ color: 0x15191a, roughness: 0.86 }),
    glare: new THREE.MeshStandardMaterial({ color: 0x101415, roughness: 0.96 }),
    bezel: new THREE.MeshStandardMaterial({ color: 0x0c1113, roughness: 0.42, metalness: 0.25 }),
    switch: new THREE.MeshStandardMaterial({ color: 0xbec3c1, roughness: 0.45, metalness: 0.35 }),
    redSwitch: new THREE.MeshStandardMaterial({ color: 0xa82d28, roughness: 0.5 }),
    carpet: new THREE.MeshStandardMaterial({ color: 0x262a2b, roughness: 1 }),
    cabin: new THREE.MeshStandardMaterial({ color: 0xb7ad9d, roughness: 0.92 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x514a43, roughness: 0.86 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x756b60, roughness: 0.9 }),
    console: new THREE.MeshStandardMaterial({ color: 0x1a1d1e, roughness: 0.84 }),
    yoke: new THREE.MeshStandardMaterial({ color: 0x262d2f, roughness: 0.68, metalness: 0.12 }),
    throttle: new THREE.MeshStandardMaterial({ color: 0x111415, roughness: 0.7 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2f3536, roughness: 0.86 }),
    pedal: new THREE.MeshStandardMaterial({ color: 0x454d4f, roughness: 0.62, metalness: 0.28 }),
  };

  const exterior = new THREE.Group();
  exterior.name = "TBM 930 exterior";
  aircraft.add(exterior);

  const fuselage = makeLoft([
    { z: -3.12, rx: 0.08, ry: 0.1, y: 0.02 },
    { z: -2.95, rx: 0.28, ry: 0.3, y: 0.02 },
    { z: -2.55, rx: 0.37, ry: 0.39, y: 0.06 },
    { z: -2.14, rx: 0.4, ry: 0.46, y: 0.12, sidePower: 0.84 },
    { z: -1.68, rx: 0.41, ry: 0.5, y: 0.15, sidePower: 0.78 },
    { z: -0.9, rx: 0.42, ry: 0.5, y: 0.15, sidePower: 0.78 },
    { z: 0.1, rx: 0.42, ry: 0.48, y: 0.14, sidePower: 0.8 },
    { z: 0.95, rx: 0.39, ry: 0.43, y: 0.14 },
    { z: 1.6, rx: 0.31, ry: 0.31, y: 0.18 },
    { z: 2.15, rx: 0.2, ry: 0.2, y: 0.25 },
    { z: 2.65, rx: 0.075, ry: 0.085, y: 0.3 },
    { z: 2.86, rx: 0.025, ry: 0.03, y: 0.31 },
  ], materials.white);
  exterior.add(fuselage);

  const cowlingTop = makeLoft([
    { z: -3.08, rx: 0.18, ry: 0.12, y: 0.12 },
    { z: -2.78, rx: 0.32, ry: 0.17, y: 0.19 },
    { z: -2.34, rx: 0.35, ry: 0.13, y: 0.27 },
  ], materials.pearl, 32);
  exterior.add(cowlingTop);

  const intake = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.12, 0.18, 8, 18),
    materials.exhaust,
  );
  intake.rotation.x = Math.PI / 2;
  intake.scale.set(1.25, 1, 0.65);
  intake.position.set(0, -0.18, -2.92);
  exterior.add(intake);

  for (const side of [-1, 1]) {
    const exhaust = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.095, 0.42, 16, 1, true),
      materials.exhaust,
    );
    exhaust.rotation.z = Math.PI / 2;
    exhaust.rotation.y = side * DEG(7);
    exhaust.position.set(side * 0.43, 0.03, -2.42);
    exterior.add(exhaust);
  }

  const propeller = new THREE.Group();
  propeller.name = "propeller";
  propeller.position.set(0, 0.02, -3.2);
  exterior.add(propeller);
  let propellerBlade;
  for (let index = 0; index < 5; index += 1) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.045, 0.05);
    shape.bezierCurveTo(-0.08, 0.35, -0.12, 0.92, -0.06, 1.34);
    shape.bezierCurveTo(0.015, 1.43, 0.13, 1.18, 0.13, 0.88);
    shape.bezierCurveTo(0.12, 0.52, 0.075, 0.2, 0.045, 0.05);
    shape.closePath();
    const blade = new THREE.Mesh(new THREE.ShapeGeometry(shape, 12), materials.blade);
    blade.rotation.z = index / 5 * Math.PI * 2;
    blade.position.z = -0.015;
    propeller.add(blade);
    if (!propellerBlade) propellerBlade = blade;
  }
  const propHub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 24), materials.darkMetal);
  propHub.rotation.x = Math.PI / 2;
  propeller.add(propHub);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.5, 32), materials.pearl);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -0.22;
  propeller.add(spinner);

  for (const side of [-1, 1]) {
    const wing = makeAirfoilPanel({
      side,
      inner: 0.31,
      outer: 3.56,
      rootLeading: -0.78,
      rootTrailing: 0.66,
      tipLeading: -0.29,
      tipTrailing: 0.48,
      rootY: -0.15,
      tipY: 0.035,
      rootThickness: 0.18,
      tipThickness: 0.075,
      material: materials.white,
    });
    exterior.add(wing);

    const flapInner = side * 0.45;
    const flapOuter = side * 1.82;
    const flap = makeControlSurface(
      side < 0 ? "flapL" : "flapR",
      [
        [flapInner, 0.39],
        [flapOuter, 0.31],
        [flapOuter, 0.59],
        [flapInner, 0.64],
      ],
      0.36,
      -0.13,
      0.045,
      materials.pearl,
    );
    exterior.add(flap);

    const aileronInner = side * 1.87;
    const aileronOuter = side * 3.42;
    const aileron = makeControlSurface(
      side < 0 ? "aileronL" : "aileronR",
      [
        [aileronInner, 0.31],
        [aileronOuter, 0.44],
        [aileronOuter, 0.51],
        [aileronInner, 0.59],
      ],
      0.36,
      -0.04,
      0.038,
      materials.pearl,
    );
    exterior.add(aileron);

    const winglet = makeVerticalPrism([
      [-0.31, 0.02],
      [-0.2, 0.57],
      [0.02, 0.69],
      [0.43, 0.08],
    ], 0.07, materials.navy);
    winglet.position.x = side * 3.53;
    winglet.rotation.z = side * DEG(-7);
    exterior.add(winglet);

    const lightMaterial = side < 0 ? materials.redLight : materials.greenLight;
    const navLight = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 9), lightMaterial);
    navLight.position.set(side * 3.58, 0.05, -0.12);
    exterior.add(navLight);
  }

  const tailplane = makeAirfoilPanel({
    side: 1,
    inner: 0,
    outer: 1.42,
    rootLeading: 1.82,
    rootTrailing: 2.62,
    tipLeading: 2.0,
    tipTrailing: 2.55,
    rootY: 0.35,
    tipY: 0.39,
    rootThickness: 0.095,
    tipThickness: 0.045,
    material: materials.white,
    spanSegments: 7,
    chordSegments: 10,
  });
  const tailplaneL = makeAirfoilPanel({
    side: -1,
    inner: 0,
    outer: 1.42,
    rootLeading: 1.82,
    rootTrailing: 2.62,
    tipLeading: 2.0,
    tipTrailing: 2.55,
    rootY: 0.35,
    tipY: 0.39,
    rootThickness: 0.095,
    tipThickness: 0.045,
    material: materials.white,
    spanSegments: 7,
    chordSegments: 10,
  });
  exterior.add(tailplane, tailplaneL);

  const elevatorR = makeControlSurface(
    "elevatorR",
    [[0.12, 2.32], [1.36, 2.31], [1.36, 2.57], [0.12, 2.62]],
    2.32,
    0.385,
    0.035,
    materials.pearl,
  );
  const elevatorL = makeControlSurface(
    "elevatorL",
    [[-0.12, 2.32], [-1.36, 2.31], [-1.36, 2.57], [-0.12, 2.62]],
    2.32,
    0.385,
    0.035,
    materials.pearl,
  );
  exterior.add(elevatorL, elevatorR);

  const fin = makeVerticalPrism([
    [1.43, 0.28],
    [1.9, 1.36],
    [2.28, 1.56],
    [2.62, 0.35],
  ], 0.105, materials.white);
  exterior.add(fin);
  const finCap = makeVerticalPrism([
    [1.88, 1.33],
    [2.25, 1.55],
    [2.34, 1.26],
    [2.03, 1.15],
  ], 0.11, materials.navy);
  exterior.add(finCap);
  const rudder = makeVerticalControl(
    "rudder",
    [[2.24, 1.54], [2.63, 0.35], [2.72, 0.35], [2.53, 1.42]],
    2.25,
    0.075,
    materials.pearl,
  );
  exterior.add(rudder);
  const dorsal = makeVerticalPrism([
    [0.92, 0.35],
    [1.72, 0.97],
    [1.85, 0.34],
  ], 0.045, materials.white);
  exterior.add(dorsal);

  const windshieldLeft = makeQuad([
    new THREE.Vector3(-0.36, 0.28, -2.14),
    new THREE.Vector3(-0.03, 0.32, -2.28),
    new THREE.Vector3(-0.03, 0.67, -1.82),
    new THREE.Vector3(-0.35, 0.64, -1.68),
  ], materials.glass);
  const windshieldRight = makeQuad([
    new THREE.Vector3(0.03, 0.32, -2.28),
    new THREE.Vector3(0.36, 0.28, -2.14),
    new THREE.Vector3(0.35, 0.64, -1.68),
    new THREE.Vector3(0.03, 0.67, -1.82),
  ], materials.glass);
  exterior.add(windshieldLeft, windshieldRight);
  tubeBetween(
    exterior,
    new THREE.Vector3(0, 0.31, -2.27),
    new THREE.Vector3(0, 0.68, -1.82),
    0.016,
    materials.graphite,
    10,
  );

  for (const side of [-1, 1]) {
    const pilotWindow = makeSidePanel([
      [-1.76, 0.64],
      [-1.15, 0.62],
      [-1.02, 0.22],
      [-1.63, 0.2],
    ], materials.glass, side, 0.414);
    exterior.add(pilotWindow);
    for (const [z, width] of [[-0.63, 0.43], [0.02, 0.46], [0.67, 0.43]]) {
      addRoundedWindow(exterior, side, 0.424, 0.36, z, width, 0.34, materials.glass);
    }

    const stripe = makeSidePanel([
      [-2.48, -0.02],
      [1.72, 0.0],
      [1.9, 0.11],
      [-2.37, 0.1],
    ], materials.navy, side, 0.426);
    exterior.add(stripe);
    const accent = makeSidePanel([
      [-2.34, -0.08],
      [1.62, -0.08],
      [1.76, -0.015],
      [-2.46, 0.0],
    ], materials.orange, side, 0.428);
    exterior.add(accent);

    const doorOutline = [
      new THREE.Vector3(side * 0.43, 0.68, -1.77),
      new THREE.Vector3(side * 0.43, -0.18, -1.72),
      new THREE.Vector3(side * 0.43, -0.25, -1.02),
      new THREE.Vector3(side * 0.43, 0.62, -1.08),
    ];
    for (let index = 0; index < doorOutline.length; index += 1) {
      tubeBetween(
        exterior,
        doorOutline[index],
        doorOutline[(index + 1) % doorOutline.length],
        0.006,
        materials.graphite,
        6,
      );
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.025, 0.11), materials.darkMetal);
    handle.position.set(side * 0.44, 0.08, -1.16);
    exterior.add(handle);
  }

  const decalMaterial = new THREE.MeshBasicMaterial({
    map: placardTexture("TBM 930"),
    transparent: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  for (const side of [-1, 1]) {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.15), decalMaterial);
    decal.rotation.y = side * Math.PI / 2;
    decal.position.set(side * 0.435, 0.02, 1.17);
    exterior.add(decal);
  }

  const gearAssemblies = [];
  const noseGear = new THREE.Group();
  noseGear.name = "noseGear";
  tubeBetween(
    noseGear,
    new THREE.Vector3(0, -0.18, -2.3),
    new THREE.Vector3(0, -0.76, -2.18),
    0.035,
    materials.metal,
    12,
  );
  tubeBetween(
    noseGear,
    new THREE.Vector3(-0.12, -0.22, -2.28),
    new THREE.Vector3(0, -0.65, -2.18),
    0.018,
    materials.darkMetal,
    10,
  );
  addWheel(noseGear, 0, -0.83, -2.14, 0.17, 0.105, materials);
  const noseDoorL = makeQuad([
    new THREE.Vector3(-0.12, -0.15, -2.48),
    new THREE.Vector3(-0.03, -0.19, -2.48),
    new THREE.Vector3(-0.03, -0.62, -2.18),
    new THREE.Vector3(-0.12, -0.52, -2.2),
  ], materials.pearl);
  const noseDoorR = noseDoorL.clone();
  noseDoorR.scale.x = -1;
  noseGear.add(noseDoorL, noseDoorR);
  exterior.add(noseGear);
  gearAssemblies.push(noseGear);

  for (const side of [-1, 1]) {
    const mainGear = new THREE.Group();
    mainGear.name = side < 0 ? "mainGearL" : "mainGearR";
    const root = new THREE.Vector3(side * 0.62, -0.16, 0.0);
    const axle = new THREE.Vector3(side * 1.03, -0.77, 0.14);
    tubeBetween(mainGear, root, axle, 0.045, materials.metal, 12);
    tubeBetween(
      mainGear,
      new THREE.Vector3(side * 0.54, -0.17, 0.22),
      new THREE.Vector3(side * 0.94, -0.65, 0.16),
      0.02,
      materials.darkMetal,
      10,
    );
    addWheel(mainGear, axle.x, -0.84, axle.z, 0.205, 0.13, materials);
    const door = makeQuad([
      new THREE.Vector3(side * 0.5, -0.14, -0.16),
      new THREE.Vector3(side * 0.72, -0.17, -0.12),
      new THREE.Vector3(side * 1.04, -0.67, 0.08),
      new THREE.Vector3(side * 0.9, -0.62, 0.18),
    ], materials.pearl);
    mainGear.add(door);
    exterior.add(mainGear);
    gearAssemblies.push(mainGear);
  }

  const bellyLight = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), materials.redLight);
  bellyLight.position.set(0, -0.37, 0.55);
  exterior.add(bellyLight);
  const tailLight = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), materials.clearLight);
  tailLight.position.set(0, 0.33, 2.84);
  exterior.add(tailLight);

  const antenna = makeVerticalPrism([
    [-0.08, 0],
    [0, 0.24],
    [0.11, 0],
  ], 0.03, materials.white);
  antenna.position.set(0, 0.62, -0.18);
  exterior.add(antenna);
  const ventralAntenna = makeVerticalPrism([
    [-0.08, 0],
    [0, -0.2],
    [0.11, 0],
  ], 0.025, materials.graphite);
  ventralAntenna.position.set(0, -0.32, 1.2);
  exterior.add(ventralAntenna);

  const cockpitControls = addCockpit(aircraft, materials);

  aircraft.userData.controls = {
    aileronL: aircraft.getObjectByName("aileronL"),
    aileronR: aircraft.getObjectByName("aileronR"),
    flapL: aircraft.getObjectByName("flapL"),
    flapR: aircraft.getObjectByName("flapR"),
    elevatorL: aircraft.getObjectByName("elevatorL"),
    elevatorR: aircraft.getObjectByName("elevatorR"),
    rudder: aircraft.getObjectByName("rudder"),
    propeller,
    propellerBlade,
    yokeL: cockpitControls.yokeL,
    yokeR: cockpitControls.yokeR,
    throttle: cockpitControls.throttle,
    gearAssemblies,
  };
  aircraft.userData.exterior = exterior;
  // The solid exterior loft has no modeled windshield cutout. Hide it from the
  // pilot camera so the cockpit can sit low in-frame without the cowling
  // occluding the forward view.
  aircraft.userData.hideExteriorInCockpit = true;
  aircraft.userData.modelScale = modelScale;
  aircraft.traverse((node) => {
    if (node.isMesh && !node.material.transparent) node.castShadow = true;
  });
  aircraft.scale.setScalar(modelScale);
  return aircraft;
}
