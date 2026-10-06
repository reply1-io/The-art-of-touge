// Builds the mountain around the road: asphalt, shoulders, mountainside and drop-off terrain,
// guardrails, corner chevrons, cedar trees, start/finish gates, distant ranges and the valley floor.
// Geometry is split into chunks along the road so off-screen and fogged-out parts can be skipped.
import * as THREE from 'three';
import { ROAD_HALF_WIDTH, SHOULDER, RAIL_OFFSET } from '../sim/track.js';
import { worldMaterial } from './ps1.js';
import * as tex from './textures.js';

const CHUNK = 150; // samples (metres) per chunk
const ROW = 2; // metres between road rows

class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }
  vertex(p, n, u, v, c) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }
  // Adds a quad, wound so it faces the same way as vertex a's normal.
  quad(a, b, c, d) {
    const P = this.pos;
    const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    const N = this.nrm;
    if (nx * N[a * 3] + ny * N[a * 3 + 1] + nz * N[a * 3 + 2] < 0) this.idx.push(a, d, c, a, c, b);
    else this.idx.push(a, b, c, a, c, d);
  }
  get empty() {
    return this.idx.length === 0;
  }
  build(computeNormals = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    if (computeNormals) g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// Deterministic value noise for terrain variation.
function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise2(x, z) {
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
function fbm(x, z) {
  return noise2(x / 40, z / 40) * 0.6 + noise2(x / 13, z / 13) * 0.3 + noise2(x / 5, z / 5) * 0.1;
}

// Terrain cross-section beyond the guardrail line: offsets from the rail, and heights for a
// mountainside that rises or a slope that drops away.
const OFFSETS = [0, 1.4, 4, 10, 22, 45, 80];
const RISE = [0.25, 3.2, 6.5, 11, 20, 34, 52];
const DROP = [-0.35, -2.6, -7, -15, -28, -46, -66];

const GRASS = [0.42, 0.56, 0.3];
const GRASS_DARK = [0.3, 0.42, 0.24];
const ROCK = [0.58, 0.54, 0.48];
const DIRT = [0.55, 0.46, 0.34];

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function roadNormal(track, i) {
  const h = track.heading[i];
  const grade = track.grade[i];
  const bank = track.bank[i];
  const tl = Math.hypot(1, grade);
  const t = [Math.sin(h) / tl, grade / tl, Math.cos(h) / tl];
  const cb = Math.cos(bank);
  const l = [Math.cos(h) * cb, Math.sin(bank), -Math.sin(h) * cb];
  const n = [t[1] * l[2] - t[2] * l[1], t[2] * l[0] - t[0] * l[2], t[0] * l[1] - t[1] * l[0]];
  const len = Math.hypot(n[0], n[1], n[2]);
  return [n[0] / len, n[1] / len, n[2] / len];
}

export class Scenery {
  constructor(track, scene) {
    this.track = track;
    this.scene = scene;
    this.chunks = [];
    this.textures = {
      asphalt: tex.asphaltTexture(),
      gravel: tex.gravelTexture(),
      concrete: tex.concreteTexture(),
      ground: tex.groundTexture(),
      rail: tex.guardrailTexture(),
      tree: tex.treeTexture(),
      chevron: tex.chevronTexture(),
      white: tex.whiteTexture(),
    };
    const T = this.textures;
    this.materials = {
      road: worldMaterial(T.asphalt),
      gravel: worldMaterial(T.gravel),
      concrete: worldMaterial(T.concrete),
      ground: worldMaterial(T.ground),
      rail: worldMaterial(T.rail, { side: THREE.DoubleSide }),
      plain: worldMaterial(T.white),
      tree: worldMaterial(T.tree, { side: THREE.DoubleSide }),
      chevron: worldMaterial(T.chevron),
    };
    this.#precomputeClearance();
    for (let start = 0; start < track.count - 1; start += CHUNK) {
      this.#buildChunk(start, Math.min(track.count - 1, start + CHUNK));
    }
    this.#buildGates();
    this.#buildBackdrop();
  }

  #precomputeClearance() {
    const t = this.track;
    const n = t.count;
    this.clear = { 1: new Float32Array(n), [-1]: new Float32Array(n) };
    const maxOff = OFFSETS[OFFSETS.length - 1];
    for (let i = 0; i < n; i += ROW) {
      for (const side of [1, -1]) {
        let avail = t.clearance(i, side, RAIL_OFFSET + maxOff) - RAIL_OFFSET;
        // On the inside of a corner, lateral lines converge at the centre of curvature: stop short of it.
        const k = t.kappa[i] * side;
        if (k > 1e-4) avail = Math.min(avail, 0.85 / k - RAIL_OFFSET);
        this.clear[side][i] = Math.max(1.5, avail);
      }
    }
    // Smooth so terrain edges do not zig-zag.
    for (const side of [1, -1]) {
      const src = this.clear[side];
      const out = new Float32Array(n);
      for (let i = 0; i < n; i += ROW) {
        let m = Infinity;
        for (let j = Math.max(0, i - 10); j <= Math.min(n - 1, i + 10); j += ROW) m = Math.min(m, src[j]);
        out[i] = m;
      }
      this.clear[side] = out;
    }
  }

  // How much a side rises (1) or drops (0) at sample i.
  #rise(i, side) {
    return Math.max(0, Math.min(1, (this.track.hill[i] * side + 1) / 2));
  }

  #buildChunk(i0, i1) {
    const t = this.track;
    const road = new GeoBuilder();
    const gravel = new GeoBuilder();
    const concrete = new GeoBuilder();
    const ground = new GeoBuilder();
    const rail = new GeoBuilder();
    const plain = new GeoBuilder();
    const trees = new GeoBuilder();
    const chevrons = new GeoBuilder();

    const rows = [];
    for (let i = i0; i <= i1; i += ROW) rows.push(i);
    if (rows[rows.length - 1] !== i1) rows.push(i1);

    const hw = ROAD_HALF_WIDTH;
    const roadLat = [hw, hw / 2, 0, -hw / 2, -hw];
    let prevRoad = null;
    const prevSide = { 1: null, [-1]: null };

    for (const i of rows) {
      const n = roadNormal(t, i);
      const v = i / 8;
      // Road surface.
      const cur = roadLat.map((l, k) => {
        const p = t.pointAt(i, l);
        return road.vertex([p.x, p.y, p.z], n, k / 4, v, [1, 1, 1]);
      });
      if (prevRoad) for (let k = 0; k < 4; k++) road.quad(prevRoad[k], cur[k], cur[k + 1], prevRoad[k + 1]);
      prevRoad = cur;

      for (const side of [1, -1]) {
        const rise = this.#rise(i, side);
        const sideRows = {};
        // Shoulder (gravel), from road edge to just before the rail line, dipping slightly.
        const e0 = t.pointAt(i, side * hw);
        const e1 = t.pointAt(i, side * (hw + SHOULDER));
        e1.y -= 0.04;
        const e2 = t.pointAt(i, side * RAIL_OFFSET);
        e2.y -= 0.18;
        sideRows.g = [
          gravel.vertex([e0.x, e0.y, e0.z], n, 0, i / 4, [1, 1, 1]),
          gravel.vertex([e1.x, e1.y, e1.z], n, 0.5, i / 4, [1, 1, 1]),
          gravel.vertex([e2.x, e2.y, e2.z], n, 1, i / 4, [0.8, 0.8, 0.8]),
        ];

        // Terrain beyond the rail line.
        const avail = this.clear[side][i - (i % ROW)] || this.clear[side][i] || 80;
        const scale = Math.min(1, avail / OFFSETS[OFFSETS.length - 1]);
        const h = t.heading[i];
        const lx = Math.cos(h) * side;
        const lz = -Math.sin(h) * side;
        const base = t.pointAt(i, side * RAIL_OFFSET);
        sideRows.t = OFFSETS.map((o, k) => {
          const off = o * scale;
          const x = base.x + lx * off;
          const z = base.z + lz * off;
          let y = base.y + RISE[k] * rise + DROP[k] * (1 - rise);
          const amp = k === 0 ? 0 : Math.min(1, k / 2) * (2 + k * 1.6);
          y += (fbm(x, z) - 0.5) * amp;
          let c;
          if (k <= 1) c = lerp3(DIRT, ROCK, rise);
          else if (k === 2) c = lerp3(GRASS, ROCK, rise * 0.6);
          else c = lerp3(GRASS, GRASS_DARK, noise2(x / 30, z / 30));
          const shade = 0.85 + noise2(x / 7, z / 7) * 0.3;
          return ground.vertex([x, y, z], [0, 1, 0], off / 6, i / 6, [c[0] * shade, c[1] * shade, c[2] * shade]);
        });
        const p = prevSide[side];
        if (p) {
          for (let k = 0; k < 2; k++) gravel.quad(p.g[k], sideRows.g[k], sideRows.g[k + 1], p.g[k + 1]);
          for (let k = 0; k < OFFSETS.length - 1; k++) ground.quad(p.t[k], sideRows.t[k], sideRows.t[k + 1], p.t[k + 1]);
        }
        prevSide[side] = sideRows;
      }

      // Guardrail on whichever side drops away (posts every 4 m).
      for (const side of [1, -1]) {
        if (this.#rise(i, side) > 0.5) continue;
        if (i % 4 === 0) this.#post(plain, t.pointAt(i, side * (RAIL_OFFSET - 0.05)), t.heading[i]);
      }
      // Corner chevrons on the outside of tight corners.
      const k = t.kappa[i];
      if (Math.abs(k) > 1 / 45 && i % 12 === 0) {
        const outside = k > 0 ? -1 : 1;
        this.#chevron(chevrons, plain, t, i, outside);
      }
      // Trees.
      for (const side of [1, -1]) {
        if (i % 6 !== 0) continue;
        const rise = this.#rise(i, side);
        const avail = this.clear[side][i] || 80;
        const h = t.heading[i];
        const lx = Math.cos(h) * side;
        const lz = -Math.sin(h) * side;
        const base = t.pointAt(i, side * RAIL_OFFSET);
        for (let n2 = 0; n2 < 3; n2++) {
          const r = hash2(i * 7 + n2, side * 13);
          const off = 5 + r * Math.max(0, Math.min(avail, 70) - 5);
          if (off > avail - 1 || hash2(i, n2 * 31 + side) < 0.25) continue;
          // Height of the terrain profile at this offset.
          const scale = Math.min(1, avail / OFFSETS[OFFSETS.length - 1]);
          let y = base.y;
          for (let kk = 1; kk < OFFSETS.length; kk++) {
            const o0 = OFFSETS[kk - 1] * scale;
            const o1 = OFFSETS[kk] * scale;
            if (off <= o1) {
              const f = (off - o0) / (o1 - o0);
              const h0 = RISE[kk - 1] * rise + DROP[kk - 1] * (1 - rise);
              const h1 = RISE[kk] * rise + DROP[kk] * (1 - rise);
              y += h0 + (h1 - h0) * f;
              break;
            }
          }
          const along = (hash2(i, n2) - 0.5) * 5;
          const x = base.x + lx * off + Math.sin(h) * along;
          const z = base.z + lz * off + Math.cos(h) * along;
          this.#tree(trees, x, y - 0.6, z, 8 + hash2(i * 3, n2) * 9, hash2(n2, i));
        }
      }
    }

    // Guardrail beam as a continuous ribbon, split wherever the side stops dropping away.
    for (const side of [1, -1]) {
      let prev = null;
      for (const i of rows) {
        if (this.#rise(i, side) > 0.5) {
          prev = null;
          continue;
        }
        const p = t.pointAt(i, side * (RAIL_OFFSET - 0.05));
        const nrm = [Math.cos(t.heading[i]) * -side, 0, -Math.sin(t.heading[i]) * -side];
        const cur = [
          rail.vertex([p.x, p.y + 0.42, p.z], nrm, i / 4, 1, [1, 1, 1]),
          rail.vertex([p.x, p.y + 0.8, p.z], nrm, i / 4, 0, [1, 1, 1]),
        ];
        if (prev) rail.quad(prev[0], cur[0], cur[1], prev[1]);
        prev = cur;
      }
    }

    // Concrete gutter wall on the mountain side.
    for (const side of [1, -1]) {
      let prev = null;
      for (const i of rows) {
        if (this.#rise(i, side) <= 0.5) {
          prev = null;
          continue;
        }
        const p = t.pointAt(i, side * RAIL_OFFSET);
        const nrm = [Math.cos(t.heading[i]) * -side, 0.2, -Math.sin(t.heading[i]) * -side];
        const cur = [
          concrete.vertex([p.x, p.y - 0.2, p.z], nrm, i / 3, 0, [0.9, 0.9, 0.9]),
          concrete.vertex([p.x, p.y + 0.3, p.z], nrm, i / 3, 0.5, [1, 1, 1]),
        ];
        if (prev) concrete.quad(prev[0], cur[0], cur[1], prev[1]);
        prev = cur;
      }
    }

    const group = new THREE.Group();
    const add = (b, mat, computeNormals) => {
      if (b.empty) return;
      const mesh = new THREE.Mesh(b.build(computeNormals), mat);
      group.add(mesh);
    };
    add(road, this.materials.road);
    add(gravel, this.materials.gravel);
    add(ground, this.materials.ground, true);
    add(rail, this.materials.rail);
    add(concrete, this.materials.concrete);
    add(plain, this.materials.plain);
    add(chevrons, this.materials.chevron);
    add(trees, this.materials.tree);
    this.scene.add(group);
    const mid = Math.floor((i0 + i1) / 2);
    this.chunks.push({ group, x: t.x[mid], y: t.y[mid], z: t.z[mid], i0, i1 });
  }

  #box(b, cx, cy, cz, sx, sy, sz, yaw, color) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const corner = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const faces = [
      [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
      [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
      [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
      [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
      [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    ];
    for (const [n, quad] of faces) {
      const nw = [n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c];
      const ids = quad.map(([x, y, z]) => b.vertex(corner(x * sx, y * sy, z * sz), nw, 0.5, 0.5, color));
      b.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }

  #post(b, p, heading) {
    this.#box(b, p.x, p.y + 0.35, p.z, 0.05, 0.4, 0.05, heading, [0.55, 0.56, 0.58]);
  }

  #chevron(b, posts, t, i, side) {
    const p = t.pointAt(i, side * (RAIL_OFFSET + 0.4));
    const h = t.heading[i];
    this.#box(posts, p.x, p.y + 0.6, p.z, 0.04, 0.6, 0.04, h, [0.5, 0.5, 0.5]);
    // Face the oncoming driver: normal points back along the road.
    const n = [-Math.sin(h), 0, -Math.cos(h)];
    const rx = Math.cos(h) * 0.38;
    const rz = -Math.sin(h) * 0.38;
    const y0 = p.y + 1.0;
    const y1 = p.y + 1.7;
    // Texture arrow points right; flip it on left-hand corners.
    const flip = side > 0;
    const a = b.vertex([p.x + rx, y0, p.z + rz], n, flip ? 1 : 0, 1, [1, 1, 1]);
    const bb = b.vertex([p.x - rx, y0, p.z - rz], n, flip ? 0 : 1, 1, [1, 1, 1]);
    const c = b.vertex([p.x - rx, y1, p.z - rz], n, flip ? 0 : 1, 0, [1, 1, 1]);
    const d = b.vertex([p.x + rx, y1, p.z + rz], n, flip ? 1 : 0, 0, [1, 1, 1]);
    b.quad(a, bb, c, d);
  }

  // Cedar as two crossed quads.
  #tree(b, x, y, z, height, r) {
    const w = height * 0.32;
    const shade = 0.75 + r * 0.4;
    const col = [shade, shade, shade];
    const ang = r * Math.PI;
    for (const a of [ang, ang + Math.PI / 2]) {
      const dx = Math.cos(a) * w;
      const dz = Math.sin(a) * w;
      const n = [0, 1, 0];
      const v0 = b.vertex([x - dx, y, z - dz], n, 0, 1, col);
      const v1 = b.vertex([x + dx, y, z + dz], n, 1, 1, col);
      const v2 = b.vertex([x + dx, y + height, z + dz], n, 1, 0, col);
      const v3 = b.vertex([x - dx, y + height, z - dz], n, 0, 0, col);
      b.quad(v0, v1, v2, v3);
    }
  }

  #buildGates() {
    const t = this.track;
    this.startIndex = 40;
    this.finishIndex = t.count - 60;
    const make = (i, text, colors) => {
      const group = new THREE.Group();
      const b = new GeoBuilder();
      const h = t.heading[i];
      const span = RAIL_OFFSET + 0.3;
      for (const side of [1, -1]) {
        const p = t.pointAt(i, side * span);
        this.#box(b, p.x, p.y + 2.6, p.z, 0.15, 2.6, 0.15, h, [0.85, 0.85, 0.85]);
      }
      group.add(new THREE.Mesh(b.build(), this.materials.plain));
      const banner = new GeoBuilder();
      const l = t.pointAt(i, span);
      const r = t.pointAt(i, -span);
      const n = [-Math.sin(h), 0, -Math.cos(h)];
      const yb = Math.max(l.y, r.y);
      const a = banner.vertex([l.x, yb + 4.2, l.z], n, 0, 1, [1, 1, 1]);
      const bb = banner.vertex([r.x, yb + 4.2, r.z], n, 1, 1, [1, 1, 1]);
      const c = banner.vertex([r.x, yb + 5.4, r.z], n, 1, 0, [1, 1, 1]);
      const d = banner.vertex([l.x, yb + 5.4, l.z], n, 0, 0, [1, 1, 1]);
      banner.quad(a, bb, c, d);
      const mat = worldMaterial(tex.bannerTexture(text, colors), { side: THREE.DoubleSide });
      group.add(new THREE.Mesh(banner.build(), mat));
      this.scene.add(group);
    };
    make(this.startIndex, 'START', ['#1a3fa8', '#ffffff']);
    make(this.finishIndex, 'FINISH', ['#c81818', '#ffffff']);
  }

  #buildBackdrop() {
    const t = this.track;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < t.count; i += 10) {
      cx += t.x[i];
      cz += t.z[i];
    }
    const n = Math.ceil(t.count / 10);
    cx /= n;
    cz /= n;
    this.center = { x: cx, z: cz };

    // Valley floor far below.
    const floor = new GeoBuilder();
    const fy = t.minY - 110;
    const S = 5000;
    const ids = [
      [-S, -S],
      [S, -S],
      [S, S],
      [-S, S],
    ].map(([x, z]) => floor.vertex([cx + x, fy, cz + z], [0, 1, 0], x / 40, z / 40, [0.32, 0.42, 0.26]));
    floor.quad(ids[0], ids[3], ids[2], ids[1]);
    this.scene.add(new THREE.Mesh(floor.build(), this.materials.ground));

    // Two rings of distant ranges with their own, longer fog.
    this.rangeMaterial = worldMaterial(this.textures.white, { lit: false, fog: { near: 600, far: 3400, max: 0.82 } });
    const ranges = new GeoBuilder();
    for (const [radius, height, seed] of [
      [1700, 320, 1],
      [2600, 520, 2],
    ]) {
      const segs = 72;
      let prev = null;
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const peak = (noise2(s * 0.35 + seed * 10, seed) * 0.7 + noise2(s * 1.3, seed * 7) * 0.3) * height;
        const x = cx + Math.cos(a) * radius;
        const z = cz + Math.sin(a) * radius;
        const shade = seed === 1 ? 0.28 : 0.42;
        const bottom = ranges.vertex([x, fy, z], [0, 1, 0], 0, 0, [shade * 0.8, shade, shade * 1.15]);
        const top = ranges.vertex([x, t.maxY + 40 + peak, z], [0, 1, 0], 0, 0, [shade, shade * 1.1, shade * 1.25]);
        if (prev) ranges.quad(prev[0], bottom, top, prev[1]);
        prev = [bottom, top];
      }
    }
    const rangeMesh = new THREE.Mesh(ranges.build(), this.rangeMaterial);
    rangeMesh.material.side = THREE.DoubleSide;
    this.ranges = rangeMesh;
    this.scene.add(rangeMesh);
  }

  // Hide chunks beyond the fog.
  update(camPos, fogFar) {
    const limit = (fogFar + 180) ** 2;
    for (const c of this.chunks) {
      const dx = c.x - camPos.x;
      const dz = c.z - camPos.z;
      const dy = c.y - camPos.y;
      c.group.visible = dx * dx + dz * dz + dy * dy < limit;
    }
  }
}
