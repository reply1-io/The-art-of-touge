// Heads-up display on a 2D canvas: tachometer with redline, speed in mph, gear, clutch indicator,
// and the lap timer. Kept to the top of the screen so thumbs never cover it.

export function formatTime(t) {
  if (t == null || !Number.isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // state: { rpm, redline, limiter, speedMph, gear, coupling, showClutch, running, lapTime, bestTime }
  draw(state) {
    const g = this.ctx;
    const { w, h } = this;
    g.clearRect(0, 0, w, h);
    if (!state) return;
    const u = Math.min(h / 100, w / 160); // layout unit

    // ---- Tachometer, top right ----
    const R = 15 * u;
    const cx = w - R - 4 * u - 4;
    const cy = R + 3 * u + 4;
    const maxRpm = 8000;
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    const ang = (rpm) => a0 + (a1 - a0) * Math.min(1, Math.max(0, rpm) / maxRpm);
    g.fillStyle = 'rgba(8,10,18,0.55)';
    g.beginPath();
    g.arc(cx, cy, R + 2 * u, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 1.6 * u;
    g.strokeStyle = '#d62828';
    g.beginPath();
    g.arc(cx, cy, R - 0.8 * u, ang(state.redline), ang(maxRpm));
    g.stroke();
    g.fillStyle = '#e8ecf3';
    g.font = `600 ${2.6 * u}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let k = 0; k <= 8; k++) {
      const a = ang(k * 1000);
      g.strokeStyle = '#e8ecf3';
      g.lineWidth = 0.5 * u;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      g.lineTo(cx + Math.cos(a) * (R - 2.2 * u), cy + Math.sin(a) * (R - 2.2 * u));
      g.stroke();
      g.fillText(String(k), cx + Math.cos(a) * (R - 4.6 * u), cy + Math.sin(a) * (R - 4.6 * u));
    }
    const na = ang(state.rpm);
    g.strokeStyle = state.rpm > state.redline ? '#ffcf3a' : '#ff5a36';
    g.lineWidth = 0.9 * u;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(na) * (R - 1.2 * u), cy + Math.sin(na) * (R - 1.2 * u));
    g.stroke();
    // Gear in the middle of the dial, speed below it.
    g.fillStyle = '#ffb000';
    g.font = `800 ${7 * u}px system-ui, sans-serif`;
    g.fillText(state.gear, cx, cy + 2 * u);
    g.fillStyle = '#e8ecf3';
    g.font = `800 ${5 * u}px system-ui, sans-serif`;
    g.textAlign = 'right';
    g.fillText(String(Math.round(Math.abs(state.speedMph))), cx - R - 4 * u, cy + 1 * u);
    g.font = `600 ${2.4 * u}px system-ui, sans-serif`;
    g.fillStyle = '#9aa6bd';
    g.fillText('MPH', cx - R - 4 * u, cy + 5 * u);
    g.textAlign = 'center';
    g.fillText(`${Math.round(state.rpm / 10) * 10} RPM`, cx, cy + R - 2 * u);

    // ---- Clutch indicator under the dial ----
    if (state.showClutch) {
      const bw = 18 * u;
      const bx = cx - bw / 2;
      const by = cy + R + 3.2 * u;
      g.fillStyle = 'rgba(8,10,18,0.6)';
      g.fillRect(bx, by, bw, 1.6 * u);
      const c = state.coupling;
      g.fillStyle = c > 0.97 ? '#3ccf6e' : c < 0.03 ? '#ff4d4d' : '#ffd36b';
      g.fillRect(bx, by, bw * c, 1.6 * u);
      g.fillStyle = '#9aa6bd';
      g.font = `600 ${2.1 * u}px system-ui, sans-serif`;
      g.fillText(c < 0.03 ? 'CLUTCH IN' : c > 0.97 ? 'CLUTCH OUT' : 'CLUTCH SLIP', cx, by + 4 * u);
    }

    // ---- Timer, top left ----
    g.textAlign = 'left';
    g.fillStyle = '#9aa6bd';
    g.font = `600 ${2.4 * u}px system-ui, sans-serif`;
    g.fillText('TIME', 4 * u + 6, 4 * u);
    g.fillStyle = '#e8ecf3';
    g.font = `800 ${5 * u}px ui-monospace, Menlo, monospace`;
    g.fillText(formatTime(state.lapTime), 4 * u + 6, 8.5 * u);
    if (state.bestTime != null) {
      g.fillStyle = '#9aa6bd';
      g.font = `600 ${2.4 * u}px system-ui, sans-serif`;
      g.fillText(`BEST ${formatTime(state.bestTime)}`, 4 * u + 6, 12.5 * u);
    }

    // ---- Engine state ----
    if (!state.running) {
      g.textAlign = 'center';
      g.fillStyle = '#ff4d4d';
      g.font = `800 ${4.5 * u}px system-ui, sans-serif`;
      g.fillText('STALLED', w / 2, h * 0.22);
      g.fillStyle = '#e8ecf3';
      g.font = `600 ${2.6 * u}px system-ui, sans-serif`;
      g.fillText(state.needClutchToStart ? 'Press the clutch (or select neutral), then START' : 'Tap START', w / 2, h * 0.22 + 5 * u);
    }
  }
}
