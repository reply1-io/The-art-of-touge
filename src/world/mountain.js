// The mountain's visuals: road (chunked for culling), terrain tiles, guardrails, streetlights at the
// hairpins, cedar forest, the summit lake, the town at the bottom, and start / finish lines.
import * as THREE from 'three';
import { crossSection, HALF, PAVED, RAIL, STEP } from './road.js';
import { TRACKS } from './tracks.js';
import { Terrain, noise2 } from './terrain.js';
import { buildMountainPhysics } from './mountainPhysics.js';
import { Ranges, CloudSea, buildWaterfalls, sunAzimuth } from './wilds.js';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ROAD_CHUNK = 60; // samples per road chunk (120 m)
const TILE = 24; // terrain cells per tile

function asphaltTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3b3f';
  g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 1800; i++) {
    const v = 44 + Math.random() * 30;
    g.fillStyle = `rgb(${v},${v},${v + 3})`;
    g.fillRect(Math.random() * 64, Math.random() * 256, 1, 1);
  }
  // The paved shoulders outside the white lines: a touch lighter and dustier, never polished.
  const line = Math.round((64 * (PAVED - HALF)) / (2 * PAVED));
  g.fillStyle = 'rgba(120,118,112,0.18)';
  g.fillRect(0, 0, line, 256);
  g.fillRect(64 - line, 0, line, 256);
  // Tyre-polished lines in each lane.
  g.fillStyle = 'rgba(20,20,22,0.25)';
  for (const l of [2.55, 0.85, -0.85, -2.55]) g.fillRect((64 * (PAVED - l)) / (2 * PAVED) - 2, 0, 4, 256);
  // White edge lines and the yellow no-overtaking centre line.
  g.fillStyle = '#d9d9d2';
  g.fillRect(line - 1, 0, 2, 256);
  g.fillRect(64 - line - 1, 0, 2, 256);
  g.fillStyle = '#e0a51c';
  g.fillRect(30, 0, 1.5, 256);
  g.fillRect(32.5, 0, 1.5, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function glowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function windowsTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  for (let y = 4; y < 64; y += 16) {
    for (let x = 4; x < 64; x += 12) {
      if (Math.random() < 0.45) {
        g.fillStyle = Math.random() < 0.7 ? '#ffd58a' : '#bfe4ff';
        g.fillRect(x, y, 6, 8);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const COLORS = {
  verge: [0.2, 0.22, 0.14],
  shoulder: [0.36, 0.34, 0.31],
  gutter: [0.55, 0.55, 0.52],
};

export class Mountain {
  constructor(world, scene, trackId = 'akina') {
    this.scene = scene;
    this.track = TRACKS[trackId] || TRACKS.akina;
    this.road = this.track.road();
    this.terrain = new Terrain(this.road, { margin: this.road.length > 6000 ? 180 : 260, relief: this.track.relief ?? 110 });
    this.layout = buildMountainPhysics(world, this.road, this.terrain);
    this.chunks = []; // { group, x, z, r }
    this.#buildRoad();
    this.#buildTerrain();
    this.#buildRails();
    this.#buildStreetlights();
    this.#buildTrees();
    this.#buildRoadside();
    this.#buildLandmarks();
    this.#buildLake();
    this.#buildTown();
    this.#buildLines();
    // The wild country beyond: ranges to the horizon, cloud in the valleys, waterfalls.
    this.sunAz = sunAzimuth(this.road);
    this.ranges = new Ranges(scene, this.terrain, { height: this.track.peaks ?? 800, sunAz: this.sunAz });
    let lowest = Infinity;
    for (let i = 0; i < this.road.count; i++) lowest = Math.min(lowest, this.road.y[i]);
    this.cloudSea = new CloudSea(scene, [this.ranges.cx, this.ranges.cz], this.ranges.half * 2, lowest - 22);
    this.waterfalls = buildWaterfalls(this.road, this.terrain, this.#waterfallSpots(), (g, x, z, r) => this.#addChunk(g, x, z, r));
  }

  // Hillsides that rise steeply beside the road with no retaining wall: room for a cascade.
  #waterfallSpots() {
    const road = this.road;
    const t = this.terrain;
    const spots = [];
    let last = -1e9;
    const want = this.track.waterfalls ?? 3;
    const gap = Math.floor(road.count / (want + 1));
    for (let i = 60; i < road.count - 60 && spots.length < want; i += 3) {
      if (i - last < gap * 0.7) continue;
      for (const side of [1, -1]) {
        if (this.#wallAt(i, side) || this.#wallAt(i - 4, side) || this.#wallAt(i + 4, side)) continue;
        if (road.clearance(i, side, 50) < 50 || this.layout.rail[side][i]) continue;
        if (Math.abs(road.kappa[i]) > 1 / 60) continue;
        const [x, , z] = road.pointAt(i, side * 40);
        if (t.heightAt(x, z) - road.y[i] < 16) continue;
        spots.push([i, side]);
        last = i;
        break;
      }
    }
    return spots;
  }

  // Retaining wall (or a rock cut on the wilder roads) on this side of sample j.
  #wallAt(j, side) {
    const k = Math.max(0, Math.min(this.road.count - 1, j));
    return this.terrain.sideProfile(k, side) > 0 && noise2(k / 40, side * 5) > 0.4 && this.road.clearance(k, side, 16) >= 16;
  }

  // Where the car starts: just before the start line, in the downhill (left) lane, facing down.
  get spawn() {
    const r = this.road;
    const i = r.startIndex - 12;
    const p = r.pointAt(i, -1.7);
    return { pos: [p[0], p[1] + 0.8, p[2]], yaw: r.heading[i], index: i };
  }

  // A pose back on the road near sample i (for recovering a stuck or rolled car).
  recoverAt(i) {
    const r = this.road;
    const k = Math.max(4, Math.min(r.count - 10, i));
    const p = r.pointAt(k, -1.7);
    return { pos: [p[0], p[1] + 0.8, p[2]], yaw: r.heading[k], index: k };
  }

  // kind 'ground' (road, terrain) stays visible much further than 'detail' (trees, signs, rails).
  #addChunk(group, x, z, r, kind = 'detail') {
    this.scene.add(group);
    this.chunks.push({ group, x, z, r, ground: kind === 'ground' });
  }

  #buildRoad() {
    const road = this.road;
    const asphaltMat = new THREE.MeshLambertMaterial({ map: asphaltTexture() });
    const edgeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const xs = crossSection(road, 0);
    const asphaltCols = xs.map((c, k) => (c[2] === 'asphalt' ? k : -1)).filter((k) => k >= 0);
    for (let i0 = 0; i0 < road.count - 1; i0 += ROAD_CHUNK) {
      const i1 = Math.min(road.count - 1, i0 + ROAD_CHUNK);
      // Asphalt: textured strip, u across the road, v every 10 m.
      const aPos = [];
      const aUv = [];
      const aIdx = [];
      // Verge, shoulder and gutters: vertex-coloured strips.
      const ePos = [];
      const eCol = [];
      for (let i = i0; i <= i1; i++) {
        const sec = crossSection(road, i);
        for (const k of asphaltCols) {
          const [l, dy] = sec[k];
          aPos.push(...road.pointAt(i, l, dy + 0.005));
          aUv.push((PAVED - l) / (2 * PAVED), (i * STEP) / 10);
        }
        if (i > i0) {
          for (let c = 0; c < sec.length - 1; c++) {
            const kind = sec[c][2] === 'asphalt' && sec[c + 1][2] === 'asphalt' ? null : sec[c][2] === 'asphalt' ? sec[c + 1][2] : sec[c][2];
            if (!kind) continue;
            const prev = crossSection(road, i - 1);
            const quad = [road.pointAt(i - 1, prev[c][0], prev[c][1]), road.pointAt(i, sec[c][0], sec[c][1]), road.pointAt(i, sec[c + 1][0], sec[c + 1][1]), road.pointAt(i - 1, prev[c + 1][0], prev[c + 1][1])];
            const col = COLORS[kind];
            for (const v of [quad[0], quad[2], quad[1], quad[0], quad[3], quad[2]]) {
              ePos.push(...v);
              eCol.push(...col);
            }
          }
        }
      }
      const cols = asphaltCols.length;
      for (let r = 0; r < i1 - i0; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = r * cols + c;
          aIdx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
        }
      }
      const ag = new THREE.BufferGeometry();
      ag.setAttribute('position', new THREE.Float32BufferAttribute(aPos, 3));
      ag.setAttribute('uv', new THREE.Float32BufferAttribute(aUv, 2));
      ag.setIndex(aIdx);
      ag.computeVertexNormals();
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.Float32BufferAttribute(ePos, 3));
      eg.setAttribute('color', new THREE.Float32BufferAttribute(eCol, 3));
      eg.computeVertexNormals();
      const group = new THREE.Group();
      group.add(new THREE.Mesh(ag, asphaltMat), new THREE.Mesh(eg, edgeMat));
      const mid = Math.floor((i0 + i1) / 2);
      this.#addChunk(group, road.x[mid], road.z[mid], ROAD_CHUNK * STEP * 0.6, 'ground');
    }
  }

  #buildTerrain() {
    const t = this.terrain;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (let tz = 0; tz < t.nz - 1; tz += TILE) {
      for (let tx = 0; tx < t.nx - 1; tx += TILE) {
        const ex = Math.min(t.nx - 1, tx + TILE);
        const ez = Math.min(t.nz - 1, tz + TILE);
        // Tiles away from the road are built at half resolution: wooded slopes seen from afar.
        let near = Infinity;
        for (let iz = tz; iz <= ez; iz += 4) for (let ix = tx; ix <= ex; ix += 4) near = Math.min(near, t.roadDist[iz * t.nx + ix]);
        const stride = near > 59 ? 2 : 1;
        const w = Math.floor((ex - tx) / stride) + 1;
        const rows = Math.floor((ez - tz) / stride) + 1;
        const pos = [];
        const col = [];
        const idx = [];
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < w; c++) {
            const iz = tz + r * stride;
            const ix = tx + c * stride;
            const k = iz * t.nx + ix;
            const x = t.x0 + ix * t.cell;
            const z = t.z0 + iz * t.cell;
            const h = t.heights[k];
            pos.push(x, h, z);
            // Colour by steepness and distance from the road: forest floor by the road, rock on
            // the cuts, and dark mottled canopy further out where the forest closes in.
            const hx = t.heights[iz * t.nx + Math.min(t.nx - 1, ix + 1)] - h;
            const hz = t.heights[Math.min(t.nz - 1, iz + 1) * t.nx + ix] - h;
            const slope = Math.hypot(hx, hz) / t.cell;
            const n = noise2(x / 9, z / 9);
            let cc;
            if (t.roadDist[k] > 48) {
              const m = noise2(x / 26, z / 26);
              cc = [0.075 + m * 0.05, 0.14 + m * 0.07, 0.085 + m * 0.03];
              if (noise2(x / 520 + 7, z / 520) > 0.72) cc = [cc[0] * 2.2, cc[1] * 1.1, cc[2] * 0.8];
            } else cc = [0.13 + n * 0.05, 0.19 + n * 0.06, 0.1];
            if (slope > 0.75) cc = [0.33 + n * 0.06, 0.32 + n * 0.06, 0.3 + n * 0.05];
            else if (slope > 0.45 && t.roadDist[k] <= 48) cc = [0.24, 0.23, 0.17];
            col.push(...cc);
          }
        }
        for (let r = 0; r < rows - 1; r++) {
          for (let c = 0; c < w - 1; c++) {
            const a = r * w + c;
            idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, mat);
        const cx = t.x0 + ((tx + ex) / 2) * t.cell;
        const cz = t.z0 + ((tz + ez) / 2) * t.cell;
        this.#addChunk(mesh, cx, cz, TILE * t.cell * 0.75, 'ground');
      }
    }
  }

  #buildRails() {
    const road = this.road;
    const beamMat = new THREE.MeshLambertMaterial({ color: 0xd8dade, side: THREE.DoubleSide });
    const postGeo = new THREE.BoxGeometry(0.1, 0.8, 0.1);
    postGeo.translate(0, 0.4, 0);
    const posts = [];
    for (let i0 = 0; i0 < road.count - 1; i0 += ROAD_CHUNK) {
      const i1 = Math.min(road.count - 1, i0 + ROAD_CHUNK);
      const pos = [];
      for (const side of [1, -1]) {
        const on = this.layout.rail[side];
        for (let i = i0; i < i1; i++) {
          if (!on[i] || !on[i + 1]) continue;
          const a = road.pointAt(i, side * RAIL);
          const b = road.pointAt(i + 1, side * RAIL);
          // The W-beam: a 0.3 m tall band at 0.45-0.75 m.
          const q = [
            [a[0], a[1] + 0.45, a[2]],
            [b[0], b[1] + 0.45, b[2]],
            [b[0], b[1] + 0.78, b[2]],
            [a[0], a[1] + 0.78, a[2]],
          ];
          for (const v of [q[0], q[1], q[2], q[0], q[2], q[3]]) pos.push(...v);
          if (i % 2 === 0) posts.push([a, road.heading[i]]);
        }
      }
      if (!pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const mid = Math.floor((i0 + i1) / 2);
      this.#addChunk(new THREE.Mesh(g, beamMat), road.x[mid], road.z[mid], ROAD_CHUNK * STEP * 0.6);
    }
    const inst = new THREE.InstancedMesh(postGeo, new THREE.MeshLambertMaterial({ color: 0x8c9096 }), posts.length);
    const m = new THREE.Matrix4();
    posts.forEach(([p, h], k) => inst.setMatrixAt(k, m.makeRotationY(h).setPosition(p[0], p[1], p[2])));
    this.scene.add(inst);
  }

  // A streetlight at every tight corner (on the outside) and along the start and town.
  #buildStreetlights() {
    this.lampGlows = [];
    const road = this.road;
    const spots = [];
    let last = -100;
    for (let i = 10; i < road.count - 10 && this.track.cornerLights; i++) {
      const k = road.kappa[i];
      if (Math.abs(k) > 1 / 22 && i - last > 25) {
        let best = i;
        for (let j = i; j < Math.min(road.count, i + 20); j++) if (Math.abs(road.kappa[j]) > Math.abs(road.kappa[best])) best = j;
        spots.push([best, k > 0 ? -1 : 1]);
        last = best;
        i = best + 10;
      }
    }
    for (const i of [road.startIndex, road.startIndex + 40, road.finishIndex - 30, road.finishIndex, road.count - 15]) spots.push([i, 1]);
    this.lights = spots;
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x55585e });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2a6 });
    const glow = new THREE.SpriteMaterial({ map: glowTexture('rgba(255,214,140,0.9)', 'rgba(255,170,60,0)'), blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
    const poolMat = new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,200,120,0.55)', 'rgba(255,160,60,0)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: true });
    const pole = new THREE.CylinderGeometry(0.09, 0.12, 7, 6);
    pole.translate(0, 3.5, 0);
    const arm = new THREE.BoxGeometry(0.08, 0.08, 1.8);
    const head = new THREE.BoxGeometry(0.35, 0.12, 0.6);
    const pool = new THREE.CircleGeometry(10, 20);
    pool.rotateX(-Math.PI / 2);
    for (const [i, side] of spots) {
      const base = road.pointAt(i, side * (RAIL + 0.8));
      const h = road.heading[i];
      const toward = [-Math.cos(h) * side, Math.sin(h) * side];
      const g = new THREE.Group();
      g.position.set(base[0], base[1], base[2]);
      g.add(new THREE.Mesh(pole, poleMat));
      const a = new THREE.Mesh(arm, poleMat);
      a.position.set(toward[0] * 0.9, 7, toward[1] * 0.9);
      a.rotation.y = Math.atan2(toward[0], toward[1]);
      const hd = new THREE.Mesh(head, lampMat);
      hd.position.set(toward[0] * 1.7, 6.9, toward[1] * 1.7);
      hd.rotation.y = a.rotation.y;
      const s = new THREE.Sprite(glow);
      s.scale.set(4, 4, 1);
      s.position.copy(hd.position);
      const p = new THREE.Mesh(pool, poolMat);
      const c = road.pointAt(i, side * 1.5, 0.03);
      p.position.set(c[0] - base[0], c[1] - base[1], c[2] - base[2]);
      g.add(a, hd, s, p);
      this.lampGlows.push(s, p);
      this.#addChunk(g, base[0], base[2], 20);
    }
  }

  // Cedar forest and undergrowth, packed in close to the road. Instanced per road chunk so the
  // distance culling hides whole patches of forest at a time.
  #buildTrees() {
    const t = this.terrain;
    const road = this.road;
    const groups = new Map(); // chunk index -> { trees: [], bushes: [] }
    const bucket = (i) => {
      const k = Math.floor(i / ROAD_CHUNK);
      if (!groups.has(k)) groups.set(k, { trees: [], bushes: [], maples: [] });
      return groups.get(k);
    };
    const step = 5;
    for (let z = t.z0 + 10; z < t.z0 + (t.nz - 1) * t.cell - 10; z += step) {
      for (let x = t.x0 + 10; x < t.x0 + (t.nx - 1) * t.cell - 10; x += step) {
        const jx = x + (noise2(x * 0.7, z * 0.3) - 0.5) * 6;
        const jz = z + (noise2(x * 0.3, z * 0.7) - 0.5) * 6;
        const near = t.nearestRoad(jx, jz, 60);
        if (near.d < 9.5 || near.d > 58) continue;
        // Here and there the trees open up on the downhill side: a view out over the valley.
        if (near.d < 46 && t.natural(jx, jz) < road.y[near.i] - 4 && noise2(near.i / 70, 3.3) > 0.55) {
          if (noise2(jx * 0.8, jz * 0.8) > 0.7) bucket(near.i).bushes.push([jx, t.heightAt(jx, jz) - 0.3, jz, 0.8 + noise2(jx, jz)]);
          continue;
        }
        if (Math.hypot(jx - t.lake.x, jz - t.lake.z) < t.lake.r + 10) continue;
        if (Math.hypot(jx - t.town.x, jz - t.town.z) < t.town.r) continue;
        const y = t.heightAt(jx, jz) - 0.3;
        const dense = noise2(jx / 30, jz / 30);
        // Patches of autumn maples break up the cedars with red, orange and gold.
        const maple = noise2(jx / 45 + 9, jz / 45) > 0.7 || (near.d < 20 && noise2(jx * 0.5, jz * 0.5) > 0.9);
        if (dense > 0.22 && maple) bucket(near.i).maples.push([jx, y, jz, 6 + noise2(jx, jz) * 6]);
        else if (dense > 0.22) bucket(near.i).trees.push([jx, y, jz, 10 + noise2(jx, jz) * 10]);
        else bucket(near.i).bushes.push([jx, y, jz, 1 + noise2(jz, jx) * 1.4]);
        // Undergrowth between the trees, thicker near the road edge.
        if (near.d < 22 && noise2(jx * 1.3, jz * 1.3) > 0.45) bucket(near.i).bushes.push([jx + 2.2, t.heightAt(jx + 2.2, jz - 1.5), jz - 1.5, 0.8 + noise2(jx, 3) * 1.2]);
      }
    }
    // The deep forest beyond: a ring of simpler trees out to about 160 m, bucketed by area.
    const far = new Map();
    const fstep = 8.5;
    const FT = 200;
    for (let z = t.z0 + 8; z < t.z0 + (t.nz - 1) * t.cell - 8; z += fstep) {
      for (let x = t.x0 + 8; x < t.x0 + (t.nx - 1) * t.cell - 8; x += fstep) {
        const jx = x + (noise2(x * 0.5, z * 0.4) - 0.5) * 7;
        const jz = z + (noise2(x * 0.4, z * 0.5) - 0.5) * 7;
        const d = t.roadDistance(jx, jz);
        if (d < 62 || d > 165) continue;
        if (Math.hypot(jx - t.lake.x, jz - t.lake.z) < t.lake.r + 10 || Math.hypot(jx - t.town.x, jz - t.town.z) < t.town.r) continue;
        if (t.nearestRoad(jx, jz, 56).d < 56) continue;
        if (noise2(jx / 30, jz / 30) < 0.16) continue;
        const key = `${Math.floor(jx / FT)},${Math.floor(jz / FT)}`;
        if (!far.has(key)) far.set(key, []);
        far.get(key).push([jx, t.heightAt(jx, jz) - 0.4, jz, 11 + noise2(jx, jz) * 12]);
      }
    }

    const trunk = new THREE.CylinderGeometry(0.18, 0.28, 1, 5);
    trunk.translate(0, 0.5, 0);
    const crown = new THREE.ConeGeometry(1, 1, 6);
    crown.translate(0, 0.5, 0);
    const bush = new THREE.IcosahedronGeometry(1, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3b2a1e });
    const crownMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const bushMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    let total = 0;
    for (const [k, g] of groups) {
      const group = new THREE.Group();
      if (g.trees.length) {
        const trunks = new THREE.InstancedMesh(trunk, trunkMat, g.trees.length);
        const crowns = new THREE.InstancedMesh(crown, crownMat, g.trees.length);
        g.trees.forEach(([x, y, z, h], n) => {
          trunks.setMatrixAt(n, m.compose(v.set(x, y, z), q, sc.set(1, h * 0.35, 1)));
          crowns.setMatrixAt(n, m.compose(v.set(x, y + h * 0.22, z), q, sc.set(h * 0.19, h * 0.82, h * 0.19)));
          const b = 0.75 + noise2(x * 3, z * 3) * 0.5;
          crowns.setColorAt(n, col.setRGB(0.1 * b, 0.22 * b, 0.13 * b));
        });
        group.add(trunks, crowns);
      }
      if (g.maples.length) {
        const trunks = new THREE.InstancedMesh(trunk, trunkMat, g.maples.length);
        const crowns = new THREE.InstancedMesh(bush, crownMat, g.maples.length);
        const autumn = [
          [0.62, 0.16, 0.08],
          [0.72, 0.32, 0.08],
          [0.74, 0.5, 0.12],
          [0.5, 0.13, 0.1],
        ];
        g.maples.forEach(([x, y, z, h], n) => {
          trunks.setMatrixAt(n, m.compose(v.set(x, y, z), q, sc.set(0.9, h * 0.45, 0.9)));
          crowns.setMatrixAt(n, m.compose(v.set(x, y + h * 0.62, z), q.setFromAxisAngle(Y_AXIS, x * 1.7), sc.set(h * 0.33, h * 0.3, h * 0.33)));
          q.identity();
          const [r, gg, b] = autumn[Math.floor(noise2(x * 0.9, z * 0.9) * 4) % 4];
          const k2 = 0.8 + noise2(x * 3, z * 2) * 0.35;
          crowns.setColorAt(n, col.setRGB(r * k2, gg * k2, b * k2));
        });
        group.add(trunks, crowns);
      }
      if (g.bushes.length) {
        const bushes = new THREE.InstancedMesh(bush, bushMat, g.bushes.length);
        g.bushes.forEach(([x, y, z, r], n) => {
          bushes.setMatrixAt(n, m.compose(v.set(x, y + r * 0.4, z), q.setFromAxisAngle(Y_AXIS, x), sc.set(r, r * 0.75, r)));
          const b = 0.7 + noise2(z * 2, x * 2) * 0.6;
          bushes.setColorAt(n, col.setRGB(0.13 * b, 0.25 * b, 0.11 * b));
        });
        q.identity();
        group.add(bushes);
      }
      const mid = Math.min(road.count - 1, k * ROAD_CHUNK + ROAD_CHUNK / 2);
      this.#addChunk(group, road.x[mid], road.z[mid], ROAD_CHUNK * STEP * 0.6 + 60);
      total += g.trees.length + g.maples.length;
    }
    const farCrown = new THREE.ConeGeometry(1, 1, 5);
    farCrown.translate(0, 0.5, 0);
    for (const [key, list] of far) {
      const crowns = new THREE.InstancedMesh(farCrown, crownMat, list.length);
      let cx = 0;
      let cz = 0;
      list.forEach(([x, y, z, h], n) => {
        crowns.setMatrixAt(n, m.compose(v.set(x, y, z), q, sc.set(h * 0.21, h, h * 0.21)));
        const b = 0.7 + noise2(x * 3, z * 3) * 0.5;
        crowns.setColorAt(n, col.setRGB(0.09 * b, 0.19 * b, 0.12 * b));
        cx += x;
        cz += z;
      });
      void key;
      this.#addChunk(crowns, cx / list.length, cz / list.length, FT * 0.75);
      total += list.length;
    }
    this.treeCount = total;
  }

  // Roadside furniture: reflector posts, chevron signs on tight corners, utility poles, boulders,
  // and concrete retaining walls on the uphill cuts.
  #buildRoadside() {
    const road = this.road;
    const t = this.terrain;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3(1, 1, 1);
    const posts = [];
    const reflectors = [];
    const chevrons = [];
    const poles = [];
    const rocks = [];
    for (let i = 4; i < road.count - 4; i++) {
      for (const side of [1, -1]) {
        // Reflector posts every 20 m where there is no guardrail.
        if (i % 10 === 0 && !this.layout.rail[side][i]) {
          const p = road.pointAt(i, side * (RAIL + 0.3));
          posts.push([p, road.heading[i]]);
          reflectors.push([[p[0], p[1] + 0.95, p[2]], road.heading[i]]);
        }
        // Boulders along the foot of the uphill cuts.
        if (i % 7 === 0 && t.sideProfile(i, side) > 0 && noise2(i * 0.37, side) > 0.55) {
          const p = road.pointAt(i, side * 9.4);
          rocks.push([p[0], t.heightAt(p[0], p[2]), p[2], 0.6 + noise2(i, 2) * 1.2]);
        }
      }
      // Chevrons on the outside of tight corners, every 12 m.
      const k = road.kappa[i];
      if (Math.abs(k) > 1 / 40 && i % 6 === 0) {
        const side = k > 0 ? -1 : 1;
        const p = road.pointAt(i, side * (RAIL + 0.6));
        chevrons.push([p, road.heading[i], side]);
      }
      // Utility poles down one side.
      if (i % 25 === 0) {
        const side = t.sideProfile(i, 1) >= 0 ? 1 : -1;
        const p = road.pointAt(i, side * 7.5);
        poles.push([p[0], t.heightAt(p[0], p[2]) - 0.3, p[2]]);
      }
    }
    const inst = (geo, mat, list, place) => {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((item, n) => mesh.setMatrixAt(n, place(item)));
      this.scene.add(mesh);
      return mesh;
    };
    const postGeo = new THREE.BoxGeometry(0.1, 1.1, 0.1);
    postGeo.translate(0, 0.55, 0);
    inst(postGeo, new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }), posts, ([p, h]) => m.compose(v.set(...p), q.setFromAxisAngle(up, h), sc.set(1, 1, 1)));
    const refl = new THREE.BoxGeometry(0.12, 0.12, 0.04);
    inst(refl, new THREE.MeshBasicMaterial({ color: 0xff8a1c }), reflectors, ([p, h]) => m.compose(v.set(...p), q.setFromAxisAngle(up, h), sc.set(1, 1, 1)));
    // Chevron sign: yellow board with a black arrow, on a short post, facing oncoming traffic.
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#f2c21a';
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#111';
    g.beginPath();
    g.moveTo(8, 4);
    g.lineTo(21, 16);
    g.lineTo(8, 28);
    g.lineTo(14, 28);
    g.lineTo(27, 16);
    g.lineTo(14, 4);
    g.closePath();
    g.fill();
    const chevTex = new THREE.CanvasTexture(c);
    chevTex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.PlaneGeometry(0.7, 0.7);
    board.translate(0, 1.25, 0);
    const chevMat = new THREE.MeshLambertMaterial({ map: chevTex, emissive: 0x332600, side: THREE.DoubleSide });
    const forRight = chevrons.filter((x) => x[2] > 0);
    const forLeft = chevrons.filter((x) => x[2] < 0);
    // The arrow points toward the turn: mirror the board for one direction.
    inst(board, chevMat, forRight, ([p, h]) => m.compose(v.set(...p), q.setFromAxisAngle(up, h + Math.PI), sc.set(-1, 1, 1)));
    inst(board, chevMat, forLeft, ([p, h]) => m.compose(v.set(...p), q.setFromAxisAngle(up, h + Math.PI), sc.set(1, 1, 1)));
    inst(postGeo, new THREE.MeshLambertMaterial({ color: 0x777777 }), chevrons, ([p, h]) => m.compose(v.set(...p), q.setFromAxisAngle(up, h), sc.set(0.6, 0.85, 0.6)));
    const poleGeo = new THREE.CylinderGeometry(0.13, 0.16, 10, 6);
    poleGeo.translate(0, 5, 0);
    inst(poleGeo, new THREE.MeshLambertMaterial({ color: 0x5c5650 }), poles, (p) => m.compose(v.set(...p), q.identity(), sc.set(1, 1, 1)));
    const barGeo = new THREE.BoxGeometry(1.6, 0.1, 0.1);
    barGeo.translate(0, 9.2, 0);
    inst(barGeo, new THREE.MeshLambertMaterial({ color: 0x5c5650 }), poles, (p) => m.compose(v.set(...p), q.identity(), sc.set(1, 1, 1)));
    // Sagging wires between the poles.
    const wire = [];
    for (let k = 0; k < poles.length - 1; k++) {
      const [a, b] = [poles[k], poles[k + 1]];
      if (Math.hypot(a[0] - b[0], a[2] - b[2]) > 70) continue;
      for (const off of [-0.7, 0.7]) {
        for (let s = 0; s < 6; s++) {
          const f0 = s / 6;
          const f1 = (s + 1) / 6;
          const at = (f) => [a[0] + (b[0] - a[0]) * f + off, a[1] + 9.2 + (b[1] - a[1]) * f - Math.sin(Math.PI * f) * 1.2, a[2] + (b[2] - a[2]) * f];
          wire.push(...at(f0), ...at(f1));
        }
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    this.scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1a1c22 })));
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMesh = inst(rockGeo, new THREE.MeshLambertMaterial({ color: 0x5a5852, flatShading: true }), rocks, ([x, y, z, r]) => m.compose(v.set(x, y + r * 0.3, z), q.setFromAxisAngle(up, x * 3), sc.set(r * 1.3, r, r)));
    void rockMesh;

    // Uphill cuts: concrete retaining walls on Akina; bare, mossy rock faces on the wilder roads.
    const rocky = !!this.track.rockCuts;
    const wallTex = (() => {
      const cv = document.createElement('canvas');
      const gg = cv.getContext('2d');
      if (!rocky) {
        cv.width = cv.height = 32;
        gg.fillStyle = '#7d7c76';
        gg.fillRect(0, 0, 32, 32);
        gg.fillStyle = '#5d5c57';
        gg.fillRect(0, 0, 32, 3);
        gg.fillRect(0, 0, 3, 32);
      } else {
        // Layered grey-brown rock with dark cracks, and moss creeping down from the top.
        cv.width = cv.height = 64;
        gg.fillStyle = '#5b5750';
        gg.fillRect(0, 0, 64, 64);
        for (let y = 0; y < 64; y += 2) {
          const k = 70 + Math.round(noise2(0.5, y / 6) * 40);
          gg.fillStyle = `rgb(${k},${k - 4},${k - 10})`;
          gg.fillRect(0, y, 64, 2);
        }
        for (let n = 0; n < 380; n++) {
          const k = 50 + Math.random() * 60;
          gg.fillStyle = `rgb(${k},${k - 3},${k - 8})`;
          gg.fillRect(Math.random() * 64, Math.random() * 64, 2, 1);
        }
        gg.strokeStyle = '#2b2925';
        gg.lineWidth = 1;
        for (let n = 0; n < 9; n++) {
          let x = Math.random() * 64;
          gg.beginPath();
          gg.moveTo(x, 0);
          for (let y = 8; y <= 64; y += 8) gg.lineTo((x += (Math.random() - 0.5) * 10), y);
          gg.stroke();
        }
        for (let n = 0; n < 260; n++) {
          const y = Math.random() ** 2.2 * 64;
          gg.fillStyle = Math.random() < 0.5 ? '#3c5a2a' : '#4f6e33';
          gg.fillRect(Math.random() * 64, 63 - y, 2 + Math.random() * 3, 2);
        }
      }
      const tx = new THREE.CanvasTexture(cv);
      tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
      tx.colorSpace = THREE.SRGBColorSpace;
      return tx;
    })();
    const wallMat = new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.DoubleSide, flatShading: rocky });
    // A rock face gets a bulging middle row so it reads as rough stone rather than a flat panel.
    const rows = rocky ? [[8.6, -0.6, 0], [9.9 + 0, 1.8, 1], [11.4, 5.2, 0]] : [[8.6, -0.6, 0], [11, 4.2, 0]];
    for (const side of [1, -1]) {
      for (let i0 = 0; i0 < road.count - 1; i0 += ROAD_CHUNK) {
        const i1 = Math.min(road.count - 1, i0 + ROAD_CHUNK);
        const pos = [];
        const uv = [];
        const at = (i, [d, up, bulge]) => {
          const j = bulge ? (noise2(i * 0.45, side * 3) - 0.5) * 1.6 : 0;
          const k = bulge ? (noise2(i * 0.3 + 5, side) - 0.5) * 1.2 : 0;
          return road.pointAt(i, side * (d + j), up + k);
        };
        for (let i = i0; i < i1; i++) {
          if (!this.#wallAt(i, side) || !this.#wallAt(i + 1, side)) continue;
          const u0 = (i * STEP) / 3;
          const u1 = ((i + 1) * STEP) / 3;
          for (let r = 0; r < rows.length - 1; r++) {
            const v0 = (r / (rows.length - 1)) * 1.7;
            const v1 = ((r + 1) / (rows.length - 1)) * 1.7;
            const quad = [at(i, rows[r]), at(i + 1, rows[r]), at(i + 1, rows[r + 1]), at(i, rows[r + 1])];
            for (const [vv, uu] of [[quad[0], [u0, v0]], [quad[1], [u1, v0]], [quad[2], [u1, v1]], [quad[0], [u0, v0]], [quad[2], [u1, v1]], [quad[3], [u0, v1]]]) {
              pos.push(...vv);
              uv.push(...uu);
            }
          }
        }
        if (!pos.length) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.computeVertexNormals();
        const mid = Math.floor((i0 + i1) / 2);
        this.#addChunk(new THREE.Mesh(geo, wallMat), road.x[mid], road.z[mid], ROAD_CHUNK * STEP * 0.6);
      }
    }
  }

  #buildLake() {
    const lk = this.terrain.lake;
    const water = new THREE.Mesh(new THREE.CircleGeometry(lk.r + 30, 40), new THREE.MeshLambertMaterial({ color: 0x0c1b33, emissive: 0x050b18 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(lk.x, lk.level, lk.z);
    // The moon reflected in the lake.
    const glint = new THREE.Mesh(new THREE.PlaneGeometry(14, 60), new THREE.MeshBasicMaterial({ map: glowTexture('rgba(190,210,255,0.5)', 'rgba(120,150,220,0)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    glint.rotation.x = -Math.PI / 2;
    glint.position.set(lk.x + 10, lk.level + 0.05, lk.z - 20);
    this.scene.add(water, glint);
  }

  // A few houses, a shop and a vending machine glowing at the bottom of the pass.
  #buildTown() {
    const t = this.terrain;
    const road = this.road;
    const win = windowsTexture();
    const wallMats = [0x4a4740, 0x5a5048, 0x3e434a, 0x55534d].map((c) => new THREE.MeshLambertMaterial({ color: c, emissive: 0xffffff, emissiveMap: win, emissiveIntensity: 0.9 }));
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x2a2f38, flatShading: true });
    let placed = 0;
    for (let k = 0; k < 160 && placed < 34; k++) {
      const a = noise2(k * 1.7, 3.1) * Math.PI * 2 + k;
      const d = 20 + noise2(k * 0.9, 7.7) * (t.town.r - 30);
      const x = t.town.x + Math.cos(a) * d;
      const z = t.town.z + Math.sin(a) * d;
      const near = t.nearestRoad(x, z, 40);
      if (near.d < 13) continue;
      const w = 7 + noise2(k, 1) * 7;
      const dpt = 6 + noise2(1, k) * 6;
      const h = 4 + Math.round(noise2(k, k) * 2) * 3;
      const y = t.heightAt(x, z);
      const yaw = near.i >= 0 ? road.heading[near.i] : 0;
      const box = new THREE.BoxGeometry(w, h, dpt);
      const uv = box.getAttribute('uv');
      for (let v = 0; v < uv.count; v++) uv.setXY(v, uv.getX(v) * (w / 6), uv.getY(v) * (h / 4));
      const house = new THREE.Mesh(box, wallMats[k % wallMats.length]);
      house.position.set(x, y + h / 2, z);
      house.rotation.y = yaw;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, dpt) * 0.55, 2.2, 4), roofMat);
      roof.position.set(x, y + h + 1.1, z);
      roof.rotation.y = yaw + Math.PI / 4;
      const g = new THREE.Group();
      g.add(house, roof);
      this.#addChunk(g, x, z, 15);
      placed++;
    }
    // Vending machine by the finish.
    const f = road.finishIndex + 10;
    const p = road.pointAt(f, -(RAIL + 1.6));
    const vend = new THREE.Mesh(new THREE.BoxGeometry(1, 1.9, 0.8), new THREE.MeshBasicMaterial({ color: 0xdff4ff }));
    vend.position.set(p[0], p[1] + 0.95, p[2]);
    vend.rotation.y = road.heading[f];
    const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(190,230,255,0.7)', 'rgba(120,180,255,0)'), blending: THREE.AdditiveBlending, depthWrite: false }));
    glowSprite.scale.set(5, 5, 1);
    glowSprite.position.copy(vend.position);
    this.scene.add(vend, glowSprite);
  }

  #buildLines() {
    const road = this.road;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 8;
    const g = c.getContext('2d');
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 2; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#eee';
        g.fillRect(x * 4, y * 4, 4, 4);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    const mat = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const i of [road.startIndex, road.finishIndex]) {
      const a = road.pointAt(i, PAVED, 0.02);
      const b = road.pointAt(i, -PAVED, 0.02);
      const h = road.heading[i];
      const f = [Math.sin(h) * 0.6, 0, Math.cos(h) * 0.6];
      const pos = [a[0] - f[0], a[1], a[2] - f[2], b[0] - f[0], b[1], b[2] - f[2], b[0] + f[0], b[1], b[2] + f[2], a[0] + f[0], a[1], a[2] + f[2]];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      geo.setIndex([0, 2, 1, 0, 3, 2]);
      geo.computeVertexNormals();
      this.scene.add(new THREE.Mesh(geo, mat));
    }
  }

  // Things that make the mountain feel lived-in: curve mirrors at the blind corners, warning and
  // speed signs, stone lanterns, little roadside shrines and the odd red torii gate.
  #buildLandmarks() {
    const road = this.road;
    const t = this.terrain;
    const add = (obj, i) => this.#addChunk(obj, road.x[i], road.z[i], 25);
    const canvasTex = (draw, w = 64, h = 64) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      draw(c.getContext('2d'));
      const tx = new THREE.CanvasTexture(c);
      tx.colorSpace = THREE.SRGBColorSpace;
      return tx;
    };
    const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
    const orange = lambert(0xe8711c);
    const grey = lambert(0x8a8a88);
    const stone = lambert(0x7c7a72, { flatShading: true });
    const red = lambert(0xc4261d);
    const black = lambert(0x1b1b1d);
    const mirrorFace = new THREE.MeshBasicMaterial({ color: 0xb8c8d8 });
    const warnTex = canvasTex((g) => {
      g.fillStyle = '#f1c40f';
      g.beginPath();
      g.moveTo(32, 2);
      g.lineTo(62, 32);
      g.lineTo(32, 62);
      g.lineTo(2, 32);
      g.closePath();
      g.fill();
      g.strokeStyle = '#111';
      g.lineWidth = 3;
      g.stroke();
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(26, 46);
      g.lineTo(26, 30);
      g.quadraticCurveTo(26, 20, 38, 20);
      g.stroke();
      g.beginPath();
      g.moveTo(36, 13);
      g.lineTo(44, 20);
      g.lineTo(36, 27);
      g.fillStyle = '#111';
      g.fill();
    });
    const speedTex = canvasTex((g) => {
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(32, 32, 30, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#d2201a';
      g.lineWidth = 8;
      g.beginPath();
      g.arc(32, 32, 26, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#1b3ea8';
      g.font = 'bold 26px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('40', 32, 34);
    });
    const signMat = (map) => new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 });
    const warnMat = signMat(warnTex);
    const speedMat = signMat(speedTex);
    const pole = (h, mat = grey, r = 0.05) => {
      const geo = new THREE.CylinderGeometry(r, r, h, 6);
      geo.translate(0, h / 2, 0);
      return new THREE.Mesh(geo, mat);
    };
    // Place an object on the roadside at sample i, `off` metres to the side, facing oncoming cars.
    const place = (obj, i, side, off) => {
      const p = road.pointAt(i, side * off);
      obj.position.set(p[0], Math.max(p[1], t.heightAt(p[0], p[2])) - 0.05, p[2]);
      obj.rotation.y = road.heading[i] + Math.PI;
      return obj;
    };

    let lastMirror = -999;
    let lastWarn = -999;
    for (let i = 30; i < road.count - 30; i++) {
      const k = road.kappa[i];
      const side = k > 0 ? -1 : 1; // outside of the corner
      // Curve mirrors on the outside of blind, tight corners.
      if (Math.abs(k) > 1 / 26 && i - lastMirror > 40) {
        const g = new THREE.Group();
        g.add(pole(2.6, orange, 0.06));
        const rim = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), orange);
        rim.position.set(0, 2.9, 0.02);
        const face = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), mirrorFace);
        face.position.set(0, 2.9, 0.04);
        g.add(rim, face);
        add(place(g, i, side, 5.2), i);
        lastMirror = i;
      }
      // A curve warning sign before the corner starts.
      if (Math.abs(road.kappa[Math.min(road.count - 1, i + 30)]) > 1 / 35 && Math.abs(k) < 1 / 80 && i - lastWarn > 100) {
        const g = new THREE.Group();
        g.add(pole(2.1));
        const board = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), warnMat);
        board.position.y = 2.2;
        if (road.kappa[i + 30] < 0) board.scale.x = -1;
        g.add(board);
        add(place(g, i, -1, 5), i);
        lastWarn = i;
      }
      // Speed limit signs every 600 m.
      if (i % 300 === 0) {
        const g = new THREE.Group();
        g.add(pole(2.2));
        const board = new THREE.Mesh(new THREE.CircleGeometry(0.33, 20), speedMat);
        board.position.y = 2.3;
        g.add(board);
        add(place(g, i, -1, 5.4), i);
      }
      // Stone lanterns, little shrines and torii gates where there is room beside the road.
      if (i % 170 === 85) {
        const side2 = t.sideProfile(i, 1) >= 0 ? 1 : -1;
        if (road.clearance(i, side2, 20) < 20) continue;
        const g = new THREE.Group();
        const kind = Math.floor(noise2(i * 0.13, 4) * 3);
        if (kind === 0) {
          // Torii gate.
          for (const x of [-1.4, 1.4]) {
            const p = pole(3.4, red, 0.13);
            p.position.x = x;
            g.add(p);
          }
          const kasagi = new THREE.Mesh(new THREE.BoxGeometry(4, 0.22, 0.32), black);
          kasagi.position.y = 3.5;
          const nuki = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.16, 0.2), red);
          nuki.position.y = 2.9;
          g.add(kasagi, nuki);
        } else if (kind === 1) {
          // Small shrine: a stone base and a wooden hut with a dark roof, with a red bib on a statue.
          const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 1.2), stone);
          base.position.y = 0.2;
          const hut = new THREE.Mesh(new THREE.BoxGeometry(1, 0.9, 0.8), lambert(0x6a4a2e));
          hut.position.y = 0.85;
          const roof = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.5, 4), black);
          roof.position.y = 1.55;
          roof.rotation.y = Math.PI / 4;
          const jizo = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.3, 2, 6), stone);
          jizo.position.set(0.85, 0.65, 0.3);
          const bib = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.2, 6), red);
          bib.position.set(0.85, 0.72, 0.3);
          g.add(base, hut, roof, jizo, bib);
        } else {
          // Pair of stone lanterns.
          for (const x of [-1.2, 1.2]) {
            const b = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.9, 6), stone);
            b.position.set(x, 0.45, 0);
            const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, 0.45), stone);
            box.position.set(x, 1.1, 0);
            const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.3, 4), stone);
            cap.position.set(x, 1.45, 0);
            cap.rotation.y = Math.PI / 4;
            g.add(b, box, cap);
          }
        }
        g.scale.setScalar(1);
        add(place(g, i, side2, 11), i);
      }
    }
  }

  // Recolour for the time of day and switch the streetlight glow on after dark.
  setTime(preset) {
    this.cloudSea.setTime(preset);
    for (const o of this.lampGlows) o.visible = preset.lights;
  }

  // Show only what is within reach: detail (trees, signs) closer in, ground (road, terrain) further.
  update(camPos, detailRange, groundRange = detailRange, dt = 0) {
    for (const c of this.chunks) {
      const dx = c.x - camPos.x;
      const dz = c.z - camPos.z;
      const lim = (c.ground ? groundRange : detailRange) + c.r;
      c.group.visible = dx * dx + dz * dz < lim * lim;
    }
    this.cloudSea.update(dt);
    this.waterfalls.update(dt);
  }

  // Height of the far ranges (for checking whether a peak hides the sun).
  rangeHeightAt(x, z) {
    return this.ranges.heightAt(x, z);
  }
}
