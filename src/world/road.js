// The pass as a spline: centreline, elevation, camber and drainage gutters, plus queries.
// Pure JavaScript (no Three.js or Rapier) so it can be tested in Node.
//
// World axes: x east, z south, y up. Heading h: forward = (sin h, cos h) in (x, z),
// left = (cos h, -sin h). Positive curvature turns left; positive bank raises the left edge.

import { AKINA_POINTS } from './akinaMap.js';

export const STEP = 2; // metres between centreline samples
export const HALF = 3.4; // half the asphalt width (two narrow lanes)
export const SHOULDER = 4.6; // end of the gravel shoulder
export const VERGE = 8.4; // end of the verge strip that blends into the terrain
export const RAIL = 4.15; // guardrail line
export const WALL = 9.6; // invisible wall line
export const GUTTER_IN = 3.42;
export const GUTTER_OUT = 3.85;
export const GUTTER_DEPTH = 0.2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function smooth(src, window, passes = 1) {
  let a = Float64Array.from(src);
  const half = Math.floor(window / 2);
  for (let p = 0; p < passes; p++) {
    const out = new Float64Array(a.length);
    let sum = 0;
    let count = 0;
    for (let i = -half; i < a.length; i++) {
      const add = i + half;
      if (add < a.length) {
        sum += a[add];
        count++;
      }
      const drop = i - half - 1;
      if (drop >= 0) {
        sum -= a[drop];
        count--;
      }
      if (i >= 0) out[i] = sum / count;
    }
    a = out;
  }
  return a;
}

// Centripetal Catmull-Rom through the traced points, sampled densely.
function catmullRom(pts, perSegment = 24) {
  const out = [];
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 0; i < P.length - 3; i++) {
    const [p0, p1, p2, p3] = [P[i], P[i + 1], P[i + 2], P[i + 3]];
    const t = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t1 = t(p0, p1);
    const t2 = t1 + t(p1, p2);
    const t3 = t2 + t(p2, p3);
    for (let k = 0; k < perSegment; k++) {
      const u = t1 + ((t2 - t1) * k) / perSegment;
      const lerp = (a, b, ta, tb) => {
        const f = (u - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      };
      const A1 = lerp(p0, p1, 0, t1);
      const A2 = lerp(p1, p2, t1, t2);
      const A3 = lerp(p2, p3, t2, t3);
      const B1 = lerp(A1, A2, 0, t2);
      const B2 = lerp(A2, A3, t1, t3);
      out.push(lerp(B1, B2, t1, t2));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export class Road {
  constructor(points = AKINA_POINTS, targetLength = 5000) {
    // ---- Plan view: spline, scale to length, resample at STEP ----
    const dense = catmullRom(points);
    let pxLength = 0;
    for (let i = 1; i < dense.length; i++) pxLength += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
    this.mapScale = targetLength / pxLength;
    const world = dense.map(([px, py]) => [px * this.mapScale, py * this.mapScale]);
    const cum = [0];
    for (let i = 1; i < world.length; i++) cum.push(cum[i - 1] + Math.hypot(world[i][0] - world[i - 1][0], world[i][1] - world[i - 1][1]));
    const total = cum[cum.length - 1];
    const n = Math.floor(total / STEP) + 1;
    let xs = new Float64Array(n);
    let zs = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      const f = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
      xs[i] = world[j][0] + (world[j + 1][0] - world[j][0]) * f;
      zs[i] = world[j][1] + (world[j + 1][1] - world[j][1]) * f;
    }
    // Light smoothing removes tracing jitter without opening up the hairpins.
    xs = smooth(xs, 5, 2);
    zs = smooth(zs, 5, 2);

    this.count = n;
    this.x = xs;
    this.z = zs;
    this.length = (n - 1) * STEP;
    this.heading = new Float64Array(n);
    const kappaRaw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      this.heading[i] = Math.atan2(xs[b] - xs[a], zs[b] - zs[a]);
    }
    for (let i = 1; i < n - 1; i++) {
      let d = this.heading[i + 1] - this.heading[i - 1];
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      kappaRaw[i] = d / (2 * STEP);
    }
    this.kappa = smooth(kappaRaw, 3);

    // ---- Elevation: steeper through the twisty sections, flat at the lake and in town ----
    const twist = smooth(this.kappa.map(Math.abs), 31);
    const grade = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      let g = 0.052 + 0.018 * Math.sin(s / 410 + 0.5) + 0.01 * Math.sin(s / 127 + 2);
      g += clamp(twist[i] * 0.9, 0, 0.035);
      if (s < 90) g = 0.008;
      if (s > this.length - 140) g = 0.004;
      grade[i] = g;
    }
    this.grade = smooth(grade, 25, 2);
    this.y = new Float64Array(n);
    for (let i = 1; i < n; i++) this.y[i] = this.y[i - 1] - this.grade[i] * STEP;
    const bottom = this.y[n - 1];
    for (let i = 0; i < n; i++) this.y[i] -= bottom;
    this.top = this.y[0];

    // ---- Camber: corners lean into the turn ----
    const bankRaw = this.kappa.map((k) => clamp(-k * 2.2, -0.105, 0.105));
    this.bank = smooth(bankRaw, 15, 2);

    // ---- Drainage gutters on the inside of a few medium corners ----
    this.gutterLeft = new Float64Array(n);
    this.gutterRight = new Float64Array(n);
    const corner = smooth(this.kappa, 11);
    let id = 0;
    let made = 0;
    for (let i = 0; i < n && made < 7; i++) {
      const k = corner[i];
      if (Math.abs(k) < 1 / 70 || Math.abs(k) > 1 / 20 || i * STEP < 200) continue;
      let e = i;
      while (e < n && Math.sign(corner[e]) === Math.sign(k) && Math.abs(corner[e]) > 1 / 90) e++;
      if ((e - i) * STEP > 36 && id++ % 2 === 0) {
        const arr = k > 0 ? this.gutterLeft : this.gutterRight;
        for (let q = i; q < e; q++) {
          const ramp = Math.min(1, (q - i) / 4, (e - q) / 4);
          arr[q] = GUTTER_DEPTH * ramp;
        }
        made++;
      }
      i = e;
    }

    // Start and finish lines.
    this.startIndex = Math.round(60 / STEP);
    this.finishIndex = n - 1 - Math.round(80 / STEP);
    this.#buildHash();
  }

  // ---------- Spatial hash ----------
  #buildHash() {
    this.cell = 24;
    this.hash = new Map();
    for (let i = 0; i < this.count; i++) {
      const k = this.#key(Math.floor(this.x[i] / this.cell), Math.floor(this.z[i] / this.cell));
      let list = this.hash.get(k);
      if (!list) this.hash.set(k, (list = []));
      list.push(i);
    }
  }

  #key(cx, cz) {
    return cx * 73856093 + cz * 19349663;
  }

  forEachNear(x, z, radius, fn) {
    const c = this.cell;
    const r = Math.ceil(radius / c);
    const cx = Math.floor(x / c);
    const cz = Math.floor(z / c);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const list = this.hash.get(this.#key(cx + dx, cz + dz));
        if (list) for (const i of list) fn(i);
      }
    }
  }

  // Nearest sample to (x, z). With a hint (last known index) it prefers nearby samples, so where
  // two legs of the road pass close together it does not jump to the other one.
  nearestIndex(x, z, hint = -1) {
    let best = -1;
    let bestD = Infinity;
    if (hint >= 0) {
      const lo = Math.max(0, hint - 30);
      const hi = Math.min(this.count - 1, hint + 30);
      for (let i = lo; i <= hi; i++) {
        const d = (x - this.x[i]) ** 2 + (z - this.z[i]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best > lo && best < hi && bestD < 15 * 15) return best;
    }
    best = -1;
    bestD = Infinity;
    this.forEachNear(x, z, 40, (i) => {
      const d = (x - this.x[i]) ** 2 + (z - this.z[i]) ** 2 + (hint >= 0 ? Math.min(Math.abs(i - hint), 300) * 0.02 : 0);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) {
      for (let i = 0; i < this.count; i += 2) {
        const d = (x - this.x[i]) ** 2 + (z - this.z[i]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return best;
  }

  // Road information at (x, z): distance along the road s, lateral offset (left +), surface height.
  query(x, z, hint, out = {}) {
    let i = this.nearestIndex(x, z, hint);
    if (i >= this.count - 1) i = this.count - 2;
    let t = this.#project(i, x, z);
    if (t < 0 && i > 0) {
      i -= 1;
      t = this.#project(i, x, z);
    }
    t = clamp(t, 0, 1);
    const lerp = (a) => a[i] + (a[i + 1] - a[i]) * t;
    const cx = lerp(this.x);
    const cz = lerp(this.z);
    const h = this.heading[i];
    const lx = Math.cos(h);
    const lz = -Math.sin(h);
    out.index = i;
    out.s = (i + t) * STEP;
    out.lateral = (x - cx) * lx + (z - cz) * lz;
    out.heading = h;
    out.height = lerp(this.y) + out.lateral * Math.tan(lerp(this.bank));
    return out;
  }

  #project(i, x, z) {
    const dx = this.x[i + 1] - this.x[i];
    const dz = this.z[i + 1] - this.z[i];
    return ((x - this.x[i]) * dx + (z - this.z[i]) * dz) / (dx * dx + dz * dz);
  }

  // World position at sample i, lateral offset l (left +), on the banked road plane.
  pointAt(i, l, dy = 0) {
    const h = this.heading[i];
    return [this.x[i] + Math.cos(h) * l, this.y[i] + l * Math.tan(this.bank[i]) + dy, this.z[i] - Math.sin(h) * l];
  }

  // Unit normal of the road surface at sample i.
  normalAt(i) {
    const h = this.heading[i];
    const g = -this.grade[i];
    const tl = Math.hypot(1, g);
    const t = [Math.sin(h) / tl, g / tl, Math.cos(h) / tl];
    const b = this.bank[i];
    const l = [Math.cos(h) * Math.cos(b), Math.sin(b), -Math.sin(h) * Math.cos(b)];
    const n = [t[1] * l[2] - t[2] * l[1], t[2] * l[0] - t[0] * l[2], t[0] * l[1] - t[1] * l[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    return [n[0] / len, n[1] / len, n[2] / len];
  }

  // Distance from sample i, along its lateral ray on `side`, before another leg of the road comes
  // within `margin` metres. Keeps walls, trees and rails from cutting across other legs.
  clearance(i, side, maxDist, margin = SHOULDER + 1) {
    const h = this.heading[i];
    const lx = Math.cos(h) * side;
    const lz = -Math.sin(h) * side;
    for (let d = 2; d <= maxDist; d += 1.5) {
      const px = this.x[i] + lx * d;
      const pz = this.z[i] + lz * d;
      let hit = false;
      this.forEachNear(px, pz, margin + 2, (k) => {
        if (hit || Math.abs(k - i) < 25) return;
        if ((px - this.x[k]) ** 2 + (pz - this.z[k]) ** 2 < margin * margin) hit = true;
      });
      if (hit) return d;
    }
    return maxDist;
  }
}

// Cross-section of the road at sample i, left edge to right edge:
// [lateral offset (left +), height above the banked road plane, surface kind].
export function crossSection(road, i) {
  const gl = road.gutterLeft[i];
  const gr = road.gutterRight[i];
  return [
    [VERGE, -0.6, 'verge'],
    [SHOULDER, -0.06, 'shoulder'],
    [GUTTER_OUT, 0, gl > 0 ? 'gutter' : 'shoulder'],
    [GUTTER_OUT - 0.03, -gl, gl > 0 ? 'gutter' : 'shoulder'],
    [GUTTER_IN, -gl, gl > 0 ? 'gutter' : 'shoulder'],
    [HALF, 0, 'asphalt'],
    [HALF / 2, 0, 'asphalt'],
    [0, 0, 'asphalt'],
    [-HALF / 2, 0, 'asphalt'],
    [-HALF, 0, 'asphalt'],
    [-GUTTER_IN, -gr, gr > 0 ? 'gutter' : 'shoulder'],
    [-(GUTTER_OUT - 0.03), -gr, gr > 0 ? 'gutter' : 'shoulder'],
    [-GUTTER_OUT, 0, gr > 0 ? 'gutter' : 'shoulder'],
    [-SHOULDER, -0.06, 'shoulder'],
    [-VERGE, -0.6, 'verge'],
  ];
}

// Where the barriers go. Rails: on sides that drop away, and round the outside of tight corners.
// Walls: an invisible fence a little way out, kept clear of other legs of the road.
export function barrierLayout(road, terrain) {
  const n = road.count;
  const rail = { 1: new Uint8Array(n), [-1]: new Uint8Array(n) };
  const wall = { 1: new Float32Array(n), [-1]: new Float32Array(n) };
  for (const side of [1, -1]) {
    for (let i = 0; i < n; i += 1) {
      const outside = road.kappa[i] * side < -1 / 45;
      rail[side][i] = terrain.sideProfile(i, side) < 0 || outside ? 1 : 0;
    }
    // Fill short gaps and drop short runs so rails come in sensible lengths.
    const r = rail[side];
    for (let pass = 0; pass < 2; pass++) {
      const want = pass === 0 ? 0 : 1;
      let i = 0;
      while (i < n) {
        if (r[i] !== want) {
          i++;
          continue;
        }
        let e = i;
        while (e < n && r[e] === want) e++;
        if ((e - i) * STEP < (want === 0 ? 30 : 24) && i > 0 && e < n) r.fill(1 - want, i, e);
        i = e;
      }
    }
    for (let i = 0; i < n; i++) {
      let off = Math.min(WALL, road.clearance(i, side, WALL + 6) - 1.5);
      const k = road.kappa[i] * side;
      if (k > 1e-4) off = Math.min(off, 0.85 / k);
      wall[side][i] = Math.max(SHOULDER + 0.6, off);
    }
  }
  // Points along the run where a rail or wall should be split into straight segments.
  return { rail, wall };
}
