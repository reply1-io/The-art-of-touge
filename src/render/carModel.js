// Kazama MR-II: a low-poly model of the 1987 AW11 MR2 (Series 2), built in code from the real car's
// dimensions: 3,950 mm long, 1,665 mm wide, 1,250 mm tall, 2,320 mm wheelbase, 185/60R14 tyres.
//
// Car space: +z forward, +y up, +x left. The body is modelled around the wheelbase centre and then
// shifted so the origin sits on the ground under the centre of gravity.
import * as THREE from 'three';
import { carMaterial } from './ps1.js';
import { whiteTexture, drawEnvMap, toTexture } from './textures.js';

const AXLE = 1.16; // half wheelbase
const WHEEL_R = 0.289;
const ARCH_R = 0.335;
const NOSE = 1.975;
const TAIL = -1.975;

const BLACK = [0.07, 0.07, 0.08];
const UNDER = [0.04, 0.04, 0.045];
const AMBER = [0.95, 0.55, 0.1];
const PLATE = [0.85, 0.85, 0.74];

// ---------- Geometry helpers ----------

// Builds a flat-shaded mesh from convex polygons. Each polygon faces away from `center`,
// or along its own `out` hint when given, so point order does not matter.
function polyGeometry(polys, center = [0, 0.6, 0]) {
  const pos = [];
  const col = [];
  const uv = [];
  for (const poly of polys) {
    const color = poly.color ?? [1, 1, 1];
    let pts = poly.pts;
    const [a, b, c] = pts;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    let out = poly.out;
    if (!out) {
      const m = pts.reduce((acc, p) => [acc[0] + p[0] / pts.length, acc[1] + p[1] / pts.length, acc[2] + p[2] / pts.length], [0, 0, 0]);
      out = [m[0] - center[0], m[1] - center[1], m[2] - center[2]];
    }
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) pts = [...pts].reverse();
    for (let k = 1; k < pts.length - 1; k++) {
      for (const p of [pts[0], pts[k], pts[k + 1]]) {
        pos.push(p[0], p[1], p[2]);
        col.push(color[0], color[1], color[2]);
        uv.push(0.5, 0.5);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals(); // non-indexed: one normal per face, i.e. flat shading
  return g;
}

// Piecewise-linear lookup in a table of [z, value] rows sorted from front (high z) to back.
function profile(table, z) {
  if (z >= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [z1, v1] = table[i];
    if (z >= z1) {
      const [z0, v0] = table[i - 1];
      return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
    }
  }
  return table[table.length - 1][1];
}

const mirrorX = (p) => [-p[0], p[1], p[2]];
const both = (poly) => [poly, { ...poly, pts: poly.pts.map(mirrorX), out: poly.out ? [-poly.out[0], poly.out[1], poly.out[2]] : undefined }];

// ---------- Body shell profile (side view and plan view) ----------

const HALF_WIDTH = [
  [1.975, 0.69],
  [1.94, 0.775],
  [1.82, 0.812],
  [1.5, 0.826],
  [0.6, 0.833],
  [-0.6, 0.833],
  [-1.5, 0.83],
  [-1.85, 0.815],
  [-1.94, 0.79],
  [-1.975, 0.745],
];
const BOTTOM = [
  [1.975, 0.33],
  [1.93, 0.27],
  [1.8, 0.25],
  [0.6, 0.215],
  [-0.6, 0.215],
  [-1.8, 0.26],
  [-1.975, 0.3],
];
const RUB = [
  [1.975, 0.4],
  [1.8, 0.43],
  [-1.975, 0.46],
];
// Shoulder crease that runs the full length of the car.
const CREASE = [
  [1.975, 0.47],
  [1.93, 0.53],
  [1.75, 0.6],
  [1.2, 0.66],
  [0.6, 0.69],
  [-0.5, 0.71],
  [-1.3, 0.74],
  [-1.975, 0.75],
];
// Top of the sides: wings, doors (window line), rear quarters.
const BELT = [
  [1.975, 0.52],
  [1.93, 0.575],
  [1.75, 0.625],
  [1.2, 0.705],
  [0.6, 0.79],
  [-0.45, 0.8],
  [-0.9, 0.88],
  [-1.3, 0.905],
  [-1.975, 0.915],
];
// Centreline of the bonnet (low wedge nose) and the engine deck.
const DECK = [
  [1.975, 0.53],
  [1.93, 0.588],
  [1.75, 0.642],
  [1.2, 0.728],
  [0.6, 0.805],
  [-0.45, 0.805],
  [-0.7, 0.93],
  [-1.975, 0.935],
];

function section(z) {
  let bottom = profile(BOTTOM, z);
  let rub = profile(RUB, z);
  for (const zc of [AXLE, -AXLE]) {
    const dz = z - zc;
    if (Math.abs(dz) < ARCH_R) {
      const arch = WHEEL_R + Math.sqrt(ARCH_R * ARCH_R - dz * dz);
      bottom = Math.max(bottom, arch);
      rub = Math.max(rub, arch + 0.004);
    }
  }
  return {
    hw: profile(HALF_WIDTH, z),
    bottom,
    rub,
    crease: profile(CREASE, z),
    belt: profile(BELT, z),
    deck: profile(DECK, z),
  };
}

// Left half of a body cross-section, from the sill up to the centreline.
function ring(z) {
  const s = section(z);
  return [
    [s.hw * 0.97, s.bottom, z],
    [s.hw, s.rub, z],
    [s.hw, s.crease, z],
    [s.hw * 0.965, s.belt, z],
    [s.hw * 0.55, s.deck - 0.006, z],
    [0, s.deck, z],
  ];
}

// Height of the top surface at (z, x), used to sit the headlight lids flush on the bonnet.
function topSurface(z, x) {
  const r = ring(z);
  const ax = Math.abs(x);
  for (let k = 5; k > 2; k--) {
    const [x0, y0] = r[k];
    const [x1, y1] = r[k - 1];
    if (ax <= x1) return y0 + ((y1 - y0) * (ax - x0)) / (x1 - x0);
  }
  return r[3][1];
}

function bodyPolys() {
  const paint = [];
  const trim = [];
  // Stations: regular spacing plus dense sampling around the wheel arches.
  const zs = new Set([NOSE, TAIL, 1.94, 1.93, -1.94]);
  for (let z = NOSE; z > TAIL; z -= 0.07) zs.add(Number(z.toFixed(4)));
  for (const zc of [AXLE, -AXLE]) {
    for (let k = 0; k <= 14; k++) zs.add(Number((zc - ARCH_R + (2 * ARCH_R * k) / 14).toFixed(4)));
  }
  const stations = [...zs].filter((z) => z <= NOSE && z >= TAIL).sort((a, b) => b - a);
  const rings = stations.map((z) => {
    const left = ring(z);
    return [...left, ...left.slice(0, 5).reverse().map(mirrorX)];
  });
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    for (let k = 0; k < a.length - 1; k++) paint.push({ pts: [a[k], a[k + 1], b[k + 1], b[k]] });
    // Underside (also the roof of the wheel wells).
    trim.push({ pts: [a[0], a[a.length - 1], b[b.length - 1], b[0]], color: UNDER, out: [0, -1, 0] });
  }
  // Nose and tail caps, as fans from the centre so the outline can be any shape.
  for (const [r, dir] of [
    [rings[0], 1],
    [rings[rings.length - 1], -1],
  ]) {
    const c = r.reduce((acc, p) => [acc[0], acc[1] + p[1] / r.length, p[2]], [0, 0, 0]);
    const closed = [...r, r[0]];
    for (let k = 0; k < closed.length - 1; k++) paint.push({ pts: [c, closed[k], closed[k + 1]], out: [0, 0, dir] });
  }

  // Black rub strip along the sides, interrupted by the wheel arches.
  for (let i = 0; i < stations.length - 1; i++) {
    const z0 = stations[i];
    const z1 = stations[i + 1];
    const s0 = section(z0);
    const s1 = section(z1);
    const base0 = profile(RUB, z0);
    const base1 = profile(RUB, z1);
    if (s0.bottom > base0 - 0.03 || s1.bottom > base1 - 0.03) continue;
    for (const side of [1, -1]) {
      trim.push({
        pts: [
          [side * (s0.hw + 0.006), base0 - 0.012, z0],
          [side * (s0.hw + 0.006), base0 + 0.028, z0],
          [side * (s1.hw + 0.006), base1 + 0.028, z1],
          [side * (s1.hw + 0.006), base1 - 0.012, z1],
        ],
        color: BLACK,
        out: [side, 0, 0],
      });
    }
  }

  // Wheel-well liners so the arches read as dark openings.
  for (const zc of [AXLE, -AXLE]) {
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const a = Math.PI * (k / 12);
      pts.push([0, WHEEL_R + Math.sin(a) * ARCH_R, zc + Math.cos(a) * ARCH_R]);
    }
    pts.push([0, 0.2, zc - ARCH_R], [0, 0.2, zc + ARCH_R]);
    for (const side of [1, -1]) {
      trim.push({ pts: pts.map((p) => [side * 0.6, p[1], p[2]]), color: UNDER, out: [side, 0, 0] });
    }
  }
  return { paint, trim };
}

// ---------- Greenhouse: raked windscreen, short roof, flying-buttress sail panels ----------

const ROOF_Y = 1.235;
const ROOF_HW = 0.595;
const SCREEN_BASE_Z = 0.78;
const SCREEN_TOP_Z = 0.02;
const ROOF_REAR_Z = -0.6;
const B_PILLAR_Z = -0.46;

function greenhouseTop(z) {
  const baseY = section(SCREEN_BASE_Z).belt;
  if (z >= SCREEN_TOP_Z) {
    const t = (SCREEN_BASE_Z - z) / (SCREEN_BASE_Z - SCREEN_TOP_Z);
    return { y: baseY + t * (ROOF_Y - baseY), hw: 0.72 + (ROOF_HW - 0.72) * t };
  }
  // Very slight drop toward the back of the roof.
  return { y: ROOF_Y - Math.max(0, -0.3 - z) * 0.03, hw: ROOF_HW };
}

function greenhousePolys() {
  const paint = [];
  const glass = [];
  const trim = [];
  const zs = [0.78, 0.63, 0.48, 0.33, 0.18, 0.02, -0.14, -0.3, -0.46, -0.6];
  const rings = zs.map((z) => {
    const s = section(z);
    const t = greenhouseTop(z);
    return { z, lb: [s.hw * 0.965, s.belt, z], lt: [t.hw, t.y, z] };
  });
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    const mid = (a.z + b.z) / 2;
    // Side windows run from the A-pillar back to the B-pillar; behind that is the body-coloured sail.
    for (const p of both({ pts: [a.lb, a.lt, b.lt, b.lb] })) (mid > B_PILLAR_Z ? glass : paint).push(p);
    const top = { pts: [a.lt, mirrorX(a.lt), mirrorX(b.lt), b.lt], out: [0, 1, mid > SCREEN_TOP_Z ? 0.6 : 0] };
    (mid > SCREEN_TOP_Z ? glass : paint).push(top);
    // Black window surround along the belt line.
    if (mid > B_PILLAR_Z) {
      for (const p of both({
        pts: [a.lb, [a.lb[0] - 0.012, a.lb[1] + 0.03, a.z], [b.lb[0] - 0.012, b.lb[1] + 0.03, b.z], b.lb],
        color: BLACK,
        out: [1, 0.2, 0],
      })) {
        trim.push(p);
      }
    }
  }
  // B-pillar: a black band on the glass line.
  const bp = rings.find((r) => r.z === B_PILLAR_Z);
  for (const p of both({
    pts: [bp.lb, bp.lt, [bp.lt[0], bp.lt[1], bp.z + 0.06], [bp.lb[0], bp.lb[1], bp.z + 0.06]].map((q) => [q[0] + 0.004, q[1], q[2]]),
    color: BLACK,
    out: [1, 0, 0],
  })) {
    trim.push(p);
  }

  // Flying buttresses: the sail panels run from the roof back down to the engine deck,
  // with a near-vertical rear window between them.
  const rear = rings[rings.length - 1];
  const deckAt = (z) => section(z).deck;
  const outerTop = [rear.lt, [0.665, 1.075, -0.95], [0.735, deckAt(-1.32) + 0.004, -1.32]];
  const innerTop = [[0.5, rear.lt[1], ROOF_REAR_Z], [0.575, 1.075, -0.95], [0.665, deckAt(-1.32) + 0.004, -1.32]];
  const outerBottom = [rear.lb, [section(-0.95).hw * 0.965, section(-0.95).belt, -0.95], [section(-1.32).hw * 0.965, section(-1.32).belt, -1.32]];
  for (let k = 0; k < 2; k++) {
    for (const p of both({ pts: [outerBottom[k], outerTop[k], outerTop[k + 1], outerBottom[k + 1]], out: [1, 0.1, 0] })) paint.push(p);
    for (const p of both({ pts: [outerTop[k], innerTop[k], innerTop[k + 1], outerTop[k + 1]], out: [0.2, 1, -0.3] })) paint.push(p);
    const inner = [innerTop[k], innerTop[k + 1], [innerTop[k + 1][0], deckAt(innerTop[k + 1][2]), innerTop[k + 1][2]], [innerTop[k][0], deckAt(innerTop[k][2]), innerTop[k][2]]];
    for (const p of both({ pts: inner, out: [-1, 0, 0] })) paint.push(p);
  }
  // Rear window.
  glass.push({ pts: [[0.5, rear.lt[1] - 0.01, ROOF_REAR_Z], [-0.5, rear.lt[1] - 0.01, ROOF_REAR_Z], [-0.5, deckAt(-0.68), -0.68], [0.5, deckAt(-0.68), -0.68]], out: [0, 0.25, -1] });
  // Engine-lid louvres between the buttresses.
  for (let z = -0.8; z > -1.3; z -= 0.09) {
    const y0 = deckAt(z) + 0.004;
    const y1 = deckAt(z - 0.035) + 0.004;
    trim.push({ pts: [[0.42, y0, z], [-0.42, y0, z], [-0.42, y1, z - 0.035], [0.42, y1, z - 0.035]], color: BLACK, out: [0, 1, 0] });
  }
  return { paint, glass, trim };
}

// ---------- Details: intakes, seams, mirrors, spoiler, lights, bumpers ----------

function detailPolys() {
  const paint = [];
  const trim = [];
  const tail = [];
  const head = [];
  const sideX = (z) => section(z).hw + 0.004;

  // Side air intakes behind the doors (the AW11's signature scoops).
  const intake = [
    [-0.5, 0.79],
    [-0.97, 0.815],
    [-0.97, 0.6],
    [-0.66, 0.585],
  ];
  for (const p of both({ pts: intake.map(([z, y]) => [sideX(z) + 0.002, y, z]), color: BLACK, out: [1, 0, 0] })) trim.push(p);
  // Slats inside the intake.
  for (const y of [0.64, 0.7, 0.76]) {
    for (const p of both({
      pts: [
        [sideX(-0.6) + 0.006, y, -0.62],
        [sideX(-0.95) + 0.006, y + 0.012, -0.95],
        [sideX(-0.95) + 0.006, y + 0.022, -0.95],
        [sideX(-0.6) + 0.006, y + 0.01, -0.62],
      ],
      color: [0.22, 0.22, 0.24],
      out: [1, 0, 0],
    })) {
      trim.push(p);
    }
  }

  // Door shut lines and handle.
  for (const z of [0.75, -0.455]) {
    const s = section(z);
    for (const p of both({ pts: [[sideX(z), s.bottom + 0.03, z], [sideX(z), s.belt - 0.01, z], [sideX(z), s.belt - 0.01, z - 0.008], [sideX(z), s.bottom + 0.03, z - 0.008]], color: BLACK, out: [1, 0, 0] })) trim.push(p);
  }
  for (const p of both({ pts: [[sideX(-0.33), 0.735, -0.3], [sideX(-0.33), 0.755, -0.3], [sideX(-0.33), 0.755, -0.4], [sideX(-0.33), 0.735, -0.4]], color: BLACK, out: [1, 0, 0] })) trim.push(p);

  // Door mirrors at the base of the A-pillars.
  const m = (x, y, z) => [x, y, z];
  const mirrorBox = [
    { pts: [m(0.8, 0.8, 0.7), m(0.95, 0.82, 0.67), m(0.95, 0.91, 0.67), m(0.8, 0.9, 0.7)], out: [0, 0, 1] },
    { pts: [m(0.8, 0.8, 0.61), m(0.95, 0.82, 0.61), m(0.95, 0.91, 0.61), m(0.8, 0.9, 0.61)], out: [0, 0, -1] },
    { pts: [m(0.95, 0.82, 0.67), m(0.95, 0.82, 0.61), m(0.95, 0.91, 0.61), m(0.95, 0.91, 0.67)], out: [1, 0, 0] },
    { pts: [m(0.8, 0.9, 0.7), m(0.95, 0.91, 0.67), m(0.95, 0.91, 0.61), m(0.8, 0.9, 0.61)], out: [0, 1, 0] },
    { pts: [m(0.8, 0.8, 0.7), m(0.95, 0.82, 0.67), m(0.95, 0.82, 0.61), m(0.8, 0.8, 0.61)], out: [0, -1, 0] },
  ];
  for (const poly of mirrorBox) for (const p of both({ ...poly, color: BLACK })) trim.push(p);

  // Rear spoiler on the trailing edge of the engine lid.
  const wingY = 1.0;
  paint.push({ pts: [[0.7, wingY, -1.72], [-0.7, wingY, -1.72], [-0.7, wingY + 0.02, -1.95], [0.7, wingY + 0.02, -1.95]], out: [0, 1, 0] });
  paint.push({ pts: [[0.7, wingY - 0.025, -1.72], [-0.7, wingY - 0.025, -1.72], [-0.7, wingY, -1.95], [0.7, wingY, -1.95]], out: [0, -1, 0] });
  paint.push({ pts: [[0.7, wingY + 0.02, -1.95], [-0.7, wingY + 0.02, -1.95], [-0.7, wingY, -1.95], [0.7, wingY, -1.95]], out: [0, 0, -1] });
  for (const x of [0.45, -0.45]) {
    paint.push({ pts: [[x + 0.02, 0.93, -1.78], [x + 0.02, wingY, -1.8], [x + 0.02, wingY, -1.9], [x + 0.02, 0.93, -1.86]], out: [1, 0, 0] });
    paint.push({ pts: [[x - 0.02, 0.93, -1.78], [x - 0.02, wingY, -1.8], [x - 0.02, wingY, -1.9], [x - 0.02, 0.93, -1.86]], out: [-1, 0, 0] });
  }

  // Tail: full-width black light panel with red lamps, black bumper strip, number plate.
  const zt = TAIL - 0.006;
  trim.push({ pts: [[0.745, 0.6, zt], [0.745, 0.81, zt], [-0.745, 0.81, zt], [-0.745, 0.6, zt]], color: BLACK, out: [0, 0, -1] });
  for (const side of [1, -1]) {
    tail.push({ pts: [[side * 0.73, 0.62, zt - 0.003], [side * 0.73, 0.79, zt - 0.003], [side * 0.33, 0.79, zt - 0.003], [side * 0.33, 0.62, zt - 0.003]], out: [0, 0, -1] });
    // Reversing lamp at the inner end of each cluster.
    trim.push({ pts: [[side * 0.32, 0.64, zt - 0.003], [side * 0.32, 0.77, zt - 0.003], [side * 0.22, 0.77, zt - 0.003], [side * 0.22, 0.64, zt - 0.003]], color: [0.75, 0.75, 0.75], out: [0, 0, -1] });
  }
  trim.push({ pts: [[0.76, 0.43, zt], [0.76, 0.48, zt], [-0.76, 0.48, zt], [-0.76, 0.43, zt]], color: BLACK, out: [0, 0, -1] });
  trim.push({ pts: [[0.17, 0.38, zt - 0.006], [0.17, 0.54, zt - 0.006], [-0.17, 0.54, zt - 0.006], [-0.17, 0.38, zt - 0.006]], color: PLATE, out: [0, 0, -1] });

  // Nose: black lower lip, intake slot, amber indicators wrapping the corners, black bumper strip.
  const zn = NOSE + 0.006;
  trim.push({ pts: [[0.69, 0.33, zn], [0.69, 0.37, zn], [-0.69, 0.37, zn], [-0.69, 0.33, zn]], color: BLACK, out: [0, 0, 1] });
  trim.push({ pts: [[0.3, 0.38, zn], [0.3, 0.44, zn], [-0.3, 0.44, zn], [-0.3, 0.38, zn]], color: BLACK, out: [0, 0, 1] });
  for (const side of [1, -1]) {
    trim.push({ pts: [[side * 0.66, 0.39, zn], [side * 0.66, 0.45, zn], [side * 0.36, 0.45, zn], [side * 0.36, 0.39, zn]], color: AMBER, out: [0, 0, 1] });
    trim.push({ pts: [[side * 0.79, 0.4, 1.9], [side * 0.79, 0.45, 1.9], [side * 0.72, 0.45, 1.955], [side * 0.72, 0.4, 1.955]], color: AMBER, out: [side, 0, 0.6] });
  }
  return { paint, trim, tail, head };
}

// ---------- Wheels: 14-inch alloys on 185/60 tyres ----------

function wheelGeometry() {
  const r = WHEEL_R;
  const w = 0.185;
  const segs = 16;
  const polys = [];
  const tyre = [0.12, 0.12, 0.13];
  const wall = [0.17, 0.17, 0.18];
  const rim = [0.8, 0.8, 0.82];
  const dish = [0.62, 0.62, 0.65];
  const hole = [0.1, 0.1, 0.11];
  const p = (a, x, rad) => [x, Math.sin(a) * rad, Math.cos(a) * rad];
  const out = (a, x) => [x, Math.sin(a), Math.cos(a)];
  const ox = w / 2;
  for (let s = 0; s < segs; s++) {
    const a0 = (s / segs) * Math.PI * 2;
    const a1 = ((s + 1) / segs) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    polys.push({ pts: [p(a0, ox, r), p(a1, ox, r), p(a1, -ox, r), p(a0, -ox, r)], color: tyre, out: out(am, 0) });
    // Outer face: sidewall, polished lip, dish with eight holes, centre cap.
    const rings = [
      [r, r * 0.8, wall],
      [r * 0.8, r * 0.74, rim],
      [r * 0.74, r * 0.42, s % 2 ? dish : hole],
      [r * 0.42, r * 0.2, dish],
      [r * 0.2, 0, rim],
    ];
    for (const [ro, ri, c] of rings) {
      const x = ri < r * 0.5 ? ox + 0.012 : ri < r * 0.75 ? ox - 0.01 : ox;
      polys.push({ pts: [p(a0, x, ro), p(a1, x, ro), p(a1, x, ri), p(a0, x, ri)].filter((q, i) => ri > 0 || i < 3), color: c, out: [1, 0, 0] });
    }
    polys.push({ pts: [[-ox, 0, 0], p(a0, -ox, r), p(a1, -ox, r)], color: tyre, out: [-1, 0, 0] });
  }
  return polyGeometry(polys, [0, 0, 0]);
}

// ---------- Pop-up headlights ----------

const LAMP_X = 0.48;
const LAMP_HW = 0.2;
const LAMP_LEN = 0.3;
const LAMP_DEPTH = 0.13;
const LAMP_HINGE_Z = 1.34;
const LAMP_LIFT = 0.11; // how far the unit rises when open
const LAMP_TILT = 0.3; // radians the unit tips up at the front when open

function popupParts() {
  // In hinge space the painted lid lies in y = 0 from z = 0 forward. The rectangular lamp sits in the
  // front face, hidden under the bonnet when closed; opening lifts the unit and tips its nose up,
  // which leaves the lid on top and the lamp facing forward, like the real car.
  const x0 = -LAMP_HW;
  const x1 = LAMP_HW;
  const L = LAMP_LEN;
  const d = -LAMP_DEPTH;
  const lid = [{ pts: [[x0, 0, 0], [x1, 0, 0], [x1, 0, L], [x0, 0, L]], out: [0, 1, 0] }];
  const box = [
    { pts: [[x0, d, 0], [x1, d, 0], [x1, d, L], [x0, d, L]], color: BLACK, out: [0, -1, 0] },
    { pts: [[x0, 0, L], [x1, 0, L], [x1, d, L], [x0, d, L]], color: BLACK, out: [0, 0, 1] },
    { pts: [[x0, 0, 0], [x1, 0, 0], [x1, d, 0], [x0, d, 0]], color: BLACK, out: [0, 0, -1] },
    { pts: [[x0, 0, 0], [x0, 0, L], [x0, d, L], [x0, d, 0]], color: BLACK, out: [-1, 0, 0] },
    { pts: [[x1, 0, 0], [x1, 0, L], [x1, d, L], [x1, d, 0]], color: BLACK, out: [1, 0, 0] },
  ];
  const lamp = [{ pts: [[x0 + 0.03, -0.022, L + 0.002], [x1 - 0.03, -0.022, L + 0.002], [x1 - 0.03, d + 0.022, L + 0.002], [x0 + 0.03, d + 0.022, L + 0.002]], out: [0, 0, 1] }];
  return { lid, box, lamp };
}

// ---------- The model ----------

export class CarModel {
  constructor(spec) {
    this.spec = spec;
    this.root = new THREE.Group(); // follows the road surface
    this.body = new THREE.Group(); // pitch and roll from load transfer
    this.root.add(this.body);

    this.envCanvas = document.createElement('canvas');
    this.envCanvas.width = 64;
    this.envCanvas.height = 32;
    this.envTexture = toTexture(this.envCanvas, false);
    this.envTexture.wrapS = THREE.RepeatWrapping;
    const white = whiteTexture();

    this.paint = new THREE.Color(...spec.paint);
    const paintMat = carMaterial({ map: white, envMap: this.envTexture, paint: this.paint, reflect: 0.5 });
    const trimMat = carMaterial({ map: white, envMap: this.envTexture, reflect: 0.08 });
    const glassMat = carMaterial({ map: white, envMap: this.envTexture, paint: new THREE.Color(0.06, 0.08, 0.1), reflect: 0.6 });
    this.tailMat = carMaterial({ map: white, envMap: this.envTexture, paint: new THREE.Color(0.68, 0.06, 0.05), reflect: 0.35 });
    this.headMat = carMaterial({ map: white, envMap: this.envTexture, paint: new THREE.Color(0.85, 0.86, 0.82), reflect: 0.4 });

    const shell = bodyPolys();
    const cabin = greenhousePolys();
    const detail = detailPolys();
    const lidRecess = [];
    for (const side of [1, -1]) {
      const xs = [side * (LAMP_X - LAMP_HW), side * (LAMP_X + LAMP_HW)];
      const z0 = LAMP_HINGE_Z;
      const z1 = LAMP_HINGE_Z + LAMP_LEN;
      lidRecess.push({
        pts: [
          [xs[0], topSurface(z0, xs[0]) + 0.002, z0],
          [xs[1], topSurface(z0, xs[1]) + 0.002, z0],
          [xs[1], topSurface(z1, xs[1]) + 0.002, z1],
          [xs[0], topSurface(z1, xs[0]) + 0.002, z1],
        ],
        color: UNDER,
        out: [0, 1, 0],
      });
    }
    const meshes = [
      [polyGeometry([...shell.paint, ...cabin.paint, ...detail.paint]), paintMat],
      [polyGeometry([...shell.trim, ...cabin.trim, ...detail.trim, ...lidRecess]), trimMat],
      [polyGeometry(cabin.glass), glassMat],
      [polyGeometry(detail.tail), this.tailMat],
    ];
    for (const [g, mat] of meshes) this.body.add(new THREE.Mesh(g, mat));

    // Pop-up headlights, hinged at the rear edge and lying flush with the bonnet when closed.
    const parts = popupParts();
    this.popups = [];
    for (const side of [1, -1]) {
      const x = side * LAMP_X;
      const yHinge = topSurface(LAMP_HINGE_Z, x);
      const yFront = topSurface(LAMP_HINGE_Z + LAMP_LEN, x);
      const slope = Math.atan2(yHinge - yFront, LAMP_LEN);
      const base = new THREE.Group();
      base.position.set(x, yHinge + 0.006, LAMP_HINGE_Z);
      base.rotation.x = slope;
      const hinge = new THREE.Group();
      base.add(hinge);
      hinge.add(new THREE.Mesh(polyGeometry(parts.lid), paintMat));
      hinge.add(new THREE.Mesh(polyGeometry(parts.box), trimMat));
      hinge.add(new THREE.Mesh(polyGeometry(parts.lamp), this.headMat));
      this.body.add(base);
      this.popups.push({ hinge, slope, base, baseY: yHinge + 0.006 });
    }
    this.popupAngle = 0;

    // Wheels.
    this.wheelMeshes = [];
    const wg = wheelGeometry();
    const L = spec.wheelbase;
    const a = L * (1 - spec.frontWeight);
    const b = L * spec.frontWeight;
    const places = [
      [spec.trackFront / 2, a],
      [-spec.trackFront / 2, a],
      [spec.trackRear / 2, -b],
      [-spec.trackRear / 2, -b],
    ];
    for (const [x, z] of places) {
      const steer = new THREE.Group();
      steer.position.set(x, WHEEL_R, z);
      const spin = new THREE.Mesh(wg, trimMat);
      if (x < 0) spin.scale.x = -1; // mirror so the alloy faces outward
      steer.add(spin);
      this.root.add(steer);
      this.wheelMeshes.push({ steer, spin });
    }
    // The body was modelled around the wheelbase centre; the CG (the origin) sits slightly behind it.
    this.bodyZ = (a - b) / 2;

    const shadow = polyGeometry([{ pts: [[0.72, 0.04, -1.7], [0.72, 0.04, 2.0], [-0.72, 0.04, 2.0], [-0.72, 0.04, -1.7]], color: [0.05, 0.05, 0.05], out: [0, 1, 0] }]);
    this.shadow = new THREE.Mesh(shadow, carMaterial({ map: white, envMap: this.envTexture, lit: false, paint: new THREE.Color(0.06, 0.06, 0.06) }));
    this.root.add(this.shadow);
  }

  _up = new THREE.Vector3();
  _fwd = new THREE.Vector3();
  _left = new THREE.Vector3();
  _basis = new THREE.Matrix4();

  setPaint(rgb) {
    this.paint.setRGB(...rgb);
  }

  updateEnv(sky) {
    drawEnvMap(this.envCanvas.getContext('2d'), 64, 32, sky);
    this.envTexture.needsUpdate = true;
  }

  // Sync with the simulation each frame.
  update(car, dt, lightsOn, braking) {
    this.root.position.set(car.x, car.y, car.z);
    // Align with the road surface: up = road normal, forward = heading projected onto the road.
    const q = car.q;
    const up = this._up.set(q.nx, q.ny, q.nz);
    const fwd = this._fwd.set(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const left = this._left.crossVectors(up, fwd);
    this._basis.makeBasis(left, up, fwd);
    this.root.quaternion.setFromRotationMatrix(this._basis);
    this.body.rotation.set(car.pitch, 0, car.roll, 'YXZ');
    this.body.position.set(0, 0.02, this.bodyZ);
    for (let i = 0; i < 4; i++) {
      const w = this.wheelMeshes[i];
      w.steer.rotation.y = i < 2 ? car.steer : 0;
      w.spin.rotation.x = car.wheels[i].angle;
    }
    const target = lightsOn ? 1 : 0;
    this.popupAngle += Math.max(-dt * 2.2, Math.min(dt * 2.2, target - this.popupAngle));
    for (const p of this.popups) {
      p.base.position.y = p.baseY + this.popupAngle * LAMP_LIFT;
      p.hinge.rotation.x = -this.popupAngle * (LAMP_TILT + p.slope);
    }
    this.headMat.uniforms.uEmissive.value.setScalar(lightsOn ? 0.9 : 0);
    const tail = braking ? 0.85 : lightsOn ? 0.4 : 0;
    this.tailMat.uniforms.uEmissive.value.setRGB(tail, tail * 0.08, tail * 0.06);
  }
}
