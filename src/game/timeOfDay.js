// Time of day: fixed presets or the automatic cycle
// (30 min day -> 5 min sunset -> 30 min night -> 5 min sunrise).

export const TIME_MODES = ['auto', 'sunrise', 'day', 'sunset', 'night'];

const PRESETS = {
  day: {
    skyTop: [0.18, 0.42, 0.88],
    skyHorizon: [0.62, 0.76, 0.92],
    fog: [0.66, 0.76, 0.88],
    sunColor: [0.92, 0.88, 0.78],
    ambient: [0.5, 0.52, 0.58],
    sunElev: 0.95,
    sunAzim: 0.6,
    fogNear: 70,
    fogFar: 560,
    ranges: [0.62, 0.7, 0.85],
    stars: 0,
    lights: 0,
  },
  sunset: {
    skyTop: [0.24, 0.22, 0.48],
    skyHorizon: [0.98, 0.56, 0.28],
    fog: [0.82, 0.52, 0.38],
    sunColor: [1.0, 0.62, 0.34],
    ambient: [0.42, 0.34, 0.4],
    sunElev: 0.08,
    sunAzim: 2.4,
    fogNear: 50,
    fogFar: 430,
    ranges: [0.55, 0.38, 0.45],
    stars: 0.15,
    lights: 1,
  },
  night: {
    skyTop: [0.01, 0.02, 0.06],
    skyHorizon: [0.06, 0.08, 0.16],
    fog: [0.04, 0.05, 0.09],
    sunColor: [0.16, 0.2, 0.32], // moonlight
    ambient: [0.13, 0.14, 0.2],
    sunElev: 0.7,
    sunAzim: -1.2,
    fogNear: 15,
    fogFar: 190,
    ranges: [0.07, 0.08, 0.13],
    stars: 1,
    lights: 1,
  },
  sunrise: {
    skyTop: [0.32, 0.46, 0.72],
    skyHorizon: [0.98, 0.78, 0.58],
    fog: [0.86, 0.78, 0.72],
    sunColor: [1.0, 0.8, 0.6],
    ambient: [0.46, 0.44, 0.5],
    sunElev: 0.1,
    sunAzim: -0.4,
    fogNear: 25,
    fogFar: 300, // morning mist
    ranges: [0.7, 0.62, 0.66],
    stars: 0,
    lights: 0,
  },
};

const CYCLE = [
  // [start minute, preset at start]
  [0, 'day'],
  [28, 'day'],
  [32.5, 'sunset'],
  [37, 'night'],
  [63, 'night'],
  [66.5, 'sunrise'],
  [70, 'day'],
];
export const CYCLE_MINUTES = 70;

function mixPreset(a, b, t) {
  const out = {};
  for (const k of Object.keys(a)) {
    const va = a[k];
    const vb = b[k];
    out[k] = Array.isArray(va) ? va.map((v, i) => v + (vb[i] - v) * t) : va + (vb - va) * t;
  }
  return out;
}

// minutes: position in the 70-minute cycle.
export function cyclePreset(minutes) {
  const m = ((minutes % CYCLE_MINUTES) + CYCLE_MINUTES) % CYCLE_MINUTES;
  for (let i = 0; i < CYCLE.length - 1; i++) {
    const [m0, p0] = CYCLE[i];
    const [m1, p1] = CYCLE[i + 1];
    if (m >= m0 && m < m1) return mixPreset(PRESETS[p0], PRESETS[p1], (m - m0) / (m1 - m0));
  }
  return PRESETS.day;
}

export function presetFor(mode, cycleMinutes) {
  return mode === 'auto' ? cyclePreset(cycleMinutes) : PRESETS[mode];
}

export function cycleLabel(minutes) {
  const m = ((minutes % CYCLE_MINUTES) + CYCLE_MINUTES) % CYCLE_MINUTES;
  if (m < 30) return 'DAY';
  if (m < 35) return 'SUNSET';
  if (m < 65) return 'NIGHT';
  return 'SUNRISE';
}
