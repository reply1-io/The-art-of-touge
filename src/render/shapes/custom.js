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
    trim: fix([...shell.trim, ...(cabin.trim || []), ...(detail.trim || []), ...(detail.chrome || []), ...(detail.grille || []), ...(detail.kidney || [])]),
    glass: fix(cabin.glass),
    tail: fix([...(detail.tail || []), ...(detail.tailLens || [])]),
    // Round headlamps (E30) with their chrome rings.
    head: (shape.lamps || []).map(([x, y, r]) => disc(x, y, shape.nose + 0.014, r, [0.91, 0.93, 0.94])),
  };
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
// A shape drawn in SKETCH mode: its outline (part.o, [[a, b], ...] in metres about its middle)
// made solid, 1 deep, then turned to face the way it was drawn.
//   side: drawn on the side view (a = forward, b = up), thick across the car
//   top: drawn from above (a = across, b = forward), thick up and down
//   front: drawn from the front (a = across, b = up), thick front to back
// part.bev: rounded edges.
export const SKETCH_VIEWS = ['side', 'top', 'front'];
function sketchGeometry(part) {
  const o = part.o || [];
  const shape = new THREE.Shape(o.map(([a, b]) => new THREE.Vector2(a, b)));
  // Holes cut through it (part.h: outlines like part.o).
  for (const hole of part.h || []) shape.holes.push(new THREE.Path(hole.map(([a, b]) => new THREE.Vector2(a, b))));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    steps: detail(part),
    bevelEnabled: !!part.bev,
    bevelThickness: 0.12,
    bevelSize: 0.025,
    bevelSegments: 2,
  });
  g.deleteAttribute('uv');
  const pos = g.toNonIndexed().getAttribute('position');
  const out = [];
  for (let i = 0; i < pos.count; i++) {
    const a = pos.getX(i);
    const b = pos.getY(i);
    const e = pos.getZ(i) - 0.5;
    out.push(part.view === 'top' ? [a, e, b] : part.view === 'front' ? [a, b, e] : [e, b, a]);
  }
  // Side and top swap two directions over, which turns every face inside out: turn them back.
  if (part.view !== 'front') for (let i = 0; i < out.length; i += 3) [out[i + 1], out[i + 2]] = [out[i + 2], out[i + 1]];
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.Float32BufferAttribute(out.flat(), 3));
  return r;
}

function unitGeometry(part) {
  if (part.type === 'sketch') return sketchGeometry(part);
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
  const key =
    part.type === 'stock'
      ? `stock:${part.model}:${part.piece ?? 'all'}`
      : part.type === 'sketch'
        ? `sketch:${part.view}:${detail(part)}:${part.bev ? 1 : 0}:${JSON.stringify(part.o)}:${JSON.stringify(part.h || [])}`
        : `${part.type}:${part.t ?? ''}:${detail(part)}`;
  if (baseCache.has(key)) return baseCache.get(key);
  const tris = [];
  if (part.type === 'stock') {
    const all = stockTris(part.model);
    if (!all) return { verts: [], faces: [], meta: [], mirror: [] };
    if (part.piece == null) tris.push(...all);
    else for (const t of stockPieces(part.model)[part.piece]?.tris || []) tris.push(all[t]);
  } else {
    const pos = unitGeometry(part).getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) tris.push({ pts: [0, 1, 2].map((k) => [pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)]) });
  }
  const mesh = weld(tris);
  baseCache.set(key, mesh);
  return mesh;
}

// A stock body as triangles, each wound to face out, with what it is (paint, trim, glass, lamps).
const trisCache = new Map();
function stockTris(model) {
  if (trisCache.has(model)) return trisCache.get(model);
  const src = stockPolys(model);
  if (!src) return null;
  const tris = [];
  for (const [bucket, list] of Object.entries(src)) {
    for (const p of list) {
      for (let k = 1; k < p.pts.length - 1; k++) {
        let pts = [p.pts[0], p.pts[k], p.pts[k + 1]];
        const n = normal(pts);
        if (n[0] * p.out[0] + n[1] * p.out[1] + n[2] * p.out[2] < 0) pts = [pts[0], pts[2], pts[1]];
        tris.push({ pts, bucket, color: p.color });
      }
    }
  }
  trisCache.set(model, tris);
  return tris;
}

// A stock body cut into about 50 pieces you can pick, move or delete one by one: its panels,
// trim, glass and lamps each grouped into patches that sit together and face the same way
// (matched left and right), named by where they are.
const PIECES = { paint: 15, trim: 8, glass: 3, tail: 1, head: 1 };
const PIECE_NAMES = { paint: 'Panel', trim: 'Trim', glass: 'Glass', tail: 'Taillight', head: 'Headlight' };
const piecesCache = new Map();
export function stockPieces(model) {
  if (piecesCache.has(model)) return piecesCache.get(model);
  const all = stockTris(model);
  if (!all) return [];
  const pieces = [];
  for (const [bucket, k] of Object.entries(PIECES)) {
    const ids = [];
    all.forEach((t, i) => t.bucket === bucket && ids.push(i));
    if (!ids.length) continue;
    // What to group by: where it sits (folded left onto right) and which way it faces.
    const feat = ids.map((i) => {
      const [a, b, c] = all[i].pts;
      const m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      const n = normal(all[i].pts);
      const len = Math.hypot(...n) || 1;
      const side = m[0] < 0 ? -1 : 1;
      return { m, area: len / 2, f: [Math.abs(m[0]), m[1], m[2] * 0.6, (n[0] / len) * side * 0.35, (n[1] / len) * 0.35, (n[2] / len) * 0.35] };
    });
    const groups = kmeans(feat, Math.min(k, ids.length));
    groups.forEach((members) => {
      if (!members.length) return;
      const mx = members.reduce((s2, j) => s2 + Math.abs(feat[j].m[0]) * feat[j].area, 0) / members.reduce((s2, j) => s2 + feat[j].area, 0);
      // Patches along the middle of the car stay whole; the rest split into left and right.
      const halves = mx < 0.25 ? [members] : [members.filter((j) => feat[j].m[0] >= 0), members.filter((j) => feat[j].m[0] < 0)];
      for (const half of halves) {
        if (!half.length) continue;
        const c = [0, 1, 2].map((a) => half.reduce((s2, j) => s2 + feat[j].m[a], 0) / half.length);
        const where = [c[2] > 1.15 ? 'front' : c[2] < -1.15 ? 'rear' : 'middle', halves.length === 1 ? '' : c[0] > 0 ? 'left' : 'right', c[1] > 1.0 ? 'top' : c[1] < 0.5 ? 'low' : ''].filter(Boolean).join(' ');
        pieces.push({ bucket, tris: half.map((j) => ids[j]), name: `${PIECE_NAMES[bucket]} · ${where}`, c });
      }
    });
  }
  // Number repeated names so each piece can be told apart.
  const seen = {};
  for (const p of pieces) {
    seen[p.name] = (seen[p.name] || 0) + 1;
    if (seen[p.name] > 1) p.name += ` ${seen[p.name]}`;
  }
  piecesCache.set(model, pieces);
  return pieces;
}

// Group points into k groups that sit together (k-means, the same every time).
function kmeans(items, k) {
  const d2 = (a, b) => a.reduce((s2, v, i) => s2 + (v - b[i]) ** 2, 0);
  const centres = [items[0].f];
  while (centres.length < k) {
    let best = 0;
    let bd = -1;
    items.forEach((it, i) => {
      const d = Math.min(...centres.map((c) => d2(it.f, c)));
      if (d > bd) [bd, best] = [d, i];
    });
    centres.push(items[best].f);
  }
  let assign = new Int32Array(items.length);
  for (let iter = 0; iter < 14; iter++) {
    assign = Int32Array.from(items.map((it) => {
      let bi = 0;
      let bd = Infinity;
      centres.forEach((c, i) => {
        const d = d2(it.f, c);
        if (d < bd) [bd, bi] = [d, i];
      });
      return bi;
    }));
    for (let c = 0; c < k; c++) {
      let w = 0;
      const sum = new Array(items[0].f.length).fill(0);
      items.forEach((it, i) => {
        if (assign[i] !== c) return;
        w += it.area;
        it.f.forEach((v, a) => (sum[a] += v * it.area));
      });
      if (w > 0) centres[c] = sum.map((v) => v / w);
    }
  }
  const groups = Array.from({ length: k }, () => []);
  assign.forEach((g, i) => groups[g].push(i));
  return groups;
}

// A whole stock body cut into its pieces, each placed where the body was, keeping its reshaping.
export function splitStock(part) {
  const whole = baseMesh(part);
  const index = new Map(whole.verts.map((v, i) => [KEY(v), i]));
  return stockPieces(part.model).map((pc, k) => {
    const piece = { type: 'stock', model: part.model, piece: k, p: [...part.p], s: [...part.s], r: [...part.r], mat: 'paint' };
    if (part.edits) {
      const edits = {};
      baseMesh(piece).verts.forEach((v, i) => {
        const e = part.edits[index.get(KEY(v))];
        if (e) edits[i] = e;
      });
      if (Object.keys(edits).length) piece.edits = edits;
    }
    return piece;
  });
}

export const pieceName = (part) => (part.type === 'stock' && part.piece != null ? stockPieces(part.model)[part.piece]?.name : null);

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
