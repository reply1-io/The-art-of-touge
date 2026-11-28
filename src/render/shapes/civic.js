// Low-poly Honda Civic Si hatchback (EF, 1988-91), built the same way as the E30: cross-sections
// along the car for the body, a separate glasshouse, and flat detail panels. Body space as the
// E30's: +x left, +y up from the ground, +z forward. Wheelbase 2.50 m, 3.97 m long, 1.68 m wide,
// 1.33 m tall.
// The EF's look: a low, flat bonnet that runs straight out to a thin nose, slim flush headlamps
// either side of a slot grille, a shoulder line that climbs gently towards the back, a big airy
// glasshouse with thin pillars and a long flat roof, and the chopped Kammback tail with its
// near-upright glass hatch and full-width band of tail lamps.
import { WHITE, BLACK, TRIM, GLASS, CHROME, UNDER, AMBER, mirror, both, lerpTable } from './poly.js';

export const FRONT_AXLE = 1.25;
export const REAR_AXLE = -1.25;
const WHEEL_R = 0.29;
const ARCH_R = 0.355;
export const NOSE = 2.08; // a front-driver's longer front overhang
export const TAIL = -1.89; // and a short, chopped tail
const RED = [0.85, 0.08, 0.08];
const DARK_RED = [0.42, 0.04, 0.05];
const LENS = [0.86, 0.88, 0.9];
const INK = [0.012, 0.012, 0.014];

// Half width: square, slab sides, rounded off only at the very corners.
const HALF_WIDTH = [
  [2.08, 0.78],
  [2.05, 0.81],
  [1.95, 0.83],
  [1.6, 0.835],
  [-1.6, 0.835],
  [-1.82, 0.83],
  [-1.89, 0.8],
];
const BOTTOM = [
  [2.08, 0.42],
  [2.06, 0.26],
  [1.9, 0.2],
  [-1.7, 0.2],
  [-1.85, 0.27],
  [-1.89, 0.4],
];
// Shoulder: low at the nose, climbing slowly all the way back (the EF's gentle wedge).
const BELT = [
  [2.08, 0.66],
  [2.0, 0.685],
  [1.3, 0.72],
  [0.88, 0.75],
  [0.0, 0.775],
  [-1.0, 0.8],
  [-1.75, 0.82],
  [-1.85, 0.82],
  [-1.89, 0.79],
];
// Centreline: a long, flat, gently sloping bonnet; under the glass, the hatch's short deck.
const TOP = [
  [2.08, 0.67],
  [2.0, 0.7],
  [1.3, 0.745],
  [0.88, 0.775],
  [0.0, 0.8],
  [-1.75, 0.84],
  [-1.85, 0.845],
  [-1.89, 0.81],
];

export function section(z) {
  let bottom = lerpTable(BOTTOM, z);
  for (const zc of [FRONT_AXLE, REAR_AXLE]) {
    const dz = z - zc;
    if (Math.abs(dz) < ARCH_R) bottom = Math.max(bottom, WHEEL_R + Math.sqrt(ARCH_R * ARCH_R - dz * dz));
  }
  const belt = lerpTable(BELT, z);
  return { hw: lerpTable(HALF_WIDTH, z), bottom, belt, top: lerpTable(TOP, z), rub: Math.max(bottom + 0.02, 0.44) };
}

// One cross-section, left side, from the sill up and over to the centreline: straight slab sides
// like the E30's, a crisp shoulder, and a nearly flat bonnet.
function ring(z) {
  const s = section(z);
  return [
    [s.hw * 0.95, s.bottom, z],
    [s.hw, Math.min(s.rub, s.belt - 0.06), z],
    [s.hw, s.belt - 0.04, z],
    [s.hw * 0.975, s.belt, z],
    [s.hw * 0.55, s.top - 0.003, z],
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
    // The shell's top under the glasshouse is hidden in the in-car view.
    const inCabin = stations[i] <= SCREEN_BASE_Z && stations[i + 1] >= HATCH_BASE_Z;
    for (let k = 0; k < a.length - 1; k++) (inCabin && k >= 3 && k <= 6 ? cabinTop : paint).push({ pts: [a[k], a[k + 1], b[k + 1], b[k]] });
    trim.push({ pts: [a[0], a[a.length - 1], b[b.length - 1], b[0]], color: UNDER, out: [0, -1, 0] });
    // Wide black rubbing strip along the doors and wings (the EF's is broad and low).
    const s0 = section(stations[i]);
    const s1 = section(stations[i + 1]);
    if (s0.bottom < 0.4 && s1.bottom < 0.4) {
      for (const p of both({
        pts: [
          [s0.hw + 0.006, 0.4, stations[i]],
          [s0.hw + 0.006, 0.47, stations[i]],
          [s1.hw + 0.006, 0.47, stations[i + 1]],
          [s1.hw + 0.006, 0.4, stations[i + 1]],
        ],
        color: TRIM,
        molding: true,
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
  // Wheel-well liners.
  for (const zc of [FRONT_AXLE, REAR_AXLE]) {
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const an = (Math.PI * k) / 12;
      pts.push([0, WHEEL_R + Math.sin(an) * ARCH_R, zc + Math.cos(an) * ARCH_R]);
    }
    pts.push([0, 0.15, zc - ARCH_R], [0, 0.15, zc + ARCH_R]);
    for (const side of [1, -1]) trim.push({ pts: pts.map((p) => [side * 0.6, p[1], p[2]]), color: UNDER, out: [side, 0, 0] });
  }
  return { paint, trim, cabinTop };
}

// ---------- Greenhouse: big glass, thin pillars, long flat roof, upright glass hatch ----------
const SCREEN_BASE_Z = 0.88;
const SCREEN_TOP_Z = 0.02;
const ROOF_REAR_Z = -1.3;
const HATCH_BASE_Z = -1.78;
const ROOF_Y = 1.33;
const ROOF_HW = 0.61;
const B_PILLAR = [-0.36, -0.42];
const C_PILLAR = [-1.0, -1.12]; // black trim between the rear quarter glass and the hatch

function cabinTop(z) {
  if (z >= SCREEN_TOP_Z) {
    const t = (SCREEN_BASE_Z - z) / (SCREEN_BASE_Z - SCREEN_TOP_Z);
    const base = section(SCREEN_BASE_Z).belt;
    return { y: base + (ROOF_Y - base) * t, hw: 0.72 + (ROOF_HW - 0.72) * t };
  }
  if (z >= ROOF_REAR_Z) return { y: ROOF_Y, hw: ROOF_HW };
  // The hatch: a short, steep fall to the deck.
  const t = (ROOF_REAR_Z - z) / (ROOF_REAR_Z - HATCH_BASE_Z);
  const base = section(HATCH_BASE_Z).belt + 0.02;
  return { y: ROOF_Y - (ROOF_Y - base) * t, hw: ROOF_HW + (0.7 - ROOF_HW) * t };
}

function greenhousePolys() {
  const paint = [];
  const glass = [];
  const trim = [];
  const zs = [0.88, 0.6, 0.3, 0.02, -0.36, -0.42, -0.7, -1.0, -1.12, -1.3, -1.55, -1.78];
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
    const hatch = mid < ROOF_REAR_Z;
    const bPillar = mid < B_PILLAR[0] && mid > B_PILLAR[1];
    const cPillar = mid < C_PILLAR[0] && mid > C_PILLAR[1];
    // Behind the C-pillar the sides close in body colour round the top of the hatch.
    const sail = hatch;
    const pillar = bPillar || cPillar;
    for (const p of both({ pts: [a.lb, a.lt, b.lt, b.lb], color: pillar ? BLACK : sail ? WHITE : GLASS })) (pillar ? trim : sail ? paint : glass).push(p);
    const top = { pts: [a.lt, mirror(a.lt), mirror(b.lt), b.lt], color: screen || hatch ? GLASS : WHITE, out: [0, 1, screen ? 0.8 : hatch ? -1.2 : 0] };
    (screen || hatch ? glass : paint).push(top);
    // Body-colour gutter along the roof edge and A-pillars; black seals round the glass hatch.
    for (const p of both({ pts: [a.lt, b.lt, off(b.lt, 0.005, -0.03), off(a.lt, 0.005, -0.03)], out: [1, 0.3, 0] })) paint.push(p);
    if (screen) for (const p of both({ pts: [off(a.lt, 0, 0.004), off(b.lt, 0, 0.004), off(b.lt, -0.055, 0.004), off(a.lt, -0.055, 0.004)], out: [0, 1, 0.8] })) paint.push(p);
    if (hatch) for (const p of both({ pts: [off(a.lt, 0, 0.004), off(b.lt, 0, 0.004), off(b.lt, -0.05, 0.004), off(a.lt, -0.05, 0.004)], color: BLACK, out: [0, 1, -1.2] })) trim.push(p);
    // Black window seal along the shoulder.
    if (!sail) for (const p of both({ pts: [a.lb, off(a.lb, -0.01, 0.02), off(b.lb, -0.01, 0.02), b.lb], color: BLACK, out: [1, 0.2, 0] })) trim.push(p);
  }
  // A small roof spoiler lip over the top of the hatch glass (the Si's).
  const r = rings.find((g) => g.z === ROOF_REAR_Z);
  const lz = ROOF_REAR_Z - 0.09;
  paint.push({ pts: [r.lt, mirror(r.lt), [-(r.lt[0] - 0.02), ROOF_Y + 0.012, lz], [r.lt[0] - 0.02, ROOF_Y + 0.012, lz]], out: [0, 1, -0.2] });
  return { paint, glass, trim };
}

// ---------- Details: nose, tail, bumpers, lamps, mirrors ----------
// Flush headlamps: [x outer, x inner, y bottom, y top] each side of the grille.
const LAMP = [0.79, 0.3, 0.575, 0.655];

function detailPolys() {
  const trim = [];
  const chrome = [];
  const tail = [];
  const head = [];
  const grille = []; // textured with slats
  const zn = NOSE + 0.006;
  const front = (x0, x1, y0, y1, color, list = trim, z = zn) => list.push({ pts: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], color, out: [0, 0, 1] });
  // A black band across the nose, with the lamps and the slot grille set into it.
  front(0.8, -0.8, 0.565, 0.665, BLACK, trim, zn - 0.001);
  for (const side of [1, -1]) {
    const [xo, xi, y0, y1] = LAMP;
    // The lamp lens, with the amber corner lamp wrapping round the outer end.
    front(side * (xo - 0.1), side * xi, y0 + 0.006, y1 - 0.006, LENS, head, zn + 0.002);
    front(side * xo, side * (xo - 0.1), y0 + 0.006, y1 - 0.006, AMBER, trim, zn + 0.002);
    trim.push({ pts: [[side * (xo + 0.016), y0 + 0.006, zn - 0.08], [side * (xo + 0.016), y1 - 0.006, zn - 0.08], [side * (xo + 0.006), y1 - 0.006, zn - 0.004], [side * (xo + 0.006), y0 + 0.006, zn - 0.004]], color: AMBER, out: [side, 0, 0.3] });
    // Lens ribs: a dark divider down each lamp.
    front(side * (xi + 0.17), side * (xi + 0.18), y0 + 0.006, y1 - 0.006, TRIM, trim, zn + 0.003);
  }
  // Slot grille between the lamps, and the badge.
  grille.push({ pts: [[0.29, 0.585, zn + 0.002], [-0.29, 0.585, zn + 0.002], [-0.29, 0.645, zn + 0.002], [0.29, 0.645, zn + 0.002]], color: BLACK, out: [0, 0, 1] });
  front(0.035, -0.035, 0.595, 0.635, CHROME, chrome, zn + 0.004);
  // Body-colour bumpers with a broad black strip, wrapping round the corners.
  const dam = [];
  const bumper = (z0, z1, y0, y1, hw) => {
    const d = Math.sign(z1);
    const face = (pts, out) => dam.push({ pts, out });
    face([[hw, y0, z1], [hw, y1, z1], [-hw, y1, z1], [-hw, y0, z1]], [0, 0, d]);
    face([[hw, y1, z0], [hw, y1, z1], [-hw, y1, z1], [-hw, y1, z0]], [0, 1, 0]);
    face([[hw, y0, z0], [hw, y0, z1], [-hw, y0, z1], [-hw, y0, z0]], [0, -1, 0]);
    face([[hw, y0, z0], [hw, y1, z0], [hw, y1, z1], [hw, y0, z1]], [1, 0, 0]);
    face([[-hw, y0, z0], [-hw, y1, z0], [-hw, y1, z1], [-hw, y0, z1]], [-1, 0, 0]);
    trim.push({ pts: [[hw, y1 - 0.075, z1 + d * 0.004], [hw, y1 - 0.025, z1 + d * 0.004], [-hw, y1 - 0.025, z1 + d * 0.004], [-hw, y1 - 0.075, z1 + d * 0.004]], color: TRIM, out: [0, 0, d], molding: true });
  };
  bumper(NOSE - 0.1, NOSE + 0.05, 0.25, 0.55, 0.83);
  bumper(TAIL + 0.1, TAIL - 0.06, 0.26, 0.52, 0.83);
  // Under the front bumper: a wide black intake and a lip.
  front(0.55, -0.55, 0.3, 0.38, INK, trim, NOSE + 0.054);
  front(0.78, -0.78, 0.25, 0.27, BLACK, trim, NOSE + 0.056);
  // Tail: a full-width band of lamps across the bottom of the hatch. Red outer lamps with
  // amber and clear sections, and a dark red reflector panel across the middle.
  const zt = TAIL - 0.006;
  const rear = (x0, x1, y0, y1, color, list = trim, z = zt) => list.push({ pts: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], color, out: [0, 0, -1] });
  rear(0.8, -0.8, 0.58, 0.77, BLACK, trim, zt + 0.001);
  for (const side of [1, -1]) {
    rear(side * 0.79, side * 0.36, 0.64, 0.76, RED, tail);
    rear(side * 0.79, side * 0.6, 0.59, 0.635, AMBER);
    rear(side * 0.6, side * 0.46, 0.59, 0.635, LENS);
    rear(side * 0.46, side * 0.36, 0.59, 0.635, RED, tail);
    // The lamps wrap a little round the corners.
    tail.push({ pts: [[side * 0.81, 0.6, TAIL + 0.03], [side * 0.81, 0.76, TAIL + 0.03], [side * 0.82, 0.76, TAIL + 0.12], [side * 0.82, 0.6, TAIL + 0.12]], color: RED, out: [side, 0, -0.3] });
  }
  rear(0.34, -0.34, 0.6, 0.75, DARK_RED, trim, zt - 0.002);
  // Side markers, door handles, mirrors.
  for (const side of [1, -1]) {
    trim.push({ pts: [[side * 0.836, 0.53, 1.95], [side * 0.836, 0.57, 1.95], [side * 0.836, 0.57, 1.83], [side * 0.836, 0.53, 1.83]], color: AMBER, out: [side, 0, 0] });
    trim.push({ pts: [[side * 0.834, 0.69, -0.05], [side * 0.834, 0.71, -0.05], [side * 0.834, 0.71, -0.2], [side * 0.834, 0.69, -0.2]], color: BLACK, out: [side, 0, 0] });
    // Black door mirrors at the front corner of the door glass.
    const x0 = side * 0.76;
    const x1 = side * 0.93;
    const box = [
      [[x0, 0.79, 0.74], [x1, 0.8, 0.71], [x1, 0.89, 0.71], [x0, 0.89, 0.74]],
      [[x0, 0.79, 0.63], [x1, 0.8, 0.63], [x1, 0.89, 0.63], [x0, 0.89, 0.63]],
      [[x1, 0.8, 0.71], [x1, 0.8, 0.63], [x1, 0.89, 0.63], [x1, 0.89, 0.71]],
      [[x0, 0.89, 0.74], [x1, 0.89, 0.71], [x1, 0.89, 0.63], [x0, 0.89, 0.63]],
    ];
    for (const pts of box) trim.push({ pts, color: BLACK });
  }
  return { trim, chrome, tail, head, grille, paint: dam };
}

export function build() {
  return { shell: shellPolys(), cabin: greenhousePolys(), detail: detailPolys() };
}

export const CIVIC_SHAPE = {
  id: 'civic',
  build,
  section,
  nose: NOSE,
  tail: TAIL,
  plate: { y: 0.395, z: TAIL - 0.068 }, // on the rear bumper, under the lamps
  pipe: [-0.5, 0.24, TAIL + 0.1],
  door: -0.1,
};
