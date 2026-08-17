import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Airfield guidance signage and the holding-position markings it refers to.
//
// The existing scenery placed a single mandatory sign wherever a taxiway
// centreline happened to pass near a runway hold line. Everything a pilot
// actually navigates by — where you are, which way each taxiway goes, how much
// runway is left — was missing, as were the painted bars the mandatory sign is
// telling you not to cross.
//
// Legends come out of a graph built from the OSM taxiway centrelines, so the
// direction arrays name the taxiways that genuinely meet at each junction
// rather than a hand-written table that would go stale on the next rebuild.
//
// Dimensions follow FAA AC 150/5340-18 size 3, which is what a field the size
// of PHNL uses. Working in real inches matters here: the old panels were 1.1 m
// tall against a 30 in standard, which read as billboards from the cockpit.

const WORLD_PER_METRE = 0.1;
const m = (metres) => metres * WORLD_PER_METRE;

const FACE_HEIGHT_M = 0.762; // 30 in
const LEGEND_HEIGHT_M = 0.305; // 12 in
const MOUNT_HEIGHT_M = 0.46; // face bottom above grade

// Every sign face is rendered at one height into a shared atlas, so the whole
// field's signage draws as a single mesh however many panels it ends up with.
//
// Faces are packed into shelves one face tall, which makes the sheet hold
// roughly (ATLAS_SIZE / FACE_PIXELS) * ATLAS_SIZE pixels of legend. The three
// Oʻahu fields need about 170 distinct faces; 64 leaves better than double that
// in reserve, where 96 overflowed and started reissuing other signs' legends.
// Signs are small on screen, so the resolution is not the binding constraint.
const FACE_PIXELS = 64;
const PIXELS_PER_METRE = FACE_PIXELS / FACE_HEIGHT_M;
const ATLAS_SIZE = 2048;

const STYLE = {
  // Mandatory instruction: red field, white legend. Runway holding positions.
  mandatory: { fill: "#9c2420", ink: "#f7f4ef", border: null },
  // Location: black field, yellow legend inside a yellow border.
  location: { fill: "#17191b", ink: "#e8c245", border: "#e8c245" },
  // Direction and destination: yellow field, black legend and arrow.
  direction: { fill: "#e0b526", ink: "#151515", border: null },
  // Distance remaining: black field, white numeral.
  distance: { fill: "#17191b", ink: "#f4f4f2", border: null },
};

const LEGEND_FONT = (px) => `700 ${px}px "Helvetica Neue", Helvetica, Arial, sans-serif`;

// ---------------------------------------------------------------------------
// Taxiway graph
// ---------------------------------------------------------------------------

// Centrelines are baked to two decimals of a world unit, so a decimetre grid
// matches shared OSM nodes exactly without merging genuinely separate points.
const nodeKey = (x, z) => `${Math.round(x * 100)}:${Math.round(z * 100)}`;

/**
 * Junction graph over the taxiway centrelines.
 *
 * A vertex becomes a node when it ends a way or is shared by two or more ways,
 * which is precisely where a pilot needs to be told what the options are.
 */
export class TaxiwayGraph {
  constructor(taxiways) {
    this.nodes = new Map();
    this.edges = [];

    const owners = new Map();
    for (const [index, taxiway] of taxiways.entries()) {
      for (const [pointIndex, [x, z]] of taxiway.path.entries()) {
        const key = nodeKey(x, z);
        if (!owners.has(key)) owners.set(key, { ways: new Set(), terminal: false, x, z });
        const entry = owners.get(key);
        entry.ways.add(index);
        if (pointIndex === 0 || pointIndex === taxiway.path.length - 1) entry.terminal = true;
      }
    }

    const isNode = (key) => {
      const entry = owners.get(key);
      return entry && (entry.terminal || entry.ways.size > 1);
    };

    for (const taxiway of taxiways) {
      let run = [];
      for (const point of taxiway.path) {
        run.push(point);
        const key = nodeKey(point[0], point[1]);
        if (run.length > 1 && isNode(key)) {
          this.addEdge(taxiway, run);
          run = [point];
        }
      }
      if (run.length > 1) this.addEdge(taxiway, run);
    }
  }

  addEdge(taxiway, path) {
    const first = path[0];
    const last = path[path.length - 1];
    const from = this.node(first[0], first[1]);
    const to = this.node(last[0], last[1]);
    if (from === to) return;
    const index = this.edges.length;
    this.edges.push({
      ref: taxiway.name ? String(taxiway.name).toUpperCase() : null,
      widthM: taxiway.widthM,
      from,
      to,
      path: path.slice(),
    });
    this.nodes.get(from).edges.push(index);
    this.nodes.get(to).edges.push(index);
  }

  node(x, z) {
    const key = nodeKey(x, z);
    if (!this.nodes.has(key)) this.nodes.set(key, { key, x, z, edges: [] });
    return key;
  }

  /**
   * Direction the edge runs when leaving `nodeKey`, taken a short way along the
   * centreline so a stub segment at the junction does not decide the bearing.
   */
  bearingFrom(edge, key) {
    const forward = edge.from === key;
    const path = forward ? edge.path : edge.path.slice().reverse();
    const [ox, oz] = path[0];
    let target = path[path.length - 1];
    for (const point of path) {
      if (Math.hypot(point[0] - ox, point[1] - oz) > m(25)) {
        target = point;
        break;
      }
    }
    return Math.atan2(target[1] - oz, target[0] - ox);
  }
}

// ---------------------------------------------------------------------------
// Sign faces
// ---------------------------------------------------------------------------

/** Angle to the nearest arrow the FAA vocabulary actually uses. */
function arrowGlyph(turn) {
  const steps = [-Math.PI, -Math.PI * 0.75, -Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2, Math.PI * 0.75, Math.PI];
  let best = steps[0];
  for (const step of steps) {
    if (Math.abs(step - turn) < Math.abs(best - turn)) best = step;
  }
  return best;
}

function drawArrow(context, cx, cy, size, angle) {
  context.save();
  context.translate(cx, cy);
  // Canvas y grows downward; the glyph angle is measured with straight-ahead up.
  context.rotate(angle);
  const shaft = size * 0.30;
  const head = size * 0.34;
  context.beginPath();
  context.moveTo(0, -size * 0.5);
  context.lineTo(head, -size * 0.5 + head);
  context.lineTo(shaft * 0.5, -size * 0.5 + head);
  context.lineTo(shaft * 0.5, size * 0.5);
  context.lineTo(-shaft * 0.5, size * 0.5);
  context.lineTo(-shaft * 0.5, -size * 0.5 + head);
  context.lineTo(-head, -size * 0.5 + head);
  context.closePath();
  context.fill();
  context.restore();
}

/**
 * Shelf-packed atlas of every distinct sign face on the map.
 *
 * Faces are keyed by their legend, so the nine distance-remaining numerals cost
 * nine slots no matter how many hundreds of posts carry them.
 */
class SignAtlas {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = ATLAS_SIZE;
    this.canvas.height = ATLAS_SIZE;
    this.context = this.canvas.getContext("2d");
    this.context.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.cache = new Map();
    this.penX = 0;
    this.penY = 0;
    this.full = false;
  }

  /** Width in metres a panel needs for its legend. */
  measure(panel) {
    const context = this.context;
    context.font = LEGEND_FONT(LEGEND_HEIGHT_M * PIXELS_PER_METRE);
    const text = panel.text ? context.measureText(panel.text).width : 0;
    const arrow = panel.arrow != null ? LEGEND_HEIGHT_M * PIXELS_PER_METRE * 0.95 : 0;
    const gap = text && arrow ? LEGEND_HEIGHT_M * PIXELS_PER_METRE * 0.28 : 0;
    const pad = LEGEND_HEIGHT_M * PIXELS_PER_METRE * 0.42;
    // A one-character legend would otherwise leave a panel far narrower than it
    // is tall; real boards never get thinner than about square.
    return Math.max(FACE_HEIGHT_M, (text + arrow + gap + pad * 2) / PIXELS_PER_METRE);
  }

  /**
   * Renders a face — one or more panels butted together — and returns its atlas
   * rectangle plus the real-world width it should be built at.
   */
  face(panels) {
    const key = panels.map((p) => `${p.style}|${p.text ?? ""}|${p.arrow ?? ""}`).join("//");
    if (this.cache.has(key)) return this.cache.get(key);

    const widths = panels.map((panel) => this.measure(panel));
    const widthM = widths.reduce((total, value) => total + value, 0);
    const widthPx = Math.ceil(widthM * PIXELS_PER_METRE);

    if (this.penX + widthPx > ATLAS_SIZE) {
      this.penX = 0;
      this.penY += FACE_PIXELS;
    }
    if (this.penY + FACE_PIXELS > ATLAS_SIZE) {
      // Out of atlas. Reuse the first face rather than drawing outside it; the
      // field stays renderable and the miss is visible rather than a crash.
      this.full = true;
      return this.cache.values().next().value ?? null;
    }

    const originX = this.penX;
    const originY = this.penY;
    this.penX += widthPx;

    const context = this.context;
    let x = originX;
    for (const [index, panel] of panels.entries()) {
      const style = STYLE[panel.style] ?? STYLE.direction;
      const panelWidth = Math.round(widths[index] * PIXELS_PER_METRE);
      context.fillStyle = style.fill;
      context.fillRect(x, originY, panelWidth, FACE_PIXELS);

      if (style.border) {
        context.strokeStyle = style.border;
        context.lineWidth = FACE_PIXELS * 0.055;
        context.strokeRect(
          x + context.lineWidth,
          originY + context.lineWidth,
          panelWidth - context.lineWidth * 2,
          FACE_PIXELS - context.lineWidth * 2,
        );
      }

      // A black divider separates destinations sharing one yellow face.
      if (index > 0 && panel.style === "direction" && panels[index - 1].style === "direction") {
        context.fillStyle = "#151515";
        context.fillRect(x - FACE_PIXELS * 0.02, originY, FACE_PIXELS * 0.04, FACE_PIXELS);
      }

      const legendPx = LEGEND_HEIGHT_M * PIXELS_PER_METRE;
      const arrowWidth = panel.arrow != null ? legendPx * 0.95 : 0;
      const gap = panel.text && arrowWidth ? legendPx * 0.28 : 0;
      context.font = LEGEND_FONT(legendPx);
      const textWidth = panel.text ? context.measureText(panel.text).width : 0;
      let cursor = x + (panelWidth - (textWidth + arrowWidth + gap)) / 2;

      context.fillStyle = style.ink;
      if (panel.arrow != null && panel.arrowLeading !== false) {
        drawArrow(context, cursor + arrowWidth / 2, originY + FACE_PIXELS / 2, legendPx, panel.arrow);
        cursor += arrowWidth + gap;
      }
      if (panel.text) {
        context.textAlign = "left";
        context.textBaseline = "middle";
        context.fillText(panel.text, cursor, originY + FACE_PIXELS * 0.53);
        cursor += textWidth + gap;
      }
      if (panel.arrow != null && panel.arrowLeading === false) {
        drawArrow(context, cursor + arrowWidth / 2, originY + FACE_PIXELS / 2, legendPx, panel.arrow);
      }

      x += panelWidth;
    }

    const entry = {
      widthM,
      uv: [
        originX / ATLAS_SIZE,
        1 - (originY + FACE_PIXELS) / ATLAS_SIZE,
        (originX + widthPx) / ATLAS_SIZE,
        1 - originY / ATLAS_SIZE,
      ],
    };
    this.cache.set(key, entry);
    return entry;
  }

  commit() {
    if (this.full) {
      // Silently reusing another sign's legend would be a very hard bug to
      // spot from the cockpit, so say so.
      console.warn(
        `Sign atlas full at ${this.cache.size} faces; later signs reuse an existing legend.`,
      );
    }
    this.texture.needsUpdate = true;
  }

  /** Distinct faces packed, and how much of the sheet they used. */
  get usage() {
    return { faces: this.cache.size, rows: this.penY / FACE_PIXELS + 1, full: this.full };
  }
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/** Where a taxiway centreline crosses a runway's holding position. */
function holdCrossings(graph, frames) {
  const crossings = [];
  for (const edge of graph.edges) {
    for (const { runway, frame } of frames) {
      const holdOffset = frame.halfWidth + m(45);
      for (let i = 0; i < edge.path.length - 1; i += 1) {
        const a = edge.path[i];
        const b = edge.path[i + 1];
        const project = ([x, z]) => {
          const dx = x - frame.centre.x;
          const dz = z - frame.centre.y;
          return {
            along: dx * frame.forward.x + dz * frame.forward.y,
            across: dx * frame.right.x + dz * frame.right.y,
          };
        };
        const pa = project(a);
        const pb = project(b);
        if (Math.abs(pa.along) > frame.halfLength && Math.abs(pb.along) > frame.halfLength) continue;

        for (const side of [-1, 1]) {
          const target = side * holdOffset;
          // Does this segment straddle the hold line on this side?
          if ((pa.across - target) * (pb.across - target) > 0) continue;
          const t = (target - pa.across) / (pb.across - pa.across || 1);
          const along = pa.along + (pb.along - pa.along) * t;
          if (Math.abs(along) > frame.halfLength) continue;

          const x = a[0] + (b[0] - a[0]) * t;
          const z = a[1] + (b[1] - a[1]) * t;
          const heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
          crossings.push({
            runway,
            frame,
            edge,
            side,
            x,
            z,
            // Direction of travel that would take an aircraft onto the runway.
            onto: side > 0 ? heading + Math.PI : heading,
            headingAlong: heading,
          });
        }
      }
    }
  }
  return crossings;
}

/**
 * Painted holding-position bars: two solid lines on the holding side and two
 * dashed on the runway side, 12 in wide with 6 in gaps.
 */
export function planHoldMarkings(crossings) {
  const stripes = [];
  const LINE = 0.3;
  const GAP = 0.15;
  const DASH = 0.9;

  for (const crossing of crossings) {
    const width = m(crossing.edge.widthM ?? 23);
    // The bars run across the taxiway, so their long axis is the centreline
    // normal at the crossing point.
    const along = new THREE.Vector2(
      Math.cos(crossing.headingAlong),
      Math.sin(crossing.headingAlong),
    );
    const across = new THREE.Vector2(-along.y, along.x);

    // Solid pair nearest the aircraft, dashed pair nearest the runway.
    const toRunway = crossing.side > 0 ? 1 : -1;
    for (let index = 0; index < 4; index += 1) {
      const offset = m((index - 1.5) * (LINE + GAP)) * toRunway;
      const centre = new THREE.Vector2(
        crossing.x + along.x * offset,
        crossing.z + along.y * offset,
      );
      const solid = index < 2;
      if (solid) {
        stripes.push({ centre, across, along, halfLength: width / 2, halfWidth: m(LINE) / 2 });
      } else {
        // Dashes are laid along the bar, 3 ft on, 3 ft off.
        const count = Math.max(1, Math.round(width / m(DASH * 2)));
        for (let d = 0; d < count; d += 1) {
          const t = (d + 0.25) / count - 0.5;
          const dashCentre = new THREE.Vector2(
            centre.x + across.x * t * width,
            centre.y + across.y * t * width,
          );
          stripes.push({
            centre: dashCentre,
            across,
            along,
            halfLength: m(DASH) / 2,
            halfWidth: m(LINE) / 2,
          });
        }
      }
    }
  }
  return stripes;
}

/**
 * Every sign on the field, as position/angle/panel specs.
 *
 * Mandatory signs sit at hold crossings, direction arrays at junctions, and
 * distance-remaining boards down the runway edges.
 */
export function planSigns(airport, frames, graph, crossings) {
  const signs = [];
  const placed = [];
  const clear = (x, z, radius) => {
    for (const point of placed) {
      if (Math.hypot(point[0] - x, point[1] - z) < radius) return false;
    }
    placed.push([x, z]);
    return true;
  };

  // -- Mandatory holding position, with the taxiway's own location panel ------
  for (const crossing of crossings) {
    const { frame, edge } = crossing;
    // Set back off the bars so the sign sits beside the pavement, not on it.
    const offset = m((edge.widthM ?? 23) / 2 + 6);
    const across = new THREE.Vector2(
      -Math.sin(crossing.headingAlong),
      Math.cos(crossing.headingAlong),
    );
    for (const hand of [-1, 1]) {
      const x = crossing.x + across.x * offset * hand;
      const z = crossing.z + across.y * offset * hand;
      if (!clear(x, z, m(28))) continue;
      const panels = [{ style: "mandatory", text: crossing.runway.designator.replace("/", "-") }];
      if (edge.ref) panels.push({ style: "location", text: edge.ref });
      signs.push({ x, z, facing: crossing.onto + Math.PI, panels });
      break;
    }
  }

  // -- Direction arrays at junctions -----------------------------------------
  for (const node of graph.nodes.values()) {
    if (node.edges.length < 3) continue;
    const incident = node.edges.map((index) => ({
      edge: graph.edges[index],
      bearing: graph.bearingFrom(graph.edges[index], node.key),
    }));

    for (const approach of incident) {
      if (!approach.edge.ref) continue;
      // Travelling towards the node means facing the reverse of the outbound
      // bearing the graph reports.
      const inbound = approach.bearing + Math.PI;
      const others = incident
        .filter((entry) => entry !== approach && entry.edge.ref && entry.edge.ref !== approach.edge.ref)
        .map((entry) => {
          let turn = entry.bearing - inbound;
          while (turn > Math.PI) turn -= Math.PI * 2;
          while (turn < -Math.PI) turn += Math.PI * 2;
          return { ref: entry.edge.ref, turn };
        })
        .sort((a, b) => a.turn - b.turn);
      if (!others.length) continue;

      // Stand the array back up the approach and off to the right, where a
      // pilot rolling towards the junction will see it.
      const setback = m(34);
      const lateral = m((approach.edge.widthM ?? 23) / 2 + 7);
      const x = node.x - Math.cos(inbound) * setback - Math.sin(inbound) * lateral;
      const z = node.z - Math.sin(inbound) * setback + Math.cos(inbound) * lateral;
      if (!clear(x, z, m(30))) continue;

      const panels = others.slice(0, 3).map((entry) => ({
        style: "direction",
        text: entry.ref,
        arrow: arrowGlyph(entry.turn),
        // The arrow leads on a left turn and trails on a right one, so the
        // legend always reads outward from the centre of the array.
        arrowLeading: entry.turn < 0,
      }));
      panels.push({ style: "location", text: approach.edge.ref });
      signs.push({ x, z, facing: inbound + Math.PI, panels });
    }
  }

  // -- Runway distance remaining ---------------------------------------------
  const FEET_PER_METRE = 3.28084;
  for (const { runway, frame } of frames) {
    const lengthFt = runway.lengthM * FEET_PER_METRE;
    if (lengthFt < 4000) continue; // Short fields do not carry these boards.
    for (const [index] of runway.ends.entries()) {
      // +1 runs from the low-numbered threshold towards the high one.
      const direction = index === 0 ? 1 : -1;
      for (let thousand = 1; thousand * 1000 < lengthFt - 1000; thousand += 1) {
        const remainingM = (thousand * 1000) / FEET_PER_METRE;
        const along = direction * (frame.halfLength - m(remainingM));
        const lateral = frame.halfWidth + m(17);
        // Boards go on the pilot's left for the direction of travel.
        const hand = -direction;
        const x = frame.centre.x + frame.forward.x * along + frame.right.x * lateral * hand;
        const z = frame.centre.y + frame.forward.y * along + frame.right.y * lateral * hand;
        const facing = Math.atan2(
          -direction * frame.forward.y,
          -direction * frame.forward.x,
        );
        signs.push({
          x,
          z,
          facing,
          panels: [{ style: "distance", text: String(thousand) }],
        });
      }
    }
  }

  return signs;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Builds every sign on every field into one panel mesh and one leg mesh.
 *
 * The atlas is shared across airfields, so the whole world's signage is two
 * draw calls no matter how many boards end up planted.
 */
export class SignageBuilder {
  constructor() {
    this.atlas = new SignAtlas();
    this.panelPositions = [];
    this.panelUvs = [];
    this.panelIndices = [];
    this.legs = [];
  }

  add(signs, baseY) {
    for (const sign of signs) {
      const face = this.atlas.face(sign.panels);
      if (!face) continue;
      const width = m(face.widthM);
      const height = m(FACE_HEIGHT_M);
      const bottom = baseY + m(MOUNT_HEIGHT_M);

      const dirX = Math.cos(sign.facing);
      const dirZ = Math.sin(sign.facing);
      // The face spans the sign's width across the facing direction. Which of
      // the two perpendiculars it runs along decides both which way the quad's
      // front points and whether the legend reads forwards, and only this one
      // gets both right: the other leaves the sign readable from behind and
      // mirrored for the pilot it is meant for.
      const spanX = dirZ;
      const spanZ = -dirX;

      const base = this.panelPositions.length / 3;
      for (const [side, level] of [
        [-1, 0],
        [1, 0],
        [1, 1],
        [-1, 1],
      ]) {
        this.panelPositions.push(
          sign.x + spanX * side * (width / 2),
          bottom + height * level,
          sign.z + spanZ * side * (width / 2),
        );
      }
      const [u0, v0, u1, v1] = face.uv;
      this.panelUvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
      this.panelIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);

      for (const side of [-0.62, 0.62]) {
        const leg = new THREE.BoxGeometry(m(0.06), m(MOUNT_HEIGHT_M), m(0.06));
        leg.translate(
          sign.x + spanX * side * (width / 2),
          baseY + m(MOUNT_HEIGHT_M) / 2,
          sign.z + spanZ * side * (width / 2),
        );
        this.legs.push(leg);
      }
    }
  }

  /** Panel and leg meshes, or null when nothing was planted. */
  finish() {
    this.atlas.commit();
    if (!this.panelIndices.length) return null;

    const group = new THREE.Group();
    group.name = "signage";

    const panels = new THREE.BufferGeometry();
    panels.setAttribute("position", new THREE.Float32BufferAttribute(this.panelPositions, 3));
    panels.setAttribute("uv", new THREE.Float32BufferAttribute(this.panelUvs, 2));
    panels.setIndex(this.panelIndices);
    panels.computeVertexNormals();

    const faceMesh = new THREE.Mesh(
      panels,
      new THREE.MeshBasicMaterial({
        map: this.atlas.texture,
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.5,
      }),
    );
    faceMesh.name = "sign-faces";
    group.add(faceMesh);

    if (this.legs.length) {
      const legGeometry = mergeGeometries(this.legs, false);
      this.legs.forEach((geometry) => geometry.dispose());
      if (legGeometry) {
        const legMesh = new THREE.Mesh(
          legGeometry,
          new THREE.MeshStandardMaterial({ color: 0x2b2f31, roughness: 0.8 }),
        );
        legMesh.name = "sign-legs";
        group.add(legMesh);
      }
    }
    return group;
  }
}

export { holdCrossings };
