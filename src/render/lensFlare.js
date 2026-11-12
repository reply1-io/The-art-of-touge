// Lens flare drawn over the picture when the sun is in view: a soft glow at the sun, a faint halo,
// and a string of small coloured ghosts reflected through the middle of the lens. Fades in and out
// smoothly and is hidden when terrain blocks the sun.
import * as THREE from 'three';

const GHOSTS = [
  // [position along the line (0 = sun, 1 = screen centre, 2 = mirrored), size, rgb, alpha]
  [0.45, 0.05, [255, 200, 120], 0.22],
  [0.8, 0.025, [140, 220, 255], 0.28],
  [1.25, 0.07, [190, 140, 255], 0.15],
  [1.55, 0.035, [120, 255, 200], 0.22],
  [1.9, 0.11, [255, 170, 110], 0.12],
];

export class LensFlare {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.level = 0;
    this.v = new THREE.Vector3();
    this.resize();
  }

  resize() {
    // Half resolution is plenty for soft shapes and keeps it cheap.
    this.canvas.width = Math.ceil(window.innerWidth / 2);
    this.canvas.height = Math.ceil(window.innerHeight / 2);
  }

  // strength: 0..1 from the time of day; tint: [r, g, b]; visible: false when the sun is blocked.
  draw(dt, camera, sunDir, strength, tint, visible) {
    const g = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    g.clearRect(0, 0, w, h);
    const p = this.v.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
    const inFront = p.z < 1;
    const sx = (p.x * 0.5 + 0.5) * w;
    const sy = (-p.y * 0.5 + 0.5) * h;
    // Brightest when the sun is near the middle of the view, gone once it leaves the frame.
    const off = Math.hypot(p.x, p.y);
    const target = inFront && visible && strength > 0 ? strength * Math.max(0, 1 - Math.max(0, off - 0.6) / 0.75) : 0;
    this.level += (target - this.level) * Math.min(1, dt * 4);
    if (this.level < 0.01) return;
    const L = this.level;
    const [r, gg, b] = tint;
    const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    g.globalCompositeOperation = 'lighter';
    // Glow around the sun.
    const R = h * 0.42;
    let grad = g.createRadialGradient(sx, sy, 0, sx, sy, R);
    grad.addColorStop(0, rgba([r, gg, b], 0.75 * L));
    grad.addColorStop(0.25, rgba([r, gg, b], 0.16 * L));
    grad.addColorStop(1, rgba([r, gg, b], 0));
    g.fillStyle = grad;
    g.fillRect(sx - R, sy - R, R * 2, R * 2);
    // Thin horizontal streak.
    grad = g.createLinearGradient(sx - w * 0.35, sy, sx + w * 0.35, sy);
    grad.addColorStop(0, rgba([r, gg, b], 0));
    grad.addColorStop(0.5, rgba([r, gg, b], 0.32 * L));
    grad.addColorStop(1, rgba([r, gg, b], 0));
    g.fillStyle = grad;
    g.fillRect(sx - w * 0.35, sy - 1, w * 0.7, 2);
    // Faint halo ring.
    g.strokeStyle = rgba([r, gg, b], 0.1 * L);
    g.lineWidth = h * 0.012;
    g.beginPath();
    g.arc(sx, sy, h * 0.28, 0, Math.PI * 2);
    g.stroke();
    // Ghosts along the line from the sun through the centre of the screen.
    const cx = w / 2;
    const cy = h / 2;
    for (const [t, size, c, a] of GHOSTS) {
      const gx = sx + (cx - sx) * t;
      const gy = sy + (cy - sy) * t;
      const gr = h * size;
      const rg = g.createRadialGradient(gx, gy, gr * 0.2, gx, gy, gr);
      rg.addColorStop(0, rgba(c, a * L * 0.6));
      rg.addColorStop(0.8, rgba(c, a * L));
      rg.addColorStop(1, rgba(c, 0));
      g.fillStyle = rg;
      g.beginPath();
      g.arc(gx, gy, gr, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }
}
