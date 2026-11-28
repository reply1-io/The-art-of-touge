// Sun glints: small star flares where the sun catches the paint. A handful of points on the body
// (roof, bonnet, boot lid, the shoulder line on each side) each carry the panel's normal; when the
// sun's reflection off that panel points at the camera, a little four-point star lights up there.
import * as THREE from 'three';

// [x, y, z] in the car's frame (origin at the body, y up, z forward) and the panel normal.
const SPOTS = [
  [[0, 0.76, -0.45], [0, 1, 0]], // roof
  [[0.1, 0.27, 1.35], [0, 0.98, 0.18]], // bonnet
  [[-0.2, 0.29, -1.8], [0, 1, -0.05]], // boot lid
  [[0.84, 0.12, 0.6], [1, 0.12, 0]], // left flank
  [[-0.84, 0.12, -0.6], [-1, 0.12, 0]], // right flank
  [[0, 0.55, 0.45], [0, 0.6, 0.8]], // top of the windscreen frame
];

function starTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 18);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,250,230,0.6)');
  grad.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // Thin spikes.
  for (const [w, h] of [[64, 3], [3, 64]]) {
    const s = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    s.addColorStop(0, 'rgba(255,255,255,0.9)');
    s.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = s;
    g.fillRect(32 - w / 2, 32 - h / 2, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Glints {
  constructor(carRoot) {
    this.root = carRoot;
    const mat = new THREE.SpriteMaterial({ map: starTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.sprites = SPOTS.map(([p, n]) => {
      const s = new THREE.Sprite(mat.clone());
      s.userData.p = new THREE.Vector3(...p);
      s.userData.n = new THREE.Vector3(...n).normalize();
      s.renderOrder = 4;
      carRoot.add(s);
      return s;
    });
    this.n = new THREE.Vector3();
    this.w = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.r = new THREE.Vector3();
  }

  // camera: the view; sunDir: unit vector to the sun; strength: 0..1 (0 at night); tint: Color.
  update(camera, sunDir, strength, tint) {
    const q = this.root.getWorldQuaternion(new THREE.Quaternion());
    for (const s of this.sprites) {
      const n = this.n.copy(s.userData.n).applyQuaternion(q);
      const nl = n.dot(sunDir);
      let k = 0;
      if (strength > 0 && nl > 0.05) {
        // Mirror the sun about the panel and see how close that is to the camera.
        this.r.copy(n).multiplyScalar(2 * nl).sub(sunDir);
        this.w.copy(s.userData.p);
        this.root.localToWorld(this.w);
        this.v.copy(camera.position).sub(this.w).normalize();
        const a = this.r.dot(this.v);
        k = a > 0.86 ? Math.pow((a - 0.86) / 0.14, 4) * strength : 0;
      }
      s.position.copy(s.userData.p).addScaledVector(s.userData.n, 0.06);
      s.visible = k > 0.02;
      if (s.visible) {
        const size = 0.45 + k * 1.5;
        s.scale.set(size, size, 1);
        s.material.opacity = Math.min(1, k * 1.3);
        s.material.color.copy(tint);
      }
    }
  }
}
