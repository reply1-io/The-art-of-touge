// Night sky: a gradient dome, stars and the moon. Follows the camera.
import * as THREE from 'three';

export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    const dome = new THREE.SphereGeometry(1400, 24, 14);
    const pos = dome.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0x02040c);
    const mid = new THREE.Color(0x0b1638);
    const horizon = new THREE.Color(0x1d2c55);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 1400;
      if (y > 0.25) c.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.6));
      else c.copy(horizon).lerp(mid, Math.max(0, y / 0.25));
      col.set([c.r, c.g, c.b], i * 3);
    }
    dome.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const domeMesh = new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    domeMesh.renderOrder = -10;
    this.group.add(domeMesh);

    const n = 700;
    const sp = new Float32Array(n * 3);
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const y = 0.12 + rand() * 0.88;
      const r = Math.sqrt(1 - y * y);
      sp.set([Math.cos(a) * r * 1300, y * 1300, Math.sin(a) * r * 1300], i * 3);
    }
    const stars = new THREE.BufferGeometry();
    stars.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const pts = new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.5, sizeAttenuation: false, fog: false, depthWrite: false }));
    pts.renderOrder = -9;
    this.group.add(pts);

    this.moonDir = new THREE.Vector3(-0.45, 0.55, -0.7).normalize();
    const moon = new THREE.Mesh(new THREE.CircleGeometry(34, 20), new THREE.MeshBasicMaterial({ color: 0xf1efe2, fog: false, depthWrite: false }));
    moon.position.copy(this.moonDir).multiplyScalar(1250);
    moon.lookAt(0, 0, 0);
    moon.renderOrder = -8;
    this.group.add(moon);
    scene.add(this.group);
  }

  update(camera) {
    this.group.position.copy(camera.position);
  }
}
