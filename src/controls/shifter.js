// On-screen H-pattern shifter. You drag the knob through the gate like a real lever:
// along the neutral rail left/right, and up or down only where a gear slot is.
//
//   R   1   3   5
//   |   |   |   |
//   +---N---+---+     (neutral rail)
//       |   |
//       2   4
//
// Gate coordinates: columns x = 0..3, y = -1 (up) .. 0 (rail) .. +1 (down).

const SLOTS = {
  '0,-1': -1, // reverse, top left
  '1,-1': 1,
  '1,1': 2,
  '2,-1': 3,
  '2,1': 4,
  '3,-1': 5,
};
const GEAR_POS = { [-1]: [0, -1], 0: [1.5, 0], 1: [1, -1], 2: [1, 1], 3: [2, -1], 4: [2, 1], 5: [3, -1] };
const ENGAGE = 0.82; // how far into a slot the knob must go before the gear is selected
const SNAP = 0.32; // how close to a column the knob must be to enter it

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
    return [w * (0.16 + (x / 3) * 0.68), h * (0.5 + y * 0.34)];
  }

  #fromPx(px, py) {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    return [((px / w - 0.16) / 0.68) * 3, (py / h - 0.5) / 0.34];
  }

  #draw() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = this.root.clientWidth * dpr;
    c.height = this.root.clientHeight * dpr;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.lineCap = 'round';
    g.lineWidth = Math.max(10, this.root.clientWidth * 0.09);
    const line = (a, b) => {
      const [x0, y0] = this.#toPx(a);
      const [x1, y1] = this.#toPx(b);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    };
    line([0, 0], [3, 0]);
    for (const key of Object.keys(SLOTS)) {
      const [x, y] = key.split(',').map(Number);
      line([x, 0], [x, y]);
    }
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = `700 ${Math.max(11, this.root.clientWidth * 0.08)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [key, gear] of Object.entries(SLOTS)) {
      const [x, y] = key.split(',').map(Number);
      const [px, py] = this.#toPx([x, y * 1.32]);
      g.fillText(gear === -1 ? 'R' : String(gear), px, py);
    }
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
    this.#placeKnob();
  }

  #down(e) {
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
      const col = Math.round(clamp(tx, 0, 3));
      const dir = Math.sign(ty);
      if (Math.abs(ty) > 0.15 && Math.abs(tx - col) < SNAP && SLOTS[`${col},${dir}`] !== undefined) {
        x = col;
        y = ty;
      } else {
        x = clamp(tx, 0, 3);
        y = 0;
      }
    } else {
      // In a column: only up and down, and straight through neutral to the opposite slot if there is one.
      const up = SLOTS[`${x},-1`] !== undefined ? -1 : 0;
      const down = SLOTS[`${x},1`] !== undefined ? 1 : 0;
      y = clamp(ty, up, down);
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
      } else {
        this.blocked = Math.sign(y);
        this.pos[1] = Math.sign(y) * 0.55;
      }
    } else if (slot === undefined && this.gear !== 0) {
      this.onGear(0);
      this.gear = 0;
    }
    this.#placeKnob();
  }
}
