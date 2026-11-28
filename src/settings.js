// Player settings and tuning values, saved on the device.
import { TUNABLE_DEFAULTS, BASE_CAR, carKey, carSave } from './config.js';

const KEY = 'touge.settings.v4';
// The roads there are (kept here so settings need not load the road code).
const ROADS = ['dragon', 'tunitas-down', 'tunitas-up', 'us276-up', 'us276-down'];
// Roads only offered one way: an old save naming the other direction moves to the best one.
const BEST = { 'tunitas-up': 'tunitas-down', 'us276-up': 'us276-down' };

// Each camera's adjustments as it comes.
export const CAM_DEFAULTS = {
  chase: { fov: 60, tilt: 0, x: 0, closer: 0 },
  cockpit: { fov: 88, tilt: 0, x: 0, closer: 0 },
  bumper: { fov: 70, tilt: 0, x: 0, closer: 0 },
};

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
  fov: 60, // (old: one field of view for every camera; now per camera in cams)
  driveMode: 'free', // 'free' (Free Roam) | 'touge' (races)
  driveMusic: 'song1', // music while driving: 'song1' | 'song2' | 'menu' | 'off'
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
  // Camera adjustments, one set per camera: field of view, tilt (deg, + looks up), centre (-100
  // left .. 100 right) and closer (-100 further back .. 100 closer to the windscreen / car).
  const old = (s.fov ?? 60) - 60; // an older single FOV setting carries over
  const def = { chase: 60 + old, cockpit: 88 + old, bumper: 70 + old };
  s.cams = s.cams || {};
  for (const m of Object.keys(CAM_DEFAULTS)) s.cams[m] = { ...CAM_DEFAULTS[m], fov: Math.max(40, Math.min(150, def[m])), ...(s.cams[m] || {}) };
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
  // The short-lived "factory" wheels (from the downloaded E30 model, since removed) go back to BBS.
  // Rims no longer sold (and the short-lived factory ones) go back to the Style 5s.
  if (t && !['bbs', 'bottlecap', 'watanabe', 'te37', 'rpf1'].includes(t.wheel)) t.wheel = 'bbs';
  // Cars already running a turbo from before internals existed keep it, on forged internals.
  if (t && t.turbo && t.turbo !== 'none' && t.internals !== 'forged') t.internals = 'forged';
  // Bucket seats (and their locked camera) are gone.
  if (t?.seats === 'bucket') t.seats = 'stock';
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
