// Low-poly BMW E30 coupe, built in code from simple shapes with flat colours.
// Body space matches the physics body: +x left, +y up, +z forward; the origin is the physics body
// origin, which rides about 0.62 m above the ground.
import * as THREE from 'three';

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
const NOSE = 2.15;
const TAIL = -2.19;

const HALF_WIDTH = [
  [2.15, 0.76],
  [2.1, 0.8],
  [1.95, 0.818],
  [-1.95, 0.818],
  [-2.12, 0.8],
  [-2.19, 0.77],
];
const BOTTOM = [
  [2.15, 0.36],
  [2.08, 0.24],
  [1.9, 0.2],
  [-1.9, 0.21],
  [-2.1, 0.26],
  [-2.19, 0.38],
];
// Top of the sides / shoulder line: wings along the bonnet, window line, boot.
const BELT = [
  [2.15, 0.7],
  [2.11, 0.75],
  [1.95, 0.77],
  [0.75, 0.84],
  [0.0, 0.875],
  [-1.5, 0.92],
  [-2.13, 0.925],
  [-2.19, 0.86],
];
// Centreline: bonnet, (cabin floor under the glass), boot lid.
const TOP = [
  [2.15, 0.71],
  [2.11, 0.765],
  [1.95, 0.785],
  [0.75, 0.855],
  [0.0, 0.88],
  [-1.5, 0.935],
  [-2.13, 0.94],
  [-2.19, 0.87],
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
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    for (let k = 0; k < a.length - 1; k++) paint.push({ pts: [a[k], a[k + 1], b[k + 1], b[k]] });
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
  return { paint, trim };
}

// ---------- Greenhouse: upright E30 glasshouse with thin pillars ----------
const ROOF_Y = 1.37;
const ROOF_HW = 0.6;
const SCREEN_BASE_Z = 0.72;
const SCREEN_TOP_Z = -0.1;
const ROOF_REAR_Z = -1.0;

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
  const zs = [0.72, 0.5, 0.25, -0.1, -0.36, -0.42, -0.7, -1.0];
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
    const pillar = mid < -0.36 && mid > -0.42; // B-pillar
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
  const sC = section(-1.45);
  const cBase = [sC.hw * 0.96, sC.belt, -1.45];
  const rwBottom = [0.66, section(-1.52).top, -1.52];
  for (const p of both({ pts: [r.lb, r.lt, cBase], out: [1, 0.2, 0] })) paint.push(p);
  for (const p of both({ pts: [r.lt, rwBottom, cBase], out: [0.4, 1, -0.4] })) paint.push(p);
  glass.push({ pts: [[r.lt[0] - 0.02, ROOF_Y - 0.01, ROOF_REAR_Z], [-(r.lt[0] - 0.02), ROOF_Y - 0.01, ROOF_REAR_Z], mirror(rwBottom), rwBottom], color: GLASS, out: [0, 0.6, -1] });
  return { paint, glass, trim };
}

// ---------- Details: nose, tail, bumpers, mirrors ----------
function detailPolys() {
  const trim = [];
  const chrome = [];
  const head = [];
  const tail = [];
  const zn = NOSE + 0.006;
  // Black grille panel across the nose with the twin kidneys.
  trim.push({ pts: [[0.74, 0.5, zn], [0.74, 0.69, zn], [-0.74, 0.69, zn], [-0.74, 0.5, zn]], color: BLACK, out: [0, 0, 1] });
  for (const x of [0.085, -0.085]) {
    chrome.push({ pts: [[x + 0.075, 0.5, zn + 0.004], [x + 0.065, 0.69, zn + 0.004], [x - 0.065, 0.69, zn + 0.004], [x - 0.075, 0.5, zn + 0.004]], color: CHROME, out: [0, 0, 1] });
    trim.push({ pts: [[x + 0.058, 0.52, zn + 0.008], [x + 0.05, 0.67, zn + 0.008], [x - 0.05, 0.67, zn + 0.008], [x - 0.058, 0.52, zn + 0.008]], color: BLACK, out: [0, 0, 1] });
  }
  // Square headlamps, two each side.
  for (const side of [1, -1]) {
    for (const [x0, x1] of [
      [0.22, 0.42],
      [0.46, 0.66],
    ]) {
      head.push({ pts: [[side * x0, 0.53, zn + 0.006], [side * x1, 0.53, zn + 0.006], [side * x1, 0.67, zn + 0.006], [side * x0, 0.67, zn + 0.006]], out: [0, 0, 1] });
    }
    // Amber corner indicators.
    trim.push({ pts: [[side * 0.69, 0.53, zn + 0.004], [side * 0.74, 0.53, zn + 0.004], [side * 0.74, 0.67, zn + 0.004], [side * 0.69, 0.67, zn + 0.004]], color: AMBER, out: [0, 0, 1] });
  }
  // Chrome-style bumpers (boxes standing proud of the body).
  const bumper = (z0, z1, y0, y1, hw) => {
    const b = [];
    const face = (pts, out) => b.push({ pts, color: CHROME, out });
    face([[hw, y0, z1], [hw, y1, z1], [-hw, y1, z1], [-hw, y0, z1]], [0, 0, Math.sign(z1)]);
    face([[hw, y1, z0], [hw, y1, z1], [-hw, y1, z1], [-hw, y1, z0]], [0, 1, 0]);
    face([[hw, y0, z0], [hw, y0, z1], [-hw, y0, z1], [-hw, y0, z0]], [0, -1, 0]);
    face([[hw, y0, z0], [hw, y1, z0], [hw, y1, z1], [hw, y0, z1]], [1, 0, 0]);
    face([[-hw, y0, z0], [-hw, y1, z0], [-hw, y1, z1], [-hw, y0, z1]], [-1, 0, 0]);
    // Black rubber insert along the middle.
    b.push({ pts: [[hw, y0 + 0.04, z1 + Math.sign(z1) * 0.004], [hw, y1 - 0.05, z1 + Math.sign(z1) * 0.004], [-hw, y1 - 0.05, z1 + Math.sign(z1) * 0.004], [-hw, y0 + 0.04, z1 + Math.sign(z1) * 0.004]], color: TRIM, out: [0, 0, Math.sign(z1)] });
    return b;
  };
  chrome.push(...bumper(NOSE - 0.05, NOSE + 0.1, 0.33, 0.47, 0.83));
  chrome.push(...bumper(TAIL + 0.05, TAIL - 0.1, 0.35, 0.49, 0.83));
  // Tail: red / amber lamp clusters with a black centre panel and number plate.
  const zt = TAIL - 0.006;
  trim.push({ pts: [[0.78, 0.58, zt], [0.78, 0.8, zt], [-0.78, 0.8, zt], [-0.78, 0.58, zt]], color: BLACK, out: [0, 0, -1] });
  for (const side of [1, -1]) {
    tail.push({ pts: [[side * 0.77, 0.68, zt - 0.004], [side * 0.36, 0.68, zt - 0.004], [side * 0.36, 0.79, zt - 0.004], [side * 0.77, 0.79, zt - 0.004]], out: [0, 0, -1] });
    trim.push({ pts: [[side * 0.77, 0.6, zt - 0.004], [side * 0.56, 0.6, zt - 0.004], [side * 0.56, 0.67, zt - 0.004], [side * 0.77, 0.67, zt - 0.004]], color: AMBER, out: [0, 0, -1] });
    trim.push({ pts: [[side * 0.55, 0.6, zt - 0.004], [side * 0.36, 0.6, zt - 0.004], [side * 0.36, 0.67, zt - 0.004], [side * 0.55, 0.67, zt - 0.004]], color: [0.85, 0.85, 0.85], out: [0, 0, -1] });
  }
  trim.push({ pts: [[0.25, 0.6, zt - 0.006], [-0.25, 0.6, zt - 0.006], [-0.25, 0.71, zt - 0.006], [0.25, 0.71, zt - 0.006]], color: [0.9, 0.9, 0.85], out: [0, 0, -1] });
  // Door mirrors.
  for (const side of [1, -1]) {
    const x0 = side * 0.8;
    const x1 = side * 0.95;
    const box = [
      [[x0, 0.88, 0.62], [x1, 0.89, 0.6], [x1, 0.98, 0.6], [x0, 0.98, 0.62]],
      [[x0, 0.88, 0.52], [x1, 0.89, 0.52], [x1, 0.98, 0.52], [x0, 0.98, 0.52]],
      [[x1, 0.89, 0.6], [x1, 0.89, 0.52], [x1, 0.98, 0.52], [x1, 0.98, 0.6]],
      [[x0, 0.98, 0.62], [x1, 0.98, 0.6], [x1, 0.98, 0.52], [x0, 0.98, 0.52]],
    ];
    for (const pts of box) trim.push({ pts, color: BLACK });
  }
  return { trim, chrome, head, tail };
}

// ---------- BBS-style cross-spoke mesh wheel ----------
function bbsTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1a1c';
  g.fillRect(0, 0, 128, 128);
  // Polished lip.
  g.fillStyle = '#d8dadf';
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#26272b';
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.fill();
  // Cross-spoke mesh: pairs of angled spokes that form diamonds.
  g.strokeStyle = '#c7c9cf';
  g.lineWidth = 4;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    for (const d of [0.32, -0.32]) {
      g.beginPath();
      g.moveTo(64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14);
      g.lineTo(64 + Math.cos(a + d) * 52, 64 + Math.sin(a + d) * 52);
      g.stroke();
    }
  }
  g.fillStyle = '#b9bbc1';
  g.beginPath();
  g.arc(64, 64, 15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2b2c30';
  g.beginPath();
  g.arc(64, 64, 6, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeWheel(material, faceMaterial) {
  const group = new THREE.Group();
  const tyre = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.195, 16, 1, true);
  tyre.rotateZ(Math.PI / 2);
  group.add(new THREE.Mesh(tyre, material));
  const face = new THREE.CircleGeometry(WHEEL_R * 0.98, 16);
  face.rotateY(Math.PI / 2);
  const outer = new THREE.Mesh(face, faceMaterial);
  outer.position.x = 0.1;
  group.add(outer);
  const back = new THREE.Mesh(face.clone().rotateY(Math.PI), material);
  back.position.x = -0.1;
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
    this.tailMat = new THREE.MeshLambertMaterial({ color: 0x8a0d0d, emissive: 0x000000, flatShading: true });

    const shell = bodyPolys();
    const cabin = greenhousePolys();
    const detail = detailPolys();
    body.add(new THREE.Mesh(polyGeometry([...shell.paint, ...shell.trim, ...cabin.paint, ...cabin.trim, ...detail.trim, ...detail.chrome]), flat));
    body.add(new THREE.Mesh(polyGeometry(cabin.glass), glassMat));
    body.add(new THREE.Mesh(polyGeometry(detail.head), this.headMat));
    body.add(new THREE.Mesh(polyGeometry(detail.tail), this.tailMat));

    const tyreMat = new THREE.MeshLambertMaterial({ color: 0x151517 });
    const faceMat = new THREE.MeshLambertMaterial({ map: bbsTexture() });
    this.wheels = [];
    for (let i = 0; i < 4; i++) {
      const steer = new THREE.Group();
      const spin = makeWheel(tyreMat, faceMat);
      if (i % 2 === 1) spin.scale.x = -1; // right-hand wheels: rim faces outward
      steer.add(spin);
      this.root.add(steer);
      this.wheels.push({ steer, spin });
    }
  }

  setLights(on, braking) {
    this.headMat.emissive.setHex(on ? 0xfff2cc : 0x000000);
    this.tailMat.emissive.setHex(braking ? 0xff1a1a : on ? 0x550000 : 0x000000);
  }

  // Place the wheels from the simulation: suspension travel, steering and spin.
  syncWheels(vehicle) {
    const s = this.spec;
    for (let i = 0; i < 4; i++) {
      const w = vehicle.wheels[i];
      const m = this.wheels[i];
      m.steer.position.set(w.x, s.wheelMountY - s.suspensionRest + w.compression, w.z);
      m.steer.rotation.set(0, w.steer, 0);
      m.spin.rotation.x = w.angle;
    }
  }
}
