// Deer. Now and then up to three deer bound across the road well ahead of you: close enough to
// see clearly, but timed and placed so you can never reach them. They are only scenery (no
// collision), and they vanish into the trees on the far side.
import * as THREE from 'three';

const RUN_SPEED = 9; // m/s across the road
const CROSS = 26; // metres from one side to the other

function deerModel() {
  const g = new THREE.Group();
  const coat = new THREE.MeshLambertMaterial({ color: 0x8a5a32, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a2618, flatShading: true });
  const pale = new THREE.MeshLambertMaterial({ color: 0xe8dcc8, flatShading: true });
  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  box(0.36, 0.42, 1.1, coat, 0, 1.0, 0); // body
  const neck = box(0.18, 0.5, 0.2, coat, 0, 1.35, 0.5);
  neck.rotation.x = 0.5;
  box(0.2, 0.22, 0.38, coat, 0, 1.6, 0.72); // head
  box(0.08, 0.08, 0.08, dark, 0, 1.58, 0.92); // nose
  for (const x of [-0.08, 0.08]) box(0.05, 0.16, 0.04, coat, x, 1.76, 0.62); // ears
  box(0.16, 0.18, 0.06, pale, 0, 1.1, -0.57); // white tail
  // Legs pivot at the hips and shoulders so they can swing as it bounds.
  const legs = [];
  for (const [x, z] of [[-0.12, 0.42], [0.12, 0.42], [-0.12, -0.42], [0.12, -0.42]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.85, z);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 0.08), coat);
    leg.position.y = -0.42;
    const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.1), dark);
    hoof.position.y = -0.84;
    pivot.add(leg, hoof);
    g.add(pivot);
    legs.push(pivot);
  }
  g.userData.legs = legs;
  return g;
}

export class Deer {
  constructor(scene, road, terrain) {
    this.road = road;
    this.terrain = terrain;
    this.herd = [0, 1, 2].map(() => {
      const m = deerModel();
      m.visible = false;
      scene.add(m);
      return { m, t: 0, active: false };
    });
    this.timer = 25 + Math.random() * 30; // first sighting
  }

  // Ground height at a lateral offset from sample i.
  #groundAt(i, l) {
    const p = this.road.pointAt(i, l);
    return Math.abs(l) < 8.4 ? p[1] : this.terrain.heightAt(p[0], p[2]);
  }

  // carIndex: the road sample the car is at; speed: m/s along the road.
  update(dt, carIndex, speed) {
    const busy = this.herd.some((d) => d.active);
    if (!busy) {
      this.timer -= dt;
      if (this.timer <= 0 && speed > 6) this.#start(carIndex, speed);
    }
    for (const d of this.herd) {
      if (!d.active) continue;
      d.t += dt;
      const run = Math.max(0, d.t - d.delay);
      if (run <= 0) continue;
      const l = d.from + d.dir * Math.min(CROSS + 6, run * RUN_SPEED);
      const i = d.i;
      const p = this.road.pointAt(i, l);
      const hop = Math.abs(Math.sin(run * 7.5)) * 0.35;
      d.m.position.set(p[0], this.#groundAt(i, l) + hop, p[2]);
      // Face across the road in the direction of travel.
      d.m.rotation.y = this.road.heading[i] + (d.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      const swing = Math.sin(run * 15) * 0.7;
      d.m.userData.legs.forEach((leg, k) => (leg.rotation.x = k < 2 ? swing : -swing));
      d.m.visible = true;
      if (run * RUN_SPEED > CROSS + 6) {
        d.active = false;
        d.m.visible = false;
      }
    }
  }

  #start(carIndex, speed) {
    const road = this.road;
    const n = 1 + Math.floor(Math.random() * 3);
    const stagger = 0.55;
    // Everyone is across before the car could get there, with time to spare.
    const crossTime = CROSS / RUN_SPEED + stagger * (n - 1) + 1.2;
    const dist = Math.max(70, speed * crossTime * 1.35 + 25);
    const i = Math.min(road.count - 20, carIndex + Math.round(dist / 2));
    if (i <= carIndex + 20) return;
    this.timer = 45 + Math.random() * 60;
    const dir = Math.random() < 0.5 ? 1 : -1;
    this.herd.forEach((d, k) => {
      d.active = k < n;
      d.m.visible = false;
      d.t = 0;
      d.delay = k * stagger;
      d.i = Math.min(road.count - 2, i + k * 2);
      d.dir = dir;
      d.from = -dir * (CROSS / 2);
    });
  }

  // Keep away if the car has somehow caught up (e.g. it was reset onto the road ahead).
  clear() {
    for (const d of this.herd) {
      d.active = false;
      d.m.visible = false;
    }
  }
}
