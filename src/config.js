// BMW E30 318is (1990, M42 1.8 16V). Numbers follow the real car where known.
// Values in TUNABLE can be changed live from the dev tuning panel.

export const CAR = {
  name: 'BMW E30 318is',
  mass: 1100, // kg with driver and fuel
  // Body box used for the collider (half extents, metres): width, height, length.
  halfExtents: { x: 0.8, y: 0.32, z: 2.12 },
  // Centre of mass relative to the body origin (low, slightly forward).
  centerOfMass: { x: 0, y: -0.18, z: 0.06 },
  // Principal moments of inertia (pitch about x, yaw about y, roll about z).
  inertia: { x: 1500, y: 1750, z: 430 },
  dragArea: 0.66, // Cd 0.38 x 1.74 m2
  rollingResistance: 0.013,

  wheelbase: 2.57,
  trackFront: 1.407,
  trackRear: 1.415,
  frontAxleZ: 1.28, // relative to the body origin
  rearAxleZ: -1.29,
  wheelMountY: -0.1, // suspension top, relative to the body origin
  wheelRadius: 0.305, // 195/65 R14
  wheelWidth: 0.195,
  wheelInertia: 1.0, // kg m2: wheel, tyre, hub and brake rotor
  suspensionRest: 0.3, // free length of the strut travel used by the raycast
  suspensionTravel: 0.18, // bump travel before the bump stop
  maxSteer: (36 * Math.PI) / 180,

  engine: {
    idleRpm: 850,
    redline: 7000,
    limiterRpm: 7050,
    limiterResumeRpm: 6750,
    stallRpm: 480,
    inertia: 0.17, // kg m2: crank and flywheel
    // rpm -> N m at full throttle (M42: 136 hp at 6,000 rpm, 172 N m at 4,600 rpm)
    torqueCurve: [
      [0, 80],
      [800, 110],
      [1500, 128],
      [2500, 145],
      [3500, 160],
      [4600, 172],
      [5200, 170],
      [6000, 160],
      [6500, 150],
      [7000, 138],
      [7500, 120],
    ],
    frictionTorque: 18, // N m at zero rpm when off throttle
    frictionPerRpm: 0.007, // extra engine braking per rpm (closed-throttle pumping losses)
  },

  // Getrag 240 five-speed, 4.10 final drive.
  gears: [3.72, 2.02, 1.32, 1.0, 0.81],
  reverse: 3.45,
  finalDrive: 4.1,
  drivelineEfficiency: 0.9,
  clutchTorque: 280, // N m capacity

  brakeTorqueFront: 1600, // N m per wheel at full pedal
  brakeTorqueRear: 750,
  handbrakeTorque: 1800, // N m per rear wheel

  paint: 0xefeee6, // Alpine White
};

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
  lsd: { name: 'LSD', blurb: 'Clutch-type limited slip (the 318is had one). Keeps both rears driving; predictable slides.' },
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
  intake: 'stock',
  turbo: 'none',
  clutch: 'stock',
  gearbox: 'stock',
  finalDrive: 4.1,
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
  pod: { name: 'Pod filter', blurb: 'Open cone filter. A little more top end and an audible gulp of air.' },
  itb: { name: 'ITBs', blurb: 'Individual throttle bodies with trumpets. Sharp response, strong top end and a deep, hungry intake roar.' },
};
export const TURBOS = {
  none: { name: 'None', blurb: 'Naturally aspirated M42. Linear and predictable.' },
  small: { name: 'Small turbo', blurb: 'T25-size. Spools early, about +45% torque, gentle lag. Whistle and blow-off valve.' },
  big: { name: 'Big turbo', blurb: 'T3-size. Nothing below 4,000 rpm, then it doubles the torque. Laggy, savage, loud.' },
};
export const CLUTCHES = {
  stock: { name: 'Stock', blurb: 'Smooth and forgiving. Can slip if you add a lot of power.' },
  sport: { name: 'Sport', blurb: 'Stronger, with a shorter bite point. Easier clutch kicks.' },
  race: { name: 'Race paddle', blurb: 'Grabs hard and holds anything. Pulling away without stalling takes care.' },
};
export const GEARBOXES = {
  stock: { name: 'Stock', blurb: 'Getrag 240: 3.72 / 2.02 / 1.32 / 1.00 / 0.81.' },
  close: { name: 'Close-ratio', blurb: 'Gears packed together: 3.35 / 2.17 / 1.58 / 1.24 / 1.00. Stays in the power band through the bends.' },
};
export const FINAL_DRIVES = [3.64, 3.91, 4.1, 4.27, 4.45, 4.73];
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
  stock: { name: 'Stock', blurb: '1,100 kg with you and a tank of fuel.', kg: 0 },
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
export const HEADLIGHTS = { white: ['White', 0xfff2d8], yellow: ['Yellow', 0xffc94a], blue: ['Cool blue', 0xcfe2ff] };
export const TAILLIGHTS = { red: ['Red', 0xd0141c], smoked: ['Smoked', 0x4a0a10], clear: ['Clear', 0xcfc6c6] };

const smooth01 = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Everything the physics takes from the performance parts.
export function partsSetup(t) {
  const turbo = t.turbo === 'small' ? { gain: 0.45, spool: 2700, range: 1500, lag: 0.35 } : t.turbo === 'big' ? { gain: 1.0, spool: 3900, range: 1600, lag: 0.85 } : null;
  const intake = t.intake === 'itb' ? (rpm) => 1 + 0.09 * smooth01(3000, 6800, rpm) - 0.02 * (1 - smooth01(1200, 2600, rpm)) : t.intake === 'pod' ? (rpm) => 1 + 0.035 * smooth01(3500, 6800, rpm) : null;
  const clutch = CLUTCHES[t.clutch] ? t.clutch : 'stock';
  const massDelta = (WEIGHTS[t.weight] || WEIGHTS.stock).kg;
  return {
    mass: CAR.mass + massDelta,
    maxSteer: ((t.angleKit === 'full' ? 58 : t.angleKit === 'kit' ? 48 : 36) * Math.PI) / 180,
    brakeScale: t.brakes === 'bbk' ? 1.3 : 1,
    brakeCapacity: t.brakes === 'bbk' ? 1.8 : 1,
    handbrakeTorque: t.handbrake === 'hydro' ? 3400 : CAR.handbrakeTorque,
    clutchTorque: { stock: 280, sport: 380, race: 540 }[clutch],
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
export const RIM_SIZES = [14, 15, 16, 17];
const TYRE_WIDTH = { 14: 195, 15: 205, 16: 215, 17: 225 };

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
  const width = TYRE_WIDTH[rim];
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
    profile,
    radius,
    rimRadius: rim * 0.0127,
    inertia: CAR.wheelInertia * (radius / CAR.wheelRadius) ** 2 * (1 + (rim - 14) * 0.07),
    relaxation: 0.45 * (0.45 + 0.55 * p),
    peakScale: 0.8 + 0.2 * p,
    gripScale: 1 + ((width - 195) / 195) * 0.25,
    // Strut braces stop the towers flexing: a touch more grip and a sharper turn-in on that axle.
    latFront: camberLateral(cf) * (1 + 0.02 * brace(t.strutFront)),
    latRear: (camberLateral(cr) / camberLateral(0.5)) * (1 + 0.02 * brace(t.strutRear)),
    lonFront: 1 - 0.035 * Math.max(0, cf - 1),
    lonRear: 1 - 0.035 * Math.max(0, cr - 1),
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
