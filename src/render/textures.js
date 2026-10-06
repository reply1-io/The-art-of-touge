// Procedurally drawn low-resolution textures (PS1 style: small, nearest-neighbour, no mipmaps).
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false; // v = 0 is the top row of the canvas
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  } else {
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
  }
  return t;
}

function noiseFill(ctx, w, h, base, spread, rand, alpha = 1) {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) {
    const n = (rand() - 0.5) * spread;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255 * alpha;
  }
  ctx.putImageData(img, 0, 0);
}

// Road: u runs across the road (0 = left edge, 1 = right edge), v repeats every 8 m.
export function asphaltTexture() {
  const w = 64;
  const h = 128;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const rand = rng(11);
  noiseFill(ctx, w, h, [78, 78, 82], 26, rand);
  // Darker tyre-worn bands in each lane.
  ctx.fillStyle = 'rgba(30,30,34,0.22)';
  for (const x of [10, 22, 41, 53]) ctx.fillRect(x - 2, 0, 4, h);
  // Patches and cracks.
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = `rgba(${40 + rand() * 30},${40 + rand() * 30},${44 + rand() * 30},0.5)`;
    ctx.fillRect(rand() * w, rand() * h, 4 + rand() * 10, 4 + rand() * 16);
  }
  ctx.strokeStyle = 'rgba(25,25,28,0.7)';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    let x = rand() * w;
    let y = rand() * h;
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += (rand() - 0.5) * 10;
      y += rand() * 8;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Edge lines (white) and dashed centre line (white).
  ctx.fillStyle = '#d8d8d0';
  ctx.fillRect(2, 0, 2, h);
  ctx.fillRect(w - 4, 0, 2, h);
  ctx.fillRect(31, 0, 2, h / 2);
  // Worn paint.
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) {
    if (img.data[i * 4] > 180 && rand() < 0.18) {
      img.data[i * 4] -= 90;
      img.data[i * 4 + 1] -= 90;
      img.data[i * 4 + 2] -= 85;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c);
}

export function gravelTexture() {
  const c = canvas(32, 32);
  const ctx = c.getContext('2d');
  const rand = rng(21);
  noiseFill(ctx, 32, 32, [112, 104, 92], 50, rand);
  return toTexture(c);
}

export function concreteTexture() {
  const c = canvas(32, 32);
  const ctx = c.getContext('2d');
  const rand = rng(31);
  noiseFill(ctx, 32, 32, [150, 148, 140], 24, rand);
  ctx.fillStyle = 'rgba(60,60,60,0.5)';
  ctx.fillRect(0, 0, 1, 32);
  ctx.fillRect(0, 31, 32, 1);
  return toTexture(c);
}

// Neutral detail texture for terrain: hue comes from vertex colours (grass, rock, dirt).
export function groundTexture() {
  const c = canvas(64, 64);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const rand = rng(41);
  noiseFill(ctx, 64, 64, [200, 200, 200], 70, rand);
  for (let i = 0; i < 90; i++) {
    const v = 120 + rand() * 120;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(Math.floor(rand() * 64), Math.floor(rand() * 64), 1 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 2));
  }
  return toTexture(c);
}

export function guardrailTexture() {
  const c = canvas(32, 16);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 16);
  g.addColorStop(0, '#e8e8e8');
  g.addColorStop(0.3, '#b8bcc0');
  g.addColorStop(0.5, '#f4f4f4');
  g.addColorStop(0.75, '#a0a4a8');
  g.addColorStop(1, '#d0d0d0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 16);
  const rand = rng(51);
  for (let i = 0; i < 25; i++) {
    ctx.fillStyle = `rgba(90,70,50,${rand() * 0.35})`;
    ctx.fillRect(rand() * 32, rand() * 16, 2, 1);
  }
  ctx.fillStyle = '#707478';
  ctx.fillRect(0, 7, 2, 3);
  return toTexture(c);
}

// Japanese cedar silhouette with alpha.
export function treeTexture() {
  const w = 32;
  const h = 64;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const rand = rng(61);
  ctx.fillStyle = '#4a3020';
  ctx.fillRect(14, 50, 4, 14);
  for (let layer = 0; layer < 7; layer++) {
    const y = 4 + layer * 7;
    const half = 3 + layer * 2;
    const shade = 30 + layer * 6;
    ctx.fillStyle = `rgb(${shade - 12},${shade + 30},${shade - 8})`;
    ctx.beginPath();
    ctx.moveTo(16, y - 4);
    ctx.lineTo(16 + half, y + 9);
    ctx.lineTo(16 - half, y + 9);
    ctx.closePath();
    ctx.fill();
  }
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) {
    if (img.data[i * 4 + 3] > 0) {
      const n = (rand() - 0.5) * 40;
      img.data[i * 4] += n;
      img.data[i * 4 + 1] += n;
      img.data[i * 4 + 2] += n;
      img.data[i * 4 + 3] = img.data[i * 4 + 3] > 128 ? 255 : 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, false);
}

export function chevronTexture() {
  const c = canvas(32, 32);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f0c020';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = '#141414';
  ctx.fillRect(0, 0, 32, 2);
  ctx.fillRect(0, 30, 32, 2);
  ctx.beginPath();
  ctx.moveTo(8, 4);
  ctx.lineTo(20, 16);
  ctx.lineTo(8, 28);
  ctx.lineTo(14, 28);
  ctx.lineTo(26, 16);
  ctx.lineTo(14, 4);
  ctx.closePath();
  ctx.fill();
  return toTexture(c, false);
}

export function bannerTexture(text, colors = ['#c81818', '#f4f4f4']) {
  const c = canvas(128, 32);
  const ctx = c.getContext('2d');
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, 128, 32);
  // Checkered ends.
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 2; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      ctx.fillRect(x * 8, y * 8, 8, 8);
      ctx.fillRect(112 + x * 8, y * 8, 8, 8);
    }
  }
  ctx.fillStyle = colors[1];
  ctx.font = 'italic bold 20px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 17);
  return toTexture(c, false);
}

export function whiteTexture() {
  const c = canvas(2, 2);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 2, 2);
  return toTexture(c);
}

// Environment map for car reflections: sky on top, a band of dark treeline, ground below.
export function drawEnvMap(ctx, w, h, sky) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, sky.top);
  g.addColorStop(0.46, sky.horizon);
  g.addColorStop(0.5, sky.ground);
  g.addColorStop(1, sky.groundDark);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rand = rng(71);
  ctx.fillStyle = sky.treeline;
  for (let x = 0; x < w; x += 2) {
    const th = 2 + rand() * 4;
    ctx.fillRect(x, h * 0.5 - th, 2, th + 1);
  }
  if (sky.sun) {
    ctx.fillStyle = sky.sun;
    ctx.fillRect(w * 0.3, h * 0.18, 4, 3);
  }
}
