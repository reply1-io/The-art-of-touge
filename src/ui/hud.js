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

  // state: { rpm, redline, speedMph, gear, running, needClutchToStart, lapTime, bestTime }
  draw(state) {
    const g = this.ctx;
    const { w, h } = this;
    g.clearRect(0, 0, w, h);
    if (!state) return;
    const u = Math.min(h / 100, w / 170); // layout unit

    // ---- Half-moon tachometer, bottom centre (1-7 x1000 rpm, red past the redline) ----
    const R = 17 * u;
    const cx = w / 2;
    const cy = h - 7 * u;
    const maxRpm = 7500;
    const a0 = Math.PI * 1.02;
    const a1 = Math.PI * 1.98;
    const ang = (rpm) => a0 + (a1 - a0) * Math.min(1, Math.max(0, rpm) / maxRpm);
    g.lineCap = 'butt';
    // Shadowed arc.
    g.lineWidth = 2.2 * u;
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.beginPath();
    g.arc(cx, cy, R, a0, a1);
    g.stroke();
    g.lineWidth = 1.2 * u;
    g.strokeStyle = '#ff8a1c';
    g.beginPath();
    g.arc(cx, cy, R, a0, ang(state.redline));
    g.stroke();
    g.lineWidth = 2.2 * u;
    g.strokeStyle = '#e0251b';
    g.beginPath();
    g.arc(cx, cy, R, ang(state.redline), a1);
    g.stroke();
    // Numbers.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 ${3.6 * u}px system-ui, sans-serif`;
    g.lineWidth = 0.5 * u;
    for (let k = 1; k <= 7; k++) {
      const a = ang(k * 1000);
      const x = cx + Math.cos(a) * (R - 3.6 * u);
      const y = cy + Math.sin(a) * (R - 3.6 * u);
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.strokeText(String(k), x, y);
      g.fillStyle = k * 1000 >= state.redline ? '#ff4d3d' : '#ff8a1c';
      g.fillText(String(k), x, y);
    }
    // Needle.
    const na = ang(state.rpm);
    g.lineCap = 'round';
    g.lineWidth = 1.1 * u;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.beginPath();
    g.moveTo(cx + Math.cos(na) * R * 0.45, cy + Math.sin(na) * R * 0.45);
    g.lineTo(cx + Math.cos(na) * (R + 1.2 * u), cy + Math.sin(na) * (R + 1.2 * u));
    g.stroke();
    g.lineWidth = 0.6 * u;
    g.strokeStyle = state.rpm > state.redline ? '#ffe14a' : '#ffffff';
    g.stroke();
    // Speed.
    g.font = `900 ${10 * u}px system-ui, sans-serif`;
    g.lineWidth = 0.8 * u;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    const mph = String(Math.round(Math.abs(state.speedMph)));
    g.strokeText(mph, cx, cy - 4.5 * u);
    g.fillStyle = '#ff8a1c';
    g.fillText(mph, cx, cy - 4.5 * u);
    g.font = `800 ${2.8 * u}px system-ui, sans-serif`;
    g.strokeText('MPH', cx, cy + 2.2 * u);
    g.fillStyle = '#ffffff';
    g.fillText('MPH', cx, cy + 2.2 * u);

    // ---- Timer, top right ----
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.font = `700 ${2.6 * u}px system-ui, sans-serif`;
    g.lineWidth = 0.5 * u;
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.strokeText('TIME', w - 4 * u, 5 * u);
    g.fillStyle = '#dfe6f2';
    g.fillText('TIME', w - 4 * u, 5 * u);
    g.font = `800 ${5 * u}px ui-monospace, Menlo, monospace`;
    g.strokeText(formatTime(state.lapTime), w - 4 * u, 10.5 * u);
    g.fillStyle = '#ffffff';
    g.fillText(formatTime(state.lapTime), w - 4 * u, 10.5 * u);
    if (state.bestTime != null) {
      g.font = `700 ${2.6 * u}px system-ui, sans-serif`;
      g.fillStyle = '#dfe6f2';
      g.fillText(`BEST ${formatTime(state.bestTime)}`, w - 4 * u, 14.5 * u);
    }
    // Gear for the automatic (the H-shifter shows it in the manual modes).
    if (state.showGear) {
      g.textAlign = 'center';
      g.font = `900 ${5 * u}px system-ui, sans-serif`;
      g.strokeText(state.gear, cx + R + 8 * u, cy - 2 * u);
      g.fillStyle = '#2bd15a';
      g.fillText(state.gear, cx + R + 8 * u, cy - 2 * u);
    }

    // ---- Engine state ----
    if (!state.running) {
      g.textAlign = 'center';
      g.font = `900 ${5 * u}px system-ui, sans-serif`;
      g.strokeText('STALLED', w / 2, h * 0.22);
      g.fillStyle = '#ff4d3d';
      g.fillText('STALLED', w / 2, h * 0.22);
      g.font = `700 ${2.8 * u}px system-ui, sans-serif`;
      g.fillStyle = '#ffffff';
      g.fillText(state.needClutchToStart ? 'Hold CLUTCH (or go to neutral), then START' : 'Tap START', w / 2, h * 0.22 + 5 * u);
    }
  }
}
