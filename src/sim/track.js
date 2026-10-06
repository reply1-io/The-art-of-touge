// Mountain road generation and queries.
// Pure math with no three.js dependency, so it can be tested in Node.
//
// Conventions (shared with the car simulation):
//   - Y is up. Heading h: forward = (sin h, cos h) in (x, z), left = (cos h, -sin h).
//   - Positive curvature turns left. Positive bank raises the left edge of the road.
//   - "Lateral" offsets are measured to the left of the centerline.

export const ROAD_HALF_WIDTH = 3.1; // two narrow lanes, 6.2 m wide
export const SHOULDER = 0.9;
export const RAIL_OFFSET = ROAD_HALF_WIDTH + SHOULDER + 0.35; // guardrail / wall line
export const SAMPLE_STEP = 1; // metres between centerline samples

// The first named section: "Cedar Hairpins".
// turn: degrees turned over the segment (positive = left)
// grade: percent slope (negative = downhill)
// hill: which side the mountain rises on (+1 left, -1 right). The other side drops away.
const SEGMENTS = [
  // Leg 1: heading north, mountain on the left
  { len: 140, turn: 0, grade: -2, hill: 1 },
  { len: 80, turn: 35, grade: -4, hill: 1 },
  { len: 70, turn: 0, grade: -6, hill: 1 },
  { len: 110, turn: -70, grade: -7, hill: 1 },
  { len: 60, turn: 0, grade: -6, hill: 1 },
  { len: 80, turn: 35, grade: -7, hill: 1 },
  { len: 48, turn: -165, grade: -8, hill: 1 }, // hairpin right
  // Leg 2: heading south, mountain on the right
  { len: 120, turn: 0, grade: -6, hill: -1 },
  { len: 40, turn: -15, grade: -5, hill: -1 },
  { len: 90, turn: 40, grade: -4, hill: -1 },
  { len: 70, turn: -80, grade: 2, hill: -1 },
  { len: 60, turn: 40, grade: -8, hill: -1 },
  { len: 200, turn: 0, grade: -8, hill: -1 },
  { len: 50, turn: 165, grade: -9, hill: -1 }, // hairpin left
  // Leg 3: heading north
  { len: 110, turn: 0, grade: -7, hill: 1 },
  { len: 40, turn: 15, grade: -6, hill: 1 },
  { len: 100, turn: -75, grade: -6, hill: 1 },
  { len: 85, turn: 45, grade: -3, hill: 1 },
  { len: 80, turn: 30, grade: -5, hill: 1 },
  { len: 150, turn: 0, grade: -7, hill: 1 },
  { len: 48, turn: -165, grade: -8, hill: 1 }, // hairpin right
  // Leg 4: heading south
  { len: 120, turn: 0, grade: -7, hill: -1 },
  { len: 40, turn: -15, grade: -5, hill: -1 },
  { len: 90, turn: 55, grade: -5, hill: -1 },
  { len: 75, turn: -55, grade: -4, hill: -1 },
  { len: 200, turn: 0, grade: -6, hill: -1 },
  { len: 60, turn: -35, grade: 1, hill: -1 },
  { len: 60, turn: 35, grade: 4, hill: -1 },
  { len: 52, turn: 165, grade: -9, hill: -1 }, // hairpin left
  // Leg 5: heading north to the finish
  { len: 130, turn: 0, grade: -6, hill: 1 },
  { len: 40, turn: 15, grade: -5, hill: 1 },
  { len: 80, turn: -60, grade: -5, hill: 1 },
  { len: 60, turn: 0, grade: -3, hill: 1 },
  { len: 75, turn: 60, grade: -4, hill: 1 },
  { len: 220, turn: 0, grade: -2, hill: 1 },
];

export const SECTION_NAME = 'CEDAR HAIRPINS';

const BANK_PER_CURVATURE = 2.4; // radians of bank per (1/m) of curvature
const MAX_BANK = (7 * Math.PI) / 180;

function boxSmooth(src, window) {
  const n = src.length;
  const out = new Float64Array(n);
  const half = Math.floor(window / 2);
  let sum = 0;
  let count = 0;
  // Running-window average, with the window clipped at the ends.
  for (let i = -half; i < n; i++) {
    const add = i + half;
    if (add < n) {
      sum += src[add];
      count++;
    }
    const drop = i - half - 1;
    if (drop >= 0) {
      sum -= src[drop];
      count--;
    }
    if (i >= 0) out[i] = sum / count;
  }
  return out;
}

export class Track {
  constructor(segments = SEGMENTS) {
    const kappaRaw = [];
    const gradeRaw = [];
    const hillRaw = [];
    for (const seg of segments) {
      const steps = Math.round(seg.len / SAMPLE_STEP);
      const k = ((seg.turn * Math.PI) / 180) / seg.len;
      for (let i = 0; i < steps; i++) {
        kappaRaw.push(k);
        gradeRaw.push(seg.grade / 100);
        hillRaw.push(seg.hill);
      }
    }
    const n = kappaRaw.length + 1;
    kappaRaw.push(0);
    gradeRaw.push(gradeRaw[gradeRaw.length - 1]);
    hillRaw.push(hillRaw[hillRaw.length - 1]);

    // Smoothing gives clothoid-like corner entries and gentle crests/dips; a box filter keeps the total turn.
    const kappa = boxSmooth(kappaRaw, 24);
    const grade = boxSmooth(gradeRaw, 70);
    const hill = boxSmooth(hillRaw, 50);
    const bankRaw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      bankRaw[i] = Math.max(-MAX_BANK, Math.min(MAX_BANK, -kappa[i] * BANK_PER_CURVATURE));
    }
    const bank = boxSmooth(bankRaw, 30);

    this.count = n;
    this.length = (n - 1) * SAMPLE_STEP;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.z = new Float64Array(n);
    this.heading = new Float64Array(n);
    this.kappa = kappa;
    this.grade = grade;
    this.bank = bank;
    this.hill = hill;

    let x = 0;
    let y = 0;
    let z = 0;
    let h = 0;
    for (let i = 0; i < n; i++) {
      this.x[i] = x;
      this.y[i] = y;
      this.z[i] = z;
      this.heading[i] = h;
      // Midpoint integration for the heading keeps arcs accurate.
      const hm = h + kappa[i] * SAMPLE_STEP * 0.5;
      x += Math.sin(hm) * SAMPLE_STEP;
      z += Math.cos(hm) * SAMPLE_STEP;
      y += grade[i] * SAMPLE_STEP;
      h += kappa[i] * SAMPLE_STEP;
    }

    this.minY = Math.min(...this.y);
    this.maxY = Math.max(...this.y);
    this.#buildHash();
  }

  // --- Spatial hash over centerline samples (used for nearest-sample search and scenery clearance) ---
  #buildHash() {
    this.cell = 20;
    this.hash = new Map();
    for (let i = 0; i < this.count; i++) {
      const key = this.#key(Math.floor(this.x[i] / this.cell), Math.floor(this.z[i] / this.cell));
      let list = this.hash.get(key);
      if (!list) this.hash.set(key, (list = []));
      list.push(i);
    }
  }

  #key(cx, cz) {
    return cx * 73856093 + cz * 19349663;
  }

  // Calls fn(i) for every sample within roughly `radius` metres of (x, z).
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

  nearestIndex(x, z, hint = -1) {
    let best = -1;
    let bestD = Infinity;
    if (hint >= 0) {
      const lo = Math.max(0, hint - 40);
      const hi = Math.min(this.count - 1, hint + 40);
      for (let i = lo; i <= hi; i++) {
        const dx = x - this.x[i];
        const dz = z - this.z[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      // Accept the local result unless it sits on the edge of the window (we may have jumped).
      if (best > lo && best < hi) return best;
    }
    this.forEachNear(x, z, 30, (i) => {
      const dx = x - this.x[i];
      const dz = z - this.z[i];
      const d = dx * dx + dz * dz;
      // Prefer samples near the hint when two legs of the road are close together.
      const penalty = hint >= 0 ? Math.min(Math.abs(i - hint), 400) * 0.05 : 0;
      if (d + penalty < bestD) {
        bestD = d + penalty;
        best = i;
      }
    });
    if (best < 0) {
      for (let i = 0; i < this.count; i++) {
        const dx = x - this.x[i];
        const dz = z - this.z[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return best;
  }

  // Fills `out` with road information at world position (x, z).
  // out: { index, s, lateral, height, nx, ny, nz, leftX, leftZ, cx, cz, limitLeft, limitRight, hill }
  query(x, z, hint, out) {
    let i = this.nearestIndex(x, z, hint);
    // Project onto the segment between i and i+1 (or i-1 and i) for a continuous distance s.
    if (i >= this.count - 1) i = this.count - 2;
    let t = this.#projectT(i, x, z);
    if (t < 0 && i > 0) {
      i -= 1;
      t = this.#projectT(i, x, z);
    }
    t = Math.max(0, Math.min(1, t));
    const lerp = (arr) => arr[i] + (arr[i + 1] - arr[i]) * t;
    const cx = lerp(this.x);
    const cz = lerp(this.z);
    const cy = lerp(this.y);
    const h = lerp(this.heading);
    const bank = lerp(this.bank);
    const grade = lerp(this.grade);

    const leftX = Math.cos(h);
    const leftZ = -Math.sin(h);
    const lateral = (x - cx) * leftX + (z - cz) * leftZ;

    // Surface height: banked plane through the centerline.
    const height = cy + lateral * Math.tan(bank);

    // Surface normal = tangent x left (tangent includes grade, left includes bank).
    const tLen = Math.hypot(1, grade);
    const tx = Math.sin(h) / tLen;
    const ty = grade / tLen;
    const tz = Math.cos(h) / tLen;
    const cb = Math.cos(bank);
    const sb = Math.sin(bank);
    const lx = leftX * cb;
    const ly = sb;
    const lz = leftZ * cb;
    let nx = ty * lz - tz * ly;
    let ny = tz * lx - tx * lz;
    let nz = tx * ly - ty * lx;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl;
    ny /= nl;
    nz /= nl;

    out.index = i;
    out.s = (i + t) * SAMPLE_STEP;
    out.lateral = lateral;
    out.height = height;
    out.nx = nx;
    out.ny = ny;
    out.nz = nz;
    out.leftX = leftX;
    out.leftZ = leftZ;
    out.cx = cx;
    out.cz = cz;
    out.cy = cy;
    out.bank = bank;
    out.heading = h;
    out.limitLeft = RAIL_OFFSET;
    out.limitRight = -RAIL_OFFSET;
    out.hill = lerp(this.hill);
    return out;
  }

  #projectT(i, x, z) {
    const dx = this.x[i + 1] - this.x[i];
    const dz = this.z[i + 1] - this.z[i];
    return ((x - this.x[i]) * dx + (z - this.z[i]) * dz) / (dx * dx + dz * dz);
  }

  // World position of a point at distance index i (integer sample) and lateral offset l, on the road plane.
  pointAt(i, lateral) {
    const h = this.heading[i];
    return {
      x: this.x[i] + Math.cos(h) * lateral,
      y: this.y[i] + lateral * Math.tan(this.bank[i]),
      z: this.z[i] - Math.sin(h) * lateral,
    };
  }

  // Distance (along the lateral ray from sample i on the given side) until the road comes near
  // a different part of itself. Used to stop scenery from cutting through other legs of the road.
  clearance(i, side, maxDist) {
    const h = this.heading[i];
    const lx = Math.cos(h) * side;
    const lz = -Math.sin(h) * side;
    const step = 4;
    for (let d = RAIL_OFFSET + step; d <= maxDist; d += step) {
      const px = this.x[i] + lx * d;
      const pz = this.z[i] + lz * d;
      let hit = false;
      this.forEachNear(px, pz, 12, (j) => {
        if (hit || Math.abs(j - i) < 60) return;
        const dx = px - this.x[j];
        const dz = pz - this.z[j];
        if (dx * dx + dz * dz < (RAIL_OFFSET + 6) ** 2) hit = true;
      });
      if (hit) return Math.max(RAIL_OFFSET + 1, d - 8);
    }
    return maxDist;
  }
}
