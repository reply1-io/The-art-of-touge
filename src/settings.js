// Player settings and tuning values, saved on the device.
import { TUNABLE_DEFAULTS } from './config.js';

const KEY = 'touge.settings.v2';
const TUNE_KEY = 'touge.tuning.v2';

const DEFAULTS = {
  mode: 'manual', // 'manual' | 'autoClutch' | 'auto'
  camera: 'chase', // 'chase' | 'bumper'
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
