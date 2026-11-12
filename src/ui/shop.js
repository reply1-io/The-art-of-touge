// Tuning shop: the car on a turntable in a garage, with tabs for wheels, tyres, suspension and
// drivetrain. Every change shows on the car straight away (wheels, sidewalls, camber and ride
// height are all visible), applies to the physics, and is saved on the device.
import * as THREE from 'three';
import {
  CAR, TIRES, DIFFS, WHEELS, EXHAUSTS, RIM_SIZES, SWAY_FRONT, SWAY_REAR, TUNABLE_DEFAULTS, wheelSetup,
  RIM_WIDTH_IN, PLATES, cleanPlate, INTAKES, TURBOS, CLUTCHES, GEARBOXES, FINAL_DRIVES, BRAKES, HANDBRAKES, ANGLE_KITS, WEIGHTS, PAINTS, HEADLIGHTS, TAILLIGHTS,
} from '../config.js';
import { dynoRun } from '../physics/dyno.js';
import { loadBuilds, saveBuilds } from '../settings.js';
import { CarModel } from '../render/carModel.js';

const SHOP_KEYS = ['offsetFront', 'offsetRear', 'plateStyle', 'plateText', 'stretch', 'intake', 'turbo', 'clutch', 'gearbox', 'finalDrive', 'coilovers', 'bump', 'rebound', 'brakes', 'handbrake', 'angleKit', 'weight', 'paint', 'headlights', 'taillights', 'numbers', 'number', 'numberW', 'numberH', 'exhaust', 'tire', 'diff', 'rideHeight', 'brakeBias', 'springFront', 'springRear', 'antiRollFront', 'antiRollRear', 'wheel', 'rim', 'profile', 'camberFront', 'camberRear', 'strutFront', 'strutRear'];

const TABS = [
  ['body', 'Body'],
  ['wheels', 'Wheels'],
  ['chassis', 'Chassis'],
  ['engine', 'Engine'],
  ['dyno', 'Dyno'],
  ['builds', 'Builds'],
];

function stiffness(v) {
  const word = v < 26000 ? 'Soft' : v < 38000 ? 'Stock' : v < 52000 ? 'Firm' : 'Race';
  return `${word} · ${Math.round(v / 1000)} N/mm`;
}

// Wheel offset as the ET number (stock ET35) and how far the wheel sits out.
const offset = (v) => `ET${35 - v} · ${v === 0 ? 'Stock' : v > 0 ? `${v} mm out` : `${-v} mm in`}${v >= 40 ? ' · poke' : ''}`;

const deg = (v) => (v === 0 ? '0°' : `-${v.toFixed(1)}°`);

function nearestKey(table, value) {
  let best = null;
  for (const [k, v] of Object.entries(table)) if (best === null || Math.abs(v - value) < Math.abs(table[best] - value)) best = k;
  return best;
}

// ---------- The garage ----------
function textTexture(lines, w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h, lines);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildGarage(scene) {
  scene.background = new THREE.Color(0x0d0f14);
  scene.fog = new THREE.Fog(0x0d0f14, 9, 26);
  scene.add(new THREE.HemisphereLight(0x8a96b8, 0x1a1712, 1.1));
  const key = new THREE.SpotLight(0xffe9c8, 260, 30, 0.75, 0.6, 1.2);
  key.position.set(2.5, 7, 4);
  key.target.position.set(0, 0, 0);
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x7fb0ff, 0.9);
  rim.position.set(-5, 3, -6);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffb36b, 0.5);
  fill.position.set(-6, 2, 5);
  scene.add(fill);

  // Concrete floor with expansion joints.
  const floorTex = textTexture(null, 256, 256, (g) => {
    g.fillStyle = '#2a2b2e';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      const v = 34 + Math.random() * 18;
      g.fillStyle = `rgb(${v},${v},${v + 2})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    g.fillStyle = '#18191b';
    g.fillRect(0, 0, 256, 3);
    g.fillRect(0, 0, 3, 256);
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(8, 8);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Turntable: a dark steel disc with a ring of amber lights around its edge.
  const table = new THREE.Group();
  const discTex = textTexture(null, 256, 256, (g) => {
    g.fillStyle = '#1b1c20';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#2c2e33';
    g.lineWidth = 3;
    for (let r = 20; r < 128; r += 18) {
      g.beginPath();
      g.arc(128, 128, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = '#ffb000';
    g.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
      g.beginPath();
      g.moveTo(128, 128);
      g.lineTo(128 + Math.cos(i * Math.PI) * 126, 128 + Math.sin(i * Math.PI) * 126);
      g.stroke();
    }
  });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.5, 0.08, 48), [
    new THREE.MeshLambertMaterial({ color: 0x24262b }),
    new THREE.MeshLambertMaterial({ map: discTex }),
    new THREE.MeshLambertMaterial({ color: 0x24262b }),
  ]);
  disc.position.y = 0.04;
  table.add(disc);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffa21a });
  const led = new THREE.BoxGeometry(0.12, 0.03, 0.05);
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const m = new THREE.Mesh(led, ledMat);
    m.position.set(Math.cos(a) * 3.47, 0.07, Math.sin(a) * 3.47);
    m.rotation.y = -a;
    table.add(m);
  }
  scene.add(table);

  // Back wall: corrugated roller shutters, a tool board and a neon sign.
  const shutterTex = textTexture(null, 64, 128, (g) => {
    g.fillStyle = '#4a4e56';
    g.fillRect(0, 0, 64, 128);
    for (let y = 0; y < 128; y += 8) {
      g.fillStyle = '#3a3d44';
      g.fillRect(0, y, 64, 3);
      g.fillStyle = '#5a5e67';
      g.fillRect(0, y + 3, 64, 1);
    }
  });
  shutterTex.wrapS = shutterTex.wrapT = THREE.RepeatWrapping;
  shutterTex.repeat.set(3, 2);
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x2a2c31 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(40, 9), wallMat);
  back.position.set(0, 4.5, -7.5);
  scene.add(back);
  for (const x of [-5.2, 5.2]) {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.2), new THREE.MeshLambertMaterial({ map: shutterTex }));
    sh.position.set(x, 2.1, -7.45);
    scene.add(sh);
  }
  const sign = textTexture(null, 512, 128, (g) => {
    g.clearRect(0, 0, 512, 128);
    g.font = '80px VT323, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#ff7a1a';
    g.shadowBlur = 18;
    g.fillStyle = '#ffd38a';
    g.fillText('TOUGE GARAGE', 256, 66);
  });
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), new THREE.MeshBasicMaterial({ map: sign, transparent: true, fog: false }));
  neon.position.set(0, 5.1, -7.4);
  scene.add(neon);
  // Tyre stacks and a tool chest to fill the corners.
  const tyreGeo = new THREE.TorusGeometry(0.32, 0.12, 6, 14);
  tyreGeo.rotateX(Math.PI / 2);
  const tyreMat = new THREE.MeshLambertMaterial({ color: 0x141416 });
  for (const [x, z, n] of [[-6.4, -5.6, 5], [-5.6, -6.2, 3], [6.6, -4.6, 4]]) {
    for (let k = 0; k < n; k++) {
      const t = new THREE.Mesh(tyreGeo, tyreMat);
      t.position.set(x, 0.12 + k * 0.24, z);
      scene.add(t);
    }
  }
  const chest = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 0.6), new THREE.MeshLambertMaterial({ color: 0xa3241f }));
  chest.position.set(5.6, 0.55, -6.6);
  scene.add(chest);
  return table;
}

export class Shop {
  constructor(el, tune, onChange) {
    this.el = el;
    this.tune = tune;
    this.onChange = onChange;
    this.tab = 'body';
    this.isOpen = false;
    this.scene = new THREE.Scene();
    this.table = buildGarage(this.scene);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
    this.car = new CarModel(CAR);
    this.table.add(this.car.root);
    this.yaw = -2.4; // front three-quarter view
    this.spin = 0.12; // slow turn, rad/s
    this.dragging = false;
    this.fake = {
      mountY: CAR.wheelMountY,
      wheels: [
        [CAR.trackFront / 2, CAR.frontAxleZ, true],
        [-CAR.trackFront / 2, CAR.frontAxleZ, true],
        [CAR.trackRear / 2, CAR.rearAxleZ, false],
        [-CAR.trackRear / 2, CAR.rearAxleZ, false],
      ].map(([x, z, front]) => ({ x, z, front, compression: 0, steer: 0, angle: 0 })),
    };
    this.#applyCar();
  }

  open() {
    this.render();
    this.el.classList.remove('hidden');
    document.body.classList.add('in-shop');
    this.isOpen = true;
  }

  close() {
    this.el.classList.add('hidden');
    document.body.classList.remove('in-shop');
    this.isOpen = false;
    this.onClose?.();
  }

  // Size the turntable view so the car sits in the open space left of the panel.
  resize(w, h) {
    this.camera.aspect = w / Math.max(1, h);
    const panel = Math.min(w * 0.56, 520);
    this.camera.setViewOffset(w, h, panel / 2, 0, w, h);
    this.camera.updateProjectionMatrix();
  }

  // Turn the table, settle the car on its springs, and aim the camera.
  update(dt) {
    if (!this.dragging) this.yaw += this.spin * dt;
    this.car.updateFx(dt);
    this.table.rotation.y = this.yaw;
    this.camera.position.set(0, 2.2, 10.5);
    this.camera.lookAt(0, 0.45, 0);
  }

  #applyCar() {
    const t = this.tune;
    const ws = wheelSetup(t);
    this.car.applySetup(t);
    // Static ride: each corner sinks by its share of the weight over its spring rate.
    const rh = Math.max(-0.2, Math.min(0.05, (t.rideHeight || 0) / 1000));
    const mountY = CAR.wheelMountY - rh;
    this.fake.mountY = mountY;
    const g = (CAR.mass * 9.81) / 4;
    for (const w of this.fake.wheels) {
      w.baseX ??= w.x;
      w.x = w.baseX + Math.sign(w.baseX) * (w.front ? ws.pokeFront : ws.pokeRear);
      w.compression = Math.min(CAR.suspensionRest, (g * (w.front ? 1.04 : 0.96)) / (w.front ? t.springFront : t.springRear));
    }
    const yF = mountY - CAR.suspensionRest + this.fake.wheels[0].compression;
    const yR = mountY - CAR.suspensionRest + this.fake.wheels[2].compression;
    // Body origin height so the tyres sit on the turntable, with the rake from the springs.
    this.car.root.position.y = 0.08 + ws.radius - (yF + yR) / 2;
    this.car.root.rotation.x = Math.atan2(yF - yR, CAR.frontAxleZ - CAR.rearAxleZ);
    this.car.syncWheels(this.fake);
  }

  #change(key, value, rerender = false) {
    this.tune[key] = value;
    this.#applyCar();
    this.onChange();
    if (rerender) this.render();
  }

  // ---------- Panel building blocks ----------
  #section(title, ...children) {
    const box = document.createElement('div');
    box.className = 'shop-section';
    const h = document.createElement('h3');
    h.textContent = title;
    box.append(h, ...children);
    return box;
  }

  #cards(options, key, valueOf = (id) => id) {
    const row = document.createElement('div');
    row.className = 'shop-cards';
    for (const [id, opt] of Object.entries(options)) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'shop-card' + (this.tune[key] === valueOf(id) ? ' sel' : '');
      card.innerHTML = '<strong></strong><span></span>';
      card.querySelector('strong').textContent = opt.name;
      card.querySelector('span').textContent = opt.blurb;
      card.addEventListener('click', () => this.#change(key, valueOf(id), true));
      row.append(card);
    }
    return row;
  }

  // A row of small toggle buttons: [[value, label], ...].
  #chips(label, key, options, current = this.tune[key]) {
    const wrap = document.createElement('div');
    wrap.className = 'shop-chips';
    const name = document.createElement('span');
    name.textContent = label;
    const row = document.createElement('div');
    for (const [value, text] of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      if (current === value) b.classList.add('sel');
      b.addEventListener('click', () => this.#change(key, value, true));
      row.append(b);
    }
    wrap.append(name, row);
    return wrap;
  }

  #slider(key, label, min, max, step, show) {
    const el = document.createElement('label');
    el.className = 'shop-slider';
    const name = document.createElement('span');
    name.textContent = label;
    const val = document.createElement('span');
    val.className = 'val';
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `shop-${key}`;
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = this.tune[key];
    val.textContent = show(Number(input.value));
    input.addEventListener('input', () => {
      const v = Number(input.value);
      val.textContent = show(v);
      this.#change(key, v);
      this.#readout();
    });
    el.append(name, val, input);
    return el;
  }

  #readout() {
    if (!this.readoutEl) return;
    const t = this.tune;
    const ws = wheelSetup(t);
    const style = WHEELS[t.wheel] || WHEELS.bbs;
    this.readoutEl.innerHTML = '';
    for (const line of [
      `${style.name} ${ws.rim}x${RIM_WIDTH_IN[ws.rim]} ET${35 - (t.offsetFront ?? 0)}`,
      `${ws.width}/${ws.profile}R${ws.rim} ${TIRES[t.tire]?.name || ''}${ws.stretched ? ' stretched' : ''}`,
      `Camber ${deg(t.camberFront)} F  ${deg(t.camberRear)} R`,
    ]) {
      const d = document.createElement('div');
      d.textContent = line;
      this.readoutEl.append(d);
    }
  }

  #tabContent() {
    const t = this.tune;
    const label = { soft: 'Soft', stock: 'Stock', sport: 'Sport', race: 'Race', off: 'None' };
    if (this.tab === 'body') {
      return [
        this.#section('Paint', this.#paint()),
        this.#section(
          'Lights',
          this.#chips('Headlights', 'headlights', Object.entries(HEADLIGHTS).map(([k, v]) => [k, v[0]])),
          this.#chips('Tail lights', 'taillights', Object.entries(TAILLIGHTS).map(([k, v]) => [k, v[0]])),
        ),
        this.#section('Licence plate', this.#chips('Colour', 'plateStyle', Object.entries(PLATES).map(([k, v]) => [k, v.name])), this.#plateInput()),
        this.#section(
          'Number boards',
          this.#chips('On the doors', 'numbers', [[false, 'None'], [true, 'Fitted']]),
          ...(t.numbers
            ? [
                this.#slider('number', 'Number', 0, 99, 1, (v) => String(v)),
                this.#slider('numberW', 'Width', 0.2, 0.7, 0.02, (v) => `${Math.round(v * 100)} cm`),
                this.#slider('numberH', 'Height', 0.16, 0.36, 0.02, (v) => `${Math.round(v * 100)} cm`),
              ]
            : []),
        ),
      ];
    }
    if (this.tab === 'wheels') {
      return [
        this.#section('Rims', this.#cards(WHEELS, 'wheel')),
        this.#section(
          'Size & alignment',
          this.#chips('Rim size', 'rim', RIM_SIZES.map((r) => [r, `${r}"`])),
          ...(t.tire !== 'semi'
            ? [this.#chips('Tyre fit', 'stretch', [[false, 'Normal'], [true, 'Stretched']])]
            : [this.#hint('Stretched tyres are not made in semi-slick.')]),
          this.#slider('profile', 'Tyre sidewall', 30, 75, 5, (v) => `${v}% · ${v <= 40 ? 'Stretched thin' : v <= 50 ? 'Low profile' : v <= 60 ? 'Sporty' : 'Tall & soft'}`),
          this.#slider('offsetFront', 'Front offset', -20, 60, 5, offset),
          this.#slider('offsetRear', 'Rear offset', -20, 60, 5, offset),
          this.#slider('camberFront', 'Front camber', 0, 6, 0.5, (v) => `${deg(v)}${v > 3.5 ? ' · too much' : v >= 2 ? ' · grippy' : ''}`),
          this.#slider('camberRear', 'Rear camber', 0, 6, 0.5, (v) => `${deg(v)}${v > 3.5 ? ' · too much' : v >= 2 ? ' · grippy' : ''}`),
          this.#hint('Low sidewalls turn in sharper but break away sooner. A few degrees of camber adds cornering grip; past about -3.5° the tyre rides on its edge and grip drops.'),
        ),
        this.#section('Tyre compound', this.#cards(TIRES, 'tire')),
      ];
    }
    if (this.tab === 'builds') return [this.#builds()];
    if (this.tab === 'dyno') return [this.#dyno()];
    if (this.tab === 'engine') {
      return [
        this.#section('Intake', this.#cards(INTAKES, 'intake')),
        this.#section('Turbo', this.#cards(TURBOS, 'turbo')),
        this.#section('Exhaust', this.#cards(EXHAUSTS, 'exhaust')),
        this.#section('Clutch', this.#cards(CLUTCHES, 'clutch')),
        this.#section(
          'Gearing',
          this.#cards(GEARBOXES, 'gearbox'),
          this.#chips('Final drive', 'finalDrive', FINAL_DRIVES.map((f) => [f, f.toFixed(2)])),
          this.#hint('A higher final drive number is shorter: quicker out of corners, lower top speed.'),
        ),
        this.#section('Differential', this.#cards(DIFFS, 'diff')),
      ];
    }
    // Chassis
    return [
      this.#section(
        'Suspension',
        this.#chips('Dampers', 'coilovers', [[false, 'Stock'], [true, 'Coilovers']]),
        this.#slider('rideHeight', 'Ride height', -200, 30, 5, (v) => (v === 0 ? 'Stock' : `${v > 0 ? '+' : ''}${v} mm`)),
        this.#slider('springFront', 'Front springs', 18000, t.coilovers ? 90000 : 70000, 1000, stiffness),
        this.#slider('springRear', 'Rear springs', 18000, t.coilovers ? 90000 : 70000, 1000, stiffness),
        ...(t.coilovers
          ? [
              this.#slider('bump', 'Bump damping', 0.12, 0.8, 0.02, (v) => `${Math.round(v * 100)}%`),
              this.#slider('rebound', 'Rebound damping', 0.12, 0.9, 0.02, (v) => `${Math.round(v * 100)}%`),
              this.#hint('Coilovers go lower and stiffer, and split the damping: bump controls how the car takes a hit, rebound how fast it settles.'),
            ]
          : []),
      ),
      this.#section(
        'Sway bars',
        this.#chips('Front bar', 'antiRollFront', Object.entries(SWAY_FRONT).map(([k, v]) => [v, label[k]]), SWAY_FRONT[nearestKey(SWAY_FRONT, t.antiRollFront)]),
        this.#chips('Rear bar', 'antiRollRear', Object.entries(SWAY_REAR).map(([k, v]) => [v, label[k]]), SWAY_REAR[nearestKey(SWAY_REAR, t.antiRollRear)]),
        this.#hint('Stiffer bars cut body roll. A stiffer rear bar makes the tail looser; a stiffer front makes the nose push.'),
      ),
      this.#section(
        'Strut tower braces',
        this.#chips('Front brace', 'strutFront', [[false, 'None'], [true, 'Fitted']]),
        this.#chips('Rear brace', 'strutRear', [[false, 'None'], [true, 'Fitted']]),
      ),
      this.#section('Brakes', this.#cards(BRAKES, 'brakes'), this.#slider('brakeBias', 'Brake bias', 0.5, 0.8, 0.01, (v) => `${Math.round(v * 100)}% front`)),
      this.#section('Handbrake', this.#cards(HANDBRAKES, 'handbrake')),
      this.#section('Steering angle', this.#cards(ANGLE_KITS, 'angleKit')),
      this.#section('Weight reduction', this.#cards(WEIGHTS, 'weight')),
    ];
  }

  // Plate text: up to 7 letters and numbers, upper case as you type.
  #plateInput() {
    const wrap = document.createElement('label');
    wrap.className = 'shop-chips';
    const name = document.createElement('span');
    name.textContent = 'Plate text (up to 7)';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'plate-input';
    input.maxLength = 7;
    input.autocapitalize = 'characters';
    input.spellcheck = false;
    input.value = cleanPlate(this.tune.plateText);
    input.addEventListener('input', () => {
      const v = cleanPlate(input.value);
      if (input.value !== v) input.value = v;
      this.#change('plateText', v);
    });
    wrap.append(name, input);
    return wrap;
  }

  // Paint: period colours plus a picker for anything else.
  #paint() {
    const wrap = document.createElement('div');
    wrap.className = 'shop-paint';
    for (const [name, hex] of PAINTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = name;
      b.setAttribute('aria-label', name);
      b.style.background = hex;
      if ((this.tune.paint || '').toLowerCase() === hex) b.classList.add('sel');
      b.addEventListener('click', () => this.#change('paint', hex, true));
      wrap.append(b);
    }
    const custom = document.createElement('label');
    custom.className = 'shop-custom';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = this.tune.paint || '#efeee6';
    input.addEventListener('input', () => this.#change('paint', input.value));
    input.addEventListener('change', () => this.render());
    custom.append(input, document.createTextNode('Custom'));
    wrap.append(custom);
    const name = PAINTS.find(([, hex]) => hex === (this.tune.paint || '').toLowerCase());
    const p = this.#hint(name ? name[0] : `Custom ${this.tune.paint}`);
    const box = document.createElement('div');
    box.append(wrap, p);
    return box;
  }

  // Dyno sheet: torque and power against rpm for this setup, with stock dashed behind it.
  #dyno() {
    const box = this.#section('Dyno');
    const now = dynoRun(this.tune);
    const stock = dynoRun({ ...TUNABLE_DEFAULTS, torque: this.tune.torque });
    const c = document.createElement('canvas');
    c.className = 'shop-dyno';
    box.append(c);
    const stats = document.createElement('div');
    stats.className = 'dyno-stats';
    const kgPerHp = now.mass / now.peakHp.hp;
    for (const [k, v] of [
      ['Power', `${Math.round(now.peakHp.hp)} hp @ ${now.peakHp.rpm}`],
      ['Torque', `${Math.round(now.peakNm.nm)} Nm @ ${now.peakNm.rpm}`],
      ['Weight', `${now.mass} kg`],
      ['kg / hp', kgPerHp.toFixed(1)],
    ]) {
      const d = document.createElement('div');
      d.innerHTML = '<span></span><b></b>';
      d.querySelector('span').textContent = k;
      d.querySelector('b').textContent = v;
      stats.append(d);
    }
    box.append(stats, this.#hint(`Stock: ${Math.round(stock.peakHp.hp)} hp, ${Math.round(stock.peakNm.nm)} Nm (dashed lines). Turbo curves show full boost; on the road it takes a moment to build.`));
    requestAnimationFrame(() => this.#drawDyno(c, now, stock));
    return box;
  }

  #drawDyno(c, now, stock) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = c.clientWidth || 400;
    const H = c.clientHeight || 200;
    c.width = W * dpr;
    c.height = H * dpr;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = 'rgba(6,6,8,0.85)';
    g.fillRect(0, 0, W, H);
    const pad = { l: 34, r: 34, t: 10, b: 22 };
    const maxNm = Math.max(200, ...now.pts.map((p) => p.nm)) * 1.1;
    const maxHp = Math.max(160, ...now.pts.map((p) => p.hp)) * 1.1;
    const X = (rpm) => pad.l + ((rpm - 1000) / 6000) * (W - pad.l - pad.r);
    const Yn = (nm) => H - pad.b - (nm / maxNm) * (H - pad.t - pad.b);
    const Yh = (hp) => H - pad.b - (hp / maxHp) * (H - pad.t - pad.b);
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    g.font = "14px 'VT323', monospace";
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.textAlign = 'center';
    for (let rpm = 1000; rpm <= 7000; rpm += 1000) {
      g.beginPath();
      g.moveTo(X(rpm), pad.t);
      g.lineTo(X(rpm), H - pad.b);
      g.stroke();
      g.fillText(String(rpm / 1000), X(rpm), H - 6);
    }
    const line = (pts, y, color, dash, blur) => {
      g.setLineDash(dash);
      g.strokeStyle = color;
      g.lineWidth = 2.2;
      g.shadowColor = color;
      g.shadowBlur = blur;
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(X(p.rpm), y(p)) : g.moveTo(X(p.rpm), y(p))));
      g.stroke();
      g.shadowBlur = 0;
      g.setLineDash([]);
    };
    line(stock.pts, (p) => Yn(p.nm), 'rgba(120,200,255,0.45)', [5, 4], 0);
    line(stock.pts, (p) => Yh(p.hp), 'rgba(255,170,90,0.45)', [5, 4], 0);
    line(now.pts, (p) => Yn(p.nm), '#78c8ff', [], 6);
    line(now.pts, (p) => Yh(p.hp), '#ff8c1a', [], 8);
    g.textAlign = 'left';
    g.fillStyle = '#78c8ff';
    g.fillText('Nm', 4, pad.t + 10);
    g.textAlign = 'right';
    g.fillStyle = '#ff8c1a';
    g.fillText('HP', W - 4, pad.t + 10);
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.textAlign = 'center';
    g.fillText('RPM x1000', W / 2, pad.t + 10);
  }

  // Three named build slots: save the current setup into one, or load one back.
  #builds() {
    const slots = loadBuilds();
    const box = this.#section('Saved builds');
    box.append(this.#hint('Save up to three setups with your own names, and swap between them any time.'));
    slots.forEach((slot, i) => {
      const row = document.createElement('div');
      row.className = 'build-slot' + (slot ? '' : ' empty');
      const name = document.createElement('input');
      name.type = 'text';
      name.maxLength = 20;
      name.placeholder = `Build ${i + 1}`;
      name.value = slot?.name ?? '';
      name.setAttribute('aria-label', `Name for build ${i + 1}`);
      name.addEventListener('change', () => {
        const all = loadBuilds();
        if (all[i]) {
          all[i].name = name.value.trim() || `Build ${i + 1}`;
          saveBuilds(all);
        }
      });
      const info = document.createElement('span');
      info.className = 'build-info';
      if (slot) {
        const t = slot.tune || {};
        const ws = wheelSetup({ ...TUNABLE_DEFAULTS, ...t });
        info.textContent = `${(WHEELS[t.wheel] || WHEELS.bbs).name} ${ws.rim}" · ${(TIRES[t.tire] || TIRES.street).name} · ${(DIFFS[t.diff] || DIFFS.lsd).name} · ${(EXHAUSTS[t.exhaust] || EXHAUSTS.stock).name} exhaust`;
      } else info.textContent = 'Empty slot';
      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = slot ? 'SAVE OVER' : 'SAVE';
      save.addEventListener('click', () => {
        const all = loadBuilds();
        const tune = {};
        for (const k of SHOP_KEYS) tune[k] = this.tune[k];
        all[i] = { name: name.value.trim() || `Build ${i + 1}`, tune };
        saveBuilds(all);
        this.flash = `Saved "${all[i].name}"`;
        this.render();
      });
      const load = document.createElement('button');
      load.type = 'button';
      load.textContent = 'LOAD';
      load.disabled = !slot;
      load.addEventListener('click', () => {
        const b = loadBuilds()[i];
        if (!b) return;
        for (const k of SHOP_KEYS) this.tune[k] = b.tune?.[k] ?? TUNABLE_DEFAULTS[k];
        this.#applyCar();
        this.onChange();
        this.flash = `Loaded "${b.name}"`;
        this.render();
      });
      const btns = document.createElement('div');
      btns.className = 'build-btns';
      btns.append(save, load);
      row.append(name, info, btns);
      box.append(row);
    });
    if (this.flash) {
      box.append(this.#hint(this.flash));
      this.flash = '';
    }
    return box;
  }

  #hint(text) {
    const p = document.createElement('p');
    p.className = 'shop-hint';
    p.textContent = text;
    return p;
  }

  render() {
    const el = this.el;
    el.innerHTML = '';

    // Turntable stage: drag to turn the car.
    const stage = document.createElement('div');
    stage.className = 'shop-stage';
    let lastX = 0;
    stage.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      lastX = e.clientX;
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - lastX) * 0.012;
      lastX = e.clientX;
    });
    const up = () => (this.dragging = false);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    const title = document.createElement('div');
    title.className = 'shop-car';
    title.innerHTML = '<b>BMW E30 318is</b><span>Drag to turn</span>';
    this.readoutEl = document.createElement('div');
    this.readoutEl.className = 'shop-readout';
    stage.append(title, this.readoutEl);
    this.#readout();

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
    const tabs = document.createElement('div');
    tabs.className = 'shop-tabs';
    for (const [id, name] of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      if (this.tab === id) b.classList.add('sel');
      b.addEventListener('click', () => {
        this.tab = id;
        this.render();
      });
      tabs.append(b);
    }
    const body = document.createElement('div');
    body.className = 'shop-body';
    body.append(...this.#tabContent());
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'big ghost';
    reset.textContent = 'RESET TO STOCK';
    reset.addEventListener('click', () => {
      for (const k of SHOP_KEYS) this.tune[k] = TUNABLE_DEFAULTS[k];
      this.#applyCar();
      this.onChange();
      this.render();
    });
    body.append(reset);
    panel.append(head, tabs, body);
    el.append(stage, panel);
  }
}
