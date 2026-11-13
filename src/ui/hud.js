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

  // The HUD is drawn at half resolution and scaled up with hard edges, to match the pixelated game.
  resize() {
    const scale = 0.5;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.ceil(this.w * scale);
    this.canvas.height = Math.ceil(this.h * scale);
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  // state: { rpm, redline, speedMph, gear, running, needClutchToStart, lapTime, bestTime }
  draw(state) {
    const g = this.ctx;
    const { w, h } = this;
    g.clearRect(0, 0, w, h);
    if (!state) return;
    const u = Math.min(h / 100, w / 170); // layout unit

    // ---- Half-moon tachometer, bottom centre: a 90s backlit dial ----
    // Black face; numbers, ticks, needle and the speed readout glow orange like an instrument
    // cluster lit from behind. Past the redline the markings glow red.
    const R = 17 * u;
    const cx = w / 2;
    const cy = h - 7 * u;
    const maxRpm = 7500;
    const a0 = Math.PI * 1.02;
    const a1 = Math.PI * 1.98;
    const ang = (rpm) => a0 + (a1 - a0) * Math.min(1, Math.max(0, rpm) / maxRpm);
    const ORANGE = '#ff8c1a';
    const GLOW = 'rgba(255,140,26,0.95)';
    const RED = '#ff3a24';
    const glow = (color, blur) => {
      g.shadowColor = color;
      g.shadowBlur = blur * u;
    };
    // Dial face.
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(6,6,8,0.82)';
    g.beginPath();
    g.arc(cx, cy, R + 3.2 * u, Math.PI, 2 * Math.PI);
    g.lineTo(cx + R + 3.2 * u, cy + 3.5 * u);
    g.lineTo(cx - R - 3.2 * u, cy + 3.5 * u);
    g.closePath();
    g.fill();
    g.strokeStyle = '#2a2a2e';
    g.lineWidth = 0.6 * u;
    g.stroke();
    // Tick marks every 500 rpm, long ones on the thousands.
    g.lineCap = 'butt';
    for (let k = 0; k <= 15; k++) {
      const rpm = k * 500;
      const a = ang(rpm);
      const long = k % 2 === 0;
      const red = rpm >= state.redline;
      glow(red ? RED : GLOW, 1.6);
      g.strokeStyle = red ? RED : ORANGE;
      g.lineWidth = (long ? 0.7 : 0.4) * u;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      g.lineTo(cx + Math.cos(a) * (R - (long ? 2.4 : 1.4) * u), cy + Math.sin(a) * (R - (long ? 2.4 : 1.4) * u));
      g.stroke();
    }
    // Redline band.
    glow(RED, 2);
    g.strokeStyle = RED;
    g.lineWidth = 1.2 * u;
    g.beginPath();
    g.arc(cx, cy, R + 0.8 * u, ang(state.redline), a1);
    g.stroke();
    // Numbers.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 ${6 * u}px 'VT323', ui-monospace, monospace`;
    for (let k = 1; k <= 7; k++) {
      const a = ang(k * 1000);
      const red = k * 1000 >= state.redline;
      glow(red ? RED : GLOW, 1.8);
      g.fillStyle = red ? RED : ORANGE;
      g.fillText(String(k), cx + Math.cos(a) * (R - 5 * u), cy + Math.sin(a) * (R - 5 * u));
    }
    // Needle: glowing orange-red, with a dark hub.
    const na = ang(state.rpm);
    glow('rgba(255,90,20,0.95)', 2.2);
    g.lineCap = 'round';
    g.strokeStyle = '#ff5a14';
    g.lineWidth = 0.9 * u;
    g.beginPath();
    g.moveTo(cx + Math.cos(na) * R * 0.3, cy + Math.sin(na) * R * 0.3);
    g.lineTo(cx + Math.cos(na) * (R - 0.4 * u), cy + Math.sin(na) * (R - 0.4 * u));
    g.stroke();
    // Speed readout, glowing like a 90s digital display.
    glow(GLOW, 3);
    g.font = `900 ${12 * u}px 'VT323', ui-monospace, monospace`;
    g.fillStyle = ORANGE;
    g.fillText(String(Math.round(Math.abs(state.speedMph))), cx, cy - 3.5 * u);
    glow(GLOW, 1.4);
    g.font = `800 ${3.6 * u}px 'VT323', ui-monospace, monospace`;
    g.fillText('MPH', cx, cy + 2.2 * u);
    g.shadowBlur = 0;
    g.lineWidth = 0.5 * u;
    g.strokeStyle = 'rgba(0,0,0,0.7)';

    // ---- Timer, top right ----
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.font = `700 ${4 * u}px 'VT323', ui-monospace, monospace`;
    g.lineWidth = 0.5 * u;
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.strokeText('TIME', w - 4 * u, 5 * u);
    g.fillStyle = '#dfe6f2';
    g.fillText('TIME', w - 4 * u, 5 * u);
    g.font = `800 ${7 * u}px 'VT323', ui-monospace, monospace`;
    g.strokeText(formatTime(state.lapTime), w - 4 * u, 10.5 * u);
    g.fillStyle = '#ffffff';
    g.fillText(formatTime(state.lapTime), w - 4 * u, 10.5 * u);
    if (state.bestTime != null) {
      g.font = `700 ${4 * u}px 'VT323', ui-monospace, monospace`;
      g.fillStyle = '#dfe6f2';
      g.fillText(`BEST ${formatTime(state.bestTime)}`, w - 4 * u, 14.5 * u);
    }
    // Gear for the automatic (the H-shifter shows it in the manual modes).
    if (state.showGear) {
      g.textAlign = 'center';
      g.font = `900 ${7 * u}px 'VT323', ui-monospace, monospace`;
      g.strokeText(state.gear, cx + R + 8 * u, cy - 2 * u);
      g.fillStyle = '#2bd15a';
      g.fillText(state.gear, cx + R + 8 * u, cy - 2 * u);
    }

    // ---- Turbo boost: a segmented bar under the timer that lights up as boost builds ----
    if (state.boost != null) {
      const segs = 10;
      const sw = 2.2 * u;
      const gap = 0.6 * u;
      // Top centre, under the drift total.
      const right = w / 2 + (segs * (sw + gap)) / 2 + 4 * u;
      const top = 15 * u;
      const lit = Math.round(Math.max(0, Math.min(1, state.boost)) * segs);
      g.textAlign = 'right';
      g.font = `400 ${3.4 * u}px 'VT323', ui-monospace, monospace`;
      glow(GLOW, 2);
      g.fillStyle = ORANGE;
      g.fillText('BOOST', right - segs * (sw + gap) - 1.2 * u, top + 2.4 * u);
      for (let k = 0; k < segs; k++) {
        const x = right - (segs - k) * (sw + gap) + gap;
        g.shadowBlur = k < lit ? 2 * u : 0;
        g.fillStyle = k < lit ? (k >= 8 ? RED : ORANGE) : 'rgba(255,140,26,0.18)';
        g.fillRect(x, top, sw, 2.6 * u);
      }
      g.shadowBlur = 0;
    }

    // ---- Drift score: the live chain under the PLAY readout, the running total under the timer ----
    if (state.drift) {
      const d = state.drift;
      g.textAlign = 'center';
      glow(GLOW, 2.5);
      // Dark outline first so the numbers read against any scenery, then the glow.
      const say = (text, size, y, color) => {
        g.font = `400 ${size * u}px 'VT323', ui-monospace, monospace`;
        g.shadowBlur = 0;
        g.lineWidth = 0.9 * u;
        g.strokeStyle = 'rgba(0,0,0,0.75)';
        g.strokeText(text, w / 2, y);
        glow(GLOW, 2.5);
        g.fillStyle = color;
        g.fillText(text, w / 2, y);
      };
      if (d.active) {
        say(d.chain.toLocaleString('en-US'), 10, 27 * u, ORANGE);
        say(`DRIFT x${d.mult}   ${Math.round((d.angle * 180) / Math.PI)}°`, 4.6, 32 * u, '#ffd2a0');
      } else if (d.message) {
        say(d.message, 8, 27 * u, d.message === 'CHAIN LOST' ? RED : ORANGE);
      }
      if (d.total > 0) say(`DRIFT ${d.total.toLocaleString('en-US')}`, 4.2, 12.5 * u, ORANGE);
      g.shadowBlur = 0;
    }

    // ---- Race: position and gap to the rival, or time against your best run ----
    if (state.race) {
      const r = state.race;
      g.textAlign = 'right';
      g.shadowBlur = 0;
      const y = (state.bestTime != null ? 20 : 16) * u;
      g.lineWidth = 0.8 * u;
      g.strokeStyle = 'rgba(0,0,0,0.75)';
      if (r.position) {
        g.font = `400 ${8 * u}px 'VT323', ui-monospace, monospace`;
        g.strokeText(r.position, w - 4 * u, y + 4 * u);
        glow(GLOW, 2.5);
        g.fillStyle = r.position === '1ST' ? '#7fe08a' : ORANGE;
        g.fillText(r.position, w - 4 * u, y + 4 * u);
        g.shadowBlur = 0;
        g.font = `400 ${3.8 * u}px 'VT323', ui-monospace, monospace`;
        g.fillStyle = '#dfe6f2';
        g.fillText(`${Math.round(r.gap)} m`, w - 4 * u, y + 8.5 * u);
      }
      if (r.delta != null) {
        const ahead = r.delta < 0;
        const txt = `${ahead ? '-' : '+'}${Math.abs(r.delta).toFixed(2)}`;
        g.font = `400 ${6 * u}px 'VT323', ui-monospace, monospace`;
        g.strokeText(txt, w - 4 * u, y + 3 * u);
        g.fillStyle = ahead ? '#7fe08a' : '#ff6a5a';
        g.fillText(txt, w - 4 * u, y + 3 * u);
      }
    }

    // ---- Engine state ----
    if (!state.running) {
      g.textAlign = 'center';
      g.font = `900 ${7 * u}px 'VT323', ui-monospace, monospace`;
      g.strokeText('STALLED', w / 2, h * 0.22);
      g.fillStyle = '#ff4d3d';
      g.fillText('STALLED', w / 2, h * 0.22);
      g.font = `700 ${4.2 * u}px 'VT323', ui-monospace, monospace`;
      g.fillStyle = '#ffffff';
      g.fillText(state.needClutchToStart ? 'Hold CLUTCH (or go to neutral), then START' : 'Tap START', w / 2, h * 0.22 + 5 * u);
    }
  }
}
