import * as THREE from "three";
import { AirfieldGround, AirportScenery, loadAirports } from "./airports.js";
import { asset } from "./asset.js";
import { classifyImpact, CrashEffects, CrashSequence, OUTCOME } from "./crash.js";
import { buildC172Model } from "./c172.js";
import { preloadC172, c172Source, buildC172FromModel } from "./c172-glb.js";
import { enableModelInspector } from "./model-inspector.js";
import { buildTbm930Model } from "./tbm930.js";
import { preloadTbm930, tbm930Source, buildTbm930FromModel } from "./tbm930-glb.js";
import { buildF35Model } from "./f35.js";
import { preloadF35, f35Source, buildF35FromModel } from "./f35-glb.js";
import { buildA380Model } from "./a380.js";
import { preloadA380, a380Source, buildA380FromModel } from "./a380-glb.js";
import "./styles.css";

const AIRCRAFT = {
  c172: {
    name: "Cessna 172",
    code: "C172",
    type: "Piston trainer",
    cruise: 122,
    takeoff: 55,
    maxSpeed: 165,
    power: 18,
    lift: 0.0058,
    color: 0xf3eee2,
    accent: 0xd86627,
    scale: 1,
    modelScale: 0.1,
    chaseDistance: 1.28,
    chaseHeight: 0.33,
    cockpitOffset: 0.22,
    steerRadius: 1.2,
    flapTravel: 6,
    // Fixed gear, so its drag is already in the clean figure. No
    // speedbrake either — the technique is a forward slip.
    gearDrag: 0,
    flapDrag: 0.5,
    airbrakeDrag: 0.3,
    brakingG: 0.3,
    fuelCapacity: 53,
    fuelUnit: "US gal",
    fuelKind: "100LL avgas",
    fuelCapacityLabel: "usable",
    fuelPrecision: 0,
    cruiseFuelBurn: 9.5,
    idleFuelBurn: 1.1,
    maxFuelBurn: 12.5,
    fuelBurnCurve: 0.9,
  },
  tbm: {
    name: "Daher TBM 930",
    code: "TBM",
    type: "Turboprop",
    cruise: 330,
    takeoff: 75,
    maxSpeed: 360,
    power: 36,
    lift: 0.0046,
    color: 0xe8e9e3,
    accent: 0x173b55,
    scale: 1.2,
    // The downloaded model is in metres, like the C172's. The built stand-in
    // is drawn in its own units and needs its own factor to come out the same
    // 12.8 m across.
    modelScale: 0.1,
    builtModelScale: 0.18,
    chaseDistance: 1.9,
    chaseHeight: 0.6,
    cockpitOffset: 0.25,
    steerRadius: 1.3,
    flapTravel: 7,
    gearTravel: 7,
    gearDrag: 0.45,
    flapDrag: 0.55,
    airbrakeDrag: 0.35,
    brakingG: 0.32,
    fuelCapacity: 291,
    fuelUnit: "US gal",
    fuelKind: "Jet A",
    fuelCapacityLabel: "usable",
    fuelPrecision: 0,
    cruiseFuelBurn: 60,
    idleFuelBurn: 18,
    maxFuelBurn: 72,
    fuelBurnCurve: 1.1,
  },
  a5: {
    name: "Icon A5",
    code: "A5",
    type: "Amphibious sport",
    cruise: 95,
    takeoff: 48,
    maxSpeed: 120,
    power: 15,
    lift: 0.0065,
    color: 0xf0eee5,
    accent: 0xc75e29,
    scale: 0.85,
    modelScale: 0.22,
    chaseDistance: 2,
    chaseHeight: 0.8,
    cockpitOffset: 0.2,
    steerRadius: 1.2,
    flapTravel: 6,
    gearDrag: 0.3,
    flapDrag: 0.5,
    airbrakeDrag: 0.3,
    brakingG: 0.3,
    fuelCapacity: 20,
    fuelUnit: "US gal",
    fuelKind: "Mogas / avgas",
    fuelCapacityLabel: "usable",
    fuelPrecision: 1,
    cruiseFuelBurn: 4.5,
    idleFuelBurn: 0.6,
    maxFuelBurn: 5.4,
    fuelBurnCurve: 0.9,
  },
  a380: {
    name: "Airbus A380",
    code: "A380",
    type: "Wide-body jet",
    cruise: 488,
    takeoff: 150,
    maxSpeed: 550,
    power: 62,
    lift: 0.0029,
    color: 0xe9eced,
    accent: 0x164a70,
    scale: 3.2,
    modelScale: 0.1,
    chaseDistance: 17,
    chaseHeight: 4.6,
    cockpitOffset: 1.8,
    steerRadius: 5.2,
    flapTravel: 18,
    gearTravel: 14,
    // Twenty-two wheels in the breeze, very large flaps, and spoiler
    // panels across most of the upper wing.
    gearDrag: 0.6,
    flapDrag: 0.75,
    airbrakeDrag: 1.1,
    brakingG: 0.35,
    loadLimit: 2.5,
    controlRate: 0.34,
    // Forty-six degrees. Airliner autopilots hold 25-30°, but hand-flown the
    // limit is structural, and 46° pulls only 1.4 g against a 2.5 g airframe.
    maxBank: 0.8,
    maxPitch: 0.24,
    // Seventy-two metres of fuselage behind the main gear: rotate too far and
    // the tail skid finds the runway first.
    groundPitch: 0.14,
    fuelCapacity: 320000,
    fuelUnit: "L",
    fuelKind: "Jet A",
    fuelCapacityLabel: "maximum",
    fuelPrecision: 0,
    cruiseFuelBurn: 15000,
    idleFuelBurn: 2500,
    maxFuelBurn: 22000,
    fuelBurnCurve: 1.2,
  },
  f35: {
    name: "Lockheed Martin F-35A",
    code: "F-35",
    type: "Stealth fighter",
    // Mach 1.6 at altitude; approach and rotation both sit near 150 kt.
    cruise: 470,
    takeoff: 150,
    maxSpeed: 1000,
    power: 71,
    lift: 0.0031,
    color: 0x5b636c,
    accent: 0x2f353b,
    scale: 1.6,
    modelScale: 0.1,
    chaseDistance: 2.4,
    chaseHeight: 0.62,
    cockpitOffset: 0.45,
    steerRadius: 2.0,
    flapTravel: 5,
    gearTravel: 6,
    // No dedicated airbrake panel: the flaperons and rudders deflect
    // together to do the job.
    gearDrag: 0.5,
    flapDrag: 0.55,
    airbrakeDrag: 0.9,
    brakingG: 0.36,
    // Nine g, and a roll rate to match: this is the only aircraft here that
    // can be rolled through 360 degrees in about a second and a half.
    loadLimit: 9,
    controlRate: 1.7,
    // 77 degrees of bank is about four and a half g, which is the sustained
    // turn this aircraft is actually flown at.
    maxBank: 1.35,
    maxPitch: 0.52,
    // About eleven degrees, which is where the tail would touch.
    groundPitch: 0.19,
    fuelCapacity: 18498,
    fuelUnit: "lb",
    fuelKind: "JP-8",
    fuelCapacityLabel: "internal",
    fuelPrecision: 0,
    cruiseFuelBurn: 7400,
    idleFuelBurn: 1200,
    maxFuelBurn: 30000,
    fuelBurnCurve: 2.4,
  },
};

// --- Flight model constants -------------------------------------------------
// One world unit is ten metres, so 9.81 m/s² is 0.981 units/s².
// Body axes, reused every frame rather than allocated per look-around.
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

const KNOTS_TO_WORLD = 0.0514444;
const GRAVITY_WORLD = 0.981;
const CL_MAX = 1.6;
const CL_PER_RADIAN = 4.5;
const INDUCED_DRAG = 2;
// How far below the flight path the nose may be commanded with the stick held
// fully forward, measured in the lift it gives away: 0.5 means the wing is held
// to half the lift it trims at, 4 means it may unload completely.
//
// Wings level there is no turn to protect and the nose goes where it is pointed.
// Past a few degrees of bank the wing is made to keep half its trimmed lift,
// because a fully unloaded wing has nothing left to curve a turn with — which is
// what used to leave a banked descent flying straight ahead.
const PUSHOVER_UNLOAD_LEVEL = 4;
const PUSHOVER_UNLOAD_BANKED = 0.5;
const PUSHOVER_BANK_RANGE = [0.1, 0.35];
// Tyres and bearings, as a fraction of g. Enough that an aircraft rolling at
// idle eventually stops instead of coasting down the runway forever.
const ROLLING_RESISTANCE_G = 0.018;
// Ceiling on how fast an aircraft can be yawed round on its wheels, so a
// steering input at speed cannot spin it.
const GROUND_STEER_LIMIT = 0.42;
// How close a contact point has to be to the surface to count as touching it.
const CONTACT_BAND = 0.012;

const aeroCache = new Map();

function formatFuelAmount(spec, amount) {
  return `${amount.toLocaleString(undefined, {
    minimumFractionDigits: spec.fuelPrecision,
    maximumFractionDigits: spec.fuelPrecision,
  })} ${spec.fuelUnit}`;
}

function formatEndurance(hours) {
  const totalMinutes = Math.max(0, Math.round(hours * 12) * 5);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!wholeHours) return `${minutes} min`;
  return minutes ? `${wholeHours} h ${minutes} min` : `${wholeHours} h`;
}

/**
 * Derives a point-mass aerodynamic model from the numbers already quoted for
 * each aircraft, so the handling stays tied to the published figures.
 *
 * The lift constant is set from the stall speed: at the takeoff speed with the
 * wing at maximum lift the aircraft can just hold itself up. Drag is set from
 * the top speed: at full throttle in level flight, thrust and drag balance
 * there. Everything else follows.
 */
function aeroModel(spec) {
  let model = aeroCache.get(spec.code);
  if (model) return model;
  const stall = spec.takeoff * KNOTS_TO_WORLD;
  const cruise = spec.cruise * KNOTS_TO_WORLD;
  const top = spec.maxSpeed * KNOTS_TO_WORLD;
  const liftK = GRAVITY_WORLD / (stall * stall * CL_MAX);
  const thrustMax = spec.power * 0.012;
  model = {
    liftK,
    // Lift coefficient with the nose on the flight path, set so that cruising
    // speed needs roughly no back pressure.
    clTrim: THREE.MathUtils.clamp(GRAVITY_WORLD / (liftK * cruise * cruise), 0.1, 0.8),
    dragK: thrustMax / (top * top),
    thrustMax,
    loadLimit: spec.loadLimit ?? 3.6,
  };
  aeroCache.set(spec.code, model);
  return model;
}

// The elevation model carries no bathymetry — open water is recorded as exactly
// zero or as a nodata fill — so the sea bed is drawn as a shallow grade just far
// enough under the water plane to stay hidden. Dropping it onto a deep flat
// skirt instead makes every coastal sample a two-hundred-metre cliff, and at one
// sample per 140 m those cliffs are the stepped rectangular walls that show up
// where the draped photograph meets the rendered ocean.
const SEABED_DEPTH = 0.45;
// The surveyed elevation at which the grid is taken to be dry. A metre of
// margin keeps hydro-flattened river mouths and reef flats out of the land
// mask that the shore distance and the shore apron are both built from.
const WATERLINE_METRES = 1;

// Sea level as far as anything resting on the surface is concerned: the height
// the aircraft floats at over open water, and the height the sea bed is held at
// once it comes within reach of the shore.
const WATER_SURFACE = -0.06;
// Sea bed within reach of the shore is held at that level instead of following
// the grade down. Where the elevation grid and the photograph disagree about
// the exact shoreline — and at one sample per 140 m against one pixel per 18 m
// they disagree along the whole coast — the water plane would otherwise slice
// through the mesh a cell early and bite rectangular notches out of the
// photographed beach. Carrying the ground out past the survey's coastline moves
// the visible waterline onto the photograph's alpha edge, which is eight times
// finer. The apron itself is never seen: it only ever carries photographed sea,
// which `shadeShoreline` dissolves.
//
// Two samples of slack cover the disagreement without bridging the narrowest
// water the grid still resolves.
const SHORE_APRON_SAMPLES = 2;

/** Drawn height in world units for a surveyed elevation in metres. */
function drawnSurface(metres, verticalScale) {
  const above = metres - WATERLINE_METRES;
  if (above > 0) return above * verticalScale;
  return -SEABED_DEPTH + above * verticalScale * 0.25;
}

/**
 * Drops the triangles of a coarse far-terrain grid that a finer mesh already
 * covers, so the two are not both drawn over the same ground.
 *
 * The test is per triangle and requires every corner to be inside, which leaves
 * the kept ring overlapping the fine mesh by up to one coarse cell. That is
 * deliberate: trimming flush instead would leave a half-kilometre crack of open
 * sky between the two, and an overlap is settled by a polygon offset.
 */
function openTerrainHole(geometry, centreX, centreZ, covered) {
  const position = geometry.attributes.position;
  const index = geometry.getIndex();
  const inside = new Uint8Array(position.count);
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i) + centreX;
    const z = position.getZ(i) + centreZ;
    inside[i] = covered.some(({ bounds }) =>
      x > bounds[0] && x < bounds[2] && z > bounds[1] && z < bounds[3]) ? 1 : 0;
  }
  const kept = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    if (inside[a] && inside[b] && inside[c]) continue;
    kept.push(a, b, c);
  }
  geometry.setIndex(kept);
}

/**
 * Drawn height of one specific terrain grid at a world point, or null if the
 * point is outside it. Used to settle the two grids against each other at their
 * shared boundary, where each has its own idea of the ground.
 */
function drawnHeightIn(terrain, x, z) {
  const { metadata, heights, bounds } = terrain;
  const [samplesX, samplesY] = metadata.samples;
  if (x < bounds[0] || x > bounds[2] || z < bounds[1] || z > bounds[3]) return null;
  const sampleX = ((x - bounds[0]) / (bounds[2] - bounds[0])) * (samplesX - 1);
  const sampleY = ((z - bounds[1]) / (bounds[3] - bounds[1])) * (samplesY - 1);
  const x0 = Math.floor(sampleX);
  const y0 = Math.floor(sampleY);
  const x1 = Math.min(samplesX - 1, x0 + 1);
  const y1 = Math.min(samplesY - 1, y0 + 1);
  const tx = sampleX - x0;
  const ty = sampleY - y0;
  const at = (column, row) => drawnSurface(heights[row * samplesX + column], metadata.verticalScale);
  const north = THREE.MathUtils.lerp(at(x0, y0), at(x1, y0), tx);
  const south = THREE.MathUtils.lerp(at(x0, y1), at(x1, y1), tx);
  return THREE.MathUtils.lerp(north, south, ty);
}

/** Flags every grid sample lying within `reach` samples of dry land. */
function nearShoreMask(heights, samplesX, samplesY, reach) {
  const mask = new Uint8Array(samplesX * samplesY);
  for (let y = 0; y < samplesY; y += 1) {
    for (let x = 0; x < samplesX; x += 1) {
      if (heights[y * samplesX + x] <= WATERLINE_METRES) continue;
      const y0 = Math.max(0, y - reach);
      const y1 = Math.min(samplesY - 1, y + reach);
      const x0 = Math.max(0, x - reach);
      const x1 = Math.min(samplesX - 1, x + reach);
      for (let ny = y0; ny <= y1; ny += 1) mask.fill(1, ny * samplesX + x0, ny * samplesX + x1 + 1);
    }
  }
  return mask;
}

const TERRAIN_SOURCES = [
  { id: "oahu", metadata: "/terrain/oahu-terrain.json", heights: "/terrain/oahu-dem.f32" },
  { id: "kauai", metadata: "/terrain/kauai-terrain.json", heights: "/terrain/kauai-dem.f32" },
];

/** [west, north, east, south] in the shared world x/z frame. */
function terrainWorldBounds(metadata) {
  if (metadata.worldBounds) return metadata.worldBounds;
  const [width, depth] = metadata.worldSize;
  return [-width / 2, -depth / 2, width / 2, depth / 2];
}

// Flyable areas. Each one is its own world: the Colorado Plateau is four
// thousand kilometres from Oʻahu, far enough that a shared frame would spend
// the precision a float32 position attribute has to spare, and there is nothing
// to fly between them anyway. So only one area's scenery is resident at a time
// and every area is centred on its own origin.
//
// Areas still listed as `built: false` are here because the roster is part of
// the pitch, and because seeing where the map is going is worth more than
// hiding it until the terrain lands. Adding one means: bake its DEM,
// orthoimagery and airfields with the scripts in `scripts/`, fill in `terrains`,
// `airports`, `airfields` and an `orbit` for the setup camera, and flip `built`.
// Every area here is covered by the same public-domain USGS sources the Hawaiʻi
// pipeline already uses, so none of them need a new data source.
const REGIONS = [
  {
    id: "hawaii",
    name: "Hawaiʻi",
    place: "Oʻahu + Kauaʻi",
    state: "HI",
    built: true,
    // Where the setup camera circles while the menu is open, in world units.
    orbit: { centre: [-180, 80, 260], radius: 4300, height: 2100 },
    terrains: [
      { id: "oahu", metadata: "/terrain/oahu-terrain.json", heights: "/terrain/oahu-dem.f32" },
      { id: "kauai", metadata: "/terrain/kauai-terrain.json", heights: "/terrain/kauai-dem.f32" },
    ],
    airports: "/airports/hawaii-airports.json",
    airfields: [
      { code: "PHNL", locale: "Oʻahu", name: "Daniel K. Inouye International", runway: "08L" },
      { code: "PHJR", locale: "Oʻahu", name: "Kalaeloa Airport", runway: "04R" },
      { code: "PHDH", locale: "Oʻahu", name: "Dillingham Airfield", runway: "08" },
      { code: "PHLI", locale: "Kauaʻi", name: "Līhuʻe Airport", runway: "03" },
      { code: "PHPA", locale: "Kauaʻi", name: "Port Allen Airport", runway: "09" },
    ],
    // An ocean, which brings the water shader, the shore-distance field and the
    // shore apron with it.
    sea: true,
    air: { top: 0x4da8d5, bottom: 0xa9d3df, fog: 0xa9d3df, density: 0.00016 },
    map: { surround: "#5ba1b8" },
    time: "08:40 HST",
    visibility: "12 km visibility",
    conditions: "Clear · 26°C · Wind 078° / 6 kt",
    heading: "Honolulu",
    blurb: "Climb east over Waikīkī, turn around Diamond Head, and follow the windward coast.",
  },
  {
    id: "grand-canyon",
    name: "Grand Canyon",
    place: "Colorado Plateau",
    state: "AZ",
    built: true,
    orbit: { centre: [210, 160, -900], radius: 3600, height: 1350 },
    // Detail first: `sampleTerrain` takes the first mesh whose bounds contain
    // the point, and the flight model has to land on the fine one.
    terrains: [
      {
        id: "grand-canyon",
        metadata: "/terrain/grand-canyon-terrain.json",
        heights: "/terrain/grand-canyon-dem.f32",
      },
      {
        id: "grand-canyon-far",
        metadata: "/terrain/grand-canyon-far-terrain.json",
        heights: "/terrain/grand-canyon-far-dem.f32",
        far: true,
      },
    ],
    airports: "/airports/grand-canyon-airports.json",
    airfields: [
      { code: "KGCN", locale: "Tusayan", name: "Grand Canyon National Park Airport", runway: "03" },
    ],
    sea: false,
    // With no coast to end on, the survey needs the far mesh above to reach the
    // horizon. Any inland area added later needs one too.
    // Desert air is far clearer than the trade-wind haze over Hawaiʻi, and the
    // horizon takes its colour from dust rather than sea spray.
    air: { top: 0x3d7cc4, bottom: 0xd9c8a8, fog: 0xd2c0a2, density: 0.00014 },
    // Cumulus base is tuned for a sea-level island. The plateau alone is two
    // kilometres up, so the whole field is lifted to sit over the rim rather
    // than inside the canyon.
    cloudBase: 260,
    // Canyon floor through red rock to a pale rim.
    map: {
      surround: "#8d7f66",
      ramp: [[96, 84, 72], [148, 92, 66], [176, 124, 86], [186, 168, 128], [198, 196, 176]],
    },
    time: "09:20 MST",
    visibility: "Unlimited",
    conditions: "Clear · 21°C · Wind 210° / 8 kt",
    heading: "Grand Canyon",
    blurb: "Depart Tusayan, cross the rim four minutes out, and follow the gorge west past Hermit Creek.",
  },
  {
    id: "grand-teton",
    name: "Grand Teton",
    place: "Jackson Hole",
    state: "WY",
    built: true,
    orbit: { centre: [-150, 250, -100], radius: 2400, height: 1850 },
    terrains: [
      {
        id: "grand-teton",
        metadata: "/terrain/grand-teton-terrain.json",
        heights: "/terrain/grand-teton-dem.f32",
      },
      {
        id: "grand-teton-far",
        metadata: "/terrain/grand-teton-far-terrain.json",
        heights: "/terrain/grand-teton-far-dem.f32",
        far: true,
      },
    ],
    airports: "/airports/grand-teton-airports.json",
    airfields: [
      { code: "KJAC", locale: "Jackson Hole", name: "Jackson Hole Airport", runway: "01" },
      { code: "KDIJ", locale: "Teton Valley", name: "Driggs-Reed Memorial Airport", runway: "04" },
    ],
    sea: false,
    // The Wyoming/Idaho line, which the box crosses eight kilometres in from
    // its western edge. Idaho is the darker of the two here — the opposite sign
    // to Tahoe's, which is why the step is measured rather than assumed.
    seam: { worldX: -2011, feather: 60 },
    // Jackson Lake, the reservoir filling the north end of the valley. Taken
    // from the survey, not the map: 3DEP reports a dead-flat 2055.5 m over
    // seventy-six square kilometres, eight and a half metres below full pool,
    // because the reservoir was drawn down when it was flown.
    waterLevelM: 2055.5,
    // Thin mountain air, and the range is high enough that the sky reads darker
    // than anywhere else on the roster.
    air: { top: 0x2a63ae, bottom: 0xc6d6de, fog: 0xc0d0dc, density: 0.00012 },
    // The valley floor alone is two kilometres up and the summits another two
    // above that.
    cloudBase: 340,
    // Alpine forest through bare granite to permanent snow.
    map: {
      surround: "#5c6660",
      water: "#33648a",
      ramp: [[78, 98, 82], [96, 120, 88], [146, 146, 122], [190, 188, 180], [238, 240, 244]],
    },
    time: "07:05 MDT",
    visibility: "Unlimited",
    conditions: "Clear · 6°C · Wind 200° / 5 kt",
    heading: "Jackson Hole",
    blurb: "Depart Jackson Hole, run the east face north to Jackson Lake, and cross the pass into Teton Valley.",
  },
  {
    id: "tahoe",
    name: "Lake Tahoe",
    place: "Sierra Nevada",
    state: "CA · NV",
    built: true,
    orbit: { centre: [-389, 190, 223], radius: 2800, height: 1700 },
    terrains: [
      { id: "tahoe", metadata: "/terrain/tahoe-terrain.json", heights: "/terrain/tahoe-dem.f32" },
      {
        id: "tahoe-far",
        metadata: "/terrain/tahoe-far-terrain.json",
        heights: "/terrain/tahoe-far-dem.f32",
        far: true,
      },
    ],
    // The California/Nevada line runs straight down the middle of this box, and
    // NAIP is flown per state. Only where it is declared, not how big the step
    // is — `measureSeamOffset` reads that off each mosaic at load.
    seam: { worldX: -148, feather: 60 },
    airports: "/airports/tahoe-airports.json",
    airfields: [
      { code: "KTVL", locale: "South Lake Tahoe", name: "Lake Tahoe Airport", runway: "18" },
      { code: "KTRK", locale: "Truckee", name: "Truckee Tahoe Airport", runway: "11" },
      { code: "KMEV", locale: "Minden", name: "Minden-Tahoe Airport", runway: "16" },
      { code: "KCXP", locale: "Carson City", name: "Carson Airport", runway: "09" },
    ],
    // The lake is a lake, not a sea: it sits at 1,897 m, so the ocean plane and
    // everything hung off it stay switched off and the water is simply the
    // photograph draped on a flat piece of terrain.
    sea: false,
    // The surveyed surface, not the nominal one: 3DEP reports the lake as a
    // dead-flat 1897.89 m across sixty-five thousand samples, and the shading
    // band is only a couple of metres wide.
    waterLevelM: 1897.9,
    // Sierra air at two kilometres is the clearest of the three, and the
    // horizon is blue rather than dusty.
    air: { top: 0x2c6cb4, bottom: 0xc2d4de, fog: 0xbccdda, density: 0.00012 },
    // The lake surface alone is nearly two kilometres up and Freel Peak another
    // one and a half above that.
    cloudBase: 300,
    // Forested valley through granite to snow, and the lake in cobalt.
    map: {
      surround: "#55625c",
      water: "#2f5f80",
      ramp: [[74, 96, 80], [96, 122, 84], [150, 148, 116], [188, 184, 170], [228, 230, 234]],
    },
    time: "06:45 PDT",
    visibility: "Unlimited",
    conditions: "Clear · 9°C · Wind 250° / 7 kt",
    heading: "Lake Tahoe",
    blurb: "Climb out of South Lake Tahoe, cross to Emerald Bay, and follow the west shore north to Truckee.",
  },
  {
    id: "rainier",
    name: "Mount Rainier",
    place: "Cascade Range",
    state: "WA",
    built: true,
    orbit: { centre: [990, 280, -192], radius: 2500, height: 1450 },
    terrains: [
      { id: "rainier", metadata: "/terrain/rainier-terrain.json", heights: "/terrain/rainier-dem.f32" },
      {
        id: "rainier-far",
        metadata: "/terrain/rainier-far-terrain.json",
        heights: "/terrain/rainier-far-dem.f32",
        far: true,
      },
    ],
    airports: "/airports/rainier-airports.json",
    airfields: [
      { code: "KPLU", locale: "Puyallup", name: "Pierce County–Thun Field", runway: "17" },
      { code: "55S", locale: "Packwood", name: "Packwood Airport", runway: "01" },
      { code: "39P", locale: "Morton", name: "Strom Field", runway: "07" },
    ],
    // No seam — the box is wholly inside Washington. No lake either: the largest
    // flat water is Alder Lake at five square kilometres, small enough to read
    // fine photographed.
    sea: false,
    // Marine air rather than desert: hazier than anything else on the roster,
    // and the horizon greys off rather than warming.
    air: { top: 0x3f7fbe, bottom: 0xc3d2d8, fog: 0xbdccd2, density: 0.00016 },
    // Low enough that the summit stands well above the cloud field, which is the
    // whole point of the mountain.
    cloudBase: 110,
    // Conifer through alpine meadow to permanent snow and ice.
    map: {
      surround: "#43544c",
      water: "#2f5468",
      ramp: [[62, 86, 74], [74, 104, 78], [120, 132, 104], [176, 182, 172], [248, 250, 252]],
    },
    time: "09:15 PDT",
    visibility: "16 km visibility",
    conditions: "Clear · 14°C · Wind 230° / 6 kt",
    heading: "Mount Rainier",
    blurb: "Climb out of Thun Field, cross the Carbon and the Puyallup, and circle the summit before running the crest south to Packwood.",
  },
  {
    id: "moab",
    name: "Moab",
    place: "Canyonlands",
    state: "UT",
    built: true,
    orbit: { centre: [-1250, 150, 950], radius: 1900, height: 1150 },
    terrains: [
      { id: "moab", metadata: "/terrain/moab-terrain.json", heights: "/terrain/moab-dem.f32" },
      {
        id: "moab-far",
        metadata: "/terrain/moab-far-terrain.json",
        heights: "/terrain/moab-far-dem.f32",
        far: true,
      },
    ],
    airports: "/airports/moab-airports.json",
    airfields: [
      { code: "KCNY", locale: "Moab", name: "Canyonlands Regional Airport", runway: "03" },
      { code: "UT53", locale: "Spanish Valley", name: "Sky Ranch Airport", runway: "12" },
    ],
    sea: false,
    // No seam: the box is wholly inside Utah, so the mosaic is one exposure.
    // No lake either — the Green and the Colorado are a hundred metres wide and
    // cut too deep to read as flat at ninety-metre samples.
    // The horizon tone is kept close to neutral rather than pushed orange:
    // mixing a warm tan into the blue overhead passes through a muddy purple on
    // the way, which is what the gradient spends most of its span on when the
    // camera is looking down at the ground.
    air: { top: 0x4a86c8, bottom: 0xd9cdb4, fog: 0xd3c3a6, density: 0.00012 },
    // The slickrock benches are already a kilometre and a half up.
    cloudBase: 250,
    // River green through red rock to pale slickrock.
    map: {
      surround: "#7d6a55",
      water: "#3c5f52",
      ramp: [[86, 78, 70], [140, 74, 52], [178, 104, 66], [196, 150, 110], [214, 196, 170]],
    },
    time: "08:10 MDT",
    visibility: "Unlimited",
    conditions: "Clear · 24°C · Wind 300° / 7 kt",
    heading: "Canyonlands",
    blurb: "Leave Canyonlands Field south down the Colorado, cross Island in the Sky, and pick up the Green above the confluence.",
  },
];

// The departure roster for whichever area is resident. Positions, headings and
// the selectable runway list are filled in from that area's baked airport data
// once it loads; `resetAirports` seeds the entries so the picker has something
// to show in the meantime. Rebuilt in place on every area change, because the
// UI and the flight model both hold on to this array.
const AIRPORTS = [];

function resetAirports(region) {
  AIRPORTS.length = 0;
  for (const field of region.airfields ?? []) {
    AIRPORTS.push({ ...field, x: 0, z: 0, heading: 0, ends: [], lines: [] });
  }
}

const aircraftSilhouettes = {
  c172: `
    <path d="M8 17 Q11 13 22 13 L53 14 L84 18 L108 19 L114 21 L107 23 L56 25 L21 26 Q10 25 8 21 Z"/>
    <path d="M25 9 L82 9 L78 14 L27 15 Z"/>
    <path d="M91 19 L101 5 L108 6 L108 20 Z"/>
    <path d="M91 19 L116 14 L117 16 L105 21 Z"/>
    <path d="M37 14 L57 25 M22 25 L18 34 M68 25 L72 34" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="17" cy="35" r="3.2"/>
    <circle cx="73" cy="35" r="3.2"/>
    <path d="M18 14 L32 14 L36 20 L17 20 Z M38 14 L49 15 L51 20 L38 20 Z" fill="var(--silhouette-cutout)"/>
    <path d="M3 9 L3 29 M1 19 L7 19" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  `,
  tbm: `
    <path d="M8 18 Q11 13 25 12 L62 13 L92 17 L109 19 L115 21 L107 23 L62 25 L23 25 Q11 24 8 21 Z"/>
    <path d="M42 21 L75 30 L69 32 L47 25 Z"/>
    <path d="M91 18 L102 4 L109 5 L108 20 Z"/>
    <path d="M93 19 L117 13 L118 15 L106 21 Z"/>
    <path d="M22 13 L39 13 L44 19 L18 19 Z" fill="var(--silhouette-cutout)"/>
    <path d="M3 7 L3 31 M1 10 L5 28 M1 28 L5 10" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/>
  `,
  a5: `
    <path d="M8 19 Q12 14 27 14 L57 16 L70 19 L98 20 L113 22 L104 24 L69 25 L57 29 L23 29 Q12 27 8 23 Z"/>
    <path d="M25 12 L75 9 L82 13 L58 17 L27 16 Z"/>
    <path d="M94 20 L104 8 L111 9 L108 22 Z"/>
    <path d="M97 20 L118 15 L119 17 L108 22 Z"/>
    <path d="M24 15 Q31 8 47 9 Q57 10 62 17 L51 18 L29 17 Z" fill="currentColor"/>
    <path d="M29 15 Q34 11 45 11 Q53 12 57 16 L48 16 L32 16 Z" fill="var(--silhouette-cutout)"/>
    <path d="M61 16 L65 8 L74 8 L77 18 Z"/>
    <path d="M78 3 L78 23 M74 5 L82 21" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M15 28 Q23 35 49 34 L59 29" fill="none" stroke="currentColor" stroke-width="1.8"/>
  `,
  a380: `
    <path d="M6 18 Q10 11 27 10 L70 11 L97 16 L113 19 L118 21 L112 24 L72 26 L25 27 Q10 26 6 22 Z"/>
    <path d="M42 19 L81 33 L73 36 L49 26 Z"/>
    <path d="M94 17 L105 2 L113 4 L110 21 Z"/>
    <path d="M96 18 L119 12 L120 15 L109 22 Z"/>
    <path d="M19 12 L46 12 L53 17 L15 17 Z M18 19 L71 19 L76 21 L16 21 Z" fill="var(--silhouette-cutout)"/>
    <path d="M48 25 Q51 28 56 28 L62 27 L62 31 Q60 34 55 34 L51 33 Q48 30 48 25 Z"/>
    <path d="M68 28 Q71 31 76 31 L82 30 L82 34 Q80 37 75 37 L71 36 Q68 33 68 28 Z"/>
  `,
  f35: `
    <path d="M4 20 L18 16 L40 14 L66 14 L92 16 L108 18 L114 21 L108 24 L90 26 L64 27 L34 26 L14 24 Z"/>
    <path d="M27 14 Q33 6 46 6 Q58 6 62 14 Z"/>
    <path d="M39 21 L88 34 L74 36 L43 25 Z"/>
    <path d="M89 23 L110 31 L101 33 L87 26 Z"/>
    <path d="M84 14 L96 2 L101 3 L95 15 Z"/>
    <path d="M91 14 L103 3 L107 5 L101 15 Z"/>
    <path d="M107 17 L115 18 L115 24 L107 25 Z"/>
    <path d="M28 18 L44 18 L47 23 L28 23 Z" fill="var(--silhouette-cutout)"/>
    <path d="M6 20 L34 19" fill="none" stroke="var(--silhouette-cutout)" stroke-width="1.1"/>
  `,
};

const planeSvg = (id) => `
  <svg
    class="aircraft-silhouette aircraft-silhouette--${id}"
    viewBox="0 0 120 42"
    aria-hidden="true"
    focusable="false"
  >
    <g fill="currentColor" stroke-linejoin="round">
      ${aircraftSilhouettes[id]}
    </g>
  </svg>`;

document.querySelector("#app").innerHTML = `
  <div class="shell">
    <div id="world" class="world" aria-label="Three-dimensional flight view"></div>
    <div id="cockpitFrame" class="cockpit-frame" aria-hidden="true"></div>

    <main id="main-content" class="setup">
      <section class="setup-panel" aria-labelledby="setup-title">
        <header class="brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <span class="brand-name">Horizon</span>
        </header>

        <div class="setup-heading">
          <span class="eyebrow">Free flight · Clear skies</span>
          <h1 id="setup-title">Wheels up.</h1>
        </div>

        <form class="setup-form" id="flightForm">
          <fieldset class="choice-group">
            <legend class="section-label">01 · Area</legend>
            <div class="area-grid">
              ${REGIONS.map((region, index) => `
                <label class="choice">
                  <input type="radio" name="area" value="${region.id}" ${index === 0 ? "checked" : ""} />
                  <span class="area-option">
                    <span class="area-name">${region.name}</span>
                    <span class="area-place">${region.place} · ${region.state}</span>
                    ${region.built ? "" : `<span class="area-flag">Soon</span>`}
                  </span>
                </label>
              `).join("")}
            </div>
          </fieldset>

          <fieldset class="choice-group">
            <legend class="section-label">02 · Departure</legend>
            <div class="location-row">
              <button class="select-like" id="airportButton" type="button" aria-label="Change departure airport">
                <span class="airport-copy">
                  <strong class="airport-code" id="airportCode">PHNL · Runway 08R</strong>
                  <span class="airport-name" id="airportName">Daniel K. Inouye International</span>
                </span>
                <span class="cycle-icon" aria-hidden="true">↻</span>
              </button>
              <button class="toggle" id="runwayButton" type="button" aria-label="Use runway start or change departure runway" aria-pressed="true">
                <span aria-hidden="true">⇥</span> Runway
              </button>
              <button class="toggle" id="airStartButton" type="button" aria-pressed="false">
                <span aria-hidden="true">↗</span> Air start
              </button>
            </div>
          </fieldset>

          <fieldset class="choice-group">
            <legend class="section-label">03 · Aircraft</legend>
            <div class="aircraft-strip">
              ${Object.entries(AIRCRAFT).map(([id, plane], index) => `
                <label class="choice">
                  <input type="radio" name="aircraft" value="${id}" ${index === 0 ? "checked" : ""} />
                  <span class="aircraft-option">
                    ${planeSvg(id)}
                    <span>
                      <span class="aircraft-code">${plane.code}</span>
                      <span class="aircraft-type">${plane.type}</span>
                    </span>
                  </span>
                </label>
              `).join("")}
            </div>
          </fieldset>

          <fieldset class="choice-group">
            <legend class="section-label">04 · Fuel</legend>
            <div class="fuel-planner">
              <div class="fuel-summary">
                <span>
                  <small id="fuelKind">100LL avgas</small>
                  <strong id="fuelAmount">53 US gal</strong>
                </span>
                <output id="fuelPercent" for="fuelRange">100%</output>
              </div>
              <input
                id="fuelRange"
                name="fuel"
                type="range"
                min="0"
                max="100"
                step="1"
                value="100"
                aria-label="Fuel load percentage"
                aria-describedby="fuelDetails"
              />
              <div class="fuel-scale" aria-hidden="true">
                <span>Empty</span>
                <span id="fuelCapacity">53 US gal usable</span>
              </div>
              <p id="fuelDetails" class="fuel-details">About 5 h 35 min at cruise power.</p>
            </div>
          </fieldset>

          <div class="launch-row">
            <button class="launch" id="launchButton" type="submit">
              <span id="launchLabel">Start flight</span>
              <span aria-hidden="true">→</span>
            </button>
            <span class="condition">
              <strong id="conditionTime">08:40 HST</strong>
              <span id="conditionVisibility">12 km visibility</span>
            </span>
          </div>
        </form>

        <footer class="setup-footer">
          <span>Keyboard + mouse · Assisted flight</span>
          <span>
            USGS terrain · Preview ·
            <button type="button" class="credits-link" data-credits-open>Credits</button>
          </span>
        </footer>
      </section>

      <div class="preview-veil" aria-hidden="true"></div>

      <div class="preview-copy" aria-hidden="true">
        <span class="status-chip" id="previewConditions">Clear · 26°C · Wind 078° / 6 kt</span>
        <h2 id="previewHeading">Honolulu</h2>
        <p id="previewBlurb">Climb east over Waikīkī, turn around Diamond Head, and follow the windward coast.</p>
      </div>

      <dialog class="credits" data-credits>
        <h2>Credits</h2>
        <dl>
          <dt>Terrain</dt>
          <dd>USGS 3DEP seamless 1/3 arc-second elevation. Public domain.</dd>

          <dt>Imagery</dt>
          <dd>USGS NAIP Plus orthoimagery via The National Map. Public domain.</dd>

          <dt>Airports</dt>
          <dd>
            Runway and airfield data from
            <a href="https://ourairports.com/" target="_blank" rel="noopener">OurAirports</a>.
            Public domain. Structures from
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>
            contributors, licensed ODbL 1.0.
          </dd>

          <dt>Cessna 172</dt>
          <dd>
            <a href="https://skfb.ly/pwATP" target="_blank" rel="noopener">“FREE Cessna 172SP”</a>
            by NLM, licensed
            <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.
            Modified: ground equipment removed, cabin door closed, glazing retuned,
            lift struts added, control surfaces split and hinged.
          </dd>

          <dt>Daher TBM 930</dt>
          <dd>
            <a href="https://sketchfab.com/3d-models/daher-tbm-930-ba21567b779040038081f084fc528a44" target="_blank" rel="noopener">“Daher TBM 930”</a>
            by helijah, licensed
            <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.
            Modified: converted from the original OBJ with its parts kept separate,
            ventral fins removed,
            control surfaces and undercarriage hinged, glazing retuned.
          </dd>

          <dt>F-35A Lightning II</dt>
          <dd>
            <a href="https://sketchfab.com/3d-models/f-35a-lightning-ii-a06d6113cfb44a0aa7b8f17106aca9c4" target="_blank" rel="noopener">“F-35A Lightning II”</a>
            by shangus930, licensed
            <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.
            Modified: undercarriage split and hung, control surfaces hinged,
            canopy glazing retuned.
          </dd>

          <dt>Airbus A380</dt>
          <dd>
            <a href="https://sketchfab.com/3d-models/airbus-a380full-interior-hd-3155062bc0e545f897e8d766dbe7299e" target="_blank" rel="noopener">“Airbus A380(full interior hd)”</a>
            by Raakesh.Madan, licensed
            <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.
            Modified: cabin fit-out removed, glazing retuned, undercarriage split
            and hung on its trunnions.
          </dd>
        </dl>
        <button type="button" class="credits-close" data-credits-close>Close</button>
      </dialog>
    </main>

    <section id="hud" class="hud" aria-label="Flight information">
      <div class="hud-top">
        <div class="flight-brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <span><strong id="flightAircraft">C172</strong> · <span id="flightRegion">OʻAHU + KAUAʻI</span> FREE FLIGHT</span>
        </div>
        <div class="hud-actions">
          <button class="hud-button" id="cameraButton" type="button">Camera · Chase</button>
          <button class="hud-button" id="pauseButton" type="button">Pause</button>
        </div>
      </div>
      <div class="telemetry">
        <span class="metric"><span class="metric-value" id="speedValue">000</span><span class="metric-label">KIAS</span></span>
        <span class="metric"><span class="metric-value" id="altitudeValue">0000</span><span class="metric-label">Feet</span></span>
        <span class="metric"><span class="metric-value" id="headingValue">082</span><span class="metric-label">Heading</span></span>
        <span class="metric"><span class="metric-value" id="throttleValue">00</span><span class="metric-label">Throttle %</span></span>
        <span class="metric metric--fuel" id="fuelMetric"><span class="metric-value" id="fuelValue">100</span><span class="metric-label">Fuel %</span></span>
        <span class="metric"><span class="metric-value" id="flapsValue">0</span><span class="metric-label">Flaps °</span></span>
        <span class="metric"><span class="metric-value" id="gearValue">Down</span><span class="metric-label">Gear</span></span>
        <span class="metric"><span class="metric-value" id="brakeValue">Off</span><span class="metric-label">Brakes</span></span>
      </div>

      <div class="touch touch--left" id="touchLeft" aria-label="Attitude controls">
        <div class="tilt-pad" id="tiltPad">
          <button class="touch-key tilt-up" type="button" data-axis="pitch" data-value="1" aria-label="Pitch up">▲</button>
          <button class="touch-key tilt-left" type="button" data-axis="roll" data-value="1" aria-label="Roll left">◀</button>
          <span class="tilt-hub" aria-hidden="true"></span>
          <button class="touch-key tilt-right" type="button" data-axis="roll" data-value="-1" aria-label="Roll right">▶</button>
          <button class="touch-key tilt-down" type="button" data-axis="pitch" data-value="-1" aria-label="Pitch down">▼</button>
        </div>
        <div class="touch-row">
          <button class="touch-toggle" id="gyroButton" type="button" aria-pressed="false">Tilt&nbsp;device</button>
          <button class="touch-toggle touch-toggle--minor" id="gyroLevelButton" type="button" hidden>Set&nbsp;level</button>
        </div>
      </div>

      <div class="touch touch--right" id="touchRight" aria-label="Engine and configuration controls">
        <div class="touch-stack">
          <button class="touch-key touch-key--wide" type="button" data-axis="throttle" data-value="1" aria-label="Increase throttle">Thr&nbsp;▲</button>
          <button class="touch-key touch-key--wide" type="button" data-axis="throttle" data-value="-1" aria-label="Decrease throttle">Thr&nbsp;▼</button>
        </div>
        <div class="touch-stack">
          <button class="touch-key touch-key--wide" type="button" data-action="flaps-down" aria-label="Extend flaps">Flap&nbsp;▼</button>
          <button class="touch-key touch-key--wide" type="button" data-action="flaps-up" aria-label="Retract flaps">Flap&nbsp;▲</button>
        </div>
        <div class="touch-stack">
          <button class="touch-toggle" id="touchGear" type="button" data-action="gear" aria-pressed="true">Gear</button>
          <button class="touch-toggle" id="touchBrake" type="button" data-action="brakes" aria-pressed="false">Brakes</button>
        </div>
      </div>
    </section>

    <aside id="controlHint" class="control-hint" aria-label="Flight controls">
      <span class="hint-item"><span class="key">W S</span> Pitch</span>
      <span class="hint-item"><span class="key">A D</span> Roll</span>
      <span class="hint-item"><span class="key">Q E</span> Rudder</span>
      <span class="hint-item"><span class="key">↑ ↓</span> Throttle</span>
      <span class="hint-item"><span class="key">F V</span> Flaps</span>
      <span class="hint-item"><span class="key">B</span> Brakes</span>
      <span class="hint-item"><span class="key">C</span> Camera · drag to orbit</span>
    </aside>

    <button id="miniMapButton" class="mini-map" type="button" aria-label="Open navigation map and pause flight">
      <canvas id="miniMapCanvas" aria-hidden="true"></canvas>
      <span class="mini-map-label"><strong>Nav map</strong><span>Tap to expand</span></span>
      <span class="mini-map-north" aria-hidden="true">N</span>
    </button>

    <section id="mapOverlay" class="map-overlay" aria-labelledby="map-title" aria-hidden="true">
      <header class="map-header">
        <div>
          <span class="eyebrow">Flight paused · Navigation</span>
          <h2 id="map-title">Oʻahu + Kauaʻi flight map</h2>
        </div>
        <button id="closeMapButton" class="map-close" type="button">Resume flight <span aria-hidden="true">→</span></button>
      </header>
      <div class="map-stage">
        <canvas id="fullMapCanvas" role="img" aria-label="Map of the flying area showing the aircraft and nearby airports"></canvas>
        <div class="map-key" aria-hidden="true">
          <span><i class="key-aircraft"></i>Aircraft</span>
          <span><i class="key-airport"></i>Airport</span>
        </div>
      </div>
      <footer class="map-readout">
        <span><small>Position</small><strong id="mapPositionValue">—</strong></span>
        <span><small>Heading</small><strong id="mapHeadingValue">000°</strong></span>
        <span><small>Altitude</small><strong id="mapAltitudeValue">0 ft</strong></span>
        <span><small>Air speed</small><strong id="mapSpeedValue">0 KIAS</strong></span>
      </footer>
    </section>

    <aside id="pausePanel" class="pause-panel" aria-labelledby="pause-title">
      <div>
        <span class="eyebrow">Flight paused</span>
        <h2 id="pause-title">Hold your position.</h2>
      </div>
      <div class="pause-actions">
        <button id="resumeButton" type="button">Resume flight</button>
        <button id="rewindButton" type="button">Rewind five seconds</button>
        <button id="resetButton" type="button">Reset on runway</button>
        <button id="exitButton" type="button">Return to flight setup</button>
      </div>
    </aside>
    <aside id="crashPanel" class="crash-panel" aria-labelledby="crash-title" aria-hidden="true">
      <div class="crash-heading">
        <span class="eyebrow" id="crashKicker">Flight ended</span>
        <h2 id="crash-title">Aircraft destroyed</h2>
        <p class="crash-cause" id="crashCause"></p>
      </div>
      <dl class="crash-stats">
        <div><dt>Impact</dt><dd id="crashImpact">—</dd></div>
        <div><dt>Descent</dt><dd id="crashDescent">—</dd></div>
        <div><dt>Speed</dt><dd id="crashSpeed">—</dd></div>
        <div><dt>Bank</dt><dd id="crashBank">—</dd></div>
      </dl>
      <div class="pause-actions">
        <button id="crashRewindButton" type="button">Rewind and try again</button>
        <button id="crashResetButton" type="button">Restart on runway</button>
        <button id="crashExitButton" type="button">Return to flight setup</button>
      </div>
    </aside>
    <div id="crashVignette" class="crash-vignette" aria-hidden="true"></div>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
  </div>
`;

class FlightWorld {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9acfe3);
    this.scene.fog = new THREE.FogExp2(0xa9d3df, 0.00016);
    // Near plane at 20 cm: a fighter's instrument panel and canopy sit well
    // inside a metre of the pilot's eye, and would otherwise be clipped away.
    // The logarithmic depth buffer keeps precision across the range.
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.02, 20000);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.append(this.renderer.domElement);

    this.clock = new THREE.Clock();
    this.keys = new Set();
    // Continuous control from anything that is not the keyboard: the on-screen
    // tilt pad, or the device's own orientation. Merged with the keys each
    // frame rather than replacing them, so a Bluetooth keyboard on an iPad
    // keeps working alongside the touch controls.
    this.stick = { pitch: 0, roll: 0, throttle: 0 };
    this.running = false;
    this.paused = false;
    this.cameraMode = "chase";
    this.chaseOrbit = {
      yaw: 0,
      pitch: 0,
      targetYaw: 0,
      targetPitch: 0,
      dragging: false,
      pointerId: null,
      lastX: 0,
      lastY: 0,
      lastInputAt: -Infinity,
    };
    // Looking around from the left seat. Held where you leave it rather than
    // recentred on a timer the way the chase camera is: on final you want to
    // keep your eyes on the runway through the side window, and having the view
    // swing forward again on its own is the opposite of useful.
    this.cockpitView = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 };
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.aircraftId = "c172";
    this.airportIndex = 0;
    this.airStart = false;
    this.history = [];
    this.state = this.freshState();
    this.terrains = [];
    this.islands = new Map();
    this.worldBounds = null;
    this.mapBounds = null;

    this.buildEnvironment();
    this.plane = this.buildAircraft(AIRCRAFT.c172);
    this.measureAirframe(this.plane);
    this.prepareGear(this.plane);
    this.scene.add(this.plane);
    this.previewOrbit = 0;
    // The setup camera circles the selected area. Areas whose scenery has not
    // been built yet have nothing to circle, so the last built one stays on
    // screen behind the veil the setup screen draws over it.
    this.previewCircuit = REGIONS.find(({ built }) => built).orbit;
    this.bind();
    this.resize();
    // Let construction finish before the first render so the UI and debug
    // handles remain available even if a GPU driver rejects a new asset.
    requestAnimationFrame(() => this.animate());
  }

  freshState() {
    const spec = AIRCRAFT[this.aircraftId] ?? AIRCRAFT.c172;
    return {
      position: new THREE.Vector3(-18, 0.6, 26),
      velocity: 0,
      heading: THREE.MathUtils.degToRad(82),
      pitch: 0,
      roll: 0,
      // Flight path angle: where the aircraft is going, as opposed to where the
      // nose is pointing.
      gamma: 0,
      throttle: 0,
      flaps: 10,
      gear: true,
      // Undercarriage travel: 0 stowed, 1 down and locked.
      gearPosition: 1,
      // Commanded detent versus where the panels actually are. Aerodynamics and
      // geometry both follow the second, so lift and drag arrive as the flaps
      // travel rather than the instant the key is pressed.
      flapPosition: 10,
      aileron: 0,
      // Speedbrake in the air, wheel brakes on the ground.
      airbrake: false,
      verticalSpeed: 0,
      fuel: spec.fuelCapacity,
      engineRunning: true,
    };
  }

  buildEnvironment() {
    const hemi = new THREE.HemisphereLight(0xdaf4ff, 0x6d7258, 2.2);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1cf, 4.2);
    sun.position.set(-45, 75, -30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;
    sun.shadow.camera.far = 400;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun, sun.target);
    // The shadow volume is a few hundred metres across, so it travels with the
    // aircraft instead of sitting over the middle of the ocean.
    this.sun = sun;

    this.addOcean(sun);
    // Built up front so the impact frame has nothing to allocate or compile.
    this.crashEffects = new CrashEffects(this.scene);

    const terrain = new THREE.PlaneGeometry(118, 72, 150, 92);
    terrain.rotateX(-Math.PI / 2);
    const position = terrain.attributes.position;
    const colors = [];
    const color = new THREE.Color();
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const coast = Math.exp(-((x / 50) ** 8 + (z / 27) ** 8));
      const ridgeA = 13 * Math.exp(-(((x - 13) / 23) ** 2 + ((z + 3) / 6) ** 2));
      const ridgeB = 9 * Math.exp(-(((x + 17) / 18) ** 2 + ((z - 4) / 7) ** 2));
      const valleys = 1.4 * Math.sin(x * 0.42) * Math.cos(z * 0.5);
      const y = Math.max(-0.45, coast * (0.35 + ridgeA + ridgeB + valleys * coast) - 0.28);
      position.setY(i, y);
      if (y < 0.05) color.set(0xc4b77a);
      else if (y < 2) color.set(0x5e8a45);
      else if (y < 7) color.set(0x426c3e);
      else color.set(0x5f6e55);
      const shade = 0.9 + Math.sin(x * 1.7 + z * 0.8) * 0.035;
      colors.push(color.r * shade, color.g * shade, color.b * shade);
    }
    terrain.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    terrain.computeVertexNormals();
    const island = new THREE.Mesh(
      terrain,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }),
    );
    island.receiveShadow = true;
    this.scene.add(island);
    // Stands in until an area's real terrain arrives, and comes back whenever
    // one is released so the menu is never looking at empty sky.
    this.placeholder = island;
    this.island = island;

    this.addHonolulu();
    this.addClouds();
    // The C172's exterior is a downloaded model rather than built geometry, so
    // it is fetched alongside the scenery and swapped in when it lands. Until
    // then the built model flies, which keeps the menu usable on a slow link.
    preloadC172().then((source) => {
      if (source && this.aircraftId === "c172") this.selectAircraft("c172");
    });

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(15000, 36, 18),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          topColor: { value: new THREE.Color(0x4da8d5) },
          // Matches the fog the ocean fades into, so the two meet without a
          // visible line at the horizon.
          bottomColor: { value: new THREE.Color(0xa9d3df) },
        },
        vertexShader: `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: `
          #include <common>
          #include <logdepthbuf_pars_fragment>
          uniform vec3 topColor;
          uniform vec3 bottomColor;
          varying vec3 vPos;
          void main() {
            #include <logdepthbuf_fragment>
            float h = normalize(vPos).y * .5 + .5;
            gl_FragColor = vec4(mix(bottomColor, topColor, smoothstep(.15, .82, h)), 1.0);
          }`,
      }),
    );
    this.sky = sky;
    this.scene.add(sky);
  }

  addHonolulu() {
    const city = new THREE.Group();
    const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0xd4d0bf, roughness: 0.82 });
    const hotelMaterial = new THREE.MeshStandardMaterial({ color: 0xe4d6bd, roughness: 0.78 });
    for (let i = 0; i < 150; i += 1) {
      const x = -13 + (i % 25) * 0.8 + Math.sin(i * 5.1) * 0.2;
      const z = 14 + Math.floor(i / 25) * 0.75;
      const h = 0.35 + ((i * 17) % 9) * 0.16;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.34 + (i % 3) * 0.08, h, 0.34 + (i % 4) * 0.05),
        i % 7 === 0 ? hotelMaterial : buildingMaterial,
      );
      mesh.position.set(x, h / 2 + 0.12, z);
      mesh.castShadow = i % 3 === 0;
      city.add(mesh);
    }
    this.city = city;
    this.scene.add(city);
  }

  /**
   * Swaps the resident area. Areas are separate coordinate frames, so this is a
   * teardown and a rebuild rather than an addition: the previous area's meshes,
   * textures and airfields are released before the new ones are fetched.
   */
  async loadScenery(region) {
    // A second area picked while the first is still in flight must not have its
    // scenery half-overwritten by the load it interrupted.
    const token = Symbol(region.id);
    this.sceneryToken = token;
    this.releaseScenery();
    this.region = region;
    this.applyAtmosphere(region);

    try {
      const terrains = await Promise.all(
        region.terrains.map(async (source) => {
          const [metadataResponse, heightResponse] = await Promise.all([
            fetch(asset(source.metadata)),
            fetch(asset(source.heights)),
          ]);
          if (!metadataResponse.ok || !heightResponse.ok) {
            throw new Error(`${source.id} terrain responded ${metadataResponse.status}/${heightResponse.status}`);
          }
          const metadata = await metadataResponse.json();
          const heights = new Float32Array(await heightResponse.arrayBuffer());
          const [samplesX, samplesY] = metadata.samples;
          if (heights.length !== samplesX * samplesY) {
            throw new Error(`${source.id} terrain sample count is invalid`);
          }
          return {
            id: source.id,
            far: Boolean(source.far),
            metadata,
            heights,
            bounds: terrainWorldBounds(metadata),
          };
        }),
      );
      if (this.sceneryToken !== token) return;
      this.terrains = terrains;

      // The first mesh listed carries the area's projection, which is the frame
      // its airports and imagery were baked against.
      const reference = terrains[0];
      this.terrainMetadata = reference.metadata;
      this.terrainHeights = reference.heights;
      const union = (list) => list.reduce(
        ([west, north, east, south], terrain) => [
          Math.min(west, terrain.bounds[0]),
          Math.min(north, terrain.bounds[1]),
          Math.max(east, terrain.bounds[2]),
          Math.max(south, terrain.bounds[3]),
        ],
        [Infinity, Infinity, -Infinity, -Infinity],
      );
      this.worldBounds = union(terrains);
      // Far terrain exists to fill the horizon, not to be flown over. Framing
      // the navigation map on it would shrink the surveyed area to a smudge in
      // the middle of two hundred kilometres of context.
      this.mapBounds = union(terrains.filter(({ far }) => !far));

      // The graded airfields have to exist before the terrain mesh is built so
      // that the visible ground and the surface the aircraft rolls along are
      // generated from exactly the same height function.
      const airportData = await loadAirports(region.airports).catch((error) => {
        console.warn("Airport data unavailable; flying without airfields.", error);
        return null;
      });
      if (this.sceneryToken !== token) return;
      if (airportData) this.airfieldGround = new AirfieldGround(airportData.airports);

      for (const terrain of terrains) {
        const { metadata, heights, bounds } = terrain;
        const [samplesX, samplesY] = metadata.samples;
        const [worldWidth, worldDepth] = metadata.worldSize;
        const centreX = (bounds[0] + bounds[2]) / 2;
        const centreZ = (bounds[1] + bounds[3]) / 2;
        const geometry = new THREE.PlaneGeometry(worldWidth, worldDepth, samplesX - 1, samplesY - 1);
        geometry.rotateX(-Math.PI / 2);
        const position = geometry.attributes.position;
        // Shared with `sampleTerrain`, so the surface the decals and the flight
        // model see is the surface that was drawn.
        // Inland areas have no coastline to reconcile, so no apron either.
        const nearShore = region.sea
          ? nearShoreMask(heights, samplesX, samplesY, SHORE_APRON_SAMPLES)
          : null;
        terrain.nearShore = nearShore;
        // The hole cut below leaves the far grid overlapping the fine one by up
        // to a cell, and the two disagree about the ground by as much as three
        // hundred metres where the Kaibab escarpment crosses the boundary — a
        // half-kilometre coarse sample cannot follow it. Left alone the overlap
        // floats above the fine mesh as a grey shelf. Deferring to the fine
        // grid wherever it has an opinion settles the seam onto one surface.
        const covered = terrain.far ? terrains.filter(({ far }) => !far) : [];
        for (let i = 0; i < position.count; i += 1) {
          const worldX = position.getX(i) + centreX;
          const worldZ = position.getZ(i) + centreZ;
          let natural = drawnSurface(heights[i], metadata.verticalScale);
          for (const fine of covered) {
            const settled = drawnHeightIn(fine, worldX, worldZ);
            if (settled !== null) natural = settled;
          }
          if (nearShore?.[i]) natural = Math.max(natural, WATER_SURFACE);
          position.setY(
            i,
            this.airfieldGround
              ? this.airfieldGround.heightAt(worldX, worldZ, natural)
              : natural,
          );
        }
        if (terrain.far) openTerrainHole(geometry, centreX, centreZ, terrains.filter((t) => !t.far));
        geometry.computeVertexNormals();
        // Surveyed elevation travels with the mesh so the shader can tell
        // photographed sea from photographed shadow. See `shadeShoreline`.
        geometry.setAttribute("elevation", new THREE.BufferAttribute(heights.slice(), 1));

        const island = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: 0x8e9a76,
            roughness: 0.96,
            metalness: 0,
            // The hole is cut a cell wide so the two meshes overlap rather than
            // crack; the offset settles which of them wins in that overlap.
            ...(terrain.far
              ? { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }
              : {}),
          }),
        );
        island.position.set(centreX, 0, centreZ);
        island.receiveShadow = !terrain.far;
        island.name = terrain.id;
        this.islands.set(terrain.id, island);
        this.scene.add(island);
      }
      this.island = this.islands.values().next().value;
      if (region.sea) {
        terrains.slice(0, 2).forEach((terrain, index) => this.buildShoreDistance(terrain, index));
      }
      // Procedural blocks no longer align once the real georeferenced terrain is active.
      this.city.visible = false;
      this.placeholder.visible = false;

      this.loadImagery(region, token);

      if (airportData) {
        this.airports = new AirportScenery(airportData);
        this.scene.add(this.airports.group);
        this.publishRunways(airportData);
      }
      // The navigation map is drawn from the elevation grids, so it has to be
      // redrawn for the new frame.
      flightMap.ready = false;
    } catch (error) {
      console.warn(`${region.name} scenery could not be loaded.`, error);
    }
  }

  /** Drops everything the previous area put in the scene. */
  releaseScenery() {
    // Surround skirts share their terrain's material, so materials are
    // collected and released once rather than per mesh.
    const materials = new Set();
    const drop = (mesh) => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      materials.add(mesh.material);
    };
    for (const island of this.islands.values()) drop(island);
    this.islands.clear();
    for (const mesh of this.scene.children.filter(({ name }) => name?.startsWith("scenery-"))) {
      drop(mesh);
    }
    for (const material of materials) {
      // `alphaMap` is the shared feather mask, which outlives any one area.
      material.map?.dispose();
      material.dispose();
    }
    if (this.airports) {
      this.scene.remove(this.airports.group);
      this.airports.dispose?.();
      this.airports = null;
    }
    this.airfieldGround = null;
    this.seam = null;
    this.terrains = [];
    this.worldBounds = null;
    this.mapBounds = null;
    this.terrainMetadata = null;
    this.terrainHeights = null;
    // The shore-distance fields are built per area and live in the ocean's
    // uniforms rather than on any mesh, so nothing else would reclaim them.
    for (const key of ["shoreMapA", "shoreMapB"]) {
      const uniform = this.ocean.material.uniforms[key];
      uniform.value?.dispose();
      uniform.value = null;
    }
    this.ocean.material.uniforms.shoreCount.value = 0;
    this.placeholder.visible = true;
  }

  /** Sea, sky and haze for the resident area. */
  applyAtmosphere(region) {
    const { top, bottom, fog, density } = region.air;
    this.scene.fog.color.setHex(fog);
    this.scene.fog.density = density;
    this.sky.material.uniforms.topColor.value.setHex(top);
    this.sky.material.uniforms.bottomColor.value.setHex(bottom);
    this.ocean.visible = Boolean(region.sea);
    this.clouds.position.y = region.cloudBase ?? 0;
  }

  /** Applies the baked USGS orthoimagery to the terrain and each airfield. */
  async loadImagery(region, token) {
    let manifest;
    try {
      const response = await fetch(asset("/imagery/manifest.json"));
      if (!response.ok) return;
      manifest = await response.json();
    } catch {
      return;
    }

    const loader = new THREE.TextureLoader();
    const load = (name) =>
      new Promise((resolve, reject) => loader.load(asset(`/imagery/${name}.jpg`), resolve, undefined, reject));

    // One manifest covers every area, so take only the layers belonging to the
    // one being loaded.
    for (const layer of manifest.layers.filter(({ region: id }) => id === region.id)) {
      let texture;
      try {
        texture = await load(layer.name);
      } catch {
        continue;
      }
      // Each texture takes a network round trip, so the area can have been
      // swapped out from under this loop between any two of them.
      if (this.sceneryToken !== token) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());

      const ground = this.islands.get(layer.name);
      if (layer.kind === "ground") {
        if (!ground) continue;
        ground.material.map = texture;
        ground.material.color.set(0xffffff);
        // Nothing inland is near enough to the waterline for the shoreline test
        // to fire, so an area without a coast gets the inland treatment instead.
        if (region.sea) this.shadeShoreline(ground.material);
        else {
          const terrain = this.terrains.find(({ id }) => id === layer.name);
          // Each mosaic is a separate export with its own exposure, so each is
          // measured against its own frame. The detail mesh's figure is kept
          // for the airfield insets, which lie wholly on one side of the line
          // and so have no step of their own to read.
          const offset = region.seam
            ? this.measureSeamOffset(texture.image, layer.bounds, region.seam.worldX)
            : null;
          // How much of this mesh lies east of the line decides how the
          // correction is split between the two sides.
          const [west, , east] = layer.bounds;
          const seam = offset
            ? { offset, share: (east - region.seam.worldX) / (east - west) }
            : null;
          if (seam && !terrain?.far) this.seam = seam;
          this.shadeGround(ground.material, region, terrain, seam);
        }
        ground.material.needsUpdate = true;
        continue;
      }
      this.scene.add(this.buildImageryDecal(layer, texture, region));
    }
  }

  /**
   * Dissolves photographed sea out of the draped orthophoto so the rendered
   * ocean takes over at the real waterline.
   *
   * The elevation grid behind the terrain resolves a sample every 140 m, while
   * the photograph resolves one every 18 m. Wherever those two disagree about
   * where the shore is — and along a fractal coastline they disagree constantly
   * — a cell the survey calls land carries a photograph of open water, and the
   * result is the ragged navy staircase that used to edge the island. Deciding
   * per fragment from the photograph itself moves the visible waterline onto
   * the finer of the two sources.
   *
   * Colour alone cannot make the call: a shaded windward valley is every bit as
   * dark and nearly as blue as deep water, and a purely photometric test eats
   * the whole Koʻolau range. Water is therefore only ever removed near the
   * waterline, where the survey agrees it is plausible.
   */
  shadeShoreline(material) {
    // Fully transparent fragments are dropped rather than blended so they leave
    // the depth buffer alone and the ocean beneath them stays addressable.
    material.transparent = true;
    material.alphaTest = 0.02;
    // Programs are cached on the material's parameters, which say nothing about
    // an injected shader, so the key has to declare the injection itself.
    material.customProgramCacheKey = () => "shoreline";
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          attribute float elevation;
          varying float vElevation;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          vElevation = elevation;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          varying float vElevation;`,
        )
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          {
            // The thresholds below were read off the JPEG, so the comparison is
            // made on gamma-encoded values rather than the linear ones the rest
            // of the shader works in.
            vec3 photo = pow(max(diffuseColor.rgb, 0.0), vec3(0.4545));
            float luma = dot(photo, vec3(0.299, 0.587, 0.114));
            float peak = max(photo.r, max(photo.g, photo.b));

            // Outside the flown footprint the mosaic is filled with black.
            float nodata = 1.0 - smoothstep(0.05, 0.09, peak);
            // Water absorbs red first and green second, so open sea is the one
            // thing in the frame that is dark and strongly blue-led. Foliage in
            // shadow is dark but green-led; wet sand and cloud shadow are dark
            // but grey.
            float blueLed = smoothstep(0.0, 0.03, photo.b - photo.g)
              * smoothstep(0.30, 0.50, (photo.b - photo.r) / max(photo.b, 0.004));
            // Reef turquoise stays: it is bright, and it reads far better than
            // anything the water shader can invent at that scale.
            float dark = 1.0 - smoothstep(0.306, 0.439, luma);
            float sea = max(nodata, blueLed * dark);

            // Only near the waterline. Ten metres clears every beach, harbour
            // and reef flat; by thirty the photograph is trusted outright.
            sea *= 1.0 - smoothstep(10.0, 30.0, vElevation);
            diffuseColor.a *= 1.0 - sea;
          }`,
        );
    };
  }

  /**
   * Measures a mosaic's exposure step across a state line, in 0–255 levels.
   *
   * NAIP is flown per state, so an area straddling a border gets two exposures
   * butted together. How big the step is cannot be assumed — Nevada is brighter
   * than California over Tahoe, Idaho is darker than Wyoming over the Tetons —
   * and it cannot be taken from block means either, because the land genuinely
   * differs across a border: measuring Tahoe in 2.6 km blocks reports anything
   * from 25 to 70 levels depending on where the blocks fall, most of it the
   * Carson Range rather than the camera.
   *
   * So the step is read as a discontinuity. For each row, the median of a short
   * run either side of the line; then the median of those differences. Short
   * runs keep the land comparable, and the medians reject the rows where it is
   * not.
   */
  measureSeamOffset(image, bounds, seamWorldX) {
    const [west, , east] = bounds;
    const column = Math.round(((seamWorldX - west) / (east - west)) * (image.width - 1));
    const RUN = 30;
    const GAP = 3;
    if (column - GAP - RUN < 0 || column + GAP + RUN >= image.width) return null;

    const canvas = document.createElement("canvas");
    canvas.width = RUN * 2;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, column - GAP - RUN, 0, RUN, image.height, 0, 0, RUN, image.height);
    context.drawImage(image, column + GAP, 0, RUN, image.height, RUN, 0, RUN, image.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);

    const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];
    const differences = [[], [], []];
    for (let row = 0; row < image.height; row += 1) {
      const side = [[[], [], []], [[], [], []]];
      let water = 0;
      for (let k = 0; k < RUN * 2; k += 1) {
        const offset = (row * canvas.width + k) * 4;
        const half = k < RUN ? 0 : 1;
        const [r, g, b] = [data[offset], data[offset + 1], data[offset + 2]];
        if (b > g && b > r) water += 1;
        side[half][0].push(r);
        side[half][1].push(g);
        side[half][2].push(b);
      }
      // A row that is mostly lake says nothing about how the land was exposed.
      if (water > RUN * 0.4) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        differences[channel].push(median(side[1][channel]) - median(side[0][channel]));
      }
    }
    if (differences[0].length < image.height * 0.15) return null;
    return differences.map(median);
  }

  /**
   * Fixes up a draped orthophoto: the mosaic's exposure seams, and any lake
   * that is better shaded than photographed. Both are per-area, and both are
   * skipped entirely when the area needs neither.
   *
   * **Seams.** NAIP is flown per state, so an area straddling a state line gets
   * two exposures butted together. Over Lake Tahoe the California/Nevada line
   * runs down the middle of the box and the join is a hard vertical step of
   * about thirty-five levels in every channel. The correction is a subtraction
   * rather than a gain because that is what the measurement says: the two sides
   * differ in mean by thirty-odd levels while their standard deviations match
   * within ten percent, so the exposure is offset, not scaled. A gain that
   * matched the means would flatten Nevada's contrast by a third.
   *
   * **Lakes.** The orthophoto over Tahoe is the worst frame in any of the
   * mosaics: vertical scan banding, that exposure step through the middle, and
   * a scatter of sun-glare blooms, all draped on a perfectly flat surface with
   * nothing to distract from any of it. The survey is what identifies the water
   * — a lake is the one part of a mountain DEM that is exactly level — so
   * fragments within a couple of metres of the known surface get a calm alpine
   * surface instead of the photograph.
   */
  shadeGround(material, region, terrain, seam) {
    const lake = region.waterLevelM && !terrain?.far ? region.waterLevelM : null;
    if (!seam && !lake) return;
    material.customProgramCacheKey = () => `ground:${seam ? "seam" : ""}:${lake ? "lake" : ""}`;
    material.onBeforeCompile = (shader) => {
      if (seam) {
        shader.uniforms.seamX = { value: region.seam.worldX };
        shader.uniforms.seamFeather = { value: region.seam.feather };
        shader.uniforms.seamOffset = {
          value: new THREE.Vector3(...seam.offset.map((level) => level / 255)),
        };
        shader.uniforms.seamShare = { value: seam.share };
      }
      if (lake) {
        shader.uniforms.lakeLevel = { value: lake };
        shader.uniforms.lakeDeep = { value: new THREE.Color(0x14405e) };
        shader.uniforms.lakeShallow = { value: new THREE.Color(0x2f8fa8) };
        shader.uniforms.lakeSky = { value: new THREE.Color(region.air.bottom) };
        shader.uniforms.lakeSun = { value: this.sun.position.clone().normalize() };
      }
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          varying vec3 vGround;
          ${lake ? "attribute float elevation;\n          varying float vElevation;" : ""}`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          vGround = (modelMatrix * vec4(position, 1.0)).xyz;
          ${lake ? "vElevation = elevation;" : ""}`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          varying vec3 vGround;
          ${seam ? "uniform float seamX;\n          uniform float seamFeather;\n          uniform vec3 seamOffset;\n          uniform float seamShare;" : ""}
          ${lake ? `uniform float lakeLevel;
          uniform vec3 lakeDeep;
          uniform vec3 lakeShallow;
          uniform vec3 lakeSky;
          uniform vec3 lakeSun;
          varying float vElevation;` : ""}`,
        )
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          ${seam ? `{
            // Both sides move, in proportion to how much of the frame the other
            // one covers, so the step closes without dragging the whole scene
            // to whichever exposure happens to be on the smaller side of the
            // line. The offset was read off eight-bit pixels, so it is applied
            // to the gamma-encoded value rather than the linear one.
            float east = smoothstep(seamX - seamFeather, seamX + seamFeather, vGround.x);
            float amount = mix(seamShare, seamShare - 1.0, east);
            vec3 photo = pow(max(diffuseColor.rgb, 0.0), vec3(0.4545));
            diffuseColor.rgb = pow(clamp(photo + seamOffset * amount, 0.0, 1.0), vec3(2.2));
          }` : ""}
          ${lake ? `{
            // Two metres of tolerance covers the survey's own noise over water
            // without reaching the shelving ground at the edge.
            float water = 1.0 - smoothstep(1.0, 3.0, abs(vElevation - lakeLevel));
            if (water > 0.0) {
              vec3 V = normalize(cameraPosition - vGround);
              // Modelled flat: a lake this size read from a cockpit has no slope
              // worth shading, and the light does the work.
              vec3 N = vec3(0.0, 1.0, 0.0);
              float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
              // The shallows show only where the bed has started to rise, which
              // the survey reports as the surface creeping above true level.
              float shelf = smoothstep(0.0, 1.6, vElevation - lakeLevel);
              vec3 surface = mix(mix(lakeDeep, lakeShallow, shelf), lakeSky, fresnel * 0.6 + 0.05);
              vec3 H = normalize(lakeSun + V);
              surface += pow(max(dot(N, H), 0.0), 220.0) * 1.6 * vec3(1.0, 0.98, 0.92);
              diffuseColor.rgb = mix(diffuseColor.rgb, surface, water);
            }
          }` : ""}`,
        );
    };
  }

  /**
   * A ground-conforming patch of high-resolution imagery. It follows the same
   * height function as the terrain, so it drapes over the graded airfield and
   * the natural ground around it alike.
   */
  buildImageryDecal(layer, texture, region) {
    const [west, north, east, south] = layer.bounds;
    const centreX = (west + east) / 2;
    const centreZ = (north + south) / 2;
    const segments = 192;
    const geometry = new THREE.PlaneGeometry(east - west, south - north, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position;
    // RGBA vertex colours. The photograph is kept over dry land and over graded
    // pavement — including a runway built out on a reef — but dissolved over
    // open water, where the simulated sea reads far better than the near-black
    // deep water a colour-infrared orthophoto records.
    const tint = new Float32Array(position.count * 4);
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i) + centreX;
      const z = position.getZ(i) + centreZ;
      // Following the drawn surface sinks the inset with the sea bed instead of
      // leaving it hovering at the waterline over open water.
      position.setY(i, this.getSurfaceHeight(x, z) + 0.005);
      const land = THREE.MathUtils.smoothstep(
        this.sampleElevation(x, z),
        WATERLINE_METRES,
        WATERLINE_METRES + 3,
      );
      const paved = this.airfieldGround
        ? THREE.MathUtils.smoothstep(this.airfieldGround.coverageAt(x, z), 0.35, 0.8)
        : 0;
      tint.set([1, 1, 1, Math.max(land, paved)], i * 4);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(tint, 4));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        map: texture,
        vertexColors: true,
        // The inset is a separate NAIP export, so its exposure never quite
        // matches the island mosaic or the water plane. Fading the border out
        // hides both joins.
        alphaMap: this.featherTexture(),
        transparent: true,
        roughness: 0.96,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    mesh.position.set(centreX, 0, centreZ);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.name = `scenery-imagery-${layer.name}`;
    // An inset lies wholly on one side of a state line, so correcting it the
    // same way as the ground keeps a Nevada airfield from sitting thirty levels
    // brighter than the ground now balanced around it.
    if (region?.seam && this.seam) this.shadeGround(mesh.material, region, null, this.seam);
    return mesh;
  }

  /** Soft-edged alpha mask shared by every imagery inset. */
  featherTexture() {
    if (this.feather) return this.feather;
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    context.fillStyle = "#000";
    context.fillRect(0, 0, size, size);
    context.filter = `blur(${size * 0.045}px)`;
    context.fillStyle = "#fff";
    const inset = size * 0.075;
    context.fillRect(inset, inset, size - inset * 2, size - inset * 2);
    this.feather = new THREE.CanvasTexture(canvas);
    return this.feather;
  }

  /** Exposes every paved runway end to the departure picker and the nav map. */
  publishRunways(airportData) {
    for (const airport of AIRPORTS) {
      const source = airportData.airports.find(({ code }) => code === airport.code);
      if (!source) continue;
      airport.ends = [];
      airport.lines = [];
      for (const runway of source.runways) {
        if (runway.water) continue;
        airport.lines.push([...runway.ends[0].world, ...runway.ends[1].world]);
        for (const end of runway.ends) {
          const start = this.airports.runwayStart(airport.code, end.ident);
          if (start) airport.ends.push({ ident: end.ident, ...start });
        }
      }
      airport.ends.sort((a, b) => a.ident.localeCompare(b.ident, undefined, { numeric: true }));
      const preferred = airport.ends.findIndex(({ ident }) => ident === airport.runway);
      airport.selected = preferred === -1 ? 0 : preferred;
      if (airport.ends.length) this.applyRunway(airport, airport.ends[airport.selected]);
    }
    updateAirport();
  }

  applyRunway(airport, end) {
    airport.runway = end.ident;
    airport.x = end.position.x;
    airport.z = end.position.z;
    airport.heading = (THREE.MathUtils.radToDeg(end.heading) + 360) % 360;
    airport.elevation = end.position.y;
  }

  /**
   * Bilinear DEM lookup. `mapSample` turns a raw elevation in metres into a
   * world height and is applied per sample, before interpolation, so callers
   * that want the visible surface and callers that want the flyable surface
   * both stay consistent with the terrain mesh right up to the shoreline. It
   * also receives whether the sample sits inside the shore apron, which the
   * drawn mesh lifts clear of the water plane.
   */
  sampleTerrain(x, z, mapSample, graded = true) {
    if (!this.terrains.length) return 0;
    const terrain = this.terrains.find(({ bounds }) =>
      x >= bounds[0] && x <= bounds[2] && z >= bounds[1] && z <= bounds[3]);
    if (!terrain) {
      const natural = mapSample(0, this.terrainMetadata, 0);
      return graded && this.airfieldGround
        ? this.airfieldGround.heightAt(x, z, natural)
        : natural;
    }
    const { metadata, heights, bounds, nearShore } = terrain;
    const [samplesX, samplesY] = metadata.samples;
    const sampleX = THREE.MathUtils.clamp(
      ((x - bounds[0]) / (bounds[2] - bounds[0])) * (samplesX - 1),
      0,
      samplesX - 1,
    );
    const sampleY = THREE.MathUtils.clamp(
      ((z - bounds[1]) / (bounds[3] - bounds[1])) * (samplesY - 1),
      0,
      samplesY - 1,
    );
    const x0 = Math.floor(sampleX);
    const y0 = Math.floor(sampleY);
    const x1 = Math.min(samplesX - 1, x0 + 1);
    const y1 = Math.min(samplesY - 1, y0 + 1);
    const tx = sampleX - x0;
    const ty = sampleY - y0;
    const i00 = y0 * samplesX + x0;
    const i10 = y0 * samplesX + x1;
    const i01 = y1 * samplesX + x0;
    const i11 = y1 * samplesX + x1;
    const north = THREE.MathUtils.lerp(
      mapSample(heights[i00], metadata, nearShore?.[i00] ?? 0),
      mapSample(heights[i10], metadata, nearShore?.[i10] ?? 0),
      tx,
    );
    const south = THREE.MathUtils.lerp(
      mapSample(heights[i01], metadata, nearShore?.[i01] ?? 0),
      mapSample(heights[i11], metadata, nearShore?.[i11] ?? 0),
      tx,
    );
    const natural = THREE.MathUtils.lerp(north, south, ty);
    return graded && this.airfieldGround
      ? this.airfieldGround.heightAt(x, z, natural)
      : natural;
  }

  /**
   * Height of the ground the aircraft rolls on. Open water is the sea surface,
   * and over an airfield this is the top of the pavement rather than the graded
   * earth underneath it.
   */
  getTerrainHeight(x, z) {
    const ground = this.sampleTerrain(x, z, (metres, metadata) =>
      Math.max(drawnSurface(metres, metadata.verticalScale), WATER_SURFACE));
    return this.airfieldGround?.rollingHeightAt(x, z, ground) ?? ground;
  }

  /**
   * Height of the ground as it is drawn: the sea bed sits below the surface,
   * except across the shore apron, which the mesh holds at the waterline.
   */
  getSurfaceHeight(x, z) {
    return this.sampleTerrain(x, z, (metres, metadata, nearShore) => {
      const drawn = drawnSurface(metres, metadata.verticalScale);
      return nearShore ? Math.max(drawn, WATER_SURFACE) : drawn;
    });
  }

  /** Raw surveyed elevation in metres, before any airfield grading. */
  sampleElevation(x, z) {
    return this.sampleTerrain(x, z, (metres) => metres, false);
  }


  /**
   * The open ocean. A flat lit plane reads as a sheet of plastic from the air,
   * so the surface is shaded from three cues that actually carry over water:
   * depth graded by distance to the nearest land, a sun-glitter path, and surf
   * breaking along the shore.
   */
  addOcean(sun) {
    const direction = sun.position.clone().normalize();
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          shoreMapA: { value: null },
          shoreMapB: { value: null },
          shoreBoundsA: { value: new THREE.Vector4(0, 0, 1, 1) },
          shoreBoundsB: { value: new THREE.Vector4(0, 0, 1, 1) },
          shoreCount: { value: 0 },
          eye: { value: new THREE.Vector3() },
          sunDirection: { value: direction },
          time: { value: 0 },
          shallowColor: { value: new THREE.Color(0x35ccb0) },
          shelfColor: { value: new THREE.Color(0x2298b8) },
          deepColor: { value: new THREE.Color(0x1a6392) },
          skyColor: { value: new THREE.Color(0xbcdfe8) },
          foamColor: { value: new THREE.Color(0xeaf5f6) },
        },
      ]),
      vertexShader: `
        #include <common>
        // The renderer uses a logarithmic depth buffer; a custom shader has to
        // opt in or its depth will not compare against anything else.
        #include <logdepthbuf_pars_vertex>
        #include <fog_pars_vertex>
        varying vec3 vWorldPosition;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldPosition = world.xyz;
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        #include <fog_pars_fragment>
        uniform sampler2D shoreMapA;
        uniform sampler2D shoreMapB;
        uniform vec4 shoreBoundsA;
        uniform vec4 shoreBoundsB;
        uniform float shoreCount;
        uniform vec3 eye;
        uniform vec3 sunDirection;
        uniform float time;
        uniform vec3 shallowColor;
        uniform vec3 shelfColor;
        uniform vec3 deepColor;
        uniform vec3 skyColor;
        uniform vec3 foamColor;
        varying vec3 vWorldPosition;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y);
        }

        void main() {
          #include <logdepthbuf_fragment>
          vec3 toEye = eye - vWorldPosition;
          float viewDistance = length(toEye);
          vec3 V = toEye / viewDistance;
          vec2 p = vWorldPosition.xz;

          // Wave slope from four rotating swell layers. The whole perturbation
          // fades out with distance, otherwise the far surface aliases into
          // moire long before it reaches the horizon.
          // Keep a floor under the perturbation: at grazing angles every pixel
          // is far away, and a perfectly flat surface there looks like glass.
          float detail = max(1.0 - smoothstep(150.0, 4000.0, viewDistance), 0.16);
          vec2 slope = vec2(0.0);
          vec2 direction = normalize(vec2(0.86, -0.5));
          float amplitude = 1.0;
          float frequency = 0.075;
          // A noise term breaks the swell up, so it does not read as a regular
          // corduroy pattern stretching to the horizon.
          float wander = noise(p * 0.02) * 6.2831;
          for (int i = 0; i < 4; i++) {
            float phase = dot(p, direction) * frequency + time * (0.5 + float(i) * 0.4)
              + wander * (0.35 + float(i) * 0.25);
            slope += direction * cos(phase) * amplitude;
            amplitude *= 0.52;
            frequency *= 2.15;
            direction = vec2(
              direction.x * 0.62 - direction.y * 0.78,
              direction.x * 0.78 + direction.y * 0.62);
          }
          vec3 N = normalize(vec3(-slope.x * 0.09 * detail, 1.0, -slope.y * 0.09 * detail));

          // Distance to the nearest land, normalised over six kilometres.
          float shore = 1.0;
          vec2 shoreUvA = (p - shoreBoundsA.xy) / (shoreBoundsA.zw - shoreBoundsA.xy);
          if (shoreCount > 0.5 && shoreUvA.x >= 0.0 && shoreUvA.x <= 1.0 &&
              shoreUvA.y >= 0.0 && shoreUvA.y <= 1.0) {
            shore = texture2D(shoreMapA, shoreUvA).r;
          }
          vec2 shoreUvB = (p - shoreBoundsB.xy) / (shoreBoundsB.zw - shoreBoundsB.xy);
          if (shoreCount > 1.5 && shoreUvB.x >= 0.0 && shoreUvB.x <= 1.0 &&
              shoreUvB.y >= 0.0 && shoreUvB.y <= 1.0) {
            shore = texture2D(shoreMapB, shoreUvB).r;
          }
          // Break the coarse elevation grid up so the shelf edge is not blocky.
          float grain = noise(p * 0.05) * 0.35 + noise(p * 0.011) * 0.65;
          float depth = clamp(shore + (grain - 0.5) * 0.035, 0.0, 1.0);

          // Hawaiʻi's fringing reefs run a few hundred metres to a couple of
          // kilometres out, also about the finest the 140 m elevation grids
          // behind this can resolve.
          vec3 water = mix(shallowColor, shelfColor, smoothstep(0.02, 0.18, depth));
          water = mix(water, deepColor, smoothstep(0.15, 0.55, depth));
          // Broad mottling so open water is never one flat tone.
          water *= 0.92 + 0.16 * noise(p * 0.004 + time * 0.004);

          // Grazing angles reflect sky, steep angles show the water colour. The
          // constant term stands in for skylight scattered back out of the
          // water, which keeps deep ocean from crushing to black overhead.
          float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
          vec3 color = mix(water, skyColor, fresnel * 0.55 + 0.06);

          // Sun glitter: a tight sparkle close in over a narrow sheen. A broad
          // sheen washes the whole surface out to a flat pale grey.
          vec3 H = normalize(sunDirection + V);
          float specular = pow(max(dot(N, H), 0.0), 260.0) * 2.4 * detail;
          float sheen = pow(max(dot(N, H), 0.0), 44.0) * 0.07;
          color += (specular + sheen) * vec3(1.0, 0.97, 0.9);

          // Surf: a broken band of white water along the shoreline.
          float surf = 1.0 - smoothstep(0.0, 0.055, depth);
          float breaking = noise(p * 0.09 - time * 0.05) * 0.6 + noise(p * 0.32 + time * 0.08) * 0.4;
          float foam = smoothstep(0.5, 0.95, surf * (0.55 + breaking * 0.8));
          color = mix(color, foamColor, clamp(foam, 0.0, 1.0));

          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
      fog: true,
    });

    // Sized so its far corners stay inside the camera's far plane; any larger
    // and the frustum clips the sheet into a visible arc short of the horizon.
    const water = new THREE.Mesh(new THREE.PlaneGeometry(26000, 26000, 1, 1), material);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.12;
    water.name = "ocean";
    this.ocean = water;
    this.scene.add(water);
  }

  /**
   * Distance from every terrain sample to the nearest land, as a texture the
   * ocean shader reads for depth colour and surf. A two-pass chamfer transform
   * over the elevation grid is enough; the source is only a sample every 140 m,
   * so the shader dithers the result rather than trusting the edge exactly.
   */
  buildShoreDistance(terrain, slot) {
    const { metadata, heights, bounds } = terrain;
    const [samplesX, samplesY] = metadata.samples;
    const [worldWidth, worldDepth] = metadata.worldSize;
    const stepX = worldWidth / (samplesX - 1);
    const stepY = worldDepth / (samplesY - 1);
    const diagonal = Math.hypot(stepX, stepY);
    const distance = new Float32Array(samplesX * samplesY);
    const FAR = 1e9;

    for (let i = 0; i < distance.length; i += 1) {
      distance[i] = heights[i] > WATERLINE_METRES ? 0 : FAR;
    }
    const relax = (index, from, cost) => {
      const candidate = distance[from] + cost;
      if (candidate < distance[index]) distance[index] = candidate;
    };
    for (let y = 0; y < samplesY; y += 1) {
      for (let x = 0; x < samplesX; x += 1) {
        const index = y * samplesX + x;
        if (x > 0) relax(index, index - 1, stepX);
        if (y > 0) relax(index, index - samplesX, stepY);
        if (x > 0 && y > 0) relax(index, index - samplesX - 1, diagonal);
        if (x < samplesX - 1 && y > 0) relax(index, index - samplesX + 1, diagonal);
      }
    }
    for (let y = samplesY - 1; y >= 0; y -= 1) {
      for (let x = samplesX - 1; x >= 0; x -= 1) {
        const index = y * samplesX + x;
        if (x < samplesX - 1) relax(index, index + 1, stepX);
        if (y < samplesY - 1) relax(index, index + samplesX, stepY);
        if (x < samplesX - 1 && y < samplesY - 1) relax(index, index + samplesX + 1, diagonal);
        if (x > 0 && y < samplesY - 1) relax(index, index + samplesX - 1, diagonal);
      }
    }

    // One byte per sample across a six-kilometre range, which is finer than the
    // grid it came from.
    const range = 600;
    const data = new Uint8Array(distance.length);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.round(THREE.MathUtils.clamp(distance[i] / range, 0, 1) * 255);
    }
    const texture = new THREE.DataTexture(data, samplesX, samplesY, THREE.RedFormat);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    const uniforms = this.ocean.material.uniforms;
    const mapUniform = slot === 0 ? uniforms.shoreMapA : uniforms.shoreMapB;
    const boundsUniform = slot === 0 ? uniforms.shoreBoundsA : uniforms.shoreBoundsB;
    mapUniform.value = texture;
    boundsUniform.value.set(bounds[0], bounds[1], bounds[2], bounds[3]);
    uniforms.shoreCount.value = Math.max(uniforms.shoreCount.value, slot + 1);
  }

  updateOcean(dt) {
    if (!this.ocean.visible) return;
    const uniforms = this.ocean.material.uniforms;
    uniforms.time.value += dt;
    uniforms.eye.value.copy(this.camera.position);
    // Keep the finite water sheet under the aircraft across the 175 km
    // inter-island gap; shader coordinates remain absolute world positions.
    this.ocean.position.x = this.camera.position.x;
    this.ocean.position.z = this.camera.position.z;
  }

  /**
   * A 2x2 atlas of soft cumulus puffs. Each cell is built from overlapping
   * lobes so the silhouette is irregular, then the alpha is tightened and the
   * underside darkened, which is what stops a billboard reading as a ball.
   */
  createCloudAtlas() {
    const cell = 256;
    const canvas = document.createElement("canvas");
    canvas.width = cell * 2;
    canvas.height = cell * 2;
    const context = canvas.getContext("2d", { willReadFrequently: true });

    for (let variant = 0; variant < 4; variant += 1) {
      const originX = (variant % 2) * cell;
      const originY = Math.floor(variant / 2) * cell;
      context.save();
      context.beginPath();
      context.rect(originX, originY, cell, cell);
      context.clip();
      const lobes = 26 + Math.floor(Math.random() * 14);
      for (let i = 0; i < lobes; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.pow(Math.random(), 0.55) * cell * 0.19;
        const x = originX + cell / 2 + Math.cos(angle) * distance;
        // Bias lobes upward so the puff is domed on top and flatter beneath.
        const y = originY + cell * 0.56 + Math.sin(angle) * distance * 0.7;
        const radius = cell * (0.08 + Math.random() * 0.12);
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, "rgba(255,255,255,.28)");
        gradient.addColorStop(0.42, "rgba(255,255,255,.13)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = gradient;
        context.fillRect(originX, originY, cell, cell);
      }
      context.restore();
    }

    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    for (let variant = 0; variant < 4; variant += 1) {
      const originX = (variant % 2) * cell;
      const originY = Math.floor(variant / 2) * cell;
      for (let y = 0; y < cell; y += 1) {
        for (let x = 0; x < cell; x += 1) {
          const index = ((originY + y) * canvas.width + originX + x) * 4;
          const nx = (x / cell) * 2 - 1;
          const ny = (y / cell) * 2 - 1;
          // Only trim the outermost ring, so the lobed edge survives.
          const vignette = THREE.MathUtils.clamp(
            (1 - Math.hypot(nx, ny * 0.95)) / 0.28,
            0,
            1,
          );
          // A sub-one exponent lifts the mid densities, so overlapping puffs
          // build a solid core instead of staying hazy.
          const alpha = Math.min(1, Math.pow(data[index + 3] / 255, 0.85) * 1.7) * vignette;
          const shade = 1 - 0.46 * THREE.MathUtils.clamp((y / cell) * 1.5 - 0.36, 0, 1);
          const value = Math.round(255 * shade);
          data[index] = value;
          data[index + 1] = value;
          data[index + 2] = value;
          data[index + 3] = Math.round(alpha * 255);
        }
      }
    }
    context.putImageData(image, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    // The atlas carries a shading factor and a density, not scene colour.
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.anisotropy = 4;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    return texture;
  }

  /**
   * Trade-wind cumulus: every puff is a camera-facing billboard, and the whole
   * field is one instanced draw call that drifts downwind.
   */
  addClouds() {
    const span = 7600;
    const sun = new THREE.Vector3(-45, 95, -30).normalize();
    const lit = new THREE.Color(0xfffdf6);
    const shadow = new THREE.Color(0x6b7e9c);
    const random = (min, max) => min + Math.random() * (max - min);

    const centres = [];
    const offsets = [];
    const scales = [];
    const tints = [];
    const cells = [];
    const flips = [];
    const up = new THREE.Vector3(0, 1, 0);

    for (let c = 0; c < 64; c += 1) {
      const centre = new THREE.Vector3(
        random(-span / 2, span / 2),
        random(88, 152),
        random(-span / 2, span / 2),
      );
      const width = random(45, 130);
      const height = width * random(0.5, 0.78);
      const puffs = Math.round(random(34, 56));

      // Two to four lobes give the cloud structure instead of one round mass.
      const lobes = [];
      for (let l = 0; l < 2 + Math.floor(Math.random() * 3); l += 1) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * width * 0.35;
        lobes.push({
          x: Math.cos(angle) * distance,
          z: Math.sin(angle) * distance * 0.7,
          radius: width * random(0.3, 0.5),
          top: random(0.6, 1),
        });
      }

      for (let p = 0; p < puffs; p += 1) {
        const lobe = lobes[Math.floor(Math.random() * lobes.length)];
        const angle = Math.random() * Math.PI * 2;
        const radial = Math.sqrt(Math.random());
        // Cumulus taper: a wide flat base narrowing to a lumpy top.
        const rise = Math.pow(Math.random(), 1.8) * lobe.top;
        const taper = 1 - 0.6 * rise;
        // Heavily overlapping puffs merge into one mass; larger, sparser ones
        // read individually as bubbles.
        const size = width * random(0.4, 0.62) * (1 - 0.18 * rise);
        const flatten = size * (0.62 + 0.34 * rise) * random(0.9, 1.08);
        scales.push(size, flatten);

        // Lift each puff by its own half-height, most strongly at the bottom of
        // the cloud, so the lower edges line up into the flat base that trade
        // cumulus sit on rather than trailing off into fuzz.
        const offset = new THREE.Vector3(
          lobe.x + Math.cos(angle) * radial * lobe.radius * taper,
          rise * height + flatten * 0.42 * (1 - rise),
          lobe.z + Math.sin(angle) * radial * lobe.radius * taper * 0.72,
        );
        centres.push(centre.x, centre.y, centre.z);
        offsets.push(offset.x, offset.y, offset.z);

        // Shade by height in the cloud and by how the puff faces the sun.
        const facing = (offset.lengthSq() > 1e-6 ? offset.clone().normalize() : up).dot(sun);
        const exposure = THREE.MathUtils.clamp(rise * 0.8 + (facing * 0.5 + 0.5) * 0.4, 0, 1);
        const color = shadow.clone().lerp(lit, Math.pow(exposure, 0.75));
        color.offsetHSL(0, 0, random(-0.025, 0.025));
        tints.push(color.r, color.g, color.b);

        const variant = Math.floor(Math.random() * 4);
        cells.push((variant % 2) * 0.5, Math.floor(variant / 2) * 0.5);
        flips.push(Math.random() < 0.5 ? -1 : 1);
      }
    }

    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute("position", quad.attributes.position);
    geometry.setAttribute("uv", quad.attributes.uv);
    const instanced = (values, size) =>
      new THREE.InstancedBufferAttribute(new Float32Array(values), size);
    geometry.setAttribute("instanceCentre", instanced(centres, 3));
    geometry.setAttribute("instanceOffset", instanced(offsets, 3));
    geometry.setAttribute("instanceScale", instanced(scales, 2));
    geometry.setAttribute("instanceTint", instanced(tints, 3));
    geometry.setAttribute("instanceCell", instanced(cells, 2));
    geometry.setAttribute("instanceFlip", instanced(flips, 1));
    geometry.instanceCount = flips.length;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 120, 0), span);

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { map: { value: null }, opacity: { value: 0.96 }, drift: { value: new THREE.Vector2() }, span: { value: span } },
      ]),
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        #include <fog_pars_vertex>
        attribute vec3 instanceCentre;
        attribute vec3 instanceOffset;
        attribute vec2 instanceScale;
        attribute vec3 instanceTint;
        attribute vec2 instanceCell;
        attribute float instanceFlip;
        uniform vec2 drift;
        uniform float span;
        varying vec2 vUv;
        varying vec3 vTint;
        void main() {
          // Wrap whole clouds, never individual puffs, or they would tear apart.
          vec3 centre = instanceCentre;
          float halfSpan = span * 0.5;
          centre.x = mod(centre.x + drift.x + halfSpan, span) - halfSpan;
          centre.z = mod(centre.z + drift.y + halfSpan, span) - halfSpan;
          vec4 mvPosition = modelViewMatrix * vec4(centre + instanceOffset, 1.0);
          mvPosition.xy += position.xy * instanceScale;
          vUv = vec2(instanceFlip > 0.0 ? uv.x : 1.0 - uv.x, uv.y) * 0.5 + instanceCell;
          vTint = instanceTint;
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
        uniform float opacity;
        varying vec2 vUv;
        varying vec3 vTint;
        void main() {
          #include <logdepthbuf_fragment>
          vec4 texel = texture2D(map, vUv);
          float alpha = texel.a * opacity;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(vTint * texel.r, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    material.uniforms.map.value = this.createCloudAtlas();

    this.clouds = new THREE.Mesh(geometry, material);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = 2;
    this.cloudSpan = span;
    // Trade wind from 078° at 6 kt, so the air travels towards 258°.
    const bearing = THREE.MathUtils.degToRad(258);
    this.cloudDrift = new THREE.Vector2(Math.sin(bearing), -Math.cos(bearing)).multiplyScalar(0.31);
    this.scene.add(this.clouds);
  }

  updateClouds(dt) {
    if (!this.clouds) return;
    const drift = this.clouds.material.uniforms.drift.value;
    drift.addScaledVector(this.cloudDrift, dt);
    // Keep the offset small so the shader's wrap stays precise over long flights.
    drift.x %= this.cloudSpan;
    drift.y %= this.cloudSpan;
  }

  buildC172() {
    const aircraft = new THREE.Group();
    aircraft.name = "C172S";
    const white = new THREE.MeshPhysicalMaterial({
      color: 0xeee9dc,
      roughness: 0.3,
      metalness: 0.08,
      clearcoat: 0.55,
      clearcoatRoughness: 0.24,
    });
    const orange = new THREE.MeshStandardMaterial({ color: 0xcf6328, roughness: 0.38 });
    const navy = new THREE.MeshStandardMaterial({ color: 0x17394e, roughness: 0.35 });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x426f80,
      roughness: 0.08,
      metalness: 0.05,
      transmission: 0.28,
      transparent: true,
      opacity: 0.72,
      clearcoat: 1,
    });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x202629, roughness: 0.9 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9ba3a1, roughness: 0.26, metalness: 0.72 });
    const redLight = new THREE.MeshBasicMaterial({ color: 0xff3b26 });
    const greenLight = new THREE.MeshBasicMaterial({ color: 0x42e28b });

    const loft = (rings, material) => {
      const radial = 18;
      const vertices = [];
      const indices = [];
      const normals = [];
      for (const ring of rings) {
        for (let j = 0; j < radial; j += 1) {
          const angle = (j / radial) * Math.PI * 2;
          vertices.push(
            Math.cos(angle) * ring.rx,
            ring.y + Math.sin(angle) * ring.ry,
            ring.z,
          );
        }
      }
      for (let i = 0; i < rings.length - 1; i += 1) {
        for (let j = 0; j < radial; j += 1) {
          const next = (j + 1) % radial;
          const a = i * radial + j;
          const b = i * radial + next;
          const c = (i + 1) * radial + next;
          const d = (i + 1) * radial + j;
          indices.push(a, b, d, b, c, d);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      return mesh;
    };

    // C172S proportions: 8.3 m long, 11 m wingspan, represented at 0.6 world units/metre.
    const fuselage = loft([
      { z: -2.5, rx: 0.08, ry: 0.08, y: 0.05 },
      { z: -2.35, rx: 0.38, ry: 0.34, y: 0.02 },
      { z: -1.72, rx: 0.53, ry: 0.58, y: 0.11 },
      { z: -0.82, rx: 0.62, ry: 0.76, y: 0.28 },
      { z: 0.32, rx: 0.61, ry: 0.78, y: 0.3 },
      { z: 1.05, rx: 0.5, ry: 0.62, y: 0.25 },
      { z: 2.15, rx: 0.27, ry: 0.32, y: 0.22 },
      { z: 2.48, rx: 0.1, ry: 0.13, y: 0.22 },
    ], white);
    aircraft.add(fuselage);

    const makeSurface = (points, thickness, material) => {
      const shape = new THREE.Shape();
      shape.moveTo(points[0][0], points[0][1]);
      points.slice(1).forEach(([x, y]) => shape.lineTo(x, y));
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: thickness,
        bevelEnabled: true,
        bevelSize: 0.025,
        bevelThickness: 0.025,
        bevelSegments: 2,
      });
      geometry.center();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      return mesh;
    };

    const leftWing = makeSurface([[0, -0.74], [2.74, -0.48], [3.25, 0.42], [0, 0.74]], 0.12, white);
    leftWing.rotation.set(Math.PI / 2, 0, -THREE.MathUtils.degToRad(1.7));
    leftWing.position.set(-1.62, 1.12, -0.04);
    aircraft.add(leftWing);
    const rightWing = leftWing.clone();
    rightWing.position.x = 1.62;
    rightWing.rotation.z = THREE.MathUtils.degToRad(1.7);
    aircraft.add(rightWing);

    const wingStripeL = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.018, 0.13), orange);
    wingStripeL.position.set(-1.9, 1.2, 0.42);
    wingStripeL.rotation.z = -THREE.MathUtils.degToRad(1.7);
    aircraft.add(wingStripeL);
    const wingStripeR = wingStripeL.clone();
    wingStripeR.position.x = 1.9;
    wingStripeR.rotation.z *= -1;
    aircraft.add(wingStripeR);

    const makeControl = (name, width, depth, position, material = white) => {
      const pivot = new THREE.Group();
      pivot.name = name;
      pivot.position.copy(position);
      const surface = new THREE.Mesh(new THREE.BoxGeometry(width, 0.055, depth), material);
      surface.position.z = depth * 0.42;
      surface.castShadow = true;
      pivot.add(surface);
      aircraft.add(pivot);
      return pivot;
    };
    makeControl("aileronL", 1.23, 0.32, new THREE.Vector3(-2.45, 1.15, 0.5));
    makeControl("aileronR", 1.23, 0.32, new THREE.Vector3(2.45, 1.15, 0.5));
    makeControl("flapL", 1.15, 0.42, new THREE.Vector3(-0.95, 1.14, 0.46));
    makeControl("flapR", 1.15, 0.42, new THREE.Vector3(0.95, 1.14, 0.46));

    const tailplane = makeSurface([[0, -0.32], [1.36, -0.18], [1.52, 0.24], [0, 0.35]], 0.08, white);
    tailplane.rotation.x = Math.PI / 2;
    tailplane.position.set(-0.76, 0.51, 2.08);
    aircraft.add(tailplane);
    const tailplaneR = tailplane.clone();
    tailplaneR.position.x = 0.76;
    aircraft.add(tailplaneR);
    makeControl("elevatorL", 1.25, 0.28, new THREE.Vector3(-0.75, 0.52, 2.33));
    makeControl("elevatorR", 1.25, 0.28, new THREE.Vector3(0.75, 0.52, 2.33));

    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0.16, 1.38);
    finShape.lineTo(0.55, 1.55);
    finShape.lineTo(0.82, 0.12);
    finShape.closePath();
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.09, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02 });
    finGeo.center();
    const fin = new THREE.Mesh(finGeo, white);
    fin.rotation.y = Math.PI / 2;
    fin.position.set(0, 1.0, 1.83);
    fin.castShadow = true;
    aircraft.add(fin);
    const rudderPivot = new THREE.Group();
    rudderPivot.name = "rudder";
    rudderPivot.position.set(0, 1.04, 2.31);
    const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.25, 0.32), orange);
    rudder.position.set(0, 0.12, 0.13);
    rudderPivot.add(rudder);
    aircraft.add(rudderPivot);

    const addWindow = (x, y, z, sx, sy, rotationY = 0) => {
      const windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(sx, sy), glass);
      windowMesh.position.set(x, y, z);
      windowMesh.rotation.y = rotationY;
      aircraft.add(windowMesh);
    };
    addWindow(-0.57, 0.58, -0.72, 0.62, 0.48, -Math.PI / 2);
    addWindow(0.57, 0.58, -0.72, 0.62, 0.48, Math.PI / 2);
    addWindow(-0.58, 0.59, 0.02, 0.6, 0.5, -Math.PI / 2);
    addWindow(0.58, 0.59, 0.02, 0.6, 0.5, Math.PI / 2);
    const windshieldL = new THREE.Mesh(new THREE.PlaneGeometry(0.51, 0.53), glass);
    windshieldL.position.set(-0.28, 0.62, -1.17);
    windshieldL.rotation.set(-0.13, -0.23, 0);
    aircraft.add(windshieldL);
    const windshieldR = windshieldL.clone();
    windshieldR.position.x = 0.28;
    windshieldR.rotation.y *= -1;
    aircraft.add(windshieldR);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.12, 2.65), orange);
    stripe.position.set(0, 0.08, -0.15);
    stripe.scale.x = 1.01;
    aircraft.add(stripe);
    const lowerStripe = new THREE.Mesh(new THREE.BoxGeometry(1.19, 0.055, 2.9), navy);
    lowerStripe.position.set(0, -0.06, 0);
    aircraft.add(lowerStripe);

    const strutBetween = (a, b, radius = 0.035, material = metal) => {
      const direction = b.clone().sub(a);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 8), material);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
      mesh.castShadow = true;
      aircraft.add(mesh);
      return mesh;
    };
    strutBetween(new THREE.Vector3(-0.5, -0.2, 0.15), new THREE.Vector3(-2.1, 1.1, 0.05), 0.045);
    strutBetween(new THREE.Vector3(0.5, -0.2, 0.15), new THREE.Vector3(2.1, 1.1, 0.05), 0.045);

    const makeWheel = (x, y, z, radius, width) => {
      const wheelGroup = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.TorusGeometry(radius, width, 8, 18), rubber);
      tire.rotation.y = Math.PI / 2;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.44, radius * 0.44, width * 2.1, 12), metal);
      hub.rotation.z = Math.PI / 2;
      wheelGroup.add(tire, hub);
      wheelGroup.position.set(x, y, z);
      aircraft.add(wheelGroup);
      return wheelGroup;
    };
    strutBetween(new THREE.Vector3(-0.42, -0.28, 0.15), new THREE.Vector3(-0.88, -0.83, 0.38), 0.04);
    strutBetween(new THREE.Vector3(0.42, -0.28, 0.15), new THREE.Vector3(0.88, -0.83, 0.38), 0.04);
    makeWheel(-0.9, -0.88, 0.4, 0.2, 0.065);
    makeWheel(0.9, -0.88, 0.4, 0.2, 0.065);
    strutBetween(new THREE.Vector3(0, -0.2, -1.75), new THREE.Vector3(0, -0.74, -2.05), 0.035);
    makeWheel(0, -0.79, -2.08, 0.15, 0.052);

    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 18), white);
    spinner.rotation.x = -Math.PI / 2;
    spinner.position.z = -2.65;
    aircraft.add(spinner);
    const propPivot = new THREE.Group();
    propPivot.name = "propeller";
    propPivot.position.z = -2.86;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.85, 0.045), navy);
    blade.geometry.translate(0, 0, 0);
    propPivot.add(blade);
    aircraft.add(propPivot);

    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.35, 8), rubber);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(0.28, -0.38, -1.98);
    aircraft.add(exhaust);

    const leftNav = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), redLight);
    leftNav.position.set(-3.2, 1.19, -0.02);
    aircraft.add(leftNav);
    const rightNav = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), greenLight);
    rightNav.position.set(3.2, 1.19, -0.02);
    aircraft.add(rightNav);

    aircraft.userData.controls = {
      aileronL: aircraft.getObjectByName("aileronL"),
      aileronR: aircraft.getObjectByName("aileronR"),
      flapL: aircraft.getObjectByName("flapL"),
      flapR: aircraft.getObjectByName("flapR"),
      elevatorL: aircraft.getObjectByName("elevatorL"),
      elevatorR: aircraft.getObjectByName("elevatorR"),
      rudder: aircraft.getObjectByName("rudder"),
      propeller: aircraft.getObjectByName("propeller"),
    };
    aircraft.traverse((node) => {
      if (node.isMesh) node.castShadow = true;
    });
    aircraft.scale.setScalar(AIRCRAFT.c172.modelScale);
    return aircraft;
  }

  buildAircraft(spec) {
    const aircraft = this.buildAirframe(spec);
    // An aircraft's attitude is yaw, then pitch, then roll, each about the body
    // axes left by the one before — Euler order YXZ. Three's default is XYZ,
    // which applies pitch about the *world* X axis instead: fine pointing north,
    // but on any other heading pulling back rolls the aircraft as much as it
    // pitches it. The flight model already works in YXZ; this keeps what is
    // drawn in step with it.
    aircraft.rotation.order = "YXZ";
    return aircraft;
  }

  buildAirframe(spec) {
    if (spec.code === "C172") {
      const source = c172Source();
      return source
        ? buildC172FromModel(source, AIRCRAFT.c172.modelScale)
        : buildC172Model(AIRCRAFT.c172.modelScale);
    }
    if (spec.code === "TBM") {
      const source = tbm930Source();
      return source
        ? buildTbm930FromModel(source, AIRCRAFT.tbm.modelScale)
        : buildTbm930Model(AIRCRAFT.tbm.builtModelScale);
    }
    if (spec.code === "F-35") {
      const source = f35Source();
      return source
        ? buildF35FromModel(source, AIRCRAFT.f35.modelScale)
        : buildF35Model(AIRCRAFT.f35.modelScale);
    }
    if (spec.code === "A380") {
      const source = a380Source();
      return source
        ? buildA380FromModel(source, AIRCRAFT.a380.modelScale)
        : buildA380Model(AIRCRAFT.a380.modelScale);
    }
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: spec.color, roughness: 0.32, metalness: 0.08 });
    const accentMat = new THREE.MeshStandardMaterial({ color: spec.accent, roughness: 0.42 });
    const darkMat = new THREE.MeshPhysicalMaterial({ color: 0x17313d, roughness: 0.16, metalness: 0.25 });
    const s = spec.scale;
    const jet = spec.code === "A380";

    const fuselage = new THREE.Mesh(
      new THREE.CapsuleGeometry((jet ? 0.42 : 0.24) * s, (jet ? 3.8 : 2.2) * s, 8, 16),
      bodyMat,
    );
    fuselage.rotation.x = Math.PI / 2;
    fuselage.castShadow = true;
    group.add(fuselage);

    const wing = new THREE.Mesh(
      new THREE.BoxGeometry((jet ? 5.4 : 3.5) * s, 0.08 * s, (jet ? 1.35 : 0.65) * s),
      bodyMat,
    );
    wing.position.z = 0.15 * s;
    wing.castShadow = true;
    group.add(wing);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.5 * s, 0.06 * s, 0.5 * s), bodyMat);
    tail.position.z = 1.55 * s;
    group.add(tail);

    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08 * s, 0.7 * s, 0.65 * s), accentMat);
    fin.position.set(0, 0.35 * s, 1.65 * s);
    group.add(fin);

    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.28 * s, 12, 8), darkMat);
    cockpit.scale.set(1, 0.65, 1.4);
    cockpit.position.set(0, 0.17 * s, -1.1 * s);
    group.add(cockpit);

    const engineCount = jet ? 4 : spec.code === "TBM" ? 1 : 1;
    for (let i = 0; i < engineCount; i += 1) {
      const engine = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14 * s, 0.2 * s, 0.6 * s, 12),
        darkMat,
      );
      engine.rotation.x = Math.PI / 2;
      if (jet) {
        const side = i < 2 ? -1 : 1;
        const outer = i % 2 ? 1.6 : 0.85;
        engine.position.set(side * outer * s, -0.2 * s, 0.05 * s);
      } else {
        engine.position.set(0, 0, -1.55 * s);
      }
      group.add(engine);
    }

    group.rotation.order = "YXZ";
    group.traverse((node) => {
      if (node.isMesh) node.castShadow = true;
    });
    group.scale.setScalar(spec.modelScale);
    return group;
  }

  bind() {
    window.addEventListener("resize", () => this.resize());
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (event) => {
      if (
        !this.running
        || this.paused
        || !(this.cameraMode === "chase" || this.cameraMode === "cockpit")
        || event.button !== 0
      ) return;

      const orbit = this.chaseOrbit;
      orbit.dragging = true;
      orbit.pointerId = event.pointerId;
      orbit.lastX = event.clientX;
      orbit.lastY = event.clientY;
      orbit.lastInputAt = performance.now();
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("is-camera-dragging");
      event.preventDefault();
    });
    canvas.addEventListener("pointermove", (event) => {
      const orbit = this.chaseOrbit;
      if (!orbit.dragging || orbit.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - orbit.lastX;
      const deltaY = event.clientY - orbit.lastY;
      orbit.lastX = event.clientX;
      orbit.lastY = event.clientY;
      if (this.cameraMode === "cockpit") {
        // Turning your head, so the sign is inverted against the chase camera:
        // there you swing the camera around the aircraft, here you look left by
        // dragging left. Limits are roughly what a neck allows — far enough to
        // see behind the wing, not so far that lookAt gimbals near vertical.
        const view = this.cockpitView;
        view.targetYaw = THREE.MathUtils.clamp(view.targetYaw + deltaX * 0.005, -2.7, 2.7);
        view.targetPitch = THREE.MathUtils.clamp(view.targetPitch - deltaY * 0.004, -1.1, 1.1);
      } else {
        orbit.targetYaw = THREE.MathUtils.clamp(
          orbit.targetYaw - deltaX * 0.006,
          -Math.PI,
          Math.PI,
        );
        orbit.targetPitch = THREE.MathUtils.clamp(
          orbit.targetPitch + deltaY * 0.0045,
          -0.18,
          1.05,
        );
      }
      orbit.lastInputAt = performance.now();
      event.preventDefault();
    });
    const endCameraDrag = (event) => {
      const orbit = this.chaseOrbit;
      if (!orbit.dragging || orbit.pointerId !== event.pointerId) return;
      orbit.dragging = false;
      orbit.pointerId = null;
      orbit.lastInputAt = performance.now();
      canvas.classList.remove("is-camera-dragging");
    };
    canvas.addEventListener("pointerup", endCameraDrag);
    canvas.addEventListener("pointercancel", endCameraDrag);
    window.addEventListener("keydown", (event) => {
      if (["ArrowUp", "ArrowDown", " "].includes(event.key)) event.preventDefault();
      this.keys.add(event.key.toLowerCase());
      if (event.repeat) return;
      if (event.key.toLowerCase() === "c" && this.running) toggleCamera();
      if (event.key === "Escape" && mapOpen) closeExpandedMap();
      else if (event.key.toLowerCase() === "p" || event.key === "Escape") togglePause();
      if (event.key.toLowerCase() === "g") this.toggleGear();
      if (event.key.toLowerCase() === "f") this.adjustFlaps(10);
      if (event.key.toLowerCase() === "v") this.adjustFlaps(-10);
      if (event.key.toLowerCase() === "b") this.toggleBrakes();
      if (event.key.toLowerCase() === "r" && this.running) rewind();
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.key.toLowerCase()));
  }

  // ---------------------------------------------------------------------
  // Discrete controls
  //
  // Shared by the keyboard and the on-screen buttons so the two cannot drift
  // apart — the fixed-gear warning and the brake wording are part of the
  // action, not of one input path.
  // ---------------------------------------------------------------------

  toggleGear() {
    if (!this.running) return;
    if (AIRCRAFT[this.aircraftId].code === "C172") {
      showToast("The C172 has fixed landing gear");
      return;
    }
    this.state.gear = !this.state.gear;
  }

  adjustFlaps(step) {
    if (!this.running) return;
    this.state.flaps = THREE.MathUtils.clamp(this.state.flaps + step, 0, 30);
  }

  toggleBrakes() {
    if (!this.running) return;
    this.state.airbrake = !this.state.airbrake;
    // The same control is wheel brakes on the ground and a speedbrake in the
    // air, so it has to say which one it just did.
    const ground = !this.airborne;
    showToast(this.state.airbrake
      ? (ground ? "Wheel brakes on" : "Speedbrake extended")
      : (ground ? "Wheel brakes released" : "Speedbrake retracted"));
  }

  resize() {
    const { clientWidth, clientHeight } = this.container;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight, false);
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
    this.resetChaseOrbit(true);
    this.renderer.domElement.classList.toggle(
      "is-camera-orbitable",
      this.running && (mode === "chase" || mode === "cockpit"),
    );
    this.camera.near = mode === "cockpit" ? 0.012 : 0.1;
    this.camera.fov = mode === "cockpit" ? 82 : 58;
    this.camera.updateProjectionMatrix();
  }

  resetChaseOrbit(immediate = false) {
    this.cockpitView.targetYaw = 0;
    this.cockpitView.targetPitch = 0;
    if (immediate) {
      this.cockpitView.yaw = 0;
      this.cockpitView.pitch = 0;
    }
    const orbit = this.chaseOrbit;
    orbit.targetYaw = 0;
    orbit.targetPitch = 0;
    orbit.lastInputAt = -Infinity;
    if (immediate) {
      orbit.yaw = 0;
      orbit.pitch = 0;
    }
    if (orbit.pointerId !== null && this.renderer.domElement.hasPointerCapture(orbit.pointerId)) {
      this.renderer.domElement.releasePointerCapture(orbit.pointerId);
    }
    orbit.dragging = false;
    orbit.pointerId = null;
    this.renderer.domElement.classList.remove("is-camera-dragging");
  }

  selectAircraft(id) {
    this.resetChaseOrbit(true);
    this.aircraftId = id;
    this.scene.remove(this.plane);
    this.plane = this.buildAircraft(AIRCRAFT[id]);
    this.measureAirframe(this.plane);
    this.prepareGear(this.plane);
    this.scene.add(this.plane);
    // The A380's exterior is a downloaded model as well, but at twenty
    // megabytes it is fetched when the aircraft is picked rather than at boot
    // alongside the C172's. Until it lands the built airframe stands in.
    if (id === "a380" && !a380Source()) {
      preloadA380().then(() => this.upgradeAirframe());
    } else if (id === "f35" && !f35Source()) {
      preloadF35().then(() => this.upgradeAirframe());
    } else if (id === "tbm" && !tbm930Source()) {
      preloadTbm930().then(() => this.upgradeAirframe());
    }
  }

  /**
   * Swaps a built airframe for the downloaded one once it has arrived. Run when
   * the download lands and again at the start of a flight: one that lands with
   * the aircraft already flying is left until the next departure rather than
   * rebuilt under the pilot.
   */
  upgradeAirframe() {
    if (this.running) return;
    if (this.aircraftId === "a380" && a380Source() && !this.plane.userData.modelRoot) {
      this.selectAircraft("a380");
    } else if (this.aircraftId === "f35" && f35Source() && !this.plane.userData.modelRoot) {
      this.selectAircraft("f35");
    } else if (this.aircraftId === "tbm" && tbm930Source() && !this.plane.userData.modelRoot) {
      this.selectAircraft("tbm");
    }
  }

  /**
   * Records the extremities of the airframe once, so ground contact can be
   * tested at the wingtips, nose and tail instead of only at the centre. A
   * banked aircraft touches down on a wingtip well before its centre arrives.
   */
  /**
   * Works out how each undercarriage unit should swing up, from the geometry
   * that is already there rather than from per-aircraft data. Each unit pivots
   * about the top of its own leg: the forward-most unit is the nose gear and
   * folds forward, the rest fold inboard, which is how nearly every retractable
   * aircraft does it.
   */
  prepareGear(plane) {
    const controls = plane.userData.controls;
    const assemblies = controls?.gearAssemblies ?? [];
    // A downloaded aircraft can bring an authored retraction sequence. Its
    // trunnions, door timing and nested armatures are already part of the clip,
    // so there is nothing useful to derive from a bounding box here.
    if (!assemblies.length || controls.setGearPosition) return;
    // Measure in the model's own units, before the display scale.
    const scale = plane.scale.x;
    plane.scale.setScalar(1);
    plane.updateWorldMatrix(true, true);

    const boxes = assemblies.map((assembly) => new THREE.Box3().setFromObject(assembly));
    let noseIndex = 0;
    boxes.forEach((box, i) => {
      if (box.getCenter(new THREE.Vector3()).z < boxes[noseIndex].getCenter(new THREE.Vector3()).z) {
        noseIndex = i;
      }
    });

    assemblies.forEach((assembly, i) => {
      const centre = boxes[i].getCenter(new THREE.Vector3());
      // Trunnion: top of the leg, on the unit's own centreline. An airframe
      // that brought its own — a downloaded model knows where its legs hinge,
      // and in what frame — keeps it.
      const pivot = new THREE.Vector3(centre.x, boxes[i].max.y, centre.z);
      assembly.userData.retract = assembly.userData.retract ?? (i === noseIndex
        ? { pivot, axis: new THREE.Vector3(1, 0, 0), angle: Math.PI * 0.5 }
        : { pivot, axis: new THREE.Vector3(0, 0, 1), angle: -Math.sign(centre.x || 1) * Math.PI * 0.5 });
      assembly.userData.restPosition = assembly.position.clone();
      assembly.userData.restQuaternion = assembly.quaternion.clone();
    });

    plane.scale.setScalar(scale);
    plane.updateWorldMatrix(true, true);
  }

  /** Drives the undercarriage between stowed and down. */
  updateGear(dt) {
    const controls = this.plane.userData.controls;
    const assemblies = controls?.gearAssemblies ?? [];
    if (!assemblies.length && !controls?.setGearPosition) return;
    const spec = AIRCRAFT[this.aircraftId];
    const target = this.state.gear ? 1 : 0;
    const rate = dt / (spec.gearTravel ?? 5);
    this.state.gearPosition = THREE.MathUtils.clamp(
      this.state.gearPosition + THREE.MathUtils.clamp(target - this.state.gearPosition, -rate, rate),
      0,
      1,
    );

    const stowed = 1 - this.state.gearPosition;
    if (controls.setGearPosition) {
      controls.setGearPosition(this.state.gearPosition);
      return;
    }
    for (const assembly of assemblies) {
      const retract = assembly.userData.retract;
      // Anything without derived geometry falls back to appearing when down.
      if (!retract) {
        assembly.visible = this.state.gearPosition > 0.5;
        continue;
      }
      assembly.visible = this.state.gearPosition > 0.001;
      if (!assembly.visible) continue;
      const turn = new THREE.Quaternion().setFromAxisAngle(retract.axis, retract.angle * stowed);
      // Rotate about the trunnion without re-parenting the assembly.
      assembly.quaternion.copy(turn).multiply(assembly.userData.restQuaternion);
      assembly.position.copy(retract.pivot).sub(retract.pivot.clone().applyQuaternion(turn));
    }
  }

  measureAirframe(plane) {
    // Built by hand rather than with setFromObject, which ignores visibility
    // and would let an exhaust plume stretch the airframe metres past its tail.
    const box = new THREE.Box3();
    const local = new THREE.Box3();
    plane.updateWorldMatrix(true, true);
    plane.traverse((node) => {
      if (!node.isMesh || node.userData.noBounds) return;
      if (node.parent?.userData.noBounds) return;
      node.geometry.computeBoundingBox();
      local.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
      box.union(local);
    });
    const size = box.getSize(new THREE.Vector3());
    const halfSpan = size.x / 2;
    const halfLength = size.z / 2;
    const belly = -box.min.y;
    // Belly with the gear stowed, so a gear-up arrival touches the fuselage
    // rather than a wheel that is no longer hanging there.
    const gearAssemblies = plane.userData.controls?.gearAssemblies ?? [];
    const wasVisible = gearAssemblies.map((assembly) => assembly.visible);
    gearAssemblies.forEach((assembly) => { assembly.visible = false; });
    const clean = new THREE.Box3();
    plane.traverse((node) => {
      if (!node.isMesh || node.userData.noBounds || !node.visible) return;
      let parent = node.parent;
      while (parent && parent !== plane) {
        if (!parent.visible) return;
        parent = parent.parent;
      }
      node.geometry.computeBoundingBox();
      local.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
      clean.union(local);
    });
    gearAssemblies.forEach((assembly, i) => { assembly.visible = wasVisible[i]; });
    plane.userData.bellyGearDown = belly;
    plane.userData.bellyGearUp = clean.isEmpty() ? belly : -clean.min.y;

    plane.userData.contactPoints = [
      new THREE.Vector3(0, -belly, 0),
      new THREE.Vector3(-halfSpan, 0, 0),
      new THREE.Vector3(halfSpan, 0, 0),
      new THREE.Vector3(0, 0, -halfLength),
      new THREE.Vector3(0, 0, halfLength),
    ];
  }

  start(airportIndex, airStart, fuelFraction = this.startFuelFraction ?? 1) {
    this.clearCrash();
    this.upgradeAirframe();
    this.running = true;
    this.paused = false;
    this.airborne = airStart;
    this.resetChaseOrbit(true);
    this.renderer.domElement.classList.toggle("is-camera-orbitable", this.cameraMode === "chase");
    this.airportIndex = airportIndex;
    this.airStart = airStart;
    this.startFuelFraction = THREE.MathUtils.clamp(fuelFraction, 0, 1);
    const spec = AIRCRAFT[this.aircraftId];
    const airport = AIRPORTS[airportIndex];
    this.state = this.freshState();
    const groundHeight = this.getTerrainHeight(airport.x, airport.z);
    // Sit on the wheels rather than at a fixed clearance: an A380's undercarriage
    // holds it four times higher off the tarmac than a light aircraft's.
    const stance = -Math.min(...(this.plane.userData.contactPoints ?? []).map((point) => point.y), 0);
    this.state.position.set(
      airport.x,
      airStart ? groundHeight + 80 : groundHeight + stance + 0.004,
      airport.z,
    );
    this.state.heading = THREE.MathUtils.degToRad(airport.heading);
    this.state.velocity = airStart ? AIRCRAFT[this.aircraftId].takeoff * 0.55 : 0;
    this.state.fuel = spec.fuelCapacity * this.startFuelFraction;
    this.state.engineRunning = this.state.fuel > 0;
    this.state.throttle = airStart && this.state.engineRunning ? 0.68 : 0;
    this.state.gear = spec.code === "C172" || !airStart;
    // Start with the undercarriage already where the switch says, rather than
    // watching it cycle for five seconds after every air start.
    this.state.gearPosition = this.state.gear ? 1 : 0;
    this.state.flaps = airStart ? 0 : 10;
    this.state.flapPosition = this.state.flaps;
    this.history = [];
    const forward = new THREE.Vector3(Math.sin(this.state.heading), 0, -Math.cos(this.state.heading));
    this.camera.position.copy(this.state.position)
      .addScaledVector(forward, -spec.chaseDistance)
      .add(new THREE.Vector3(0, spec.chaseHeight, 0));
  }

  reset() {
    this.start(this.airportIndex, false, this.startFuelFraction);
  }

  snapshot() {
    return {
      position: this.state.position.clone(),
      velocity: this.state.velocity,
      heading: this.state.heading,
      pitch: this.state.pitch,
      roll: this.state.roll,
      gamma: this.state.gamma,
      throttle: this.state.throttle,
      flaps: this.state.flaps,
      flapPosition: this.state.flapPosition,
      gear: this.state.gear,
      gearPosition: this.state.gearPosition,
      aileron: this.state.aileron,
      airbrake: this.state.airbrake,
      verticalSpeed: this.state.verticalSpeed,
      fuel: this.state.fuel,
      engineRunning: this.state.engineRunning,
    };
  }

  rewind() {
    if (!this.history.length) return false;
    this.clearCrash();
    // Step back far enough to undo the approach that ended the flight, not just
    // the instant of contact.
    const steps = this.crashImpact ? 320 : 250;
    const state = this.history[Math.max(0, this.history.length - steps)];
    this.state = { ...state, position: state.position.clone() };
    this.history.length = Math.max(0, this.history.length - steps);
    this.airborne = true;
    return true;
  }

  updateFlight(dt) {
    if (!this.running || this.paused || this.crashed) return;
    const spec = AIRCRAFT[this.aircraftId];
    const controlRate = spec.controlRate ?? 0.62;
    const aero = aeroModel(spec);
    const clampAxis = (value) => THREE.MathUtils.clamp(value, -1, 1);
    const targetPitch = clampAxis(
      (this.keys.has("w") ? 1 : 0) - (this.keys.has("s") ? 1 : 0) + this.stick.pitch);
    const targetRoll = clampAxis(
      (this.keys.has("a") ? 1 : 0) - (this.keys.has("d") ? 1 : 0) + this.stick.roll);
    const rudder = (this.keys.has("q") ? 1 : 0) - (this.keys.has("e") ? 1 : 0);
    if (this.state.engineRunning) {
      const throttleInput = clampAxis(
        (this.keys.has("arrowup") ? 1 : 0) - (this.keys.has("arrowdown") ? 1 : 0) + this.stick.throttle);
      if (throttleInput !== 0) {
        this.state.throttle = THREE.MathUtils.clamp(
          this.state.throttle + dt * 0.35 * throttleInput, 0, 1);
      }

      const burnRate = THREE.MathUtils.lerp(
        spec.idleFuelBurn,
        spec.maxFuelBurn,
        this.state.throttle ** spec.fuelBurnCurve,
      );
      this.state.fuel = Math.max(0, this.state.fuel - (burnRate * dt) / 3600);
      if (this.state.fuel <= 0) {
        this.state.engineRunning = false;
        this.state.throttle = 0;
        this.onFuelExhausted?.();
      }
    } else {
      this.state.throttle = 0;
    }

    // Tail-strike protection: with a long tail arm, full nose-up authority on
    // the runway would drag the tail before the wing ever flew. Real fly-by-wire
    // limits rotation on the ground for exactly this reason, and the limit is
    // released the moment the aircraft is airborne.
    const maxPitch = spec.maxPitch ?? 0.32;
    const maxBank = spec.maxBank ?? 0.72;
    // Full authority is also earned with airspeed rather than handed over the
    // instant the wheels leave: commanding thirty degrees at rotation speed is a
    // departure, not a climb.
    const groundLimit = Math.min(maxPitch, spec.groundPitch ?? maxPitch);
    const pitchAuthority = this.airborne
      ? THREE.MathUtils.lerp(
        groundLimit,
        maxPitch,
        THREE.MathUtils.smoothstep(this.state.velocity, spec.takeoff, spec.takeoff * 1.8),
      )
      : groundLimit;
    // Pitch is commanded as an attitude, but the flight path can only follow the
    // nose as fast as the wing can bend it round. Left unbounded the nose snaps
    // tens of degrees below gamma in a fifth of a second and stays there, and
    // the angle of attack sits pinned at its negative clamp for seconds on end:
    // the wing unloads completely, so a banked descent stops turning at all.
    // Bounding the command relative to the flight path makes full forward stick
    // an unload rather than a bunt. A steep dive still develops — the floor
    // travels down with gamma, so the nose follows the path down instead of
    // outrunning it — but the wing keeps enough of its lift to curve a turn.
    const unload = THREE.MathUtils.lerp(
      PUSHOVER_UNLOAD_LEVEL,
      PUSHOVER_UNLOAD_BANKED,
      THREE.MathUtils.smoothstep(Math.abs(this.state.roll), ...PUSHOVER_BANK_RANGE),
    );
    const pitchFloor = this.state.gamma - (unload * aero.clTrim) / CL_PER_RADIAN;
    const pitchCommand = targetPitch * pitchAuthority;
    this.state.pitch = THREE.MathUtils.lerp(
      this.state.pitch,
      this.airborne ? Math.max(pitchCommand, pitchFloor) : pitchCommand,
      dt * controlRate * 2.8,
    );

    // On the ground the undercarriage holds the aircraft level: the ailerons
    // still deflect, but the wheels stop it banking, so lateral input steers
    // instead of rolling. Commanding bank on the runway used to dig a wingtip
    // into the tarmac.
    const onGround = !this.airborne;
    const bankCommand = targetRoll * maxBank;
    this.state.roll = THREE.MathUtils.lerp(
      this.state.roll,
      onGround ? 0 : bankCommand,
      dt * controlRate * (onGround ? 4 : 2.5),
    );
    // The control surfaces follow the stick even when the aircraft cannot bank.
    this.state.aileron = onGround ? bankCommand : this.state.roll;

    // Flaps run out at a fixed rate rather than snapping between detents.
    const flapRate = (30 / (spec.flapTravel ?? 8)) * dt;
    this.state.flapPosition += THREE.MathUtils.clamp(
      this.state.flaps - this.state.flapPosition,
      -flapRate,
      flapRate,
    );

    // --- Longitudinal model -------------------------------------------------
    // Speed comes from the balance of thrust, drag and the component of gravity
    // along the flight path, not from the throttle setting directly. That is
    // what makes a closed throttle a glide rather than a car coasting to a
    // halt, and what makes a nose-down attitude build speed as it descends.
    const airspeed = Math.max(this.state.velocity * KNOTS_TO_WORLD, 0.001);
    const gamma = this.state.gamma;

    // Angle of attack is the difference between where the nose points and where
    // the aircraft is actually going.
    const alpha = THREE.MathUtils.clamp(this.state.pitch - gamma, -0.3, 0.3);
    // Assisted flight: part of the extra lift a real pilot would pull in to hold
    // altitude through a bank is added for you. Steep banks still descend.
    const bankHelp = 1 + 0.7 * (1 / Math.max(Math.cos(this.state.roll), 0.2) - 1);
    // The assist only ever adds to lift the wing is already making. Applied to a
    // negative coefficient it would deepen it instead, so a pushover in a bank
    // would pull *harder* the further it was banked.
    const clAlpha = aero.clTrim + CL_PER_RADIAN * alpha;
    const lifting = THREE.MathUtils.clamp(
      (clAlpha > 0 ? clAlpha * bankHelp : clAlpha) + this.state.flapPosition * 0.008,
      -0.5,
      CL_MAX,
    );
    const liftAccel = Math.min(
      aero.liftK * airspeed * airspeed * lifting,
      GRAVITY_WORLD * aero.loadLimit,
    );
    // Configuration drag. Gear and flaps are how an aircraft is actually slowed
    // down on approach, and a speedbrake is how a jet loses speed without
    // trading away altitude; a clean airframe with the throttle closed simply
    // keeps what it has.
    const configDrag = (this.state.gear ? spec.gearDrag ?? 0.5 : 0)
      + (this.state.flapPosition / 30) * (spec.flapDrag ?? 0.55)
      + (this.state.airbrake ? spec.airbrakeDrag ?? 0.8 : 0);
    const dragAccel = aero.dragK * airspeed * airspeed
      * (1 + INDUCED_DRAG * lifting * lifting + configDrag);
    const thrustAccel = this.state.engineRunning ? this.state.throttle * aero.thrustMax : 0;

    const along = thrustAccel - dragAccel - GRAVITY_WORLD * Math.sin(gamma);
    this.state.velocity = Math.max(0, this.state.velocity + (along * dt) / KNOTS_TO_WORLD);

    // On the ground the wheels do the work: rolling resistance always, and the
    // brakes when they are applied.
    if (!this.airborne) {
      const braking = this.state.airbrake ? spec.brakingG ?? 0.34 : 0;
      const decel = (ROLLING_RESISTANCE_G + braking) * GRAVITY_WORLD;
      this.state.velocity = Math.max(0, this.state.velocity - (decel * dt) / KNOTS_TO_WORLD);
    }

    if (onGround) {
      // Steered nosewheel. A wheel held at an angle carves a fixed radius, so
      // the yaw rate follows ground speed — slow but tight while taxiing. The
      // deflection washes out as speed builds, because a tiller that stayed
      // fully authoritative at rotation speed would simply swerve the aircraft
      // off the runway; past that the rudder is doing the work.
      const steer = rudder - targetRoll;
      const authority = 1 - 0.85 * THREE.MathUtils.smoothstep(this.state.velocity, 15, 70);
      const radius = spec.steerRadius ?? 3;
      const yawRate = THREE.MathUtils.clamp(
        (airspeed / radius) * steer * authority,
        -GROUND_STEER_LIMIT,
        GROUND_STEER_LIMIT,
      );
      this.state.heading += yawRate * dt;
      // Lift still curves the flight path, but only upward: the wheels stop it
      // going the other way. This is what lets the aircraft fly off the runway
      // once the wing is doing enough work.
      if (airspeed > 0.15) {
        const turning = liftAccel * Math.cos(this.state.roll) - GRAVITY_WORLD * Math.cos(gamma);
        this.state.gamma = THREE.MathUtils.clamp(gamma + (turning / airspeed) * dt, 0, 1.3);
      } else {
        this.state.gamma = 0;
      }
    } else {
      // Lift in excess of weight curves the flight path upward; a shortfall
      // lets it fall away, which is what a stall feels like from the cockpit.
      if (airspeed > 0.15) {
        const turning = liftAccel * Math.cos(this.state.roll) - GRAVITY_WORLD * Math.cos(gamma);
        this.state.gamma = THREE.MathUtils.clamp(gamma + (turning / airspeed) * dt, -1.3, 1.3);
        // Only lift the wing is actually carrying curves the turn. Pushing over
        // snaps the nose below the flight path faster than gamma can follow, and
        // the resulting angle of attack is briefly negative; taken signed, that
        // inverts the lift vector and banking left would turn right until gamma
        // caught up. An unloaded wing should simply stop turning.
        this.state.heading += (-Math.max(liftAccel, 0) * Math.sin(this.state.roll) / airspeed) * dt;
      }
      this.state.heading += rudder * 0.18 * dt * controlRate;
    }

    const speedWorld = this.state.velocity * KNOTS_TO_WORLD;
    this.state.verticalSpeed = speedWorld * Math.sin(this.state.gamma);
    const overGround = speedWorld * Math.cos(this.state.gamma);
    this.state.position.x += Math.sin(this.state.heading) * overGround * dt;
    this.state.position.z -= Math.cos(this.state.heading) * overGround * dt;
    this.state.position.y += this.state.verticalSpeed * dt;

    this.updateGear(dt);

    if (this.resolveImpact(overGround)) return;

    this.plane.position.copy(this.state.position);
    // Aircraft meshes face local -Z; negate world heading so the nose follows the flight vector.
    this.plane.rotation.set(this.state.pitch, -this.state.heading, this.state.roll);
    // Every surface is optional: a jet has no propeller, and its flaperons do
    // the work of both ailerons and flaps on a single panel.
    const controls = this.plane.userData.controls;
    if (controls) {
      const flapAngle = THREE.MathUtils.degToRad(this.state.flapPosition);
      const roll = (this.state.aileron ?? this.state.roll) * 0.45;
      const pitch = -this.state.pitch * 0.65;
      if (controls.aileronL) controls.aileronL.rotation.x = -roll;
      if (controls.aileronR) controls.aileronR.rotation.x = roll;
      if (controls.flaperonL) controls.flaperonL.rotation.x = flapAngle - roll;
      if (controls.flaperonR) controls.flaperonR.rotation.x = flapAngle + roll;
      if (controls.elevatorL) controls.elevatorL.rotation.x = pitch;
      if (controls.elevatorR) controls.elevatorR.rotation.x = pitch;
      if (controls.rudder) controls.rudder.rotation.y = -rudder * 0.35;
      if (controls.flapL) controls.flapL.rotation.x = flapAngle;
      if (controls.flapR) controls.flapR.rotation.x = flapAngle;
      if (controls.slatL) controls.slatL.rotation.x = -flapAngle * 0.75;
      if (controls.slatR) controls.slatR.rotation.x = -flapAngle * 0.75;
      if (controls.propeller && this.state.engineRunning) {
        controls.propeller.rotation.z += dt * (12 + this.state.throttle * 95);
      }
      if (controls.yokeL) controls.yokeL.rotation.z = this.state.roll * 0.72;
      if (controls.yokeR) controls.yokeR.rotation.z = this.state.roll * 0.72;
      if (controls.sideStick) {
        controls.sideStick.rotation.z = this.state.roll * 0.34;
        controls.sideStick.rotation.x = -this.state.pitch * 0.5;
      }
      if (controls.throttle) {
        const lever = controls.throttle.userData;
        controls.throttle.position.z = (lever.restZ ?? -1.255) + this.state.throttle * (lever.travelZ ?? 0.055);
      }
      if (controls.afterburner) {
        controls.afterburner.setThrust(this.state.engineRunning ? this.state.throttle : 0, dt);
      }
    }
    if (this.history.length > 900) this.history.shift();
    this.history.push(this.snapshot());
  }

  /** Upward normal of the terrain, from four height samples around a point. */
  terrainNormal(x, z) {
    const step = 1.5;
    return new THREE.Vector3(
      this.getTerrainHeight(x - step, z) - this.getTerrainHeight(x + step, z),
      step * 2,
      this.getTerrainHeight(x, z - step) - this.getTerrainHeight(x, z + step),
    ).normalize();
  }

  /** What the aircraft is about to arrive on. */
  surfaceAt(x, z) {
    if (this.sampleElevation(x, z) <= WATERLINE_METRES) return "water";
    if (this.airfieldGround && this.airfieldGround.coverageAt(x, z) > 0.6) return "pavement";
    return "rough";
  }

  /**
   * Handles contact with the ground or a structure. Returns true when the
   * flight is over, in which case the caller stops updating it.
   *
   * The judgement uses closing speed along the surface normal rather than rate
   * of descent, so a level run into rising ground is scored as the impact it is
   * instead of as a gentle arrival.
   */
  resolveImpact(speedWorld) {
    const { position } = this.state;
    // Small, because contact is measured at the airframe's extremities: the
    // belly point already sits at the bottom of the tyres.
    const clearance = 0.004;

    // Test every extremity, not just the centre, and take whichever is deepest
    // into the surface: that is the part that actually struck.
    const points = this.plane.userData.contactPoints;
    // The belly contact rides up as the gear stows.
    if (points && this.plane.userData.bellyGearUp !== undefined) {
      points[0].y = -THREE.MathUtils.lerp(
        this.plane.userData.bellyGearUp,
        this.plane.userData.bellyGearDown,
        this.state.gearPosition,
      );
    }
    const attitude = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.state.pitch, -this.state.heading, this.state.roll, "YXZ"),
    );
    let contact = null;
    // Starts below zero so that an aircraft resting exactly on its wheels still
    // registers as touching. A strict "penetrating" test declared a parked
    // aircraft airborne, which handed lateral input back to the ailerons and
    // let it bank into the runway.
    let deepest = -Infinity;
    let hitObstacle = false;
    const sample = new THREE.Vector3();
    for (const offset of points ?? []) {
      sample.copy(offset).applyQuaternion(attitude).add(position);
      const groundHere = this.getTerrainHeight(sample.x, sample.z);
      const structure = this.airfieldGround?.obstacleHeightAt(sample.x, sample.z) ?? 0;
      const surfaceTop = groundHere + (structure > 0 ? structure : 0);
      const penetration = surfaceTop + clearance - sample.y;
      if (penetration > deepest) {
        deepest = penetration;
        contact = sample.clone();
        hitObstacle = structure > 0 && sample.y < groundHere + structure + clearance;
      }
    }

    if (!contact || deepest < -CONTACT_BAND) {
      this.airborne = true;
      return false;
    }
    // An aircraft already rolling follows the surface down as well as up —
    // pavement is drawn proud of the earth around it, so a wheel that only ever
    // rose would climb off the runway edge and be reported as flying. One
    // arriving from the air is only ever lifted, so a touchdown cannot snap it
    // downward. The contact band bounds how far either can move in a frame.
    // Wheels hold the aircraft up, not down: it follows the surface while
    // settling or rolling level, but a climbing aircraft is never pulled back.
    const settling = !this.airborne && this.state.verticalSpeed <= 0;
    const lift = settling ? deepest : Math.max(0, deepest);

    const velocity = new THREE.Vector3(
      Math.sin(this.state.heading) * speedWorld,
      this.state.verticalSpeed,
      -Math.cos(this.state.heading) * speedWorld,
    );
    // A wall is taken head-on; open ground is taken along its slope.
    const normal = hitObstacle
      ? new THREE.Vector3(-velocity.x, 0, -velocity.z).normalize()
      : this.terrainNormal(contact.x, contact.z);
    const closing = Math.max(0, -velocity.dot(normal));

    const impact = classifyImpact({
      // World units are ten metres, so closing speed converts straight across.
      normalSpeed: closing * 10,
      groundSpeedKt: this.state.velocity,
      bankDeg: Math.abs(THREE.MathUtils.radToDeg(this.state.roll)),
      pitchDeg: THREE.MathUtils.radToDeg(this.state.pitch),
      gearDown: this.state.gear,
      surface: hitObstacle ? "obstacle" : this.surfaceAt(contact.x, contact.z),
    });

    if (impact.outcome === OUTCOME.WRECK || impact.outcome === OUTCOME.DESTROYED) {
      position.y += lift;
      this.beginCrash(impact, velocity, contact);
      return true;
    }

    // Survivable arrival: lift by however far the lowest part of the airframe
    // went under, so a raised nose does not leave the tail pinned to the runway.
    // The flight path flattens onto the ground rather than continuing downward.
    position.y += lift;
    if (this.state.verticalSpeed < 0) this.state.verticalSpeed = 0;
    if (this.state.gamma < 0) this.state.gamma = 0;
    if (this.airborne) {
      this.airborne = false;
      this.onTouchdown?.(impact);
    }
    return false;
  }

  beginCrash(impact, velocity, contact) {
    if (this.crash) return;
    this.crashed = true;
    this.crashImpact = impact;
    this.state.throttle = 0;
    this.state.velocity = 0;
    this.plane.position.copy(this.state.position);
    this.plane.rotation.set(this.state.pitch, -this.state.heading, this.state.roll);
    this.crash = new CrashSequence({
      scene: this.scene,
      plane: this.plane,
      impact,
      velocity,
      groundAt: (x, z) => this.getTerrainHeight(x, z),
      wind: this.cloudDrift,
      effects: this.crashEffects,
      contact,
    });
    this.crashOrbit = Math.random() * Math.PI * 2;
    // Starts near where the chase camera was, then backs off to frame the wreck.
    this.crashCameraDistance = Math.max(4, AIRCRAFT[this.aircraftId].chaseDistance * 2.2);
    this.onCrash?.(impact);
  }

  /** Clears a wreck and rebuilds an intact aircraft ready to fly again. */
  clearCrash() {
    if (!this.crash) return;
    this.crash.dispose();
    this.crash = null;
    this.crashed = false;
    this.crashImpact = null;
    this.scene.remove(this.plane);
    this.plane = this.buildAircraft(AIRCRAFT[this.aircraftId]);
    this.measureAirframe(this.plane);
    this.prepareGear(this.plane);
    this.scene.add(this.plane);
  }

  /**
   * Cinematic view of the wreck: pulls back from the impact, drifts around it,
   * and shakes hard on the initial blast.
   */
  updateCrashCamera(dt) {
    const target = this.crash.focus;
    this.crashOrbit += dt * 0.22;
    const pullBack = this.crash.destroyed ? 17 : 11;
    this.crashCameraDistance = THREE.MathUtils.lerp(
      this.crashCameraDistance,
      pullBack,
      1 - Math.exp(-dt * 1.3),
    );
    const radius = this.crashCameraDistance;
    const desired = new THREE.Vector3(
      target.x + Math.sin(this.crashOrbit) * radius,
      target.y + radius * 0.42,
      target.z + Math.cos(this.crashOrbit) * radius,
    );
    desired.y = Math.max(desired.y, this.getTerrainHeight(desired.x, desired.z) + 2);
    this.camera.up.set(0, 1, 0);
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 1.6));

    const shake = this.crash.shake;
    if (shake > 0.002 && !this.reducedMotion.matches) {
      this.camera.position.x += (Math.random() - 0.5) * shake * 2.2;
      this.camera.position.y += (Math.random() - 0.5) * shake * 2.2;
      this.camera.position.z += (Math.random() - 0.5) * shake * 2.2;
    }
    this.camera.lookAt(target);
  }

  updateCamera(dt) {
    if (this.crash) {
      this.plane.visible = !this.crash.destroyed;
      this.updateCrashCamera(dt);
      return;
    }
    if (!this.running) {
      this.previewOrbit += dt * 0.035;
      const { centre, radius, height } = this.previewCircuit;
      const target = new THREE.Vector3(...centre);
      this.camera.position.set(
        target.x + Math.sin(this.previewOrbit) * radius,
        height,
        target.z + Math.cos(this.previewOrbit) * radius,
      );
      this.camera.lookAt(target);
      this.plane.visible = false;
      return;
    }
    // An aircraft can carry its interior either as a separate group that is
    // swapped in for the cockpit view, or modelled into the airframe itself —
    // in which case the airframe simply stays drawn.
    const hasInterior =
      this.plane.userData.interiorBuiltIn || Boolean(this.plane.userData.cockpitInterior);
    this.plane.visible = this.cameraMode !== "cockpit" || hasInterior;
    if (this.plane.userData.cockpitInterior) {
      this.plane.userData.cockpitInterior.visible = this.cameraMode === "cockpit";
    }
    if (this.plane.userData.exterior && this.plane.userData.hideExteriorInCockpit) {
      this.plane.userData.exterior.visible = this.cameraMode !== "cockpit";
    }
    // One mesh or several: a painted propeller carries its stripes as a
    // separate layer, and both have to fade together.
    const blades = this.plane.userData.controls?.propellerBlade;
    for (const propellerBlade of blades ? [blades].flat() : []) {
      const inCockpit = this.cameraMode === "cockpit";
      propellerBlade.material.opacity = inCockpit ? 0.22 : 1;
      propellerBlade.material.depthWrite = !inCockpit;
    }
    const forward = new THREE.Vector3(Math.sin(this.state.heading), 0, -Math.cos(this.state.heading));
    const spec = AIRCRAFT[this.aircraftId];
    if (this.cameraMode === "chase") {
      this.camera.up.set(0, 1, 0);
      const right = new THREE.Vector3(Math.cos(this.state.heading), 0, Math.sin(this.state.heading));
      const orbit = this.chaseOrbit;
      const resetDue = (
        !orbit.dragging
        && performance.now() - orbit.lastInputAt >= 5000
      );
      if (resetDue) {
        orbit.targetYaw = 0;
        orbit.targetPitch = 0;
      }

      if (resetDue && this.reducedMotion.matches) {
        orbit.yaw = 0;
        orbit.pitch = 0;
      } else {
        const response = orbit.dragging ? 18 : resetDue ? 2.8 : 10;
        const amount = 1 - Math.exp(-dt * response);
        orbit.yaw = THREE.MathUtils.lerp(orbit.yaw, orbit.targetYaw, amount);
        orbit.pitch = THREE.MathUtils.lerp(orbit.pitch, orbit.targetPitch, amount);
      }

      const horizontalDistance = spec.chaseDistance * Math.cos(orbit.pitch);
      // Orbit the aircraft itself, not a point farther down its flight path.
      // Keeping both the camera radius and look target on the same anchor
      // makes the plane stay locked to the centre of the screen while dragging.
      const orbitAnchor = this.state.position.clone();
      const desired = orbitAnchor.clone()
        .addScaledVector(forward, -Math.cos(orbit.yaw) * horizontalDistance)
        .addScaledVector(right, Math.sin(orbit.yaw) * horizontalDistance)
        .add(new THREE.Vector3(
          0,
          spec.chaseHeight + Math.sin(orbit.pitch) * spec.chaseDistance,
          0,
        ));
      const cameraResponse = orbit.dragging ? 12 : resetDue ? 4.5 : 5;
      this.camera.position.lerp(desired, 1 - Math.exp(-dt * cameraResponse));
      this.camera.lookAt(orbitAnchor);
    } else if (this.plane.userData.cockpitEye) {
      this.plane.updateMatrixWorld(true);
      const view = this.cockpitView;
      const settle = 1 - Math.exp(-dt * 14);
      view.yaw = THREE.MathUtils.lerp(view.yaw, view.targetYaw, settle);
      view.pitch = THREE.MathUtils.lerp(view.pitch, view.targetPitch, settle);

      const eye = this.plane.userData.cockpitEye;
      // Swing the line of sight about the eye in body axes, so "left" means the
      // left window whatever attitude the aircraft is in. Pitch first about the
      // body lateral axis, then yaw about the body vertical: the same order a
      // head turns, and it keeps the horizon level as you look around.
      const sight = this.plane.userData.cockpitLook.clone().sub(eye)
        .applyAxisAngle(AXIS_X, view.pitch)
        .applyAxisAngle(AXIS_Y, view.yaw);

      const cockpit = this.plane.localToWorld(eye.clone());
      const look = this.plane.localToWorld(eye.clone().add(sight));
      const up = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(this.plane.getWorldQuaternion(new THREE.Quaternion()));
      this.camera.position.copy(cockpit);
      this.camera.up.copy(up);
      this.camera.lookAt(look);
    } else {
      const cockpit = this.state.position.clone()
        .addScaledVector(forward, spec.cockpitOffset)
        .add(new THREE.Vector3(0, spec.cockpitOffset * 0.35, 0));
      this.camera.position.copy(cockpit);
      const look = cockpit.clone().addScaledVector(forward, 20);
      look.y += Math.sin(this.state.pitch) * 4;
      this.camera.up.set(-Math.sin(this.state.roll), Math.cos(this.state.roll), 0);
      this.camera.lookAt(look);
    }
  }

  updateSun() {
    const focus = this.running ? this.state.position : this.camera.position;
    this.sun.position.set(focus.x - 45, focus.y + 95, focus.z - 30);
    this.sun.target.position.set(focus.x, focus.y, focus.z);
    this.sun.target.updateMatrixWorld();
    if (this.sky) this.sky.position.copy(this.camera.position);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    let dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.crash && !this.paused) {
      // A brief hit-stop for weight, not a long slow-motion replay: dragging it
      // out makes the explosion feel like it arrives late.
      const ramp = THREE.MathUtils.smoothstep(this.crash.elapsed, 0.06, 0.5);
      dt *= this.reducedMotion.matches ? 1 : THREE.MathUtils.lerp(0.55, 1, ramp);
      this.crash.update(dt);
    }
    this.crashEffects.update(dt);
    this.updateFlight(dt);
    this.updateCamera(dt);
    this.updateSun();
    this.updateClouds(dt);
    this.updateOcean(dt);
    this.renderer.render(this.scene, this.camera);
  }
}

class FlightMap {
  constructor(flightWorld, miniCanvas, fullCanvas) {
    this.world = flightWorld;
    this.miniCanvas = miniCanvas;
    this.fullCanvas = fullCanvas;
    this.baseCanvas = document.createElement("canvas");
    this.ready = false;
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  buildBaseMap() {
    if (!this.world.terrains.length || !this.world.mapBounds) return false;
    // Framed on the surveyed area, not on any far terrain drawn behind it.
    const [west, north, east, south] = this.world.mapBounds;
    const worldWidth = east - west;
    const worldDepth = south - north;
    const width = 1200;
    const height = Math.round(width * worldDepth / worldWidth);
    this.baseCanvas.width = width;
    this.baseCanvas.height = height;
    const context = this.baseCanvas.getContext("2d");
    const region = this.world.region;
    context.fillStyle = region?.map?.surround ?? "#5ba1b8";
    context.fillRect(0, 0, width, height);

    // An area with no coast spends the whole sea-to-summit ramp above the top
    // stop, so the shading is stretched over the elevations it actually has.
    const [floor, ceiling] = region?.sea === false
      ? this.world.terrains.reduce(
        ([low, high], { metadata }) => [
          Math.min(low, metadata.elevationRange[0]),
          Math.max(high, metadata.elevationRange[1]),
        ],
        [Infinity, -Infinity],
      )
      : [0, 0];
    const inland = region?.sea === false;
    const lake = region?.waterLevelM ?? null;
    const waterInk = new THREE.Color(region?.map?.water ?? "#2f5f80");
    const lakeColor = [waterInk.r, waterInk.g, waterInk.b].map((c) => Math.round(Math.sqrt(c) * 255));
    const stops = region?.map?.ramp
      ?? [[96, 84, 72], [148, 92, 66], [176, 124, 86], [186, 168, 128], [198, 196, 176]];

    // Far terrain lies almost entirely outside the frame; drawing it would be
    // a two-hundred-kilometre image scaled down to a few pixels of overlap.
    for (const terrain of this.world.terrains.filter(({ far }) => !far)) {
      const [sourceWidth, sourceHeight] = terrain.metadata.samples;
      const source = document.createElement("canvas");
      source.width = sourceWidth;
      source.height = sourceHeight;
      const sourceContext = source.getContext("2d");
      const image = sourceContext.createImageData(sourceWidth, sourceHeight);
      for (let index = 0; index < terrain.heights.length; index += 1) {
        const elevation = terrain.heights[index];
        const previous = index > sourceWidth ? terrain.heights[index - sourceWidth] : elevation;
        let color;
        // A lake at altitude reads as low ground on an elevation ramp, so an
        // area that has one names its surface and it is drawn as water.
        if (inland && lake !== null && Math.abs(elevation - lake) < 3) color = lakeColor;
        else if (inland) {
          // Canyon floor through red rock to a pale rim.
          const t = THREE.MathUtils.clamp((elevation - floor) / (ceiling - floor), 0, 1);
          const scaled = t * (stops.length - 1);
          const low = Math.min(stops.length - 2, Math.floor(scaled));
          const blend = scaled - low;
          color = stops[low].map((channel, k) => Math.round(channel + (stops[low + 1][k] - channel) * blend));
        // The USGS seamless DEM uses exactly 0 m for ocean/no-data across much
        // of each source tile. Match the 3D waterline on the navigation map.
        } else if (elevation <= WATERLINE_METRES) color = [91, 161, 184];
        else if (elevation < 35) color = [207, 207, 148];
        else if (elevation < 180) color = [141, 170, 117];
        else if (elevation < 420) color = [106, 145, 101];
        else if (elevation < 700) color = [92, 124, 91];
        else color = [105, 107, 91];
        const contour = elevation > 0 && Math.floor(elevation / 100) !== Math.floor(previous / 100);
        const offset = index * 4;
        image.data[offset] = color[0] - (contour ? 18 : 0);
        image.data[offset + 1] = color[1] - (contour ? 18 : 0);
        image.data[offset + 2] = color[2] - (contour ? 14 : 0);
        image.data[offset + 3] = 255;
      }
      sourceContext.putImageData(image, 0, 0);
      const bounds = terrain.bounds;
      context.drawImage(
        source,
        ((bounds[0] - west) / worldWidth) * width,
        ((bounds[1] - north) / worldDepth) * height,
        ((bounds[2] - bounds[0]) / worldWidth) * width,
        ((bounds[3] - bounds[1]) / worldDepth) * height,
      );
    }
    this.mapBounds = this.world.mapBounds;
    this.ready = true;
    return true;
  }

  sizeCanvas(canvas) {
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width: bounds.width, height: bounds.height };
  }

  coordinates() {
    const [west, north, east, south] = this.mapBounds ?? this.world.mapBounds;
    const worldWidth = east - west;
    const worldDepth = south - north;
    return {
      u: (this.world.state.position.x - west) / worldWidth,
      v: (this.world.state.position.z - north) / worldDepth,
      worldWidth,
      worldDepth,
      west,
      north,
    };
  }

  drawAircraft(context, x, y, heading, size) {
    context.save();
    context.translate(x, y);
    context.rotate(heading);
    context.shadowColor = "rgba(11, 39, 57, .35)";
    context.shadowBlur = size * 0.7;
    context.fillStyle = "#fffaf0";
    context.strokeStyle = "#e86534";
    context.lineWidth = Math.max(2, size * 0.14);
    context.beginPath();
    context.moveTo(0, -size);
    context.lineTo(size * 0.56, size * 0.7);
    context.lineTo(0, size * 0.4);
    context.lineTo(-size * 0.56, size * 0.7);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  drawAirports(context, project, expanded) {
    context.save();
    context.textAlign = "center";
    context.textBaseline = "top";
    context.strokeStyle = "#173d52";
    context.lineWidth = expanded ? 3 : 2;
    context.lineCap = "round";
    for (const airport of AIRPORTS) {
      const point = project(airport.x, airport.z);
      if (!point || point.x < -20 || point.y < -20) continue;
      // Every paved runway is drawn to scale, so the map matches the airfield.
      for (const [x1, z1, x2, z2] of airport.lines) {
        const from = project(x1, z1);
        const to = project(x2, z2);
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
      }
      if (!airport.lines.length) {
        context.beginPath();
        context.moveTo(point.x, point.y - (expanded ? 11 : 7));
        context.lineTo(point.x, point.y + (expanded ? 11 : 7));
        context.stroke();
      }
      if (expanded) {
        context.fillStyle = "#173d52";
        context.font = "700 11px Inter, sans-serif";
        context.fillText(airport.code, point.x, point.y + 16);
      }
    }
    context.restore();
  }

  drawMini() {
    const { context, width, height } = this.sizeCanvas(this.miniCanvas);
    context.fillStyle = this.world.region?.map?.surround ?? "#5ba1b8";
    context.fillRect(0, 0, width, height);
    if (!this.ready) {
      context.fillStyle = "#fff";
      context.font = "600 11px Inter, sans-serif";
      context.fillText("LOADING TERRAIN", 16, height / 2);
      return;
    }
    const { u, v, worldWidth, worldDepth, west, north } = this.coordinates();
    const viewWidth = 1800;
    const viewDepth = viewWidth * height / width;
    const sourceWidth = this.baseCanvas.width * viewWidth / worldWidth;
    const sourceHeight = this.baseCanvas.height * viewDepth / worldDepth;
    const sourceX = Math.max(0, Math.min(this.baseCanvas.width - sourceWidth, u * this.baseCanvas.width - sourceWidth / 2));
    const sourceY = Math.max(0, Math.min(this.baseCanvas.height - sourceHeight, v * this.baseCanvas.height - sourceHeight / 2));
    context.drawImage(this.baseCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
    const project = (x, z) => ({
      x: (((x - west) / worldWidth) * this.baseCanvas.width - sourceX) / sourceWidth * width,
      y: (((z - north) / worldDepth) * this.baseCanvas.height - sourceY) / sourceHeight * height,
    });
    this.drawAirports(context, project, false);
    const aircraft = project(this.world.state.position.x, this.world.state.position.z);
    this.drawAircraft(context, aircraft.x, aircraft.y, this.world.state.heading, 10);
  }

  drawFull() {
    const { context, width, height } = this.sizeCanvas(this.fullCanvas);
    context.fillStyle = this.world.region?.map?.surround ?? "#5ba1b8";
    context.fillRect(0, 0, width, height);
    if (!this.ready) return;
    const scale = Math.min(width / this.baseCanvas.width, height / this.baseCanvas.height);
    const mapWidth = this.baseCanvas.width * scale;
    const mapHeight = this.baseCanvas.height * scale;
    const left = (width - mapWidth) / 2;
    const top = (height - mapHeight) / 2;
    context.drawImage(this.baseCanvas, left, top, mapWidth, mapHeight);
    context.strokeStyle = "rgba(255,255,255,.22)";
    context.lineWidth = 1;
    for (let step = 0.2; step < 1; step += 0.2) {
      context.beginPath();
      context.moveTo(left + mapWidth * step, top);
      context.lineTo(left + mapWidth * step, top + mapHeight);
      context.stroke();
      context.beginPath();
      context.moveTo(left, top + mapHeight * step);
      context.lineTo(left + mapWidth, top + mapHeight * step);
      context.stroke();
    }
    const { u, v, worldWidth, worldDepth, west, north } = this.coordinates();
    const project = (x, z) => ({
      x: left + ((x - west) / worldWidth) * mapWidth,
      y: top + ((z - north) / worldDepth) * mapHeight,
    });
    this.drawAirports(context, project, true);
    this.drawAircraft(context, left + u * mapWidth, top + v * mapHeight, this.world.state.heading, 15);
  }

  updateReadout() {
    const { x, z } = this.world.state.position;
    const bounds = this.world.terrainMetadata.sourceBounds;
    const [referenceWidth, referenceDepth] = this.world.terrainMetadata.worldSize;
    const longitude = bounds[0] + (x / referenceWidth + 0.5) * (bounds[2] - bounds[0]);
    const latitude = bounds[3] - (z / referenceDepth + 0.5) * (bounds[3] - bounds[1]);
    const heading = (Math.round(THREE.MathUtils.radToDeg(this.world.state.heading)) % 360 + 360) % 360;
    document.querySelector("#mapPositionValue").textContent = `${latitude.toFixed(4)}° N · ${Math.abs(longitude).toFixed(4)}° W`;
    document.querySelector("#mapHeadingValue").textContent = `${heading.toString().padStart(3, "0")}°`;
    document.querySelector("#mapAltitudeValue").textContent = `${Math.round(Math.max(0, this.world.state.position.y) * 32.8084).toLocaleString()} ft`;
    document.querySelector("#mapSpeedValue").textContent = `${Math.round(this.world.state.velocity)} KIAS`;
  }

  frame() {
    if (!this.ready) this.buildBaseMap();
    if (this.world.running) {
      this.drawMini();
      if (mapOpen) {
        this.drawFull();
        this.updateReadout();
      }
    }
    requestAnimationFrame(this.frame);
  }
}

const world = new FlightWorld(document.querySelector("#world"));
const setup = document.querySelector(".setup");
const hud = document.querySelector("#hud");
const cockpitFrame = document.querySelector("#cockpitFrame");
const controlHint = document.querySelector("#controlHint");
const pausePanel = document.querySelector("#pausePanel");
const miniMapButton = document.querySelector("#miniMapButton");
const mapOverlay = document.querySelector("#mapOverlay");
const closeMapButton = document.querySelector("#closeMapButton");
const toast = document.querySelector("#toast");
const flightMap = new FlightMap(world, document.querySelector("#miniMapCanvas"), document.querySelector("#fullMapCanvas"));
let regionId = REGIONS[0].id;
let airportIndex = 0;
let airStart = false;
let mapOpen = false;
let hintTimer;
let toastTimer;
const fuelSelections = Object.fromEntries(Object.keys(AIRCRAFT).map((id) => [id, 100]));

const activeRegion = () => REGIONS.find(({ id }) => id === regionId) ?? REGIONS[0];

function updateStartModeButtons() {
  document.querySelector("#runwayButton").setAttribute("aria-pressed", String(!airStart));
  document.querySelector("#airStartButton").setAttribute("aria-pressed", String(airStart));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

/** Moves the whole setup screen — copy, preview and departure — to an area. */
function selectRegion(id) {
  regionId = id;
  const region = activeRegion();
  if (region.orbit) world.previewCircuit = region.orbit;
  // Areas are separate worlds, so this swaps the scenery rather than adding to
  // it. The picker is reseeded straight away and filled in properly once the
  // area's baked airfields land.
  if (region.built) {
    resetAirports(region);
    airportIndex = 0;
    world.loadScenery(region);
  }

  document.querySelector("#conditionTime").textContent = region.time;
  document.querySelector("#conditionVisibility").textContent = region.visibility;
  document.querySelector("#previewConditions").textContent = region.conditions;
  document.querySelector("#previewHeading").textContent = region.heading;
  document.querySelector("#previewBlurb").textContent = region.blurb;
  document.querySelector("#map-title").textContent = `${region.place} flight map`;
  document.documentElement.style.setProperty("--map-surround", region.map?.surround ?? "#5ba1b8");
  // The preview is still circling whichever area was built last, so an area
  // without scenery is veiled rather than passed off as its own.
  setup.classList.toggle("is-unbuilt", !region.built);
  updateAirport();
}

function updateAirport() {
  const region = activeRegion();
  const airport = AIRPORTS[airportIndex] ?? null;
  const code = document.querySelector("#airportCode");
  const name = document.querySelector("#airportName");
  const runwayButton = document.querySelector("#runwayButton");
  const launchButton = document.querySelector("#launchButton");

  if (!region.built || !airport) {
    code.textContent = "No runways yet";
    name.textContent = `${region.name} scenery is still being built`;
    document.querySelector("#airportButton").disabled = true;
    runwayButton.disabled = true;
    runwayButton.title = "";
    document.querySelector("#airStartButton").disabled = true;
    launchButton.disabled = true;
    document.querySelector("#launchLabel").textContent = `${region.name} is not flyable yet`;
    return;
  }

  code.textContent = `${airport.code} · Runway ${airport.runway}`;
  name.textContent = `${airport.locale} · ${airport.name}`;
  // An area with one airfield has nothing to cycle to, but dimming the button
  // the way an unavailable one is dimmed reads as "no departure here" rather
  // than "this is the only one".
  const airportButton = document.querySelector("#airportButton");
  airportButton.disabled = AIRPORTS.length < 2;
  airportButton.classList.toggle("is-sole", AIRPORTS.length < 2);
  runwayButton.disabled = false;
  runwayButton.setAttribute(
    "aria-label",
    airport.ends.length > 1
      ? "Use runway start or change departure runway"
      : "Use runway start",
  );
  runwayButton.title = airport.ends.length
    ? `Runways: ${airport.ends.map(({ ident }) => ident).join(", ")}`
    : "Loading runway data";
  document.querySelector("#airStartButton").disabled = false;
  launchButton.disabled = false;
  document.querySelector("#launchLabel").textContent = "Start flight";
  updateStartModeButtons();
}

function selectedAircraftId() {
  return document.querySelector('input[name="aircraft"]:checked')?.value ?? "c172";
}

function updateFuelPlanner() {
  const id = selectedAircraftId();
  const spec = AIRCRAFT[id];
  const percentage = fuelSelections[id];
  const amount = spec.fuelCapacity * percentage / 100;
  const range = document.querySelector("#fuelRange");

  range.value = percentage;
  range.style.setProperty("--fuel-fill", `${percentage}%`);
  document.querySelector("#fuelKind").textContent = spec.fuelKind;
  document.querySelector("#fuelAmount").textContent = formatFuelAmount(spec, amount);
  document.querySelector("#fuelPercent").textContent = `${percentage}%`;
  document.querySelector("#fuelCapacity").textContent = `${formatFuelAmount(spec, spec.fuelCapacity)} ${spec.fuelCapacityLabel}`;
  document.querySelector("#fuelDetails").textContent = amount > 0
    ? `About ${formatEndurance(amount / spec.cruiseFuelBurn)} at cruise power.`
    : "No usable fuel — the engine will remain off.";
}

function toggleCamera() {
  world.setCameraMode(world.cameraMode === "chase" ? "cockpit" : "chase");
  const cockpit = world.cameraMode === "cockpit";
  document.body.classList.toggle("is-cockpit", cockpit);
  cockpitFrame.classList.toggle("is-visible", cockpit);
  document.querySelector("#cameraButton").textContent = `Camera · ${cockpit ? "Cockpit" : "Chase"}`;
  showToast(cockpit ? "Cockpit view" : "Elevated chase view");
}

function setPaused(paused, showPanel = true) {
  if (!world.running) return;
  world.paused = paused;
  pausePanel.classList.toggle("is-visible", paused && showPanel);
  document.querySelector("#pauseButton").textContent = paused ? "Paused" : "Pause";
}

function togglePause() {
  setPaused(!world.paused);
}

function openExpandedMap() {
  if (!world.running || mapOpen) return;
  mapOpen = true;
  setPaused(true, false);
  mapOverlay.classList.add("is-visible");
  mapOverlay.setAttribute("aria-hidden", "false");
  hud.setAttribute("inert", "");
  closeMapButton.focus();
}

function closeExpandedMap() {
  if (!mapOpen) return;
  mapOpen = false;
  mapOverlay.classList.remove("is-visible");
  mapOverlay.setAttribute("aria-hidden", "true");
  hud.removeAttribute("inert");
  setPaused(false, false);
  miniMapButton.focus();
}

function rewind() {
  const recovered = world.rewind();
  hideCrashPanel();
  if (recovered) showToast("Rewound five seconds");
  else showToast("Fly a little longer before rewinding");
  setPaused(false);
}

const crashPanel = document.querySelector("#crashPanel");
const crashVignette = document.querySelector("#crashVignette");
let crashPanelTimer;

const CRASH_COPY = {
  wreck: {
    kicker: "Airframe written off",
    title: "You walked away.",
    tone: "survived",
  },
  destroyed: {
    kicker: "Non-survivable impact",
    title: "Aircraft destroyed.",
    tone: "lost",
  },
};

function hideCrashPanel() {
  clearTimeout(crashPanelTimer);
  crashPanel.classList.remove("is-visible");
  crashPanel.setAttribute("aria-hidden", "true");
  crashVignette.classList.remove("is-visible");
  hud.removeAttribute("inert");
}

function showCrashPanel(impact) {
  const copy = CRASH_COPY[impact.outcome] ?? CRASH_COPY.destroyed;
  crashPanel.dataset.tone = copy.tone;
  document.querySelector("#crashKicker").textContent = copy.kicker;
  document.querySelector("#crash-title").textContent = copy.title;
  const cause = impact.cause.charAt(0).toUpperCase() + impact.cause.slice(1);
  document.querySelector("#crashCause").textContent = `${cause}.`;
  document.querySelector("#crashImpact").textContent = `${impact.normalSpeed.toFixed(1)} m/s`;
  // Descent is quoted the way a vertical speed indicator reads it.
  const descent = Math.round(Math.abs(world.state.verticalSpeed) * 1968.5 / 50) * 50;
  document.querySelector("#crashDescent").textContent = `${descent.toLocaleString()} ft/min`;
  document.querySelector("#crashSpeed").textContent = `${Math.round(impact.groundSpeedKt)} kt`;
  document.querySelector("#crashBank").textContent = `${Math.round(impact.bankDeg)}°`;

  crashVignette.classList.add("is-visible");
  clearTimeout(crashPanelTimer);
  // Let the crash play before the panel interrupts it.
  crashPanelTimer = setTimeout(() => {
    crashPanel.classList.add("is-visible");
    crashPanel.setAttribute("aria-hidden", "false");
    hud.setAttribute("inert", "");
    document.querySelector("#crashRewindButton").focus();
  }, 2600);
}

world.onCrash = showCrashPanel;
world.onTouchdown = (impact) => {
  if (impact.outcome === "hard") showToast("Hard landing");
};
world.onFuelExhausted = () => showToast("Fuel exhausted · engine shut down");

document.querySelectorAll('input[name="aircraft"]').forEach((input) => {
  input.addEventListener("change", () => {
    world.selectAircraft(input.value);
    updateFuelPlanner();
  });
});

document.querySelector("#fuelRange").addEventListener("input", (event) => {
  fuelSelections[selectedAircraftId()] = Number(event.currentTarget.value);
  updateFuelPlanner();
});

// `?inspect=1` walks around the C172; pass an aircraft id for another model.
const inspecting = new URLSearchParams(location.search).get("inspect");
if (inspecting !== null) {
  const id = AIRCRAFT[inspecting] ? inspecting : "c172";
  const preload = id === "a380" ? preloadA380 : id === "f35" ? preloadF35 : id === "tbm" ? preloadTbm930 : preloadC172;
  preload().then(() => {
    world.selectAircraft(id);
    enableModelInspector(world);
  });
}

const creditsDialog = document.querySelector("[data-credits]");
document.querySelector("[data-credits-open]").addEventListener("click", () => {
  creditsDialog.showModal();
});
document.querySelector("[data-credits-close]").addEventListener("click", () => {
  creditsDialog.close();
});

for (const input of document.querySelectorAll('input[name="area"]')) {
  input.addEventListener("change", (event) => selectRegion(event.currentTarget.value));
}

document.querySelector("#airportButton").addEventListener("click", () => {
  if (!AIRPORTS.length) return;
  airportIndex = (airportIndex + 1) % AIRPORTS.length;
  updateAirport();
});

document.querySelector("#runwayButton").addEventListener("click", () => {
  const airport = AIRPORTS[airportIndex];
  const wasAirStart = airStart;
  airStart = false;
  updateStartModeButtons();
  if (wasAirStart) return;
  if (airport.ends.length < 2) return;
  airport.selected = ((airport.selected ?? 0) + 1) % airport.ends.length;
  world.applyRunway(airport, airport.ends[airport.selected]);
  updateAirport();
});

document.querySelector("#airStartButton").addEventListener("click", () => {
  airStart = true;
  updateStartModeButtons();
});

document.querySelector("#flightForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!activeRegion().built) return;
  const aircraftId = new FormData(event.currentTarget).get("aircraft");
  const fuelFraction = fuelSelections[aircraftId] / 100;
  world.selectAircraft(aircraftId);
  world.start(airportIndex, airStart, fuelFraction);
  setup.classList.add("is-hidden");
  setup.setAttribute("aria-hidden", "true");
  hud.classList.add("is-visible");
  miniMapButton.classList.add("is-visible");
  document.querySelector("#flightAircraft").textContent = AIRCRAFT[aircraftId].code;
  document.querySelector("#flightRegion").textContent = activeRegion().place.toUpperCase();
  controlHint.classList.add("is-visible");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => controlHint.classList.remove("is-visible"), 7500);
  showToast(fuelFraction <= 0
    ? "No usable fuel · engine off"
    : airStart ? "Airborne east of the runway" : "Increase throttle to begin your takeoff roll");
});

// ---------------------------------------------------------------------------
// Touch controls
// ---------------------------------------------------------------------------

/**
 * Wires one on-screen control.
 *
 * Held keys set an axis for as long as a finger is down; tapped keys fire once.
 * Either way the pointer is captured, so a finger that slides off the button
 * still delivers its `pointerup` here — without that, dragging off a held
 * control leaves the axis stuck on and the aircraft rolls into the ground.
 */
function bindTouchControl(button, { onPress, onRelease }) {
  const release = (event) => {
    if (!button.classList.contains("is-held")) return;
    button.classList.remove("is-held");
    try {
      if (button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone; letting go is all that mattered.
    }
    onRelease?.();
  };
  button.addEventListener("pointerdown", (event) => {
    // A second finger arriving on an already-held button would double-fire.
    if (button.classList.contains("is-held")) return;
    event.preventDefault();
    button.classList.add("is-held");
    onPress?.();
    // Capture last, and defensively: it throws NotFoundError when the pointer
    // is no longer active, which can happen between the browser queueing the
    // event and this handler running. Doing it before `onPress` would swallow
    // the press, and would leave `is-held` set with no release to clear it —
    // wedging the button shut for good.
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // Not capturable. Release still arrives through pointerup or pointercancel.
    }
  });
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  // Losing capture to a system gesture — the iOS control centre swipe, a call
  // arriving — has to count as letting go.
  button.addEventListener("lostpointercapture", release);
  // Buttons stay out of the tab order: they exist for fingers, and the same
  // actions already have keys.
  button.tabIndex = -1;
}

for (const button of document.querySelectorAll(".touch [data-axis]")) {
  const axis = button.dataset.axis;
  const value = Number(button.dataset.value);
  bindTouchControl(button, {
    onPress: () => { world.stick[axis] = value; },
    onRelease: () => { if (world.stick[axis] === value) world.stick[axis] = 0; },
  });
}

const touchActions = {
  "flaps-down": () => world.adjustFlaps(10),
  "flaps-up": () => world.adjustFlaps(-10),
  gear: () => world.toggleGear(),
  brakes: () => world.toggleBrakes(),
};
for (const button of document.querySelectorAll(".touch [data-action]")) {
  bindTouchControl(button, { onPress: touchActions[button.dataset.action] });
}

// Gear and brakes are states rather than momentary actions, so the buttons
// track the model — including a gear command the C172 refuses.
const touchGear = document.querySelector("#touchGear");
const touchBrake = document.querySelector("#touchBrake");
setInterval(() => {
  if (!world.running) return;
  touchGear.setAttribute("aria-pressed", String(world.state.gear));
  touchBrake.setAttribute("aria-pressed", String(world.state.airbrake));
}, 120);

// ---------------------------------------------------------------------------
// Tilt-to-fly
//
// The device's own attitude drives pitch and roll. Three things make this
// usable rather than a novelty:
//
//   Permission. iOS 13 and later refuse orientation events unless asked from
//   inside a user gesture, and the promise must be created in the tap itself —
//   awaiting anything first loses the gesture and the prompt never appears.
//
//   A captured neutral. Nobody flies holding a tablet flat on its back, so the
//   attitude at the moment of calibration becomes zero and everything is
//   measured against it.
//
//   Screen rotation. `beta` and `gamma` are reported in the device's own frame,
//   which stops matching the screen the moment it rotates, so they are turned
//   back into screen axes before use.
// ---------------------------------------------------------------------------

const gyroButton = document.querySelector("#gyroButton");
const gyroLevelButton = document.querySelector("#gyroLevelButton");
const touchLeft = document.querySelector("#touchLeft");

// Degrees of tilt away from neutral for full deflection, and the slack around
// neutral that a hand cannot help but wander through.
const GYRO_RANGE_DEGREES = 28;
const GYRO_DEADZONE_DEGREES = 3;
// Which way each axis answers a tilt. See the mapping in `onDeviceOrientation`.
const GYRO_PITCH_SENSE = 1;
const GYRO_ROLL_SENSE = -1;

const gyro = { active: false, neutral: null, latest: null };

/**
 * Device orientation expressed in screen axes, whichever way it is held.
 *
 * Returned in a fixed convention: `pitch` is degrees the top of the screen is
 * tilted back toward the reader, `roll` is degrees the right of the screen is
 * dipped. In portrait those are `beta` and `gamma` directly — the spec's
 * rotations are intrinsic Z-X'-Y'', so a positive `beta` lifts the top of the
 * device and a positive `gamma` swings the screen normal to the right, which
 * puts the right edge down. Rotating the screen permutes the two.
 */
function screenTilt({ beta, gamma }) {
  const angle = screen.orientation?.angle ?? window.orientation ?? 0;
  switch (angle) {
    case 90: return { pitch: -gamma, roll: beta };
    case 180: return { pitch: -beta, roll: -gamma };
    case 270:
    case -90: return { pitch: gamma, roll: -beta };
    default: return { pitch: beta, roll: gamma };
  }
}

function onDeviceOrientation(event) {
  if (event.beta == null || event.gamma == null) return;
  gyro.latest = screenTilt(event);
  if (!gyro.active || !gyro.neutral) return;
  const away = (value) => {
    const past = Math.abs(value) - GYRO_DEADZONE_DEGREES;
    if (past <= 0) return 0;
    return THREE.MathUtils.clamp((Math.sign(value) * past) / GYRO_RANGE_DEGREES, -1, 1);
  };
  // Held like a yoke: lean the device back to raise the nose, dip an edge to
  // bank that way. The flight model reads positive pitch as nose up and
  // positive roll as left wing down, so the roll sense is opposite to the
  // screen convention above and the pitch sense matches it.
  //
  // These two signs are the part that could not be checked without hardware.
  // If an axis flies backwards on a real device, flip the one constant.
  world.stick.pitch = GYRO_PITCH_SENSE * away(gyro.latest.pitch - gyro.neutral.pitch);
  world.stick.roll = GYRO_ROLL_SENSE * away(gyro.latest.roll - gyro.neutral.roll);
}

function calibrateGyro() {
  if (!gyro.latest) return false;
  gyro.neutral = { ...gyro.latest };
  world.stick.pitch = 0;
  world.stick.roll = 0;
  return true;
}

function stopGyro(message) {
  gyro.active = false;
  gyro.neutral = null;
  window.removeEventListener("deviceorientation", onDeviceOrientation);
  world.stick.pitch = 0;
  world.stick.roll = 0;
  gyroButton.setAttribute("aria-pressed", "false");
  gyroLevelButton.hidden = true;
  touchLeft.classList.remove("is-gyro");
  if (message) showToast(message);
}

async function startGyro() {
  if (typeof DeviceOrientationEvent === "undefined") {
    showToast("This device has no tilt sensor");
    return;
  }
  // Must be requested straight out of the tap, before any await.
  const ask = DeviceOrientationEvent.requestPermission?.();
  if (ask) {
    let granted = false;
    try {
      granted = (await ask) === "granted";
    } catch {
      granted = false;
    }
    if (!granted) {
      showToast("Motion access refused — using the tilt pad");
      return;
    }
  }

  window.addEventListener("deviceorientation", onDeviceOrientation);
  gyro.active = true;
  gyroButton.setAttribute("aria-pressed", "true");
  gyroLevelButton.hidden = false;
  touchLeft.classList.add("is-gyro");

  // The first reading can be a frame or two behind the listener, so calibrate
  // once one has actually arrived rather than against nothing.
  const settle = setInterval(() => {
    if (!gyro.active) return clearInterval(settle);
    if (calibrateGyro()) {
      clearInterval(settle);
      showToast("Tilt control on — hold as you are, then fly");
    }
  }, 60);
  setTimeout(() => {
    clearInterval(settle);
    if (gyro.active && !gyro.neutral) stopGyro("No tilt readings — using the tilt pad");
  }, 1500);
}

gyroButton.addEventListener("click", () => {
  if (gyro.active) stopGyro("Tilt control off");
  else startGyro();
});

gyroLevelButton.addEventListener("click", () => {
  showToast(calibrateGyro() ? "Level set" : "No tilt reading yet");
});

// A rotated screen means the axes it was calibrated against no longer apply.
screen.orientation?.addEventListener?.("change", () => {
  if (gyro.active) {
    gyro.neutral = null;
    setTimeout(() => {
      if (gyro.active && calibrateGyro()) showToast("Screen rotated — level reset");
    }, 250);
  }
});

// Leaving the flight must not strand a control on.
function releaseTouchControls() {
  world.stick.pitch = 0;
  world.stick.roll = 0;
  world.stick.throttle = 0;
  for (const held of document.querySelectorAll(".touch .is-held")) held.classList.remove("is-held");
}
window.addEventListener("blur", releaseTouchControls);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseTouchControls();
});

document.querySelector("#cameraButton").addEventListener("click", toggleCamera);
document.querySelector("#pauseButton").addEventListener("click", togglePause);
miniMapButton.addEventListener("click", openExpandedMap);
closeMapButton.addEventListener("click", closeExpandedMap);
document.querySelector("#resumeButton").addEventListener("click", () => setPaused(false));
document.querySelector("#rewindButton").addEventListener("click", rewind);
document.querySelector("#resetButton").addEventListener("click", () => {
  world.reset();
  hideCrashPanel();
  setPaused(false);
  showToast("Reset on runway");
});
document.querySelector("#crashRewindButton").addEventListener("click", rewind);
document.querySelector("#crashResetButton").addEventListener("click", () => {
  world.reset();
  hideCrashPanel();
  setPaused(false);
  showToast("Reset on runway");
});
document.querySelector("#crashExitButton").addEventListener("click", () => {
  document.querySelector("#exitButton").click();
});
document.querySelector("#exitButton").addEventListener("click", () => {
  world.clearCrash();
  hideCrashPanel();
  world.running = false;
  world.paused = false;
  document.querySelector("#pauseButton").textContent = "Pause";
  world.setCameraMode("chase");
  document.body.classList.remove("is-cockpit");
  cockpitFrame.classList.remove("is-visible");
  pausePanel.classList.remove("is-visible");
  mapOpen = false;
  mapOverlay.classList.remove("is-visible");
  mapOverlay.setAttribute("aria-hidden", "true");
  hud.removeAttribute("inert");
  miniMapButton.classList.remove("is-visible");
  hud.classList.remove("is-visible");
  setup.classList.remove("is-hidden");
  setup.removeAttribute("aria-hidden");
});

// Handy for inspecting scenery from the console while iterating on it.
if (import.meta.env.DEV) window.horizon = { world, flightMap, AIRPORTS, AIRCRAFT };

setInterval(() => {
  if (!world.running) return;
  const state = world.state;
  document.querySelector("#speedValue").textContent = Math.round(state.velocity).toString().padStart(3, "0");
  document.querySelector("#altitudeValue").textContent = Math.round(Math.max(0, state.position.y) * 32.8084).toString().padStart(4, "0");
  document.querySelector("#headingValue").textContent = ((Math.round(THREE.MathUtils.radToDeg(state.heading)) % 360 + 360) % 360).toString().padStart(3, "0");
  document.querySelector("#throttleValue").textContent = Math.round(state.throttle * 100).toString().padStart(2, "0");
  const spec = AIRCRAFT[world.aircraftId];
  const fuelPercentage = spec.fuelCapacity > 0 ? state.fuel / spec.fuelCapacity * 100 : 0;
  document.querySelector("#fuelValue").textContent = fuelPercentage <= 0
    ? "00"
    : fuelPercentage >= 99.95 ? "100" : fuelPercentage.toFixed(1);
  const fuelMetric = document.querySelector("#fuelMetric");
  fuelMetric.classList.toggle("is-low", fuelPercentage > 0 && fuelPercentage <= 15);
  fuelMetric.classList.toggle("is-empty", !state.engineRunning);
  fuelMetric.setAttribute(
    "aria-label",
    state.engineRunning
      ? `Fuel ${fuelPercentage.toFixed(1)} percent`
      : "Fuel empty, engine off",
  );
  document.querySelector("#flapsValue").textContent = Math.round(state.flapPosition);
  document.querySelector("#gearValue").textContent = state.gearPosition >= 0.999
    ? "Down"
    : state.gearPosition <= 0.001 ? "Up" : "Transit";
  document.querySelector("#brakeValue").textContent = state.airbrake ? "On" : "Off";
}, 100);

updateFuelPlanner();
selectRegion(regionId);
