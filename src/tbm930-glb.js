import * as THREE from "three";
import { asset } from "./asset.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Loads helijah's Daher TBM 930 and makes it flyable.
 *
 * "Daher TBM 930"
 * (https://sketchfab.com/3d-models/daher-tbm-930-ba21567b779040038081f084fc528a44)
 * by helijah (Emmanuel Baranger) is licensed under Creative Commons Attribution
 * (http://creativecommons.org/licenses/by/4.0/).
 *
 * The GLB is built from the author's original OBJ by
 * `scripts/build-tbm-model.mjs`, which keeps every part as its own node under
 * the author's (French) object names. Sketchfab's conversion fused them.
 *
 * The file is in metres, y up, nose along −x, with the left wing along +z; the
 * suffixes G and D are gauche and droite, left and right. Everything below is
 * done in those coordinates, and the root transform is applied last.
 */

const MODEL_PATH = asset("/models/daher_tbm_930.glb");

// Real TBM 930 length, used to derive the file's unit rather than trusting it.
// Span is no use here: the model's winglets make it read 0.5 m wide.
const REAL_LENGTH_METRES = 10.74;

// Stowed angles. The mains fold inboard, each wheel into the round bay the
// model has cut in the wing root, and the fairing door on the leg closes the
// slot the leg drops through. They stop 7° short of square so the door lies
// along the underside of a wing with that much dihedral. The nose leg is raked forward, so it swings a little past square
// to lie flat in its bay.
const MAIN_RETRACT = THREE.MathUtils.degToRad(83);
const NOSE_RETRACT = THREE.MathUtils.degToRad(110);
const NOSE_DOOR_CLOSE = THREE.MathUtils.degToRad(90);

// The legs travel over this share of the cycle; the nose doors close in the
// rest, once the leg is clear of them, and open first on the way down.
const DOOR_SHARE = 0.25;

let pending = null;
let loaded = null;

/** Kicks the download off early; safe to call more than once. */
export function preloadTbm930() {
  if (!pending) {
    pending = new GLTFLoader()
      .loadAsync(MODEL_PATH)
      .then((gltf) => {
        loaded = gltf.scene;
        return loaded;
      })
      .catch((error) => {
        console.warn("TBM 930 model unavailable, falling back to built geometry", error);
        pending = null;
        return null;
      });
  }
  return pending;
}

/** The parsed scene once it has arrived, or null while it is still loading. */
export function tbm930Source() {
  return loaded;
}

const v = (x, y, z) => new THREE.Vector3(x, y, z);

// The sim's axes as seen from inside the file: right is −z, up is +y, aft is +x.
const SIM_RIGHT = v(0, 0, -1);
const SIM_UP = v(0, 1, 0);

/**
 * Hinge lines, from the forward edge of each surface at its two ends, measured
 * off the vertices. The wing has about 7° of dihedral and some sweep, and the
 * tailplane and fin more, so no surface hinges about a model axis.
 */
const HINGES = {
  voletG: [v(-0.148, -1.173, 0.788), v(-0.377, -0.611, 5.136)],
  voletD: [v(-0.148, -1.173, -0.788), v(-0.377, -0.611, -5.136)],
  aileronG: [v(-0.498, -0.594, 5.19), v(-0.542, -0.468, 6.222)],
  aileronD: [v(-0.498, -0.594, -5.19), v(-0.542, -0.468, -6.222)],
  // The elevators' inboard ends are cut back to clear the rudder, and their
  // tips are rounded, so these are taken from the straight run between.
  profondeurG: [v(4.861, 0.073, 0.1), v(4.471, 0.39, 2.376)],
  profondeurD: [v(4.861, 0.073, -0.1), v(4.471, 0.39, -2.376)],
  direction: [v(4.214, 0.205, 0), v(4.612, 1.942, 0)],
};

/**
 * A frame at `origin` whose axes are the sim's right, up and aft, turned so
 * the named one runs along `axis`. A part hung from it can then be driven
 * exactly as a hand-built airframe's is: `rotation.x` about a hinge running
 * spanwise, `rotation.y` about one running up the fin.
 */
function simFrame(origin, axis, along = "x") {
  const x = SIM_RIGHT.clone();
  const y = SIM_UP.clone();
  if (along === "x") {
    x.copy(axis).multiplyScalar(Math.sign(axis.dot(SIM_RIGHT)) || 1).normalize();
    y.sub(x.clone().multiplyScalar(y.dot(x))).normalize();
  } else {
    y.copy(axis).multiplyScalar(Math.sign(axis.dot(SIM_UP)) || 1).normalize();
    x.sub(y.clone().multiplyScalar(x.dot(y))).normalize();
  }
  const z = new THREE.Vector3().crossVectors(x, y);
  const frame = new THREE.Group();
  frame.position.copy(origin);
  frame.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return frame;
}

/** Hangs `meshes` from a pivot in `frame`, keeping them where they are. */
function hang(model, frame, meshes) {
  model.add(frame);
  frame.updateWorldMatrix(true, false);
  const pivot = new THREE.Group();
  frame.add(pivot);
  for (const mesh of meshes) pivot.attach(mesh);
  return pivot;
}

/** Turns the loaded scene into an aircraft the sim can fly. */
export function buildTbm930FromModel(source, modelScale = 0.1) {
  const aircraft = new THREE.Group();
  aircraft.name = "Daher TBM 930";

  // Worked on a copy: the cached scene backs every rebuild.
  const model = source.clone(true);
  model.updateWorldMatrix(true, true);

  const parts = {};
  const missing = [];
  model.traverse((node) => {
    if (node.isMesh) {
      parts[node.name] = node;
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  const need = (...names) => {
    const found = names.map((name) => parts[name]);
    names.forEach((name, i) => { if (!found[i]) missing.push(name); });
    return found.every(Boolean) ? found : null;
  };

  // The twin ventral fins under the tail are real, but angled out from the
  // belly they read from the side as a hatch hanging open. Left off for a
  // clean belly.
  parts.ajouts?.removeFromParent();

  const controls = {};

  // Control surfaces, each on its own measured hinge line.
  const surface = (name, key, along = "x") => {
    const mesh = need(name)?.[0];
    if (!mesh) return;
    const [a, b] = HINGES[name];
    controls[key] = hang(model, simFrame(a, b.clone().sub(a), along), [mesh]);
  };
  surface("voletG", "flapL");
  surface("voletD", "flapR");
  surface("aileronG", "aileronL");
  surface("aileronD", "aileronR");
  surface("profondeurG", "elevatorL");
  surface("profondeurD", "elevatorR");
  surface("direction", "rudder", "y");

  // Five blades and the spinner turn about the crankshaft, which runs along
  // the file's x axis through the spinner's centre. The blades share the
  // airframe's one material, so they get their own for the cockpit-view fade.
  const prop = need("helice", "bol");
  if (prop) {
    const [blades, spinner] = prop;
    controls.propeller = hang(model, simFrame(v(0, -0.64, 0), SIM_RIGHT), [blades, spinner]);
    blades.material = blades.material.clone();
    blades.material.transparent = true;
    controls.propellerBlade = blades;
  }

  // Undercarriage. Each unit hangs from a pivot at the top of its leg, turned
  // about the file's own axes: x runs fore and aft, z spanwise.
  const gear = [];
  const unit = (names, trunnion) => {
    const meshes = need(...names);
    if (!meshes) return null;
    const frame = new THREE.Group();
    frame.position.copy(trunnion);
    const pivot = hang(model, frame, meshes);
    gear.push(pivot);
    return pivot;
  };
  // The main trunnions are not at the leg tops. The wing is only 20 cm deep
  // here and the door stands 20 cm outboard of the leg, so there is one narrow
  // choice of axis that stows the whole wheel inside the wing without the
  // door hanging well below it. This one was found by searching trunnion and
  // angle against the wing's surfaces, sampled from the model: the wheel
  // clears the upper skin and the door lies within 11 cm of the lower.
  const mainL = unit(["axeG", "roueG", "porteG"], v(-0.761, -0.98, 1.91));
  const mainR = unit(["axeD", "roueD", "porteD"], v(-0.761, -0.98, -1.91));
  const nose = unit(["axeA", "roueA"], v(-3.45, -1.195, 0));
  // Nose bay doors, hinged along their top edges against the fuselage.
  const doorL = unit(["porteAG"], v(0, -1.331, 0.162));
  const doorR = unit(["porteAD"], v(0, -1.331, -0.162));

  if (gear.length === 5) {
    const X = v(1, 0, 0);
    const Z = v(0, 0, 1);
    controls.gearAssemblies = gear;
    controls.setGearPosition = (position) => {
      // 1 is down and locked, 0 stowed with the doors shut.
      const legs = THREE.MathUtils.smootherstep(position, DOOR_SHARE, 1);
      const doors = THREE.MathUtils.smootherstep(position, 0, DOOR_SHARE);
      const stowed = 1 - legs;
      mainL.quaternion.setFromAxisAngle(X, MAIN_RETRACT * stowed);
      mainR.quaternion.setFromAxisAngle(X, -MAIN_RETRACT * stowed);
      nose.quaternion.setFromAxisAngle(Z, NOSE_RETRACT * stowed);
      doorL.quaternion.setFromAxisAngle(X, NOSE_DOOR_CLOSE * (1 - doors));
      doorR.quaternion.setFromAxisAngle(X, -NOSE_DOOR_CLOSE * (1 - doors));
    };
    // Presented on the ramp, so built and measured with the wheels down.
    controls.setGearPosition(1);
  }
  if (missing.length) console.warn("TBM 930 model: parts not identified —", missing.join(", "));

  // The glazing arrives as flat 30% grey, which reads as smoked plastic from
  // outside and dims the whole world from inside. Retuned to near-clear glass.
  model.traverse((node) => {
    const material = node.material;
    if (node.isMesh && material?.name === "Transparent" && !material.userData.retuned) {
      material.userData.retuned = true;
      material.color.setHex(0xdfe9ee);
      material.roughness = 0.05;
      material.opacity = 0.2;
      material.depthWrite = false;
      node.castShadow = false;
    }
  });

  // Root transform, applied once everything above is placed: the file's nose
  // runs along −x, the sim's along −z.
  const bounds = new THREE.Box3().setFromObject(model);
  const metres = REAL_LENGTH_METRES / (bounds.max.x - bounds.min.x);
  const centreline = ((bounds.min.y + bounds.max.y) / 2) * metres;
  model.scale.setScalar(metres);
  model.rotation.y = -Math.PI / 2;
  model.position.y = -centreline;
  aircraft.add(model);

  aircraft.scale.setScalar(modelScale);
  aircraft.userData.controls = controls;
  aircraft.userData.unitMetres = metres;
  aircraft.userData.modelRoot = model;

  // Left seat: the cushion runs from x = −1.47 to −0.99 on the +z side, and the
  // glareshield tops out at y = −0.05. The eye sits just above it, over the
  // seat's forward half, looking 6° down across the panel.
  model.updateWorldMatrix(true, false);
  const toAircraft = (point) =>
    point.clone().applyMatrix4(model.matrix);
  const eye = toAircraft(v(-1.12, 0.02, 0.33));
  const reach = 10.4;
  aircraft.userData.cockpitEye = eye;
  aircraft.userData.cockpitLook = eye
    .clone()
    .add(new THREE.Vector3(0, -Math.tan(THREE.MathUtils.degToRad(6)) * reach, -reach));
  aircraft.userData.interiorBuiltIn = true;
  return aircraft;
}
