// Soft round textures for glows and smoke. Drawn into a canvas, a fade to transparent stores the
// see-through pixels as black, and when the picture is shrunk (mipmaps, small sprites, phones) that
// black bleeds into the soft edge as dark specks. Here the colour is the same everywhere and only
// the alpha fades, so there is never any black to bleed in.
import * as THREE from 'three';

// rgb: [r, g, b] 0..255. stops: [[radius 0..1, alpha 0..1], ...] from the middle outward.
export function softTexture(rgb, stops, size = 64) {
  const data = new Uint8Array(size * size * 4);
  const h = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.min(1, Math.hypot(x + 0.5 - h, y + 0.5 - h) / h);
      let a = stops[stops.length - 1][1];
      for (let k = 1; k < stops.length; k++) {
        if (r <= stops[k][0]) {
          const [r0, a0] = stops[k - 1];
          const [r1, a1] = stops[k];
          a = a0 + ((a1 - a0) * (r - r0)) / Math.max(1e-6, r1 - r0);
          break;
        }
      }
      const o = (y * size + x) * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// From CSS colours like glowTexture('rgba(255,214,140,0.9)', 'rgba(255,170,60,0)'): the inner
// colour throughout, alpha fading from the inner alpha to the outer.
export function cssGlow(inner, outer) {
  const p = (c) => c.match(/[\d.]+/g).map(Number);
  const [r, g, b, a0] = p(inner);
  const a1 = p(outer)[3] ?? 0;
  return softTexture([r, g, b], [[0, a0], [1, a1]]);
}
