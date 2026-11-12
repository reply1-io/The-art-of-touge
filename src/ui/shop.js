// Tuning shop: tyres, differential, ride height, brake bias and spring rates. Changes apply to the
// car straight away and are saved on the device.
import { TIRES, DIFFS, TUNABLE_DEFAULTS } from '../config.js';

const SLIDERS = [
  { key: 'rideHeight', label: 'Ride height', min: -60, max: 30, step: 5, show: (v) => (v === 0 ? 'Stock' : `${v > 0 ? '+' : ''}${v} mm`) },
  { key: 'brakeBias', label: 'Brake bias', min: 0.5, max: 0.8, step: 0.01, show: (v) => `${Math.round(v * 100)}% front` },
  { key: 'springFront', label: 'Front springs', min: 18000, max: 70000, step: 1000, show: stiffness },
  { key: 'springRear', label: 'Rear springs', min: 18000, max: 70000, step: 1000, show: stiffness },
];

function stiffness(v) {
  const word = v < 26000 ? 'Soft' : v < 38000 ? 'Stock' : v < 52000 ? 'Firm' : 'Race';
  return `${word} · ${Math.round(v / 1000)} N/mm`;
}

export class Shop {
  constructor(el, tune, onChange) {
    this.el = el;
    this.tune = tune;
    this.onChange = onChange;
  }

  open() {
    this.render();
    this.el.classList.remove('hidden');
  }

  close() {
    this.el.classList.add('hidden');
  }

  #change(key, value) {
    this.tune[key] = value;
    this.onChange();
  }

  #cards(title, options, key) {
    const box = document.createElement('div');
    box.className = 'shop-section';
    const h = document.createElement('h3');
    h.textContent = title;
    const row = document.createElement('div');
    row.className = 'shop-cards';
    for (const [id, opt] of Object.entries(options)) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'shop-card' + (this.tune[key] === id ? ' sel' : '');
      card.innerHTML = `<strong></strong><span></span>`;
      card.querySelector('strong').textContent = opt.name;
      card.querySelector('span').textContent = opt.blurb;
      card.addEventListener('click', () => {
        this.#change(key, id);
        this.render();
      });
      row.append(card);
    }
    box.append(h, row);
    return box;
  }

  render() {
    const el = this.el;
    el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'shop-panel';
    const head = document.createElement('div');
    head.className = 'shop-head';
    head.innerHTML = '<h2>TUNING SHOP</h2>';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'big';
    done.textContent = 'DONE';
    done.addEventListener('click', () => this.close());
    head.append(done);
    panel.append(head);

    panel.append(this.#cards('Tyres', TIRES, 'tire'));
    panel.append(this.#cards('Differential', DIFFS, 'diff'));

    const box = document.createElement('div');
    box.className = 'shop-section';
    const h = document.createElement('h3');
    h.textContent = 'Suspension & brakes';
    box.append(h);
    for (const s of SLIDERS) {
      const label = document.createElement('label');
      label.className = 'shop-slider';
      const name = document.createElement('span');
      name.textContent = s.label;
      const val = document.createElement('span');
      val.className = 'val';
      const input = document.createElement('input');
      input.type = 'range';
      input.id = `shop-${s.key}`;
      input.min = s.min;
      input.max = s.max;
      input.step = s.step;
      input.value = this.tune[s.key];
      val.textContent = s.show(Number(input.value));
      input.addEventListener('input', () => {
        const v = Number(input.value);
        val.textContent = s.show(v);
        this.#change(s.key, v);
      });
      label.append(name, val, input);
      box.append(label);
    }
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'big ghost';
    reset.textContent = 'RESET TO STOCK SETUP';
    reset.addEventListener('click', () => {
      for (const k of ['tire', 'diff', 'rideHeight', 'brakeBias', 'springFront', 'springRear']) this.tune[k] = TUNABLE_DEFAULTS[k];
      this.onChange();
      this.render();
    });
    box.append(reset);
    panel.append(box);
    el.append(panel);
  }
}
