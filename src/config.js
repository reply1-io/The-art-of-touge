import { loadDesigns } from './builder/customStore.js';
// BMW E30 325i (1988, M20B25 2.5 straight-six). Numbers follow the real car where known.
// Values in TUNABLE can be changed live from the dev tuning panel.

const E30 = {
  id: 'e30',
  shape: 'e30',
  name: 'BMW E30 325i',
  blurb: '2.5 straight-six, 170 hp, 6,500 rpm. Heavier nose, smooth and torquey: easy to balance.',
  mass: 1230, // kg with driver and fuel (the six is heavier than the 318is four)
  // Body box used for the collider (half extents, metres): width, height, length.
  halfExtents: { x: 0.8, y: 0.32, z: 2.12 },
  // Centre of mass relative to the body origin (low, slightly forward).
  centerOfMass: { x: 0, y: -0.18, z: 0.1 }, // a little more nose-heavy with the long six
  // Principal moments of inertia (pitch about x, yaw about y, roll about z).
  inertia: { x: 1650, y: 1950, z: 470 },
  dragArea: 0.66, // Cd 0.38 x 1.74 m2
  rollingResistance: 0.013,

  wheelbase: 2.57,
  trackFront: 1.407,
  trackRear: 1.415,
  frontAxleZ: 1.28, // relative to the body origin
  rearAxleZ: -1.29,
  wheelMountY: -0.1, // suspension top, relative to the body origin
  wheelRadius: 0.305, // 195/65 R14 (325i: 14" BBS cross-spokes)
  wheelWidth: 0.195,
  wheelInertia: 1.0, // kg m2: wheel, tyre, hub and brake rotor
  suspensionRest: 0.3, // free length of the strut travel used by the raycast
  suspensionTravel: 0.18, // bump travel before the bump stop
  maxSteer: (36 * Math.PI) / 180,

  engine: {
    idleRpm: 945, // the idle control settles about 45 rpm below this, so it idles at 900
    idleMaxThrottle: 0.25, // most the idle control will open the throttle (it needs about 0.15 to hold idle)
    redline: 6500,
    limiterRpm: 6600,
    limiterResumeRpm: 6350,
    stallRpm: 430,
    inertia: 0.22, // kg m2: the six's longer crank and heavier flywheel
    // rpm -> N m at full throttle (M20B25: 170 hp at 5,800 rpm, 222 N m at 4,300 rpm)
    torqueCurve: [
      [0, 110],
      [800, 160],
      [1500, 182],
      [2500, 200],
      [3500, 214],
      [4300, 222],
      [5000, 218],
      [5800, 208],
      [6300, 196],
      [6600, 186],
      [7000, 165],
    ],
    frictionTorque: 22, // N m at zero rpm when off throttle
    frictionPerRpm: 0.008, // extra engine braking per rpm (closed-throttle pumping losses)
  },

  // Getrag 260 five-speed, 3.73 final drive (the 325i's limited-slip axle).
  gears: [3.83, 2.2, 1.4, 1.0, 0.81],
  reverse: 3.46,
  finalDrive: 3.73,
  drivelineEfficiency: 0.9,
  clutchTorque: 340, // N m capacity

  brakeTorqueFront: 1800, // N m per wheel at full pedal (vented front discs)
  brakeTorqueRear: 820,
  handbrakeTorque: 1900, // N m per rear wheel

  paint: 0xefeee6, // Alpine White
  engineName: 'M20B25',
  engineKg: 175, // the iron-block six, dressed
  sound: 'm20',
};

export const CARS = { e30: E30 };

// Cars you made in the Car Builder (kept in this browser): each drives like the car it is built on.
for (const d of loadDesigns()) {
  const base = CARS[d.base] || E30;
  if (CARS[d.id]) continue;
  CARS[d.id] = { ...base, id: d.id, shape: d.id, name: d.name || 'My car', blurb: `Your build · drives like the ${base.name}`, custom: true };
  if (d.paint) CARS[d.id].paint = parseInt(d.paint.slice(1), 16);
}

// ---------- Engine swaps (tuning shop, Engine tab) ----------
// Each: what it is, the car it comes from, its specs for the shop card, and (when it can be fitted)
// the engine model the physics runs. `ready: false` swaps are listed but not fittable yet.
// kg: the engine's dressed weight, so the car gets lighter or heavier than with its own engine.
export const ENGINE_SWAPS = {
  '1jz': {
    ready: true,
    name: '1JZ-GTE VVT-i',
    code: '1JZ',
    donor: 'Toyota Chaser / Mark II (JZX100)',
    layout: 'Inline-6, DOHC 24v',
    displacement: '2.5 L',
    aspiration: 'Single turbo',
    hp: 276,
    hpRpm: 6200,
    nm: 378,
    nmRpm: 2400,
    redline: 7000,
    kg: 200,
    blurb: 'The bulletproof Toyota six. Huge mid-range torque and loves more boost.',
    sound: 'jz1', // smooth, deep and tonal with the 4.5th-order ring; factory turbo with a soft poof
    engine: {
      idleRpm: 745, // the idle control settles about 45 rpm below this: a 700 rpm idle
      idleMaxThrottle: 0.25,
      redline: 7000,
      limiterRpm: 7100,
      limiterResumeRpm: 6850,
      stallRpm: 450,
      inertia: 0.2,
      // rpm -> N m at full throttle, factory boost included (276 hp at 6,200, 378 N m from 2,400)
      torqueCurve: [
        [0, 160],
        [800, 210],
        [1500, 290],
        [2400, 378],
        [3500, 378],
        [4500, 372],
        [5500, 345],
        [6200, 317],
        [6800, 285],
        [7000, 272],
        [7500, 230],
      ],
      frictionTorque: 22,
      frictionPerRpm: 0.008,
    },
  },
  '4age': {
    ready: false,
    name: '4A-GE',
    code: '4A-GE',
    donor: 'Toyota AE86 Sprinter Trueno / Corolla Levin',
    layout: 'Inline-4, DOHC 16v',
    displacement: '1.6 L',
    aspiration: 'Naturally aspirated',
    hp: 128,
    hpRpm: 6600,
    nm: 149,
    nmRpm: 5200,
    redline: 7600,
    kg: 115,
    blurb: 'The Hachi-Roku\'s twin-cam four. Not much torque, but it loves to rev and weighs next to nothing.',
  },
  k24: {
    ready: false,
    name: 'K24A2',
    code: 'K24',
    donor: 'Acura TSX / Honda Accord',
    layout: 'Inline-4, DOHC i-VTEC',
    displacement: '2.4 L',
    aspiration: 'Naturally aspirated',
    hp: 205,
    hpRpm: 7000,
    nm: 224,
    nmRpm: 4500,
    redline: 7100,
    kg: 150,
    blurb: 'Light, rev-happy Honda four with a hard VTEC crossover.',
  },
  m50: {
    ready: false,
    name: 'M50B25',
    code: 'M50',
    donor: 'BMW E36 325i',
    layout: 'Inline-6, DOHC 24v',
    displacement: '2.5 L',
    aspiration: 'Naturally aspirated',
    hp: 189,
    hpRpm: 5900,
    nm: 245,
    nmRpm: 4700,
    redline: 6500,
    kg: 180,
    blurb: 'The classic E30 swap: a twin-cam BMW six that bolts in where the M20 sat.',
  },
  sr20: {
    ready: false,
    name: 'SR20DET',
    code: 'SR20',
    donor: 'Nissan Silvia S13 / 180SX',
    layout: 'Inline-4, DOHC 16v',
    displacement: '2.0 L',
    aspiration: 'Single turbo',
    hp: 202,
    hpRpm: 6000,
    nm: 274,
    nmRpm: 4000,
    redline: 7500,
    kg: 155,
    blurb: 'The drift-scene staple. Light, punchy and endlessly tunable.',
  },
};

// Read straight from storage: the car and engine are fixed for the session (changing either
// reloads the game).
function stored(key) {
  try {
    return typeof localStorage === 'undefined' ? null : JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}
// The car you drive, picked in the tuning shop, as it left the factory.
export const BASE_CAR = CARS[stored('touge.settings.v4')?.car] || E30;

// Each car keeps its own tuning and builds. Saves from before that (one setup shared by every car)
// go to whichever car is loaded first, and the other cars start from stock.
const LEGACY = { tuning: 'touge.tuning.v3', builds: 'touge.builds.v1' };
export function carKey(kind, id = BASE_CAR.id) {
  return `touge.${kind}.v4.${id}`;
}
// The saved data of `kind` for this car, falling back to the old shared save if this car may claim it.
export function carSave(kind, id = BASE_CAR.id) {
  const own = stored(carKey(kind, id));
  if (own) return own;
  const claim = stored('touge.legacyClaim') || {};
  if (claim[kind] && claim[kind] !== id) return null;
  return stored(LEGACY[kind]);
}
// ...and with any engine swap fitted.
function withSwap(car, id) {
  const sw = ENGINE_SWAPS[id];
  if (!sw?.ready || !sw.engine || sw.code === car.engineName) return car;
  return { ...car, engine: { ...sw.engine }, mass: car.mass + sw.kg - car.engineKg, engineName: sw.code, sound: sw.sound, swap: id };
}
export const CAR = withSwap(BASE_CAR, carSave('tuning')?.engine);

// Tyre compounds (tuning shop).
//   mu         peak friction on dry asphalt
//   peakAngle  slip angle (rad) where grip peaks: wider = more progressive, easier to hold angle
//   peakSlip   wheelspin / lock-up slip ratio where grip peaks
//   slide      share of peak grip left once fully sliding
//   falloff    how quickly grip drops past the peak (higher = more sudden)
//   gravel / grass  grip multipliers off the asphalt; grassNoise makes grass grip jump around
export const TIRES = {
  drift: {
    name: 'Drift',
    blurb: 'Hard compound. Breaks loose easily and holds big, steady angles. The most controllable slide.',
    mu: 0.9, peakAngle: 0.21, peakSlip: 0.17, slide: 0.94, falloff: 0.22, gravel: 0.8, grass: 0.65, grassNoise: 0.05,
  },
  stock: {
    name: 'Stock',
    blurb: 'Everyday 195/65 tyre. Modest grip that fades like a real road tyre when you push too hard.',
    mu: 0.82, peakAngle: 0.12, peakSlip: 0.12, slide: 0.7, falloff: 1.0, gravel: 0.75, grass: 0.6, grassNoise: 0.08,
  },
  street: {
    name: 'Street',
    blurb: 'Sticky performance road tyre. Ideal for touge: grippy, but you can still build slip angle.',
    mu: 1.13, peakAngle: 0.14, peakSlip: 0.14, slide: 0.84, falloff: 0.7, gravel: 0.72, grass: 0.55, grassNoise: 0.1,
  },
  semi: {
    name: 'Semi-slick',
    blurb: 'Near-race rubber. Huge grip that almost never lets go on asphalt, but nervous and unpredictable on grass.',
    mu: 1.42, peakAngle: 0.11, peakSlip: 0.11, slide: 0.8, falloff: 1.4, gravel: 0.58, grass: 0.32, grassNoise: 0.45,
  },
};

export const DIFFS = {
  open: { name: 'Open', blurb: 'Power goes to the wheel with least grip: the inside rear spins up out of tight corners.' },
  lsd: { name: 'LSD', blurb: 'Clutch-type limited slip (the 325i had one). Keeps both rears driving; predictable slides.' },
  welded: { name: 'Welded', blurb: 'Both rears locked together. Snaps into slides and holds them; scrubs and hops in tight turns.' },
};

// Live-tunable values (tuning shop and dev panel). Defaults chosen for a planted but slidable street car.
export const TUNABLE_DEFAULTS = {
  tire: 'street',
  diff: 'lsd',
  rideHeight: 0, // mm from stock (negative = lowered)
  brakeBias: 0.68, // share of braking on the front axle
  grip: 1.0, // overall grip multiplier (dev panel)
  springFront: 32000, // N/m per wheel
  springRear: 30000,
  damping: 0.32, // damping ratio (0 = bouncy, 1 = critical)
  antiRollFront: 14000, // N/m
  antiRollRear: 7000,
  torque: 1.0, // engine torque multiplier
  steering: 1.0, // steering sensitivity multiplier
  steerSpeedFalloff: 0.55, // fraction of lock removed at high speed
  lsdLock: 0.3, // limited-slip locking ratio (E30 factory LSD is about 25%)
  lsdPreload: 40, // N m
  wheel: 'bbs', // rim style (looks only)
  wheelColor: 'silver', // rim colour (see wheelColorOf: falls back to the wheel's own colour)
  rim: 14, // rim diameter, inches
  profile: 65, // tyre sidewall height as % of width
  camberFront: 1.0, // degrees of negative camber
  camberRear: 0.5,
  strutFront: false, // strut tower braces
  strutRear: false,
  exhaust: 'stock',
  stretch: false,
  seats: 'stock',
  offsetFront: 0, // mm the wheel sits out from stock (+ pokes out, - tucks in)
  offsetRear: 0,
  plateStyle: 'okinawa', // the only plate: a photo of a real Okinawa plate
  plateText: 'AE 318',
  intake: 'stock',
  turbo: 'none',
  engine: 'stock', // engine swap (ENGINE_SWAPS), or the car's own engine
  clutch: 'stock',
  gearbox: 'stock',
  finalDrive: CAR.finalDrive,
  coilovers: false,
  bump: 0.3, // coilover damping ratios (compression / extension)
  rebound: 0.36,
  brakes: 'stock',
  handbrake: 'stock',
  angleKit: 'stock',
  weight: 'stock',
  paint: '#' + CAR.paint.toString(16).padStart(6, '0'), // the car's factory colour
  headlights: 'white',
  taillights: 'red',
  numbers: false,
  number: 18,
  numberW: 0.4, // metres
  numberH: 0.3,
};

// ---------- Performance parts (tuning shop). Each option has a name and a one-line blurb. ----------
export const INTAKES = {
  stock: { name: 'Stock airbox', blurb: 'Quiet factory airbox and paper filter.' },
  pod: { name: 'Pod filter', blurb: 'Open cone filter. A few extra Nm up top and an audible gulp of air.' },
  itb: { name: 'ITBs', blurb: 'Individual throttle bodies in a carbon airbox: +20 Nm and +15 hp, razor response, and a deep, hollow trumpet howl that takes over on the throttle. Louder and angrier with a race exhaust.' },
};
export const TURBOS = {
  none: { name: 'None', blurb: 'Naturally aspirated. Smooth, linear and predictable.' },
  small: { name: 'Small turbo', blurb: 'T25-size. Spools early, about +45% torque, gentle lag. A high whistle on boost and flutter when you lift.' },
  big: { name: 'Big turbo', blurb: 'T3-size. Nothing below 4,000 rpm, then it doubles the torque. Laggy, savage, loud: a deep whistle and slow flutter on lift-off.' },
};
export const CLUTCHES = {
  stock: { name: 'Stock', blurb: 'Smooth and forgiving. Can slip if you add a lot of power.' },
  sport: { name: 'Sport', blurb: 'Stronger, with a shorter bite point. Easier clutch kicks.' },
  race: { name: 'Race paddle', blurb: 'Grabs hard and holds anything. Pulling away without stalling takes care.' },
};
export const GEARBOXES = {
  stock: { name: 'Stock', blurb: 'Getrag 260: 3.83 / 2.20 / 1.40 / 1.00 / 0.81.' },
  close: { name: 'Close-ratio', blurb: 'Gears packed together: 3.35 / 2.17 / 1.58 / 1.24 / 1.00. Stays in the power band through the bends.' },
};
export const FINAL_DRIVES = [3.46, 3.64, 3.73, 3.91, 4.1, 4.27, 4.45];
export const BRAKES = {
  stock: { name: 'Stock', blurb: 'Fine for the road. Fades if you lean on them run after run.' },
  bbk: { name: 'Big brake kit', blurb: '4-pot calipers and bigger discs: about 30% more bite and far less fade.' },
};
export const HANDBRAKES = {
  stock: { name: 'Stock', blurb: 'Cable handbrake. Good enough to tuck the tail in.' },
  hydro: { name: 'Hydraulic', blurb: 'Hydro handbrake: locks the rears instantly and hard. Made for drift entries.' },
};
export const ANGLE_KITS = {
  stock: { name: 'Stock', blurb: '36° of steering lock.' },
  kit: { name: 'Angle kit', blurb: 'Modified knuckles: 48° of lock to hold bigger angles.' },
  full: { name: 'Full lock', blurb: '58° of lock. Huge angle, twitchy at speed.' },
};
export const WEIGHTS = {
  stock: { name: 'Stock', blurb: '1,230 kg with you and a tank of fuel.', kg: 0 },
  light: { name: 'Light', blurb: 'Rear seats, spare wheel and sound deadening out: -55 kg.', kg: -55 },
  stripped: { name: 'Stripped', blurb: 'Bare shell, bucket seats, carbon bonnet: -120 kg.', kg: -120 },
};
export const PAINTS = [
  ['Alpine White', '#efeee6'],
  ['Henna Red', '#9e1b1e'],
  ['Diamond Black', '#16171b'],
  ['Lachssilber', '#a9adb1'],
  ['Brilliantrot', '#c8241d'],
  ['Zinnoberrot', '#d9411e'],
  ['Royal Blue', '#1d3a8a'],
  ['Laguna Green', '#2f6b4f'],
  ['Dakar Yellow', '#e6b72b'],
];
// Licence plates, Japanese style. Text colours follow the real plates.
// The licence plate: one style, a photo of a real Okinawa plate (dark green on white).
export const PLATES = {
  okinawa: { name: 'Okinawa (JDM)', bg: '#f0f0ea', ink: '#16422a', image: 'textures/plate_okinawa.png' },
};

// Up to 7 letters, numbers, spaces and dashes, upper case.
export function cleanPlate(text) {
  return String(text ?? '').toUpperCase().replace(/[^A-Z0-9 \-]/g, '').slice(0, 7);
}

export const SEATS = {
  stock: { name: 'Road seats', blurb: 'Comfy cloth seats. Your head moves with every corner and brake.' },
  bucket: { name: 'Bucket seats', blurb: 'Fixed-back race buckets. They hold you tight: every camera stays locked to the car.' },
};

export const HEADLIGHTS = { white: ['White', 0xfff2d8], yellow: ['Yellow', 0xffc94a], blue: ['Cool blue', 0xcfe2ff] };
export const TAILLIGHTS = { red: ['Red', 0xd0141c], smoked: ['Smoked', 0x4a0a10], clear: ['Clear', 0xcfc6c6] };

const smooth01 = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Everything the physics takes from the performance parts.
export function partsSetup(t) {
  const turbo = t.turbo === 'small' ? { gain: 0.45, spool: 2700, range: 1500, lag: 0.35 } : t.turbo === 'big' ? { gain: 1.0, spool: 3900, range: 1600, lag: 0.85 } : null;
  // Intake: extra torque (N m) added at an rpm. ITBs: +20 N m through the mid-range, tapering to
  // about +17 at the top, which is about +15 hp at the peak.
  const intake = t.intake === 'itb' ? (rpm) => 20 * smooth01(1500, 3200, rpm) - 3 * smooth01(5000, 6500, rpm) : t.intake === 'pod' ? (rpm) => 6 * smooth01(3500, 6800, rpm) : null;
  const clutch = CLUTCHES[t.clutch] ? t.clutch : 'stock';
  const massDelta = (WEIGHTS[t.weight] || WEIGHTS.stock).kg;
  return {
    mass: CAR.mass + massDelta,
    maxSteer: ((t.angleKit === 'full' ? 58 : t.angleKit === 'kit' ? 48 : 36) * Math.PI) / 180,
    brakeScale: t.brakes === 'bbk' ? 1.3 : 1,
    brakeCapacity: t.brakes === 'bbk' ? 1.8 : 1,
    handbrakeTorque: t.handbrake === 'hydro' ? 3600 : CAR.handbrakeTorque,
    clutchTorque: { stock: 340, sport: 440, race: 600 }[clutch],
    // Pedal travel over which the clutch bites (fraction pressed): narrower = grabbier.
    bite: { stock: [0.25, 0.8], sport: [0.33, 0.72], race: [0.44, 0.6] }[clutch],
    gears: t.gearbox === 'close' ? [3.35, 2.17, 1.58, 1.24, 1.0] : CAR.gears,
    finalDrive: FINAL_DRIVES.includes(t.finalDrive) ? t.finalDrive : CAR.finalDrive,
    turbo,
    intake,
  };
}

// Exhausts (tuning shop). Sound and looks only.
export const EXHAUSTS = {
  stock: { name: 'Stock', blurb: 'Factory silencer. Smooth, quiet, the odd pop when you lift off.', tip: 0.034 },
  street: { name: 'Street', blurb: 'Free-flowing back box. Deeper tone, crackles and pops on shifts and lift-off.', tip: 0.046 },
  race: { name: 'Race', blurb: 'Straight-through race pipe. Same deep bark, plus little flames off the limiter, on shifts and lift-off.', tip: 0.054 },
};

// Wheels (tuning shop). Looks only: size, sidewall and camber are separate settings.
export const WHEELS = {
  bbs: { name: 'Style 5 Basket Weave', blurb: 'The factory BBS-made cross-spoke: a silver basket weave round a roundel cap.', face: '#c7c9cf', lip: '#d8dadf', dish: '#26272b', spokes: 'mesh', image: 'wheels/style5.png', colors: { silver: 'wheels/style5_silver.png', gold: 'wheels/style5_gold.png', bronze: 'wheels/style5_bronze.png', black: 'wheels/style5_black.png' } },
  bottlecap: { name: 'Factory Bottle Caps', blurb: 'The E30\'s standard 14-inch alloys: a flat silver face with a ring of slots and a metal centre cap.', face: '#c3c5ca', lip: '#c3c5ca', dish: '#2a2b2f', spokes: 'bottlecap', image: 'wheels/bottlecap.png', colors: { silver: 'wheels/bottlecap.png' } },
  watanabe: { name: 'Watanabe 8-Spoke', blurb: 'Eight slender spokes in gunmetal with a red centre cap. Old-school Japanese street racing.', face: '#6f716c', lip: '#7a7c78', dish: '#1a1b1c', spokes: 'watanabe', image: 'wheels/watanabe.png', colors: { gunmetal: 'wheels/watanabe_gunmetal.png', silver: 'wheels/watanabe_silver.png', gold: 'wheels/watanabe_gold.png', bronze: 'wheels/watanabe_bronze.png' } },
  rpf1: { name: 'Enkei RPF1', blurb: 'Six pairs of twin spokes in silver. Light, cheap, and on every time-attack car.', face: '#c9cbce', lip: '#c9cbce', dish: '#1a1b1c', spokes: 'six', image: 'wheels/rpf1.png', colors: { silver: 'wheels/rpf1_silver.png', gunmetal: 'wheels/rpf1_gunmetal.png', gold: 'wheels/rpf1_gold.png', bronze: 'wheels/rpf1_bronze.png' } },
  te37: { name: 'TE37', blurb: 'Six wide, flat forged spokes in bronze. Light, stiff, legendary.', face: '#8d7a55', lip: '#8d7a55', dish: '#1e160d', spokes: 'te37', image: 'wheels/te37.png', colors: { bronze: 'wheels/te37_bronze.png', gold: 'wheels/te37_gold.png', gunmetal: 'wheels/te37_gunmetal.png', silver: 'wheels/te37_silver.png' } },
};

// Rim colours. Each wheel comes in its own set (WHEELS[id].colors: colour -> picture); the first
// listed is how it comes from the factory.
export const WHEEL_COLORS = {
  silver: ['Silver', '#c9ccd1'],
  gunmetal: ['Gunmetal', '#5c5f63'],
  black: ['Black', '#2c2d31'],
  gold: ['Gold', '#d4a843'],
  bronze: ['Bronze', '#8c6a3c'],
};
// The colour a wheel is actually wearing: the chosen one if that wheel comes in it, else its own.
export function wheelColorOf(wheelId, color) {
  const cols = Object.keys(WHEELS[wheelId]?.colors || {});
  return cols.includes(color) ? color : cols[0];
}

// Wheel and tyre sizes: tyre width grows with the rim, as you would fit on the real car.
export const RIM_SIZES = [14, 15, 16, 17, 18, 19, 20];
const TYRE_WIDTH = { 14: 195, 15: 205, 16: 215, 17: 225, 18: 235, 19: 245, 20: 255 };
export const RIM_WIDTH_IN = { 14: 6.5, 15: 7, 16: 7.5, 17: 8, 18: 8.5, 19: 9, 20: 9.5 };

// Anti-roll (sway) bar options, as front / rear bar rates in N/m.
export const SWAY_FRONT = { soft: 7000, stock: 14000, sport: 22000, race: 32000 };
export const SWAY_REAR = { off: 0, stock: 7000, sport: 14000, race: 22000 };

// Lateral grip multiplier from negative camber: more cornering grip up to about 3 degrees, then
// the tyre starts to ride on its inner edge.
function camberLateral(deg) {
  return deg <= 3 ? 1 + 0.04 * deg : 1.12 - 0.06 * (deg - 3);
}

// Everything the physics needs from the wheel, tyre and chassis setup.
export function wheelSetup(t) {
  const rim = RIM_SIZES.includes(t.rim) ? t.rim : 14;
  // Stretched tyres (stance): a tyre two sizes narrower than the rim, pulled over it so the
  // sidewalls angle in. Not made in semi-slick.
  const stretched = !!t.stretch && t.tire !== 'semi';
  const rimWidth = TYRE_WIDTH[rim];
  const width = stretched ? rimWidth - 30 : rimWidth;
  const profile = clamp(t.profile ?? 65, 30, 75);
  const sidewall = (width / 1000) * (profile / 100);
  const radius = rim * 0.0127 + sidewall;
  // Low, stiff sidewalls build grip sooner (smaller relaxation length and peak slip angle); tall
  // ones are softer and more forgiving. Wider tyres grip a little more.
  const p = profile / 65;
  const brace = (on) => (on ? 1 : 0);
  const cf = clamp(t.camberFront ?? 1, 0, 6);
  const cr = clamp(t.camberRear ?? 0.5, 0, 6);
  return {
    rim,
    width,
    rimWidth,
    stretched,
    profile,
    radius,
    rimRadius: rim * 0.0127,
    inertia: CAR.wheelInertia * (radius / CAR.wheelRadius) ** 2 * (1 + (rim - 14) * 0.07),
    // A stretched sidewall is tight: instant response, but a smaller, edgier contact patch.
    relaxation: 0.45 * (0.45 + 0.55 * p) * (stretched ? 0.75 : 1),
    peakScale: (0.8 + 0.2 * p) * (stretched ? 0.85 : 1),
    gripScale: (1 + ((width - 195) / 195) * 0.25) * (stretched ? 0.93 : 1),
    // Strut braces stop the towers flexing: a touch more grip and a sharper turn-in on that axle.
    latFront: camberLateral(cf) * (1 + 0.02 * brace(t.strutFront)),
    latRear: (camberLateral(cr) / camberLateral(0.5)) * (1 + 0.02 * brace(t.strutRear)),
    lonFront: 1 - 0.035 * Math.max(0, cf - 1),
    lonRear: 1 - 0.035 * Math.max(0, cr - 1),
    // Offset: how far each wheel sits out from stock, widening (or narrowing) the track.
    pokeFront: clamp(t.offsetFront ?? 0, -20, 60) / 1000,
    pokeRear: clamp(t.offsetRear ?? 0, -20, 60) / 1000,
    relaxFront: t.strutFront ? 0.85 : 1,
    relaxRear: t.strutRear ? 0.85 : 1,
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export const TUNABLE_RANGES = {
  grip: [0.6, 1.5, 0.01],
  springFront: [15000, 70000, 500],
  springRear: [15000, 70000, 500],
  damping: [0.1, 0.9, 0.01],
  antiRollFront: [0, 40000, 500],
  antiRollRear: [0, 40000, 500],
  torque: [0.5, 2.0, 0.05],
  steering: [0.5, 1.6, 0.05],
  steerSpeedFalloff: [0, 0.85, 0.01],
  lsdLock: [0, 0.9, 0.01],
  lsdPreload: [0, 200, 5],
};
