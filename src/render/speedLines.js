// Speed streaks: faint motes of dust and light hanging in the air around the road. They stay put
// in the world, so at speed they rush past the camera as short streaks; below 50 mph they
// fade out completely. Below 50 mph there are none; above, more, longer and brighter with speed.
import * as THREE from 'three';

const N = 70;

export class SpeedLines {
  constructor(scene) {
    this.pts = Array.from({ length: N }, () => new THREE.Vector3(1e9, 0, 0));
    this.pos = new Float32Array(N * 6);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 6;
    scene.add(this.lines);
    this.dir = new THREE.Vector3();
    this.side = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
  }

  // Put a mote somewhere in front of the camera, off to the side of the line of travel.
  #spawn(p, cam, near) {
    const a = Math.random() * Math.PI * 2;
    const r = 2.2 + Math.random() * 4;
    this.side.set(-this.dir.z, 0, this.dir.x);
    p.copy(cam)
      .addScaledVector(this.dir, near ? 3 + Math.random() * 35 : 25 + Math.random() * 15)
      .addScaledVector(this.side, Math.cos(a) * r)
      .add(this.tmp.set(0, Math.sin(a) * r * 0.6 + 0.4, 0));
  }

  // camera: the view; velocity: the car's world velocity; tint: Color for the time of day.
  update(camera, velocity, tint) {
    const speed = Math.hypot(velocity.x, velocity.z);
    const k = Math.max(0, Math.min(1, (speed - 22.35) / 27)); // from 50 mph, full by about 110
    this.mat.opacity = 0.12 + 0.33 * k;
    this.geo.setDrawRange(0, Math.max(2, Math.round(N * (0.25 + 0.75 * k))) * 2);
    this.lines.visible = speed > 22.35;
    if (!this.lines.visible) {
      for (const p of this.pts) p.x = 1e9;
      return;
    }
    this.mat.color.copy(tint);
    this.dir.set(velocity.x, 0, velocity.z).normalize();
    const cam = camera.position;
    const len = speed * (0.02 + 0.025 * k);
    this.pts.forEach((p, i) => {
      // Behind the camera or far off: start again ahead.
      this.tmp.subVectors(p, cam);
      const ahead = this.tmp.dot(this.dir);
      if (p.x > 1e8) this.#spawn(p, cam, true);
      else if (ahead < 0.5 || this.tmp.lengthSq() > 2500) this.#spawn(p, cam, false);
      this.pos.set([p.x, p.y, p.z, p.x - this.dir.x * len, p.y, p.z - this.dir.z * len], i * 6);
    });
    this.geo.attributes.position.needsUpdate = true;
  }
}
