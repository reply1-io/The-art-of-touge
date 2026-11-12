// Mountain terrain as a height grid around the road. Pure JavaScript, testable in Node.
//
// Height away from the road comes from a plane fitted through the whole road (so the mountain has
// one consistent downhill direction), corrected toward each nearby leg's actual height, plus noise.
// Near the road the ground is pulled just under the road and verge, then rises or falls to the
// natural slope: the uphill side becomes a steep cut (rock), the downhill side a drop.

import { HALF, VERGE, STEP } from './road.js';
import { stopsFor, ZONE_INNER } from './stops.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function noise2(x, z) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

export function fbm(x, z) {
  return noise2(x / 90, z / 90) * 0.55 + noise2(x / 33, z / 33) * 0.3 + noise2(x / 11, z / 11) * 0.15 - 0.5;
}

// Ridged noise in 0..1: sharp crests and soft valleys, like eroded mountains.
export function ridged(x, z, scales, seed = 0) {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  for (const sc of scales) {
    const n = 1 - Math.abs(2 * noise2(x / sc + seed, z / sc - seed) - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

export class Terrain {
  constructor(road, { cell = 4, margin = 260, relief = 110 } = {}) {
    this.road = road;
    this.cell = cell;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < road.count; i++) {
      minX = Math.min(minX, road.x[i]);
      maxX = Math.max(maxX, road.x[i]);
      minZ = Math.min(minZ, road.z[i]);
      maxZ = Math.max(maxZ, road.z[i]);
    }
    this.nx = Math.ceil((maxX - minX + 2 * margin) / cell) + 1;
    this.nz = Math.ceil((maxZ - minZ + 2 * margin) / cell) + 1;
    this.x0 = minX - margin;
    this.z0 = minZ - margin;

    // Plane fitted through the road: h = a x + b z + c (least squares).
    let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, sy = 0, sxy = 0, szy = 0;
    const n = road.count;
    for (let i = 0; i < n; i++) {
      const x = road.x[i], z = road.z[i], y = road.y[i];
      sxx += x * x; sxz += x * z; szz += z * z; sx += x; sz += z; sy += y; sxy += x * y; szy += z * y;
    }
    const M = [
      [sxx, sxz, sx],
      [sxz, szz, sz],
      [sx, sz, n],
    ];
    const v = [sxy, szy, sy];
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(M);
    const solve = (col) => det(M.map((row, r) => row.map((val, c) => (c === col ? v[r] : val)))) / D;
    this.plane = [solve(0), solve(1), solve(2)];

    // Coarse residual samples for blending toward each leg's real height.
    this.residuals = [];
    for (let i = 0; i < n; i += 10) {
      this.residuals.push([road.x[i], road.z[i], road.y[i] - this.planeAt(road.x[i], road.z[i])]);
    }
    this.resCell = 60;
    this.resHash = new Map();
    for (const r of this.residuals) {
      const k = `${Math.floor(r[0] / this.resCell)},${Math.floor(r[1] / this.resCell)}`;
      if (!this.resHash.has(k)) this.resHash.set(k, []);
      this.resHash.get(k).push(r);
    }

    // Features: the lake behind the summit start and the town around the finish.
    const h0 = road.heading[0];
    this.lake = {
      x: road.x[0] - Math.sin(h0) * 120 + Math.cos(h0) * 50,
      z: road.z[0] - Math.cos(h0) * 120 - Math.sin(h0) * 50,
      r: 95,
      level: road.y[0] - 5,
    };
    const f = road.count - 1;
    this.town = { x: road.x[f], z: road.z[f], r: 140, level: road.y[f] - 0.3 };

    // Coarse distance to the road (chamfer transform on a 16 m grid). Far from the road the land
    // rises into wooded ridges and falls into valleys; near it, nothing changes.
    this.relief = relief;
    this.#buildFarDistance();

    // Pull-offs, the gas station and the car-show lot: the ground is levelled under them.
    this.zones = stopsFor(road);

    this.heights = new Float32Array(this.nx * this.nz);
    this.roadDist = new Float32Array(this.nx * this.nz);
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const x = this.x0 + ix * cell;
        const z = this.z0 + iz * cell;
        const near = this.nearestRoad(x, z, 60);
        const k = iz * this.nx + ix;
        this.roadDist[k] = near.d;
        this.heights[k] = this.#height(x, z, near);
      }
    }
  }

  #buildFarDistance() {
    const road = this.road;
    const c = 16;
    const fx = Math.ceil(((this.nx - 1) * this.cell) / c) + 2;
    const fz = Math.ceil(((this.nz - 1) * this.cell) / c) + 2;
    const D = new Float32Array(fx * fz).fill(1e9);
    for (let i = 0; i < road.count; i += 2) {
      const ix = Math.round((road.x[i] - this.x0) / c);
      const iz = Math.round((road.z[i] - this.z0) / c);
      if (ix >= 0 && iz >= 0 && ix < fx && iz < fz) D[iz * fx + ix] = 0;
    }
    const d1 = c;
    const d2 = c * Math.SQRT2;
    for (let iz = 0; iz < fz; iz++) {
      for (let ix = 0; ix < fx; ix++) {
        const k = iz * fx + ix;
        let v = D[k];
        if (ix > 0) v = Math.min(v, D[k - 1] + d1);
        if (iz > 0) {
          v = Math.min(v, D[k - fx] + d1);
          if (ix > 0) v = Math.min(v, D[k - fx - 1] + d2);
          if (ix < fx - 1) v = Math.min(v, D[k - fx + 1] + d2);
        }
        D[k] = v;
      }
    }
    for (let iz = fz - 1; iz >= 0; iz--) {
      for (let ix = fx - 1; ix >= 0; ix--) {
        const k = iz * fx + ix;
        let v = D[k];
        if (ix < fx - 1) v = Math.min(v, D[k + 1] + d1);
        if (iz < fz - 1) {
          v = Math.min(v, D[k + fx] + d1);
          if (ix < fx - 1) v = Math.min(v, D[k + fx + 1] + d2);
          if (ix > 0) v = Math.min(v, D[k + fx - 1] + d2);
        }
        D[k] = v;
      }
    }
    this.far = { D, fx, fz, c };
  }

  // Approximate distance (m) from (x, z) to the road centreline, good to about 16 m.
  roadDistance(x, z) {
    const { D, fx, fz, c } = this.far;
    const gx = clamp((x - this.x0) / c, 0, fx - 1.001);
    const gz = clamp((z - this.z0) / c, 0, fz - 1.001);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const tx = gx - ix;
    const tz = gz - iz;
    const a = D[iz * fx + ix];
    const b = D[iz * fx + ix + 1];
    const cc = D[(iz + 1) * fx + ix];
    const d = D[(iz + 1) * fx + ix + 1];
    // Outside the grid, keep counting the distance past its edge.
    const out = Math.hypot(Math.max(0, this.x0 - x, x - (this.x0 + (fx - 1) * c)), Math.max(0, this.z0 - z, z - (this.z0 + (fz - 1) * c)));
    return a + (b - a) * tx + (cc - a) * tz + (a - b - cc + d) * tx * tz + out;
  }

  // Ridges and valleys away from the road.
  reliefAt(x, z, dRoad = this.roadDistance(x, z)) {
    const w = smoothstep(70, 420, dRoad);
    if (w <= 0) return 0;
    return (ridged(x, z, [520, 230, 95], 3.7) - 0.3) * this.relief * w;
  }

  planeAt(x, z) {
    const [a, b, c] = this.plane;
    return a * x + b * z + c;
  }

  // Natural mountain height, ignoring the road cut.
  natural(x, z) {
    let wsum = 0;
    let rsum = 0;
    const cx = Math.floor(x / this.resCell);
    const cz = Math.floor(z / this.resCell);
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const list = this.resHash.get(`${cx + dx},${cz + dz}`);
        if (!list) continue;
        for (const [rx, rz, r] of list) {
          const w = 1 / ((x - rx) ** 2 + (z - rz) ** 2 + 400);
          wsum += w;
          rsum += w * r;
        }
      }
    }
    const resid = wsum > 0 ? rsum / wsum : 0;
    return this.planeAt(x, z) + resid + fbm(x, z) * 16 + 2;
  }

  // Nearest point on the road centreline within `radius` (d = Infinity if none).
  nearestRoad(x, z, radius) {
    const road = this.road;
    let best = -1;
    let bestD = Infinity;
    road.forEachNear(x, z, radius, (i) => {
      const d = (x - road.x[i]) ** 2 + (z - road.z[i]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) return { d: Infinity, i: -1, h: 0 };
    const h = road.heading[best];
    const lat = (x - road.x[best]) * Math.cos(h) - (z - road.z[best]) * Math.sin(h);
    return { d: Math.sqrt(bestD), i: best, h: road.y[best] + clamp(lat, -VERGE, VERGE) * Math.tan(road.bank[best]) };
  }

  #height(x, z, near) {
    let h = this.natural(x, z) + this.reliefAt(x, z);
    // Lake basin and the flat town.
    const lk = this.lake;
    const dl = Math.hypot(x - lk.x, z - lk.z);
    if (dl < lk.r + 50) {
      const basin = lk.level - 2.5 - 4 * clamp(1 - dl / lk.r, 0, 1);
      h += (Math.min(h, basin) - h) * smoothstep(lk.r + 50, lk.r - 10, dl);
    }
    const tw = this.town;
    const dt = Math.hypot(x - tw.x, z - tw.z);
    if (dt < tw.r + 60) h += (tw.level - 0.4 - h) * smoothstep(tw.r + 60, tw.r - 20, dt);
    // Road cut: just under the verge next to the road, then out to the natural slope.
    if (near.d < Infinity) {
      const t = smoothstep(VERGE - 0.5, VERGE + 16, near.d);
      h = near.h - 0.7 + (h - (near.h - 0.7)) * t;
      h = this.#levelZones(x, z, near.i, h);
    }
    return h;
  }

  // Level the ground just under a zone's surface, blending back to the hillside around it.
  #levelZones(x, z, i, h) {
    const road = this.road;
    const hd = road.heading[i];
    const lat = (x - road.x[i]) * Math.cos(hd) - (z - road.z[i]) * Math.sin(hd);
    const side = lat >= 0 ? 1 : -1;
    const l = Math.abs(lat);
    if (l < 3) return h;
    for (const zn of this.zones) {
      if (zn.side !== side || i < zn.i0 - 8 || i > zn.i1 + 8) continue;
      const k = clamp(i, zn.i0, zn.i1);
      const outer = zn.outerAt(k);
      const target = zn.heightAt(road, k, l) - 0.25;
      const along = smoothstep(8, 0, i < zn.i0 ? zn.i0 - i : i > zn.i1 ? i - zn.i1 : 0);
      const t = smoothstep(outer + 9, outer + 1, l) * along;
      h += (target - h) * t;
    }
    return h;
  }

  // Bilinear height of the grid at (x, z).
  heightAt(x, z) {
    const fx = clamp((x - this.x0) / this.cell, 0, this.nx - 1.001);
    const fz = clamp((z - this.z0) / this.cell, 0, this.nz - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const H = this.heights;
    const a = H[iz * this.nx + ix];
    const b = H[iz * this.nx + ix + 1];
    const c = H[(iz + 1) * this.nx + ix];
    const d = H[(iz + 1) * this.nx + ix + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  // Which sides of road sample i drop away (guardrail) or rise (cut): +1 rises, -1 drops, 0 neither.
  sideProfile(i, side) {
    const road = this.road;
    const [x, , z] = road.pointAt(i, side * 22);
    const dh = this.natural(x, z) - road.y[i];
    return dh > 2.5 ? 1 : dh < -2.5 ? -1 : 0;
  }
}

export { STEP, HALF };
