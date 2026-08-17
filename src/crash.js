import * as THREE from "three";

// Impact handling: how an arrival is judged, and what is drawn when it goes
// badly. Distances are world units, where one unit is ten metres, but every
// threshold below is written in the units the quantity is normally quoted in —
// metres per second for closing speed, degrees for attitude, knots for speed.

const WORLD_PER_METRE = 0.1;
const m = (metres) => metres * WORLD_PER_METRE;
const GRAVITY = m(9.81);

export const OUTCOME = {
  FIRM: "firm",
  HARD: "hard",
  WRECK: "wreck",
  DESTROYED: "destroyed",
};

const SEVERITY = [OUTCOME.FIRM, OUTCOME.HARD, OUTCOME.WRECK, OUTCOME.DESTROYED];

/**
 * Judges an arrival from the speed into the surface rather than the raw rate of
 * descent, so flying level into a mountainside counts as the impact it is.
 *
 * The tiers roughly follow light-aircraft practice: under about 1.8 m/s
 * (350 ft/min) is a normal touchdown, up to 4 m/s is a hard landing that
 * rattles the airframe, beyond that the gear and structure start failing, and
 * past 9 m/s nothing is walking away.
 */
export function classifyImpact({
  normalSpeed,
  groundSpeedKt,
  bankDeg,
  pitchDeg,
  gearDown,
  surface,
}) {
  let level = 0;
  const causes = [];
  // Causes are tracked by the severity they imply, so the headline reason is
  // whatever actually decided the outcome rather than whichever test ran first.
  const byLevel = new Map();
  const raise = (to, cause) => {
    if (to > level) level = to;
    if (!cause || causes.includes(cause)) return;
    causes.push(cause);
    if (!byLevel.has(to)) byLevel.set(to, []);
    byLevel.get(to).push(cause);
  };

  if (surface === "water") {
    // A ditching is survivable a good deal faster than a ground impact; the
    // water gives way. Hitting it nose-down at speed does not.
    if (normalSpeed > 11) raise(3, `ditched at ${Math.round(normalSpeed)} m/s`);
    else if (groundSpeedKt > 12) raise(2, "ditched off the airport");
    if (Math.abs(pitchDeg) > 30) raise(3, "nose-first into the water");
    if (bankDeg > 40) raise(3, "wing dug in");
  } else if (surface === "obstacle") {
    raise(3, `flew into a building at ${Math.round(groundSpeedKt)} kt`);
  } else {
    if (normalSpeed > 9) raise(3, `struck the ground at ${Math.round(normalSpeed)} m/s`);
    else if (normalSpeed > 4.2) raise(2, `heavy impact at ${Math.round(normalSpeed)} m/s`);
    else if (normalSpeed > 1.8) raise(1, "hard touchdown");

    if (bankDeg > 55) raise(3, "wing struck the ground first");
    else if (bankDeg > 22) raise(2, `banked ${Math.round(bankDeg)}° at touchdown`);

    if (pitchDeg < -32) raise(3, "flown into the ground nose-first");
    else if (pitchDeg < -13) raise(2, "nose-low arrival");
    else if (pitchDeg > 26) raise(2, "tail struck first");

    if (surface === "rough" && groundSpeedKt > 45) raise(2, "came down away from a runway");
    if (!gearDown && groundSpeedKt > 35) raise(2, "landed gear up");
  }

  // Below taxi speed nothing much can go wrong short of hitting something.
  if (groundSpeedKt < 12 && surface !== "obstacle" && normalSpeed < 4) level = Math.min(level, 1);

  return {
    outcome: SEVERITY[level],
    cause: byLevel.get(level)?.[0] ?? causes[0] ?? "hard touchdown",
    causes,
    normalSpeed,
    groundSpeedKt,
    bankDeg,
    pitchDeg,
    surface,
    gearDown,
  };
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

const MODE = { FIRE: 0, SMOKE: 1, SPARK: 2 };

function createPuffTexture(soft) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (soft) {
    // Billowing lobes, so fire and smoke have a broken edge rather than a disc.
    for (let i = 0; i < 26; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.pow(Math.random(), 0.6) * size * 0.2;
      const x = size / 2 + Math.cos(angle) * distance;
      const y = size / 2 + Math.sin(angle) * distance;
      const radius = size * (0.1 + Math.random() * 0.14);
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, "rgba(255,255,255,.3)");
      gradient.addColorStop(0.45, "rgba(255,255,255,.14)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    }
  } else {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.3, "rgba(255,255,255,.7)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }

  const image = context.getImageData(0, 0, size, size);
  const data = image.data;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const nx = (x / size) * 2 - 1;
      const ny = (y / size) * 2 - 1;
      const vignette = THREE.MathUtils.clamp((1 - Math.hypot(nx, ny)) / 0.3, 0, 1);
      const alpha = Math.min(1, (data[index + 3] / 255) * (soft ? 1.6 : 1)) * vignette;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(alpha * 255);
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  return texture;
}

/**
 * A procedural soot-and-char decal. Building the ragged edge into the texture
 * keeps the silhouette organic without relying on transparent vertex colours,
 * which also avoids exposing the triangles used to drape it over the terrain.
 */
function createScorchTexture(destroyed) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const centre = size / 2;

  const blot = (x, y, radiusX, radiusY, alpha, angle = 0) => {
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.scale(1, radiusY / radiusX);
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radiusX);
    gradient.addColorStop(0, `rgba(13, 10, 8, ${alpha})`);
    gradient.addColorStop(0.42, `rgba(23, 16, 11, ${alpha * 0.82})`);
    gradient.addColorStop(0.76, `rgba(43, 27, 16, ${alpha * 0.34})`);
    gradient.addColorStop(1, "rgba(43, 27, 16, 0)");
    context.fillStyle = gradient;
    context.fillRect(-radiusX, -radiusX, radiusX * 2, radiusX * 2);
    context.restore();
  };

  // Layering many offset burns produces a blackened centre, brown singeing at
  // the fringe, and an outline that never reads as a geometric disc.
  blot(centre, centre + 5, 70, 51, 0.54, -0.08);
  blot(centre - 4, centre + 3, 45, 37, 0.72, 0.16);
  const patches = destroyed ? 34 : 24;
  for (let i = 0; i < patches; i += 1) {
    const bearing = Math.random() * Math.PI * 2;
    const distance = Math.pow(Math.random(), 0.7) * (destroyed ? 68 : 58);
    const radius = 10 + Math.random() * (destroyed ? 27 : 21);
    blot(
      centre + Math.cos(bearing) * distance,
      centre + Math.sin(bearing) * distance * 0.68,
      radius,
      radius * (0.45 + Math.random() * 0.55),
      0.15 + Math.random() * 0.28,
      bearing + Math.random() * 0.7,
    );
  }

  // Fine mottling breaks up the otherwise smooth gradients at close range.
  const image = context.getImageData(0, 0, size, size);
  for (let i = 3; i < image.data.length; i += 4) {
    if (image.data[i] === 0) continue;
    image.data[i] = Math.round(image.data[i] * (0.82 + Math.random() * 0.18));
  }
  context.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * A pool of camera-facing particles integrated entirely on the GPU: the CPU
 * writes a particle's launch state once and the vertex shader positions it from
 * its age every frame. One draw call per pool.
 */
class ParticleField {
  constructor({ capacity, mode, blending, texture, drag, buoyancy }) {
    this.capacity = capacity;
    this.cursor = 0;
    this.time = 0;

    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute("position", quad.attributes.position);
    geometry.setAttribute("uv", quad.attributes.uv);
    const attribute = (size) =>
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
    this.origin = attribute(3);
    this.velocity = attribute(3);
    this.timing = attribute(2); // birth, life
    this.sizing = attribute(2); // start, end
    this.tint = attribute(3);
    this.seed = attribute(1);
    geometry.setAttribute("particleOrigin", this.origin);
    geometry.setAttribute("particleVelocity", this.velocity);
    geometry.setAttribute("particleTiming", this.timing);
    geometry.setAttribute("particleSizing", this.sizing);
    geometry.setAttribute("particleTint", this.tint);
    geometry.setAttribute("particleSeed", this.seed);
    geometry.instanceCount = capacity;
    // Effects are local but the pool is written in world space; a fixed, large
    // bound is cheaper than recomputing it as the wreck burns.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          map: { value: null },
          time: { value: 0 },
          gravity: { value: 0 },
          drag: { value: drag },
          mode: { value: mode },
        },
      ]),
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        #include <fog_pars_vertex>
        attribute vec3 particleOrigin;
        attribute vec3 particleVelocity;
        attribute vec2 particleTiming;
        attribute vec2 particleSizing;
        attribute vec3 particleTint;
        attribute float particleSeed;
        uniform float time;
        uniform float gravity;
        uniform float drag;
        varying vec2 vUv;
        varying vec3 vTint;
        varying float vAge;
        void main() {
          float age = time - particleTiming.x;
          vAge = age / max(particleTiming.y, 0.0001);
          if (vAge < 0.0 || vAge > 1.0) {
            // Retired particles are pushed behind the camera rather than
            // rebuilding the buffer every time one expires.
            gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
            return;
          }
          // Closed-form drag, so a particle's path never depends on frame rate.
          float travel = (1.0 - exp(-drag * age)) / drag;
          vec3 pos = particleOrigin + particleVelocity * travel;
          pos.y += gravity * age * age * 0.5;
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          float scale = mix(particleSizing.x, particleSizing.y, vAge);
          float spin = particleSeed * 6.2831 + age * (particleSeed - 0.5) * 1.4;
          float c = cos(spin);
          float s = sin(spin);
          vec2 corner = vec2(
            position.x * c - position.y * s,
            position.x * s + position.y * c);
          mvPosition.xy += corner * scale;
          vUv = uv;
          vTint = particleTint;
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        #include <fog_pars_fragment>
        uniform sampler2D map;
        uniform float mode;
        varying vec2 vUv;
        varying vec3 vTint;
        varying float vAge;
        void main() {
          #include <logdepthbuf_fragment>
          float texel = texture2D(map, vUv).a;
          if (texel < 0.004) discard;
          vec3 color;
          float alpha;
          if (mode < 0.5) {
            // Fire: white hot at the core, falling through the particle's own
            // tint to a sooty red as it burns out.
            color = mix(vec3(1.0, 0.95, 0.82), vTint, smoothstep(0.0, 0.3, vAge));
            color = mix(color, vec3(0.16, 0.05, 0.02), smoothstep(0.5, 1.0, vAge));
            // Held well below one: dozens of these overlap additively, and at
            // full strength the sum saturates to a white blob.
            alpha = texel * 0.5 * smoothstep(0.0, 0.05, vAge) * (1.0 - smoothstep(0.45, 1.0, vAge));
          } else if (mode < 1.5) {
            // Smoke: thins and pales as it rises and spreads.
            color = mix(vTint, vTint * 1.9 + 0.06, smoothstep(0.0, 1.0, vAge));
            // Kept thin so overlapping puffs build a plume instead of reading
            // as a string of separate balls.
            alpha = texel * 0.42 * smoothstep(0.0, 0.1, vAge) * (1.0 - smoothstep(0.3, 1.0, vAge));
          } else {
            // Embers: a bright streak that cools and winks out.
            color = mix(vec3(1.0, 0.9, 0.6), vTint, smoothstep(0.0, 0.4, vAge));
            alpha = texel * (1.0 - smoothstep(0.25, 1.0, vAge));
          }
          gl_FragColor = vec4(color, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending,
      fog: true,
    });
    material.uniforms.map.value = texture;
    material.uniforms.gravity.value = buoyancy;

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  /**
   * Writes one particle into the ring buffer. `delay` postpones its birth,
   * which the shader treats as not yet alive — used to let a fireball read
   * before its own smoke buries it.
   */
  emit({ origin, velocity, life, startSize, endSize, tint, delay = 0 }) {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.origin.setXYZ(index, origin.x, origin.y, origin.z);
    this.velocity.setXYZ(index, velocity.x, velocity.y, velocity.z);
    this.timing.setXY(index, this.time + delay, life);
    this.sizing.setXY(index, startSize, endSize);
    this.tint.setXYZ(index, tint.r, tint.g, tint.b);
    this.seed.setX(index, Math.random());
    this.dirty = true;
  }

  update(dt) {
    this.time += dt;
    this.mesh.material.uniforms.time.value = this.time;
    if (!this.dirty) return;
    this.dirty = false;
    for (const attribute of [this.origin, this.velocity, this.timing, this.sizing, this.tint, this.seed]) {
      attribute.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.uniforms.map.value?.dispose();
    this.mesh.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// Debris
// ---------------------------------------------------------------------------

/** Bounds in an object's own coordinate system, using cached mesh bounds. */
function localObjectBounds(object) {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const inverseRoot = new THREE.Matrix4().copy(object.matrixWorld).invert();
  const meshToRoot = new THREE.Matrix4();
  const corner = new THREE.Vector3();

  object.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    const box = node.geometry.boundingBox;
    if (!box || box.isEmpty()) return;
    meshToRoot.multiplyMatrices(inverseRoot, node.matrixWorld);
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          bounds.expandByPoint(corner.set(x, y, z).applyMatrix4(meshToRoot));
        }
      }
    }
  });

  if (bounds.isEmpty()) {
    bounds.set(
      new THREE.Vector3(-m(0.2), -m(0.2), -m(0.2)),
      new THREE.Vector3(m(0.2), m(0.2), m(0.2)),
    );
  }
  return bounds;
}

/** A tumbling piece of airframe, integrated with bounce and friction. */
class DebrisBody {
  constructor(object, {
    velocity,
    spin,
    burning = false,
    restAxis = new THREE.Vector3(0, 1, 0),
  }) {
    this.object = object;
    this.velocity = velocity;
    this.spin = spin;
    this.burning = burning;
    this.settled = false;
    this.planting = false;
    this.bounces = 0;
    this.smokeTimer = Math.random() * 0.1;
    this.restAxis = restAxis.clone().normalize();
    const bounds = localObjectBounds(object);
    this.corners = [];
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          this.corners.push(new THREE.Vector3(x, y, z));
        }
      }
    }
    this.axis = new THREE.Vector3();
    this.corner = new THREE.Vector3();
    this.groundNormal = new THREE.Vector3();
    this.restNormal = new THREE.Vector3();
    this.turn = new THREE.Quaternion();
    this.correction = new THREE.Quaternion();
    this.restQuaternion = new THREE.Quaternion();
  }

  /** Height of the lowest oriented bounding-box corner below the body origin. */
  supportHeight(quaternion) {
    let lowest = Infinity;
    for (const corner of this.corners) {
      this.corner.copy(corner).applyQuaternion(quaternion);
      lowest = Math.min(lowest, this.corner.y);
    }
    return Math.max(m(0.025), -lowest);
  }

  terrainNormal(groundAt) {
    const { x, z } = this.object.position;
    const step = m(1.5);
    return this.groundNormal.set(
      groundAt(x - step, z) - groundAt(x + step, z),
      step * 2,
      groundAt(x, z - step) - groundAt(x, z + step),
    ).normalize();
  }

  /**
   * Picks the nearer broad face and turns it onto the terrain. This prevents a
   * low-energy final bounce from permanently balancing a section on its nose.
   */
  beginPlanting(groundAt) {
    const normal = this.terrainNormal(groundAt);
    this.restNormal.copy(this.restAxis).applyQuaternion(this.object.quaternion).normalize();
    if (this.restNormal.dot(normal) < 0) this.restNormal.negate();
    this.correction.setFromUnitVectors(this.restNormal, normal);
    this.restQuaternion.copy(this.correction).multiply(this.object.quaternion).normalize();
    this.velocity.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.planting = true;
  }

  updatePlanting(dt, groundAt) {
    const turn = 1 - Math.exp(-7.5 * dt);
    this.object.quaternion.slerp(this.restQuaternion, turn);
    const floor = groundAt(this.object.position.x, this.object.position.z)
      + this.supportHeight(this.object.quaternion)
      + m(0.025);
    this.object.position.y = THREE.MathUtils.lerp(
      this.object.position.y,
      floor,
      1 - Math.exp(-9 * dt),
    );
    if (
      this.object.quaternion.angleTo(this.restQuaternion) < 0.008
      && Math.abs(this.object.position.y - floor) < m(0.02)
    ) {
      this.object.quaternion.copy(this.restQuaternion);
      this.object.position.y = floor;
      this.planting = false;
      this.settled = true;
    }
  }

  update(dt, groundAt) {
    if (this.settled) return;
    if (this.planting) {
      this.updatePlanting(dt, groundAt);
      return true;
    }
    this.velocity.y -= GRAVITY * dt;
    this.velocity.multiplyScalar(Math.exp(-0.35 * dt));
    this.object.position.addScaledVector(this.velocity, dt);

    const angle = this.spin.length() * dt;
    if (angle > 1e-5) {
      this.axis.copy(this.spin).normalize();
      this.turn.setFromAxisAngle(this.axis, angle);
      this.object.quaternion.premultiply(this.turn);
    }

    // Use the oriented piece bounds rather than a sphere. A sphere held long,
    // thin pieces far above the ground and let them stop on a tip.
    const floor = groundAt(this.object.position.x, this.object.position.z)
      + this.supportHeight(this.object.quaternion)
      + m(0.025);
    if (this.object.position.y <= floor) {
      this.object.position.y = floor;
      if (this.velocity.y < 0) {
        // Airframe is not springy: most of the vertical energy goes into
        // deforming metal, and the piece slews rather than rolling on.
        this.velocity.y = -this.velocity.y * 0.28;
        this.bounces += 1;
      }
      this.velocity.x *= 0.62;
      this.velocity.z *= 0.62;
      this.spin.multiplyScalar(0.45);
      if (this.velocity.lengthSq() < m(0.6) ** 2 || this.bounces > 4) {
        this.beginPlanting(groundAt);
      }
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Crash sequence
// ---------------------------------------------------------------------------

const SMOKE_TINT = new THREE.Color(0x1c1a19);
const FIRE_TINT = new THREE.Color(0xff7a1c);
const SPARK_TINT = new THREE.Color(0xff5a12);
const SPRAY_TINT = new THREE.Color(0xdfeef2);

/**
 * The particle pools and the light that lights them. Built once at start-up and
 * reused: generating three canvas textures and compiling three shader programs
 * costs hundreds of milliseconds, and doing that at the moment of impact stalls
 * the frame exactly when the explosion is supposed to appear.
 */
export class CrashEffects {
  constructor(scene) {
    this.fire = new ParticleField({
      capacity: 420,
      mode: MODE.FIRE,
      blending: THREE.AdditiveBlending,
      texture: createPuffTexture(true),
      drag: 1.5,
      buoyancy: m(5.5),
    });
    this.smoke = new ParticleField({
      capacity: 620,
      mode: MODE.SMOKE,
      blending: THREE.NormalBlending,
      texture: createPuffTexture(true),
      drag: 0.55,
      buoyancy: m(1.6),
    });
    this.sparks = new ParticleField({
      capacity: 420,
      mode: MODE.SPARK,
      blending: THREE.AdditiveBlending,
      texture: createPuffTexture(false),
      drag: 0.6,
      buoyancy: -m(7),
    });
    this.fields = [this.fire, this.smoke, this.sparks];
    for (const field of this.fields) scene.add(field.mesh);

    this.flash = new THREE.PointLight(0xffb257, 0, m(400), 2);
    scene.add(this.flash);
  }

  /** Kills every live particle, so a new crash starts on a clean sheet. */
  retire() {
    for (const field of this.fields) {
      for (let i = 0; i < field.capacity; i += 1) field.timing.setXY(i, -1e6, 0.001);
      field.dirty = true;
      field.cursor = 0;
    }
    this.flash.intensity = 0;
  }

  update(dt) {
    for (const field of this.fields) field.update(dt);
  }
}

/**
 * Owns everything that happens after an unsurvivable or airframe-wrecking
 * arrival: the aircraft comes apart or skids, fuel burns, and the camera is
 * given something to look at.
 */
export class CrashSequence {
  constructor({ scene, plane, impact, velocity, groundAt, wind, effects, contact }) {
    this.scene = scene;
    this.impact = impact;
    this.groundAt = groundAt;
    this.wind = wind ?? new THREE.Vector2();
    this.elapsed = 0;
    this.bodies = [];
    this.destroyed = impact.outcome === OUTCOME.DESTROYED;
    this.water = impact.surface === "water";
    // The fire starts where the airframe actually touched, which on a banked
    // arrival is a wingtip rather than the centre of the aircraft.
    this.origin = (contact ?? plane.position).clone();
    this.focus = this.origin.clone();
    const impactDirection = new THREE.Vector2(velocity.x, velocity.z);
    this.scorchHeading = impactDirection.lengthSq() > 1e-5
      ? Math.atan2(impactDirection.x, impactDirection.y)
      : Math.random() * Math.PI * 2;

    this.effects = effects;
    this.fire = effects.fire;
    this.smoke = effects.smoke;
    this.sparks = effects.sparks;
    this.flash = effects.flash;
    effects.retire();
    this.flash.position.copy(this.origin);

    if (this.destroyed) this.shatter(plane, velocity);
    else this.skid(plane, velocity);

    if (this.water) this.splash(velocity);
    else if (this.destroyed) this.detonate(velocity);
    else this.scorch();
  }

  // -- Airframe -------------------------------------------------------------

  sectionForPoint(point, centre, halfX, halfZ) {
    const nx = (point.x - centre.x) / halfX;
    const nz = (point.z - centre.z) / halfZ;
    if (nx < -0.34) return "leftWing";
    if (nx > 0.34) return "rightWing";
    if (nz < -0.38) return "nose";
    if (nz > 0.38) return "tail";
    return "fuselage";
  }

  /**
   * Imported aircraft often put the entire visible skin in one mesh. Bake its
   * triangles into static structural sections at the current animated pose so
   * a destroyed aircraft actually tears apart rather than throwing one intact
   * shell alongside a handful of small fittings.
   */
  fractureMesh(mesh, plane, planeInverse, meshBounds, centre, halfX, halfZ) {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index;
    const triangleCount = Math.floor((index?.count ?? position.count) / 3);
    const span = meshBounds.getSize(new THREE.Vector3());
    if (triangleCount < 900 || (span.x < halfX * 0.75 && span.z < halfZ * 0.75)) return [];

    mesh.skeleton?.update();
    const uv = geometry.attributes.uv;
    const color = geometry.attributes.color;
    const meshToPlane = new THREE.Matrix4().multiplyMatrices(planeInverse, mesh.matrixWorld);
    const vertex = new THREE.Vector3();
    const triangle = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const sourceIndices = [0, 0, 0];
    const centroid = new THREE.Vector3();
    const buckets = new Map();

    const materialIndexAt = (offset) => {
      for (const group of geometry.groups) {
        if (offset >= group.start && offset < group.start + group.count) return group.materialIndex;
      }
      return 0;
    };

    for (let offset = 0; offset + 2 < (index?.count ?? position.count); offset += 3) {
      centroid.set(0, 0, 0);
      for (let cornerIndex = 0; cornerIndex < 3; cornerIndex += 1) {
        const sourceIndex = index ? index.getX(offset + cornerIndex) : offset + cornerIndex;
        sourceIndices[cornerIndex] = sourceIndex;
        vertex.fromBufferAttribute(position, sourceIndex);
        if (mesh.isSkinnedMesh) mesh.applyBoneTransform(sourceIndex, vertex);
        triangle[cornerIndex].copy(vertex).applyMatrix4(meshToPlane);
        centroid.add(triangle[cornerIndex]);
      }
      centroid.multiplyScalar(1 / 3);
      const section = this.sectionForPoint(centroid, centre, halfX, halfZ);
      const materialIndex = Array.isArray(mesh.material) ? materialIndexAt(offset) : 0;
      const bucketKey = `${section}:${materialIndex}`;
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, { section, materialIndex, positions: [], uvs: [], colors: [] });
      }
      const bucket = buckets.get(bucketKey);
      for (let cornerIndex = 0; cornerIndex < 3; cornerIndex += 1) {
        const point = triangle[cornerIndex];
        const sourceIndex = sourceIndices[cornerIndex];
        bucket.positions.push(point.x, point.y, point.z);
        if (uv) bucket.uvs.push(uv.getX(sourceIndex), uv.getY(sourceIndex));
        if (color) bucket.colors.push(
          color.getX(sourceIndex),
          color.getY(sourceIndex),
          color.getZ(sourceIndex),
        );
      }
    }

    const sections = new Set([...buckets.values()].map((bucket) => bucket.section));
    if (sections.size < 2) return [];

    const pieces = [];
    for (const bucket of buckets.values()) {
      if (bucket.positions.length < 9) continue;
      const pieceGeometry = new THREE.BufferGeometry();
      pieceGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(bucket.positions, 3),
      );
      if (uv) {
        pieceGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(bucket.uvs, 2));
      }
      if (color) {
        pieceGeometry.setAttribute("color", new THREE.Float32BufferAttribute(bucket.colors, 3));
      }
      pieceGeometry.computeVertexNormals();
      pieceGeometry.computeBoundingBox();
      pieceGeometry.computeBoundingSphere();
      const material = Array.isArray(mesh.material)
        ? (mesh.material[bucket.materialIndex] ?? mesh.material[0])
        : mesh.material;
      const piece = new THREE.Mesh(pieceGeometry, material);
      piece.name = `${mesh.name || "airframe"}-${bucket.section}-fracture`;
      piece.castShadow = mesh.castShadow;
      piece.receiveShadow = mesh.receiveShadow;
      piece.userData.crashSection = bucket.section;
      plane.add(piece);
      pieces.push(piece);
    }
    return pieces;
  }

  /**
   * Breaks the model into airframe sections. Meshes are re-parented with
   * Object3D.attach, which preserves their world transform, so the wings and
   * tail that fly off are the same geometry that was on the aircraft.
   */
  shatter(plane, velocity) {
    plane.updateMatrixWorld(true);
    const sourceMeshes = [];
    plane.traverse((node) => {
      if (!node.isMesh || node.userData.noBounds) return;
      let parent = node;
      while (parent && parent !== plane) {
        if (!parent.visible) return;
        parent = parent.parent;
      }
      sourceMeshes.push(node);
    });
    if (!sourceMeshes.length) return;

    const planeInverse = new THREE.Matrix4().copy(plane.matrixWorld).invert();
    const meshToPlane = new THREE.Matrix4();
    const corner = new THREE.Vector3();
    const bounds = new THREE.Box3();
    const meshBounds = new Map();
    for (const mesh of sourceMeshes) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const geometryBounds = mesh.geometry.boundingBox;
      const inPlane = new THREE.Box3();
      meshToPlane.multiplyMatrices(planeInverse, mesh.matrixWorld);
      for (const x of [geometryBounds.min.x, geometryBounds.max.x]) {
        for (const y of [geometryBounds.min.y, geometryBounds.max.y]) {
          for (const z of [geometryBounds.min.z, geometryBounds.max.z]) {
            inPlane.expandByPoint(corner.set(x, y, z).applyMatrix4(meshToPlane));
          }
        }
      }
      bounds.union(inPlane);
      meshBounds.set(mesh, inPlane);
    }
    const centre = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const halfX = Math.max(size.x / 2, 1e-3);
    const halfZ = Math.max(size.z / 2, 1e-3);

    const meshes = [];
    for (const mesh of sourceMeshes) {
      const pieces = this.fractureMesh(
        mesh,
        plane,
        planeInverse,
        meshBounds.get(mesh),
        centre,
        halfX,
        halfZ,
      );
      if (pieces.length) {
        mesh.visible = false;
        meshes.push(...pieces);
      } else {
        meshes.push(mesh);
      }
    }
    plane.updateMatrixWorld(true);

    const entries = meshes.map((mesh) => {
      const geometryBounds = mesh.geometry.boundingBox;
      meshToPlane.multiplyMatrices(planeInverse, mesh.matrixWorld);
      // Imported GLB primitives commonly share an object origin. Their actual
      // geometry centres identify wings, nose and tail far more reliably.
      const point = geometryBounds.getCenter(new THREE.Vector3()).applyMatrix4(meshToPlane);
      const worldPoint = point.clone().applyMatrix4(plane.matrixWorld);
      return { mesh, point, worldPoint };
    });

    const groups = new Map();
    for (const entry of entries) {
      const { point } = entry;
      const key = entry.mesh.userData.crashSection
        ?? this.sectionForPoint(point, centre, halfX, halfZ);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }

    const airframeOrientation = plane.getWorldQuaternion(new THREE.Quaternion());
    for (const [key, members] of groups) {
      const chunk = new THREE.Group();
      chunk.name = `wreck-${key}`;
      const centroid = new THREE.Vector3();
      for (const { worldPoint } of members) centroid.add(worldPoint);
      centroid.divideScalar(members.length);
      chunk.position.copy(centroid);
      // Keep the chunk's local axes aligned with the original airframe. Its Y
      // axis can then be planted onto the terrain after the final bounce.
      chunk.quaternion.copy(airframeOrientation);
      this.scene.add(chunk);
      for (const { mesh } of members) chunk.attach(mesh);

      // Sections keep most of the aircraft's momentum and are thrown outward
      // from the point of impact by the blast.
      const outward = centroid.clone().sub(this.origin);
      if (outward.lengthSq() < 1e-6) outward.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      outward.normalize();
      // Enough to throw the sections clear, but not so much that they hang in
      // the air: everything should be down and burning within a few seconds.
      const energy = THREE.MathUtils.clamp(this.impact.normalSpeed / 14, 0.4, 1.5);
      const chunkVelocity = velocity.clone().multiplyScalar(0.38)
        .addScaledVector(outward, m(5 + Math.random() * 10) * energy)
        .add(new THREE.Vector3(0, m(3 + Math.random() * 7) * energy, 0));
      const spin = new THREE.Vector3(
        (Math.random() - 0.5) * 7,
        (Math.random() - 0.5) * 7,
        (Math.random() - 0.5) * 7,
      ).multiplyScalar(energy);
      this.bodies.push(new DebrisBody(chunk, {
        velocity: chunkVelocity,
        spin,
        burning: key !== "tail" && !this.water,
      }));
    }

    this.addShards(velocity);
    plane.visible = false;
  }

  /** Torn panels and small structure thrown clear of the main sections. */
  addShards(velocity) {
    const material = new THREE.MeshStandardMaterial({
      color: 0xb9bcbb,
      roughness: 0.55,
      metalness: 0.5,
      side: THREE.DoubleSide,
    });
    const energy = THREE.MathUtils.clamp(this.impact.normalSpeed / 14, 0.5, 1.6);
    for (let i = 0; i < 16; i += 1) {
      const width = m(0.3 + Math.random() * 1.1);
      const shard = new THREE.Mesh(
        new THREE.PlaneGeometry(width, width * (0.4 + Math.random() * 0.9)),
        material,
      );
      shard.castShadow = true;
      shard.position.copy(this.origin).add(new THREE.Vector3(
        (Math.random() - 0.5) * m(6),
        Math.random() * m(4),
        (Math.random() - 0.5) * m(6),
      ));
      this.scene.add(shard);
      const outward = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      this.bodies.push(new DebrisBody(shard, {
        velocity: velocity.clone().multiplyScalar(0.28)
          .addScaledVector(outward, m(7 + Math.random() * 18) * energy)
          .add(new THREE.Vector3(0, m(4 + Math.random() * 10) * energy, 0)),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 16,
          (Math.random() - 0.5) * 16,
          (Math.random() - 0.5) * 16,
        ),
        // PlaneGeometry's broad face is normal to local Z.
        restAxis: new THREE.Vector3(0, 0, 1),
      }));
    }
  }

  /**
   * A wrecked-but-survivable arrival: the aircraft stays in one piece, drops
   * onto its belly and grinds to a halt.
   */
  skid(plane, velocity) {
    this.wreck = plane;
    this.skidVelocity = velocity.clone();
    this.skidVelocity.y = Math.min(this.skidVelocity.y, 0);
    this.skidHeading = Math.atan2(velocity.x, -velocity.z);
    this.skidRoll = THREE.MathUtils.degToRad(
      THREE.MathUtils.clamp(this.impact.bankDeg, 0, 30) * (Math.random() < 0.5 ? -1 : 1),
    );
    this.skidYaw = (Math.random() - 0.5) * 1.1;
    if (plane.userData.controls?.gearAssemblies) {
      // The gear does not survive a belly arrival.
      plane.userData.controls.gearAssemblies.forEach((assembly) => {
        assembly.visible = false;
      });
    }
  }

  // -- Effects --------------------------------------------------------------

  /** The fuel going up: a rising fireball, a smoke column, and thrown embers. */
  detonate(velocity) {
    const drift = velocity.clone().multiplyScalar(0.18);
    // The initial flash: a few very large, very short-lived cores that make the
    // detonation read as one event before it breaks up into a rolling fireball.
    for (let i = 0; i < 5; i += 1) {
      this.fire.emit({
        origin: this.origin.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * m(4),
          Math.random() * m(4),
          (Math.random() - 0.5) * m(4),
        )),
        velocity: drift.clone(),
        life: 0.45 + Math.random() * 0.3,
        startSize: m(9 + Math.random() * 8),
        endSize: m(26 + Math.random() * 14),
        tint: new THREE.Color(0xffd08a),
      });
    }
    for (let i = 0; i < 72; i += 1) {
      const direction = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.85,
        Math.random() - 0.5,
      ).normalize();
      this.fire.emit({
        origin: this.origin.clone().addScaledVector(direction, m(Math.random() * 5)),
        velocity: drift.clone().addScaledVector(direction, m(5 + Math.random() * 24)),
        life: 1.4 + Math.random() * 1.9,
        startSize: m(4 + Math.random() * 6),
        endSize: m(17 + Math.random() * 22),
        tint: FIRE_TINT,
      });
    }
    // Smoke lifts out of the fireball, staggered so the fire is what reads
    // first and the column builds behind it.
    for (let i = 0; i < 34; i += 1) {
      const direction = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.9 + 0.1,
        Math.random() - 0.5,
      ).normalize();
      this.smoke.emit({
        origin: this.origin.clone().addScaledVector(direction, m(Math.random() * 6)),
        velocity: drift.clone().addScaledVector(direction, m(4 + Math.random() * 16)),
        life: 6 + Math.random() * 7,
        startSize: m(2.5 + Math.random() * 4),
        endSize: m(34 + Math.random() * 40),
        tint: SMOKE_TINT,
        delay: 0.12 + Math.random() * 0.45,
      });
    }
    for (let i = 0; i < 120; i += 1) {
      const direction = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.7 + 0.05,
        Math.random() - 0.5,
      ).normalize();
      this.sparks.emit({
        origin: this.origin.clone(),
        velocity: drift.clone().addScaledVector(direction, m(12 + Math.random() * 46)),
        life: 0.7 + Math.random() * 1.6,
        startSize: m(0.5 + Math.random() * 0.7),
        endSize: m(0.12),
        tint: SPARK_TINT,
      });
    }
    this.flash.intensity = 900;
    this.scorch();
  }

  /** Ditching throws water rather than fire. */
  splash(velocity) {
    const drift = velocity.clone().multiplyScalar(0.12);
    for (let i = 0; i < 90; i += 1) {
      const direction = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.5 + 0.35,
        Math.random() - 0.5,
      ).normalize();
      this.smoke.emit({
        origin: this.origin.clone().addScaledVector(direction, m(Math.random() * 5)),
        velocity: drift.clone().addScaledVector(direction, m(6 + Math.random() * 26)),
        life: 1.4 + Math.random() * 1.8,
        startSize: m(1.4 + Math.random() * 3),
        endSize: m(7 + Math.random() * 10),
        tint: SPRAY_TINT,
      });
    }
  }

  /** Burnt ground under the wreck, draped over the terrain. */
  scorch() {
    // A strike high on a structure leaves nothing on the ground below it.
    if (this.origin.y - this.groundAt(this.origin.x, this.origin.z) > m(40)) return;
    const width = m(this.destroyed ? 30 : 17);
    const length = m(this.destroyed ? 38 : 23);
    // A dense grid follows terrain curvature. The previous CircleGeometry was
    // one triangle fan, so its broad faces intersected uneven ground as a ring
    // of conspicuous wedges.
    const geometry = new THREE.PlaneGeometry(width, length, 20, 26);
    geometry.rotateX(-Math.PI / 2);
    geometry.rotateY(this.scorchHeading);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      const x = this.origin.x + position.getX(i);
      const z = this.origin.z + position.getZ(i);
      position.setY(i, this.groundAt(x, z) - this.origin.y + m(0.06));
    }
    position.needsUpdate = true;
    geometry.computeBoundingSphere();
    const texture = createScorchTexture(this.destroyed);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.94,
        alphaTest: 0.012,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -8,
        polygonOffsetUnits: -8,
      }),
    );
    mesh.name = "crash-scorch-mark";
    mesh.position.copy(this.origin);
    mesh.renderOrder = 3;
    this.scene.add(mesh);
    this.scorchMesh = mesh;
  }

  // -- Frame ----------------------------------------------------------------

  update(dt) {
    this.elapsed += dt;

    for (const body of this.bodies) body.update(dt, this.groundAt);
    if (this.wreck) this.updateSkid(dt);

    // The fireball lights the scene for a moment, then the pool fire takes over.
    this.flash.intensity = this.destroyed && !this.water
      ? Math.max(0, 900 * Math.exp(-this.elapsed * 3.2)) + 90 * Math.exp(-this.elapsed * 0.14)
      : 0;
    this.flash.position.copy(this.focusPoint());

    if (!this.water) {
      this.burn(dt);
      this.trailDebris(dt);
    }
    this.focus.lerp(this.focusPoint(), 1 - Math.exp(-dt * 3));
  }

  /** Sustained pool fire and smoke column from the burning wreckage. */
  burn(dt) {
    const intensity = this.destroyed ? 1 : 0.45;
    const decay = Math.exp(-this.elapsed * 0.03);
    // The pool fire builds under the fireball rather than waiting for it to
    // finish, so there is never a gap with nothing burning.
    if (this.destroyed && this.elapsed < 0.25) return;
    this.fireTimer = (this.fireTimer ?? 0) + dt;
    const interval = 0.045 / (intensity * decay + 0.05);
    while (this.fireTimer > interval) {
      this.fireTimer -= interval;
      const seat = this.burningPoint();
      this.fire.emit({
        origin: seat,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * m(3),
          m(5 + Math.random() * 9),
          (Math.random() - 0.5) * m(3),
        ),
        life: 0.9 + Math.random() * 1.1,
        startSize: m(1.6 + Math.random() * 3),
        endSize: m(6 + Math.random() * 8),
        tint: FIRE_TINT,
      });
      this.smoke.emit({
        origin: seat.clone().add(new THREE.Vector3(0, m(3), 0)),
        velocity: new THREE.Vector3(
          this.wind.x * 2.2 + (Math.random() - 0.5) * m(3),
          m(7 + Math.random() * 8),
          this.wind.y * 2.2 + (Math.random() - 0.5) * m(3),
        ),
        life: 5 + Math.random() * 6,
        startSize: m(3 + Math.random() * 4),
        endSize: m(28 + Math.random() * 34),
        tint: SMOKE_TINT,
      });
    }
  }

  /**
   * The pool fire stays where the fuel went in. Sections thrown clear trail
   * smoke of their own, but seating the fire on flying debris would draw a
   * string of separate fires across the sky.
   */
  burningPoint() {
    const anchor = this.wreck ? this.wreck.position : this.origin;
    return anchor.clone().add(new THREE.Vector3(
      (Math.random() - 0.5) * m(this.wreck ? 4 : 8),
      m(0.6),
      (Math.random() - 0.5) * m(this.wreck ? 4 : 8),
    ));
  }

  /** Thin smoke off burning sections while they are still tumbling. */
  trailDebris(dt) {
    for (const body of this.bodies) {
      if (!body.burning) continue;
      body.smokeTimer -= dt;
      if (body.smokeTimer > 0) continue;
      body.smokeTimer = body.settled ? 0.5 : 0.09;
      this.smoke.emit({
        origin: body.object.position.clone(),
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * m(3),
          m(3 + Math.random() * 5),
          (Math.random() - 0.5) * m(3),
        ),
        life: 3 + Math.random() * 3,
        startSize: m(1.2 + Math.random() * 1.6),
        endSize: m(10 + Math.random() * 12),
        tint: SMOKE_TINT,
      });
    }
  }

  /** Grinds a still-whole airframe to a stop along the ground. */
  updateSkid(dt) {
    const position = this.wreck.position;
    const speed = this.skidVelocity.length();
    if (speed > m(0.4)) {
      // Ploughing friction, plus a slow slew as the airframe weathercocks.
      this.skidVelocity.multiplyScalar(Math.exp(-1.05 * dt));
      position.addScaledVector(this.skidVelocity, dt);
      this.skidHeading += this.skidYaw * dt * (speed / m(24));
      const sparkRate = THREE.MathUtils.clamp(speed / m(30), 0, 1);
      if (Math.random() < sparkRate * dt * 70) {
        this.sparks.emit({
          origin: position.clone().add(new THREE.Vector3(0, m(0.3), 0)),
          velocity: this.skidVelocity.clone().multiplyScalar(-0.3).add(new THREE.Vector3(
            (Math.random() - 0.5) * m(9),
            m(2 + Math.random() * 7),
            (Math.random() - 0.5) * m(9),
          )),
          life: 0.4 + Math.random() * 0.6,
          startSize: m(0.35),
          endSize: m(0.08),
          tint: SPARK_TINT,
        });
      }
      // Emitted on a timer rather than per frame, so the trail behind a
      // sliding airframe is continuous instead of a dotted line.
      this.skidTimer = (this.skidTimer ?? 0) + dt;
      while (this.skidTimer > 0.018) {
        this.skidTimer -= 0.018;
        this.smoke.emit({
          origin: position.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * m(2),
            m(0.4),
            (Math.random() - 0.5) * m(2),
          )),
          velocity: new THREE.Vector3(
            (Math.random() - 0.5) * m(4),
            m(2.5 + Math.random() * 5),
            (Math.random() - 0.5) * m(4),
          ),
          life: 2.6 + Math.random() * 2.6,
          startSize: m(1.4 + Math.random() * 1.4),
          endSize: m(13 + Math.random() * 11),
          tint: new THREE.Color(0x7d7365),
        });
      }
    } else {
      this.skidVelocity.set(0, 0, 0);
    }
    position.y = this.groundAt(position.x, position.z) + m(0.5);
    this.wreck.rotation.set(
      THREE.MathUtils.degToRad(-4),
      -this.skidHeading,
      this.skidRoll,
    );
  }

  /**
   * The camera watches the seat of the fire, not a section of airframe that
   * may be cartwheeling off across the field.
   */
  focusPoint() {
    return this.wreck ? this.wreck.position : this.origin;
  }

  /** Camera shake, strongest at the moment of impact. */
  get shake() {
    const burst = Math.exp(-this.elapsed * 2.6) * (this.destroyed ? 1 : 0.45);
    return burst;
  }

  dispose() {
    // The particle pools are shared and outlive the crash; only retire them.
    this.effects.retire();
    for (const body of this.bodies) {
      this.scene.remove(body.object);
      body.object.traverse?.((node) => {
        if (node.isMesh) {
          node.geometry?.dispose();
          if (node.material && node !== body.object) node.material.dispose?.();
        }
      });
    }
    this.bodies.length = 0;
    if (this.scorchMesh) {
      this.scene.remove(this.scorchMesh);
      this.scorchMesh.geometry.dispose();
      this.scorchMesh.material.map?.dispose();
      this.scorchMesh.material.dispose();
    }
    this.scene.remove(this.flash);
  }
}
