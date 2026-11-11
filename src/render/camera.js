// Chase camera (smoothed, swings toward the direction of travel in a slide) and bumper camera.
import * as THREE from 'three';

const tmp = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.ready = false;
  }

  snap() {
    this.ready = false;
  }

  // carObject: the rendered car (interpolated pose). velocity: world linear velocity.
  update(dt, carObject, velocity) {
    const cam = this.camera;
    const q = carObject.quaternion;
    const fwd = tmp.set(0, 0, 1).applyQuaternion(q).setY(0).normalize().clone();
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
    const target = carObject.position.clone().addScaledVector(dir, -5.6).add(new THREE.Vector3(0, 1.9, 0));
    const look = carObject.position.clone().addScaledVector(fwd, 2.2).add(new THREE.Vector3(0, 0.7, 0));
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
