// Low-poly Mazda RX-7 (FC3S, 1986-92) coupe body, in the same body space as the E30:
// +x left, +y up from the ground, +z forward. Wheelbase 2.43 m, 4.29 m long, 1.69 m wide,
// 1.27 m tall. A low wedge nose with pop-up headlamps and no grille (a rotary barely needs one),
// blistered arches, a steep screen and short roof, a big wrap-round glass hatch, and full-width
// tail lamps.
import { WHITE, BLACK, TRIM, UNDER, AMBER, mirror, both, lerpTable } from './poly.js';

export const FRONT_AXLE = 1.2;
export const REAR_AXLE = -1.23;
const WHEEL_R = 0.305;
const ARCH_R = 0.38;
export const NOSE = 2.05;
export const TAIL = -2.24;
const RED = [0.85, 0.08, 0.08];
const CLEAR = [0.82, 0.83, 0.8];
const INK = [0.012, 0.012, 0.014]; // deep black for openings, so bright light can't wash them out
const DARK_GLASS = [0.05, 0.065, 0.085]; // tinted; the big hatch would otherwise read as a pale roof

// Half width of the body: narrow wedge nose, swelling over the front and rear arches.
const HALF_WIDTH = [
  [2.05, 0.74],
  [1.98, 0.8],
  [1.75, 0.835],
  [1.45, 0.85],
  [0.95, 0.835],
  [0.2, 0.83],
  [-0.7, 0.835],
  [-1.05, 0.852],
  [-1.5, 0.852],
  [-1.95, 0.83],
  [-2.2, 0.8],
  [-2.24, 0.77],
];
const BOTTOM = [
  [2.05, 0.19], // a tall front bumper face, down to a low chin
  [2.0, 0.17],
  [1.8, 0.16],
  [-1.85, 0.18],
  [-2.12, 0.27],
  [-2.24, 0.42],
];
// Top of the flanks: a low front wing that rises steadily to the high, short tail.
const BELT = [
  [2.05, 0.57],
  [1.95, 0.64],
  [1.6, 0.7],
  [1.2, 0.72],
  [0.72, 0.745],
  [0.0, 0.77],
  [-0.8, 0.8],
  [-1.6, 0.85],
  [-2.05, 0.885],
  [-2.2, 0.87],
  [-2.24, 0.8],
];
// Centreline: a long, flat, low bonnet, then (under the glass) the hatch deck and spoiler lip.
const TOP = [
  [2.05, 0.58],
  [1.95, 0.65],
  [1.5, 0.705],
  [0.72, 0.755],
  [0.0, 0.78],
  [-1.72, 0.88],
  [-2.02, 0.915],
  [-2.2, 0.9],
  [-2.24, 0.82],
];

export function section(z) {
  let bottom = lerpTable(BOTTOM, z);
  for (const zc of [FRONT_AXLE, REAR_AXLE]) {
    const dz = z - zc;
    if (Math.abs(dz) < ARCH_R) bottom = Math.max(bottom, WHEEL_R + Math.sqrt(ARCH_R * ARCH_R - dz * dz));
  }
  const belt = lerpTable(BELT, z);
  return { hw: lerpTable(HALF_WIDTH, z), bottom, belt, top: lerpTable(TOP, z), rub: Math.max(bottom + 0.02, 0.42) };
}

// One cross-section, left side, from the sill up and over to the centreline. The FC's flanks are
// rounder than the E30's slab sides: the shoulder rolls in over the top.
function ring(z) {
  const s = section(z);
  return [
    [s.hw * 0.93, s.bottom, z],
    [s.hw, Math.min(s.rub, s.belt - 0.08), z],
    [s.hw * 0.995, s.belt - 0.08, z],
    [s.hw * 0.95, s.belt, z],
    [s.hw * 0.6, s.top - 0.008, z],
    [0, s.top, z],
  ];
}

function shellPolys() {
  const paint = [];
  const trim = [];
  const cabinTop = [];
  const zs = new Set([NOSE, TAIL]);
  for (const t of [HALF_WIDTH, BOTTOM, BELT, TOP]) for (const [z] of t) zs.add(z);
  for (let z = NOSE; z > TAIL; z -= 0.12) zs.add(+z.toFixed(3));
  for (const zc of [FRONT_AXLE, REAR_AXLE]) for (let k = 0; k <= 12; k++) zs.add(+(zc - ARCH_R + (2 * ARCH_R * k) / 12).toFixed(3));
  const stations = [...zs].filter((z) => z <= NOSE && z >= TAIL).sort((a, b) => b - a);
  const rings = stations.map((z) => {
    const l = ring(z);
    return [...l, ...l.slice(0, 5).reverse().map(mirror)];
  });
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    const inCabin = stations[i] <= 0.72 && stations[i + 1] >= -1.72;
    for (let k = 0; k < a.length - 1; k++) (inCabin && k >= 3 && k <= 6 ? cabinTop : paint).push({ pts: [a[k], a[k + 1], b[k + 1], b[k]] });
    trim.push({ pts: [a[0], a[a.length - 1], b[b.length - 1], b[0]], color: UNDER, out: [0, -1, 0] });
    // Black body-side moulding along the doors.
    const s0 = section(stations[i]);
    const s1 = section(stations[i + 1]);
    if (s0.bottom < 0.36 && s1.bottom < 0.36) {
      for (const p of both({
        pts: [
          [s0.hw + 0.006, 0.4, stations[i]],
          [s0.hw + 0.006, 0.44, stations[i]],
          [s1.hw + 0.006, 0.44, stations[i + 1]],
          [s1.hw + 0.006, 0.4, stations[i + 1]],
        ],
        color: TRIM,
        out: [1, 0, 0],
      }))
        trim.push(p);
    }
  }
  for (const [r, dir] of [
    [rings[0], 1],
    [rings[rings.length - 1], -1],
  ]) {
    const c = [0, r.reduce((sum, p) => sum + p[1] / r.length, 0), r[0][2]];
    const closed = [...r, r[0]];
    for (let k = 0; k < closed.length - 1; k++) paint.push({ pts: [c, closed[k], closed[k + 1]], out: [0, 0, dir] });
  }
  for (const zc of [FRONT_AXLE, REAR_AXLE]) {
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const an = (Math.PI * k) / 12;
      pts.push([0, WHEEL_R + Math.sin(an) * ARCH_R, zc + Math.cos(an) * ARCH_R]);
    }
    pts.push([0, 0.15, zc - ARCH_R], [0, 0.15, zc + ARCH_R]);
    for (const side of [1, -1]) trim.push({ pts: pts.map((p) => [side * 0.62, p[1], p[2]]), color: UNDER, out: [side, 0, 0] });
  }
  return { paint, trim, cabinTop };
}

// ---------- Greenhouse: raked screen, short roof, fastback glass hatch ----------
const SCREEN_BASE_Z = 0.72;
const SCREEN_TOP_Z = -0.1;
const ROOF_REAR_Z = -0.5;
const HATCH_BASE_Z = -1.72;
const ROOF_Y = 1.27;
const ROOF_HW = 0.57;
const QUARTER_END_Z = -1.2; // back edge of the rear side window

function cabinTop(z) {
  if (z >= SCREEN_TOP_Z) {
    const t = (SCREEN_BASE_Z - z) / (SCREEN_BASE_Z - SCREEN_TOP_Z);
    const base = section(SCREEN_BASE_Z).belt;
    return { y: base + (ROOF_Y - 0.02 - base) * t, hw: 0.72 + (ROOF_HW - 0.72) * t }; // a flat screen: straight from base to roof
  }
  if (z >= ROOF_REAR_Z) return { y: ROOF_Y - 0.02 + 0.02 * ((SCREEN_TOP_Z - z) / (SCREEN_TOP_Z - ROOF_REAR_Z)), hw: ROOF_HW };
  // The fastback: a long, gently curved fall to the spoiler.
  const t = (ROOF_REAR_Z - z) / (ROOF_REAR_Z - HATCH_BASE_Z);
  const base = section(HATCH_BASE_Z).belt + 0.03;
  return { y: ROOF_Y - (ROOF_Y - base) * t ** 1.25, hw: ROOF_HW + (0.72 - ROOF_HW) * t };
}

function greenhousePolys() {
  const paint = [];
  const glass = [];
  const trim = [];
  const zs = [0.72, 0.5, 0.25, -0.1, -0.3, -0.5, -0.56, -0.8, -1.0, -1.2, -1.4, -1.58, -1.72];
  const rings = zs.map((z) => {
    const s = section(z);
    const t = cabinTop(z);
    return { z, lb: [s.hw * 0.94, s.belt, z], lt: [t.hw, t.y, z] };
  });
  const off = (p, dx, dy = 0) => [p[0] + dx, p[1] + dy, p[2]];
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    const mid = (a.z + b.z) / 2;
    const screen = mid > SCREEN_TOP_Z;
    const hatch = mid < ROOF_REAR_Z;
    const bPillar = mid < -0.5 && mid > -0.56; // thin black divider between door and quarter glass
    const sail = mid < QUARTER_END_Z; // body-coloured panel behind the quarter window
    // Sides: window glass, the black B-pillar strip, or the painted sail panel.
    for (const p of both({ pts: [a.lb, a.lt, b.lt, b.lb], color: bPillar ? BLACK : sail ? WHITE : DARK_GLASS })) (bPillar ? trim : sail ? paint : glass).push(p);
    // Top: windscreen, painted roof, or the big glass hatch.
    const top = { pts: [a.lt, mirror(a.lt), mirror(b.lt), b.lt], color: screen || hatch ? DARK_GLASS : WHITE, out: [0, 1, screen ? 0.8 : hatch ? -0.7 : 0] };
    (screen || hatch ? glass : paint).push(top);
    // Black seals round the glass: along the roof edge, the A-pillars, and round the hatch.
    for (const p of both({ pts: [a.lt, b.lt, off(b.lt, 0.005, -0.03), off(a.lt, 0.005, -0.03)], color: BLACK, out: [1, 0.3, 0] })) trim.push(p);
    if (screen || hatch) for (const p of both({ pts: [off(a.lt, 0, 0.004), off(b.lt, 0, 0.004), off(b.lt, -0.05, 0.004), off(a.lt, -0.05, 0.004)], color: BLACK, out: [0, 1, screen ? 0.8 : -0.7] })) trim.push(p);
    if (!sail) for (const p of both({ pts: [a.lb, off(a.lb, -0.01, 0.02), off(b.lb, -0.01, 0.02), b.lb], color: BLACK, out: [1, 0.2, 0] })) trim.push(p);
  }
  // Body-coloured spoiler lip across the bottom of the hatch.
  const last = rings[rings.length - 1];
  const lip = [last.lt, mirror(last.lt), [-(last.lt[0] + 0.02), last.lt[1] + 0.04, HATCH_BASE_Z - 0.12], [last.lt[0] + 0.02, last.lt[1] + 0.04, HATCH_BASE_Z - 0.12]];
  paint.push({ pts: lip, out: [0, 1, -0.3] });
  paint.push({ pts: [lip[3], lip[2], [-(last.lt[0] + 0.02), last.lt[1] - 0.02, HATCH_BASE_Z - 0.16], [last.lt[0] + 0.02, last.lt[1] - 0.02, HATCH_BASE_Z - 0.16]], out: [0, 0, -1] });
  return { paint, glass, trim };
}

// ---------- Details: nose, bumpers, lamps, mirrors ----------
// Pop-up headlamp pods: [x0, x1, z0 (front), z1 (back)] on top of the front wings.
export const POPUPS = [
  [0.44, 0.74, 1.93, 1.62],
  [-0.44, -0.74, 1.93, 1.62],
];

function detailPolys() {
  const trim = [];
  const tail = [];
  const paint = [];
  const zn = NOSE + 0.006;
  const front = (x0, x1, y0, y1, color, z = zn) => trim.push({ pts: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], color, out: [0, 0, 1] });
  // No grille: a slim slot in the nose; a grey strip across the bumper with amber indicators at
  // its ends; below it a big black intake with two rows of slats.
  front(0.28, -0.28, 0.52, 0.54, TRIM); // slot in the nose tip
  front(0.74, -0.74, 0.44, 0.47, TRIM); // bumper strip
  for (const side of [1, -1]) front(side * 0.56, side * 0.73, 0.44, 0.475, AMBER, zn + 0.002);
  // The intake: two rows of black slots cut into the body-colour bumper, and a small duct at each
  // corner, like the real car.
  for (const y of [0.33, 0.255]) front(0.5, -0.5, y, y + 0.045, INK);
  for (const side of [1, -1]) front(side * 0.6, side * 0.72, 0.25, 0.3, INK);
  // Bonnet vent: a black louvred scoop just ahead of the screen, a little to the left.
  const vy = (z) => section(z).top + 0.025;
  trim.push({ pts: [[0.32, vy(1.62), 1.62], [0.02, vy(1.62), 1.62], [0.02, vy(1.36), 1.36], [0.32, vy(1.36), 1.36]], color: INK, out: [0, 1, 0.1] });
  for (let k = 1; k < 4; k++) {
    const z = 1.62 - k * 0.065;
    trim.push({ pts: [[0.3, vy(z) + 0.004, z], [0.04, vy(z) + 0.004, z], [0.04, vy(z - 0.015) + 0.004, z - 0.015], [0.3, vy(z - 0.015) + 0.004, z - 0.015]], color: [0.16, 0.16, 0.18], out: [0, 1, 0.1] });
  }
  // Rear wing on two stands above the hatch.
  const wy = 0.99;
  const wz0 = -1.98;
  const wz1 = -2.18;
  const wingBox = (x0, x1, y0, y1, z0, z1) => {
    const f = [
      [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
      [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
      [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]],
      [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
    ];
    for (const pts of f) paint.push({ pts, color: WHITE });
  };
  wingBox(0.74, -0.74, wy, wy + 0.04, wz0, wz1);
  for (const x of [0.5, -0.5]) wingBox(x + 0.03, x - 0.03, section(-2.08).top - 0.01, wy, -2.04, -2.12);
  const zt = TAIL - 0.006;
  const rear = (x0, x1, y0, y1, color, list = trim, z = zt) => list.push({ pts: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], color, out: [0, 0, -1] });
  // Full-width tail lamps: red over amber and clear, in a black band across the whole tail, with
  // the lamps wrapping round onto the rear wings.
  rear(0.77, -0.77, 0.6, 0.81, BLACK, trim, zt + 0.001);
  for (const side of [1, -1]) {
    rear(side * 0.76, side * 0.3, 0.71, 0.8, RED, tail);
    rear(side * 0.76, side * 0.52, 0.61, 0.7, AMBER);
    rear(side * 0.52, side * 0.3, 0.61, 0.7, RED, tail);
    // Wrap-round onto the flank.
    const x = side * 0.79;
    tail.push({ pts: [[x, 0.62, TAIL + 0.03], [x, 0.79, TAIL + 0.03], [x - side * 0.03, 0.79, TAIL + 0.16], [x - side * 0.03, 0.62, TAIL + 0.16]], color: RED, out: [side, 0, -0.3] });
  }
  rear(0.3, -0.3, 0.62, 0.79, [0.12, 0.12, 0.13]); // centre garnish
  rear(0.76, -0.76, 0.44, 0.46, TRIM, trim, TAIL - 0.004);
  // Side markers, door handles, mirrors.
  for (const side of [1, -1]) {
    trim.push({ pts: [[side * 0.836, 0.55, 1.75], [side * 0.836, 0.59, 1.75], [side * 0.836, 0.59, 1.62], [side * 0.836, 0.55, 1.62]], color: AMBER, out: [side, 0, 0] });
    trim.push({ pts: [[side * 0.84, 0.7, -0.3], [side * 0.84, 0.72, -0.3], [side * 0.84, 0.72, -0.44], [side * 0.84, 0.7, -0.44]], color: BLACK, out: [side, 0, 0] });
    const x0 = side * 0.72;
    const x1 = side * 0.9;
    const box = [
      [[x0, 0.84, 0.56], [x1, 0.85, 0.53], [x1, 0.93, 0.53], [x0, 0.93, 0.56]],
      [[x0, 0.84, 0.44], [x1, 0.85, 0.44], [x1, 0.93, 0.44], [x0, 0.93, 0.44]],
      [[x1, 0.85, 0.53], [x1, 0.85, 0.44], [x1, 0.93, 0.44], [x1, 0.93, 0.53]],
      [[x0, 0.93, 0.56], [x1, 0.93, 0.53], [x1, 0.93, 0.44], [x0, 0.93, 0.44]],
    ];
    for (const pts of box) paint.push({ pts, color: WHITE });
    // Seams round the closed pop-up pods.
    const [px0, px1, pz0, pz1] = POPUPS[side > 0 ? 0 : 1];
    const y0 = section(pz0).belt + 0.004;
    const y1 = section(pz1).belt + 0.004;
    for (const [a, b] of [
      [[px0, y0, pz0], [px1, y0, pz0]],
      [[px0, y1, pz1], [px1, y1, pz1]],
    ])
      trim.push({ pts: [a, b, [b[0], b[1] + 0.005, b[2] - 0.012], [a[0], a[1] + 0.005, a[2] - 0.012]], color: BLACK, out: [0, 1, 0] });
  }
  return { trim, tail, paint };
}

export function build() {
  const shell = shellPolys();
  const cabin = greenhousePolys();
  const detail = detailPolys();
  return { shell, cabin, detail };
}

export const RX7_SHAPE = {
  id: 'rx7',
  build,
  section,
  nose: NOSE,
  tail: TAIL,
  plate: { y: 0.5, z: TAIL - 0.012 }, // in the rear bumper, under the lamps
  pipe: [-0.46, 0.24, TAIL + 0.12],
  door: -0.15,
  popups: POPUPS,
};
