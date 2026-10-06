// Car specifications. Names are fictional; the numbers follow the real cars they resemble.

export const CARS = {
  // Mid-engine, rear-wheel drive 80s coupe (AW11 MR2 look-alike).
  kazamaMR: {
    id: 'kazamaMR',
    name: 'KAZAMA MR-II',
    year: 1987,
    mass: 1050, // kg, with driver
    yawInertia: 1250, // kg m^2 (mid-engine: low)
    wheelbase: 2.32,
    trackFront: 1.44,
    trackRear: 1.44,
    frontWeight: 0.44, // fraction of weight on the front axle
    cgHeight: 0.46,
    rollStiffnessFront: 0.55, // share of lateral load transfer taken by the front axle
    length: 3.95,
    width: 1.665,
    dragArea: 0.62, // Cd * frontal area
    wheelRadius: 0.29,
    wheelInertia: 0.85,
    tireMu: 1.0, // street tire
    tireSlipPeak: 0.1, // slip ratio at peak force
    tireAnglePeak: 0.13, // radians of slip angle at peak force
    tireSlide: 0.78, // fraction of peak grip left when fully sliding
    maxSteer: (33 * Math.PI) / 180,
    steerRate: 4.0, // rad/s at the road wheel
    suspensionSag: 0.075, // m of static compression (sets ride frequency)
    suspensionDamping: 0.45, // damping ratio
    brakeTorqueFront: 1150, // N m per wheel at full pedal
    brakeTorqueRear: 650,
    handbrakeTorque: 1500, // N m per rear wheel
    driven: 'rear',
    diff: 'open',
    engine: {
      idle: 900,
      redline: 7600,
      limiter: 7700,
      inertia: 0.16,
      // rpm -> N m at full throttle (4-cylinder 1.6 twin-cam, ~112 hp)
      torque: [
        [0, 70],
        [1000, 88],
        [2000, 104],
        [3000, 117],
        [4000, 126],
        [4800, 131],
        [5500, 128],
        [6600, 122],
        [7200, 112],
        [7700, 102],
        [8500, 80],
      ],
      friction: 18, // N m engine braking at idle
      frictionPerRpm: 0.0042, // extra N m per rpm
    },
    clutchTorque: 230, // N m capacity
    gears: [3.166, 1.904, 1.31, 0.969, 0.815],
    reverse: 3.25,
    finalDrive: 4.312,
    drivelineEfficiency: 0.92,
    paint: [0.78, 0.06, 0.07],
  },
};
