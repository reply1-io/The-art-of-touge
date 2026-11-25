// Replays: the last five minutes of your driving, kept as snapshots of the car (where it was, how
// its wheels sat, the revs and pedals) about 30 times a second, and played back three ways:
//
// - VHS: as if the crowd along the road were filming you on camcorders. Most stand right at the
//   edge with a 10 mm wide-angle lens, so the car fills the picture as it rushes past; a few stand
//   further back and zoom in. Each follows you, a little shaky, then the tape cuts to the next.
// - The same clips with no on-screen text (main.js hides the overlay).
// - Edit: fly a free camera anywhere (it goes where it is pointed), drop cameras of your own, then
//   play and watch from where you are, or cut between your cameras, each following the car.
import * as THREE from 'three';
import { TyreSmoke } from '../render/smoke.js';

export const HZ = 30;
const SECONDS = 300;
const N = HZ * SECONDS; // frames kept
// One frame: position (3), rotation (4), speed, rpm, throttle, brake, gear, road sample, tyre slip,
// then compression, steer and spin for each of the four wheels, then how much smoke each makes.
const F = 14 + 12 + 4;

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
      d[o + 26 + k] = TyreSmoke.amountFor(w);
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
      out.wheels[w].smoke = lerp(26 + w);
    }
    return out;
  }
}

// The edit-mode lens dial (10..150). From about 20 degrees up the lens bends, more and more the
// higher it goes, while the view itself only widens to 120 degrees; past 120 a lens hood creeps
// into the corners, and at 150 it is a full circular fisheye.
export function lensFor(v) {
  const k = Math.max(0, (v - 20) / 130);
  return {
    fov: v <= 40 ? v : 40 + (v - 40) * (80 / 110),
    fish: Math.pow(k, 0.8),
    hood: Math.min(1, Math.max(0, (v - 120) / 30)),
    circle: Math.min(1, Math.max(0, (v - 142) / 8)),
  };
}

const mulberry = (seed) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// The crowd filming: someone every 40 m of road, on whichever side has room to stand. Most are
// right at the edge (just behind the rail) with a 10 mm wide-angle lens held low; about one in
// four stands further back on the bank and zooms in.
export class Director {
  constructor(road, terrain) {
    this.road = road;
    this.terrain = terrain;
    this.spots = [];
    const rand = mulberry(318);
    for (let i = 16; i < road.count - 10; i += 20) {
      const wide = rand() > 0.25;
      let best = null;
      for (const side of rand() < 0.5 ? [1, -1] : [-1, 1]) {
        const l = wide ? road.w.RAIL + 0.5 + rand() * 1.2 : road.w.RAIL + 3 + rand() * 4;
        const [x, y, z] = road.pointAt(i, side * l);
        const g = terrain.heightAt(x, z);
        // Not up on a cutting or down a drop where you could not see the road.
        if (Math.abs(g - y) > (wide ? 1.5 : 3)) continue;
        best = { i, x, y: Math.max(g, y) + (wide ? 0.9 + rand() * 0.6 : 1.55 + rand() * 0.3), z, side, wide };
        break;
      }
      // Nowhere to stand: the spot before films for longer.
      this.spots.push(best || { ...(this.spots[this.spots.length - 1] || { i, x: road.x[i], y: road.y[i] + 6, z: road.z[i], wide: false }), i });
    }
    this.shake = mulberry(7);
    this.look = new THREE.Vector3();
    this.current = -1;
  }

  // Which spot films the car when it is at road sample i: the next one it is driving toward,
  // until it is just past.
  spotFor(i) {
    return Math.max(0, Math.min(this.spots.length - 1, Math.floor((i - 16 + 6) / 20)));
  }

  // Aim `camera` for the car at `car` (from Recorder.sample). Returns the spot number, whether it
  // just cut, and whether it is a wide-angle shot (for the lens bend).
  frame(dt, camera, car, t) {
    const k = this.spotFor(car.index);
    const cut = k !== this.current;
    this.current = k;
    const s = this.spots[k];
    const target = new THREE.Vector3(car.pos.x, car.pos.y + 0.5, car.pos.z);
    camera.position.set(s.x, s.y, s.z);
    // Handheld: the aim lags behind the car a touch and wobbles, more for the close ones.
    if (cut) this.look.copy(target);
    this.look.lerp(target, Math.min(1, dt * (s.wide ? 7 : 5)));
    camera.lookAt(this.look);
    const wob = (s.wide ? 0.012 : 0.005) + Math.min(0.012, car.speed / 2500);
    camera.rotation.x += Math.sin(t * 7.1) * wob + (this.shake() - 0.5) * wob;
    camera.rotation.y += Math.sin(t * 5.3) * wob;
    camera.rotation.z += Math.sin(t * 3.7) * wob * 0.8;
    if (s.wide) {
      camera.fov = 104; // about a 10 mm lens on a camcorder
    } else {
      // Zoom in on the car when it is far off, out as it rushes past.
      const dist = camera.position.distanceTo(target);
      camera.fov = THREE.MathUtils.clamp((Math.atan(5.5 / Math.max(dist, 1)) * 2 * 180) / Math.PI, 14, 60);
    }
    camera.updateProjectionMatrix();
    return { k, cut, wide: s.wide };
  }
}

// Your own camera for edit mode: fly it about, look about, and leave cameras where you want them.
export class FreeCam {
  constructor() {
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = -0.15;
    this.move = { f: 0, s: 0, u: 0 }; // forward, sideways, up: -1..1 from the buttons and keys
    this.fov = 55; // degrees, 10..150
    this.shots = []; // [{ pos, yaw, pitch }]
  }

  placeBehind(pos, quat) {
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    this.pos.copy(pos).addScaledVector(back, 10).add(new THREE.Vector3(0, 3.5, 0));
    this.yaw = Math.atan2(pos.x - this.pos.x, pos.z - this.pos.z) + Math.PI;
    this.pitch = -0.2;
  }

  // Flies where it is pointed (forward and back go up and down with the view, too). lookAt: keep
  // turned toward that point as you fly.
  update(dt, camera, lookAt = null) {
    if (lookAt) {
      const d = lookAt.clone().sub(this.pos);
      this.yaw = Math.atan2(-d.x, -d.z);
      this.pitch = Math.asin(THREE.MathUtils.clamp(d.y / Math.max(d.length(), 1e-3), -1, 1));
    }
    const speed = 14;
    const cp = Math.cos(this.pitch);
    const f = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.pos.addScaledVector(f, this.move.f * speed * dt).addScaledVector(r, this.move.s * speed * dt);
    this.pos.y += this.move.u * speed * 0.6 * dt;
    camera.position.copy(this.pos);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, 0);
    camera.fov = lensFor(this.fov).fov;
    camera.updateProjectionMatrix();
  }

  addShot() {
    this.shots.push({ pos: this.pos.clone(), yaw: this.yaw, pitch: this.pitch, fov: this.fov });
  }

  // Of your cameras, the nearest to the car, looking at it.
  frameShots(camera, car) {
    let best = null;
    for (const s of this.shots) if (!best || s.pos.distanceTo(car.pos) < best.pos.distanceTo(car.pos)) best = s;
    if (!best) return -1;
    this.lastFov = best.fov ?? 55;
    camera.position.copy(best.pos);
    camera.lookAt(car.pos.x, car.pos.y + 0.6, car.pos.z);
    // Each camera keeps the field of view it was placed with.
    camera.fov = lensFor(best.fov ?? 55).fov;
    camera.updateProjectionMatrix();
    return this.shots.indexOf(best);
  }
}
