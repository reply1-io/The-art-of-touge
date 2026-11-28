// Rain: streaks falling in a box that follows the camera, slanted by the wind and by how fast you
// are driving through them.
import * as THREE from 'three';

const N = 1600;
const BOX = 44; // metres across
const HIGH = 24;

export class Rain {
  constructor(scene) {
    this.pos = new Float32Array(N * 6);
    this.drops = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * BOX;
      this.drops[i * 3 + 1] = Math.random() * HIGH - 6;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * BOX;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xb8c4d2, transparent: true, opacity: 0.42, depthWrite: false, fog: true });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.amount = 0;
    scene.add(this.lines);
  }

  // on: raining or not. camera: where to rain. vel: the car's velocity {x, y, z}.
  update(dt, on, camera, vel) {
    this.amount += ((on ? 1 : 0) - this.amount) * Math.min(1, dt * 0.8);
    this.lines.visible = this.amount > 0.02;
    if (!this.lines.visible) return;
    this.mat.opacity = 0.42 * this.amount;
    const c = camera.position;
    const fall = 17;
    // Streak direction: straight down, pushed back by your own speed and a little by the wind.
    const sx = -vel.x * 0.035 + 0.6;
    const sz = -vel.z * 0.035 + 0.25;
    const len = 0.9;
    const d = this.drops;
    const p = this.pos;
    const half = BOX / 2;
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      d[k + 1] -= fall * dt;
      d[k] += 0.6 * dt * 2;
      if (d[k + 1] < -6) {
        d[k + 1] += HIGH;
        d[k] = (Math.random() - 0.5) * BOX;
        d[k + 2] = (Math.random() - 0.5) * BOX;
      }
      // Keep the drops in the box around the camera as it moves.
      let x = d[k] - ((c.x % BOX) + BOX) % BOX;
      let z = d[k + 2] - ((c.z % BOX) + BOX) % BOX;
      x = ((((x + half) % BOX) + BOX) % BOX) - half;
      z = ((((z + half) % BOX) + BOX) % BOX) - half;
      const wx = c.x + x;
      const wy = c.y + d[k + 1];
      const wz = c.z + z;
      const o = i * 6;
      p[o] = wx;
      p[o + 1] = wy;
      p[o + 2] = wz;
      p[o + 3] = wx + sx * len;
      p[o + 4] = wy + len * 1.6;
      p[o + 5] = wz + sz * len;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
