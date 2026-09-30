// Builds public/models/daher_tbm_930.glb from the author's original OBJ.
//
// "Daher TBM 930"
// (https://sketchfab.com/3d-models/daher-tbm-930-ba21567b779040038081f084fc528a44)
// by helijah (Emmanuel Baranger) is licensed under Creative Commons Attribution
// (http://creativecommons.org/licenses/by/4.0/).
//
// Sketchfab's own GLB conversion merges every part that shares a material into
// one mesh, which fuses the flaps, gear legs, wheels and doors into the
// airframe. The original OBJ keeps each part as a named object, so it is
// converted here instead, one glTF node per object, names intact.
//
// Usage: node scripts/build-tbm-model.mjs <folder holding tbm930.obj/.mtl/pngs>
// (the folder is the unzipped `source/tbm930.zip` from the Sketchfab download).

import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const sourceDir = process.argv[2];
if (!sourceDir) {
  console.error("usage: node scripts/build-tbm-model.mjs <unzipped tbm930 source folder>");
  process.exit(1);
}
const OUT = new URL("../public/models/daher_tbm_930.glb", import.meta.url);

// --- Materials -------------------------------------------------------------

/** Name → { texture file or null, opacity }, read from the Blender .mtl. */
function readMtl(file) {
  const materials = new Map();
  let current = null;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const [key, ...rest] = line.trim().split(/\s+/);
    if (key === "newmtl") {
      current = { texture: null, opacity: 1 };
      materials.set(rest.join(" "), current);
    } else if (current && key === "map_Kd") {
      current.texture = rest.join(" ");
    } else if (current && key === "d") {
      current.opacity = Number(rest[0]);
    }
  }
  return materials;
}

const mtl = readMtl(path.join(sourceDir, "tbm930.mtl"));

// --- Geometry --------------------------------------------------------------

const root = new OBJLoader().parse(fs.readFileSync(path.join(sourceDir, "tbm930.obj"), "utf8"));

/** Blender exports objects as `<object>_<mesh>`; the object half is the name. */
const objectName = (name) => name.replace(/_[^_]*\.mesh(\.\d+)?$/, "");

// --- GLB writer --------------------------------------------------------------

const chunks = [];
let byteLength = 0;
const gltf = {
  asset: { version: "2.0", generator: "Horizon build-tbm-model.mjs" },
  scene: 0,
  scenes: [{ name: "TBM930", nodes: [] }],
  nodes: [],
  meshes: [],
  materials: [],
  textures: [],
  images: [],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
  accessors: [],
  bufferViews: [],
  buffers: [],
};

function addView(bytes, target) {
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    byteLength += pad;
  }
  const view = { buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength };
  if (target) view.target = target;
  chunks.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  byteLength += bytes.byteLength;
  gltf.bufferViews.push(view);
  return gltf.bufferViews.length - 1;
}

function addAccessor(array, itemSize, componentType, target, withBounds = false) {
  const accessor = {
    bufferView: addView(array, target),
    componentType,
    count: array.length / itemSize,
    type: { 1: "SCALAR", 2: "VEC2", 3: "VEC3" }[itemSize],
  };
  if (withBounds) {
    const min = Array(itemSize).fill(Infinity);
    const max = Array(itemSize).fill(-Infinity);
    for (let i = 0; i < array.length; i += itemSize) {
      for (let c = 0; c < itemSize; c += 1) {
        min[c] = Math.min(min[c], array[i + c]);
        max[c] = Math.max(max[c], array[i + c]);
      }
    }
    accessor.min = min;
    accessor.max = max;
  }
  gltf.accessors.push(accessor);
  return gltf.accessors.length - 1;
}

const imageIndex = new Map();
function textureFor(file) {
  if (!imageIndex.has(file)) {
    const bytes = fs.readFileSync(path.join(sourceDir, file));
    gltf.images.push({ name: file, mimeType: "image/png", bufferView: addView(new Uint8Array(bytes)) });
    gltf.textures.push({ sampler: 0, source: gltf.images.length - 1 });
    imageIndex.set(file, gltf.textures.length - 1);
  }
  return imageIndex.get(file);
}

const materialIndex = new Map();
function materialFor(name) {
  if (!materialIndex.has(name)) {
    const source = mtl.get(name) ?? { texture: null, opacity: 1 };
    const material = {
      name,
      doubleSided: true,
      pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.6 },
    };
    if (source.texture) {
      material.pbrMetallicRoughness.baseColorTexture = { index: textureFor(source.texture) };
      // The pitch ladder is the one texture with an alpha channel: it overlays
      // the attitude indicator's sky and ground.
      if (source.texture === "pitchscale.png") material.alphaMode = "BLEND";
    } else {
      material.pbrMetallicRoughness.baseColorFactor = [0.8, 0.8, 0.8, source.opacity];
    }
    if (source.opacity < 1) material.alphaMode = "BLEND";
    gltf.materials.push(material);
    materialIndex.set(name, gltf.materials.length - 1);
  }
  return materialIndex.get(name);
}

const FLOAT = 5126;
const UINT32 = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

root.traverse((object) => {
  if (!object.isMesh) return;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  const groups = object.geometry.groups.length
    ? object.geometry.groups
    : [{ start: 0, count: object.geometry.attributes.position.count, materialIndex: 0 }];

  const primitives = [];
  for (const group of groups) {
    // One primitive per material, welded so shared corners are stored once.
    // OBJLoader output is unindexed, so a group is a plain run of vertices.
    let geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(object.geometry.attributes)) {
      if (name === "color") continue;
      const array = attribute.array.slice(
        group.start * attribute.itemSize,
        (group.start + group.count) * attribute.itemSize,
      );
      geometry.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize));
    }
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    geometry = mergeVertices(geometry);

    const attributes = {
      POSITION: addAccessor(geometry.attributes.position.array, 3, FLOAT, ARRAY_BUFFER, true),
      NORMAL: addAccessor(geometry.attributes.normal.array, 3, FLOAT, ARRAY_BUFFER),
    };
    if (geometry.attributes.uv) {
      // OBJ texture space starts at the bottom of the image; glTF's at the top.
      const uv = geometry.attributes.uv.array.slice();
      for (let i = 1; i < uv.length; i += 2) uv[i] = 1 - uv[i];
      attributes.TEXCOORD_0 = addAccessor(uv, 2, FLOAT, ARRAY_BUFFER);
    }
    primitives.push({
      attributes,
      indices: addAccessor(new Uint32Array(geometry.index.array), 1, UINT32, ELEMENT_ARRAY_BUFFER),
      material: materialFor(materials[group.materialIndex ?? 0].name),
    });
  }

  gltf.meshes.push({ name: objectName(object.name), primitives });
  gltf.nodes.push({ name: objectName(object.name), mesh: gltf.meshes.length - 1 });
  gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
});

gltf.buffers.push({ byteLength });

const json = Buffer.from(JSON.stringify(gltf));
const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const bin = Buffer.concat(chunks);
const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);
const chunkHeader = (length, type) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(length, 0);
  h.writeUInt32LE(type, 4);
  return h;
};
fs.writeFileSync(
  OUT,
  Buffer.concat([
    header,
    chunkHeader(jsonPadded.length, 0x4e4f534a),
    jsonPadded,
    chunkHeader(binPadded.length, 0x004e4942),
    binPadded,
  ]),
);
console.log(`wrote ${OUT.pathname}: ${gltf.nodes.length} parts, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB`);
