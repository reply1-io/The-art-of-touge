// Touch controls (primary) and keyboard (desktop testing), merged into one input state.
//
// Touch: drag anywhere in the steering box (relative to where your thumb lands); GAS, BRAKE and
// HANDBRAKE are simple on/off buttons; hold CLUTCH for clutch in.
// Keyboard: arrows or WASD, Space handbrake, Shift clutch, 1-5 gears, R reverse, N neutral,
// E start engine, C camera, Esc pause, Backspace reset, ` tuning panel.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Input {
  constructor(root) {
    this.root = root;
    this.held = new Map(); // pointerId -> button id
    this.keys = new Set();
    this.steerTarget = 0;
    this.steerValue = 0;
    this.steerPointer = null;
    this.steerStart = 0;
    this.events = []; // one-shot actions: { type: 'gear', gear } | { type: 'start' } | ...

    this.steerEl = root.querySelector('#steer');
    this.knobEl = root.querySelector('#steer-knob');
    this.steerEl.addEventListener('pointerdown', (e) => this.#steerDown(e));
    this.steerEl.addEventListener('pointermove', (e) => this.#steerMove(e));
    this.steerEl.addEventListener('pointerup', (e) => this.#steerUp(e));
    this.steerEl.addEventListener('pointercancel', (e) => this.#steerUp(e));

    for (const id of ['gas', 'brake', 'handbrake', 'clutch']) {
      const el = root.querySelector(`#${id}`);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Synthetic pointers cannot be captured.
        }
        this.held.set(e.pointerId, id);
        el.classList.add('on');
      });
      const up = (e) => {
        if (this.held.get(e.pointerId) !== id) return;
        this.held.delete(e.pointerId);
        if (![...this.held.values()].includes(id)) el.classList.remove('on');
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    root.querySelector('#start').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.events.push({ type: 'start' });
    });
    for (const b of root.querySelectorAll('#dr [data-drive]')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.events.push({ type: 'drive', drive: b.dataset.drive });
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const gearKeys = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, KeyR: -1, KeyN: 0, Digit0: 0 };
      if (e.code in gearKeys) this.events.push({ type: 'gear', gear: gearKeys[e.code] });
      if (e.code === 'KeyE') this.events.push({ type: 'start' });
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());
  }

  releaseAll() {
    this.keys.clear();
    this.held.clear();
    this.steerPointer = null;
    this.steerTarget = 0;
    for (const el of this.root.querySelectorAll('.btn.on')) el.classList.remove('on');
  }

  #steerDown(e) {
    if (this.steerPointer !== null) return;
    e.preventDefault();
    this.steerPointer = e.pointerId;
    this.steerStart = e.clientX;
    try {
      this.steerEl.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers cannot be captured.
    }
  }

  #steerMove(e) {
    if (e.pointerId !== this.steerPointer) return;
    // Full lock at about 17% of the screen width from where the thumb landed.
    const range = Math.max(70, window.innerWidth * 0.17);
    this.steerTarget = clamp((e.clientX - this.steerStart) / range, -1, 1);
  }

  #steerUp(e) {
    if (e.pointerId !== this.steerPointer) return;
    this.steerPointer = null;
    this.steerTarget = 0;
  }

  #isHeld(id) {
    for (const v of this.held.values()) if (v === id) return true;
    return false;
  }

  // Returns this frame's driver inputs. steer: -1 full left .. +1 full right.
  poll(dt) {
    const k = this.keys;
    const keyLeft = k.has('ArrowLeft') || k.has('KeyA');
    const keyRight = k.has('ArrowRight') || k.has('KeyD');
    let target = this.steerTarget;
    if (keyLeft || keyRight) target = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0);
    // Smoothing: thumb steering follows quickly, keys ramp in; both return to centre when let go.
    const keyboard = keyLeft || keyRight;
    const rate = (this.steerPointer !== null ? 9 : keyboard ? 2.8 : 6) * dt;
    this.steerValue += clamp(target - this.steerValue, -rate, rate);
    if (this.knobEl) {
      const half = this.steerEl.clientWidth / 2 - 26;
      this.knobEl.style.transform = `translateX(${this.steerValue * half}px)`;
    }
    const events = this.events;
    this.events = [];
    return {
      throttle: this.#isHeld('gas') || k.has('ArrowUp') || k.has('KeyW') ? 1 : 0,
      brake: this.#isHeld('brake') || k.has('ArrowDown') || k.has('KeyS') ? 1 : 0,
      handbrake: this.#isHeld('handbrake') || k.has('Space') ? 1 : 0,
      clutch: this.#isHeld('clutch') || k.has('ShiftLeft') || k.has('ShiftRight'),
      steer: this.steerValue,
      events,
    };
  }
}
