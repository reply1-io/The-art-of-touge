// Sky: gradient dome, stars, the sun or moon, and clouds. Follows the camera; recoloured per time.
import * as THREE from 'three';

function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const x = 20 + rand() * 88;
    const y = 26 + rand() * 18;
    const r = 10 + rand() * 16;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    this.dome = new THREE.SphereGeometry(1400, 24, 14);
    this.dome.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.dome.getAttribute('position').count * 3), 3));
    const domeMesh = new THREE.Mesh(this.dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
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
    this.starMat = new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.5, sizeAttenuation: false, fog: false, depthWrite: false, transparent: true });
    const pts = new THREE.Points(stars, this.starMat);
    pts.renderOrder = -9;
    this.group.add(pts);

    this.discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, depthWrite: false });
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1, 24), this.discMat);
    this.disc.renderOrder = -8;
    this.group.add(this.disc);

    // A ring of clouds low in the sky.
    this.cloudMat = new THREE.MeshBasicMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, fog: false });
    this.clouds = new THREE.Group();
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + Math.sin(i * 7) * 0.2;
      const el = 0.06 + ((i * 37) % 10) / 10 * 0.22;
      const d = 1200;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(260 + (i % 4) * 90, 90 + (i % 3) * 30), this.cloudMat);
      m.position.set(Math.cos(a) * Math.cos(el) * d, Math.sin(el) * d, Math.sin(a) * Math.cos(el) * d);
      m.lookAt(0, m.position.y * 0.3, 0);
      m.renderOrder = -7;
      this.clouds.add(m);
    }
    this.group.add(this.clouds);
    scene.add(this.group);
    this.sunDir = new THREE.Vector3(0, 1, 0);
  }

  // preset: from TIMES; sunDir: unit vector toward the sun (or moon).
  setTime(preset, sunDir) {
    this.sunDir.copy(sunDir);
    const pos = this.dome.getAttribute('position');
    const col = this.dome.getAttribute('color');
    const top = new THREE.Color(preset.skyTop);
    const mid = new THREE.Color(preset.skyMid);
    const hor = new THREE.Color(preset.skyHorizon);
    const fog = new THREE.Color(preset.fog);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 1400;
      if (y < 0) c.copy(fog);
      else if (y > 0.25) c.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.6));
      else c.copy(hor).lerp(mid, y / 0.25);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    this.starMat.opacity = preset.stars;
    this.starMat.visible = preset.stars > 0.02;
    this.discMat.color.setHex(preset.disc);
    this.disc.scale.setScalar(preset.discSize);
    this.disc.position.copy(sunDir).multiplyScalar(1250);
    this.disc.lookAt(0, 0, 0);
    this.cloudMat.color.setHex(preset.clouds);
    this.cloudMat.opacity = preset.cloudOpacity;
    this.clouds.visible = preset.cloudOpacity > 0.01;
  }

  update(camera) {
    this.group.position.copy(camera.position);
  }
}
