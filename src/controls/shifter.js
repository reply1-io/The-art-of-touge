// On-screen H-pattern shifter. You drag the knob through the gate like a real lever:
// along the neutral rail left/right, and up or down only where a gear slot is.
//
//   1   3   5
//   |   |   |
//   +---N---+       (neutral rail)
//   |   |   |
//   2   4   R
//
// Gate coordinates: columns x = 0..2, y = -1 (up) .. 0 (rail) .. +1 (down).

const SLOTS = {
  '0,-1': 1,
  '0,1': 2,
  '1,-1': 3,
  '1,1': 4,
  '2,-1': 5,
  '2,1': -1, // reverse, bottom right
};
const COLS = 2; // highest column index
const GEAR_POS = { [-1]: [2, 1], 0: [1, 0], 1: [0, -1], 2: [0, 1], 3: [1, -1], 4: [1, 1], 5: [2, -1] };
const ENGAGE = 0.6; // how far into a slot the knob must go before the gear is selected
const SNAP = 0.5; // how close to a column the knob must be to enter it

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Shifter {
  // onGear(gear) -> boolean: ask the gearbox for a gear (0 = neutral); false means it grinds.
  constructor(root, onGear) {
    this.root = root;
    this.canvas = root.querySelector('#shifter-gate');
    this.knob = root.querySelector('#shifter-knob');
    this.onGear = onGear;
    this.pos = [1.5, 0];
    this.gear = 0;
    this.pointer = null;
    this.blocked = 0; // slot direction that just grinded; must pull back before trying again
    this.mode = 'drag'; // 'drag': move the knob through the gate; 'tap': touch a gear to select it
    root.addEventListener('pointerdown', (e) => this.#down(e));
    root.addEventListener('pointermove', (e) => this.#move(e));
    root.addEventListener('pointerup', (e) => this.#up(e));
    root.addEventListener('pointercancel', (e) => this.#up(e));
    new ResizeObserver(() => this.#draw()).observe(root);
  }

  // Map between gate units and pixels inside the shifter box.
  #toPx([x, y]) {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    return [w * (0.18 + (x / COLS) * 0.64), h * (0.5 + y * 0.25)];
  }

  #fromPx(px, py) {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    return [((px / w - 0.18) / 0.64) * COLS, (py / h - 0.5) / 0.25];
  }

  #draw() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = this.root.clientWidth * dpr;
    c.height = this.root.clientHeight * dpr;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.lineCap = 'square';
    const lw = Math.max(5, this.root.clientWidth * 0.045);
    const line = (a, b) => {
      const [x0, y0] = this.#toPx(a);
      const [x1, y1] = this.#toPx(b);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    };
    // Dark outline first, then the white gate, so it reads on any background.
    for (const [style, width] of [
      ['rgba(0,0,0,0.6)', lw + 4],
      ['rgba(255,255,255,0.9)', lw],
    ]) {
      g.strokeStyle = style;
      g.lineWidth = width;
      line([0, 0], [COLS, 0]);
      for (const key of Object.keys(SLOTS)) {
        const [x, y] = key.split(',').map(Number);
        line([x, 0], [x, y]);
      }
    }
    g.font = `${Math.max(18, this.root.clientWidth * 0.17)}px 'VT323', ui-monospace, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const rad = Math.min(this.root.clientWidth * 0.13, this.root.clientHeight * 0.11);
    for (const [key, gear] of Object.entries(SLOTS)) {
      const [x, y] = key.split(',').map(Number);
      const [px, py] = this.#toPx([x, y * 1.62]);
      const label = gear === -1 ? 'R' : String(gear);
      const on = gear === this.gear;
      const color = on ? '#39ff7a' : gear === -1 ? '#ff6b6b' : '#ffffff';
      if (this.mode === 'tap') {
        // Each gear is a square pixel button.
        g.fillStyle = on ? color : 'rgba(0,0,0,0.45)';
        g.fillRect(Math.round(px - rad), Math.round(py - rad), Math.round(rad * 2), Math.round(rad * 2));
        g.lineWidth = 3;
        g.strokeStyle = color;
        g.strokeRect(Math.round(px - rad), Math.round(py - rad), Math.round(rad * 2), Math.round(rad * 2));
      }
      g.fillStyle = '#000';
      g.fillText(label, px + 2, py + 3);
      g.fillStyle = on && this.mode === 'tap' ? '#000' : color;
      g.fillText(label, px, py + 1);
    }
    g.shadowBlur = 0;
    this.#placeKnob();
  }

  #placeKnob() {
    const [px, py] = this.#toPx(this.pos);
    this.knob.style.left = `${px}px`;
    this.knob.style.top = `${py}px`;
  }

  // Put the knob where a gear is (after a reset or a keyboard shift).
  setGear(gear) {
    this.gear = gear;
    this.pos = [...(GEAR_POS[gear] || GEAR_POS[0])];
    this.#draw();
  }

  setMode(mode) {
    this.mode = mode;
    this.#draw();
  }

  // Tap mode: the gear nearest the touch (or neutral in the middle) is requested straight away.
  #tap(e) {
    const r = this.root.getBoundingClientRect();
    const [gx, gy] = this.#fromPx(e.clientX - r.left, e.clientY - r.top);
    let target = null;
    if (Math.abs(gy) < 0.45) target = 0;
    else {
      const col = Math.round(clamp(gx, 0, COLS));
      const slot = SLOTS[`${col},${Math.sign(gy)}`];
      if (slot !== undefined && Math.abs(gx - col) < 0.5) target = slot;
    }
    if (target === null || target === this.gear) return;
    if (this.onGear(target)) {
      this.setGear(target);
    } else {
      // Grind: the lever jumps toward the slot and bounces back.
      const [x, y] = GEAR_POS[target];
      this.pos = [x, y * 0.5];
      this.#placeKnob();
      setTimeout(() => this.setGear(this.gear), 180);
    }
  }

  #down(e) {
    if (this.mode === 'tap') {
      e.preventDefault();
      this.#tap(e);
      return;
    }
    if (this.pointer !== null) return;
    this.pointer = e.pointerId;
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers cannot be captured; moves still arrive while over the shifter.
    }
    const r = this.root.getBoundingClientRect();
    // Grab the knob where it is: track the finger relative to where it touched down.
    const touch = this.#fromPx(e.clientX - r.left, e.clientY - r.top);
    this.grabOffset = [this.pos[0] - touch[0], this.pos[1] - touch[1]];
    e.preventDefault();
  }

  #move(e) {
    if (e.pointerId !== this.pointer) return;
    const r = this.root.getBoundingClientRect();
    const f = this.#fromPx(e.clientX - r.left, e.clientY - r.top);
    this.#follow([f[0] + this.grabOffset[0], f[1] + this.grabOffset[1]]);
  }

  #up(e) {
    if (e.pointerId !== this.pointer) return;
    this.pointer = null;
    this.blocked = 0;
    // Not fully in a gear: the lever springs back to the neutral rail.
    if (Math.abs(this.pos[1]) < ENGAGE) {
      this.pos[1] = 0;
      this.#placeKnob();
    }
  }

  #follow([tx, ty]) {
    let [x, y] = this.pos;
    if (Math.abs(y) < 0.1) {
      // On the neutral rail: slide sideways, or drop into a slot if close to a column.
      const col = Math.round(clamp(tx, 0, COLS));
      const dir = Math.sign(ty);
      if (Math.abs(ty) > 0.25 && Math.abs(tx - col) < SNAP && SLOTS[`${col},${dir}`] !== undefined) {
        x = col;
        y = ty;
      } else {
        x = clamp(tx, 0, COLS);
        y = 0;
      }
    } else {
      // In a column: only up and down, and straight through neutral to the opposite slot if there is one.
      // Pulling back near the rail drops the knob onto it, so you can sweep across to another column.
      const up = SLOTS[`${x},-1`] !== undefined ? -1 : 0;
      const down = SLOTS[`${x},1`] !== undefined ? 1 : 0;
      y = clamp(ty, up, down);
      if (Math.abs(ty) < 0.3 && Math.abs(tx - x) > 0.25) {
        x = clamp(tx, 0, COLS);
        y = 0;
      }
    }
    // A grinding gear pushes the lever back until the finger eases off (or the lever is back on the rail).
    if (Math.abs(y) < 0.1) this.blocked = 0;
    if (this.blocked && Math.sign(y) === this.blocked) {
      if (Math.abs(ty) < 0.5) this.blocked = 0;
      else y = this.blocked * 0.55;
    }
    this.pos = [x, y];

    const slot = Math.abs(y) >= ENGAGE ? SLOTS[`${x},${Math.sign(y)}`] : undefined;
    if (slot !== undefined && slot !== this.gear) {
      if (this.onGear(slot)) {
        this.gear = slot;
        this.pos[1] = Math.sign(y);
        this.#draw();
      } else {
        this.blocked = Math.sign(y);
        this.pos[1] = Math.sign(y) * 0.55;
      }
    } else if (slot === undefined && this.gear !== 0) {
      this.onGear(0);
      this.gear = 0;
      this.#draw();
    }
    this.#placeKnob();
  }
}
