// Real roads: Berthoud Pass, Tunitas Creek Rd, US-276 and the Chief Joseph Highway. Each is laid
// out from a list of pieces (straights, corners, hairpins and runs of random bends), carrying its
// own climb, how much the corners are banked, and what grows and stands beside it. Built the same
// every time (fixed seeds). Pure JavaScript, testable in Node.
//
// A piece:
//   { S: metres }                   straight
//   { T: degrees, r: radius }       a corner (+ one way, - the other)
//   { H: +1 | -1, r }               a hairpin (180 degrees)
//   { W: metres, r: [min, max], a: [min, max] degrees, gap: max straight between }  random bends
//   { E: radius }                   swing back round to due east
//   { mark: 'name' }                remember where this is (metres along the road)
// Any piece can also set g (grade, + climbing in the direction it is built), b (banking: share of
// the usual amount, 0 = flat) and sc (scenery name); they carry on until changed.

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RAD = Math.PI / 180;

export function layRoute(pieces, seed = 1) {
  const rand = mulberry(seed);
  const base = Math.PI / 2; // due east
  const pts = [[0, 0]];
  const per = []; // per metre: [grade, bank, scene]
  const marks = {};
  let x = 0;
  let z = 0;
  let h = base;
  let g = 0;
  let b = 0.5;
  let sc = 'pine';
  const step = (len, k) => {
    for (let d = 0; d < len; d++) {
      h += k;
      x += Math.sin(h);
      z += Math.cos(h);
      pts.push([x, z]);
      per.push([g, b, sc]);
    }
  };
  for (const p of pieces) {
    if (p.g != null) g = p.g;
    if (p.b != null) b = p.b;
    if (p.sc != null) sc = p.sc;
    if (p.mark) marks[p.mark] = per.length;
    if (p.S) step(Math.round(p.S), 0);
    if (p.T) step(Math.round(Math.abs(p.T) * RAD * p.r), (Math.sign(p.T) * 1) / p.r);
    if (p.H) step(Math.round(Math.PI * p.r), p.H / p.r);
    // Swing back round to due east (before a stack of switchbacks, so the legs that double back
    // run alongside a straight rather than across the bends before it).
    if (p.E) {
      const d = base - h;
      if (Math.abs(d) > 0.02) step(Math.round(Math.abs(d) * p.E), Math.sign(d) / p.E);
    }
    if (p.W) {
      // Random bends that keep the road heading east overall (within 70 degrees), like the
      // Dragon's Tail, so they can never fold back across themselves.
      const limit = 70 * RAD;
      const end = per.length + p.W;
      let side = rand() < 0.5 ? 1 : -1;
      while (per.length < end) {
        if (rand() < 0.75) side = -side;
        const radius = p.r[0] + Math.pow(rand(), 1.3) * (p.r[1] - p.r[0]);
        let angle = (p.a[0] + rand() * (p.a[1] - p.a[0])) * RAD;
        const dev = h - base;
        if (Math.abs(dev + side * angle) > limit) {
          if (Math.abs(dev - side * angle) <= limit) side = -side;
          else angle = Math.max(0.2, limit - Math.abs(dev));
          if (Math.abs(dev + side * angle) > limit) side = -Math.sign(dev) || 1;
        }
        step(Math.round(angle * radius), side / radius);
        step(Math.round(rand() * (p.gap ?? 20)), 0);
      }
    }
  }
  per.push(per[per.length - 1]);
  // Height along the road from the grades.
  const y = [0];
  for (let i = 0; i < per.length - 1; i++) y.push(y[i] + per[i][0]);
  return { pts, per, y, length: per.length - 1, marks };
}

// What grows and stands beside the road. forest: the kind of trees; trees: how thick (1 normal);
// ground: the colour of the land; rock: how often the uphill side is a bare rock cut; bush: how
// thick the undergrowth is; snow: patches of old snow; maple: patches of autumn colour.
export const SCENES = {
  pine: { forest: 'pine', trees: 1, ground: 'forest', rock: 0.55, bush: 1, maple: 0 },
  pineRock: { forest: 'pine', trees: 0.65, ground: 'forest', rock: 1, bush: 0.6, maple: 0 },
  treeline: { forest: 'krummholz', trees: 0.35, ground: 'tundra', rock: 1, bush: 0.3, snow: 0.35, maple: 0 },
  alpine: { forest: 'krummholz', trees: 0.08, ground: 'tundra', rock: 1, bush: 0.15, snow: 0.6, maple: 0 },
  aspen: { forest: 'pine', trees: 0.85, ground: 'forest', rock: 0.4, bush: 1, maple: 0.25, aspen: true },
  redwood: { forest: 'redwood', trees: 1.25, ground: 'redwood', rock: 0.25, bush: 1.6, maple: 0, ferns: true },
  oakGrass: { forest: 'oak', trees: 0.45, ground: 'grass', rock: 0.1, bush: 0.4, maple: 0 },
  coast: { forest: 'oak', trees: 0.05, ground: 'grass', rock: 0.05, bush: 0.3, maple: 0 },
  hardwood: { forest: 'hardwood', trees: 1.25, ground: 'hardwood', rock: 0.85, bush: 1.6, maple: 0.35, rhodo: true },
  ridge: { forest: 'hardwood', trees: 0.8, ground: 'hardwood', rock: 0.9, bush: 1.2, maple: 0.45, rhodo: true },
  sage: { forest: 'juniper', trees: 0.2, ground: 'sage', rock: 0.7, bush: 1, maple: 0, sagebrush: true },
  sageRock: { forest: 'juniper', trees: 0.3, ground: 'sage', rock: 1, bush: 0.8, maple: 0, sagebrush: true },
  basin: { forest: 'pine', trees: 0.6, ground: 'sage', rock: 0.6, bush: 0.9, maple: 0, sagebrush: true },
};

// A TRACKS entry for a real road, one way or the other.
// def: { name, blurb, pieces, seed, width, peaks, relief, waterfalls, lots, stages, town, lakes, ... }
// lots: [{ at: 'mark' or metres, len, side: 'out' | 'both' | +1 | -1, width, label, cars, surface }]
function realTrack(def, reverse = false) {
  let route = null;
  const get = () => (route ??= layRoute(def.pieces, def.seed));
  // Fraction along the road as driven -> fraction along the road as built.
  const fb = (f) => (reverse ? 1 - f : f);
  const at = (a) => (typeof a === 'string' ? get().marks[a] : a);
  const per = (f) => {
    const r = get();
    return r.per[Math.max(0, Math.min(r.per.length - 1, Math.round(fb(f) * r.length)))];
  };
  const t = {
    name: def.name,
    blurb: def.blurb,
    real: true,
    road() {
      const r = get();
      const pts = reverse ? [...r.pts].reverse() : r.pts;
      const yAt = (f) => {
        const s = fb(f) * r.length;
        const i = Math.max(0, Math.min(r.length - 1, Math.floor(s)));
        return r.y[i] + (r.y[i + 1] - r.y[i]) * (s - i);
      };
      return new Road(pts, 0, { world: true, width: def.width || 'wide', profile: yAt, bankAt: (f) => per(f)[1] });
    },
    sceneAt: (f) => SCENES[per(f)[2]] || SCENES.pine,
    cornerLights: false,
    shrines: false,
    rails: def.rails ?? true,
    relief: def.relief ?? 160,
    peaks: def.peaks ?? 900,
    waterfalls: def.waterfalls ?? 0,
    rockCuts: true,
    town: def.town ?? false,
    lakes: def.lakes ? (road) => def.lakes(road, reverse) : () => [],
    // Fractions along the road as driven.
    landmarks: () =>
      (def.landmarks || []).map((l) => ({ ...l, f: fb(at(l.at) / get().length), side: typeof l.side === 'number' ? (reverse ? -l.side : l.side) : l.side })),
    stopsOpts: {
      noStation: !def.station,
      noShow: true,
      lots: () =>
        (def.lots || []).map((l) => ({ ...l, f: fb(at(l.at) / get().length), side: typeof l.side === 'number' ? (reverse ? -l.side : l.side) : l.side })),
    },
  };
  if (def.stages) {
    // A road made of runs (Berthoud: the climb and the descent): each with its own start and
    // finish, in metres along the road.
    let list = null;
    Object.defineProperty(t, 'stages', {
      get: () => (list ??= def.stages(get).list.map((st) => ({ ...st, s0: st.f0 * get().length, s1: st.f1 * get().length }))),
    });
    t.stageAt = (s) => {
      const L = t.stages;
      let k = 0;
      while (k + 1 < L.length && L[k + 1].s0 <= s) k++;
      return k;
    };
  }
  return t;
}

import { Road } from './road.js';

// ---------------------------------------------------------------------------------------------
// Berthoud Pass, US-40, Colorado: from the Empire side up a stack of switchbacks through the pines
// to the summit on the Continental Divide (above the trees), then down the far side to Winter Park.

const SW = (dir, leg, r, extra = {}) => [{ H: dir, r, g: 0.035, b: 0.12, ...extra }, { S: leg, g: 0.075, b: 0.3 }];

const BERTHOUD = {
  name: 'Berthoud Pass',
  seed: 40,
  peaks: 1500,
  relief: 260,
  waterfalls: 2,
  station: true,
  town: { r: 120 },
  pieces: [
    { S: 140, g: 0.01, b: 0.4, sc: 'pine' },
    { W: 700, r: [60, 140], a: [20, 50], gap: 60, g: 0.045, b: 0.6 },
    { S: 120, g: 0.055 },
    { T: 60, r: 48, b: 0.35 },
    { S: 90 },
    { T: -60, r: 52 },
    { E: 70, g: 0.06 },
    { S: 260 },
    // The first stack of switchbacks.
    ...SW(1, 210, 16),
    ...SW(-1, 230, 17),
    ...SW(1, 210, 15),
    ...SW(-1, 160, 18),
    // Faster banked sweepers between the stacks.
    { W: 650, r: [70, 130], a: [25, 45], gap: 50, g: 0.065, b: 2.4, sc: 'pineRock' },
    { E: 70, g: 0.07, b: 0.35 },
    { S: 240 },
    // The second stack, up through the last of the trees.
    ...SW(1, 200, 16, { sc: 'treeline' }),
    ...SW(-1, 200, 17),
    { S: 150, g: 0.05, b: 0.4, sc: 'alpine' },
    { T: 25, r: 140 },
    { T: -25, r: 140 },
    { S: 90, g: 0.02 },
    { mark: 'summit' },
    { S: 150, g: 0.0, b: 0.3 },
    // Down the Winter Park side.
    { S: 120, g: -0.04 },
    { T: 55, r: 60, g: -0.065, b: 0.35 },
    { S: 100 },
    { T: -80, r: 42, b: 0.2 },
    { S: 140, sc: 'treeline' },
    { T: 70, r: 55, b: 0.35 },
    { S: 120, sc: 'pine' },
    { W: 900, r: [55, 120], a: [25, 60], gap: 50, g: -0.06, b: 2 },
    { S: 160, b: 0.4, sc: 'aspen', g: -0.04 },
    { W: 700, r: [80, 160], a: [20, 40], gap: 70, g: -0.035, b: 1.6 },
    { S: 220, g: -0.01, b: 0.3 },
  ],
  lots: [
    // The summit: a big lot on the Continental Divide with the sign and a few parked cars.
    { at: 'summit', len: 90, side: 'out', width: 22, label: ['BERTHOUD PASS', 'ELEV 11,307 FT', 'CONTINENTAL DIVIDE'], cars: 4, surface: 'asphalt' },
  ],
  stages: (get) => {
    const r = get();
    const s = r.marks.summit;
    return {
      list: [
        { name: 'Climb from Empire', blurb: 'Up the east-side switchbacks to the summit lot', f0: 0, f1: (s + 45) / r.length },
        { name: 'Down to Winter Park', blurb: 'From the summit lot down the west side', f0: (s + 60) / r.length, f1: 1 },
      ],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Tunitas Creek Rd, near Half Moon Bay, California: built from Skyline at the ridge, down through
// the redwoods (narrow, choppy, no banking), then out into the open grass hills to the coast.

const TUNITAS = {
  name: 'Tunitas Creek',
  seed: 650,
  width: 'narrow',
  rails: false,
  peaks: 420,
  relief: 120,
  pieces: [
    { S: 120, g: 0, b: 0.05, sc: 'redwood' },
    { W: 3600, r: [14, 40], a: [35, 120], gap: 14, g: -0.072 },
    { S: 60, g: -0.05, sc: 'oakGrass' },
    { W: 1900, r: [40, 110], a: [25, 70], gap: 50, g: -0.035, b: 0.1 },
    { W: 500, r: [70, 160], a: [15, 40], gap: 60, g: -0.015, sc: 'coast' },
    { S: 130, g: 0 },
  ],
  lots: [
    { at: 60, len: 46, side: 'both', width: 11, label: ['SKYLINE BLVD', 'TUNITAS CREEK RD'], surface: 'asphalt', culdesac: true },
    { at: 1e9, len: 46, side: 'both', width: 11, label: ['TUNITAS CREEK RD', 'HWY 1 · PACIFIC OCEAN'], surface: 'asphalt', culdesac: true },
  ],
  // The Pacific, past the coast end.
  lakes: (road, reverse) => {
    const i = reverse ? 0 : road.count - 1;
    const j = reverse ? 20 : road.count - 21;
    const dx = road.x[i] - road.x[j];
    const dz = road.z[i] - road.z[j];
    const d = Math.hypot(dx, dz);
    return [{ x: road.x[i] + (dx / d) * 900, z: road.z[i] + (dz / d) * 900, r: 760, level: road.y[i] - 12, ocean: true }];
  },
};

// ---------------------------------------------------------------------------------------------
// US-276, Pisgah National Forest, North Carolina: built from the forest entrance near Brevard,
// along the creek past Looking Glass Falls, then up the switchbacks to the Blue Ridge Parkway.

const US276 = {
  name: 'US-276 Pisgah',
  seed: 276,
  peaks: 650,
  relief: 170,
  waterfalls: 2,
  pieces: [
    { S: 140, g: 0.004, b: 0.3, sc: 'hardwood' },
    { W: 1300, r: [40, 95], a: [30, 80], gap: 35, g: 0.025, b: 2 },
    { S: 60, mark: 'falls' },
    { S: 120, b: 0.3 },
    { W: 1500, r: [35, 85], a: [30, 85], gap: 35, g: 0.035, b: 1.8 },
    { E: 70, g: 0.05, b: 0.35 },
    { S: 260 },
    ...SW(1, 220, 18),
    ...SW(-1, 240, 19),
    { W: 600, r: [35, 70], a: [30, 70], gap: 30, g: 0.06, b: 0.4, sc: 'ridge' },
    { E: 60 },
    { S: 260 },
    ...SW(1, 200, 17),
    ...SW(-1, 180, 18),
    { S: 160, g: 0.03, b: 0.3 },
    { S: 150, g: 0 },
  ],
  lots: [
    { at: 40, len: 60, side: 'out', width: 18, label: ['PISGAH', 'NATIONAL FOREST'], surface: 'gravel', wood: true },
    { at: 'falls', len: 50, side: 'out', width: 12, label: ['LOOKING GLASS', 'FALLS'], surface: 'gravel', falls: true, stone: true },
    { at: 1e9, len: 70, side: 'out', width: 16, label: ['BLUE RIDGE', 'PARKWAY OVERLOOK'], surface: 'asphalt', stone: true, cars: 2 },
  ],
};

// ---------------------------------------------------------------------------------------------
// Chief Joseph Highway, WY-296: built from the sagebrush junction on the Cody side, up the big
// open Dead Indian switchbacks to the summit overlook, down into Sunlight Basin's fast banked
// sweepers, and over the Sunlight Creek Bridge to a lot just past it.

const CHIEF = {
  name: 'Chief Joseph Hwy',
  seed: 296,
  peaks: 1300,
  relief: 240,
  waterfalls: 1,
  pieces: [
    { S: 160, g: 0.004, b: 0.4, sc: 'sage' },
    { W: 900, r: [150, 320], a: [10, 30], gap: 160, g: 0.02, b: 2.5 },
    { E: 120, g: 0.04, b: 0.5, sc: 'sageRock' },
    { S: 320 },
    ...SW(1, 280, 26, { b: 0.45 }),
    ...SW(-1, 300, 28, { b: 0.45 }),
    ...SW(1, 280, 27, { b: 0.45 }),
    ...SW(-1, 260, 29, { b: 0.45 }),
    ...SW(1, 240, 27, { b: 0.45 }),
    { T: -170, r: 30, g: 0.035, b: 0.45 },
    { S: 200, g: 0.05 },
    { T: 20, r: 200, g: 0.01 },
    { S: 60, mark: 'summit' },
    { S: 140, g: 0 },
    // Down into Sunlight Basin.
    { W: 1500, r: [130, 260], a: [20, 45], gap: 120, g: -0.055, b: 3.6, sc: 'basin' },
    { W: 1300, r: [110, 240], a: [20, 50], gap: 110, g: -0.03, b: 3.6 },
    { S: 180, g: -0.01, b: 0.4, sc: 'sageRock' },
    { mark: 'bridge0' },
    { S: 130, g: 0, b: 0 },
    { mark: 'bridge1' },
    { S: 80 },
    { mark: 'endLot' },
    { S: 140, sc: 'basin' },
  ],
  lots: [
    { at: 40, len: 60, side: 'out', width: 20, label: ['CHIEF JOSEPH', 'SCENIC HWY · WY 296'], surface: 'gravel' },
    { at: 'summit', len: 80, side: 'out', width: 20, label: ['DEAD INDIAN PASS', 'SUMMIT OVERLOOK'], surface: 'gravel', cars: 3, stone: true },
    { at: 'endLot', len: 60, side: 'out', width: 18, label: ['SUNLIGHT CREEK', 'BRIDGE'], surface: 'gravel', cars: 1 },
  ],
  bridge: ['bridge0', 'bridge1'],
};

// Bridges: [{ f0, f1 }] as driven.
function withBridge(def, t, reverse) {
  if (!def.bridge) return t;
  let route = null;
  const get = () => (route ??= layRoute(def.pieces, def.seed));
  t.bridges = () => {
    const r = get();
    const a = r.marks[def.bridge[0]] / r.length;
    const b = r.marks[def.bridge[1]] / r.length;
    return [{ f0: reverse ? 1 - b : a, f1: reverse ? 1 - a : b, depth: 70, name: 'SUNLIGHT CREEK' }];
  };
  return t;
}

// Each road is offered in its best direction only (downhill, the touge way). The other direction
// is still built here (and tested) but marked hidden: it never appears in the game, and an old
// save that names it is moved to the road's best direction (see `best`).
export const REAL_TRACKS = {
  berthoud: (() => {
    const t = realTrack(BERTHOUD);
    t.blurb = 'Colorado · Empire to Winter Park over the Continental Divide';
    t.region = 'Colorado, USA';
    t.desc = 'Up two stacks of switchbacks through the pines, out above the trees to the summit lot on the Continental Divide, then down the long west side to Winter Park.';
    return t;
  })(),
  'tunitas-down': Object.assign(realTrack(TUNITAS), {
    name: 'Tunitas Creek',
    blurb: 'California · Skyline ridge down through the redwoods to the coast',
    region: 'California, USA',
    desc: 'Narrow, rail-free and dark under the redwoods, a creek beside you the whole way, then out into golden grass hills and down to the Pacific.',
  }),
  'tunitas-up': Object.assign(realTrack(TUNITAS, true), { name: 'Tunitas Creek (uphill)', hidden: true, best: 'tunitas-down' }),
  'us276-down': Object.assign(realTrack(US276, true), {
    name: 'US-276 Pisgah',
    blurb: 'North Carolina · from the Parkway down past the falls to Brevard',
    region: 'North Carolina, USA',
    desc: 'From the Blue Ridge Parkway overlook down the switchbacks, then along the creek through hardwoods, rhododendron and rock walls, past Looking Glass Falls.',
  }),
  'us276-up': Object.assign(realTrack(US276), { name: 'US-276 Pisgah (uphill)', hidden: true, best: 'us276-down' }),
  'chiefjoseph-east': withBridge(CHIEF, Object.assign(realTrack(CHIEF, true), {
    name: 'Chief Joseph Hwy',
    blurb: 'Wyoming · over the Sunlight Creek Bridge and down Dead Indian Pass to Cody',
    region: 'Wyoming, USA',
    desc: 'Fast banked sweepers through Sunlight Basin, across the bridge over the gorge, then down the open Dead Indian switchbacks through sagebrush and red rock.',
  }), true),
  'chiefjoseph-west': withBridge(CHIEF, Object.assign(realTrack(CHIEF), { name: 'Chief Joseph Hwy (uphill)', hidden: true, best: 'chiefjoseph-east' }), false),
};
