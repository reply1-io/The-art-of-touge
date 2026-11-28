// Wildlife around the road: deer grazing in the clearings, rabbits hopping about, a fox trotting
// along the tree line, herons standing at the edge of the ponds and ducks on the water, flocks of
// birds wheeling overhead by day, and bats and fireflies after dark. Animals are placed a little way
// ahead of the car and move on when it has passed, so there is always something to see. None of
// them can be hit: they stay off the road.
import * as THREE from 'three';
import { deerModel } from './deer.js';
import { noise2 } from './terrain.js';

const lambert = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

function boxes(parts) {
  const g = new THREE.Group();
  for (const [w, h, d, mat, x, y, z, rx = 0] of parts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    g.add(m);
  }
  return g;
}

function rabbit() {
  const fur = lambert(0x8a7a66);
  const pale = lambert(0xd8cfc0);
  return boxes([
    [0.18, 0.18, 0.3, fur, 0, 0.13, 0],
    [0.13, 0.13, 0.13, fur, 0, 0.25, 0.15],
    [0.03, 0.14, 0.04, fur, -0.035, 0.37, 0.13],
    [0.03, 0.14, 0.04, fur, 0.035, 0.37, 0.13],
    [0.07, 0.07, 0.05, pale, 0, 0.16, -0.17],
  ]);
}

function fox() {
  const fur = lambert(0xc0561c);
  const white = lambert(0xece4d8);
  const black = lambert(0x1a1410);
  const g = boxes([
    [0.22, 0.24, 0.62, fur, 0, 0.42, 0],
    [0.18, 0.18, 0.24, fur, 0, 0.55, 0.38],
    [0.08, 0.08, 0.14, white, 0, 0.5, 0.54],
    [0.05, 0.1, 0.04, black, -0.06, 0.68, 0.36],
    [0.05, 0.1, 0.04, black, 0.06, 0.68, 0.36],
    [0.1, 0.1, 0.4, fur, 0, 0.42, -0.48, -0.5],
    [0.08, 0.08, 0.1, white, 0, 0.34, -0.66, -0.5],
  ]);
  for (const [x, z] of [[-0.08, 0.22], [0.08, 0.22], [-0.08, -0.22], [0.08, -0.22]]) g.add(boxes([[0.05, 0.32, 0.05, black, x, 0.16, z]]));
  return g;
}

function heron() {
  const grey = lambert(0x9aa2aa);
  const pale = lambert(0xe2e4e6);
  const beak = lambert(0xd0a23a);
  return boxes([
    [0.22, 0.3, 0.5, grey, 0, 0.85, 0],
    [0.06, 0.45, 0.06, pale, 0, 1.15, 0.22, 0.25],
    [0.1, 0.1, 0.14, pale, 0, 1.38, 0.3],
    [0.03, 0.03, 0.18, beak, 0, 1.37, 0.44],
    [0.03, 0.7, 0.03, beak, -0.05, 0.35, 0],
    [0.03, 0.7, 0.03, beak, 0.05, 0.35, 0],
  ]);
}

function duck() {
  const body = lambert(0x6e5a44);
  const head = lambert(0x2a5a3a);
  return boxes([
    [0.22, 0.14, 0.36, body, 0, 0.07, 0],
    [0.1, 0.12, 0.1, head, 0, 0.2, 0.16],
    [0.06, 0.03, 0.08, lambert(0xd8a030), 0, 0.19, 0.24],
  ]);
}

// A bird: a little body and two wings that flap.
function bird(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: true });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.35), mat);
  g.add(body);
  g.userData.wings = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.18).translate(s * 0.25, 0, 0).rotateX(-Math.PI / 2), mat);
    pivot.add(w);
    g.add(pivot);
    return pivot;
  });
  return g;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,200,1)');
  grad.addColorStop(0.4, 'rgba(210,255,120,0.5)');
  grad.addColorStop(1, 'rgba(160,255,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Wildlife {
  constructor(scene, road, terrain) {
    this.scene = scene;
    this.road = road;
    this.terrain = terrain;
    this.t = 0;
    this.night = false;
    // Ground animals: placed beside the road ahead, moved on when left behind.
    const kinds = [
      ...Array.from({ length: 5 }, () => ['deer', deerModel()]),
      ...Array.from({ length: 6 }, () => ['rabbit', rabbit()]),
      ...Array.from({ length: 2 }, () => ['fox', fox()]),
    ];
    this.ground = kinds.map(([kind, m]) => {
      m.visible = false;
      scene.add(m);
      return { kind, m, i: -1, side: 1, off: 0, phase: Math.random() * 10, home: new THREE.Vector3(), dir: 0 };
    });
    // Water birds live at the ponds and lakes.
    this.water = [];
    for (const lk of terrain.lakes) {
      const n = lk.r > 60 ? 6 : 3;
      for (let k = 0; k < n; k++) {
        const isHeron = k % 3 === 0;
        const m = isHeron ? heron() : duck();
        const a = Math.random() * Math.PI * 2;
        const rr = isHeron ? lk.r * 0.95 : lk.r * (0.3 + Math.random() * 0.5);
        m.position.set(lk.x + Math.sin(a) * rr, lk.level + (isHeron ? -0.3 : 0.02), lk.z + Math.cos(a) * rr);
        m.rotation.y = Math.random() * Math.PI * 2;
        scene.add(m);
        this.water.push({ m, lk, a, rr, heron: isHeron, speed: 0.04 + Math.random() * 0.05 });
      }
    }
    // Flocks in the sky: by day, birds; by night, bats.
    this.flocks = [0, 1, 2].map((k) => {
      const g = new THREE.Group();
      const birds = Array.from({ length: 7 + k * 2 }, (_, j) => {
        const b = bird(0x222428);
        b.userData.off = new THREE.Vector3((j % 3) - 1, Math.random() * 0.8, -Math.floor(j / 2)).multiplyScalar(2.2);
        b.userData.phase = Math.random() * 6;
        g.add(b);
        return b;
      });
      scene.add(g);
      return { g, birds, r: 60 + k * 35, h: 35 + k * 18, w: (0.08 + k * 0.03) * (k % 2 ? -1 : 1), a: k * 2 };
    });
    // Fireflies over the ponds and along the verges after dark.
    const N = 160;
    this.flyPos = new Float32Array(N * 3);
    this.flyBase = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.flyPos, 3));
    this.flies = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture(), size: 0.45, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xd8ff8a }));
    this.flies.frustumCulled = false;
    this.flies.visible = false;
    scene.add(this.flies);
    this.flyCentre = new THREE.Vector3(1e9, 0, 0);
  }

  setTime(preset) {
    this.night = !!preset.night;
    this.flies.visible = false; // no fireflies: their green glow in the forest was too much
    for (const f of this.flocks) for (const b of f.birds) b.children[0].material.color.setHex(this.night ? 0x111216 : 0x26282c);
  }

  // A spot beside the road at sample i, `off` metres out, on gentle ground away from water.
  #spot(i, side, off, out) {
    const road = this.road;
    if (i < 2 || i >= road.count - 2) return false;
    if (road.clearance(i, side, off + 6) < off + 6) return false;
    const [x, , z] = road.pointAt(i, side * off);
    if (this.terrain.inLake(x, z, 4)) return false;
    const y = this.terrain.heightAt(x, z);
    const slope = Math.abs(this.terrain.heightAt(x + 2, z) - y) + Math.abs(this.terrain.heightAt(x, z + 2) - y);
    if (slope > 1.4) return false;
    out.set(x, y, z);
    return true;
  }

  update(dt, camera, carIndex) {
    this.t += dt;
    const t = this.t;
    const road = this.road;
    // Ground animals.
    for (const a of this.ground) {
      const behind = a.i < 0 || a.i < carIndex - 40 || a.i > carIndex + 400;
      if (behind) {
        // A new spot 60-500 m ahead, in a clearing beside the road.
        a.m.visible = false;
        const i = carIndex + 30 + Math.floor(Math.random() * 220);
        const side = Math.random() < 0.5 ? 1 : -1;
        const off = a.kind === 'rabbit' ? 10 + Math.random() * 8 : 14 + Math.random() * 22;
        if (this.#spot(i, side, off, a.home)) {
          a.i = i;
          a.side = side;
          a.dir = road.heading[i] + (Math.random() - 0.5) * 2;
          a.m.position.copy(a.home);
          a.m.rotation.y = a.dir;
          a.m.visible = true;
        } else a.i = -1;
        continue;
      }
      a.phase += dt;
      if (a.kind === 'deer') {
        // Grazing: the head (and the whole body a little) dips down and comes up to look round.
        const graze = Math.sin(a.phase * 0.7) > 0.2 ? 1 : 0;
        a.m.rotation.x = graze * 0.18;
        a.m.rotation.y = a.dir + Math.sin(a.phase * 0.3) * 0.3;
      } else if (a.kind === 'rabbit') {
        // Short hops about its spot.
        const hop = (a.phase % 2.2) / 2.2;
        const moving = hop < 0.35;
        if (moving) {
          a.m.position.x += Math.sin(a.dir) * dt * 1.6;
          a.m.position.z += Math.cos(a.dir) * dt * 1.6;
        } else if (hop > 0.95) a.dir += (Math.random() - 0.5) * 2.5;
        if (a.m.position.distanceTo(a.home) > 5) a.dir = Math.atan2(a.home.x - a.m.position.x, a.home.z - a.m.position.z);
        a.m.rotation.y = a.dir;
        a.m.position.y = this.terrain.heightAt(a.m.position.x, a.m.position.z) + (moving ? Math.sin((hop / 0.35) * Math.PI) * 0.25 : 0);
      } else {
        // The fox trots back and forth along the tree line.
        const s = Math.sin(a.phase * 0.25) * 12;
        const h = road.heading[a.i];
        const x = a.home.x + Math.sin(h) * s;
        const z = a.home.z + Math.cos(h) * s;
        a.m.rotation.y = h + (Math.cos(a.phase * 0.25) > 0 ? 0 : Math.PI);
        a.m.position.set(x, this.terrain.heightAt(x, z), z);
      }
    }
    // Ducks paddle in slow circles; herons stand and now and then shift.
    for (const w of this.water) {
      if (w.heron) {
        w.m.rotation.y += Math.sin(t * 0.2 + w.a) * dt * 0.1;
        continue;
      }
      w.a += w.speed * dt;
      w.m.position.set(w.lk.x + Math.sin(w.a) * w.rr, w.lk.level + 0.02 + Math.sin(t * 2 + w.a) * 0.01, w.lk.z + Math.cos(w.a) * w.rr);
      w.m.rotation.y = w.a + Math.PI / 2;
    }
    // Flocks wheel above the car.
    const c = camera.position;
    for (const f of this.flocks) {
      f.a += f.w * dt;
      f.g.position.set(c.x + Math.sin(f.a) * f.r, c.y + f.h + Math.sin(t * 0.3 + f.r) * 4, c.z + Math.cos(f.a) * f.r);
      f.g.rotation.y = f.a + (f.w > 0 ? Math.PI / 2 : -Math.PI / 2);
      for (const b of f.birds) {
        b.position.copy(b.userData.off);
        const flap = Math.sin(t * (this.night ? 18 : 9) + b.userData.phase) * 0.7;
        b.userData.wings[0].rotation.z = flap;
        b.userData.wings[1].rotation.z = -flap;
      }
    }
    // Fireflies drift around a patch near the car.
    if (this.night) {
      if (this.flyCentre.distanceToSquared(c) > 3600) {
        this.flyCentre.copy(c);
        for (let k = 0; k < this.flyBase.length; k += 3) {
          const i = Math.max(2, Math.min(road.count - 3, carIndex + Math.floor(Math.random() * 60) - 10));
          const side = Math.random() < 0.5 ? 1 : -1;
          const [x, , z] = road.pointAt(i, side * (9 + Math.random() * 25));
          this.flyBase[k] = x;
          this.flyBase[k + 1] = this.terrain.heightAt(x, z) + 0.6 + Math.random() * 2.2;
          this.flyBase[k + 2] = z;
        }
      }
      for (let k = 0; k < this.flyPos.length; k += 3) {
        const p = k * 0.37;
        this.flyPos[k] = this.flyBase[k] + Math.sin(t * 0.6 + p) * 1.2;
        this.flyPos[k + 1] = this.flyBase[k + 1] + Math.sin(t * 0.9 + p * 2) * 0.4;
        this.flyPos[k + 2] = this.flyBase[k + 2] + Math.cos(t * 0.5 + p) * 1.2;
      }
      this.flies.geometry.attributes.position.needsUpdate = true;
      // Blink.
      this.flies.material.opacity = 0.65 + 0.35 * Math.sin(t * 3.1);
    }
    void noise2;
  }
}
