// Chase camera (smoothed, swings toward the direction of travel in a slide) and bumper camera.
import * as THREE from 'three';
import { EYE } from './cockpit.js';

const GROUND = -0.62; // body space: the car model's body group sits this far below the origin

const tmp = new THREE.Vector3();

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
  }

  snap() {
    this.ready = false;
  }

  // carObject: the rendered car (interpolated pose). velocity: world linear velocity.
  update(dt, carObject, velocity) {
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
      if (cam.fov !== 74) {
        cam.fov = 74;
        cam.updateProjectionMatrix();
      }
      this.ready = false;
      return;
    }
    if (this.mode === 'bumper') {
      const p = new THREE.Vector3(0, -0.08, 2.15).applyQuaternion(q).add(carObject.position);
      cam.position.copy(p);
      cam.up.set(0, 1, 0).applyQuaternion(q);
      cam.lookAt(p.clone().add(new THREE.Vector3(0, -0.02, 10).applyQuaternion(q)));
      cam.fov = 70;
      cam.updateProjectionMatrix();
      this.ready = false;
      return;
    }
    cam.up.set(0, 1, 0);
    if (cam.fov !== 60) {
      cam.fov = 60;
      cam.updateProjectionMatrix();
    }
    // Behind the car, leaning toward the direction of travel when sliding.
    const v = new THREE.Vector3(velocity.x, 0, velocity.z);
    const speed = v.length();
    const dir = fwd.clone();
    if (speed > 3 && v.dot(fwd) > 0) dir.lerp(v.normalize(), 0.35).normalize();
    const target = carObject.position.clone().addScaledVector(dir, -5.8).add(new THREE.Vector3(0, 2.3, 0));
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
