// Player settings and tuning values, saved on the device.
import { TUNABLE_DEFAULTS, BASE_CAR, carKey, carSave } from './config.js';

const KEY = 'touge.settings.v4';

const DEFAULTS = {
  mode: 'manual', // 'manual' | 'autoClutch' | 'auto'
  camera: 'chase', // 'chase' | 'bumper'
  sound: true,
  steering: 'buttons', // 'buttons' | 'slider'
  shifter: 'drag', // 'drag' | 'tap'
  vhs: true,
  picture: 'sharp', // 'sharp' | 'retro'
  map: 'dragon', // the Dragon's Tail is the only road
  time: 'night', // 'day' | 'sunset' | 'night'
  stage: -1, // world map: which road to start on (-1 = the whole route)
  money: 'unlimited', // 'career' | 'unlimited'
  driveMode: 'free', // 'free' (Free Roam) | 'touge' (races)
  netName: '',
  netServer: '',
};

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private browsing); settings then last for this visit only.
  }
}

export function loadSettings() {
  // The Dragon's Tail is the only road; older saves may name Akina or Kaido Mountain.
  return { ...DEFAULTS, ...read(KEY), map: 'dragon', stage: -1 };
}

export function saveSettings(s) {
  write(KEY, s);
}

// Tuning and builds are kept per car. The first car to load claims any old shared save
// (see carSave), so another car never picks up the same setup.
function claim(kind) {
  const c = read('touge.legacyClaim');
  if (!c[kind]) write('touge.legacyClaim', { ...c, [kind]: BASE_CAR.id });
}

export function loadTuning() {
  const t = carSave('tuning');
  claim('tuning');
  return { ...TUNABLE_DEFAULTS, ...(t || {}) };
}

export function saveTuning(t) {
  claim('tuning');
  write(carKey('tuning'), t);
}

// Saved builds: three named slots per car, each a copy of the tuning-shop setup.
export function loadBuilds() {
  const b = carSave('builds') || {};
  claim('builds');
  const slots = Array.isArray(b.slots) ? b.slots : [];
  return [0, 1, 2].map((i) => (slots[i] && typeof slots[i] === 'object' ? slots[i] : null));
}

export function saveBuilds(slots) {
  claim('builds');
  write(carKey('builds'), { slots });
}
