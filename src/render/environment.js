// Sky dome, sun/moon, stars, and applying a time-of-day preset to lighting and fog.
import * as THREE from 'three';
import { globals, skyMaterial, worldMaterial } from './ps1.js';
import { whiteTexture } from './textures.js';

const css = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

export class Environment {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    // Dome with a colour per latitude ring.
    this.dome = new THREE.SphereGeometry(3000, 16, 12);
    const n = this.dome.getAttribute('position').count;
    this.dome.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const domeMesh = new THREE.Mesh(this.dome, skyMaterial());
    domeMesh.renderOrder = -10;
    domeMesh.frustumCulled = false;
    this.group.add(domeMesh);

    // Sun / moon disc.
    const discGeo = new THREE.CircleGeometry(70, 10);
    discGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(discGeo.getAttribute('position').count * 3).fill(1), 3));
    this.discMat = worldMaterial(whiteTexture(), { lit: false, fog: { near: 1e5, far: 2e5, max: 0 }, tint: new THREE.Color(1, 1, 1) });
    this.discMat.depthWrite = false;
    this.disc = new THREE.Mesh(discGeo, this.discMat);
    this.disc.renderOrder = -9;
    this.disc.frustumCulled = false;
    this.group.add(this.disc);

    // Stars.
    const starCount = 500;
    const sp = new Float32Array(starCount * 3);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < starCount; i++) {
      const a = rand() * Math.PI * 2;
      const y = 0.08 + rand() * 0.92;
      const r = Math.sqrt(1 - y * y);
      sp.set([Math.cos(a) * r * 2800, y * 2800, Math.sin(a) * r * 2800], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1, sizeAttenuation: false, transparent: true, depthWrite: false });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    this.preset = null;
  }

  apply(p, carModel, scenery) {
    this.preset = p;
    // Sky gradient: top colour above, horizon colour at the horizon, fog colour below.
    const pos = this.dome.getAttribute('position');
    const col = this.dome.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 3000;
      let c;
      if (y >= 0) {
        const t = Math.pow(Math.min(1, y / 0.55), 0.7);
        c = p.skyHorizon.map((h, k) => h + (p.skyTop[k] - h) * t);
      } else {
        c = p.fog;
      }
      col.setXYZ(i, c[0], c[1], c[2]);
    }
    col.needsUpdate = true;

    const sunDir = new THREE.Vector3(
      Math.cos(p.sunAzim) * Math.cos(p.sunElev),
      Math.sin(p.sunElev),
      Math.sin(p.sunAzim) * Math.cos(p.sunElev),
    ).normalize();
    globals.uSunDir.value.copy(sunDir);
    globals.uSunColor.value.setRGB(...p.sunColor);
    globals.uAmbient.value.setRGB(...p.ambient);
    globals.uFogColor.value.setRGB(...p.fog);
    globals.uFogNear.value = p.fogNear;
    globals.uFogFar.value = p.fogFar;
    globals.uHeadOn.value = p.lights > 0.5 ? 1 : 0;

    this.sunDir = sunDir;
    const isMoon = p.stars > 0.5;
    this.discMat.uniforms.uTint.value.setRGB(...(isMoon ? [0.85, 0.88, 0.95] : p.sunColor.map((v) => Math.min(1, v * 1.15 + 0.1))));
    this.disc.scale.setScalar(isMoon ? 0.6 : 1);
    this.starMat.opacity = p.stars;
    this.stars.visible = p.stars > 0.05;

    if (scenery?.rangeMaterial) {
      scenery.rangeMaterial.uniforms.uTint.value.setRGB(...p.ranges);
    }
    if (carModel) {
      const ground = p.fog.map((v) => v * 0.35);
      carModel.updateEnv({
        top: css(p.skyTop),
        horizon: css(p.skyHorizon),
        ground: css(ground),
        groundDark: css(ground.map((v) => v * 0.5)),
        treeline: css(p.ranges.map((v) => v * 0.35)),
        sun: p.stars > 0.5 ? null : css(p.sunColor),
      });
    }
  }

  // Keep the sky centred on the camera.
  update(camera) {
    this.group.position.copy(camera.position);
    if (this.sunDir) {
      this.disc.position.copy(this.sunDir).multiplyScalar(2600);
      this.disc.lookAt(camera.position);
    }
  }
}
