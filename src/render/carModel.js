// Low-poly BMW E30 coupe, built in code from simple shapes with flat colours.
// Body space matches the physics body: +x left, +y up, +z forward; the origin is the physics body
// origin, which rides about 0.62 m above the ground.
import * as THREE from 'three';
import { Cockpit } from './cockpit.js';
import { PLATES, cleanPlate, WHEELS, EXHAUSTS, HEADLIGHTS, TAILLIGHTS, wheelSetup, TUNABLE_DEFAULTS } from '../config.js';

const GROUND = -0.62; // ground level in body space at static ride height

const WHITE = [0.94, 0.93, 0.9]; // Alpine White
const BLACK = [0.06, 0.06, 0.07];
const TRIM = [0.13, 0.13, 0.14];
const GLASS = [0.16, 0.2, 0.25];
const CHROME = [0.72, 0.74, 0.77];
const UNDER = [0.04, 0.04, 0.05];
const AMBER = [0.95, 0.55, 0.12];

// Builds a flat-shaded, vertex-coloured mesh from convex polygons. Each polygon is wound to face
// away from `center`, or along its own `out` hint.
function polyGeometry(polys, center = [0, 0.1, 0]) {
  const pos = [];
  const col = [];
  for (const p of polys) {
    let pts = p.pts;
    const [a, b, c] = pts;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    let out = p.out;
    if (!out) {
      const m = pts.reduce((s, q) => [s[0] + q[0] / pts.length, s[1] + q[1] / pts.length, s[2] + q[2] / pts.length], [0, 0, 0]);
      out = [m[0] - center[0], m[1] - center[1], m[2] - center[2]];
    }
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) pts = [...pts].reverse();
    const color = p.color || WHITE;
    for (let k = 1; k < pts.length - 1; k++) {
      for (const v of [pts[0], pts[k], pts[k + 1]]) {
        pos.push(v[0], v[1], v[2]);
        col.push(color[0], color[1], color[2]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

const mirror = (p) => [-p[0], p[1], p[2]];
const both = (poly) => [poly, { ...poly, pts: poly.pts.map(mirror), out: poly.out && [-poly.out[0], poly.out[1], poly.out[2]] }];

function lerpTable(table, z) {
  if (z >= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (z >= table[i][0]) {
      const [z0, v0] = table[i - 1];
      const [z1, v1] = table[i];
      return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
    }
  }
  return table[table.length - 1][1];
}

// ---------- Body profile (heights above the ground) ----------
const FRONT_AXLE = 1.28;
const REAR_AXLE = -1.29;
const WHEEL_R = 0.305;
const ARCH_R = 0.37;
const NOSE = 2.13;
const TAIL = -2.17;

const HALF_WIDTH = [
  [2.13, 0.79],
  [2.1, 0.81],
  [1.95, 0.82],
  [-1.95, 0.82],
  [-2.12, 0.81],
  [-2.17, 0.79],
];
const BOTTOM = [
  [2.13, 0.5],
  [2.11, 0.3],
  [1.95, 0.22],
  [-1.9, 0.21],
  [-2.1, 0.3],
  [-2.17, 0.5],
];
// Top of the sides / shoulder line: wings along the bonnet, window line, boot.
const BELT = [
  [2.13, 0.79],
  [2.1, 0.82],
  [1.9, 0.84],
  [0.78, 0.85],
  [0.0, 0.855],
  [-1.5, 0.86],
  [-2.12, 0.86],
  [-2.17, 0.82],
];
// Centreline: bonnet, (cabin floor under the glass), boot lid. A level, straight line from the
// nose to the tail, so the body stands the same height over the front and rear wheels.
const TOP = [
  [2.13, 0.8],
  [2.1, 0.83],
  [1.9, 0.862],
  [0.78, 0.885],
  [0.0, 0.905],
  [-1.55, 0.9],
  [-2.12, 0.9],
  [-2.17, 0.86],
];

function section(z) {
  let bottom = lerpTable(BOTTOM, z);
  for (const zc of [FRONT_AXLE, REAR_AXLE]) {
    const dz = z - zc;
    if (Math.abs(dz) < ARCH_R) bottom = Math.max(bottom, WHEEL_R + Math.sqrt(ARCH_R * ARCH_R - dz * dz));
  }
  const belt = lerpTable(BELT, z);
  return { hw: lerpTable(HALF_WIDTH, z), bottom, belt, top: lerpTable(TOP, z), rub: Math.max(bottom + 0.02, 0.47) };
}

function ring(z) {
  const s = section(z);
  return [
    [s.hw * 0.95, s.bottom, z],
    [s.hw, Math.min(s.rub, s.belt - 0.06), z],
    [s.hw, s.belt - 0.05, z],
    [s.hw * 0.97, s.belt, z],
    [s.hw * 0.55, s.top - 0.004, z],
    [0, s.top, z],
  ];
}

function bodyPolys() {
  const paint = [];
  const trim = [];
  const zs = new Set([NOSE, TAIL]);
  for (const t of [HALF_WIDTH, BOTTOM, BELT]) for (const [z] of t) zs.add(z);
  for (let z = NOSE; z > TAIL; z -= 0.12) zs.add(+z.toFixed(3));
  for (const zc of [FRONT_AXLE, REAR_AXLE]) for (let k = 0; k <= 12; k++) zs.add(+(zc - ARCH_R + (2 * ARCH_R * k) / 12).toFixed(3));
  const stations = [...zs].filter((z) => z <= NOSE && z >= TAIL).sort((a, b) => b - a);
  const rings = stations.map((z) => {
    const l = ring(z);
    return [...l, ...l.slice(0, 5).reverse().map(mirror)];
  });
  const cabinTop = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    // The shell's top surface under the glasshouse is hidden in the in-car view.
    const inCabin = stations[i] <= 0.8 && stations[i + 1] >= -1.44;
    for (let k = 0; k < a.length - 1; k++) (inCabin && k >= 3 && k <= 6 ? cabinTop : paint).push({ pts: [a[k], a[k + 1], b[k + 1], b[k]] });
    trim.push({ pts: [a[0], a[a.length - 1], b[b.length - 1], b[0]], color: UNDER, out: [0, -1, 0] });
    // Black rub strip along the doors (skipped over the wheel arches).
    const s0 = section(stations[i]);
    const s1 = section(stations[i + 1]);
    if (s0.bottom < 0.4 && s1.bottom < 0.4) {
      for (const p of both({
        pts: [
          [s0.hw + 0.006, 0.46, stations[i]],
          [s0.hw + 0.006, 0.5, stations[i]],
          [s1.hw + 0.006, 0.5, stations[i + 1]],
          [s1.hw + 0.006, 0.46, stations[i + 1]],
        ],
        color: TRIM,
        out: [1, 0, 0],
      })) {
        trim.push(p);
      }
    }
  }
  for (const [r, dir] of [
    [rings[0], 1],
    [rings[rings.length - 1], -1],
  ]) {
    const c = [0, r.reduce((s, p) => s + p[1] / r.length, 0), r[0][2]];
    const closed = [...r, r[0]];
    for (let k = 0; k < closed.length - 1; k++) paint.push({ pts: [c, closed[k], closed[k + 1]], out: [0, 0, dir] });
  }
  // Wheel-well liners.
  for (const zc of [FRONT_AXLE, REAR_AXLE]) {
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const a = (Math.PI * k) / 12;
      pts.push([0, WHEEL_R + Math.sin(a) * ARCH_R, zc + Math.cos(a) * ARCH_R]);
    }
    pts.push([0, 0.15, zc - ARCH_R], [0, 0.15, zc + ARCH_R]);
    for (const side of [1, -1]) trim.push({ pts: pts.map((p) => [side * 0.6, p[1], p[2]]), color: UNDER, out: [side, 0, 0] });
  }
  return { paint, trim, cabinTop };
}

// ---------- Greenhouse: upright E30 glasshouse with thin pillars ----------
const ROOF_Y = 1.37;
const ROOF_HW = 0.6;
const SCREEN_BASE_Z = 0.78;
const SCREEN_TOP_Z = 0.02;
const ROOF_REAR_Z = -1.02;

function cabinTop(z) {
  if (z >= SCREEN_TOP_Z) {
    const t = (SCREEN_BASE_Z - z) / (SCREEN_BASE_Z - SCREEN_TOP_Z);
    const base = section(SCREEN_BASE_Z).belt;
    return { y: base + t * (ROOF_Y - base), hw: 0.7 + (ROOF_HW - 0.7) * t };
  }
  return { y: ROOF_Y, hw: ROOF_HW };
}

function greenhousePolys() {
  const paint = [];
  const glass = [];
  const trim = [];
  const zs = [0.78, 0.55, 0.3, 0.02, -0.46, -0.52, -0.78, -1.02];
  const rings = zs.map((z) => {
    const s = section(z);
    const t = cabinTop(z);
    return { z, lb: [s.hw * 0.96, s.belt, z], lt: [t.hw, t.y, z] };
  });
  const off = (p, dx, dy = 0) => [p[0] + dx, p[1] + dy, p[2]];
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    const mid = (a.z + b.z) / 2;
    const screen = mid > SCREEN_TOP_Z;
    const pillar = mid < -0.46 && mid > -0.52; // B-pillar
    for (const p of both({ pts: [a.lb, a.lt, b.lt, b.lb], color: pillar ? BLACK : GLASS })) (pillar ? trim : glass).push(p);
    const top = { pts: [a.lt, mirror(a.lt), mirror(b.lt), b.lt], color: screen ? GLASS : WHITE, out: [0, 1, screen ? 0.8 : 0] };
    (screen ? glass : paint).push(top);
    // Black window frame along the roof edge, and black A-pillars.
    for (const p of both({ pts: [a.lt, b.lt, off(b.lt, 0.005, -0.035), off(a.lt, 0.005, -0.035)], color: BLACK, out: [1, 0.3, 0] })) trim.push(p);
    if (screen) for (const p of both({ pts: [off(a.lt, 0, 0.004), off(b.lt, 0, 0.004), off(b.lt, -0.06, 0.004), off(a.lt, -0.06, 0.004)], color: BLACK, out: [0, 1, 0.8] })) trim.push(p);
    for (const p of both({ pts: [a.lb, off(a.lb, -0.01, 0.022), off(b.lb, -0.01, 0.022), b.lb], color: BLACK, out: [1, 0.2, 0] })) trim.push(p);
  }
  // C-pillar and rear window.
  const r = rings[rings.length - 1];
  const sC = section(-1.42);
  const cBase = [sC.hw * 0.96, sC.belt, -1.42];
  const rwBottom = [0.66, section(-1.58).top, -1.58];
  for (const p of both({ pts: [r.lb, r.lt, cBase], out: [1, 0.2, 0] })) paint.push(p);
  for (const p of both({ pts: [r.lt, rwBottom, cBase], out: [0.4, 1, -0.4] })) paint.push(p);
  glass.push({ pts: [[r.lt[0] - 0.02, ROOF_Y - 0.01, ROOF_REAR_Z], [-(r.lt[0] - 0.02), ROOF_Y - 0.01, ROOF_REAR_Z], mirror(rwBottom), rwBottom], color: GLASS, out: [0, 0.6, -1] });
  return { paint, glass, trim };
}

// ---------- Details: nose, tail, bumpers, mirrors, shoulder line ----------
const RED = [0.85, 0.08, 0.08];
const LENS_WHITE = [0.85, 0.85, 0.82];

// Round lamps for the nose: [x, y, radius]. The E30 has two per side in a black surround, the outer
// (dipped) lamp slightly larger than the inner (main beam).
export const HEADLAMPS = [
  [0.6, 0.65, 0.066],
  [0.405, 0.65, 0.06],
  [-0.405, 0.65, 0.06],
  [-0.6, 0.65, 0.066],
];

function detailPolys() {
  const trim = [];
  const chrome = [];
  const tail = [];
  const zn = NOSE + 0.006;
  const front = (x0, x1, y0, y1, z, color) => trim.push({ pts: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], color, out: [0, 0, 1] });
  // One black band across the whole nose: both pairs of headlamps and the grille sit in it.
  front(0.785, -0.785, 0.565, 0.74, zn, BLACK);
  // Twin kidneys: chrome frames standing slightly proud, black slats inside.
  for (const x of [0.075, -0.075]) {
    const z = zn + 0.02;
    chrome.push({ pts: [[x + 0.07, 0.572, z], [x + 0.066, 0.738, z], [x - 0.066, 0.738, z], [x - 0.07, 0.572, z]], color: CHROME, out: [0, 0, 1] });
    trim.push({ pts: [[x + 0.056, 0.584, z + 0.004], [x + 0.052, 0.726, z + 0.004], [x - 0.052, 0.726, z + 0.004], [x - 0.056, 0.584, z + 0.004]], color: BLACK, out: [0, 0, 1] });
    for (let k = 0; k < 4; k++) {
      const sx = x - 0.036 + k * 0.024;
      chrome.push({ pts: [[sx + 0.004, 0.59, z + 0.008], [sx + 0.004, 0.72, z + 0.008], [sx - 0.004, 0.72, z + 0.008], [sx - 0.004, 0.59, z + 0.008]], color: CHROME, out: [0, 0, 1] });
    }
    // Sides of the kidney frame so it reads as a raised part.
    for (const sgn of [1, -1]) chrome.push({ pts: [[x + sgn * 0.07, 0.572, zn], [x + sgn * 0.07, 0.572, z], [x + sgn * 0.066, 0.738, z], [x + sgn * 0.066, 0.738, zn]], color: CHROME, out: [sgn, 0, 0] });
  }
  // Chrome-style bumpers with a black rubber strip, standing proud of the body.
  // Bumpers are body colour (painted with the car), with a black rubber strip along the face.
  const dam = [];
  const bumper = (z0, z1, y0, y1, hw) => {
    const b = [];
    const d = Math.sign(z1);
    const face = (pts, out) => dam.push({ pts, out });
    face([[hw, y0, z1], [hw, y1, z1], [-hw, y1, z1], [-hw, y0, z1]], [0, 0, d]);
    face([[hw, y1, z0], [hw, y1, z1], [-hw, y1, z1], [-hw, y1, z0]], [0, 1, 0]);
    face([[hw, y0, z0], [hw, y0, z1], [-hw, y0, z1], [-hw, y0, z0]], [0, -1, 0]);
    face([[hw, y0, z0], [hw, y1, z0], [hw, y1, z1], [hw, y0, z1]], [1, 0, 0]);
    face([[-hw, y0, z0], [-hw, y1, z0], [-hw, y1, z1], [-hw, y0, z1]], [-1, 0, 0]);
    const m = (y0 + y1) / 2;
    const half = Math.min(0.03, (y1 - y0) * 0.22);
    b.push({ pts: [[hw, m - half, z1 + d * 0.004], [hw, m + half, z1 + d * 0.004], [-hw, m + half, z1 + d * 0.004], [-hw, m - half, z1 + d * 0.004]], color: TRIM, out: [0, 0, d] });
    return b;
  };
  chrome.push(...bumper(NOSE - 0.04, NOSE + 0.08, 0.445, 0.525, 0.835));
  chrome.push(...bumper(TAIL + 0.06, TAIL - 0.09, 0.37, 0.55, 0.835));
  // Amber indicators set into the front bumper corners.
  for (const side of [1, -1]) {
    trim.push({ pts: [[side * 0.6, 0.462, NOSE + 0.086], [side * 0.78, 0.462, NOSE + 0.086], [side * 0.78, 0.508, NOSE + 0.086], [side * 0.6, 0.508, NOSE + 0.086]], color: AMBER, out: [0, 0, 1] });
  }
  // Body-coloured air dam under the bumper, with dark vents and a black lip along the bottom.
  const zd = NOSE + 0.05;
  dam.push({ pts: [[0.81, 0.25, zd], [0.81, 0.445, NOSE + 0.03], [-0.81, 0.445, NOSE + 0.03], [-0.81, 0.25, zd]], out: [0, -0.15, 1] });
  for (const side of [1, -1]) dam.push({ pts: [[side * 0.81, 0.25, zd], [side * 0.81, 0.445, NOSE + 0.03], [side * 0.81, 0.445, NOSE - 0.08], [side * 0.81, 0.25, NOSE - 0.08]], out: [side, 0, 0] });
  for (const [x0, x1] of [[0.62, 0.36], [0.2, -0.2], [-0.36, -0.62]]) {
    trim.push({ pts: [[x0, 0.3, zd + 0.004], [x0, 0.36, zd - 0.0], [x1, 0.36, zd - 0.0], [x1, 0.3, zd + 0.004]], color: BLACK, out: [0, -0.15, 1] });
  }
  trim.push({ pts: [[0.8, 0.235, zd + 0.01], [0.8, 0.258, zd + 0.005], [-0.8, 0.258, zd + 0.005], [-0.8, 0.235, zd + 0.01]], color: BLACK, out: [0, -0.3, 1] });

  // Facelift tail lamps: wide banded units, red over amber and white, with dark ribs.
  const zt = TAIL - 0.006;
  const rear = (x0, x1, y0, y1, color, list = trim) => list.push({ pts: [[x0, y0, zt - 0.004], [x1, y0, zt - 0.004], [x1, y1, zt - 0.004], [x0, y1, zt - 0.004]], color, out: [0, 0, -1] });
  // A black surround behind each lamp only; the panel between them is body colour.
  for (const side of [1, -1]) {
    // Set just behind the lamp lenses so the two never fight over the same depth.
    const [x0, x1] = [side * 0.79, side * 0.28];
    trim.push({ pts: [[x0, 0.59, zt - 0.001], [x1, 0.59, zt - 0.001], [x1, 0.81, zt - 0.001], [x0, 0.81, zt - 0.001]], color: BLACK, out: [0, 0, -1] });
  }
  for (const side of [1, -1]) {
    // Big wraparound-style lamps: an amber block at the outer end, then a red field split by a
    // dark grid of ribs.
    const o = side * 0.775;
    const a = side * 0.69;
    const i = side * 0.29;
    rear(o, a, 0.6, 0.8, AMBER);
    rear(a, i, 0.6, 0.8, RED, tail);
    const ribs = [];
    for (const y of [0.667, 0.733]) ribs.push([a, i, y - 0.006, y + 0.006]);
    for (let k = 1; k < 4; k++) {
      const x = a + ((i - a) * k) / 4;
      ribs.push([x - 0.006, x + 0.006, 0.6, 0.8]);
    }
    for (const [x0, x1, y0, y1] of ribs) trim.push({ pts: [[x0, y0, zt - 0.007], [x1, y0, zt - 0.007], [x1, y1, zt - 0.007], [x0, y1, zt - 0.007]], color: BLACK, out: [0, 0, -1] });
  }

  // The "Sicke": the sharp shoulder crease that runs nose to tail just below the window line.
  for (let z = NOSE - 0.05; z > TAIL + 0.05; z -= 0.12) {
    const z1 = Math.max(TAIL + 0.05, z - 0.12);
    const s0 = section(z);
    const s1 = section(z1);
    const y0 = s0.belt - 0.085;
    const y1 = s1.belt - 0.085;
    for (const p of both({ pts: [[s0.hw + 0.004, y0, z], [s0.hw + 0.004, y0 + 0.012, z], [s1.hw + 0.004, y1 + 0.012, z1], [s1.hw + 0.004, y1, z1]], color: [0.62, 0.62, 0.6], out: [1, 0, 0] })) trim.push(p);
  }
  // Door handles and front wing side repeaters.
  for (const side of [1, -1]) {
    trim.push({ pts: [[side * 0.825, 0.79, -0.25], [side * 0.825, 0.81, -0.25], [side * 0.825, 0.81, -0.38], [side * 0.825, 0.79, -0.38]], color: BLACK, out: [side, 0, 0] });
    trim.push({ pts: [[side * 0.824, 0.66, 1.72], [side * 0.824, 0.69, 1.72], [side * 0.824, 0.69, 1.64], [side * 0.824, 0.66, 1.64]], color: AMBER, out: [side, 0, 0] });
  }
  // Door mirrors at the front corner of the door glass.
  for (const side of [1, -1]) {
    const x0 = side * 0.79;
    const x1 = side * 0.95;
    const box = [
      [[x0, 0.9, 0.7], [x1, 0.91, 0.68], [x1, 1.0, 0.68], [x0, 1.0, 0.7]],
      [[x0, 0.9, 0.6], [x1, 0.91, 0.6], [x1, 1.0, 0.6], [x0, 1.0, 0.6]],
      [[x1, 0.91, 0.68], [x1, 0.91, 0.6], [x1, 1.0, 0.6], [x1, 1.0, 0.68]],
      [[x0, 1.0, 0.7], [x1, 1.0, 0.68], [x1, 1.0, 0.6], [x0, 1.0, 0.6]],
    ];
    for (const pts of box) trim.push({ pts, color: BLACK });
  }
  return { trim, chrome, tail, paint: dam };
}

// ---------- Wheels: rim face textures per style ----------
const faceCache = new Map();
function rimTexture(styleId) {
  if (faceCache.has(styleId)) return faceCache.get(styleId);
  const st = WHEELS[styleId] || WHEELS.bbs;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const disc = (r, fill) => {
    g.fillStyle = fill;
    g.beginPath();
    g.arc(64, 64, r, 0, Math.PI * 2);
    g.fill();
  };
  disc(64, st.lip); // polished lip
  disc(54, st.dish);
  if (st.spokes === 'mesh') {
    // Cross-spoke mesh: pairs of angled spokes that form diamonds.
    g.strokeStyle = st.face;
    g.lineWidth = 4;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      for (const d of [0.32, -0.32]) {
        g.beginPath();
        g.moveTo(64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14);
        g.lineTo(64 + Math.cos(a + d) * 54, 64 + Math.sin(a + d) * 54);
        g.stroke();
      }
    }
    disc(15, st.face);
  } else if (st.spokes === 'six') {
    // Six straight, wide spokes.
    g.fillStyle = st.face;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.save();
      g.translate(64, 64);
      g.rotate(a);
      g.beginPath();
      g.moveTo(-6, 0);
      g.lineTo(-9, 54);
      g.lineTo(9, 54);
      g.lineTo(6, 0);
      g.fill();
      g.restore();
    }
    disc(18, st.face);
  } else {
    // Steel wheel: plain dish with a ring of vent holes and a small cap.
    disc(54, st.face);
    g.fillStyle = '#060607';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.beginPath();
      g.ellipse(64 + Math.cos(a) * 36, 64 + Math.sin(a) * 36, 7, 5, a, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = '#2e2f33';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(64, 64, 24, 0, Math.PI * 2);
    g.stroke();
    disc(12, '#3a3b40');
  }
  disc(6, '#2b2c30');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  faceCache.set(styleId, t);
  return t;
}

// One wheel: tyre tread, sidewalls between the rim and the tread, the rim face and the inner side.
// Built facing +x (outward for a left wheel).
function makeWheel(ws, styleId, tyreMat, wallMat) {
  const group = new THREE.Group();
  const R = ws.radius;
  const r = ws.rimRadius + 0.012;
  const half = ws.width / 2000; // tread
  const rimHalf = ws.rimWidth / 2000; // rim lip (wider than the tread when stretched)
  const tread = new THREE.CylinderGeometry(R, R, half * 2, 20, 1, true);
  tread.rotateZ(Math.PI / 2);
  group.add(new THREE.Mesh(tread, tyreMat));
  // Sidewalls: from the rim lip out to the tread edge. Flat on a normal tyre; on a stretched one
  // they angle inward, so the rim lip stands proud of the tyre.
  for (const sgn of [1, -1]) {
    const wall = new THREE.LatheGeometry([new THREE.Vector2(r, sgn * rimHalf), new THREE.Vector2(R, sgn * half)], 20);
    wall.rotateZ(-Math.PI / 2);
    group.add(new THREE.Mesh(wall, wallMat));
  }
  const face = new THREE.CircleGeometry(r, 20);
  face.rotateY(Math.PI / 2);
  const rim = new THREE.Mesh(face, new THREE.MeshLambertMaterial({ map: rimTexture(styleId) }));
  rim.position.x = ws.stretched ? rimHalf + 0.004 : half - 0.02; // inside the sidewall, or proud when stretched
  group.add(rim);
  const back = new THREE.Mesh(new THREE.CircleGeometry(R, 20).rotateY(-Math.PI / 2), tyreMat);
  back.position.x = -Math.max(half, rimHalf);
  group.add(back);
  return group;
}

export class CarModel {
  constructor(spec) {
    this.spec = spec;
    this.root = new THREE.Group();
    const body = new THREE.Group();
    body.position.y = GROUND;
    this.root.add(body);

    const flat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const glassMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x05070a });
    this.headMat = new THREE.MeshLambertMaterial({ color: 0xe8ecf0, emissive: 0x000000, flatShading: true });
    this.tailMat = new THREE.MeshLambertMaterial({ color: 0xd0141c, emissive: 0x000000, flatShading: true });

    const shell = bodyPolys();
    const cabin = greenhousePolys();
    const detail = detailPolys();
    // Painted panels get their own material so the paint colour can change.
    const white = (polys) => polys.map((p) => ({ ...p, color: [1, 1, 1] }));
    this.paintMat = new THREE.MeshLambertMaterial({ color: 0xefeee6, vertexColors: true, flatShading: true });
    body.add(new THREE.Mesh(polyGeometry(white([...shell.paint, ...cabin.paint, ...detail.paint])), this.paintMat));
    this.cabinTop = new THREE.Mesh(polyGeometry(white(shell.cabinTop)), this.paintMat);
    body.add(this.cabinTop);
    body.add(new THREE.Mesh(polyGeometry([...shell.trim, ...cabin.trim, ...detail.trim, ...detail.chrome]), flat));
    this.body = body;
    this.numberBoards = new THREE.Group();
    body.add(this.numberBoards);
    // Licence plate between the tail lamps (texture drawn from the shop settings).
    this.plateCanvas = document.createElement('canvas');
    this.plateCanvas.width = 256;
    this.plateCanvas.height = 128;
    this.plateTex = new THREE.CanvasTexture(this.plateCanvas);
    this.plateTex.colorSpace = THREE.SRGBColorSpace;
    this.plateTex.anisotropy = 4;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.22), new THREE.MeshLambertMaterial({ map: this.plateTex }));
    plate.position.set(0, 0.7, TAIL - 0.014);
    plate.rotation.y = Math.PI;
    body.add(plate);
    this.glass = new THREE.Mesh(polyGeometry(cabin.glass), glassMat);
    body.add(this.glass);
    this.shellMats = [this.paintMat, flat];
    this.cockpit = new Cockpit();
    body.add(this.cockpit.root);
    body.add(new THREE.Mesh(polyGeometry(detail.tail), this.tailMat));
    // Round headlamps with chrome rings.
    const ringMat = new THREE.MeshLambertMaterial({ color: 0xb9bcc2 });
    for (const [x, y, r] of HEADLAMPS) {
      const ring = new THREE.Mesh(new THREE.CircleGeometry(r + 0.012, 14), ringMat);
      ring.position.set(x, y, NOSE + 0.01);
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(r, 14), this.headMat);
      lamp.position.set(x, y, NOSE + 0.014);
      body.add(ring, lamp);
    }

    this.tyreMat = new THREE.MeshLambertMaterial({ color: 0x151517 });
    this.wallMat = new THREE.MeshLambertMaterial({ color: 0x1f1f22, side: THREE.DoubleSide });
    this.wheels = [];
    for (let i = 0; i < 4; i++) {
      const steer = new THREE.Group();
      const camber = new THREE.Group();
      steer.add(camber);
      this.root.add(steer);
      this.wheels.push({ steer, camber, spin: null, side: i % 2 === 0 ? 1 : -1, front: i < 2 });
    }
    // Exhaust tailpipe under the right of the rear bumper, and the flame that can shoot from it.
    this.pipeMat = new THREE.MeshLambertMaterial({ color: 0x9a9da3 });
    this.pipe = new THREE.Group();
    this.pipe.position.set(-0.52, 0.27, TAIL + 0.1); // body group coordinates: height above the ground
    body.add(this.pipe);
    this.flameGroup = new THREE.Group();
    const outer = new THREE.ConeGeometry(1, 1, 10, 1, true);
    outer.rotateX(-Math.PI / 2);
    outer.translate(0, 0, -0.5);
    this.flameOuter = new THREE.Mesh(outer, new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.flameInner = new THREE.Mesh(outer, new THREE.MeshBasicMaterial({ color: 0x7ab8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.flameGroup.add(this.flameOuter, this.flameInner);
    this.flameGroup.visible = false;
    body.add(this.flameGroup);
    this.flameLife = 0;
    this.flameMax = 0;
    this.applySetup(TUNABLE_DEFAULTS);
  }

  // A short burst of flame from the tailpipe (race exhaust).
  flame(strength = 1) {
    this.flameLife = Math.max(this.flameLife, 0.09 + 0.08 * strength);
    this.flameMax = Math.max(this.flameMax * (this.flameLife > 0 ? 1 : 0), strength);
  }

  // Animate the flame: flickers, then shrinks away.
  updateFx(dt) {
    if (this.flameLife <= 0) {
      this.flameGroup.visible = false;
      this.flameMax = 0;
      return;
    }
    this.flameLife -= dt;
    const k = Math.max(0, Math.min(1, this.flameLife / 0.12)) * this.flameMax;
    const r = this.tipRadius * (1.1 + Math.random() * 0.5);
    const len = (0.18 + Math.random() * 0.22) * (0.5 + k);
    this.flameGroup.visible = k > 0.02;
    this.flameOuter.scale.set(r * 1.5, r * 1.5, len);
    this.flameInner.scale.set(r * 0.8, r * 0.8, len * 0.45);
    this.flameOuter.material.opacity = 0.5 + 0.4 * k;
  }

  #buildPipe(type) {
    const ex = EXHAUSTS[type] || EXHAUSTS.stock;
    this.tipRadius = ex.tip;
    this.pipe.clear();
    const len = type === 'stock' ? 0.16 : 0.22;
    const tube = new THREE.CylinderGeometry(ex.tip, ex.tip, len, 12, 1, true);
    tube.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(tube, new THREE.MeshLambertMaterial({ color: type === 'race' ? 0x8a6a4a : 0x9a9da3, side: THREE.DoubleSide }));
    m.position.z = -len / 2 + 0.06;
    const inside = new THREE.Mesh(new THREE.CircleGeometry(ex.tip * 0.92, 12), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
    inside.rotation.y = Math.PI;
    inside.position.z = -len + 0.07;
    this.pipe.add(m, inside);
    this.flameGroup.position.set(this.pipe.position.x, this.pipe.position.y, this.pipe.position.z - len + 0.06);
    this.exhaustType = type;
  }

  // Rebuild the wheels for a tuning setup: rim style and size, tyre sidewall and camber.
  applySetup(tune) {
    this.#applyLooks(tune);
    if (this.exhaustType !== (tune.exhaust || 'stock')) this.#buildPipe(tune.exhaust || 'stock');
    const ws = wheelSetup(tune);
    const key = `${tune.wheel}|${ws.rim}|${ws.profile}|${ws.stretched}`;
    for (const w of this.wheels) {
      if (this.wheelKey !== key) {
        if (w.spin) {
          w.camber.remove(w.spin);
          w.spin.traverse((o) => o.geometry?.dispose());
        }
        w.spin = makeWheel(ws, tune.wheel, this.tyreMat, this.wallMat);
        if (w.side < 0) w.spin.scale.x = -1; // right-hand wheels: rim faces outward
        w.camber.add(w.spin);
      }
      // Wider tyres stick out a little; negative camber tilts the tops in.
      w.spin.position.x = w.side * ((ws.rimWidth - 195) / 2000);
      const deg = w.front ? tune.camberFront ?? 1 : tune.camberRear ?? 0.5;
      w.camber.rotation.z = (w.side * deg * Math.PI) / 180;
    }
    this.wheelKey = key;
  }

  setLights(on, braking) {
    const head = (HEADLIGHTS[this.headColor] || HEADLIGHTS.white)[1];
    this.headMat.emissive.setHex(on ? head : 0x000000);
    this.tailMat.emissive.setHex(braking ? 0xff1a1a : on ? 0x550000 : 0x000000);
  }

  // In-car view: show the cockpit, take the glass out so you can see through it, and draw the
  // inside faces of the shell (pillars, roof edges).
  setInterior(on) {
    this.cockpit.root.visible = on;
    this.glass.visible = !on;
    this.cabinTop.visible = !on;
    for (const m of this.shellMats) {
      const side = on ? THREE.DoubleSide : THREE.FrontSide;
      if (m.side !== side) {
        m.side = side;
        m.needsUpdate = true;
      }
    }
  }

  // ---------- Looks from the tuning shop: paint, body kit, light colours, number boards ----------
  #applyLooks(t) {
    this.cockpit.setSeats(t.seats === 'bucket' ? 'bucket' : 'stock');
    this.paintMat.color.set(t.paint || '#efeee6');
    this.headColor = t.headlights || 'white';
    const head = (HEADLIGHTS[this.headColor] || HEADLIGHTS.white)[1];
    this.headMat.color.setHex(head).lerp(new THREE.Color(0xe8ecf0), 0.35);
    this.tailMat.color.setHex((TAILLIGHTS[t.taillights] || TAILLIGHTS.red)[1]);
    const plateKey = `${t.plateStyle}|${t.plateText}`;
    if (this.plateKey !== plateKey) {
      this.plateKey = plateKey;
      this.#drawPlate(t);
    }
    const numKey = `${t.numbers}|${t.number}|${t.numberW}|${t.numberH}`;
    if (this.numKey !== numKey) {
      this.numKey = numKey;
      this.#buildNumbers(t);
    }
  }

  #drawPlate(t) {
    const st = PLATES[t.plateStyle] || PLATES.white;
    const c = this.plateCanvas;
    const g = c.getContext('2d');
    const W = c.width;
    const H = c.height;
    g.fillStyle = st.bg;
    g.fillRect(0, 0, W, H);
    // Pressed rim and the two bolts at the top, like a real plate.
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 6;
    g.strokeRect(5, 5, W - 10, H - 10);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (const x of [W * 0.22, W * 0.78]) {
      g.beginPath();
      g.arc(x, 18, 6, 0, Math.PI * 2);
      g.fill();
    }
    if (st.slash) {
      // A red bar from corner to corner.
      g.strokeStyle = st.slash;
      g.lineWidth = 16;
      g.beginPath();
      g.moveTo(8, H - 8);
      g.lineTo(W - 8, 8);
      g.stroke();
    }
    const text = cleanPlate(t.plateText) || ' ';
    g.fillStyle = st.ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 82;
    g.font = `700 ${size}px 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif`;
    const fit = W - 30;
    const wText = g.measureText(text).width;
    if (wText > fit) size *= fit / wText;
    g.font = `700 ${size}px 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif`;
    g.fillText(text, W / 2, H / 2 + 8);
    this.plateTex.needsUpdate = true;
  }

  // Race number boards on both doors: a white square with a black number, size set in the shop.
  #buildNumbers(t) {
    this.numberBoards.traverse((o) => {
      o.geometry?.dispose();
      o.material?.map?.dispose();
    });
    this.numberBoards.clear();
    if (!t.numbers) return;
    const w = Math.max(0.15, Math.min(0.8, t.numberW ?? 0.42));
    const h = Math.max(0.15, Math.min(0.36, t.numberH ?? 0.3));
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = Math.round((128 * h) / w);
    const g = c.getContext('2d');
    g.fillStyle = '#f4f4ef';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const label = String(Math.max(0, Math.min(999, Math.round(t.number ?? 18))));
    const size = Math.min(c.height * 0.82, (c.width * 1.5) / Math.max(1, label.length));
    g.font = `900 ${size}px Impact, 'Arial Black', sans-serif`;
    g.fillText(label, c.width / 2, c.height / 2 + size * 0.04);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2 });
    // Centre of the door, between the rub strip and the shoulder crease.
    const y = 0.47 + h / 2;
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(side * (section(-0.3).hw + 0.012), y, -0.3);
      m.rotation.y = side * (Math.PI / 2);
      this.numberBoards.add(m);
    }
  }

  // Place the wheels from the simulation: suspension travel, steering and spin.
  syncWheels(vehicle) {
    const s = this.spec;
    for (let i = 0; i < 4; i++) {
      const w = vehicle.wheels[i];
      const m = this.wheels[i];
      m.steer.position.set(w.x, (vehicle.mountY ?? s.wheelMountY) - s.suspensionRest + w.compression, w.z);
      m.steer.rotation.set(0, w.steer, 0);
      m.spin.rotation.x = w.angle;
    }
  }
}
