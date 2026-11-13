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
    idleRpm: 760,
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
};

// Mazda RX-7 (FC3S, 1990 non-turbo): 13B two-rotor, about 160 hp at 7,000 rpm and a 7,500 rpm
// redline, near 50:50 balance with the engine behind the front axle, a light, quick-revving
// rotor pack and little engine braking.
const RX7 = {
  id: 'rx7',
  shape: 'rx7',
  name: 'Mazda RX-7 FC',
  blurb: '13B rotary, 160 hp, 7,500 rpm. Balanced and light on its feet; loves to rev, little engine braking.',
  mass: 1250,
  halfExtents: { x: 0.83, y: 0.3, z: 2.14 },
  centerOfMass: { x: 0, y: -0.2, z: 0.0 },
  inertia: { x: 1500, y: 1800, z: 440 },
  dragArea: 0.53, // Cd 0.31 x 1.7 m2
  rollingResistance: 0.013,

  wheelbase: 2.43,
  trackFront: 1.45,
  trackRear: 1.44,
  frontAxleZ: 1.2,
  rearAxleZ: -1.23,
  wheelMountY: -0.1,
  wheelRadius: 0.305,
  wheelWidth: 0.195,
  wheelInertia: 1.0,
  suspensionRest: 0.3,
  suspensionTravel: 0.18,
  maxSteer: (36 * Math.PI) / 180,

  engine: {
    idleRpm: 800,
    redline: 7500,
    limiterRpm: 7600,
    limiterResumeRpm: 7300,
    stallRpm: 450,
    inertia: 0.13, // rotors and a light flywheel: revs climb and fall quickly
    torqueCurve: [
      [0, 90],
      [800, 120],
      [1500, 140],
      [2500, 160],
      [3500, 176],
      [4500, 190],
      [5500, 186],
      [6500, 175],
      [7000, 165],
      [7500, 150],
      [8000, 125],
    ],
    frictionTorque: 14,
    frictionPerRpm: 0.005, // a rotary has little engine braking
  },

  gears: [3.475, 2.002, 1.366, 1.0, 0.711],
  reverse: 3.493,
  finalDrive: 4.1,
  drivelineEfficiency: 0.9,
  clutchTorque: 300,

  brakeTorqueFront: 1700,
  brakeTorqueRear: 800,
  handbrakeTorque: 1800,

  paint: 0xc8241d,
};

export const CARS = { e30: E30, rx7: RX7 };

// The car you drive, picked in the tuning shop (changing it reloads the game).
function chosenCar() {
  try {
    return typeof localStorage === 'undefined' ? 'e30' : JSON.parse(localStorage.getItem('touge.settings.v4'))?.car;
  } catch {
    return 'e30';
  }
}
export const CAR = CARS[chosenCar()] || E30;

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
  plateStyle: 'white', // 'white' | 'yellow' | 'red'
  plateText: 'AE 318',
  intake: 'stock',
  turbo: 'none',
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
  paint: '#efeee6',
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
  itb: { name: 'ITBs', blurb: 'Individual throttle bodies: +20 Nm and +15 hp, razor response, and a deep, soft intake grumble.' },
};
export const TURBOS = {
  none: { name: 'None', blurb: 'Naturally aspirated M20 six. Smooth, linear and predictable.' },
  small: { name: 'Small turbo', blurb: 'T25-size. Spools early, about +45% torque, gentle lag. Breathy diesel-style spool and a little poof when you lift.' },
  big: { name: 'Big turbo', blurb: 'T3-size. Nothing below 4,000 rpm, then it doubles the torque. Laggy, savage, loud: deep diesel spool and flutter on lift-off.' },
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
export const PLATES = {
  white: { name: 'White', bg: '#f2f1ea', ink: '#1f5a32' },
  yellow: { name: 'Yellow', bg: '#f2c51e', ink: '#151515' },
  red: { name: 'White / red', bg: '#f2f1ea', ink: '#151515', slash: '#c8241d' },
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
  bbs: { name: 'BBS Mesh', blurb: 'The factory cross-spoke. Silver mesh, polished lip.', face: '#c7c9cf', lip: '#d8dadf', dish: '#26272b', spokes: 'mesh' },
  gold: { name: 'Gold Mesh', blurb: 'Gold cross-spoke with a deep polished lip. Pure 80s.', face: '#d6b04a', lip: '#e4e6ea', dish: '#3a3020', spokes: 'mesh' },
  six: { name: 'Bronze 6-Spoke', blurb: 'Light forged six-spoke in bronze, the Japanese touge classic.', face: '#8e6a3f', lip: '#8e6a3f', dish: '#231c15', spokes: 'six' },
  steel: { name: 'Black Steelies', blurb: 'Plain black steel wheels. Cheap, tough, honest.', face: '#1d1e21', lip: '#26272b', dish: '#141517', spokes: 'steel' },
};

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
