// Chase camera (smoothed, swings toward the direction of travel in a slide) and bumper camera.
import * as THREE from 'three';
import { EYE } from './cockpit.js';

const GROUND = -0.62; // body space: the car model's body group sits this far below the origin

const tmp = new THREE.Vector3();
// Field of view at a standstill for each camera.
const BASE_FOV = { chase: 60, cockpit: 68, bumper: 70 };

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.ready = false;
    // In-car head movement: 1 = road seats (your head is thrown about), small = bucket seats.
    this.headSway = 1;
    this.head = new THREE.Vector3(); // smoothed head offset in the car's frame
    this.prevVel = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.fov = 60;
    this.t = 0;
    this.react = new THREE.Vector2(); // x: pitch, y: height
  }

  snap() {
    this.ready = false;
  }

  // carObject: the rendered car (interpolated pose). velocity: world linear velocity.
  update(dt, carObject, velocity) {
    this.#place(dt, carObject, velocity);
    this.#speedFeel(dt, carObject, velocity);
  }

  // Sense of speed. The field of view opens up as you go faster (the road rushes past at the
  // edges), and above 50 mph the camera starts to shake, a fine buzz that grows with speed.
  #speedFeel(dt, carObject, velocity) {
    const cam = this.camera;
    const mph = Math.hypot(velocity.x, velocity.z) * 2.237;
    const base = BASE_FOV[this.mode] ?? 60;
    // Wider view with speed: +0 at 20 mph up to about +16 degrees by 110 mph.
    const widen = Math.max(0, Math.min(1, (mph - 20) / 90)) ** 1.2 * (this.mode === 'chase' ? 16 : 12);
    this.fov += (base + widen - this.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    // The camera reacts to the car, barely: it settles back a hair under acceleration, dips
    // forward under braking, and gives over crests and dips. (Not with the locked bucket view.)
    const locked = this.mode === 'chase' && this.headSway < 0.5;
    if (!locked) {
      const clampAbs = (v, m) => Math.max(-m, Math.min(m, v));
      this.react.x += (clampAbs(-this.acc.z * 0.0009, 0.008) - this.react.x) * (1 - Math.exp(-dt * 4));
      this.react.y += (clampAbs(-this.acc.y * 0.0025, 0.03) - this.react.y) * (1 - Math.exp(-dt * 5));
      cam.position.y += this.react.y;
      cam.rotateX(this.react.x);
    }
    // Shake: off below 50 mph, then grows with speed. Several mixed frequencies so it feels like
    // the car buzzing over the road, not a regular wobble.
    this.t += dt;
    const k = Math.max(0, Math.min(1.4, (mph - 50) / 55));
    if (k <= 0) return;
    const amp = k ** 1.5;
    const t = this.t;
    const n = (a, b, c) => (Math.sin(t * a + 1.3) + Math.sin(t * b + 4.1) * 0.6 + Math.sin(t * c + 2.7) * 0.35) / 1.95;
    const inCar = this.mode !== 'chase';
    const m = inCar ? 0.012 : 0.028; // metres at full strength
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    cam.position.addScaledVector(right, n(31, 47, 73) * m * amp).addScaledVector(up, n(37, 59, 89) * m * amp * 1.3);
    cam.rotateZ(n(23, 41, 67) * 0.004 * amp);
    cam.rotateX(n(29, 53, 79) * 0.0025 * amp);
  }

  #place(dt, carObject, velocity) {
    const cam = this.camera;
    const q = carObject.quaternion;
    const fwd = tmp.set(0, 0, 1).applyQuaternion(q).setY(0).normalize().clone();
    // Acceleration in the car's frame (x left, z forward), smoothed.
    const vel = new THREE.Vector3(velocity.x, velocity.y, velocity.z);
    if (dt > 0) {
      const a = vel.clone().sub(this.prevVel).divideScalar(dt).applyQuaternion(q.clone().invert());
      this.acc.lerp(a, 1 - Math.exp(-dt * 6));
    }
    this.prevVel.copy(vel);
    if (this.mode === 'cockpit') {
      // Driver's eyes, looking down the road over the bonnet. In road seats the head leans
      // against the corners and nods under braking; bucket seats hold it almost still.
      const k = this.headSway;
      const target = new THREE.Vector3(
        Math.max(-0.09, Math.min(0.09, -this.acc.x * 0.009 * k)),
        Math.max(-0.03, Math.min(0.03, -Math.abs(this.acc.x) * 0.0015 * k)),
        Math.max(-0.06, Math.min(0.06, -this.acc.z * 0.006 * k)),
      );
      this.head.lerp(target, 1 - Math.exp(-dt * 8));
      const p = new THREE.Vector3(EYE.x + this.head.x, EYE.y + GROUND + this.head.y, EYE.z + this.head.z).applyQuaternion(q).add(carObject.position);
      cam.position.copy(p);
      // The head tilts a little with the lean.
      cam.up.set(this.head.x * 1.5, 1, 0).normalize().applyQuaternion(q);
      cam.lookAt(p.clone().add(new THREE.Vector3(0, -0.9, 10).applyQuaternion(q)));
      this.ready = false;
      return;
    }
    if (this.mode === 'bumper') {
      const p = new THREE.Vector3(0, -0.08, 2.15).applyQuaternion(q).add(carObject.position);
      cam.position.copy(p);
      cam.up.set(0, 1, 0).applyQuaternion(q);
      cam.lookAt(p.clone().add(new THREE.Vector3(0, -0.02, 10).applyQuaternion(q)));
      this.ready = false;
      return;
    }
    cam.up.set(0, 1, 0);
    // Bucket seats: the camera is bolted to the car. It sits dead behind it and turns with it, with
    // no lag and no swing toward the slide, so the car never moves on screen.
    if (this.headSway < 0.5) {
      const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(fwd.x, fwd.z));
      cam.position.copy(new THREE.Vector3(0, 2.3, -5.8).applyQuaternion(yawQ).add(carObject.position));
      cam.lookAt(new THREE.Vector3(0, 0.6, 9).applyQuaternion(yawQ).add(carObject.position));
      this.pos.copy(cam.position);
      this.look.copy(carObject.position);
      this.ready = true;
      return;
    }
    // Behind the car, leaning toward the direction of travel when sliding.
    const v = new THREE.Vector3(velocity.x, 0, velocity.z);
    const speed = v.length();
    const dir = fwd.clone();
    if (speed > 3 && v.dot(fwd) > 0) dir.lerp(v.normalize(), 0.35).normalize();
    // At speed the camera drops a little lower and trails a little further back.
    const fast = Math.min(1, speed / 45);
    const target = carObject.position.clone().addScaledVector(dir, -5.8 - fast * 0.6).add(new THREE.Vector3(0, 2.3 - fast * 0.35, 0));
    const look = carObject.position.clone().addScaledVector(fwd, 9).add(new THREE.Vector3(0, 0.6, 0));
    if (!this.ready) {
      this.pos.copy(target);
      this.look.copy(look);
      this.ready = true;
    }
    this.pos.lerp(target, 1 - Math.exp(-dt * 7));
    this.look.lerp(look, 1 - Math.exp(-dt * 12));
    if (this.pos.y < carObject.position.y + 0.6) this.pos.y = carObject.position.y + 0.6;
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
  }
}
