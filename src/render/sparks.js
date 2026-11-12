// Scrape sparks: short-lived glowing streaks thrown off where metal meets a rail or the road.
import * as THREE from 'three';

const MAX = 260;

export class Sparks {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 6); // each spark is a short line: head and tail
    this.col = new Float32Array(MAX * 6);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = g;
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }

  // Throw `count` sparks from point p (THREE.Vector3), travelling with velocity v (world, m/s),
  // spraying away along `push` (unit vector, may be zero) and back from the car.
  emit(p, v, push, count) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const jitter = () => (Math.random() - 0.5) * 3;
      // Sparks keep some of the car's speed but drag against the surface, so they fly backward
      // relative to the car.
      this.vel[i * 3] = v.x * 0.55 + push.x * (2 + Math.random() * 3) + jitter();
      this.vel[i * 3 + 1] = 1 + Math.random() * 3;
      this.vel[i * 3 + 2] = v.z * 0.55 + push.z * (2 + Math.random() * 3) + jitter();
      this.life[i] = 0.25 + Math.random() * 0.35;
      for (let e = 0; e < 2; e++) this.pos.set([p.x, p.y, p.z], i * 6 + e * 3);
    }
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        this.col.fill(0, i * 6, i * 6 + 6);
        continue;
      }
      this.life[i] -= dt;
      const vx = this.vel[i * 3];
      const vy = (this.vel[i * 3 + 1] -= 9.8 * dt);
      const vz = this.vel[i * 3 + 2];
      const h = i * 6;
      // Tail = where the head was; head moves on. Streak length comes from the speed.
      this.pos[h + 3] = this.pos[h] - vx * 0.02;
      this.pos[h + 4] = this.pos[h + 1] - vy * 0.02;
      this.pos[h + 5] = this.pos[h + 2] - vz * 0.02;
      this.pos[h] += vx * dt;
      this.pos[h + 1] += vy * dt;
      this.pos[h + 2] += vz * dt;
      const k = Math.min(1, this.life[i] / 0.3);
      this.col.set([1 * k, 0.75 * k, 0.3 * k, 0.9 * k, 0.3 * k, 0.05 * k], h);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
