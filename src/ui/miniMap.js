// The mini-map in the corner while driving: the menu map drawn big once, then shown as a circle
// around the car, turned so the way you are facing is always up.

import { MapView } from './mapView.js';

const VIEW = 150; // metres from the centre to the edge of the circle

export class MiniMap {
  constructor(canvas, mountain) {
    this.canvas = canvas;
    this.mountain = mountain;
    this.ready = false;
    this.tick = 0;
    // Draw the big map a moment after start-up, so it does not hold up the first frames.
    setTimeout(() => {
      this.view = new MapView(document.createElement('canvas'), mountain, null);
      this.view.drawStatic(1400, 1400, 1.6);
      this.ready = true;
    }, 400);
  }

  // x, z: the car; heading: which way it faces (radians, as the road uses them).
  update(x, z, heading) {
    if (!this.ready || this.canvas.offsetParent === null) return;
    // About 20 times a second is plenty.
    if (this.tick++ % 3) return;
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(c.clientWidth * dpr);
    if (c.width !== size) {
      c.width = size;
      c.height = size;
    }
    const g = c.getContext('2d');
    const R = size / 2;
    const v = this.view;
    const [px, py] = v.toPx(x, z);
    const zoom = R / (VIEW * v.scale);
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 1.5 * dpr, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#6f7c3a';
    g.fillRect(0, 0, size, size);
    g.translate(R, R);
    // Turn the map so the car's heading points up the screen.
    g.rotate(-Math.PI / 2 - Math.atan2(Math.cos(heading), Math.sin(heading)));
    g.scale(zoom, zoom);
    g.drawImage(v.baseImage, -px, -py);
    g.restore();
    // The car: an arrow in the middle.
    g.fillStyle = '#e5281e';
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5 * dpr;
    g.beginPath();
    g.moveTo(R, R - 8 * dpr);
    g.lineTo(R + 6 * dpr, R + 6 * dpr);
    g.lineTo(R, R + 3 * dpr);
    g.lineTo(R - 6 * dpr, R + 6 * dpr);
    g.closePath();
    g.fill();
    g.stroke();
    // A rim.
    g.beginPath();
    g.arc(R, R, R - 1.5 * dpr, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(255, 160, 74, 0.9)';
    g.lineWidth = 2.5 * dpr;
    g.stroke();
  }
}
