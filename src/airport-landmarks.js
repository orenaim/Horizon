// Hand-authored buildings that override the procedural extrusion.
//
// Roughly two dozen structures carry all the recognition at a field — the
// terminal, the control tower, the parking decks, the named hangars. Everything
// else only has to avoid looking like a shoebox, which the procedural path in
// airport-buildings.js handles. Modelling those two dozen by hand is a bounded
// job; modelling fourteen hundred is not.
//
// A landmark is keyed by OSM way id, which the build script bakes as
// `building.id`. Ids are stable in practice and, unlike array order or names,
// survive a rebuild. `npm run airports:build` prints nothing about ids, so the
// way to find one is to open the footprint on openstreetmap.org and read it out
// of the URL, or query the baked JSON by name:
//
//   node -e "const d=require('./public/airports/hawaii-airports.json');
//            for (const a of d.airports)
//              for (const b of a.buildings)
//                if (/hangar/i.test(b.name ?? '')) console.log(a.code, b.id, b.name)"
//
// Each entry is a function that receives the baked footprint and the field's
// base elevation and returns an Object3D placed in world space. It is handed
// the footprint rather than replacing it outright so a landmark can still sit
// on its real, surveyed outline.

/**
 * @typedef {(building: object, baseY: number, context: LandmarkContext) => import("three").Object3D | null} LandmarkBuilder
 *
 * @typedef {object} LandmarkContext
 * @property {import("./airport-buildings.js").BuildingTextures} textures
 * @property {(metres: number) => number} m  Metres to world units.
 * @property {(ring: number[][]) => object | null} minAreaRect
 */

/** @type {Map<number, LandmarkBuilder>} */
export const LANDMARKS = new Map();

/**
 * Registers a hand-authored building.
 *
 * @param {number} osmId OSM way id of the footprint this replaces.
 * @param {LandmarkBuilder} builder
 */
export function registerLandmark(osmId, builder) {
  LANDMARKS.set(osmId, builder);
}

/** Whether a footprint has a hand-authored replacement. */
export function landmarkFor(building) {
  return building.id != null ? LANDMARKS.get(building.id) ?? null : null;
}
