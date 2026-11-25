// A car body made in the Car Builder: simple shapes (boxes, wedges, tapered boxes, cylinders,
// balls), each painted, trimmed, glazed or lit, turned into the same polygon lists the E30 and
// RX-7 bodies use, so the game drives it exactly like them.
import * as THREE from 'three';
import { GLASS, BLACK, TRIM, CHROME } from './poly.js';

const DEG = Math.PI / 180;
export const PART_TYPES = ['box', 'wedge', 'taper', 'cyl', 'ball'];
export const MATS = {
  paint: null, // the car's paint, which you change in the tuning shop
  trim: TRIM,
  black: BLACK,
  chrome: CHROME,
  glass: GLASS,
  head: [0.91, 0.93, 0.94],
  tail: [0.82, 0.08, 0.11],
  color: null, // its own colour
};

const hex = (h) => {
  const c = new THREE.Color(h || '#888888');
  return [c.r, c.g, c.b];
};

// The shape of a part, 1 x 1 x 1 about its centre, before sizing.
function unitGeometry(part) {
  let g;
  switch (part.type) {
    case 'cyl':
      g = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
      break;
    case 'ball':
      g = new THREE.IcosahedronGeometry(0.5, 1);
      break;
    default:
      g = new THREE.BoxGeometry(1, 1, 1);
  }
  g = g.toNonIndexed();
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y <= 0) continue;
    // Wedge: the top slopes down to the front edge (a bonnet, a windscreen, a spoiler).
    if (part.type === 'wedge' && pos.getZ(i) > 0) pos.setY(i, -0.5);
    // Taper: the top is narrower and shorter than the bottom (a cabin, a roof).
    if (part.type === 'taper') {
      const t = part.t ?? 0.65;
      pos.setX(i, pos.getX(i) * t);
      pos.setZ(i, pos.getZ(i) * (0.5 + t / 2));
    }
  }
  return g;
}

// A part's matrix: size, then turn (pitch, yaw, roll), then move into place.
export function partMatrix(part, mirrored = false) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...part.p),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(part.r[0] * DEG, part.r[1] * DEG, part.r[2] * DEG, 'YXZ')),
    new THREE.Vector3(...part.s),
  );
  if (mirrored) m.premultiply(new THREE.Matrix4().makeScale(-1, 1, 1));
  return m;
}

// The part as a mesh-ready geometry in car space (for the builder), mirrored if asked.
export function partGeometry(part, mirrored = false) {
  const g = unitGeometry(part);
  g.applyMatrix4(partMatrix(part, mirrored));
  if (mirrored) flipWinding(g);
  g.computeVertexNormals();
  return g;
}

function flipWinding(g) {
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i += 3) {
    const x = pos.getX(i + 1);
    const y = pos.getY(i + 1);
    const z = pos.getZ(i + 1);
    pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
    pos.setXYZ(i + 2, x, y, z);
  }
}

// Every copy of a part: itself, and its mirror image across the middle of the car if it has one.
export const copies = (part) => (part.mirror && Math.abs(part.p[0]) > 0.005 ? [false, true] : [false]);

// The design's parts as polygons, sorted the way CarModel wants them.
export function designPolys(design) {
  const out = { paint: [], trim: [], glass: [], head: [], tail: [] };
  for (const part of design.parts) {
    const bucket = part.mat === 'paint' ? 'paint' : part.mat === 'glass' ? 'glass' : part.mat === 'head' ? 'head' : part.mat === 'tail' ? 'tail' : 'trim';
    const color = part.mat === 'color' ? hex(part.color) : MATS[part.mat] || [1, 1, 1];
    for (const mirrored of copies(part)) {
      const pos = partGeometry(part, mirrored).getAttribute('position');
      for (let i = 0; i < pos.count; i += 3) {
        const a = [pos.getX(i), pos.getY(i), pos.getZ(i)];
        const b = [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)];
        const c = [pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)];
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (Math.hypot(...n) < 1e-7) continue; // squashed flat (the front of a wedge)
        out[bucket].push({ pts: [a, b, c], color, out: n });
      }
    }
  }
  return out;
}

// A CarModel shape descriptor for a design.
export function customShape(design) {
  const polys = designPolys(design);
  const all = [...polys.paint, ...polys.trim, ...polys.glass, ...polys.head, ...polys.tail].flatMap((p) => p.pts);
  let nose = 2.1;
  let tail = -2.1;
  if (all.length) {
    nose = Math.max(...all.map((v) => v[2]));
    tail = Math.min(...all.map((v) => v[2]));
  }
  const body = polys.paint.length ? polys.paint.flatMap((p) => p.pts) : all;
  // How wide the body is near a point along it (for the number boards on the doors).
  const section = (z) => {
    let hw = 0;
    for (const v of body) if (Math.abs(v[2] - z) < 0.35) hw = Math.max(hw, Math.abs(v[0]));
    if (!hw) hw = 0.8;
    return { hw, bottom: 0.3, belt: 0.8, top: 1.2, rub: 0.47 };
  };
  return {
    id: design.id,
    custom: true,
    build: () => ({
      shell: { paint: polys.paint, cabinTop: [], trim: polys.trim },
      cabin: { paint: [], trim: [], glass: polys.glass },
      detail: { trim: [], tail: polys.tail, head: polys.head },
    }),
    section,
    nose,
    tail,
    plate: { y: 0.45, z: tail - 0.012 },
    pipe: [-0.5, 0.27, tail + 0.1],
    door: 0,
    lamps: [],
  };
}

// A plain car to start from: lower body, cabin, glass, lights, bumpers. Fits the E30's wheels.
export function starterParts() {
  return [
    { type: 'box', p: [0, 0.6, 0], s: [1.62, 0.42, 4.25], r: [0, 0, 0], mat: 'paint' },
    { type: 'taper', p: [0, 1.06, -0.25], s: [1.5, 0.5, 2.3], r: [0, 0, 0], mat: 'paint', t: 0.8 },
    { type: 'wedge', p: [0, 1.06, 1.0], s: [1.44, 0.48, 0.5], r: [0, 0, 0], mat: 'glass' },
    { type: 'box', p: [0.6, 0.66, 2.135], s: [0.34, 0.14, 0.03], r: [0, 0, 0], mat: 'head', mirror: true },
    { type: 'box', p: [0.58, 0.68, -2.135], s: [0.36, 0.14, 0.03], r: [0, 0, 0], mat: 'tail', mirror: true },
    { type: 'box', p: [0, 0.42, 2.15], s: [1.66, 0.18, 0.1], r: [0, 0, 0], mat: 'black' },
    { type: 'box', p: [0, 0.42, -2.15], s: [1.66, 0.18, 0.1], r: [0, 0, 0], mat: 'black' },
  ];
}
