// The mountain's visuals: road (chunked for culling), terrain tiles, guardrails, streetlights at the
// hairpins, cedar forest, the summit lake, the town at the bottom, and start / finish lines.
import * as THREE from 'three';
import { Road, crossSection, HALF, RAIL, STEP } from './road.js';
import { Terrain, noise2 } from './terrain.js';
import { buildMountainPhysics } from './mountainPhysics.js';

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
  // Tyre-polished lines in each lane.
  g.fillStyle = 'rgba(20,20,22,0.25)';
  for (const x of [10, 22, 40, 52]) g.fillRect(x - 2, 0, 4, 256);
  // White edge lines and the yellow no-overtaking centre line.
  g.fillStyle = '#d9d9d2';
  g.fillRect(1, 0, 2, 256);
  g.fillRect(61, 0, 2, 256);
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
  constructor(world, scene) {
    this.scene = scene;
    this.road = new Road();
    this.terrain = new Terrain(this.road);
    this.layout = buildMountainPhysics(world, this.road, this.terrain);
    this.chunks = []; // { group, x, z, r }
    this.#buildRoad();
    this.#buildTerrain();
    this.#buildRails();
    this.#buildStreetlights();
    this.#buildTrees();
    this.#buildLake();
    this.#buildTown();
    this.#buildLines();
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

  #addChunk(group, x, z, r) {
    this.scene.add(group);
    this.chunks.push({ group, x, z, r });
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
          aUv.push((HALF - l) / (2 * HALF), (i * STEP) / 10);
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
      this.#addChunk(group, road.x[mid], road.z[mid], ROAD_CHUNK * STEP * 0.6);
    }
  }

  #buildTerrain() {
    const t = this.terrain;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (let tz = 0; tz < t.nz - 1; tz += TILE) {
      for (let tx = 0; tx < t.nx - 1; tx += TILE) {
        const ex = Math.min(t.nx - 1, tx + TILE);
        const ez = Math.min(t.nz - 1, tz + TILE);
        // Skip tiles far from the road (hidden in fog and darkness anyway).
        let near = Infinity;
        for (let iz = tz; iz <= ez; iz += 4) for (let ix = tx; ix <= ex; ix += 4) near = Math.min(near, t.roadDist[iz * t.nx + ix]);
        if (near > 59) {
          const cx = t.x0 + ((tx + ex) / 2) * t.cell;
          const cz = t.z0 + ((tz + ez) / 2) * t.cell;
          const dl = Math.hypot(cx - t.lake.x, cz - t.lake.z);
          const dt = Math.hypot(cx - t.town.x, cz - t.town.z);
          if (dl > t.lake.r + 120 && dt > t.town.r + 120) continue;
        }
        const w = ex - tx + 1;
        const pos = [];
        const col = [];
        const idx = [];
        for (let iz = tz; iz <= ez; iz++) {
          for (let ix = tx; ix <= ex; ix++) {
            const k = iz * t.nx + ix;
            const x = t.x0 + ix * t.cell;
            const z = t.z0 + iz * t.cell;
            const h = t.heights[k];
            pos.push(x, h, z);
            // Colour by steepness: dark forest floor, grass, and rock on the road cuts.
            const hx = t.heights[iz * t.nx + Math.min(t.nx - 1, ix + 1)] - h;
            const hz = t.heights[Math.min(t.nz - 1, iz + 1) * t.nx + ix] - h;
            const slope = Math.hypot(hx, hz) / t.cell;
            const n = noise2(x / 9, z / 9);
            let c = [0.13 + n * 0.05, 0.19 + n * 0.06, 0.1];
            if (slope > 0.75) c = [0.33 + n * 0.06, 0.32 + n * 0.06, 0.3 + n * 0.05];
            else if (slope > 0.45) c = [0.24, 0.23, 0.17];
            col.push(...c);
          }
        }
        for (let r = 0; r < ez - tz; r++) {
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
        this.#addChunk(mesh, cx, cz, TILE * t.cell * 0.75);
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
    const road = this.road;
    const spots = [];
    let last = -100;
    for (let i = 10; i < road.count - 10; i++) {
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
      this.#addChunk(g, base[0], base[2], 20);
    }
  }

  // Cedar forest: instanced trunks and three-tier canopies on the slopes, kept off the road.
  #buildTrees() {
    const t = this.terrain;
    const spots = [];
    for (let z = t.z0 + 10; z < t.z0 + (t.nz - 1) * t.cell - 10; z += 7) {
      for (let x = t.x0 + 10; x < t.x0 + (t.nx - 1) * t.cell - 10; x += 7) {
        const jx = x + (noise2(x * 0.7, z * 0.3) - 0.5) * 8;
        const jz = z + (noise2(x * 0.3, z * 0.7) - 0.5) * 8;
        const near = t.nearestRoad(jx, jz, 60);
        if (near.d < 12 || near.d > 58) continue;
        if (noise2(jx / 25, jz / 25) < 0.32) continue;
        if (Math.hypot(jx - t.lake.x, jz - t.lake.z) < t.lake.r + 10) continue;
        if (Math.hypot(jx - t.town.x, jz - t.town.z) < t.town.r) continue;
        spots.push([jx, t.heightAt(jx, jz) - 0.3, jz, 9 + noise2(jx, jz) * 9]);
      }
    }
    const trunk = new THREE.CylinderGeometry(0.18, 0.28, 1, 5);
    trunk.translate(0, 0.5, 0);
    const crown = new THREE.ConeGeometry(1, 1, 7);
    crown.translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: 0x3b2a1e }), spots.length);
    const crowns = new THREE.InstancedMesh(crown, new THREE.MeshLambertMaterial({ color: 0x1d3a24, flatShading: true }), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    spots.forEach(([x, y, z, h], k) => {
      trunks.setMatrixAt(k, m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, h * 0.35, 1)));
      crowns.setMatrixAt(k, m.compose(new THREE.Vector3(x, y + h * 0.25, z), q, new THREE.Vector3(h * 0.2, h * 0.8, h * 0.2)));
      const v = 0.8 + noise2(x * 3, z * 3) * 0.4;
      crowns.setColorAt(k, col.setRGB(0.11 * v, 0.23 * v, 0.14 * v));
    });
    this.scene.add(trunks, crowns);
    this.treeCount = spots.length;
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
      const a = road.pointAt(i, HALF, 0.02);
      const b = road.pointAt(i, -HALF, 0.02);
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

  // Show only what is within reach of the fog.
  update(camPos, range) {
    for (const c of this.chunks) {
      const dx = c.x - camPos.x;
      const dz = c.z - camPos.z;
      const lim = range + c.r;
      c.group.visible = dx * dx + dz * dz < lim * lim;
    }
  }
}
