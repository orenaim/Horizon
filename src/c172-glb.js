import * as THREE from "three";
import { asset } from "./asset.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Loads the NLM Cessna 172SP and makes it flyable.
 *
 * "FREE Cessna 172SP" (https://skfb.ly/pwATP) by NLM is licensed under
 * Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).
 *
 * Sketchfab's glTF conversion strips object names — every mesh arrives as
 * `Object_44` — and the author worked with Blender's defaults, so the .blend
 * is no better. Parts are therefore identified by geometry: triangle count as
 * a fingerprint, checked against where the part sits in the airframe. If the
 * file is ever replaced the match fails loudly rather than silently animating
 * the wrong mesh.
 *
 * All the work below is done in the file's own coordinates, where the numbers
 * in PARTS can be read directly. The root transform is applied last: the model
 * arrives nose-along-+z at roughly 2.99 m per unit, sitting on its wheels at
 * y = 0, and the sim wants nose-along-−z in metres about the fuselage centre.
 */

const MODEL_PATH = asset("/models/free_cessna_172sp.glb");

// Real Skyhawk span, used to derive the file's unit rather than trusting it.
const REAL_SPAN_METRES = 11.0;

// Ground equipment the model is presented with: red tie-down straps and the
// concrete weights they run to. Keyed by material, which the converter kept.
const GROUND_KIT = new Set(["remove_before_flight", "Concrete"]);
// ?keepkit=1 leaves the ground equipment in place, to check what a material
// covers before trusting it.
const KEEP_KIT = new URLSearchParams(location.search).has("keepkit");

/**
 * Triangle count plus the centre of the part's bounding box, in file units.
 * Triangle counts collide (three parts have 2816), so both are required.
 */
const PARTS = {
  flaps: { tris: 144, at: [0, 0.63, 0.16] },
  ailerons: { tris: 264, at: [0, 0.67, 0.21] },
  elevator: { tris: 40, at: [0, 0.435, -1.18] },
  propeller: { tris: 3200, at: [0, 0.41, 1.24] },
  // The blades' painted tip stripes are a separate layer sitting in the blade
  // plane. Left where the file puts them they hang in the air while the
  // propeller turns underneath.
  propellerStripes: { tris: 256, at: [0, 0.412, 1.227] },
  noseWheel: { tris: 9600, at: [0, 0.06, 1.0] },
  mainWheels: { tris: 19200, at: [0, 0.065, 0.42] },
  // The left wing lift strut. The model ships one and only one: every other
  // asymmetric part comes as a mirrored pair, this does not.
  liftStrut: { tris: 1296, at: [0.515, 0.44, 0.64] },
};

const TOLERANCE = 0.06;

/**
 * Parts to drop that share a material with things worth keeping, so they cannot
 * be removed by material like the ground kit is. Same fingerprint as PARTS;
 * fill it from the `?inspect=1` overlay.
 */
const PRUNE = [
  // Stray rod spanning the main gear track at axle height, attached to nothing.
  { tris: 1796, at: [0, 0.074, 0.394] },
  // Tie-down hardware under each wing: the eyelets and shackles the straps
  // clipped to. Tiny, but once the straps come off they hang under the wing
  // attached to nothing. Their bounding boxes look full-span only because each
  // is a pair sitting out at roughly 2.6 m either side.
  { tris: 8056, at: [0, 0.625, 0.365] },
  { tris: 2816, at: [0, 0.634, 0.524] },
  { tris: 512, at: [0, 0.63, 0.526] },
];

/** Hinge lines, in file units: the forward edge each surface swings about. */
const HINGES = {
  flaps: { y: 0.63, z: 0.22 },
  ailerons: { y: 0.67, z: 0.32 },
  elevator: { y: 0.435, z: -1.09 },
};

let pending = null;
let loaded = null;

/** Kicks the download off early; safe to call more than once. */
export function preloadC172() {
  if (!pending) {
    pending = new GLTFLoader()
      .loadAsync(MODEL_PATH)
      .then((gltf) => {
        loaded = gltf.scene;
        return loaded;
      })
      .catch((error) => {
        console.warn("C172 model unavailable, falling back to built geometry", error);
        pending = null;
        return null;
      });
  }
  return pending;
}

/** The parsed scene once it has arrived, or null while it is still loading. */
export function c172Source() {
  return loaded;
}

function boxOf(object) {
  return new THREE.Box3().setFromObject(object);
}

/**
 * Splits a mesh down the centreline so the two halves can move independently.
 * The ailerons arrive as a single object spanning both wings, and ailerons
 * deflect in opposite directions.
 */
function splitBySide(mesh) {
  const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const position = source.attributes.position;
  const keep = { left: {}, right: {} };
  for (const name of Object.keys(source.attributes)) {
    keep.left[name] = [];
    keep.right[name] = [];
  }
  for (let tri = 0; tri < position.count / 3; tri += 1) {
    const centre =
      (position.getX(tri * 3) + position.getX(tri * 3 + 1) + position.getX(tri * 3 + 2)) / 3;
    // Model +x becomes aircraft −x once the airframe is turned to face −z, so
    // the positive half is the aircraft's left.
    const side = centre >= 0 ? "left" : "right";
    for (const [name, attribute] of Object.entries(source.attributes)) {
      for (let v = 0; v < 3; v += 1) {
        const i = tri * 3 + v;
        for (let c = 0; c < attribute.itemSize; c += 1) {
          keep[side][name].push(attribute.array[i * attribute.itemSize + c]);
        }
      }
    }
  }
  const halves = {};
  for (const side of ["left", "right"]) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) {
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(new Float32Array(keep[side][name]), attribute.itemSize),
      );
    }
    geometry.computeVertexNormals();
    const half = new THREE.Mesh(geometry, mesh.material);
    // The geometry is in the source mesh's local space, so the halves have to
    // inherit its placement or they land at the parent's origin.
    half.position.copy(mesh.position);
    half.quaternion.copy(mesh.quaternion);
    half.scale.copy(mesh.scale);
    half.castShadow = true;
    halves[side] = half;
  }
  return halves;
}

/**
 * Re-parents a mesh under a group placed at a point given in model space, so
 * rotating the group turns the part about its real axis rather than about the
 * model origin.
 *
 * Two details matter. The mesh sits down a chain of group nodes that each carry
 * their own transform, so the point is converted into the parent's frame and
 * `attach` is used, which preserves the mesh's world placement. And the model
 * is turned through 180° to face the sim's nose-along-−z, which would reverse
 * every rotation applied inside it — so the pivot hangs off a frame carrying
 * the opposite turn, leaving its own axes aligned with the aircraft's. The rest
 * of the sim can then drive it exactly as it drives a hand-built airframe.
 */
function pivotAt(mesh, model, point) {
  const parent = mesh.parent;
  parent.updateWorldMatrix(true, false);
  const frame = new THREE.Group();
  frame.position.copy(parent.worldToLocal(model.localToWorld(point.clone())));
  frame.rotation.y = Math.PI;
  parent.add(frame);
  const pivot = new THREE.Group();
  frame.add(pivot);
  pivot.attach(mesh);
  return pivot;
}

/** Hinge a control surface about its forward edge. */
function hingeAt(mesh, model, hinge) {
  return pivotAt(mesh, model, new THREE.Vector3(0, hinge.y, hinge.z));
}

/**
 * Splits a full-span surface into left and right halves and hinges each. The
 * model carries the pair as one object; the sim drives them separately, which
 * ailerons in particular require.
 */
function hingePair(mesh, model, hinge) {
  const halves = splitBySide(mesh);
  const parent = mesh.parent;
  mesh.removeFromParent();
  parent.add(halves.left, halves.right);
  return {
    left: hingeAt(halves.left, model, hinge),
    right: hingeAt(halves.right, model, hinge),
  };
}

/**
 * Copies a part across the centreline. Used for the right wing lift strut, which
 * the model simply does not have — mirroring the left one matches its section,
 * material and fittings exactly, which building a replacement would not.
 *
 * The geometry is baked into the model's own frame first, because the source
 * sits under a chain of transformed group nodes. Negating x reverses triangle
 * winding, so the index is flipped to keep the faces pointing outwards.
 */
function mirrorAcrossCentreline(mesh, model) {
  model.updateWorldMatrix(true, false);
  mesh.updateWorldMatrix(true, false);
  const intoModel = new THREE.Matrix4().copy(model.matrixWorld).invert().multiply(mesh.matrixWorld);

  const geometry = mesh.geometry.clone().applyMatrix4(intoModel);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) position.setX(i, -position.getX(i));

  const index = geometry.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const first = index.getX(i);
      index.setX(i, index.getX(i + 2));
      index.setX(i + 2, first);
    }
    index.needsUpdate = true;
  }
  geometry.computeVertexNormals();

  const twin = new THREE.Mesh(geometry, mesh.material);
  twin.castShadow = true;
  model.add(twin);
  return twin;
}

/**
 * Turns the loaded scene into an aircraft the sim can fly. Returns the same
 * shape `buildC172Model` does, so either can back the C172.
 */
export function buildC172FromModel(source, modelScale = 0.1) {
  const aircraft = new THREE.Group();
  aircraft.name = "C172S Skyhawk";

  // Worked on a copy: the cached scene backs every rebuild.
  const model = source.clone(true);

  // Bake the file's own node transforms into world-consistent positions, so
  // the measurements in PARTS (taken from the glTF with transforms applied)
  // can be compared against Box3 results directly.
  model.updateWorldMatrix(true, true);

  const meshes = [];
  model.traverse((node) => {
    if (node.isMesh) meshes.push(node);
  });

  // Strip the ground equipment before anything is measured, so the tie-downs
  // do not stretch the airframe's bounding box.
  for (const mesh of meshes) {
    const name = Array.isArray(mesh.material)
      ? mesh.material.map((m) => m.name).join(",")
      : mesh.material?.name;
    if (!KEEP_KIT && GROUND_KIT.has(name)) mesh.removeFromParent();
  }

  const triCount = (mesh) => {
    const geometry = mesh.geometry;
    return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
  };
  const matches = (mesh, want) =>
    Math.round(triCount(mesh)) === want.tris &&
    boxOf(mesh).getCenter(new THREE.Vector3()).distanceTo(new THREE.Vector3().fromArray(want.at)) <
      TOLERANCE;

  if (!KEEP_KIT) {
    for (const want of PRUNE) {
      const mesh = meshes.find((m) => m.parent && matches(m, want));
      if (mesh) mesh.removeFromParent();
      else console.warn("C172 model: nothing to prune at", want.at.join(", "));
    }
  }

  const live = meshes.filter((mesh) => mesh.parent);

  // Match each wanted part by fingerprint.
  const found = {};
  const missing = [];
  for (const [key, want] of Object.entries(PARTS)) {
    const match = live.find((mesh) => matches(mesh, want));
    if (match) found[key] = match;
    else missing.push(key);
  }
  if (missing.length) console.warn("C172 model: parts not identified —", missing.join(", "));

  if (found.liftStrut) mirrorAcrossCentreline(found.liftStrut, model);

  const controls = {};
  if (found.flaps) {
    const flap = hingePair(found.flaps, model, HINGES.flaps);
    controls.flapL = flap.left;
    controls.flapR = flap.right;
  }
  if (found.ailerons) {
    const aileron = hingePair(found.ailerons, model, HINGES.ailerons);
    controls.aileronL = aileron.left;
    controls.aileronR = aileron.right;
  }
  if (found.elevator) {
    const elevator = hingePair(found.elevator, model, HINGES.elevator);
    controls.elevatorL = elevator.left;
    controls.elevatorR = elevator.right;
  }
  if (found.propeller) {
    // Spin about the crankshaft, and give the blades their own material so the
    // cockpit view can fade them to a disc without touching anything else.
    controls.propeller = pivotAt(found.propeller, model, new THREE.Vector3(0, 0.41, 1.24));
    const blades = [found.propeller];
    // The stripe layer turns with the blades it is painted on. `attach` keeps
    // it exactly where it sits while changing what it hangs from.
    if (found.propellerStripes) {
      controls.propeller.attach(found.propellerStripes);
      blades.push(found.propellerStripes);
    }
    for (const blade of blades) {
      blade.material = blade.material.clone();
      blade.material.transparent = true;
    }
    controls.propellerBlade = blades;
  }
  if (found.noseWheel) controls.noseWheel = found.noseWheel;

  for (const mesh of live) {
    mesh.castShadow = true;
    // The glazing ships as fully metallic mid-grey, which mirrors rather than
    // transmits: from the cockpit the whole world arrives dimmed and blue.
    // Aircraft glass is near-clear, so it is retuned to behave like glass.
    const material = mesh.material;
    if (material?.name === "Window" && !material.userData.retuned) {
      material.userData.retuned = true;
      material.metalness = 0;
      material.roughness = 0.06;
      material.color.setHex(0xeef4f6);
      material.opacity = 0.18;
    }
  }

  // Root transform, applied once everything above is placed. The file runs
  // nose-along-+z; the sim runs nose-along-−z.
  const airframe = boxOf(model);
  const unit = REAL_SPAN_METRES / (airframe.max.x - airframe.min.x);
  const centreline = ((airframe.min.y + airframe.max.y) / 2) * unit;

  model.scale.setScalar(unit);
  model.rotation.y = Math.PI;
  model.position.y = -centreline;
  aircraft.add(model);

  aircraft.scale.setScalar(modelScale);
  aircraft.userData.controls = controls;
  aircraft.userData.unitMetres = unit;
  // The inspector (`?inspect=1`) reports coordinates in the file's own units.
  aircraft.userData.modelRoot = model;

  // Left seat, measured against the model's own furniture: the seat cushion
  // tops out at y = -0.27 and the panel face stands at z = -2.26, putting the
  // eye about 0.75 m back from the instruments with the headliner just clear.
  // Sitting lower fills the frame with cowl instead of horizon.
  // The gaze sits 6° below level — level puts the panel off the bottom of the
  // frame, and this is roughly the sight picture over a real glareshield.
  const eye = new THREE.Vector3(-0.22, 0.52, -1.5);
  const reach = 10.4;
  aircraft.userData.cockpitEye = eye;
  aircraft.userData.cockpitLook = eye
    .clone()
    .add(new THREE.Vector3(0, -Math.tan(THREE.MathUtils.degToRad(6)) * reach, -reach));
  // The interior is part of the model rather than a separate group, so the
  // airframe stays drawn in the cockpit view instead of being switched out.
  aircraft.userData.interiorBuiltIn = true;
  return aircraft;
}
