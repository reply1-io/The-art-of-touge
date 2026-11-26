// Tuning shop: the car in a home workshop, with tabs for wheels, tyres, suspension and
// drivetrain. Every change shows on the car straight away (wheels, sidewalls, camber and ride
// height are all visible), applies to the physics, and is saved on the device.
import * as THREE from 'three';
import {
  CAR, BASE_CAR, CARS, ENGINE_SWAPS, carSave, TIRES, DIFFS, WHEELS, EXHAUSTS, RIM_SIZES, SWAY_FRONT, SWAY_REAR, TUNABLE_DEFAULTS, wheelSetup,
  SEATS, RIM_WIDTH_IN, INTAKES, TURBOS, CLUTCHES, GEARBOXES, FINAL_DRIVES, BRAKES, HANDBRAKES, ANGLE_KITS, WEIGHTS, PAINTS, WHEEL_COLORS, wheelColorOf,
} from '../config.js';
import { dynoRun } from '../physics/dyno.js';
import { money } from '../game/wallet.js';
import { loadBuilds, saveBuilds } from '../settings.js';
import { CarModel } from '../render/carModel.js';

// ---------- Colour conversions for the paint wheel (h, s, l all 0..1) ----------
function hslToRgb(h, s, l) {
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function hslToHex(h, s, l) {
  return '#' + hslToRgb(h, s, l).map((v) => v.toString(16).padStart(2, '0')).join('');
}

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

const SHOP_KEYS = ['seats', 'offsetFront', 'offsetRear', 'plateStyle', 'plateText', 'stretch', 'intake', 'turbo', 'clutch', 'gearbox', 'finalDrive', 'coilovers', 'brakes', 'handbrake', 'angleKit', 'weight', 'paint', 'numbers', 'number', 'numberW', 'numberH', 'exhaust', 'tire', 'diff', 'rideHeight', 'brakeBias', 'springFront', 'springRear', 'antiRollFront', 'antiRollRear', 'wheel', 'wheelColor', 'rim', 'profile', 'camberFront', 'camberRear', 'strutFront', 'strutRear'];

const TABS = [
  ['car', 'Car'],
  ['body', 'Exterior'],
  ['interior', 'Interior'],
  ['wheels', 'Wheels'],
  ['chassis', 'Suspension'],
  ['brakes', 'Brakes'],
  ['engine', 'Engine'],
  ['drive', 'Drivetrain'],
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

// Someone's home workshop: a single-car garage with a bare concrete floor, block walls, a
// workbench and pegboard of tools, shelves of parts, a rolling tool chest, an engine on a stand and
// strip lights overhead. The car just sits on the floor; the camera walks round it.
function buildGarage(scene) {
  scene.background = new THREE.Color(0x15130f);
  scene.fog = new THREE.Fog(0x15130f, 12, 30);
  const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const box = (w, h, d, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    scene.add(m);
    return m;
  };
  const W = 7.2; // half width of the room (x)
  const D = 6.2; // half depth (z)
  const H = 3.6; // ceiling height

  // Light: warm fill from the strip lights, a cooler spill from the open door.
  scene.add(new THREE.HemisphereLight(0xfff1d8, 0x2a241c, 0.9));
  const key = new THREE.PointLight(0xfff0d0, 26, 14, 1.3);
  key.position.set(0.5, H - 0.3, 0.6);
  scene.add(key);
  const fill = new THREE.PointLight(0xffe3b0, 10, 10, 1.4);
  fill.position.set(-3.6, H - 0.4, -3);
  scene.add(fill);
  const door = new THREE.DirectionalLight(0xa8c4ff, 0.7);
  door.position.set(6, 3, 8);
  scene.add(door);

  // Concrete floor: speckled, with expansion joints and oil stains where cars have stood.
  const floorTex = textTexture(null, 512, 512, (g) => {
    g.fillStyle = '#55524c';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) {
      const v = 70 + Math.random() * 30;
      g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
      g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    for (let i = 0; i < 7; i++) {
      const x = 120 + Math.random() * 270;
      const y = 120 + Math.random() * 270;
      const r = 18 + Math.random() * 46;
      const grd = g.createRadialGradient(x, y, 2, x, y, r);
      grd.addColorStop(0, 'rgba(18,16,14,0.65)');
      grd.addColorStop(1, 'rgba(18,16,14,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#3a3833';
    g.fillRect(0, 255, 512, 3);
    g.fillRect(255, 0, 3, 512);
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2), lambert(0xffffff, { map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Painted block walls.
  const blockTex = textTexture(null, 256, 256, (g) => {
    g.fillStyle = '#8d8a80';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) {
      const v = 125 + Math.random() * 25;
      g.fillStyle = `rgb(${v},${v - 2},${v - 8})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    g.fillStyle = '#6c695f';
    for (let row = 0; row < 8; row++) {
      g.fillRect(0, row * 32, 256, 3);
      for (let c = 0; c < 4; c++) g.fillRect(c * 64 + (row % 2) * 32, row * 32, 3, 32);
    }
    // A grubby band along the bottom.
    const grd = g.createLinearGradient(0, 200, 0, 256);
    grd.addColorStop(0, 'rgba(40,36,30,0)');
    grd.addColorStop(1, 'rgba(40,36,30,0.25)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
  });
  blockTex.wrapS = blockTex.wrapT = THREE.RepeatWrapping;
  const wallMat = (rx) => {
    const t = blockTex.clone();
    t.needsUpdate = true;
    t.repeat.set(rx, 1.4);
    return lambert(0xffffff, { map: t });
  };
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H), wallMat(4));
  back.position.set(0, H / 2, -D);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(D * 2, H), wallMat(3.6));
  left.position.set(-W, H / 2, 0);
  left.rotation.y = Math.PI / 2;
  const right = new THREE.Mesh(new THREE.PlaneGeometry(D * 2, H), wallMat(3.6));
  right.position.set(W, H / 2, 0);
  right.rotation.y = -Math.PI / 2;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H), wallMat(4));
  front.position.set(0, H / 2, D);
  front.rotation.y = Math.PI;
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2), lambert(0x3b3833));
  ceiling.position.y = H;
  ceiling.rotation.x = Math.PI / 2;
  scene.add(back, left, right, front, ceiling);
  // Exposed roof beams.
  const beamMat = lambert(0x5c4632);
  for (const z of [-3.6, -1.2, 1.2, 3.6]) box(W * 2, 0.18, 0.14, beamMat, 0, H - 0.09, z);

  // The roller door on the right wall, half open, with daylight under it.
  const shutterTex = textTexture(null, 64, 128, (g) => {
    g.fillStyle = '#9da3a8';
    g.fillRect(0, 0, 64, 128);
    for (let y = 0; y < 128; y += 8) {
      g.fillStyle = '#7d8388';
      g.fillRect(0, y, 64, 3);
      g.fillStyle = '#b8bdc1';
      g.fillRect(0, y + 3, 64, 1);
    }
  });
  shutterTex.wrapS = shutterTex.wrapT = THREE.RepeatWrapping;
  shutterTex.repeat.set(3, 2);
  const shutter = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.9), lambert(0xffffff, { map: shutterTex }));
  shutter.position.set(W - 0.02, H - 0.95, 0.8);
  shutter.rotation.y = -Math.PI / 2;
  const daylight = new THREE.Mesh(new THREE.PlaneGeometry(5, H - 1.9), new THREE.MeshBasicMaterial({ color: 0xc9dcf2 }));
  daylight.position.set(W - 0.03, (H - 1.9) / 2, 0.8);
  daylight.rotation.y = -Math.PI / 2;
  scene.add(shutter, daylight);

  // Strip lights.
  const tubeMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  for (const [x, z] of [[0.5, 0.6], [-3.6, -3]]) {
    box(1.5, 0.08, 0.16, lambert(0x2b2b2b), x, H - 0.25, z);
    box(1.4, 0.05, 0.08, tubeMat, x, H - 0.31, z);
  }

  // Workbench along the back wall, with a vice, a pegboard of tools above it and a strip light.
  const wood = lambert(0x8a6338);
  const steel = lambert(0x4a4d52);
  box(3.6, 0.08, 0.8, wood, -2.2, 0.92, -D + 0.45);
  box(3.4, 0.05, 0.7, wood, -2.2, 0.25, -D + 0.45);
  for (const x of [-3.9, -0.5]) for (const z of [-D + 0.12, -D + 0.78]) box(0.07, 0.92, 0.07, steel, x, 0.46, z);
  box(0.22, 0.16, 0.18, lambert(0x2d4f8a), -3.4, 1.04, -D + 0.3); // vice
  box(0.5, 0.12, 0.3, lambert(0xb42a20), -1.6, 1.02, -D + 0.4); // a small toolbox on the bench
  box(0.3, 0.3, 0.25, lambert(0xd9c27a), -0.9, 1.11, -D + 0.45); // a box of parts
  const pegTex = textTexture(null, 512, 256, (g) => {
    g.fillStyle = '#b08a5c';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#7f6240';
    for (let y = 10; y < 256; y += 16) for (let x = 10; x < 512; x += 16) g.fillRect(x, y, 3, 3);
    // Tool outlines: spanners, a hammer, screwdrivers, a saw, pliers.
    g.fillStyle = '#2b2d31';
    for (let k = 0; k < 9; k++) {
      const x = 30 + k * 26;
      g.fillRect(x, 40, 7, 90 + (k % 3) * 14);
      g.beginPath();
      g.arc(x + 3.5, 40, 9, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#a32a22';
    for (let k = 0; k < 5; k++) g.fillRect(300 + k * 22, 50, 10, 70);
    g.fillStyle = '#2b2d31';
    for (let k = 0; k < 5; k++) g.fillRect(303 + k * 22, 120, 4, 50);
    g.fillRect(420, 40, 18, 90);
    g.fillRect(400, 40, 58, 18);
    g.fillStyle = '#c9ccd1';
    g.beginPath();
    g.moveTo(40, 190);
    g.lineTo(230, 190);
    g.lineTo(230, 222);
    g.lineTo(40, 205);
    g.fill();
  });
  const peg = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.25), lambert(0xffffff, { map: pegTex }));
  peg.position.set(-2.2, 1.85, -D + 0.02);
  scene.add(peg);

  // Shelving on the left wall: tyres, oil, boxes of parts.
  const shelfMat = lambert(0x6d7076);
  for (const y of [0.45, 1.2, 1.95]) box(0.55, 0.04, 3.2, shelfMat, -W + 0.3, y, 0.6);
  for (const z of [-0.95, 2.15]) for (const x of [-W + 0.05, -W + 0.55]) box(0.04, 2.1, 0.04, shelfMat, x, 1.05, z);
  const tyreGeo = new THREE.TorusGeometry(0.3, 0.11, 6, 14);
  const tyreMat = lambert(0x161618);
  for (let k = 0; k < 4; k++) {
    const t = new THREE.Mesh(tyreGeo, tyreMat);
    t.position.set(-W + 0.32, 0.88, -0.5 + k * 0.62);
    t.rotation.y = Math.PI / 2;
    scene.add(t);
  }
  const colours = [0xd6382c, 0x2f6fbe, 0xe0b23a, 0x3d8a4a, 0xdedede];
  for (let k = 0; k < 9; k++) box(0.3, 0.22 + (k % 3) * 0.06, 0.26, lambert(colours[k % colours.length]), -W + 0.3, 1.33 + (k % 3) * 0.03, -0.6 + k * 0.33);
  for (let k = 0; k < 6; k++) box(0.42, 0.3, 0.4, lambert(0xa4875a), -W + 0.3, 2.13, -0.4 + k * 0.48);
  for (let k = 0; k < 5; k++) {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.26, 8), lambert(k % 2 ? 0x1f5aa0 : 0xd8a21d));
    can.position.set(-W + 0.3, 0.6, -0.6 + k * 0.25);
    scene.add(can);
  }

  // A red rolling tool chest, an engine on a stand, a floor jack and a stack of tyres.
  const red = lambert(0xb3241c);
  box(1.0, 1.05, 0.55, red, 2.6, 0.55, -D + 0.4);
  box(1.0, 0.45, 0.55, red, 2.6, 1.32, -D + 0.4);
  for (let k = 0; k < 6; k++) box(0.9, 0.02, 0.01, lambert(0xcfd2d6), 2.6, 0.2 + k * 0.17, -D + 0.68);
  const engStand = new THREE.Group();
  engStand.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.52, 0.42), lambert(0x6f6a62)));
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.36), lambert(0x9a9da2));
  head.position.y = 0.34;
  engStand.add(head);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), red);
  leg.position.y = -0.55;
  engStand.add(leg);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.08), red);
  foot.position.y = -0.9;
  engStand.add(foot);
  engStand.position.set(4.6, 0.95, -3.4);
  engStand.rotation.y = -0.5;
  scene.add(engStand);
  const jack = new THREE.Group();
  jack.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.8), red));
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 6), steel);
  handle.rotation.x = 1.0;
  handle.position.set(0, 0.35, 0.75);
  jack.add(handle);
  jack.position.set(3.4, 0.08, 2.9);
  jack.rotation.y = 0.6;
  scene.add(jack);
  for (let k = 0; k < 4; k++) {
    const t = new THREE.Mesh(tyreGeo, tyreMat);
    t.rotation.x = Math.PI / 2;
    t.position.set(-4.7, 0.11 + k * 0.22, 4.4);
    scene.add(t);
  }

  // A poster and a sign on the walls.
  const poster = textTexture(null, 256, 360, (g) => {
    g.fillStyle = '#e9e1cc';
    g.fillRect(0, 0, 256, 360);
    g.fillStyle = '#c8241d';
    g.fillRect(16, 16, 224, 160);
    g.fillStyle = '#111';
    g.font = 'bold 40px sans-serif';
    g.textAlign = 'center';
    g.fillText('TOUGE', 128, 230);
    g.font = '22px sans-serif';
    g.fillText('NIGHT RUN', 128, 268);
    g.fillStyle = '#e9e1cc';
    g.beginPath();
    g.moveTo(30, 160);
    g.lineTo(110, 70);
    g.lineTo(150, 110);
    g.lineTo(190, 60);
    g.lineTo(230, 160);
    g.fill();
  });
  const post = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.98), lambert(0xffffff, { map: poster }));
  post.position.set(1.0, 1.9, -D + 0.02);
  scene.add(post);
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
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: sign, transparent: true, fog: false }));
  neon.position.set(-W + 0.02, 2.75, 0.6);
  neon.rotation.y = Math.PI / 2;
  scene.add(neon);

  // ---------- More of the workshop ----------
  // Workbenches: one along the front wall and one on the right by the door.
  const bench = (x, z, ry, len) => {
    const g = new THREE.Group();
    const add = (w, h, d, mat, px, py, pz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(px, py, pz);
      g.add(m);
    };
    add(len, 0.08, 0.8, wood, 0, 0.92, 0);
    add(len - 0.2, 0.05, 0.7, wood, 0, 0.25, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(0.07, 0.92, 0.07, steel, sx * (len / 2 - 0.15), 0.46, sz * 0.33);
    // Clutter: a toolbox, a vice, a battery, a box of bits, a can.
    add(0.45, 0.12, 0.28, lambert(0xb42a20), -len / 2 + 0.6, 1.02, 0);
    add(0.2, 0.16, 0.18, lambert(0x2d4f8a), len / 2 - 0.4, 1.04, -0.15);
    add(0.3, 0.22, 0.2, lambert(0x1b1c1e), 0.1, 1.07, 0.1);
    add(0.32, 0.2, 0.26, lambert(0xa4875a), -0.5, 1.06, -0.15);
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    scene.add(g);
  };
  bench(-1.5, D - 0.45, Math.PI, 3.2);
  bench(W - 0.45, -4.6, -Math.PI / 2, 2.6);

  // A tyre rack in the corner and more stacks of tyres.
  for (const [rx, rz] of [[-W + 1.5, D - 0.5]]) {
    for (const y of [0.05, 0.9, 1.75]) box(2.2, 0.05, 0.6, shelfMat, rx, y, rz);
    for (const sx of [-1.05, 1.05]) box(0.05, 2.0, 0.6, shelfMat, rx + sx, 1.0, rz);
    for (const y of [0.42, 1.27]) {
      for (let k = 0; k < 4; k++) {
        const t = new THREE.Mesh(tyreGeo, tyreMat);
        t.position.set(rx - 0.75 + k * 0.5, y, rz);
        scene.add(t);
      }
    }
  }
  for (const [x, z, n] of [[W - 1.1, D - 1.0, 5], [W - 1.9, D - 0.9, 3], [-W + 0.9, -D + 1.2, 4]]) {
    for (let k = 0; k < n; k++) {
      const t = new THREE.Mesh(tyreGeo, tyreMat);
      t.rotation.x = Math.PI / 2;
      t.position.set(x, 0.11 + k * 0.22, z);
      scene.add(t);
    }
  }

  // Jacks and axle stands.
  const floorJack = (x, z, ry) => {
    const j = new THREE.Group();
    j.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.8), red));
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 6), steel);
    h.rotation.x = 1.0;
    h.position.set(0, 0.35, 0.75);
    j.add(h);
    j.position.set(x, 0.08, z);
    j.rotation.y = ry;
    scene.add(j);
  };
  floorJack(-2.6, 3.4, -0.4);
  const standMat = lambert(0xe0b23a);
  for (const [x, z] of [[2.4, 4.2], [2.9, 4.4], [2.4, 4.8], [2.9, 5.0]]) {
    const st = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 4), standMat);
    st.position.set(x, 0.25, z);
    scene.add(st);
    box(0.06, 0.25, 0.06, standMat, x, 0.6, z);
  }

  // Posters on the walls.
  const posterTex = (bg, ink, accent, title, sub, draw) =>
    textTexture(null, 256, 360, (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, 256, 360);
      g.fillStyle = accent;
      g.fillRect(16, 16, 224, 170);
      draw?.(g);
      g.fillStyle = ink;
      g.textAlign = 'center';
      g.font = 'bold 34px sans-serif';
      g.fillText(title, 128, 240);
      g.font = '20px sans-serif';
      g.fillText(sub, 128, 276);
      g.fillRect(40, 300, 176, 4);
    });
  const mountains = (g) => {
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.moveTo(24, 180);
    g.lineTo(100, 80);
    g.lineTo(140, 120);
    g.lineTo(190, 60);
    g.lineTo(232, 180);
    g.fill();
  };
  const carShape = (g) => {
    g.fillStyle = '#111';
    g.fillRect(50, 120, 156, 30);
    g.fillRect(85, 95, 80, 28);
    g.fillStyle = '#ddd';
    g.beginPath();
    g.arc(85, 152, 14, 0, Math.PI * 2);
    g.arc(175, 152, 14, 0, Math.PI * 2);
    g.fill();
  };
  const rotor = (g) => {
    g.fillStyle = '#111';
    g.beginPath();
    g.moveTo(128, 50);
    g.quadraticCurveTo(200, 110, 190, 160);
    g.quadraticCurveTo(128, 175, 66, 160);
    g.quadraticCurveTo(56, 110, 128, 50);
    g.fill();
  };
  const posters = [
    [posterTex('#e9e1cc', '#111', '#c8241d', 'TOUGE', 'NIGHT RUN', mountains), -6.0, -D + 0.02, 0],
    [posterTex('#141414', '#f2c51e', '#f2c51e', 'DOWNHILL', 'NO BRAKES', carShape), 4.8, -D + 0.02, 0],
    [posterTex('#1d3a8a', '#f2f2f2', '#e6e6e6', 'ROTARY', 'BRAAAP', rotor), 6.3, -D + 0.02, 0],
    [posterTex('#f2f1ea', '#1f5a32', '#2f6b4f', 'KAIDO', 'MOUNTAIN PASS', mountains), 1.8, D - 0.02, Math.PI],
    [posterTex('#c8241d', '#fff', '#111', 'DRIFT', 'SIDEWAYS CLUB', carShape), -W + 0.02, -1.9, Math.PI / 2],
    [posterTex('#2a2a2a', '#e8711c', '#e8711c', 'HACHI', '1600 TWIN CAM', carShape), -W + 0.02, -3.5, Math.PI / 2],
  ];
  for (const [tex, x, z, ry] of posters) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.05), lambert(0xffffff, { map: tex }));
    m.position.set(x, 1.95, z);
    m.rotation.y = ry;
    scene.add(m);
  }

  // ---------- Clutter: the stuff that piles up in a real workshop ----------
  const cyl = (r, h, mat, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    scene.add(m);
    return m;
  };
  // Oil drums by the door.
  for (const [x, z, c] of [[6.6, -2.4, 0x2f5fa8], [6.0, -2.6, 0xb3241c], [5.45, -2.5, 0x3d6b3f]]) {
    cyl(0.29, 0.88, lambert(c), x, 0.44, z);
    cyl(0.3, 0.03, lambert(0x1b1c1e), x, 0.89, z);
  }
  // Stacks of cardboard boxes along the front wall.
  const card = lambert(0xa4875a);
  const card2 = lambert(0x8f7448);
  for (const [x, n] of [[0.9, 3], [1.5, 2], [2.1, 3], [2.7, 1]]) {
    for (let k = 0; k < n; k++) box(0.55, 0.42, 0.5, k % 2 ? card2 : card, x + (k % 2) * 0.05, 0.21 + k * 0.42, D - 0.35, k * 0.08);
  }
  // Spare wheels leaning against the back wall, and a set of four on the floor.
  const rimMat = lambert(0xc7c9cf);
  for (let k = 0; k < 3; k++) {
    const t = new THREE.Mesh(tyreGeo, tyreMat);
    t.position.set(3.6 + k * 0.28, 0.42, -D + 0.25);
    t.rotation.set(0.15, 0, 0);
    scene.add(t);
    cyl(0.2, 0.2, rimMat, 3.6 + k * 0.28, 0.42, -D + 0.25, Math.PI / 2 + 0.15);
  }
  for (let k = 0; k < 4; k++) {
    const t = new THREE.Mesh(tyreGeo, tyreMat);
    t.rotation.x = Math.PI / 2;
    t.position.set(-4.6, 0.11 + k * 0.22, -4.2);
    scene.add(t);
    cyl(0.2, 0.2, lambert(0xd6b04a), -4.6, 0.11 + k * 0.22, -4.2);
  }
  // An engine crane by the engine stand.
  const crane = new THREE.Group();
  const cm = (w, h, d, x, y, z, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), red);
    m.position.set(x, y, z);
    m.rotation.z = rz;
    crane.add(m);
  };
  cm(0.1, 1.7, 0.1, 0, 0.85, 0);
  cm(1.4, 0.1, 0.1, 0.55, 1.65, 0, -0.25);
  cm(0.1, 0.06, 1.2, 0, 0.05, 0.3);
  cm(1.0, 0.06, 0.1, 0.4, 0.05, 0.8);
  crane.position.set(3.7, 0, -4.3);
  crane.rotation.y = 0.6;
  scene.add(crane);
  // An air compressor and its hose by the left wall.
  cyl(0.22, 0.75, red, -6.6, 0.32, -3.2, Math.PI / 2);
  box(0.4, 0.3, 0.4, lambert(0x2b2b2b), -6.6, 0.75, -3.0);
  const hose = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.025, 6, 20), lambert(0xe0b23a));
  hose.position.set(-6.4, 0.05, -2.3);
  hose.rotation.x = Math.PI / 2;
  scene.add(hose);
  // An old fridge, a stool with a radio on it, a fan, a broom and a bucket.
  box(0.62, 1.5, 0.62, lambert(0xd9d6cc), -4.0, 0.75, D - 0.4);
  box(0.05, 0.4, 0.04, lambert(0x8a8a8a), -3.72, 1.05, D - 0.72);
  cyl(0.18, 0.04, wood, -1.2, 0.62, -D + 1.3);
  for (const [dx, dz] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]]) cyl(0.02, 0.6, steel, -1.2 + dx, 0.3, -D + 1.3 + dz);
  box(0.34, 0.2, 0.12, lambert(0x3a3a3a), -1.2, 0.74, -D + 1.3, 0.4);
  cyl(0.2, 0.05, lambert(0x2d4f8a), -5.6, 1.0, -D + 0.6, Math.PI / 2);
  cyl(0.02, 1.0, steel, -5.6, 0.5, -D + 0.6);
  cyl(0.015, 1.4, wood, 6.9, 0.7, 4.6, 0, 0.12);
  box(0.3, 0.06, 0.08, lambert(0xb3241c), 6.85, 0.05, 4.6);
  cyl(0.16, 0.3, lambert(0x2f5fa8), 6.2, 0.15, 5.3);
  // Exhaust pipes and a bumper hung up on the left wall, a hose reel on the right.
  for (let k = 0; k < 3; k++) cyl(0.04, 2.2, lambert(k === 1 ? 0x9a9da2 : 0x6d6f73), -W + 0.12, 2.75 + k * 0.12, 0.6, Math.PI / 2);
  box(0.12, 0.2, 1.6, lambert(0x1d1e21), -W + 0.1, 2.4, 0.6);
  const reel = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.06, 6, 16), lambert(0x3d8a4a));
  reel.position.set(W - 0.12, 1.9, -1.9);
  reel.rotation.y = Math.PI / 2;
  scene.add(reel);
  // ---------- Body panels: a project car's worth, stripped and stored ----------
  // Hard-edged, flat panels in all the colours they came off in: white, red, black, blue, grey
  // primer and bare metal.
  const panelMats = [0xe6e3d8, 0xa4231c, 0x1d1e21, 0x2a4a7a, 0x8d8f91, 0xa7aaae, 0x6d4a2e].map((c) => lambert(c, { flatShading: true }));
  const glassMat = lambert(0x1b2329, { transparent: true, opacity: 0.55 });
  const extrude = (pts, holes, depth) => {
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const h of holes) sh.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    return g;
  };
  // Each panel stands upright in its own x/y plane, centred, thickness along z.
  const PANELS = {
    // Door: square-cut frame round the window, the window glass still in some.
    door: (mat, glass) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(extrude([[-0.58, -0.5], [0.58, -0.5], [0.58, 0.05], [0.5, 0.5], [-0.58, 0.5]], [[[-0.5, 0.1], [0.46, 0.1], [0.4, 0.43], [-0.5, 0.43]]], 0.07), mat));
      if (glass) g.add(new THREE.Mesh(extrude([[-0.5, 0.1], [0.46, 0.1], [0.4, 0.43], [-0.5, 0.43]], [], 0.01), glassMat));
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.03), lambert(0x111111));
      handle.position.set(0.38, -0.02, 0.045);
      g.add(handle);
      return g;
    },
    hood: (mat) => new THREE.Mesh(extrude([[-0.68, -0.62], [0.68, -0.62], [0.6, 0.62], [-0.6, 0.62]], [], 0.05), mat),
    trunk: (mat) => new THREE.Mesh(extrude([[-0.66, -0.36], [0.66, -0.36], [0.64, 0.36], [-0.64, 0.36]], [], 0.05), mat),
    // Front wing with a straight-sided, cut-off wheel arch.
    fender: (mat) => new THREE.Mesh(extrude([[-0.55, -0.32], [-0.42, -0.32], [-0.34, -0.06], [-0.12, 0.04], [0.12, 0.04], [0.34, -0.06], [0.42, -0.32], [0.55, -0.32], [0.55, 0.3], [-0.55, 0.3]], [], 0.05), mat),
    bumper: (mat) => new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.17, 0.13), mat),
  };
  const panel = (kind, mi, x, y, z, rx, ry, rz, glass = false) => {
    const m = PANELS[kind](panelMats[mi], glass);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz, 'YXZ');
    scene.add(m);
    return m;
  };
  const FLAT = -Math.PI / 2; // lying flat on its face
  // A tall steel rack along the front wall, full of panels.
  {
    const rx = 4.8;
    const rz = D - 0.42;
    const rackMat = lambert(0x3a5f8a);
    for (const y of [0.12, 1.05, 1.95]) box(2.9, 0.05, 0.75, steel, rx, y, rz);
    for (const sx of [-1.43, 1.43]) for (const sz of [-0.35, 0.35]) box(0.06, 2.7, 0.06, rackMat, rx + sx, 1.35, rz + sz);
    // Bottom: doors standing on edge, side by side, and a bumper on the floor in front.
    panel('door', 0, rx - 0.75, 0.67, rz, 0, 0.05, 0.02, true);
    panel('door', 1, rx - 0.75, 0.67, rz - 0.12, 0, -0.04, -0.03);
    panel('door', 4, rx + 0.6, 0.67, rz + 0.1, 0, 0.1, 0.0, true);
    panel('bumper', 2, rx + 0.4, 0.21, rz - 0.18, 0, 0.06, 0);
    // Middle: a hood and a boot lid stacked flat, a wing on top.
    panel('hood', 3, rx - 0.6, 1.11, rz, FLAT, 0.03, 0);
    panel('trunk', 5, rx + 0.75, 1.11, rz, FLAT, -0.05, 0);
    panel('fender', 0, rx + 0.7, 1.17, rz + 0.02, FLAT, 0.2, 0);
    // Top: wings and bumpers.
    panel('fender', 4, rx - 0.75, 2.01, rz, FLAT, -0.1, 0);
    panel('fender', 1, rx - 0.6, 2.07, rz + 0.05, FLAT, 0.25, 0);
    panel('bumper', 5, rx + 0.55, 2.06, rz + 0.12, 0, 0.02, 0);
    panel('bumper', 2, rx + 0.55, 2.06, rz - 0.15, 0, -0.03, 0);
    panel('trunk', 6, rx + 0.6, 2.33, rz, -0.15, 0.02, 0);
  }
  // More on the rack: every shelf crammed, things hanging off the ends.
  {
    const rx = 4.8;
    const rz = D - 0.42;
    for (let k = 0; k < 3; k++) panel('door', [3, 5, 2][k], rx + 0.1 + k * 0.08, 0.67, rz - 0.05 + k * 0.13, 0, 0.12 - k * 0.08, 0.02 * k, k === 1);
    for (let k = 0; k < 3; k++) panel('hood', [0, 4, 2][k], rx - 0.62, 1.17 + k * 0.06, rz + 0.02 * k, FLAT, 0.03 - k * 0.04, 0);
    for (let k = 0; k < 2; k++) panel('trunk', [1, 4][k], rx + 0.78, 1.17 + k * 0.06, rz - 0.02 * k, FLAT, 0.05 * k, 0);
    panel('bumper', 2, rx - 0.2, 2.21, rz + 0.25, 0, 0.12, 0);
    for (let k = 0; k < 3; k++) panel('fender', [2, 3, 5][k], rx - 0.7 + k * 0.08, 2.13 + k * 0.06, rz - 0.05, FLAT, -0.3 + k * 0.25, 0);
    panel('door', 6, rx + 0.55, 2.47, rz + 0.05, 0, 0.0, 0.01);
  }
  // A pallet stacked with hoods and boot lids, by the right wall.
  {
    const px = 5.6;
    const pz = 3.9;
    const wood2 = lambert(0x8a6a44);
    for (const dz of [-0.5, 0, 0.5]) box(1.3, 0.1, 0.12, wood2, px, 0.05, pz + dz);
    box(1.3, 0.03, 1.2, wood2, px, 0.115, pz);
    const stack = ['hood', 'hood', 'trunk', 'hood', 'trunk', 'hood'];
    stack.forEach((kind, k) => panel(kind, (k * 3) % 7, px + (k % 2 ? 0.04 : -0.03), 0.16 + k * 0.055, pz + (k % 3) * 0.03, FLAT, Math.PI / 2 + (k % 2 ? 0.06 : -0.05), 0));
  }
  // A row of bumpers stood on end against the left wall, and a heap of wings on the floor.
  for (let k = 0; k < 4; k++) {
    const b = panel('bumper', [2, 5, 2, 0][k], -W + 0.18 + k * 0.05, 0.8, -4.3 + k * 0.2, 0, Math.PI / 2, Math.PI / 2 - 0.1);
    b.rotation.set(0, Math.PI / 2, Math.PI / 2 - 0.12);
  }
  for (let k = 0; k < 5; k++) panel('fender', [4, 0, 1, 5, 3][k], 1.6 + (k % 2) * 0.15, 0.03 + k * 0.05, -4.5 + (k % 3) * 0.1, FLAT, k * 0.7, 0);
  // Doors leaning in a row against the back wall's end.
  for (let k = 0; k < 4; k++) panel('door', [1, 4, 0, 2][k], 5.6 + k * 0.1, 0.52, -D + 0.18 + k * 0.1, -0.15 - k * 0.03, 0, 0, k % 2 === 0);

  // Panels leaning against the walls.
  panel('hood', 1, -W + 0.32, 0.62, -5.0, -0.25, Math.PI / 2, 0);
  panel('hood', 4, -W + 0.42, 0.62, -4.9, -0.32, Math.PI / 2 + 0.05, 0);
  panel('door', 2, W - 0.2, 0.52, 3.3, -0.12, -Math.PI / 2, 0);
  panel('door', 0, W - 0.3, 0.52, 3.45, -0.18, -Math.PI / 2 + 0.06, 0, true);
  panel('trunk', 3, W - 0.25, 0.37, 2.25, -0.2, -Math.PI / 2, 0);
  panel('fender', 5, 1.05, 0.33, -D + 0.12, -0.25, 0, 0);
  // And on the floor round the car: stripped off and dropped where the work is.
  panel('bumper', 5, 2.5, 0.07, -2.5, Math.PI / 2, 0.4, 0);
  panel('fender', 2, -2.45, 0.03, 2.7, FLAT, 0.9, 0);
  panel('door', 4, -2.7, 0.04, -1.3, FLAT, 0.15, 0);
  panel('trunk', 0, 2.7, 0.03, 2.4, FLAT, -0.5, 0);
  panel('bumper', 2, -2.2, 0.07, -3.4, Math.PI / 2, -0.25, 0);
  // Moving blankets under the floor panels.
  for (const [x, z, ry] of [[-2.7, -1.3, 0.15], [-2.45, 2.7, 0.9]]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.3), lambert(0x34507a));
    b.rotation.set(-Math.PI / 2, 0, ry);
    b.position.set(x, 0.008, z);
    scene.add(b);
  }

  // Rubber mat under the car, and a drop light hanging from the ceiling.
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 5.6), lambert(0x1d1e20));
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(0, 0.006, 0.2);
  scene.add(mat);
  cyl(0.008, 1.0, lambert(0x111111), -0.6, H - 0.6, 1.4);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }));
  bulb.position.set(-0.6, H - 1.15, 1.4);
  scene.add(bulb);
  const drop = new THREE.PointLight(0xffd59a, 3, 5, 1.6);
  drop.position.copy(bulb.position);
  scene.add(drop);

  // A creeper left beside the car.
  const padMat = lambert(0x1b1c1e);
  const creeper = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, 1.0), lambert(0x232427));
  board.position.y = 0.09;
  creeper.add(board);
  for (const [cx, cz] of [[-0.18, -0.4], [0.18, -0.4], [-0.18, 0.4], [0.18, 0.4]]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), padMat);
    w.position.set(cx, 0.04, cz);
    creeper.add(w);
  }
  creeper.position.set(1.75, 0, -1.4);
  creeper.rotation.y = 0.5;
  scene.add(creeper);

  // The car stands on its wheels in the middle of the floor.
  const table = new THREE.Group();
  table.position.set(0, -0.08, 0.2); // (the car's own height sits it on the floor)
  table.userData.lift = 0;
  scene.add(table);
  return table;
}

// Wheel positions for a car model standing still (what syncWheels needs in place of the physics).
function fakeWheels(spec) {
  return {
    mountY: spec.wheelMountY,
    wheels: [
      [spec.trackFront / 2, spec.frontAxleZ, true],
      [-spec.trackFront / 2, spec.frontAxleZ, true],
      [spec.trackRear / 2, spec.rearAxleZ, false],
      [-spec.trackRear / 2, spec.rearAxleZ, false],
    ].map(([x, z, front]) => ({ x, z, front, compression: 0, steer: 0, angle: 0 })),
  };
}

// Set a car model on its wheels with its setup: each corner sinks by its share of the weight over
// its spring rate, wheels pushed out by their offset. lifted: up on the lift, so the body sits at
// its normal height (the lift raises the whole thing) and the wheels hang down at full droop.
function seatCar(model, spec, t, fake, lifted = false) {
  const ws = wheelSetup(t);
  model.applySetup(t);
  const rh = t.coilovers ? Math.max(-0.2, Math.min(0.05, (t.rideHeight || 0) / 1000)) : 0;
  const mountY = spec.wheelMountY - rh;
  fake.mountY = mountY;
  const g = (spec.mass * 9.81) / 4;
  for (const w of fake.wheels) {
    w.baseX ??= w.x;
    w.x = w.baseX + Math.sign(w.baseX) * (w.front ? ws.pokeFront : ws.pokeRear);
    w.compression = Math.min(spec.suspensionRest, (g * (w.front ? 1.04 : 0.96)) / (t.coilovers ? (w.front ? t.springFront : t.springRear) : w.front ? TUNABLE_DEFAULTS.springFront : TUNABLE_DEFAULTS.springRear));
  }
  const yF = mountY - spec.suspensionRest + fake.wheels[0].compression;
  const yR = mountY - spec.suspensionRest + fake.wheels[2].compression;
  // Body origin height so the tyres sit on the floor, with the rake from the springs.
  model.root.position.y = 0.08 + ws.radius - (yF + yR) / 2;
  model.root.rotation.x = lifted ? 0 : Math.atan2(yF - yR, spec.frontAxleZ - spec.rearAxleZ);
  if (lifted) for (const w of fake.wheels) w.compression = 0;
  model.syncWheels(fake);
}

export class Shop {
  constructor(el, tune, onChange, wallet) {
    this.el = el;
    this.tune = tune;
    this.onChange = onChange;
    this.wallet = wallet;
    this.tab = 'car';
    this.isOpen = false;
    this.scene = new THREE.Scene();
    this.table = buildGarage(this.scene);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 80);
    this.car = new CarModel(CAR);
    this.table.add(this.car.root);
    // The camera walks round the car: which way it looks from, how high, and how far back.
    this.yaw = -2.4; // front three-quarter view
    this.pitch = 0.22;
    this.dist = 6.4;
    this.dragging = false;
    this.revHeld = false; // the rev button is held down
    this.fake = fakeWheels(CAR);
    // Your other cars, parked by the roller door, each with its own saved setup.
    let slot = 0;
    for (const spec of Object.values(CARS)) {
      if (spec.id === BASE_CAR.id) continue;
      const model = new CarModel(spec);
      const own = { ...TUNABLE_DEFAULTS, paint: '#' + spec.paint.toString(16).padStart(6, '0'), finalDrive: spec.finalDrive, ...(carSave('tuning', spec.id) || {}) };
      const holder = new THREE.Group();
      holder.position.set(5.4 - slot * 0.2, -0.08, 0.6 - slot * 5.2);
      holder.rotation.y = Math.PI + 0.12;
      holder.add(model.root);
      this.scene.add(holder);
      seatCar(model, spec, own, fakeWheels(spec));
      slot++;
    }
    this.#applyCar();
  }

  open() {
    this.render();
    this.el.classList.remove('hidden');
    document.body.classList.add('in-shop');
    this.isOpen = true;
  }

  close() {
    this.revHeld = false;
    this.el.classList.add('hidden');
    document.body.classList.remove('in-shop');
    this.isOpen = false;
    this.onClose?.();
  }

  // Size the view so the car sits in the open space left of the panel.
  resize(w, h) {
    this.camera.aspect = w / Math.max(1, h);
    const panel = Math.min(w * 0.56, 520);
    this.camera.setViewOffset(w, h, panel / 2, 0, w, h);
    this.camera.updateProjectionMatrix();
  }

  // Aim the camera at the car from where you have walked to, staying inside the workshop.
  update(dt) {
    this.car.updateFx(dt);
    const target = new THREE.Vector3(0, 0.9, 0.2);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    // Walls at x = ±7.2 and z = ±6.2: pull the camera in rather than through them.
    let d = this.dist;
    if (Math.abs(dir.x) > 1e-3) d = Math.min(d, (6.7 - Math.sign(dir.x) * target.x) / Math.abs(dir.x));
    if (Math.abs(dir.z) > 1e-3) d = Math.min(d, (5.7 - Math.sign(dir.z) * target.z) / Math.abs(dir.z));
    if (dir.y > 1e-3) d = Math.min(d, (3.3 - target.y) / dir.y);
    d = Math.max(2.6, d);
    this.camera.position.copy(target).addScaledVector(dir, d);
    // Low down you can crouch and look under the car on the lift, but not through the floor.
    this.camera.position.y = Math.max(0.3, this.camera.position.y);
    this.camera.lookAt(target);
  }

  #applyCar() {
    seatCar(this.car, CAR, this.tune, this.fake, this.table.userData.lift > 0);
  }

  #change(key, value, rerender = false) {
    // Parts must be bought before they are fitted.
    const w = this.wallet;
    if (w && !w.owns(key, value)) {
      if (!w.buy(key, value)) {
        this.flashMsg = `Not enough money: ${money(w.price(key, value))} needed`;
        this.render();
        return;
      }
      this.flashMsg = w.unlimited ? 'Fitted' : `Bought for ${money(w.price(key, value))}`;
      rerender = true;
    }
    this.tune[key] = value;
    if (key === 'wheel') rerender = true; // its colour choices change with it
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
      card.innerHTML = '<strong></strong><span></span><em></em>';
      card.querySelector('strong').textContent = opt.name;
      card.querySelector('span').textContent = opt.blurb;
      this.#tag(card.querySelector('em'), key, valueOf(id));
      card.addEventListener('click', () => this.#change(key, valueOf(id), true));
      row.append(card);
    }
    return row;
  }

  // Price tag on a card: OWNED, or the price (red when you cannot afford it).
  #tag(el, key, value) {
    const w = this.wallet;
    if (!w || !w.price(key, value) || w.owns(key, value)) {
      el.textContent = w && w.price(key, value) ? 'OWNED' : '';
      el.className = 'owned';
      return;
    }
    el.textContent = money(w.price(key, value));
    el.className = w.price(key, value) > w.balance ? 'price pricey' : 'price';
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
      const price = this.wallet && !this.wallet.owns(key, value) ? this.wallet.price(key, value) : 0;
      if (price) {
        const tag = document.createElement('small');
        tag.textContent = money(price);
        b.append(tag);
        if (price > this.wallet.balance) b.classList.add('pricey');
      }
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

  // The colours the fitted wheel comes in (none shown if it only comes in one).
  #wheelColorChips() {
    const id = this.tune.wheel in WHEELS ? this.tune.wheel : 'bbs';
    const cols = Object.keys(WHEELS[id].colors || {});
    if (cols.length < 2) return [];
    return [this.#chips('Colour', 'wheelColor', cols.map((k) => [k, WHEEL_COLORS[k][0]]), wheelColorOf(id, this.tune.wheelColor))];
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
        ),
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
    if (this.tab === 'car') {
      // Your garage: pick the car you drive. Your tuning comes with you.
      const row = document.createElement('div');
      row.className = 'shop-cards';
      for (const c of Object.values(CARS)) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'shop-card' + (c.id === CAR.id ? ' sel' : '');
        card.innerHTML = '<strong></strong><span></span><em class="owned"></em>';
        card.querySelector('strong').textContent = c.name;
        card.querySelector('span').textContent = c.blurb;
        card.querySelector('em').textContent = c.id === CAR.id ? 'DRIVING' : '';
        card.addEventListener('click', () => c.id !== CAR.id && this.onCar?.(c.id));
        row.append(card);
      }
      return [this.#section('Your cars', row, this.#hint('Switching car reloads the game. Each car keeps its own parts, paint and builds.'))];
    }
    if (this.tab === 'interior') {
      return [this.#section('Seats', this.#cards(SEATS, 'seats')), this.#section('Weight reduction', this.#cards(WEIGHTS, 'weight'))];
    }
    if (this.tab === 'wheels') {
      return [
        this.#section('Rims', this.#cards(WHEELS, 'wheel'), ...this.#wheelColorChips()),
        this.#section(
          'Size & fitment',
          this.#chips('Rim size', 'rim', RIM_SIZES.map((r) => [r, `${r}"`])),
          this.#slider('offsetFront', 'Front offset', -20, 60, 5, offset),
          this.#slider('offsetRear', 'Rear offset', -20, 60, 5, offset),
        ),
        this.#section(
          'Tyres',
          this.#cards(TIRES, 'tire'),
          this.#slider('profile', 'Sidewall', 30, 75, 5, (v) => `${v}% · ${v <= 40 ? 'Stretched thin' : v <= 50 ? 'Low profile' : v <= 60 ? 'Sporty' : 'Tall & soft'}`),
          ...(t.tire !== 'semi'
            ? [this.#chips('Tyre fit', 'stretch', [[false, 'Normal'], [true, 'Stretched']])]
            : [this.#hint('Stretched tyres are not made in semi-slick.')]),
        ),
      ];
    }
    if (this.tab === 'builds') return [this.#builds()];
    if (this.tab === 'dyno') return [this.#dyno()];
    if (this.tab === 'engine') {
      if (this.swapView) return [this.#swapPanel()];
      return [
        this.#section('Engine swap', this.#engineNow(), this.#swapButton()),
        this.#section('Intake', this.#cards(INTAKES, 'intake')),
        this.#section('Turbo', this.#cards(TURBOS, 'turbo')),
        this.#section('Exhaust', this.#cards(EXHAUSTS, 'exhaust')),
      ];
    }
    if (this.tab === 'drive') {
      return [
        this.#section('Clutch', this.#cards(CLUTCHES, 'clutch')),
        this.#section(
          'Gearbox',
          this.#cards(GEARBOXES, 'gearbox'),
          this.#chips('Final drive', 'finalDrive', FINAL_DRIVES.map((f) => [f, f.toFixed(2)])),
          this.#hint('A higher final drive number is shorter: quicker out of corners, lower top speed.'),
        ),
        this.#section('Differential', this.#cards(DIFFS, 'diff')),
      ];
    }
    if (this.tab === 'brakes') {
      return [
        this.#section('Brakes', this.#cards(BRAKES, 'brakes'), this.#slider('brakeBias', 'Brake bias', 0.5, 0.8, 0.01, (v) => `${Math.round(v * 100)}% front`)),
        this.#section('Handbrake', this.#cards(HANDBRAKES, 'handbrake')),
        this.#section('Steering angle', this.#cards(ANGLE_KITS, 'angleKit')),
      ];
    }
    // Suspension: only coilovers can be adjusted.
    return [
      this.#section(
        'Dampers',
        this.#chips('Suspension', 'coilovers', [[false, 'Stock'], [true, 'Coilovers']]),
        ...(t.coilovers
          ? [
              this.#slider('rideHeight', 'Ride height', -200, 30, 5, (v) => (v === 0 ? 'Stock' : `${v > 0 ? '+' : ''}${v} mm`)),
              this.#slider('springFront', 'Front stiffness', 18000, 90000, 1000, stiffness),
              this.#slider('springRear', 'Rear stiffness', 18000, 90000, 1000, stiffness),
            ]
          : [this.#hint('Stock struts and springs can’t be adjusted. Fit coilovers to set ride height and stiffness.')]),
      ),
      this.#section(
        'Alignment',
        this.#slider('camberFront', 'Front camber', 0, 6, 0.5, (v) => `${deg(v)}${v > 3.5 ? ' · too much' : v >= 2 ? ' · grippy' : ''}`),
        this.#slider('camberRear', 'Rear camber', 0, 6, 0.5, (v) => `${deg(v)}${v > 3.5 ? ' · too much' : v >= 2 ? ' · grippy' : ''}`),
      ),
      this.#section(
        'Sway bars',
        this.#chips('Front bar', 'antiRollFront', Object.entries(SWAY_FRONT).map(([k, v]) => [v, label[k]]), SWAY_FRONT[nearestKey(SWAY_FRONT, t.antiRollFront)]),
        this.#chips('Rear bar', 'antiRollRear', Object.entries(SWAY_REAR).map(([k, v]) => [v, label[k]]), SWAY_REAR[nearestKey(SWAY_REAR, t.antiRollRear)]),
      ),
      this.#section(
        'Strut tower braces',
        this.#chips('Front brace', 'strutFront', [[false, 'None'], [true, 'Fitted']]),
        this.#chips('Rear brace', 'strutRear', [[false, 'None'], [true, 'Fitted']]),
      ),
    ];
  }

  // ---------- Engine swaps ----------
  // What is under the bonnet now.
  #engineNow() {
    const sw = ENGINE_SWAPS[CAR.swap];
    const box = document.createElement('div');
    box.className = 'swap-now';
    box.innerHTML = '<span>Fitted</span><b></b><small></small>';
    box.querySelector('b').textContent = sw ? sw.name : `${CAR.engineName} (factory)`;
    box.querySelector('small').textContent = sw ? `from the ${sw.donor}` : `The ${BASE_CAR.name}'s own engine`;
    return box;
  }

  #swapButton() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'big swap-open';
    b.textContent = 'ENGINE SWAPS';
    b.addEventListener('click', () => {
      this.swapView = true;
      this.render();
    });
    return b;
  }

  // Every engine you can swap in, with its specs and the car it comes from.
  #swapPanel() {
    const box = this.#section('Engine swaps');
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'swap-back';
    back.textContent = '\u2190 Back to engine parts';
    back.addEventListener('click', () => {
      this.swapView = false;
      this.render();
    });
    box.append(back);
    const fitted = CAR.swap || 'stock';
    const list = document.createElement('div');
    list.className = 'swap-list';
    const stockCard = {
      name: `${BASE_CAR.engineName} (factory)`,
      donor: BASE_CAR.name,
      blurb: BASE_CAR.blurb,
      ready: true,
      factory: true,
    };
    // (A car's own engine is the factory card, not a swap: no 13B swap into an RX-7.)
    for (const [id, sw] of [['stock', stockCard], ...Object.entries(ENGINE_SWAPS).filter(([, w]) => w.code !== BASE_CAR.engineName)]) {
      const card = document.createElement('div');
      card.className = 'swap-card' + (id === fitted ? ' sel' : '') + (sw.ready ? '' : ' soon');
      const head = document.createElement('div');
      head.className = 'swap-head';
      head.innerHTML = '<strong></strong><em></em>';
      head.querySelector('strong').textContent = sw.name;
      const tag = head.querySelector('em');
      if (id === fitted) {
        tag.textContent = 'FITTED';
        tag.className = 'owned';
      } else if (!sw.ready) {
        tag.textContent = 'COMING SOON';
        tag.className = 'soon';
      } else this.#tag(tag, 'engine', id);
      const donor = document.createElement('div');
      donor.className = 'swap-donor';
      donor.textContent = sw.factory ? `Factory engine of the ${sw.donor}` : `From the ${sw.donor}`;
      card.append(head, donor);
      if (!sw.factory) {
        const specs = document.createElement('dl');
        specs.className = 'swap-specs';
        for (const [k, v] of [
          ['Layout', sw.layout],
          ['Size', sw.displacement],
          ['Air', sw.aspiration],
          ['Power', `${sw.hp} hp @ ${sw.hpRpm.toLocaleString('en-US')}`],
          ['Torque', `${sw.nm} Nm @ ${sw.nmRpm.toLocaleString('en-US')}`],
          ['Redline', `${sw.redline.toLocaleString('en-US')} rpm`],
          ['Weight', `${sw.kg} kg (${sw.kg - BASE_CAR.engineKg >= 0 ? '+' : ''}${sw.kg - BASE_CAR.engineKg} kg vs the ${BASE_CAR.engineName})`],
        ]) {
          const dt = document.createElement('dt');
          dt.textContent = k;
          const dd = document.createElement('dd');
          dd.textContent = v;
          specs.append(dt, dd);
        }
        card.append(specs);
      }
      const p = document.createElement('p');
      p.textContent = sw.blurb;
      card.append(p);
      if (sw.ready && id !== fitted) {
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'big';
        go.textContent = id === 'stock' ? 'PUT THE FACTORY ENGINE BACK' : 'SWAP IT IN';
        go.addEventListener('click', () => this.#swapTo(id));
        card.append(go);
      }
      list.append(card);
    }
    box.append(list, this.#hint('Swapping the engine reloads the game. Your other parts stay fitted; intake and turbo work on any engine.'));
    return box;
  }

  #swapTo(id) {
    const w = this.wallet;
    if (id !== 'stock' && w && !w.owns('engine', id) && !w.buy('engine', id)) {
      this.flashMsg = `Not enough money: ${money(w.price('engine', id))} needed`;
      this.render();
      return;
    }
    this.tune.engine = id;
    this.onChange();
    this.onEngine?.();
  }

  // Plate text: up to 7 letters and numbers, upper case as you type.

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
    const box0 = document.createElement('div');
    box0.className = 'shop-wheel';
    box0.append(this.#colourWheel());
    const name = PAINTS.find(([, hex]) => hex === (this.tune.paint || '').toLowerCase());
    const p = this.#hint(name ? name[0] : `Custom ${this.tune.paint}`);
    const box = document.createElement('div');
    box.append(wrap, box0, p);
    return box;
  }

  // Colour wheel: tap or drag on the wheel for hue (around) and richness (out from the middle),
  // and the slider underneath for how light or dark the paint is.
  #colourWheel() {
    const [h0, s0, l0] = hexToHsl(this.tune.paint || '#efeee6');
    const state = { h: h0, s: s0, l: l0 };
    const wrap = document.createElement('div');
    wrap.className = 'colour-wheel';
    const c = document.createElement('canvas');
    const size = 150;
    c.width = c.height = size * 2;
    c.style.width = c.style.height = `${size}px`;
    const g = c.getContext('2d');
    const draw = () => {
      const R = size;
      const img = g.createImageData(R * 2, R * 2);
      for (let y = 0; y < R * 2; y++) {
        for (let x = 0; x < R * 2; x++) {
          const dx = x - R;
          const dy = y - R;
          const d = Math.hypot(dx, dy) / R;
          const k = (y * R * 2 + x) * 4;
          if (d > 1) continue;
          const [r, gg, b] = hslToRgb(((Math.atan2(dy, dx) / (2 * Math.PI)) + 1) % 1, d, state.l);
          img.data.set([r, gg, b, 255], k);
        }
      }
      g.putImageData(img, 0, 0);
      // Marker for the current colour.
      const a = state.h * 2 * Math.PI;
      g.lineWidth = 5;
      g.strokeStyle = state.l > 0.55 ? '#000' : '#fff';
      g.beginPath();
      g.arc(R + Math.cos(a) * state.s * R, R + Math.sin(a) * state.s * R, 12, 0, Math.PI * 2);
      g.stroke();
    };
    const apply = () => {
      draw();
      this.#change('paint', hslToHex(state.h, state.s, state.l));
      swatch.style.background = this.tune.paint;
    };
    const pick = (e) => {
      const r = c.getBoundingClientRect();
      const dx = e.clientX - r.left - r.width / 2;
      const dy = e.clientY - r.top - r.height / 2;
      state.h = ((Math.atan2(dy, dx) / (2 * Math.PI)) + 1) % 1;
      state.s = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
      apply();
    };
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pick(e);
    });
    c.addEventListener('pointermove', (e) => {
      if (c.hasPointerCapture(e.pointerId)) pick(e);
    });
    const side = document.createElement('div');
    side.className = 'colour-side';
    const swatch = document.createElement('div');
    swatch.className = 'colour-swatch';
    swatch.style.background = this.tune.paint;
    const label = document.createElement('label');
    label.className = 'shop-slider';
    label.innerHTML = '<span>Dark ↔ light</span>';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = 0.04;
    slider.max = 0.96;
    slider.step = 0.01;
    slider.value = state.l;
    slider.addEventListener('input', () => {
      state.l = Number(slider.value);
      apply();
    });
    label.append(slider);
    side.append(swatch, label);
    wrap.append(c, side);
    draw();
    return wrap;
  }

  // Dyno sheet: torque and power against rpm for this setup, with stock dashed behind it.
  #dyno() {
    const box = this.#section('Dyno');
    const now = dynoRun(this.tune);
    const stock = dynoRun({ ...TUNABLE_DEFAULTS, torque: this.tune.torque }, BASE_CAR.engine);
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
    const maxRpm = Math.ceil(Math.max(now.pts.at(-1).rpm, stock.pts.at(-1).rpm) / 1000) * 1000;
    const X = (rpm) => pad.l + ((rpm - 1000) / (maxRpm - 1000)) * (W - pad.l - pad.r);
    const Yn = (nm) => H - pad.b - (nm / maxNm) * (H - pad.t - pad.b);
    const Yh = (hp) => H - pad.b - (hp / maxHp) * (H - pad.t - pad.b);
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    g.font = "14px 'VT323', monospace";
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.textAlign = 'center';
    for (let rpm = 1000; rpm <= maxRpm; rpm += 1000) {
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
        let missing = 0;
        for (const k of SHOP_KEYS) {
          const v = b.tune?.[k] ?? TUNABLE_DEFAULTS[k];
          // Parts you no longer own (or never bought) stay as they are.
          if (this.wallet && !this.wallet.owns(k, v)) missing++;
          else this.tune[k] = v;
        }
        this.#applyCar();
        this.onChange();
        this.flash = missing ? `Loaded "${b.name}" except ${missing} part(s) you don't own yet` : `Loaded "${b.name}"`;
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

    // The workshop view: drag to walk round the car, pinch (or scroll) to step in and out.
    const stage = document.createElement('div');
    stage.className = 'shop-stage';
    const pts = new Map();
    let pinch = 0;
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.shop-rev')) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      stage.setPointerCapture(e.pointerId);
      this.dragging = true;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = Math.hypot(a[0] - b[0], a[1] - b[1]);
      }
    });
    stage.addEventListener('pointermove', (e) => {
      const last = pts.get(e.pointerId);
      if (!last) return;
      const now = [e.clientX, e.clientY];
      pts.set(e.pointerId, now);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch > 0) this.dist = Math.max(3, Math.min(9, this.dist * (pinch / d)));
        pinch = d;
        return;
      }
      this.yaw -= (now[0] - last[0]) * 0.008;
      this.pitch = Math.max(-0.12, Math.min(1.1, this.pitch + (now[1] - last[1]) * 0.006));
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      pinch = 0;
      this.dragging = pts.size > 0;
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.dist = Math.max(3, Math.min(9, this.dist * (1 + Math.sign(e.deltaY) * 0.08)));
      },
      { passive: false },
    );
    // Hold to rev the engine.
    const rev = document.createElement('button');
    rev.type = 'button';
    rev.className = 'shop-rev';
    rev.setAttribute('aria-label', 'Hold to rev the engine');
    rev.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 22a11 11 0 1 1 22 0" /><path d="M16 22l6-8" /><circle cx="16" cy="22" r="2" /></svg><span>REV</span>';
    const revOn = (e) => {
      e.preventDefault();
      rev.setPointerCapture?.(e.pointerId);
      this.revHeld = true;
      rev.classList.add('on');
      this.onRev?.();
    };
    const revOff = () => {
      this.revHeld = false;
      rev.classList.remove('on');
    };
    rev.addEventListener('pointerdown', revOn);
    rev.addEventListener('pointerup', revOff);
    rev.addEventListener('pointercancel', revOff);
    rev.addEventListener('lostpointercapture', revOff);
    rev.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.append(rev);
    const title = document.createElement('div');
    title.className = 'shop-car';
    title.innerHTML = '<b></b><span>Drag to look around · pinch to zoom</span>';
    title.querySelector('b').textContent = CAR.name;
    this.readoutEl = document.createElement('div');
    this.readoutEl.className = 'shop-readout';
    stage.append(title, this.readoutEl);
    this.#readout();

    const panel = document.createElement('div');
    panel.className = 'shop-panel';
    const head = document.createElement('div');
    head.className = 'shop-head';
    head.innerHTML = '<h2>TUNING SHOP</h2><span class="shop-money"></span>';
    if (this.wallet) head.querySelector('.shop-money').textContent = money(this.wallet.balance);
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
        this.swapView = false;
        this.render();
      });
      tabs.append(b);
    }
    const body = document.createElement('div');
    body.className = 'shop-body';
    if (this.flashMsg) {
      const note = document.createElement('p');
      note.className = 'shop-flash' + (this.flashMsg.startsWith('Not') ? ' bad' : '');
      note.textContent = this.flashMsg;
      body.append(note);
      this.flashMsg = '';
    }
    body.append(...this.#tabContent());
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'big ghost';
    reset.textContent = 'REFIT STOCK PARTS';
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
