// Hidden dev tuning panel: sliders for the handling values, applied live and saved on the device.
// Open it from the pause menu, or press ` on a keyboard.
import { TUNABLE_DEFAULTS, TUNABLE_RANGES } from '../config.js';

const LABELS = {
  grip: 'Grip multiplier',
  springFront: 'Spring front (N/m)',
  springRear: 'Spring rear (N/m)',
  damping: 'Damping ratio',
  antiRollFront: 'Anti-roll front (N/m)',
  antiRollRear: 'Anti-roll rear (N/m)',
  torque: 'Engine torque x',
  steering: 'Steering x',
  steerSpeedFalloff: 'Steering speed falloff',
  lsdLock: 'LSD lock',
  lsdPreload: 'LSD preload (N m)',
};

export class TuningPanel {
  constructor(el, tune, onChange) {
    this.el = el;
    this.tune = tune;
    this.onChange = onChange;
    this.render();
  }

  render() {
    const el = this.el;
    el.innerHTML = '';
    const head = document.createElement('h3');
    head.textContent = 'TUNING';
    const buttons = document.createElement('span');
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Defaults';
    reset.addEventListener('click', () => {
      Object.assign(this.tune, TUNABLE_DEFAULTS);
      this.onChange();
      this.render();
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.toggle(false));
    buttons.append(reset, ' ', close);
    head.append(buttons);
    el.append(head);
    for (const [key, [min, max, step]] of Object.entries(TUNABLE_RANGES)) {
      const label = document.createElement('label');
      const name = document.createElement('span');
      name.textContent = LABELS[key] || key;
      const val = document.createElement('span');
      val.className = 'val';
      const input = document.createElement('input');
      input.type = 'range';
      input.id = `tune-${key}`;
      input.min = min;
      input.max = max;
      input.step = step;
      input.value = this.tune[key];
      const show = () => {
        const v = this.tune[key];
        val.textContent = step >= 1 ? String(Math.round(v)) : v.toFixed(2);
      };
      show();
      input.addEventListener('input', () => {
        this.tune[key] = Number(input.value);
        show();
        this.onChange();
      });
      label.append(name, val, input);
      el.append(label);
    }
  }

  toggle(force) {
    const open = force ?? this.el.classList.contains('hidden');
    this.el.classList.toggle('hidden', !open);
  }
}
