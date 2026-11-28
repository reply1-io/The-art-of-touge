// On-screen sequential shifter: two tap buttons, up and down, one gear at a time:
//
//   R  <-  N  <-  1  ->  2  ->  ...  ->  top gear
//
// Each tap asks the gearbox for the next gear (so a manual still needs the clutch, and reverse only
// goes in near standstill). If it won't go in, the button flashes red for a moment.

export class Shifter {
  // onGear(gear) -> boolean: ask the gearbox for a gear (0 = neutral, -1 = reverse); false means it
  // grinds. topGear() -> the highest gear.
  constructor(root, onGear, topGear = () => 5) {
    this.root = root;
    this.onGear = onGear;
    this.topGear = topGear;
    this.gear = 0;
    this.mode = 'tap';
    this.up = root.querySelector('#shift-up');
    this.down = root.querySelector('#shift-down');
    this.readout = root.querySelector('#shift-gear');
    for (const [btn, dir] of [
      [this.up, 1],
      [this.down, -1],
    ]) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.classList.add('on');
        this.shift(dir, btn);
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, () => btn.classList.remove('on'));
    }
    this.#show();
  }

  // One gear up (+1) or down (-1).
  shift(dir, btn = dir > 0 ? this.up : this.down) {
    const top = this.topGear();
    const next = Math.max(-1, Math.min(top, this.gear + dir));
    if (next === this.gear) return false;
    if (this.onGear(next)) {
      this.setGear(next);
      return true;
    }
    // Grind: the button flashes.
    btn.classList.add('grind');
    setTimeout(() => btn.classList.remove('grind'), 220);
    return false;
  }

  // Show a gear (after a reset or a keyboard shift).
  setGear(gear) {
    this.gear = gear;
    this.#show();
  }

  // (Kept for older settings; the buttons work the same either way.)
  setMode(mode) {
    this.mode = mode;
  }

  #show() {
    if (this.readout) this.readout.textContent = this.gear === -1 ? 'R' : this.gear === 0 ? 'N' : String(this.gear);
  }
}
