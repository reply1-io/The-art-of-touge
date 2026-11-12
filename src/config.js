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
    mu: 1.05, peakAngle: 0.14, peakSlip: 0.14, slide: 0.84, falloff: 0.7, gravel: 0.72, grass: 0.55, grassNoise: 0.1,
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
};

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
