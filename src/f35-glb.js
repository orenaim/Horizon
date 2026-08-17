import * as THREE from "three";
import { asset } from "./asset.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

/**
 * Loads the shangus930 F-35A Lightning II and adapts it to the simulator.
 *
 * "F-35A Lightning II"
 * (https://sketchfab.com/3d-models/f-35a-lightning-ii-a06d6113cfb44a0aa7b8f17106aca9c4)
 * by shangus930 is licensed under Creative Commons Attribution
 * (http://creativecommons.org/licenses/by/4.0/).
 */

const MODEL_PATH = asset("/models/f-35a_lightning_ii.glb");
const REAL_SPAN_METRES = 10.7;

// The download's one animation is a complete undercarriage cycle. The first
// 0.6 seconds hold the closed doors, then the doors open, the three legs travel,
// and the doors settle around them. Everything is down and still at this time;
// the remainder of the 7.29-second clip is another hold.
const GEAR_DOWN_TIME = 4.583;
const GEAR_NODES = [
  "Object_89_72",
  "Armature001_76_76",
  "Armature003_82_82",
  "Armature004_85_88",
  "Armature010_88_94",
  "Armature011_91_100",
  "Armature012_94_106",
  "Armature013_97_112",
  "Armature001_76001_116",
];

let pending = null;
let loaded = null;

/** Kicks the download off early; safe to call more than once. */
export function preloadF35() {
  if (!pending) {
    pending = new GLTFLoader()
      .loadAsync(MODEL_PATH)
      .then((gltf) => {
        loaded = gltf.scene;
        loaded.userData.sourceAnimations = gltf.animations;
        return loaded;
      })
      .catch((error) => {
        console.warn("F-35 model unavailable, falling back to built geometry", error);
        pending = null;
        return null;
      });
  }
  return pending;
}

/** The parsed scene once it has arrived, or null while it is still loading. */
export function f35Source() {
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

/** Adds the simulator's reheat plume behind the downloaded nozzle. */
function addAfterburner(aircraft, controls) {
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
  flame.position.set(0, 0, 9.65);
  flame.visible = false;
  flame.userData.noBounds = true;
  aircraft.add(flame);

  const coreMaterial = flameMaterial.clone();
  coreMaterial.color = new THREE.Color(0xffd9a8);
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.19, 1.5, 14, 1, true), coreMaterial);
  core.rotation.x = -Math.PI / 2;
  core.position.set(0, 0, 8.55);
  core.visible = false;
  core.userData.noBounds = true;
  aircraft.add(core);

  let level = 0;
  controls.afterburner = {
    setThrust(throttle, dt) {
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
}

/** Turns the loaded scene into an aircraft the sim can fly. */
export function buildF35FromModel(source, modelScale = 0.1) {
  const aircraft = new THREE.Group();
  aircraft.name = "F35A";

  // SkeletonUtils keeps each skinned control surface tied to the cloned bones
  // rather than to the cached source scene.
  const model = cloneSkeleton(source);
  model.updateWorldMatrix(true, true);

  const meshes = [];
  model.traverse((node) => {
    if (!node.isMesh) return;
    meshes.push(node);
    node.castShadow = true;
    node.receiveShadow = true;
  });

  const skin = meshes.find(
    (mesh) => triCount(mesh) === 27142 && mesh.material?.name === "mat_4",
  );
  if (!skin) console.warn("F-35 model: airframe skin not identified, using whole-model datum");

  const bounds = boxOf(model);
  const unit = REAL_SPAN_METRES / (bounds.max.x - bounds.min.x);
  const datum = boxOf(skin ?? model).getCenter(new THREE.Vector3()).y;

  // The download is upright but faces local +Z; the simulator's aircraft all
  // fly along -Z. Its authored units are roughly half scale, so derive the
  // conversion from the real span and turn the complete imported scene around.
  model.scale.setScalar(unit);
  model.rotation.y = Math.PI;
  model.position.y = -datum * unit;
  aircraft.add(model);

  const controls = {};
  const gearClip = source.userData.sourceAnimations?.[0];
  const gearAssemblies = GEAR_NODES.map((name) => model.getObjectByName(name)).filter(Boolean);
  const missingGear = GEAR_NODES.filter((name) => !model.getObjectByName(name));
  if (missingGear.length) console.warn("F-35 model: gear nodes not identified —", missingGear.join(", "));
  if (gearClip && gearAssemblies.length === GEAR_NODES.length) {
    const gearMixer = new THREE.AnimationMixer(model);
    gearMixer.clipAction(gearClip).play();
    controls.gearAssemblies = gearAssemblies;
    controls.setGearPosition = (position) => {
      gearMixer.setTime(THREE.MathUtils.clamp(position, 0, 1) * GEAR_DOWN_TIME);
      model.updateWorldMatrix(true, true);
    };
    // Aircraft are presented on the ramp, so build and measure the initial
    // airframe with its wheels down. An air start switches it to frame zero on
    // the first simulation update.
    controls.setGearPosition(1);
  }
  addAfterburner(aircraft, controls);

  aircraft.scale.setScalar(modelScale);
  aircraft.userData.controls = controls;
  aircraft.userData.unitMetres = unit;
  aircraft.userData.modelRoot = model;

  // Starting estimate from the downloaded cockpit; refined against the model
  // in the inspector so the helmet sight sits just beneath the canopy bow.
  aircraft.userData.cockpitEye = new THREE.Vector3(0, 0.24, -4.55);
  aircraft.userData.cockpitLook = new THREE.Vector3(0, -1.16, -24.55);
  aircraft.userData.interiorBuiltIn = true;

  aircraft.rotation.order = "YXZ";
  return aircraft;
}
