import * as THREE from "three";
import { asset } from "./asset.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Loads the Raakesh.Madan A380 and makes it flyable.
 *
 * "Airbus A380(full interior hd)"
 * (https://sketchfab.com/3d-models/airbus-a380full-interior-hd-3155062bc0e545f897e8d766dbe7299e)
 * by Raakesh.Madan is licensed under Creative Commons Attribution
 * (http://creativecommons.org/licenses/by/4.0/).
 *
 * The file came through Sketchfab's OBJ pipeline, which merged the geometry by
 * material: every mesh is a material group spanning the whole airframe rather
 * than a part, so the C172's triangle-count fingerprints have nothing to bite
 * on here. The material names survived, though, and they are descriptive — so
 * parts are matched by material instead, checked against where the group sits.
 *
 * That merge also fixes what can be animated. The wing skin carries the
 * ailerons, flaps and spoilers in the same group as the panels they hinge from,
 * so the aircraft flies with fixed control surfaces, which the sim tolerates —
 * every entry in `controls` is optional. The undercarriage is separable, since
 * the legs stand clear of everything around them, and it is carved out and hung
 * on its trunnions below. What the file has that the built A380 cannot match is
 * a photographed flight deck, so the cabin is stripped and the cockpit kept.
 *
 * The measurements below are in the file's own units, which are metres, with x
 * across the span, y along the fuselage and z up. The root node carries glTF's
 * Y-up conversion and a 0.317 display scale, and the loader applies it: by the
 * time the scene arrives the model stands upright with its nose along −z, which
 * is the way the sim wants it. Nothing is turned here, then — the file's numbers
 * are put through that same transform to be compared against what is loaded, and
 * only the scale and the vertical datum are reset.
 */

const MODEL_PATH = asset("/models/airbus_a380full_interior_hd.glb");

// Real A380-800 span, used to derive the file's unit rather than trusting the
// display scale on the root node.
const REAL_SPAN_METRES = 79.75;

/**
 * Cabin fit-out: seats, bins, linings and trim, across both decks and the full
 * length of the tube. Around 43k of the model's 127k triangles, none of it ever
 * visible — the sim flies from the flight deck or from outside. Keyed by
 * material, which is all the merge left to key on.
 *
 * Every group here sits inside the fuselage skin (which spans x ±3.5, z 0.8 to
 * 10.5) and aft of the flight deck bulkhead at y = 24.4, and `buildA380FromModel`
 * checks that before dropping anything: if the file is ever replaced by one
 * whose materials are laid out differently, the prune fails loudly rather than
 * quietly taking the roof off.
 */
const CABIN = new Set([
  "A380A380interiorSG1",
  "A380A380interiorSG3",
  "A380A380misciSG1",
  "A380A380misciSG3",
  "A380A380misciiSG1",
  "A380A380alphaSG1",
]);

/** The cabin lies within this box, in file units. */
const CABIN_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-3.4, -26, 4.4),
  new THREE.Vector3(3.4, 24.4, 8.0),
);

// ?keepcabin=1 leaves the fit-out in place, to see what the seats look like
// before trusting the material list.
const KEEP_CABIN = new URLSearchParams(location.search).has("keepcabin");

/**
 * The fuselage skin, matched by material and triangle count. Only its vertical
 * extent is wanted: it sets the datum the airframe is centred on, and so the
 * point the aircraft pitches and rolls about. Taking the whole model's bounding
 * box instead would put that four metres up, halfway to the top of the fin.
 */
const FUSELAGE = { material: "A380A380misc_aSG1", tris: 3508 };

// Fallback datum if the skin cannot be found: the fuselage centreline sits
// 5.6 m above the file's ground plane.
const FUSELAGE_CENTRE_Z = 5.64;

/**
 * The undercarriage. Five units — nose, and a wing and a body unit each side —
 * carved out of the meshes they were merged into by the box each stands in.
 *
 * `source` names that mesh by triangle count, because the material is shared
 * with the belly panels and with a scatter of small fittings strung along the
 * airframe, and a box drawn round a leg catches whichever of those happen to
 * pass overhead. The legs themselves come two to a mesh, left pair and right
 * pair, with the nose leg in a third; a box only has to tell a wing leg from a
 * body leg, and 1.4 m of empty air separates them.
 *
 * Boxes, trunnions and axes are in file units. The wing units fold inboard about
 * the fuselage axis and the nose and body units fold forward, as the real ones
 * do; `angle` is the degrees each swings through, signed to fold the right way.
 *
 * The trunnions are not quite where the real ones are. The model has no wheel
 * wells — the legs simply meet the skin — so a hinge at the top of the leg
 * swings it through the skin and leaves it hanging outside: the nose leg ends up
 * under the radome, and the body wheels stand proud of the belly. Each hinge is
 * therefore placed where the swing carries the leg inside the fuselage instead,
 * which for the nose means a metre above the leg and half a metre behind it. The
 * legs are still drawn hanging in the airflow through the whole travel, as they
 * should be; it is only where they finish that is contrived.
 */
const GEAR_MATERIAL = "A380A380misc_aSG3";
const GEAR_UNITS = [
  { name: "nose gear", source: 2868, box: [[-1.2, 20, -1.5], [1.2, 26, 3]], trunnion: [0, 23, 3.3], axis: [1, 0, 0], angle: 90 },
  // The nose gear doors are modelled hanging open and were welded into the
  // fuselage skin, so left alone they stay open for the whole flight — a panel
  // under the nose at cruise. They are lifted out with the legs and carried as a
  // unit that does not swing: doors stand open while the gear is travelling, and
  // the unit is hidden once it is stowed, which leaves the skin above the bay
  // showing as a flush belly.
  { name: "nose gear doors", material: FUSELAGE.material, source: FUSELAGE.tris, box: [[-0.9, 21.9, 0.6], [0.9, 23, 2.05]], trunnion: [0, 23, 3.3], axis: [1, 0, 0], angle: 0 },
  { name: "left body gear", source: 8853, box: [[-4.75, -14, -1.5], [-0.5, -2, 4]], trunnion: [-2.64, -9.38, 4.3], axis: [1, 0, 0], angle: 90 },
  { name: "right body gear", source: 8853, box: [[0.5, -14, -1.5], [4.75, -2, 4]], trunnion: [2.64, -9.38, 4.3], axis: [1, 0, 0], angle: 90 },
  { name: "left wing gear", source: 8853, box: [[-8.5, -14, -1.5], [-4.75, -2, 4]], trunnion: [-6.38, -5.57, 3.44], axis: [0, 1, 0], angle: -90 },
  { name: "right wing gear", source: 8853, box: [[4.75, -14, -1.5], [8.5, -2, 4]], trunnion: [6.38, -5.57, 3.44], axis: [0, 1, 0], angle: 90 },
];

/**
 * Captain's eye, in file units, and the gaze in degrees below level.
 *
 * Placed against the glazing rather than the floor, which the model draws well
 * above the seat pan: the windscreen runs from z = 6.45 to 7.16, and an eye
 * outside that band looks at the roof lining or the glareshield instead of out.
 * Half a metre left of the centreline puts the captain's displays ahead and the
 * pedestal to the right, and 8° down sets the horizon a third of the way up the
 * frame with the runway visible over the glareshield.
 */
const EYE = new THREE.Vector3(-0.55, 25.3, 6.84);
const EYE_DEPRESSION = 8;

let pending = null;
let loaded = null;

/** Kicks the download off early; safe to call more than once. */
export function preloadA380() {
  if (!pending) {
    pending = new GLTFLoader()
      .loadAsync(MODEL_PATH)
      .then((gltf) => {
        loaded = gltf.scene;
        return loaded;
      })
      .catch((error) => {
        console.warn("A380 model unavailable, falling back to built geometry", error);
        pending = null;
        return null;
      });
  }
  return pending;
}

/** The parsed scene once it has arrived, or null while it is still loading. */
export function a380Source() {
  return loaded;
}

function boxOf(object) {
  return new THREE.Box3().setFromObject(object);
}

function triCount(mesh) {
  const geometry = mesh.geometry;
  return Math.round(
    (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3,
  );
}

function materialName(mesh) {
  return Array.isArray(mesh.material)
    ? mesh.material.map((m) => m.name).join(",")
    : (mesh.material?.name ?? "");
}

/**
 * Lifts the triangles whose centres fall inside `box` out of a mesh, leaving it
 * with the rest. Returns the piece taken, or null if the box caught nothing.
 *
 * This is how a part is separated from a group it was merged into. Splitting on
 * the triangle centre rather than the vertices means a triangle that straddles
 * the boundary goes one way whole instead of being torn, which is why the boxes
 * are drawn through empty space.
 *
 * The mesh nodes in this file carry no transforms of their own, so the geometry
 * is already in the file's coordinates and the box can be applied to it as it
 * stands.
 */
function carveOut(mesh, box) {
  const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const position = source.attributes.position;
  const names = Object.keys(source.attributes);
  const taken = Object.fromEntries(names.map((name) => [name, []]));
  const left = Object.fromEntries(names.map((name) => [name, []]));
  const centre = new THREE.Vector3();

  for (let tri = 0; tri < position.count / 3; tri += 1) {
    centre.set(0, 0, 0);
    for (let v = 0; v < 3; v += 1) {
      centre.x += position.getX(tri * 3 + v) / 3;
      centre.y += position.getY(tri * 3 + v) / 3;
      centre.z += position.getZ(tri * 3 + v) / 3;
    }
    const keep = box.containsPoint(centre) ? taken : left;
    for (const name of names) {
      const attribute = source.attributes[name];
      for (let v = 0; v < 3; v += 1) {
        const i = (tri * 3 + v) * attribute.itemSize;
        for (let c = 0; c < attribute.itemSize; c += 1) keep[name].push(attribute.array[i + c]);
      }
    }
  }

  if (!taken.position.length) return null;

  const build = (attributes) => {
    const geometry = new THREE.BufferGeometry();
    for (const name of names) {
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(
          new Float32Array(attributes[name]),
          source.attributes[name].itemSize,
        ),
      );
    }
    return geometry;
  };

  // The remainder replaces the mesh's geometry in place, so anything already
  // holding the mesh keeps holding it; a mesh carved down to nothing goes.
  if (left.position.length) mesh.geometry = build(left);
  else mesh.removeFromParent();

  const piece = new THREE.Mesh(build(taken), mesh.material);
  piece.castShadow = true;
  piece.receiveShadow = true;
  return piece;
}

/**
 * Carves the undercarriage out of the merged meshes and hangs each unit on its
 * trunnion, so the sim can raise and lower it.
 *
 * The units are parented to the file's own root node, which is the frame the
 * boxes and pivots are measured in and the frame `updateGear` rotates them in.
 * Each sits at its parent's origin with the geometry offset inside it, which is
 * what the sim's retraction expects.
 */
function buildGear(root, meshes) {
  // Taken before the first carve, which changes the counts the rest are
  // matched on.
  const sources = meshes.map((mesh) => ({
    mesh,
    material: materialName(mesh),
    tris: triCount(mesh),
  }));

  const assemblies = [];
  for (const unit of GEAR_UNITS) {
    const box = new THREE.Box3(
      new THREE.Vector3(...unit.box[0]),
      new THREE.Vector3(...unit.box[1]),
    );
    const assembly = new THREE.Group();
    assembly.name = unit.name;
    const material = unit.material ?? GEAR_MATERIAL;
    for (const source of sources) {
      if (source.material !== material || source.tris !== unit.source) continue;
      if (!source.mesh.parent) continue;
      const piece = carveOut(source.mesh, box);
      if (piece) assembly.add(piece);
    }
    if (!assembly.children.length) {
      console.warn(`A380 model: no ${unit.name} found, undercarriage left fixed`);
      return [];
    }
    assembly.userData.retract = {
      pivot: new THREE.Vector3(...unit.trunnion),
      axis: new THREE.Vector3(...unit.axis),
      angle: THREE.MathUtils.degToRad(unit.angle),
    };
    root.add(assembly);
    assemblies.push(assembly);
  }
  return assemblies;
}

/**
 * Turns the loaded scene into an aircraft the sim can fly. Returns the same
 * shape `buildA380Model` does, so either can back the A380.
 */
export function buildA380FromModel(source, modelScale = 0.1) {
  const aircraft = new THREE.Group();
  aircraft.name = "A380-800";

  // Worked on a copy: the cached scene backs every rebuild.
  const model = source.clone(true);

  // Bake the file's own node transforms into world-consistent positions, so
  // bounding boxes can be compared directly. `intoModel` carries the file's
  // frame into that space: the constants above go through it, rather than the
  // model being turned to meet them.
  model.updateWorldMatrix(true, true);
  const root = model.children[0] ?? model;
  const intoModel = root.matrix;

  const meshes = [];
  model.traverse((node) => {
    if (node.isMesh) meshes.push(node);
  });

  // Strip the cabin before anything is measured. The seats do not reach the
  // skin, so they cannot stretch the airframe's bounding box, but the flight
  // deck datum below is taken from what is left.
  if (!KEEP_CABIN) {
    const bounds = CABIN_BOUNDS.clone().applyMatrix4(intoModel);
    const dropped = new Set();
    for (const mesh of meshes) {
      const name = materialName(mesh);
      if (!CABIN.has(name)) continue;
      if (!bounds.containsBox(boxOf(mesh))) {
        console.warn(`A380 model: ${name} reaches outside the cabin, left in place`);
        continue;
      }
      mesh.removeFromParent();
      dropped.add(name);
    }
    const absent = [...CABIN].filter((name) => !dropped.has(name));
    if (absent.length) console.warn("A380 model: cabin groups not found —", absent.join(", "));
  }

  // Vertical datum: the centre of the fuselage skin, so the aircraft pitches and
  // rolls about its tube rather than about a point up the fin. Measured before
  // the undercarriage is carved, which takes the nose gear doors out of the skin
  // and would otherwise both spoil its fingerprint and lift its underside.
  const skin = meshes.find(
    (mesh) =>
      mesh.parent
      && materialName(mesh) === FUSELAGE.material
      && triCount(mesh) === FUSELAGE.tris,
  );
  if (!skin) console.warn("A380 model: fuselage skin not identified, using nominal centreline");
  const datum = skin
    ? boxOf(skin).getCenter(new THREE.Vector3()).y
    : new THREE.Vector3(0, 0, FUSELAGE_CENTRE_Z).applyMatrix4(intoModel).y;

  const gear = buildGear(root, meshes);
  const live = meshes.filter((mesh) => mesh.parent);

  for (const mesh of live) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // The glazing ships fully metallic, which mirrors rather than transmits:
    // from the flight deck the whole world arrives dimmed and grey.
    const material = mesh.material;
    if (material?.name === "A380A380glassSG1" && !material.userData.retuned) {
      material.userData.retuned = true;
      material.metalness = 0;
      material.roughness = 0.05;
      material.transparent = true;
      material.opacity = 0.2;
      material.color.setHex(0xeef4f6);
    }
  }

  // Root transform, applied once everything above is measured. The file is
  // already the right way up and the right way round; what it is not is life
  // size, so the display scale on the root node is overridden by one derived
  // from the span, and the airframe is dropped onto its datum.
  const airframe = boxOf(model);
  const unit = REAL_SPAN_METRES / (airframe.max.x - airframe.min.x);

  model.scale.setScalar(unit);
  model.position.y = -datum * unit;
  aircraft.add(model);

  aircraft.scale.setScalar(modelScale);
  // The undercarriage is the only thing the merge left separable; the control
  // surfaces stay where the file put them.
  aircraft.userData.controls = gear.length ? { gearAssemblies: gear } : {};
  aircraft.userData.unitMetres = unit;
  // The file's own node, so the inspector (`?inspect=a380`) reports coordinates
  // in the frame every measurement in this module is written in.
  aircraft.userData.modelRoot = root;

  // The eye is measured in the file's frame, so it goes through the same
  // transform and the same scaling as the airframe it sits in.
  const eye = EYE.clone().applyMatrix4(intoModel);
  eye.y -= datum;
  eye.multiplyScalar(unit);
  const reach = 60;
  aircraft.userData.cockpitEye = eye;
  aircraft.userData.cockpitLook = eye
    .clone()
    .add(new THREE.Vector3(0, -Math.tan(THREE.MathUtils.degToRad(EYE_DEPRESSION)) * reach, -reach));
  // The flight deck is part of the airframe rather than a separate group, so it
  // stays drawn in the cockpit view instead of being switched in.
  aircraft.userData.interiorBuiltIn = true;
  return aircraft;
}
