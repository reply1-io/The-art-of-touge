// The wild country around the pass: mountain ranges out to the horizon, a sea of cloud in the
// valleys, and waterfalls tumbling down the hillsides next to the road.
import * as THREE from 'three';
import { noise2, ridged } from './terrain.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Where the sun sits for this road: over its general direction of travel, so you drive toward it.
export function sunAzimuth(road) {
  let dx = 0;
  let dz = 0;
  for (let i = 0; i + 50 < road.count; i += 50) {
    dx += road.x[i + 50] - road.x[i];
    dz += road.z[i + 50] - road.z[i];
  }
  return Math.atan2(dx, dz) + 0.35;
}

// ---------- Mountain ranges ----------
// One big low-poly heightfield around everything. Inside the detailed terrain it hides just below
// the real ground (it becomes the far version of it once the detailed tiles are culled); outside
// it climbs into ridges and peaks, dropping away toward the sun into a valley full of cloud.
export class Ranges {
  constructor(scene, terrain, { height = 900, sunAz = 0, extent = 7000 } = {}) {
    this.terrain = terrain;
    this.road = terrain.road;
    this.height = height;
    this.sunAz = sunAz;
    const t = terrain;
    this.gx0 = t.x0;
    this.gz0 = t.z0;
    this.gx1 = t.x0 + (t.nx - 1) * t.cell;
    this.gz1 = t.z0 + (t.nz - 1) * t.cell;
    this.cx = (this.gx0 + this.gx1) / 2;
    this.cz = (this.gz0 + this.gz1) / 2;
    this.top = this.road.top;
    const half = Math.max(this.gx1 - this.gx0, this.gz1 - this.gz0) / 2 + extent;
    this.half = half;

    // Grid that is denser near the middle and coarser toward the horizon.
    const N = 150;
    const coord = (k) => {
      const u = (k / N) * 2 - 1;
      return Math.sign(u) * Math.abs(u) ** 1.7 * half;
    };
    const pos = new Float32Array((N + 1) * (N + 1) * 3);
    const hs = new Float32Array((N + 1) * (N + 1));
    for (let iz = 0; iz <= N; iz++) {
      for (let ix = 0; ix <= N; ix++) {
        const x = this.cx + coord(ix);
        const z = this.cz + coord(iz);
        const k = iz * (N + 1) + ix;
        // Inside the detailed terrain stay under it everywhere this vertex's triangles reach, so
        // the coarse surface never pokes up through the real ground or the road.
        const spacing = Math.max(Math.abs(coord(Math.min(N, ix + 1)) - coord(ix)), Math.abs(coord(Math.min(N, iz + 1)) - coord(iz)), 8) * 1.05;
        const h = this.#coarseHeight(x, z, spacing);
        hs[k] = h;
        pos.set([x, h, z], k * 3);
      }
    }
    // Flat-shaded triangles with colours from height and steepness: forest, rock, snow on the peaks.
    const outPos = [];
    const outCol = [];
    const c = new THREE.Color();
    const forest = new THREE.Color(0x13241a);
    const forest2 = new THREE.Color(0x1b3120);
    const autumn = new THREE.Color(0x5a3418);
    const rock = new THREE.Color(0x4f4c47);
    const snow = new THREE.Color(0xdfe4ea);
    const colorAt = (x, h, z, slope) => {
      const n = noise2(x / 260, z / 260);
      c.copy(forest).lerp(forest2, n);
      if (noise2(x / 520 + 7, z / 520) > 0.72) c.lerp(autumn, 0.3);
      const alt = h - this.top;
      const rockLine = 520 + noise2(x / 300, z / 300 + 3) * 160;
      if (slope > 0.95 || alt > rockLine) c.copy(rock).multiplyScalar(0.85 + n * 0.3);
      if (alt > rockLine + 180 + noise2(x / 200, z / 200) * 90 && slope < 1.4) c.copy(snow);
      return c;
    };
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const a = iz * (N + 1) + ix;
        const b = a + 1;
        const d = a + N + 1;
        const e = d + 1;
        for (const tri of [[a, d, b], [b, d, e]]) {
          const p = tri.map((k) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]]);
          const mx = (p[0][0] + p[1][0] + p[2][0]) / 3;
          const my = (p[0][1] + p[1][1] + p[2][1]) / 3;
          const mz = (p[0][2] + p[1][2] + p[2][2]) / 3;
          const span = Math.hypot(p[0][0] - p[2][0], p[0][2] - p[2][2]) || 1;
          const slope = (Math.max(p[0][1], p[1][1], p[2][1]) - Math.min(p[0][1], p[1][1], p[2][1])) / span;
          colorAt(mx, my, mz, slope);
          for (const v of p) {
            outPos.push(v[0], v[1], v[2]);
            outCol.push(c.r, c.g, c.b);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(outCol, 3));
    g.computeVertexNormals();
    this.mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  #coarseHeight(x, z, spacing) {
    const inside = x >= this.gx0 - spacing && x <= this.gx1 + spacing && z >= this.gz0 - spacing && z <= this.gz1 + spacing;
    if (!inside) return this.heightAt(x, z);
    let h = Infinity;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) h = Math.min(h, this.heightAt(x + (a * spacing) / 2, z + (b * spacing) / 2));
    return h - 1;
  }

  heightAt(x, z) {
    const t = this.terrain;
    const inside = x >= this.gx0 && x <= this.gx1 && z >= this.gz0 && z <= this.gz1;
    const qx = clamp(x, this.gx0, this.gx1);
    const qz = clamp(z, this.gz0, this.gz1);
    const base = t.heightAt(qx, qz);
    if (inside) return base - 2.5;
    const e = Math.hypot(x - qx, z - qz);
    // Toward the sun the land opens into a wide valley so the sunrise and sunset stay in view.
    let da = Math.atan2(x - this.cx, z - this.cz) - this.sunAz;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const open = 0.18 + 0.82 * smoothstep(0.35, 0.8, Math.abs(da));
    const peaks = (ridged(x, z, [2600, 1250, 560, 240], 1.3) * 1.2 - 0.15) * this.height * open;
    const rise = smoothstep(0, 1500, e);
    const shoulder = (170 * open - 130) * smoothstep(0, 900, e);
    return base - 2.5 + peaks * rise + shoulder;
  }
}

// ---------- Sea of cloud ----------
function cloudSeaTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      // Tileable noise: sample on a torus.
      const a = (x / 256) * Math.PI * 2;
      const b = (y / 256) * Math.PI * 2;
      const u = Math.cos(a) * 4 + 10;
      const v = Math.sin(a) * 4 + 10;
      const w = Math.cos(b) * 4 + 10;
      const q = Math.sin(b) * 4 + 10;
      const n = noise2(u + w, v + q) * 0.55 + noise2((u - q) * 2.1, (v + w) * 2.1) * 0.3 + noise2(u * 4.3 + w, q * 4.3) * 0.15;
      const alpha = clamp((n - 0.36) * 2.4, 0, 1);
      const k = (y * 256 + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = alpha * 235;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CloudSea {
  constructor(scene, centre, size, level) {
    const tex = cloudSeaTexture();
    tex.repeat.set(size / 900, size / 900);
    this.mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(centre[0], level, centre[1]);
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.tex = tex;
  }

  setTime(preset) {
    this.mat.color.setHex(preset.cloudSea ?? 0xffffff);
    this.mat.emissive.setHex(preset.cloudSeaGlow ?? 0x000000);
    this.mat.opacity = preset.cloudSeaOpacity ?? 0.9;
  }

  update(dt) {
    this.tex.offset.x += dt * 0.0016;
    this.tex.offset.y += dt * 0.0007;
  }
}

// ---------- Waterfalls ----------
function waterTexture() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#9fc3d6';
  g.fillRect(0, 0, 32, 128);
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 32;
    const y = Math.random() * 128;
    const l = 10 + Math.random() * 30;
    g.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.5})`;
    g.fillRect(x, y, 1 + Math.random() * 2, l);
    g.fillRect(x, y - 128, 1 + Math.random() * 2, l);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mistTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A cascade running down the hillside to a culvert under the road. `spots` are [sample, side].
export function buildWaterfalls(road, terrain, spots, addChunk) {
  const tex = waterTexture();
  const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0x16303c, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false });
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x3c3d3b, flatShading: true });
  const pipeMat = new THREE.MeshLambertMaterial({ color: 0x6e6c66 });
  const mist = new THREE.SpriteMaterial({ map: mistTexture(), depthWrite: false, transparent: true });
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  for (const [i, side] of spots) {
    const h = road.heading[i];
    const nx = Math.cos(h) * side; // across the road, toward this side (+x left)
    const nz = -Math.sin(h) * side;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const pos = [];
    const uv = [];
    const steps = 22;
    let v = 0;
    let prev = null;
    const width = (d) => 1.2 + d * 0.035;
    for (let k = 0; k <= steps; k++) {
      const d = 8.8 + k * 2; // metres from the centreline
      const wob = Math.sin(k * 0.9 + i) * 0.8;
      const cx = road.x[i] + nx * d + fx * wob;
      const cz = road.z[i] + nz * d + fz * wob;
      const y = terrain.heightAt(cx, cz) + 0.25;
      const w = width(d);
      const L = [cx - fx * w, y, cz - fz * w];
      const R = [cx + fx * w, y, cz + fz * w];
      if (prev) {
        v += Math.hypot(cx - prev.cx, y - prev.y, cz - prev.cz) / 6;
        for (const [p, t] of [[prev.L, [0, prev.v]], [prev.R, [1, prev.v]], [R, [1, v]], [prev.L, [0, prev.v]], [R, [1, v]], [L, [0, v]]]) {
          pos.push(...p);
          uv.push(...t);
        }
      }
      prev = { L, R, cx, cz, y, v };
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geo, mat));
    // Mossy boulders along the banks, a concrete culvert mouth, and spray at the bottom.
    for (let k = 0; k < 14; k++) {
      const d = 9.5 + k * 3;
      const s = k % 2 ? 1 : -1;
      const w = width(d) + 0.9;
      const x = road.x[i] + nx * d + fx * s * w;
      const z = road.z[i] + nz * d + fz * s * w;
      const r = 0.6 + noise2(k, i) * 1.1;
      const m = new THREE.Mesh(rockGeo, rockMat);
      m.position.set(x, terrain.heightAt(x, z) + r * 0.2, z);
      m.scale.set(r * 1.2, r * 0.8, r);
      m.rotation.y = k * 1.3;
      group.add(m);
    }
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.9, 10, 1, true), pipeMat);
    const pp = road.pointAt(i, side * 8.6);
    pipe.position.set(pp[0], pp[1] - 0.2, pp[2]);
    pipe.rotation.set(Math.PI / 2, h + Math.PI / 2, 0, 'YXZ');
    group.add(pipe);
    const top = [road.x[i] + nx * 30, 0, road.z[i] + nz * 30];
    top[1] = terrain.heightAt(top[0], top[2]);
    for (const [d, s] of [[10, 6], [30, 9]]) {
      const sp = new THREE.Sprite(mist);
      const x = road.x[i] + nx * d;
      const z = road.z[i] + nz * d;
      sp.position.set(x, terrain.heightAt(x, z) + s * 0.25, z);
      sp.scale.set(s, s * 0.6, 1);
      group.add(sp);
    }
    addChunk(group, road.x[i] + nx * 25, road.z[i] + nz * 25, 60);
  }
  return {
    update(dt) {
      tex.offset.y += dt * 1.3;
    },
  };
}
