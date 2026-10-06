// Touch controls (primary) and keyboard (for testing on a computer).
//
// Touch layout (landscape):
//   left:  steering (slider or buttons), shift up/down above it
//   right: a 2x2 pedal pad   [HAND ] [CLUTCH]
//                            [BRAKE] [ GAS  ]
// A thumb can slide between pad cells. Sliding from GAS up into CLUTCH keeps the throttle held,
// so a clutch kick is a quick flick up and back down. Sliding from BRAKE into HAND keeps the brake.
// Pedals are analog: the top 60% of a pedal is full pressure, lower down is lighter.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Input {
  constructor(root) {
    this.root = root;
    this.steerMode = 'slider';
    this.pointers = new Map();
    this.keys = new Set();
    this.shifts = [];
    this.steerValue = 0; // -1 left .. +1 right (screen convention)
    this.knob = root.querySelector('#steer-knob');
    this.slider = root.querySelector('#steer-slider');

    root.addEventListener('pointerdown', (e) => this.#down(e));
    root.addEventListener('pointermove', (e) => this.#move(e));
    root.addEventListener('pointerup', (e) => this.#up(e));
    root.addEventListener('pointercancel', (e) => this.#up(e));
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE' || e.code === 'KeyX') this.shifts.push(1);
      if (e.code === 'KeyQ' || e.code === 'KeyZ') this.shifts.push(-1);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pointers.clear();
      this.#refreshPressed();
    });
  }

  setSteerMode(mode) {
    this.steerMode = mode;
    this.root.dataset.steer = mode;
  }

  setTransmission(mode) {
    this.root.dataset.trans = mode;
  }

  #ctlAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || !this.root.contains(el)) return null;
    const ctl = el.closest('[data-ctl]');
    if (ctl && ctl.offsetParent !== null) return ctl;
    const zone = el.closest('#steer-zone');
    if (zone && this.steerMode === 'slider') return zone;
    return null;
  }

  #pedalValue(el, y) {
    const r = el.getBoundingClientRect();
    const f = clamp((y - r.top) / r.height, 0, 1);
    return f < 0.6 ? 1 : 1 - ((f - 0.6) / 0.4) * 0.7;
  }

  #down(e) {
    e.preventDefault();
    const el = this.#ctlAt(e.clientX, e.clientY);
    if (!el) return;
    try {
      // Keep receiving moves for this finger even when it slides off the control.
      this.root.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic or already-released pointers cannot be captured; moves still arrive while over controls.
    }
    const name = el.dataset.ctl || 'steer';
    const p = { name, el, startX: e.clientX, x: e.clientX, y: e.clientY, value: 1, latchGas: 0, latchBrake: 0 };
    if (name === 'gas' || name === 'brake') p.value = this.#pedalValue(el, e.clientY);
    if (name === 'shiftUp') this.shifts.push(1);
    if (name === 'shiftDown') this.shifts.push(-1);
    this.pointers.set(e.pointerId, p);
    this.#refreshPressed();
  }

  #move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (p.name === 'steer') return;
    const pad = ['gas', 'brake', 'clutch', 'handbrake'];
    if (!pad.includes(p.name)) return;
    const el = this.#ctlAt(e.clientX, e.clientY);
    const name = el?.dataset.ctl;
    if (name && pad.includes(name) && name !== p.name) {
      if (p.name === 'gas' && name === 'clutch') p.latchGas = p.value;
      else if (p.name === 'brake' && name === 'handbrake') p.latchBrake = p.value;
      else if (name === 'gas' || name === 'brake') {
        p.latchGas = 0;
        p.latchBrake = 0;
      }
      if (name === 'handbrake' || name === 'clutch') {
        if (name === 'clutch' && p.name !== 'gas') p.latchGas = 0;
        if (name === 'handbrake' && p.name !== 'brake') p.latchBrake = 0;
      }
      p.name = name;
      p.el = el;
      this.#refreshPressed();
    }
    if (p.name === 'gas' || p.name === 'brake') p.value = this.#pedalValue(p.el, e.clientY);
  }

  #up(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    this.#refreshPressed();
  }

  #refreshPressed() {
    for (const el of this.root.querySelectorAll('[data-ctl]')) el.classList.remove('on');
    for (const p of this.pointers.values()) {
      p.el?.classList?.add('on');
      if (p.latchGas) this.root.querySelector('[data-ctl="gas"]')?.classList.add('on');
      if (p.latchBrake) this.root.querySelector('[data-ctl="brake"]')?.classList.add('on');
    }
  }

  // Returns this frame's controls. steer: -1 (left) .. +1 (right).
  poll(dt) {
    const out = { throttle: 0, brake: 0, clutch: 0, handbrake: 0, steer: 0, shifts: this.shifts };
    this.shifts = [];
    let steerTarget = 0;
    let sliderActive = false;
    let buttonSteer = false;
    for (const p of this.pointers.values()) {
      switch (p.name) {
        case 'gas':
          out.throttle = Math.max(out.throttle, p.value);
          break;
        case 'brake':
          out.brake = Math.max(out.brake, p.value);
          break;
        case 'clutch':
          out.clutch = 1;
          out.throttle = Math.max(out.throttle, p.latchGas);
          break;
        case 'handbrake':
          out.handbrake = 1;
          out.brake = Math.max(out.brake, p.latchBrake);
          break;
        case 'steer': {
          const range = Math.max(60, window.innerWidth * 0.15);
          steerTarget = clamp((p.x - p.startX) / range, -1, 1);
          sliderActive = true;
          break;
        }
        case 'left':
          steerTarget -= 1;
          buttonSteer = true;
          break;
        case 'right':
          steerTarget += 1;
          buttonSteer = true;
          break;
      }
    }
    const k = this.keys;
    if (k.has('ArrowUp') || k.has('KeyW')) out.throttle = 1;
    if (k.has('ArrowDown') || k.has('KeyS')) out.brake = 1;
    if (k.has('Space')) out.handbrake = 1;
    if (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyC')) out.clutch = 1;
    const keyLeft = k.has('ArrowLeft') || k.has('KeyA');
    const keyRight = k.has('ArrowRight') || k.has('KeyD');
    if (keyLeft || keyRight) {
      steerTarget = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0);
      buttonSteer = true;
    }

    if (sliderActive) {
      // Direct thumb steering, lightly smoothed.
      this.steerValue += (steerTarget - this.steerValue) * clamp(dt * 30, 0, 1);
    } else {
      // Buttons and keys ease in the longer they are held, and return to centre faster.
      const toward = clamp(steerTarget, -1, 1);
      const returning = Math.abs(toward) < Math.abs(this.steerValue) || Math.sign(toward) !== Math.sign(this.steerValue);
      const rate = (buttonSteer && !returning ? 2.6 : 5.5) * dt;
      this.steerValue += clamp(toward - this.steerValue, -rate, rate);
    }
    out.steer = this.steerValue;
    if (this.knob) {
      const range = this.slider ? this.slider.clientWidth / 2 - 22 : 60;
      this.knob.style.transform = `translateX(${this.steerValue * range}px)`;
    }
    return out;
  }

  get resetPressed() {
    return this.keys.has('KeyR');
  }
}
