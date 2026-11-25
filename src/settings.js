// Player settings and tuning values, saved on the device.
import { TUNABLE_DEFAULTS, BASE_CAR, carKey, carSave } from './config.js';

const KEY = 'touge.settings.v4';
// The roads there are (kept here so settings need not load the road code).
const ROADS = ['dragon', 'berthoud', 'tunitas-down', 'tunitas-up', 'us276-up', 'us276-down', 'chiefjoseph-west', 'chiefjoseph-east'];
// Roads only offered one way: an old save naming the other direction moves to the best one.
const BEST = { 'tunitas-up': 'tunitas-down', 'us276-up': 'us276-down', 'chiefjoseph-west': 'chiefjoseph-east' };

const DEFAULTS = {
  mode: 'manual', // 'manual' | 'autoClutch' | 'auto'
  camera: 'chase', // 'chase' | 'bumper'
  sound: true,
  steering: 'buttons', // 'buttons' | 'slider'
  shifter: 'drag', // 'drag' | 'tap'
  vhs: true,
  picture: 'sharp', // 'sharp' | 'retro'
  map: 'dragon', // which road (see TRACKS)
  time: 'night', // 'day' | 'sunset' | 'night'
  stage: -1, // world map: which road to start on (-1 = the whole route)
  money: 'unlimited', // 'career' | 'unlimited'
  fov: 60, // driving camera field of view, 50..150
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
  // Older saves may name a road that is gone (Akina, Kaido Mountain): back to the Dragon's Tail.
  const s = { ...DEFAULTS, ...read(KEY), stage: -1 };
  if (!ROADS.includes(s.map)) s.map = 'dragon';
  s.map = BEST[s.map] ?? s.map;
  return s;
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
