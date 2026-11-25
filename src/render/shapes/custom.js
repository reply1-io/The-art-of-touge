// A car body made in the Car Builder: simple shapes (boxes, wedges, tapered boxes, cylinders,
// balls), each painted, trimmed, glazed or lit, turned into the same polygon lists the E30 and
// RX-7 bodies use, so the game drives it exactly like them.
import * as THREE from 'three';
import { GLASS, BLACK, TRIM, CHROME } from './poly.js';

// The game's own car bodies (the E30 and the RX-7), so a build can start from one: a 'stock'
// part is the whole body, which you can move, size and turn, and add your own shapes onto.
// CarModel hands them over (it defines them), which keeps the two files from importing each other.
const STOCK = {};
export function registerStockShapes(shapes) {
  Object.assign(STOCK, shapes);
}
export const STOCK_NAMES = { e30: 'E30 BODY', rx7: 'RX-7 BODY' };

// A stock body's polygons, sorted like a design's, before it is moved: paint, trim, glass, lamps.
const stockCache = new Map();
function stockPolys(model) {
  if (stockCache.has(model)) return stockCache.get(model);
  const shape = STOCK[model];
  if (!shape) return null;
  const { shell, cabin, detail } = shape.build();
  const center = [0, 0.1, 0];
  // Give every polygon its outward direction now, so it still faces out once it is moved.
  const fix = (polys, color) =>
    (polys || []).map((p) => {
      let out = p.out;
      if (!out) {
        const m = p.pts.reduce((s, q) => [s[0] + q[0] / p.pts.length, s[1] + q[1] / p.pts.length, s[2] + q[2] / p.pts.length], [0, 0, 0]);
        out = [m[0] - center[0], m[1] - center[1], m[2] - center[2]];
      }
      return { pts: p.pts, color: color || p.color || [1, 1, 1], out };
    });
  const disc = (x, y, z, r, color) => ({ pts: Array.from({ length: 14 }, (_, k) => [x + Math.cos((k / 14) * Math.PI * 2) * r, y + Math.sin((k / 14) * Math.PI * 2) * r, z]), color, out: [0, 0, 1] });
  const res = {
    paint: fix([...shell.paint, ...(shell.cabinTop || []), ...(cabin.paint || []), ...(detail.paint || [])], [1, 1, 1]),
    trim: fix([...shell.trim, ...(cabin.trim || []), ...(detail.trim || []), ...(detail.chrome || [])]),
    glass: fix(cabin.glass),
    tail: fix(detail.tail),
    // Round headlamps (E30) with their chrome rings.
    head: (shape.lamps || []).map(([x, y, r]) => disc(x, y, shape.nose + 0.014, r, [0.91, 0.93, 0.94])),
  };
  for (const [x, y, r] of shape.lamps || []) res.trim.push(disc(x, y, shape.nose + 0.01, r + 0.012, CHROME));
  // Pop-up headlamps (RX-7): closed, a body-colour lid flush in the bonnet.
  for (const [x0, x1, z0, z1] of shape.popups || []) {
    const y0 = shape.section(z0).belt + 0.004;
    const y1 = shape.section(z1).belt + 0.004;
    res.paint.push({ pts: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1]], color: [1, 1, 1], out: [0, 1, 0] });
  }
  stockCache.set(model, res);
  return res;
}

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

const detail = (part) => Math.max(1, Math.min(4, part.d ?? 2));

// The shape of a part, 1 x 1 x 1 about its centre, before sizing.
function unitGeometry(part) {
  let g;
  switch (part.type) {
    // More detail: more corners to drag (part.d: 1 plain, 2, or 4 per side).
    case 'cyl':
      g = new THREE.CylinderGeometry(0.5, 0.5, 1, 8 + 4 * detail(part), detail(part));
      break;
    case 'ball':
      g = new THREE.IcosahedronGeometry(0.5, Math.min(3, detail(part)));
      break;
    default: {
      const d = detail(part);
      g = new THREE.BoxGeometry(1, 1, 1, d, d, d === 1 ? 1 : d * 2);
    }
  }
  g = g.toNonIndexed();
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + 0.5; // 0 at the bottom, 1 at the top
    if (y <= 0) continue;
    // Wedge: the top slopes down to the front edge (a bonnet, a windscreen, a spoiler).
    // (Every point of the top drops by how far forward it is: a sloped top, with its own corners.)
    if (part.type === 'wedge') pos.setY(i, y * (0.5 - pos.getZ(i)) - 0.5);
    // Taper: the top is narrower and shorter than the bottom (a cabin, a roof).
    if (part.type === 'taper') {
      const t = 1 - (1 - (part.t ?? 0.65)) * y;
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

// ---------- Every part as corners and triangles ----------
// A part's shape is a list of corners (points shared by the faces that meet there) and the
// triangles between them. Dragging a corner moves every face that uses it. The changes are kept
// in part.edits: { cornerIndex: [dx, dy, dz] }, in the part's own unsized space, so they move,
// size and turn with the part.

const KEY = (v) => `${v[0].toFixed(4)},${v[1].toFixed(4)},${v[2].toFixed(4)}`;
function weld(tris) {
  const index = new Map();
  const verts = [];
  const faces = [];
  const meta = [];
  const id = (v) => {
    const k = KEY(v);
    if (!index.has(k)) {
      index.set(k, verts.length);
      verts.push([...v]);
    }
    return index.get(k);
  };
  for (const t of tris) {
    const f = t.pts.map(id);
    if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) continue; // squashed flat
    faces.push(f);
    meta.push({ bucket: t.bucket, color: t.color });
  }
  // Each corner's mirror image across the middle of the car (for editing both sides at once).
  const mirror = verts.map((v) => index.get(KEY([-v[0], v[1], v[2]])) ?? -1);
  return { verts, faces, meta, mirror };
}

const baseCache = new Map();
// The part's corners and triangles before its own edits, in its unsized space (a stock body: in
// car space, where the game puts it).
export function baseMesh(part) {
  const key = part.type === 'stock' ? `stock:${part.model}` : `${part.type}:${part.t ?? ''}:${detail(part)}`;
  if (baseCache.has(key)) return baseCache.get(key);
  const tris = [];
  if (part.type === 'stock') {
    const src = stockPolys(part.model);
    if (!src) return { verts: [], faces: [], meta: [], mirror: [] };
    for (const [bucket, list] of Object.entries(src)) {
      for (const p of list) {
        for (let k = 1; k < p.pts.length - 1; k++) {
          let pts = [p.pts[0], p.pts[k], p.pts[k + 1]];
          // Wind each triangle to face along the polygon's outward direction.
          const n = normal(pts);
          if (n[0] * p.out[0] + n[1] * p.out[1] + n[2] * p.out[2] < 0) pts = [pts[0], pts[2], pts[1]];
          tris.push({ pts, bucket, color: p.color });
        }
      }
    }
  } else {
    const pos = unitGeometry(part).getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) tris.push({ pts: [0, 1, 2].map((k) => [pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)]) });
  }
  const mesh = weld(tris);
  baseCache.set(key, mesh);
  return mesh;
}

function normal([a, b, c]) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
}

// The part's corners with its edits, still in its own space.
export function localCorners(part) {
  const base = baseMesh(part);
  const e = part.edits || {};
  return base.verts.map((v, i) => (e[i] ? [v[0] + e[i][0], v[1] + e[i][1], v[2] + e[i][2]] : v));
}

// The part placed in the car: corners, triangles (wound to face out) and what each one is.
export function partMesh(part, mirrored = false) {
  const base = baseMesh(part);
  const m = partMatrix(part, mirrored);
  const v = new THREE.Vector3();
  const verts = localCorners(part).map((c) => v.set(...c).applyMatrix4(m).toArray());
  const faces = mirrored ? base.faces.map(([a, b, c]) => [a, c, b]) : base.faces;
  return { verts, faces, meta: base.meta };
}

// The part as a mesh-ready geometry in car space, mirrored if asked.
export function partGeometry(part, mirrored = false) {
  const { verts, faces } = partMesh(part, mirrored);
  const pos = [];
  for (const f of faces) for (const k of f) pos.push(...verts[k]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Every copy of a part: itself, and its mirror image across the middle of the car if it has one.
export const copies = (part) => (part.type !== 'stock' && part.mirror && Math.abs(part.p[0]) > 0.005 ? [false, true] : [false]);

// What a triangle of a part is: paint, trim, glass, headlight or taillight, and its colour.
export function triLook(part, meta) {
  if (part.type === 'stock') return { bucket: meta.bucket, color: meta.color || [1, 1, 1] };
  const bucket = part.mat === 'paint' ? 'paint' : part.mat === 'glass' ? 'glass' : part.mat === 'head' ? 'head' : part.mat === 'tail' ? 'tail' : 'trim';
  return { bucket, color: part.mat === 'color' ? hex(part.color) : MATS[part.mat] || [1, 1, 1] };
}

// The design's parts as polygons, sorted the way CarModel wants them.
export function designPolys(design) {
  const out = { paint: [], trim: [], glass: [], head: [], tail: [] };
  for (const part of design.parts) {
    for (const mirrored of copies(part)) {
      const { verts, faces, meta } = partMesh(part, mirrored);
      faces.forEach((f, k) => {
        const pts = f.map((i) => verts[i]);
        const n = normal(pts);
        if (Math.hypot(...n) < 1e-9) return;
        const { bucket, color } = triLook(part, meta[k]);
        out[bucket].push({ pts, color, out: n });
      });
    }
  }
  return out;
}

// A stock part's polygons in place (sorted like a design's).
export function stockPartPolys(part) {
  if (!stockPolys(part.model)) return null;
  return designPolys({ parts: [part] });
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
  // (Each a plain shape you can reshape corner by corner.)
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
