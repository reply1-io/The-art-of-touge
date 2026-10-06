// In-race HUD, drawn on a low-resolution canvas and scaled up with hard pixels.
// Inspired by Gran Turismo 2 (chunky italic numbers, orange on dark label bars, analog tach),
// rearranged for touge and for thumbs: tach on the right edge and map on the left edge,
// both above the touch controls.

const ORANGE = '#ffa23a';
const LABEL_BG = '#7a1010';
const H = 300; // HUD canvas height in pixels

export function formatTime(t) {
  if (t == null || !Number.isFinite(t)) return '-:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export class Hud {
  constructor(canvas, track, scenery) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.track = track;
    this.banner = null;
    this.bannerTime = 0;
    this.flash = null;
    this.flashTime = 0;
    this.#buildMap(scenery);
    this.resize();
  }

  resize() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.canvas.height = H;
    this.canvas.width = Math.round(H * aspect);
    this.W = this.canvas.width;
  }

  #buildMap(scenery) {
    const t = this.track;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < t.count; i++) {
      minX = Math.min(minX, t.x[i]);
      maxX = Math.max(maxX, t.x[i]);
      minZ = Math.min(minZ, t.z[i]);
      maxZ = Math.max(maxZ, t.z[i]);
    }
    const size = 84;
    const scale = (size - 10) / Math.max(maxX - minX, maxZ - minZ);
    // Screen x = world -x so the map matches the view from above with north up.
    this.mapProject = (x, z) => [size - 5 - (x - minX) * scale - ((size - 10) - (maxX - minX) * scale) / 2, size - 5 - (z - minZ) * scale - ((size - 10) - (maxZ - minZ) * scale) / 2];
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i < t.count; i += 6) {
        const [px, py] = this.mapProject(t.x[i], t.z[i]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
    };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 5;
    path();
    ctx.stroke();
    ctx.strokeStyle = '#f2f2f2';
    ctx.lineWidth = 2.5;
    path();
    ctx.stroke();
    for (const [i, col] of [
      [scenery.startIndex, '#3a6cff'],
      [scenery.finishIndex, '#ff3030'],
    ]) {
      const [px, py] = this.mapProject(t.x[i], t.z[i]);
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(px) - 2, Math.round(py) - 2, 4, 4);
    }
    this.mapCanvas = c;
    this.mapSize = size;
  }

  showBanner(title, sub, seconds = 3.5) {
    this.banner = { title, sub };
    this.bannerTime = seconds;
  }

  showFlash(text, color = ORANGE, seconds = 1.6) {
    this.flash = { text, color };
    this.flashTime = seconds;
  }

  #text(str, x, y, size, color = ORANGE, align = 'left', italic = true) {
    const ctx = this.ctx;
    ctx.font = `${italic ? 'italic ' : ''}900 ${size}px "Arial Black", "Arial", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, size * 0.18);
    ctx.strokeStyle = '#140808';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  #label(str, x, y, align = 'left') {
    const ctx = this.ctx;
    ctx.font = 'italic 900 11px "Arial Black", Arial, sans-serif';
    const w = ctx.measureText(str).width + 10;
    const lx = align === 'right' ? x - w : x;
    ctx.fillStyle = LABEL_BG;
    ctx.fillRect(lx, y - 10, w, 12);
    ctx.fillStyle = '#ffcf9a';
    ctx.textAlign = 'left';
    ctx.fillText(str, lx + 5, y);
  }

  // state: { car, units, run (TimeAttack), showClutch, todLabel, hidden }
  draw(dt, state) {
    const ctx = this.ctx;
    const W = this.W;
    ctx.clearRect(0, 0, W, H);
    if (state.hidden) return;
    const car = state.car;
    const run = state.run;

    // ---- Top left: run timer ----
    this.#label(run.phase === 'running' ? 'TIME' : 'TIME ATTACK', 10, 18);
    this.#text(run.phase === 'ready' ? formatTime(null) : formatTime(run.time), 12, 44, 24);
    if (run.splitTime > 0 && run.split != null) {
      const ahead = run.split <= 0;
      const s = `${ahead ? '-' : '+'}${Math.abs(run.split).toFixed(3)}`;
      this.#text(s, 14, 66, 16, ahead ? '#5dff6a' : '#ff5a4a');
    }

    // ---- Top right: record ----
    this.#label('RECORD', W - 10, 18, 'right');
    this.#text(formatTime(run.record?.time), W - 12, 40, 18, ORANGE, 'right');
    if (state.todLabel) this.#text(state.todLabel, 14, run.splitTime > 0 ? 84 : 64, 10, '#ffd9b0', 'left', false);

    // ---- Right edge: tachometer, gear, speed ----
    const cx = W - 62;
    const cy = 96;
    const R = 46;
    const maxRpm = 9000;
    const a0 = Math.PI * 0.8;
    const a1 = Math.PI * 2.05;
    const ang = (rpm) => a0 + (a1 - a0) * Math.min(1, rpm / maxRpm);
    // Redline band (flashes near the shift point).
    const redline = car.spec.engine.redline;
    const nearShift = car.rpm > redline - 400;
    ctx.lineWidth = 6;
    ctx.strokeStyle = nearShift && Math.floor(performance.now() / 90) % 2 ? '#ffe040' : '#e01818';
    ctx.beginPath();
    ctx.arc(cx, cy, R - 3, ang(redline), ang(maxRpm));
    ctx.stroke();
    // Ticks and numbers.
    for (let k = 0; k <= 9; k++) {
      const a = ang(k * 1000);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      ctx.strokeStyle = '#f4f4f4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + ca * (R - 1), cy + sa * (R - 1));
      ctx.lineTo(cx + ca * (R - 8), cy + sa * (R - 8));
      ctx.stroke();
      this.#text(String(k), cx + ca * (R - 16), cy + sa * (R - 16) + 4, 10, '#f4f4f4', 'center', false);
    }
    for (let k = 0; k < 18; k++) {
      const a = ang(k * 500 + 250);
      ctx.strokeStyle = 'rgba(244,244,244,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (R - 1), cy + Math.sin(a) * (R - 1));
      ctx.lineTo(cx + Math.cos(a) * (R - 5), cy + Math.sin(a) * (R - 5));
      ctx.stroke();
    }
    // Needle.
    const na = ang(car.rpm);
    ctx.strokeStyle = '#ff2a10';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(na) * 6, cy - Math.sin(na) * 6);
    ctx.lineTo(cx + Math.cos(na) * (R - 4), cy + Math.sin(na) * (R - 4));
    ctx.stroke();
    // Gear and speed.
    this.#text(car.gearLabel, cx + 20, cy + 22, 24, ORANGE, 'center');
    const kmh = Math.abs(car.forwardSpeed) * 3.6;
    const spd = state.units === 'mph' ? kmh / 1.609344 : kmh;
    this.#text(String(Math.round(spd)), cx + 18, cy + 56, 28, ORANGE, 'right');
    this.#text(state.units === 'mph' ? 'mph' : 'km/h', cx + 22, cy + 56, 12, ORANGE, 'left');
    // Clutch indicator for manual-with-clutch.
    if (state.showClutch) {
      const engaged = car.coupling;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(cx - 92, cy + 47, 36, 5);
      ctx.fillStyle = engaged > 0.95 ? '#5dff6a' : engaged < 0.05 ? '#ff5a4a' : '#ffd040';
      ctx.fillRect(cx - 92, cy + 47, 36 * engaged, 5);
      this.#text('CLUTCH', cx - 74, cy + 62, 8, '#ffd9b0', 'center', false);
    }

    // ---- Left edge: minimap ----
    const mx = Math.round(W * 0.19);
    const my = 4;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.mapCanvas, mx, my);
    ctx.globalAlpha = 1;
    const [px, py] = this.mapProject(car.x, car.z);
    ctx.fillStyle = '#000';
    ctx.fillRect(Math.round(mx + px) - 3, Math.round(my + py) - 3, 6, 6);
    ctx.fillStyle = '#ff2a10';
    ctx.fillRect(Math.round(mx + px) - 2, Math.round(my + py) - 2, 4, 4);

    // ---- Centre: section banner and messages ----
    if (this.bannerTime > 0) {
      this.bannerTime -= dt;
      const a = Math.min(1, this.bannerTime / 0.4, (3.5 - this.bannerTime) / 0.25 + 0.2);
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      const by = 92;
      ctx.fillStyle = 'rgba(10,10,20,0.6)';
      ctx.fillRect(W / 2 - 150, by - 26, 300, 46);
      ctx.fillStyle = '#e01818';
      ctx.fillRect(W / 2 - 150, by - 26, 4, 46);
      this.#text(this.banner.title, W / 2, by, 22, '#ffffff', 'center');
      this.#text(this.banner.sub, W / 2, by + 15, 11, ORANGE, 'center', false);
      ctx.globalAlpha = 1;
    }
    const msg = car.messageTimer > 0 ? { text: car.message, color: '#ff5a4a' } : this.flashTime > 0 ? this.flash : null;
    if (this.flashTime > 0) this.flashTime -= dt;
    if (msg) this.#text(msg.text, W / 2, 160, 20, msg.color, 'center');
  }
}
