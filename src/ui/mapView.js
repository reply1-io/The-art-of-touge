// A top-down map of the mountain for the menus, drawn like a road map: olive hills with shading,
// dots of cedar and maple, blue lakes, the road, and each road's name in yellow along it. A red pin
// marks where you are. Tap a road (or its name) to pick it.

const PAD = 110; // metres of land shown around the road
const LABEL = 13; // road name size (CSS pixels)

export class MapView {
  // canvas: the <canvas> to draw in. mountain: the built Mountain. onPick(stageIndex) on a tap.
  constructor(canvas, mountain, onPick) {
    this.canvas = canvas;
    this.mountain = mountain;
    this.onPick = onPick;
    this.road = mountain.road;
    this.track = mountain.track;
    this.stages = this.track.stages || [];
    this.selected = -1;
    this.pin = null; // [x, z] in world metres
    this.base = null;
    this.labels = []; // { k, x, y, w, h } in canvas pixels
    const r = this.road;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < r.count; i++) {
      x0 = Math.min(x0, r.x[i]);
      x1 = Math.max(x1, r.x[i]);
      z0 = Math.min(z0, r.z[i]);
      z1 = Math.max(z1, r.z[i]);
    }
    this.bounds = { x0: x0 - PAD, x1: x1 + PAD, z0: z0 - PAD, z1: z1 + PAD };
    let down = null;
    canvas.addEventListener('pointerdown', (e) => {
      down = [e.clientX, e.clientY];
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 12) return;
      down = null;
      const k = this.hit(e);
      if (k >= 0) this.onPick?.(k);
    });
  }

  // World metres to canvas pixels, keeping the map's shape and centring it.
  #fit() {
    const { x0, x1, z0, z1 } = this.bounds;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const scale = Math.min(w / (x1 - x0), h / (z1 - z0));
    const ox = (w - (x1 - x0) * scale) / 2;
    const oy = (h - (z1 - z0) * scale) / 2;
    this.scale = scale;
    this.toPx = (x, z) => [ox + (x - x0) * scale, oy + (z - z0) * scale];
    this.toWorld = (px, py) => [x0 + (px - ox) / scale, z0 + (py - oy) / scale];
  }

  // Size the canvas to how big it is on screen; redraw the map if that changed.
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 10) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (this.base && this.canvas.width === w && this.canvas.height === h) return true;
    this.canvas.width = w;
    this.canvas.height = h;
    this.dpr = dpr;
    this.#fit();
    this.#drawBase();
    return true;
  }

  // Which road a pointer event is on, or -1.
  hit(e) {
    const rect = this.canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
    const py = ((e.clientY - rect.top) / rect.height) * this.canvas.height;
    for (const l of this.labels) if (px >= l.x - 6 && px <= l.x + l.w + 6 && py >= l.y - 6 && py <= l.y + l.h + 6) return l.k;
    const r = this.road;
    let best = -1;
    let bestD = 22 * this.dpr;
    for (let i = 0; i < r.count; i += 2) {
      const [x, y] = this.toPx(r.x[i], r.z[i]);
      const d = Math.hypot(x - px, y - py);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best < 0 ? -1 : this.track.stageAt(best * 2);
  }

  #drawBase() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const t = this.mountain.terrain;
    const r = this.road;
    const dpr = this.dpr;

    // Land: olive green, lit from the north-west, a little lighter up high.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < r.count; i += 10) {
      lo = Math.min(lo, r.y[i]);
      hi = Math.max(hi, r.y[i]);
    }
    const cell = Math.max(2, Math.round(3 * dpr));
    const d = 6 / this.scale + 4;
    for (let py = 0; py < H; py += cell) {
      for (let px = 0; px < W; px += cell) {
        const [x, z] = this.toWorld(px + cell / 2, py + cell / 2);
        const y = t.heightAt(x, z);
        const sx = t.heightAt(x + d, z) - t.heightAt(x - d, z);
        const sz = t.heightAt(x, z + d) - t.heightAt(x, z - d);
        const shade = Math.max(-0.45, Math.min(0.45, (-sx - sz) / (4 * d)));
        const up = Math.max(0, Math.min(1, (y - lo) / Math.max(1, hi - lo)));
        const k = 1 + shade * 0.9 + up * 0.12;
        g.fillStyle = `rgb(${Math.round(112 * k)},${Math.round(124 * k)},${Math.round(58 * k)})`;
        g.fillRect(px, py, cell, cell);
      }
    }

    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    // Lakes and ponds: an uneven shoreline, a sandy rim, deeper blue in the middle and a glint.
    for (const lk of t.lakes || []) {
      const [x, y] = this.toPx(lk.x, lk.z);
      const rad = Math.max(3 * dpr, lk.r * this.scale);
      const ph = rnd() * 6;
      const shore = (grow) => {
        g.beginPath();
        for (let a = 0; a <= 24; a++) {
          const th = (a / 24) * Math.PI * 2;
          const k = 1 + 0.12 * Math.sin(th * 3 + ph) + 0.07 * Math.sin(th * 5 + ph * 2);
          const px = x + Math.cos(th) * (rad * k + grow);
          const py = y + Math.sin(th) * (rad * k * 0.92 + grow);
          if (a) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.closePath();
      };
      shore(1.6 * dpr);
      g.fillStyle = '#b5ad74';
      g.fill();
      shore(0);
      const grad = g.createRadialGradient(x - rad * 0.2, y - rad * 0.2, rad * 0.1, x, y, rad);
      grad.addColorStop(0, '#2c5f9a');
      grad.addColorStop(1, '#4f93cf');
      g.fillStyle = grad;
      g.fill();
      if (rad > 6 * dpr) {
        g.strokeStyle = 'rgba(230, 245, 255, 0.55)';
        g.lineWidth = 1 * dpr;
        g.beginPath();
        g.arc(x - rad * 0.25, y - rad * 0.3, rad * 0.35, Math.PI * 1.1, Math.PI * 1.6);
        g.stroke();
      }
    }

    // Trees seen from above: round crowns with a shadow on one side and light on the other.
    const crowns = [];
    const spots = Math.round((W * H) / (26 * dpr * dpr));
    for (let n = 0; n < spots; n++) {
      const px = rnd() * W;
      const py = rnd() * H;
      const [x, z] = this.toWorld(px, py);
      if (t.inLake?.(x, z, 8)) continue;
      // Woods in patches with clearings between.
      const patch = Math.sin(x / 70) * Math.cos(z / 55) + Math.sin((x + z) / 130) + 0.5 * Math.sin(x / 33 - z / 41);
      if (patch < -0.35 + rnd() * 0.7) continue;
      crowns.push([px, py, (1.3 + rnd() * 1.5) * dpr, rnd() < 0.07 ? 1 : 0, rnd()]);
    }
    // Trees by the road: a share of the real ones, maples in orange.
    for (const [x, z, maple] of this.mountain.mapTrees || []) {
      const [px, py] = this.toPx(x, z);
      crowns.push([px, py, 1.2 * dpr, maple, rnd()]);
    }
    crowns.sort((p, q) => p[1] - q[1]);
    const shades = [
      ['#1d2f12', '#2e4a1c', '#4f7330'],
      ['#6e2a0c', '#d8641f', '#f3a04a'],
    ];
    for (const [px, py, cr, maple, tone] of crowns) {
      const [shadow, body, light] = shades[maple];
      g.fillStyle = shadow;
      g.beginPath();
      g.arc(px + cr * 0.35, py + cr * 0.35, cr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = maple ? body : tone < 0.5 ? body : '#36541f';
      g.beginPath();
      g.arc(px, py, cr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = light;
      g.beginPath();
      g.arc(px - cr * 0.35, py - cr * 0.35, cr * 0.4, 0, Math.PI * 2);
      g.fill();
    }

    // The road: a dark edge with a pale line on top.
    const path = (ctx, i0, i1) => {
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const [x, y] = this.toPx(r.x[i], r.z[i]);
        if (i === i0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };
    g.lineJoin = 'round';
    g.lineCap = 'round';
    path(g, 0, r.count - 1);
    g.strokeStyle = 'rgba(20, 20, 18, 0.85)';
    g.lineWidth = 4.5 * dpr;
    g.stroke();
    g.strokeStyle = '#e9e4d2';
    g.lineWidth = 2 * dpr;
    g.stroke();
    this.path = path;

    // Landmarks: the summit meet and the village.
    this.marks = [];
    const mark = (i, text, above = false) => {
      const [x, y] = this.toPx(r.x[i], r.z[i]);
      g.font = `${Math.round(13 * dpr)}px VT323, ui-monospace, monospace`;
      const w = g.measureText(text).width;
      const ty = above ? y - 6 * dpr : y + 15 * dpr;
      this.marks.push({ k: -1, x: x - w / 2, y: ty - 13 * dpr, w, h: 16 * dpr });
      g.fillStyle = '#fff';
      g.strokeStyle = '#111';
      g.lineWidth = 3 * dpr;
      g.font = `${Math.round(13 * dpr)}px VT323, ui-monospace, monospace`;
      g.textAlign = 'center';
      g.strokeText(text, x, ty);
      g.fillText(text, x, ty);
    };
    mark(0, '▲ CAR MEET');
    mark(r.count - 1, 'VILLAGE', true);
    this.baseImage = c;
    this.base = true;
    this.#placeLabels();
  }

  // Each road's name near the middle of it, moved along the road until it overlaps nothing.
  #placeLabels() {
    const g = this.canvas.getContext('2d');
    const r = this.road;
    const dpr = this.dpr;
    const size = Math.round(LABEL * dpr);
    g.font = `${size}px VT323, ui-monospace, monospace`;
    this.labels = [];
    const W = this.canvas.width;
    const H = this.canvas.height;
    const overlaps = (a) => [...this.labels, ...this.marks].some((b) => a.x < b.x + b.w + 4 && a.x + a.w + 4 > b.x && a.y < b.y + b.h + 2 && a.y + a.h + 2 > b.y);
    this.stages.forEach((st, k) => {
      const w = g.measureText(st.name).width;
      const h = size * 0.8;
      let place = null;
      // Try spots along the road from the middle outward: above it, below it, then beside it.
      const fracs = [];
      for (let f = 0; f <= 0.45; f += 0.05) fracs.push(0.5 - f, 0.5 + f);
      for (const f of fracs) {
        const i = Math.round((st.s0 + (st.s1 - st.s0) * f) / 2);
        const [x, y] = this.toPx(r.x[Math.min(r.count - 1, i)], r.z[Math.min(r.count - 1, i)]);
        for (const [dx, dy] of [[-w / 2, -h - 5 * dpr], [-w / 2, 5 * dpr], [6 * dpr, -h / 2], [-w - 6 * dpr, -h / 2]]) {
          const a = { k, x: Math.max(2, Math.min(W - w - 2, x + dx)), y: Math.max(2, Math.min(H - h - 2, y + dy)), w, h };
          if (!overlaps(a)) {
            place = a;
            break;
          }
        }
        if (place) break;
      }
      if (!place) {
        const i = Math.round((st.s0 + st.s1) / 4);
        const [x, y] = this.toPx(r.x[i], r.z[i]);
        place = { k, x: x - w / 2, y: y - h - 6 * dpr, w, h };
      }
      this.labels.push(place);
    });
  }

  draw() {
    if (!this.resize()) return;
    const g = this.canvas.getContext('2d');
    const dpr = this.dpr;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.baseImage, 0, 0);
    // The picked road, highlighted.
    const st = this.stages[this.selected];
    if (st) {
      this.path(g, Math.round(st.s0 / 2), Math.min(this.road.count - 1, Math.round(st.s1 / 2)));
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 2.6 * dpr;
      g.stroke();
    }
    // Names in yellow with a dark outline.
    g.font = `${Math.round(LABEL * dpr)}px VT323, ui-monospace, monospace`;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    for (const l of this.labels) {
      const name = this.stages[l.k].name;
      g.lineWidth = 3.5 * dpr;
      g.strokeStyle = 'rgba(10, 10, 10, 0.9)';
      g.strokeText(name, l.x, l.y);
      g.fillStyle = l.k === this.selected ? '#fff6c2' : '#ffd23f';
      g.fillText(name, l.x, l.y);
    }
    g.textBaseline = 'alphabetic';
    // The red pin.
    if (this.pin) {
      const [x, y] = this.toPx(this.pin[0], this.pin[1]);
      const s = 7 * dpr;
      g.fillStyle = '#e5281e';
      g.strokeStyle = '#3a0805';
      g.lineWidth = 1.5 * dpr;
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x - s * 0.3, y - s * 0.9, x - s, y - s * 1.3, x - s, y - s * 2);
      g.arc(x, y - s * 2, s, Math.PI, 0);
      g.bezierCurveTo(x + s, y - s * 1.3, x + s * 0.3, y - s * 0.9, x, y);
      g.fill();
      g.stroke();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(x, y - s * 2, s * 0.38, 0, Math.PI * 2);
      g.fill();
    }
  }
}
