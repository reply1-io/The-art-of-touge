// Replays: the last five minutes of your driving, kept as snapshots of the car (where it was, how
// its wheels sat, the revs and pedals) about 30 times a second, and played back three ways:
//
// - VHS: as if people along the road were filming you on camcorders. Each one stands at the
//   roadside, follows you as you come past (a little shaky, zooming in when you are far away),
//   then the tape cuts to the next. Now and then it cuts to a chase car following you instead.
// - The same clips with no on-screen text (main.js hides the overlay).
// - Edit: fly a free camera anywhere, drop cameras of your own, then play and watch from where you
//   are, or cut between your cameras, each following the car.
import * as THREE from 'three';

export const HZ = 30;
const SECONDS = 300;
const N = HZ * SECONDS; // frames kept
// One frame: position (3), rotation (4), speed, rpm, throttle, brake, gear, road sample, tyre slip,
// then compression, steer and spin for each of the four wheels.
const F = 14 + 12;

export class Recorder {
  constructor() {
    this.data = new Float32Array(N * F);
    this.head = 0; // where the next frame goes
    this.count = 0;
    this.acc = 0;
  }

  clear() {
    this.head = 0;
    this.count = 0;
  }

  get seconds() {
    return this.count / HZ;
  }

  // Called every rendered frame while you drive.
  // On a slow frame the same snapshot is stored more than once, so the tape keeps real time.
  record(dt, vehicle, roadIndex) {
    this.acc += dt;
    let n = 0;
    while (this.acc >= 1 / HZ && n < 6) {
      this.acc -= 1 / HZ;
      this.#store(vehicle, roadIndex);
      n++;
    }
    this.acc = Math.min(this.acc, 1 / HZ);
  }

  #store(vehicle, roadIndex) {
    const o = this.head * F;
    const d = this.data;
    const p = vehicle.body.translation();
    const q = vehicle.body.rotation();
    let slip = 0;
    for (const w of vehicle.wheels) {
      if (!w.grounded) continue;
      const lat = Math.max(0, Math.abs(Math.tan(w.slipAngle)) - 0.1);
      const lon = Math.max(0, Math.abs(w.slipRatio) - 0.15);
      slip += Math.min(1, (lat * 2.2 + lon * 1.2) * (w.load / 2800));
    }
    d.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w, vehicle.speed, vehicle.engine.rpm, vehicle.throttlePedal, vehicle.brakePedal, vehicle.trans.gear, roadIndex, slip], o);
    vehicle.wheels.forEach((w, k) => {
      d[o + 14 + k * 3] = w.compression;
      d[o + 15 + k * 3] = w.steer;
      d[o + 16 + k * 3] = w.angle;
    });
    this.head = (this.head + 1) % N;
    this.count = Math.min(N, this.count + 1);
  }

  // Frame k (0 = oldest kept) as an offset into data.
  #at(k) {
    const first = (this.head - this.count + N) % N;
    return ((first + Math.max(0, Math.min(this.count - 1, k))) % N) * F;
  }

  // The car at time t (seconds from the start of the recording), blended between frames. Fills
  // `out` with { pos: Vector3, quat: Quaternion, speed, rpm, throttle, brake, gear, index, slip,
  // wheels: [{ compression, steer, angle }] }. A jump (a reset or teleport) is not blended across.
  sample(t, out) {
    const f = Math.max(0, Math.min(this.count - 1.001, t * HZ));
    const k = Math.floor(f);
    let u = f - k;
    const a = this.#at(k);
    const b = this.#at(k + 1);
    const d = this.data;
    const jump = Math.hypot(d[b] - d[a], d[b + 2] - d[a + 2]) > 6;
    if (jump) u = 0;
    const lerp = (i) => d[a + i] + (d[b + i] - d[a + i]) * u;
    out.pos.set(lerp(0), lerp(1), lerp(2));
    out.quat.set(d[a + 3], d[a + 4], d[a + 5], d[a + 6]);
    if (u > 0) out.quat.slerp(new THREE.Quaternion(d[b + 3], d[b + 4], d[b + 5], d[b + 6]), u);
    out.speed = lerp(7);
    out.rpm = lerp(8);
    out.throttle = lerp(9);
    out.brake = lerp(10);
    out.gear = d[a + 11];
    out.index = d[a + 12];
    out.slip = lerp(13);
    for (let w = 0; w < 4; w++) {
      out.wheels[w].compression = lerp(14 + w * 3);
      out.wheels[w].steer = lerp(15 + w * 3);
      out.wheels[w].angle = lerp(16 + w * 3);
    }
    return out;
  }
}

const mulberry = (seed) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// The people filming: one every 60 m of road, on whichever side has room to stand, at head height.
// Every fourth spot is a chase car instead.
export class Director {
  constructor(road, terrain) {
    this.road = road;
    this.terrain = terrain;
    this.spots = [];
    const rand = mulberry(318);
    for (let i = 20; i < road.count - 10; i += 30) {
      let best = null;
      for (const side of rand() < 0.5 ? [1, -1] : [-1, 1]) {
        const l = road.w.RAIL + 2 + rand() * 4;
        const [x, y, z] = road.pointAt(i, side * l);
        const g = terrain.heightAt(x, z);
        // Not up on a cutting or down a drop where you could not see the road.
        if (Math.abs(g - y) > 3) continue;
        best = { i, x, y: Math.max(g, y) + 1.55 + rand() * 0.3, z, side };
        break;
      }
      this.spots.push(best ? { ...best, chase: this.spots.length % 4 === 3 } : { i, chase: true });
    }
    this.shake = mulberry(7);
    this.look = new THREE.Vector3();
    this.lookVel = new THREE.Vector3();
    this.chasePos = new THREE.Vector3();
    this.current = -1;
  }

  // Which spot films the car when it is at road sample i: the next one it is driving toward,
  // until it is past.
  spotFor(i) {
    const k = Math.max(0, Math.min(this.spots.length - 1, Math.floor((i - 20 + 22) / 30)));
    return k;
  }

  // Aim `camera` for the car at `car` (from Recorder.sample). Returns the spot number (for the CAM
  // label) and whether it just cut.
  frame(dt, camera, car, t) {
    const k = this.spotFor(car.index);
    const cut = k !== this.current;
    this.current = k;
    const s = this.spots[k];
    const target = new THREE.Vector3(car.pos.x, car.pos.y + 0.6, car.pos.z);
    if (s.chase) {
      // A car following yours: behind and a little above, swaying as it keeps up.
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quat);
      fwd.y = 0;
      fwd.normalize();
      const want = target.clone().addScaledVector(fwd, -9.5).add(new THREE.Vector3(0, 1.9, 0));
      if (cut) this.chasePos.copy(want);
      this.chasePos.lerp(want, Math.min(1, dt * 3));
      camera.position.copy(this.chasePos);
      camera.position.x += Math.sin(t * 1.7) * 0.15;
      camera.position.y += Math.sin(t * 2.3) * 0.08;
      if (cut) this.look.copy(target);
      this.look.lerp(target, Math.min(1, dt * 6));
      camera.lookAt(this.look);
      camera.fov = 62;
    } else {
      camera.position.set(s.x, s.y, s.z);
      // Handheld: the aim lags behind the car a touch, with a little wobble.
      if (cut) this.look.copy(target);
      this.look.lerp(target, Math.min(1, dt * 5));
      camera.lookAt(this.look);
      const wob = 0.004 + Math.min(0.01, car.speed / 3000);
      camera.rotation.x += Math.sin(t * 7.1) * wob + (this.shake() - 0.5) * wob;
      camera.rotation.y += Math.sin(t * 5.3) * wob;
      // Zoom in on the car when it is far off, out as it rushes past.
      const dist = camera.position.distanceTo(target);
      camera.fov = THREE.MathUtils.clamp((Math.atan(5.5 / Math.max(dist, 1)) * 2 * 180) / Math.PI, 14, 60);
    }
    camera.updateProjectionMatrix();
    return { k, cut };
  }
}

// Your own camera for edit mode: fly it about, look about, and leave cameras where you want them.
export class FreeCam {
  constructor() {
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = -0.15;
    this.move = { f: 0, s: 0, u: 0 }; // forward, sideways, up: -1..1 from the buttons and keys
    this.shots = []; // [{ pos, yaw, pitch }]
  }

  placeBehind(pos, quat) {
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    this.pos.copy(pos).addScaledVector(back, 10).add(new THREE.Vector3(0, 3.5, 0));
    this.yaw = Math.atan2(pos.x - this.pos.x, pos.z - this.pos.z) + Math.PI;
    this.pitch = -0.2;
  }

  update(dt, camera, lookAt = null) {
    const speed = 14;
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.pos.addScaledVector(f, this.move.f * speed * dt).addScaledVector(r, this.move.s * speed * dt);
    this.pos.y += this.move.u * speed * 0.6 * dt;
    camera.position.copy(this.pos);
    if (lookAt) {
      camera.lookAt(lookAt);
    } else {
      camera.rotation.order = 'YXZ';
      camera.rotation.set(this.pitch, this.yaw, 0);
    }
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }

  addShot() {
    this.shots.push({ pos: this.pos.clone(), yaw: this.yaw, pitch: this.pitch });
  }

  // Of your cameras, the nearest to the car, looking at it.
  frameShots(camera, car) {
    let best = null;
    for (const s of this.shots) if (!best || s.pos.distanceTo(car.pos) < best.pos.distanceTo(car.pos)) best = s;
    if (!best) return -1;
    camera.position.copy(best.pos);
    camera.lookAt(car.pos.x, car.pos.y + 0.6, car.pos.z);
    const dist = best.pos.distanceTo(car.pos);
    camera.fov = THREE.MathUtils.clamp((Math.atan(6 / Math.max(dist, 1)) * 2 * 180) / Math.PI, 18, 60);
    camera.updateProjectionMatrix();
    return this.shots.indexOf(best);
  }
}
