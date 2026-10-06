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
const ARCH_R = 0.385;
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

// ---------- Body shell profile ----------
// Heights and lengths measured from side photos of a 1987 AW11 and scaled to the real dimensions.
// z is measured from the middle of the wheelbase (front axle +1.16, rear axle -1.16).

const HALF_WIDTH = [
  [1.975, 0.76],
  [1.955, 0.8],
  [1.88, 0.815],
  [1.6, 0.825],
  [0.6, 0.833],
  [-0.6, 0.833],
  [-1.5, 0.83],
  [-1.75, 0.815],
  [-1.9, 0.79],
  [-1.975, 0.76],
];
const BOTTOM = [
  [1.975, 0.27],
  [1.95, 0.22],
  [1.85, 0.18],
  [1.55, 0.16],
  [0.8, 0.14],
  [-0.8, 0.14],
  [-1.55, 0.16],
  [-1.8, 0.22],
  [-1.975, 0.3],
];
// Rub strip / pinstripe line along the doors and bumpers.
const RUB = [
  [1.975, 0.45],
  [1.6, 0.45],
  [0.8, 0.435],
  [-0.8, 0.435],
  [-1.6, 0.45],
  [-1.975, 0.46],
];
// Top edge of the sides: wing tops along the bonnet, the window line, the rear deck, then the
// short drop to the tail-light panel and the rear bumper.
const BELT = [
  [1.975, 0.5],
  [1.94, 0.55],
  [1.84, 0.595],
  [1.73, 0.635],
  [1.41, 0.715],
  [1.1, 0.775],
  [0.79, 0.83],
  [0.6, 0.855],
  [0.3, 0.87],
  [-0.6, 0.875],
  [-1.0, 0.875],
  [-1.3, 0.86],
  [-1.68, 0.83],
  [-1.72, 0.7],
  [-1.76, 0.565],
  [-1.975, 0.54],
];
// Centreline of the bonnet (slightly crowned) and the engine deck.
const DECK = [
  [1.975, 0.51],
  [1.94, 0.565],
  [1.84, 0.61],
  [1.73, 0.65],
  [1.41, 0.73],
  [1.1, 0.79],
  [0.79, 0.845],
  [0.6, 0.87],
  [-0.6, 0.875],
  [-1.0, 0.872],
  [-1.3, 0.86],
  [-1.68, 0.835],
  [-1.72, 0.705],
  [-1.76, 0.57],
  [-1.975, 0.545],
];
const TAIL_TOP = [-1.68, 0.83]; // trailing edge of the engine lid
const TAIL_BOTTOM = [-1.76, 0.565]; // top of the rear bumper

function section(z) {
  let bottom = profile(BOTTOM, z);
  let rub = profile(RUB, z);
  const belt = profile(BELT, z);
  for (const zc of [AXLE, -AXLE]) {
    const dz = z - zc;
    if (Math.abs(dz) < ARCH_R) {
      const arch = WHEEL_R + Math.sqrt(ARCH_R * ARCH_R - dz * dz);
      bottom = Math.max(bottom, arch);
      rub = Math.max(rub, arch + 0.004);
    }
  }
  const crease = Math.max(rub + 0.02, belt - 0.045);
  return { hw: profile(HALF_WIDTH, z), bottom, rub, crease, belt, deck: profile(DECK, z) };
}

// Left half of a body cross-section, from the sill up to the centreline.
function ring(z) {
  const s = section(z);
  return [
    [s.hw * 0.93, s.bottom, z],
    [s.hw, s.rub, z],
    [s.hw, s.crease, z],
    [s.hw * 0.975, s.belt, z],
    [s.hw * 0.55, s.deck - 0.004, z],
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
  // Stations: regular spacing, the profile keyframes, and dense sampling around the wheel arches.
  const zs = new Set([NOSE, TAIL]);
  for (const t of [BELT, BOTTOM, HALF_WIDTH]) for (const [z] of t) zs.add(z);
  for (let z = NOSE; z > TAIL; z -= 0.08) zs.add(Number(z.toFixed(4)));
  for (const zc of [AXLE, -AXLE]) {
    for (let k = 0; k <= 16; k++) zs.add(Number((zc - ARCH_R + (2 * ARCH_R * k) / 16).toFixed(4)));
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
    const c = [0, r.reduce((acc, p) => acc + p[1] / r.length, 0), r[0][2]];
    const closed = [...r, r[0]];
    for (let k = 0; k < closed.length - 1; k++) paint.push({ pts: [c, closed[k], closed[k + 1]], out: [0, 0, dir] });
  }

  // Dark rub strip with a light pinstripe above it, interrupted by the wheel arches.
  for (let i = 0; i < stations.length - 1; i++) {
    const z0 = stations[i];
    const z1 = stations[i + 1];
    const s0 = section(z0);
    const s1 = section(z1);
    const r0 = profile(RUB, z0);
    const r1 = profile(RUB, z1);
    if (s0.bottom > r0 - 0.03 || s1.bottom > r1 - 0.03) continue;
    for (const side of [1, -1]) {
      const x0 = side * (s0.hw + 0.005);
      const x1 = side * (s1.hw + 0.005);
      trim.push({ pts: [[x0, r0 - 0.01, z0], [x0, r0 + 0.012, z0], [x1, r1 + 0.012, z1], [x1, r1 - 0.01, z1]], color: [0.16, 0.05, 0.05], out: [side, 0, 0] });
      trim.push({ pts: [[x0, r0 + 0.017, z0], [x0, r0 + 0.024, z0], [x1, r1 + 0.024, z1], [x1, r1 + 0.017, z1]], color: [0.85, 0.82, 0.78], out: [side, 0, 0] });
    }
  }

  // Wheel-well liners so the arches read as dark openings.
  for (const zc of [AXLE, -AXLE]) {
    const pts = [];
    for (let k = 0; k <= 14; k++) {
      const a = Math.PI * (k / 14);
      pts.push([0, WHEEL_R + Math.sin(a) * ARCH_R, zc + Math.cos(a) * ARCH_R]);
    }
    pts.push([0, 0.12, zc - ARCH_R], [0, 0.12, zc + ARCH_R]);
    for (const side of [1, -1]) {
      trim.push({ pts: pts.map((p) => [side * 0.6, p[1], p[2]]), color: UNDER, out: [side, 0, 0] });
    }
  }
  return { paint, trim };
}

// ---------- Greenhouse ----------
// Very raked windscreen with black A-pillars, a short flat roof, door glass and a rear quarter
// window behind a black B-pillar, then body-coloured sail panels (flying buttresses) running down
// to the engine deck either side of a near-vertical rear window.

const ROOF_Y = 1.255;
const ROOF_HW = 0.6;
const SCREEN_BASE_Z = 0.78;
const SCREEN_TOP_Z = 0.07;
const ROOF_REAR_Z = -0.68;
const B_PILLAR = [-0.15, -0.21];
const QUARTER_END_Z = -0.99;
const SAIL_END_Z = -1.27;

function greenhouseTop(z) {
  const baseY = section(SCREEN_BASE_Z).belt;
  if (z >= SCREEN_TOP_Z) {
    const t = (SCREEN_BASE_Z - z) / (SCREEN_BASE_Z - SCREEN_TOP_Z);
    return { y: baseY + t * (ROOF_Y - baseY), hw: 0.74 + (ROOF_HW - 0.74) * t };
  }
  return { y: ROOF_Y, hw: ROOF_HW };
}

function greenhousePolys() {
  const paint = [];
  const glass = [];
  const trim = [];
  const zs = [0.78, 0.6, 0.42, 0.24, 0.07, -0.07, -0.15, -0.21, -0.36, -0.52, -0.68];
  const rings = zs.map((z) => {
    const s = section(z);
    const t = greenhouseTop(z);
    return { z, lb: [s.hw * 0.975, s.belt, z], lt: [t.hw, t.y, z] };
  });
  const off = (p, dx, dy = 0) => [p[0] + dx, p[1] + dy, p[2]];
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    const mid = (a.z + b.z) / 2;
    const screen = mid > SCREEN_TOP_Z;
    for (const p of both({ pts: [a.lb, a.lt, b.lt, b.lb] })) glass.push(p);
    const top = { pts: [a.lt, mirrorX(a.lt), mirrorX(b.lt), b.lt], out: [0, 1, screen ? 0.7 : 0] };
    (screen ? glass : paint).push(top);
    // Black frame: along the top of the side glass, and the A-pillars down the windscreen edges.
    for (const p of both({ pts: [a.lt, b.lt, off(b.lt, 0.004, -0.045), off(a.lt, 0.004, -0.045)], color: BLACK, out: [1, 0.3, 0] })) trim.push(p);
    if (screen) {
      for (const p of both({ pts: [off(a.lt, 0, 0.004), off(b.lt, 0, 0.004), off(b.lt, -0.075, 0.004), off(a.lt, -0.075, 0.004)], color: BLACK, out: [0, 1, 0.7] })) trim.push(p);
    }
    // Black window sill along the belt line.
    for (const p of both({ pts: [a.lb, off(a.lb, -0.01, 0.025), off(b.lb, -0.01, 0.025), b.lb], color: BLACK, out: [1, 0.2, 0] })) trim.push(p);
  }
  // Black B-pillar between the door glass and the quarter window.
  const b0 = rings.find((r) => r.z === B_PILLAR[0]);
  const b1 = rings.find((r) => r.z === B_PILLAR[1]);
  for (const p of both({ pts: [off(b0.lb, 0.005), off(b0.lt, 0.005), off(b1.lt, 0.005), off(b1.lb, 0.005)], color: BLACK, out: [1, 0, 0] })) trim.push(p);

  // Behind the roof: the quarter window's rear edge, the sail panel and the buttress.
  const rear = rings[rings.length - 1];
  const sec = (z) => section(z);
  const A = rear.lt;
  const Bq = [sec(QUARTER_END_Z).hw * 0.975, sec(QUARTER_END_Z).belt, QUARTER_END_Z];
  const C = [sec(SAIL_END_Z).hw * 0.975, sec(SAIL_END_Z).belt, SAIL_END_Z];
  const Ai = [0.47, ROOF_Y, ROOF_REAR_Z];
  const Ci = [0.64, sec(SAIL_END_Z).deck, SAIL_END_Z];
  for (const p of both({ pts: [rear.lb, A, Bq], out: [1, 0.2, 0] })) glass.push(p);
  for (const p of both({ pts: [A, Bq, C], out: [1, 0.25, 0] })) paint.push(p);
  // Black seal along the rear edge of the quarter glass.
  for (const p of both({ pts: [off(A, 0.004), off(Bq, 0.004), off(Bq, 0.004, 0.035), off(A, 0.0, -0.035)], color: BLACK, out: [1, 0.2, 0] })) trim.push(p);
  for (const p of both({ pts: [A, Ai, Ci, C], out: [0.2, 1, -0.4] })) paint.push(p);
  const D = [0.47, sec(-0.74).deck, -0.74];
  for (const p of both({ pts: [Ai, D, [0.64, sec(SAIL_END_Z).deck, SAIL_END_Z]], out: [-1, 0, 0] })) paint.push(p);
  // Rear window between the buttresses.
  glass.push({ pts: [[0.47, ROOF_Y - 0.01, ROOF_REAR_Z], [-0.47, ROOF_Y - 0.01, ROOF_REAR_Z], [-0.47, sec(-0.74).deck, -0.74], [0.47, sec(-0.74).deck, -0.74]], out: [0, 0.3, -1] });
  void Ci;
  return { paint, glass, trim };
}

// ---------- Details: intakes, seams, mirrors, spoiler, lights, bumpers ----------

function detailPolys() {
  const paint = [];
  const trim = [];
  const tail = [];
  const sideX = (z) => section(z).hw + 0.005;
  const onSide = (pts, color, dx = 0) => both({ pts: pts.map(([z, y]) => [sideX(z) + dx, y, z]), color, out: [1, 0, 0] });

  // Side air intakes on the rear quarters, with horizontal slats.
  for (const p of onSide([[-0.55, 0.81], [-0.97, 0.81], [-0.97, 0.55], [-0.55, 0.55]], BLACK)) trim.push(p);
  for (let y = 0.58; y < 0.79; y += 0.035) {
    for (const p of onSide([[-0.6, y], [-0.92, y], [-0.92, y + 0.012], [-0.6, y + 0.012]], [0.3, 0.3, 0.32], 0.003)) trim.push(p);
  }
  // Door shut lines and handle.
  for (const z of [0.79, -0.18]) {
    const s = section(z);
    for (const p of onSide([[z, s.bottom + 0.04], [z, s.belt - 0.005], [z - 0.008, s.belt - 0.005], [z - 0.008, s.bottom + 0.04]], BLACK)) trim.push(p);
  }
  for (const p of onSide([[-0.04, 0.745], [-0.14, 0.745], [-0.14, 0.768], [-0.04, 0.768]], BLACK, 0.002)) trim.push(p);
  // Amber side markers: on the front wing behind the arch and on the front bumper.
  for (const p of onSide([[0.86, 0.6], [0.81, 0.6], [0.81, 0.64], [0.86, 0.64]], AMBER)) trim.push(p);
  for (const p of onSide([[1.72, 0.38], [1.62, 0.38], [1.62, 0.42], [1.72, 0.42]], AMBER)) trim.push(p);

  // Door mirrors at the front corner of the door glass.
  const m = (x, y, z) => [x, y, z];
  const mirrorBox = [
    { pts: [m(0.83, 0.86, 0.47), m(0.97, 0.87, 0.45), m(0.97, 0.98, 0.45), m(0.83, 0.97, 0.47)], out: [0, 0, 1] },
    { pts: [m(0.83, 0.86, 0.37), m(0.97, 0.87, 0.37), m(0.97, 0.98, 0.37), m(0.83, 0.97, 0.37)], out: [0, 0, -1] },
    { pts: [m(0.97, 0.87, 0.45), m(0.97, 0.87, 0.37), m(0.97, 0.98, 0.37), m(0.97, 0.98, 0.45)], out: [1, 0, 0] },
    { pts: [m(0.83, 0.97, 0.47), m(0.97, 0.98, 0.45), m(0.97, 0.98, 0.37), m(0.83, 0.97, 0.37)], out: [0, 1, 0] },
    { pts: [m(0.83, 0.86, 0.47), m(0.97, 0.87, 0.45), m(0.97, 0.87, 0.37), m(0.83, 0.86, 0.37)], out: [0, -1, 0] },
    // Black triangular mount in the corner of the window.
    { pts: [m(0.82, 0.86, 0.66), m(0.82, 0.86, 0.38), m(0.8, 1.0, 0.45)], out: [1, 0, 0] },
  ];
  for (const poly of mirrorBox) for (const p of both({ ...poly, color: BLACK })) trim.push(p);

  // Big rear wing on two uprights, with kicked-up tips.
  const lead = [-1.42, 0.985];
  const trail = [-1.8, 1.02];
  const span = 0.74;
  const thick = 0.03;
  paint.push({ pts: [[span, lead[1], lead[0]], [-span, lead[1], lead[0]], [-span, trail[1], trail[0]], [span, trail[1], trail[0]]], out: [0, 1, 0.1] });
  paint.push({ pts: [[span, lead[1] - thick, lead[0]], [-span, lead[1] - thick, lead[0]], [-span, trail[1] - thick, trail[0]], [span, trail[1] - thick, trail[0]]], out: [0, -1, 0] });
  paint.push({ pts: [[span, trail[1], trail[0]], [-span, trail[1], trail[0]], [-span, trail[1] - thick, trail[0]], [span, trail[1] - thick, trail[0]]], out: [0, 0, -1] });
  paint.push({ pts: [[span, lead[1], lead[0]], [-span, lead[1], lead[0]], [-span, lead[1] - thick, lead[0]], [span, lead[1] - thick, lead[0]]], out: [0, 0, 1] });
  for (const side of [1, -1]) {
    // Tip plate rising toward the trailing edge.
    paint.push({ pts: [[side * span, lead[1] - thick, lead[0]], [side * span, trail[1] - thick, trail[0]], [side * span, trail[1] + 0.07, trail[0] - 0.01], [side * span, lead[1] + 0.01, lead[0] - 0.08]], out: [side, 0, 0] });
    paint.push({ pts: [[side * (span - 0.01), lead[1] - thick, lead[0]], [side * (span - 0.01), trail[1] - thick, trail[0]], [side * (span - 0.01), trail[1] + 0.07, trail[0] - 0.01], [side * (span - 0.01), lead[1] + 0.01, lead[0] - 0.08]], out: [-side, 0, 0] });
    // Upright from the engine lid.
    const x = side * 0.56;
    const dz = section(-1.6).deck;
    for (const dx of [0.025, -0.025]) {
      paint.push({ pts: [[x + dx, dz, -1.52], [x + dx, 1.0, -1.5], [x + dx, 1.005, -1.66], [x + dx, dz, -1.64]], out: [dx > 0 ? 1 : -1, 0, 0] });
    }
  }

  // Tail: lamp clusters at each end of a black panel that carries the number plate.
  const [zt0, yt0] = TAIL_TOP;
  const [zt1, yt1] = TAIL_BOTTOM;
  const tz = (y) => zt0 + ((y - yt0) * (zt1 - zt0)) / (yt1 - yt0) - 0.006;
  const onTail = (x0, x1, y0, y1, dz = 0) => [
    [x0, y0, tz(y0) - dz],
    [x1, y0, tz(y0) - dz],
    [x1, y1, tz(y1) - dz],
    [x0, y1, tz(y1) - dz],
  ];
  trim.push({ pts: onTail(0.79, -0.79, 0.585, 0.805), color: BLACK, out: [0, 0.3, -1] });
  for (const side of [1, -1]) {
    tail.push({ pts: onTail(side * 0.76, side * 0.43, 0.71, 0.795, 0.003), out: [0, 0.3, -1] });
    trim.push({ pts: onTail(side * 0.76, side * 0.52, 0.6, 0.69, 0.003), color: AMBER, out: [0, 0.3, -1] });
    trim.push({ pts: onTail(side * 0.52, side * 0.43, 0.6, 0.69, 0.003), color: [0.86, 0.86, 0.84], out: [0, 0.3, -1] });
  }
  trim.push({ pts: onTail(0.2, -0.2, 0.62, 0.74, 0.003), color: PLATE, out: [0, 0.3, -1] });
  // Rear bumper: pinstripe and a black slotted valance underneath.
  const zr = TAIL - 0.006;
  trim.push({ pts: [[0.76, 0.465, zr], [0.76, 0.472, zr], [-0.76, 0.472, zr], [-0.76, 0.465, zr]], color: [0.85, 0.82, 0.78], out: [0, 0, -1] });
  trim.push({ pts: [[0.74, 0.3, zr], [0.74, 0.39, zr], [-0.74, 0.39, zr], [-0.74, 0.3, zr]], color: BLACK, out: [0, 0, -1] });

  // Nose: pinstripe, amber indicators set into the bumper, black intake and lower lip.
  const zn = NOSE + 0.006;
  trim.push({ pts: [[0.7, 0.455, zn], [0.7, 0.463, zn], [-0.7, 0.463, zn], [-0.7, 0.455, zn]], color: [0.85, 0.82, 0.78], out: [0, 0, 1] });
  for (const side of [1, -1]) {
    trim.push({ pts: [[side * 0.62, 0.37, zn], [side * 0.62, 0.43, zn], [side * 0.42, 0.43, zn], [side * 0.42, 0.37, zn]], color: AMBER, out: [0, 0, 1] });
  }
  trim.push({ pts: [[0.5, 0.28, zn], [0.5, 0.345, zn], [-0.5, 0.345, zn], [-0.5, 0.28, zn]], color: BLACK, out: [0, 0, 1] });
  trim.push({ pts: [[0.7, 0.2, 1.94], [0.7, 0.27, 1.97], [-0.7, 0.27, 1.97], [-0.7, 0.2, 1.94]], color: BLACK, out: [0, -0.2, 1] });
  return { paint, trim, tail };
}

// ---------- Wheels: 14-inch ten-hole alloys on 185/60 tyres ----------

function wheelGeometry() {
  const r = WHEEL_R;
  const w = 0.185;
  const segs = 20;
  const polys = [];
  const tyre = [0.12, 0.12, 0.13];
  const wall = [0.17, 0.17, 0.18];
  const alloy = [0.8, 0.78, 0.7];
  const hole = [0.12, 0.12, 0.13];
  const p = (a, x, rad) => [x, Math.sin(a) * rad, Math.cos(a) * rad];
  const ox = w / 2;
  for (let s = 0; s < segs; s++) {
    const a0 = (s / segs) * Math.PI * 2;
    const a1 = ((s + 1) / segs) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    polys.push({ pts: [p(a0, ox, r), p(a1, ox, r), p(a1, -ox, r), p(a0, -ox, r)], color: tyre, out: [0, Math.sin(am), Math.cos(am)] });
    // Outer face: sidewall, rim lip, ring of ten holes, solid dish, hub.
    const rings = [
      [r, r * 0.76, wall, ox],
      [r * 0.76, r * 0.7, alloy, ox + 0.005],
      [r * 0.7, r * 0.46, s % 2 ? alloy : hole, ox + 0.01],
      [r * 0.46, r * 0.18, alloy, ox + 0.014],
      [r * 0.18, 0, [0.55, 0.54, 0.5], ox + 0.02],
    ];
    for (const [ro, ri, c, x] of rings) {
      const pts = ri > 0 ? [p(a0, x, ro), p(a1, x, ro), p(a1, x, ri), p(a0, x, ri)] : [p(a0, x, ro), p(a1, x, ro), [x, 0, 0]];
      polys.push({ pts, color: c, out: [1, 0, 0] });
    }
    polys.push({ pts: [[-ox, 0, 0], p(a0, -ox, r), p(a1, -ox, r)], color: tyre, out: [-1, 0, 0] });
  }
  return polyGeometry(polys, [0, 0, 0]);
}

// ---------- Pop-up headlights ----------

const LAMP_X = 0.52;
const LAMP_HW = 0.19;
const LAMP_LEN = 0.33;
const LAMP_DEPTH = 0.15;
const LAMP_HINGE_Z = 1.48;
const LAMP_LIFT = 0.12; // how far the unit rises when open
const LAMP_TILT = 0.55; // radians the unit tips up at the front when open

function popupParts() {
  // In hinge space the painted lid lies in y = 0 from z = 0 forward. The front face is raked back by
  // LAMP_TILT so that when the unit lifts and tips up by that angle, the rectangular lamp faces
  // straight ahead under an angled lid, like the real car. Closed, the whole unit hides under the lid.
  const x0 = -LAMP_HW;
  const x1 = LAMP_HW;
  const L = LAMP_LEN;
  const d = LAMP_DEPTH;
  const fz = (depth) => L - depth * Math.sin(LAMP_TILT);
  const fy = (depth) => -depth * Math.cos(LAMP_TILT);
  const lid = [{ pts: [[x0, 0, 0], [x1, 0, 0], [x1, 0, L], [x0, 0, L]], out: [0, 1, 0] }];
  const box = [
    { pts: [[x0, fy(d), 0], [x1, fy(d), 0], [x1, fy(d), fz(d)], [x0, fy(d), fz(d)]], color: BLACK, out: [0, -1, 0] },
    { pts: [[x0, 0, L], [x1, 0, L], [x1, fy(d), fz(d)], [x0, fy(d), fz(d)]], color: BLACK, out: [0, 0.3, 1] },
    { pts: [[x0, 0, 0], [x1, 0, 0], [x1, fy(d), 0], [x0, fy(d), 0]], color: BLACK, out: [0, 0, -1] },
    { pts: [[x0, 0, 0], [x0, 0, L], [x0, fy(d), fz(d)], [x0, fy(d), 0]], color: BLACK, out: [-1, 0, 0] },
    { pts: [[x1, 0, 0], [x1, 0, L], [x1, fy(d), fz(d)], [x1, fy(d), 0]], color: BLACK, out: [1, 0, 0] },
  ];
  const a = 0.022;
  const b = d - 0.02;
  const lamp = [{ pts: [[x0 + 0.04, fy(a), fz(a) + 0.003], [x1 - 0.04, fy(a), fz(a) + 0.003], [x1 - 0.04, fy(b), fz(b) + 0.003], [x0 + 0.04, fy(b), fz(b) + 0.003]], out: [0, 0.3, 1] }];
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
