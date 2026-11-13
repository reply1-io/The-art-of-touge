// Player settings and tuning values, saved on the device.
import { TUNABLE_DEFAULTS } from './config.js';

const KEY = 'touge.settings.v4';
const TUNE_KEY = 'touge.tuning.v3';

const DEFAULTS = {
  mode: 'manual', // 'manual' | 'autoClutch' | 'auto'
  camera: 'chase', // 'chase' | 'bumper'
  sound: true,
  steering: 'buttons', // 'buttons' | 'slider'
  shifter: 'drag', // 'drag' | 'tap'
  vhs: true,
  picture: 'sharp', // 'sharp' | 'retro'
  map: 'akina', // 'akina' | 'dragon'
  time: 'night', // 'day' | 'sunset' | 'night'
  blur: true, // edge blur at speed
  money: 'unlimited', // 'career' | 'unlimited'
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
  return { ...DEFAULTS, ...read(KEY) };
}

export function saveSettings(s) {
  write(KEY, s);
}

export function loadTuning() {
  return { ...TUNABLE_DEFAULTS, ...read(TUNE_KEY) };
}

export function saveTuning(t) {
  write(TUNE_KEY, t);
}

// Saved builds: three named slots, each a copy of the tuning-shop setup.
const BUILDS_KEY = 'touge.builds.v1';

export function loadBuilds() {
  const b = read(BUILDS_KEY);
  const slots = Array.isArray(b.slots) ? b.slots : [];
  return [0, 1, 2].map((i) => (slots[i] && typeof slots[i] === 'object' ? slots[i] : null));
}

export function saveBuilds(slots) {
  write(BUILDS_KEY, { slots });
}
