// DSP core that synthesizes engines from first principles: the BMW M20 2.5 straight-six
// (E30 325i), the GM LS3 6.2 V8 and the Mazda 13B two-rotor Wankel (RX-7). Each engine is a
// profile in ENGINES.
// Runs inside an AudioWorklet when the browser allows it, otherwise on the main thread
// (see M20EngineSound.js). It has no imports so it can be shipped into a worklet as text.
//
// Signal path, per sample:
//   crank angle -> one exhaust pressure pulse per cylinder per cycle, in firing order
//   -> two manifolds / banks (header delay with partial reflection)
//   -> M20: collector into one pipe; LS3: true dual pipes, one per bank
//   -> exhaust pipe (delay line with inverted reflection = pipe resonances)
//   -> muffler (lowpass + body resonance) + turbulent "rasp" noise riding on each pulse
//   + intake roar (throttle) + valve-train tick + starter motor when cranking
//   -> soft clip.
//
// Per-cylinder strength differences and cycle-to-cycle jitter put energy at the
// half orders (cam rate), which is what makes it sound like an engine, not a buzzer.
// Motronic cuts fuel on overrun, so off-throttle above idle the pulses are just
// pumped air: weaker and duller. A proper lift-off from high revs can give a
// couple of pops (more with a louder exhaust); limiter and shift cuts never do.
//
// Turbo (set({ turbo: 1, turboSize: 'small' | 'big' })): a 48 mm turbo ('small') or a
// T3-size one ('big', deeper and slower) with its own boost model (or the game's boost via
// set({ boost })), a clean compressor whistle that follows the shaft speed (and keeps singing
// as the shaft spins down after a lift), an air rush, and compressor flutter on lift-off
// (no blow-off valve). Flutter and whistle tuned against a recording of a turbo car.
//
// Exhausts are their own sound presets (EXHAUSTS): stock, street and race change the
// muffler, rasp, rumble, resonances and drive, and the aftermarket ones add a heavy
// cammed, choppy idle: some cylinders burn weak every cycle, alternate cycles hit
// harder, now and then one stumbles. Tuned against a recording of a cammed LS V8 idle.

export const TAU = Math.PI * 2;
export const CRANK_SECONDS = 2.6;

// Engine profiles. angles: crank degrees (0..cycleDeg, 720 for a four-stroke) at which each
// cylinder's exhaust valve opens, in firing order; bank: which manifold/pipe that cylinder
// feeds. Optional: cycleDeg, pulseSharp (0 smooth .. 1 abrupt port opening), tick (valvetrain),
// intakeLag, baseLope (built-in idle chop), popMul (overrun crackle).
export const ENGINES = {
  m20: {
    label: 'BMW M20B25 2.5 straight-six',
    firing: [1, 5, 3, 6, 2, 4],
    angles: [0, 120, 240, 360, 480, 600],
    bank: [0, 1, 0, 1, 0, 1],                 // cyl 1-3 front manifold, 4-6 rear
    cylGain: [1.0, 0.9, 1.07, 0.95, 1.04, 0.88],
    cylTiming: [0, 1.5, -1, 2, -0.5, 1],
    idleRpm: 900, redline: 6500, crankFlare: 1450, starterRatio: 11, // the game's E30 idles at 900
    dual: false,                               // both manifolds into one pipe
    header: [0.0016, 0.0023], pipe: [3.1, 3.1], pipeRefl: 0.5,
    width: [36, 10], pump: 0.11, jitter: 0.07, idleJitter: 0.08, lope: [0.007, 0.004],
    // cammed idle over two engine cycles (12 firings): mostly full hits, a short stumble of
    // one or two weak firings, then one hard "bwop"
    chop: [1.1, 1, 0.85, 0.3, 0.45, 1.5, 1.05, 1, 1.1, 1, 1, 1.05],
    sizzle: 1.4, idleNoise: 1,
    muff: [420, 700, 0.09, 1500, 1200], body: [115, 4], drone: [240, 1],
    rasp: [1200, 0.15, 1.0], rumble: [260, 0.06, 1.0], intake: [420, 0.08, 0.10],
    level: 1.0,
  },
  jz2: {
    // Toyota 2JZ-GTE run N/A: 3.0 L square (86 x 86 mm) straight-six, same 1-5-3-6-2-4 order
    // as the M20 but bigger, smoother and higher revving, with the clean metallic howl the
    // 2JZ is known for (a resonance near 640 Hz plus a zing on the firing harmonics).
    label: 'Toyota 2JZ-GTE 3.0 straight-six (N/A)',
    firing: [1, 5, 3, 6, 2, 4],
    angles: [0, 120, 240, 360, 480, 600],
    bank: [0, 1, 0, 1, 0, 1],                 // GTE manifold split 1-3 / 4-6
    cylGain: [1.0, 0.96, 1.03, 0.98, 1.02, 0.95], // a smooth, well-balanced six
    cylTiming: [0, 0.8, -0.6, 1, -0.4, 0.5],
    idleRpm: 700, redline: 6800, crankFlare: 1300, starterRatio: 11,
    dual: false,
    header: [0.0019, 0.0021], pipe: [3.4, 3.4], pipeRefl: 0.48, // more even runners: smoother
    width: [32, 9], pump: 0.1, jitter: 0.05, idleJitter: 0.05, lope: [0.004, 0.002],
    chop: [1.1, 1, 0.85, 0.3, 0.45, 1.5, 1.05, 1, 1.1, 1, 1, 1.05],
    sizzle: 1.0, idleNoise: 0.8,
    muff: [480, 800, 0.11, 1800, 1400], body: [105, 5], drone: [260, 1.5],
    mid: [640, 3],                             // the metallic ring of a revving 2JZ
    zing: { harmonics: [[3, 1], [4, 0.6], [6, 0.35]], level: 0.16, from: 2500, to: 6800 },
    rasp: [1500, 0.16, 0.8], rumble: [240, 0.06, 0.9], intake: [450, 0.09, 0.12],
    level: 0.8,
  },
  jz1: {
    // Toyota 1JZ-GTE: 2.5 L oversquare (86 x 71.5 mm) straight-six, firing 1-5-3-6-2-4, 7,000 rpm.
    // Tuned against a recording of a 1JZ car revving to its limiter (used only for
    // measurements): a smooth, deep, very tonal six whose ring is the 4.5th order (1.5x the
    // firing frequency), strongest at 120-500 Hz and falling away steeply above 1 kHz, with
    // little rasp or hiss. Factory turbo always on (set({ turbo: 1 }) upgrades it).
    label: 'Toyota 1JZ-GTE 2.5 straight-six',
    firing: [1, 5, 3, 6, 2, 4],
    angles: [0, 120, 240, 360, 480, 600],
    bank: [0, 1, 0, 1, 0, 1],                 // manifold split 1-3 / 4-6
    cylGain: [1.0, 0.95, 1.04, 0.97, 1.02, 0.94],
    cylTiming: [0, 1, -0.8, 1.2, -0.5, 0.6],
    idleRpm: 700, redline: 7000, crankFlare: 1400, starterRatio: 11,
    dual: false,
    header: [0.0017, 0.0019], pipe: [3.2, 3.2], pipeRefl: 0.48,
    width: [40, 10], pump: 0.1, jitter: 0.04, idleJitter: 0.05, lope: [0.005, 0.003],
    chop: [1.1, 1, 0.85, 0.3, 0.45, 1.5, 1.05, 1, 1.1, 1, 1, 1.05],
    sizzle: 0.3, idleNoise: 0.6,
    muff: [380, 650, 0.07, 1300, 900], muffRpm: 0.8, muffRpm2: 0.05, // a dark, smooth exhaust
    body: [165, 7.5], drone: [330, 3], subMin: 22,
    mid: [460, 2.5],
    // the ring: 4.5th order (1.5x firing) and its double, from about 2,500 rpm
    zing: { harmonics: [[1.5, 1], [3, 0.35]], level: 0.11, from: 2500, to: 7000 },
    rasp: [1400, 0.1, 0.55], rumble: [220, 0.05, 0.6], intake: [420, 0.07, 0.08],
    roar: 0.3, intakeRoar: 0.25,              // much less flow noise than the other engines
    level: 0.68,
    factoryTurbo: 'factory',                   // the stock turbo is always there; set({ turbo: 1 }) upgrades it
  },
  ls3: {
    label: 'GM LS3 6.2 V8',
    firing: [1, 8, 7, 2, 6, 5, 4, 3],
    angles: [0, 90, 180, 270, 360, 450, 540, 630],
    bank: [0, 1, 0, 1, 1, 0, 1, 0],            // odd cylinders left bank, even right
    cylGain: [1.0, 0.94, 1.06, 0.96, 1.05, 0.9, 1.02, 0.95],
    cylTiming: [0, 1.2, -1.4, 0.8, -0.6, 1.6, -1, 0.5],
    idleRpm: 650, redline: 6600, crankFlare: 1300, starterRatio: 10,
    dual: true,                                // true duals: each bank keeps its own uneven beat
    header: [0.0014, 0.0014], pipe: [3.5, 3.8], pipeRefl: 0.45,
    listen: [1, 0.7],                          // heard from behind, nearer the left tailpipe
    width: [46, 12], pump: 0.13, jitter: 0.08, idleJitter: 0.12, lope: [0.013, 0.008],
    chop: [1.1, 1, 0.9, 1, 0.35, 0.45, 1.5, 1.15, 1.05, 1, 1.05, 1, 1.05, 1, 1.05, 1],
    sizzle: 0.45,                              // eight overlapping pulses: less crackle per pulse
    idleNoise: 0.4,                            // ...and less turbulence noise at idle, or it hisses
    muff: [300, 620, 0.08, 1200, 1100], body: [80, 6], drone: [165, 1],
    rasp: [900, 0.12, 0.75], rumble: [180, 0.05, 1.35], intake: [300, 0.06, 0.14],
    itb: { level: 0.4, boxRing: 0.3 },        // its firing note crosses the box's ring around 5,500 rpm
    level: 1.4,
  },
  rotary13b: {
    label: 'Mazda 13B two-rotor Wankel',
    // Each rotor has three faces and each face fires once every three turns of the eccentric
    // shaft, so the rotors fire twice per shaft turn (pitch = rpm / 30, like a four-cylinder),
    // but the full pattern only repeats every 1,080 deg: 6 "faces" here, rotors alternating.
    cycleDeg: 1080,
    firing: ['1A', '2A', '1B', '2B', '1C', '2C'],
    angles: [0, 180, 360, 540, 720, 900],
    bank: [0, 1, 0, 1, 0, 1],                 // front rotor, rear rotor
    cylGain: [1.0, 0.93, 1.05, 0.96, 0.94, 1.04], // faces and apex seals never seal quite alike
    cylTiming: [0, 1.5, -1, 2, -1.5, 0.5],
    idleRpm: 750, redline: 7500, crankFlare: 1500, starterRatio: 11, // the game's RX-7 idles at 750
    dual: false,                               // short manifold into one pipe
    header: [0.0009, 0.0012], pipe: [3.0, 3.0], pipeRefl: 0.45,
    // Tuned against a recording of an FD RX-7 idling (used only for measurements): a very
    // regular brap once every three shaft turns, energy at 60-500 Hz, little sub.
    width: [14, 4], tail: 160, pulseSharp: 0.15, // the port opens fast (14 deg), the gas flows on
    raspFloor: 0.3,                            // a little rasp even at idle
    // zing: the clean, high rotary note, locked to the rotors. Harmonics of the firing
    // frequency (rpm / 30), quiet at idle and strongest from about 6,500 rpm
    zing: { harmonics: [[3, 1], [4, 0.8], [5, 0.45], [6, 0.3]], level: 0.55, from: 1500, to: 6500 },
    pump: 0.14, jitter: 0.03, idleJitter: 0.03, lope: [0.004, 0.002], scatter: 1,
    baseLope: 0.45,                            // even a stock 13B idles choppy
    // one strong brap per 1,080 deg (repeats every cycle, both halves the same)
    chop: [1.35, 1.2, 0.72, 0.8, 0.85, 0.75, 1.35, 1.2, 0.72, 0.8, 0.85, 0.75],
    sizzle: 0.6, idleNoise: 2.0, tick: 0, intakeLag: 360, popMul: 1.0, hitTail: 70,
    subMin: 60,                                // 27 Hz firing at idle: the brap lives above it
    idleHitScale: 1.5,                         // pipes make a bigger difference at idle
    muff: [1100, 900, 0.1, 3200, 1600], body: [112, 5], drone: [170, 3.5],
    stumble: 0,                                // a rotary's brap is metronome-regular
    mid: [290, 6],                             // third pipe resonance heard on the reference
    rasp: [1300, 0.2, 0.8], rumble: [300, 0.06, 1.0], intake: [600, 0.12, 0.25],
    itb: { level: 1.6, width: 0.6, roarBand: [250, 1800] }, // shorter gulps: its note is low and pure
    level: 1.3, post: 0.62,                    // driven harder, then turned down: rounder thumps
  },
};

export const IDLE_RPM = ENGINES.m20.idleRpm;

// Exhaust presets, applied on top of the engine profile. open: muffler cutoff multiplier;
// bodyDb/droneDb: extra resonance; droneHz: resonance shift; refl: less pipe reflection
// (straighter pipe); rumble/rasp/crack: turbulence and afterfire crack; pops: most pops per
// lift-off; level: drive into the output stage; lope: choppy cammed idle (0 none .. 1 heavy);
// idleHit: how hard idle firings hit (louder idle); sub: low cut in Hz (less mud, more punch);
// sizzle: crackly top end riding on the pulses.
export const EXHAUSTS = {
  stock:  { open: 1.0, bodyDb: 0,   droneDb: 0,   droneHz: 1.0,  refl: 0,    rumble: 0.8, rasp: 0.7, crack: 0.35, pops: 1.6, level: 1.0,  lope: 0,    idleHit: 1.0, sub: 28, sizzle: 0 },
  street: { open: 2.0, bodyDb: 4,   droneDb: 2,   droneHz: 1.15, refl: 0.1,  rumble: 1.4, rasp: 1.8, crack: 0.8,  pops: 3.0, level: 1.25, lope: 0.8,  idleHit: 1.8, sub: 38, sizzle: 0.5 },
  race:   { open: 2.8, bodyDb: 5.5, droneDb: 3,   droneHz: 1.22, refl: 0.16, rumble: 2.0, rasp: 3.2, crack: 1.0,  pops: 4.1, level: 1.5,  lope: 1.0,  idleHit: 2.5, sub: 44, sizzle: 1.0 },
};

/** 'stock' | 'street' | 'race', or a number 0 (stock) .. 1 (race) for older callers. */
// Turbo sizes: whistle range (Hz at a still and a full-speed shaft), how fast the shaft spins
// up and down (s), the boost model (rpm where boost starts, rpm to full, lag s), flutter rate.
export const TURBOS = {
  small: { fw: [2400, 7200], shaftUp: 0.3, shaftDown: 0.85, spool: 2200, range: 1200, lag: 0.3, flutter: [15, 8], whistle: 1 },
  big:   { fw: [1800, 5800], shaftUp: 0.55, shaftDown: 1.3, spool: 3900, range: 1600, lag: 0.85, flutter: [11, 7], whistle: 0.85 },
  // a factory turbo (engines with factoryTurbo): a light spool and a soft 'poof' from the
  // stock recirculating bypass valve on a lift, no flutter
  factory: { fw: [2200, 5600], shaftUp: 0.35, shaftDown: 0.75, spool: 2400, range: 1600, lag: 0.35, flutter: [0, 0], whistle: 0.06, rush: 0.2, lift: 'poof' },
};

export function exhaustName(x) {
  if (typeof x === 'string') return EXHAUSTS[x] ? x : 'stock';
  return x < 0.3 ? 'stock' : x < 0.8 ? 'street' : 'race';
}

/** rpm during the start-up: starter turning it over, catch, flare, settle. t = seconds since key turned. */
export function crankRpm(t, idle = IDLE_RPM, flare = 1450) {
  if (t < 0.15) return 260 * (t / 0.15);
  if (t < 1.0) return 250;
  if (t < 1.25) return 250 + (flare - 250) * ((t - 1.0) / 0.25);
  return idle + (flare - idle) * Math.exp(-(t - 1.25) / 0.45);
}

export class Biquad {
  constructor() { this.b0 = 1; this.b1 = this.b2 = this.a1 = this.a2 = 0; this.z1 = this.z2 = 0; }
  set(type, f, q, gainDb, fs) {
    f = Math.min(Math.max(f, 10), fs * 0.45);
    const w = TAU * f / fs, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else { // peaking
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

export class Delay {
  constructor(n) { this.buf = new Float32Array(n); this.i = 0; }
  write(x) { this.buf[this.i] = x; this.i = (this.i + 1) % this.buf.length; }
  read(d) { // d samples ago, fractional
    const n = this.buf.length, p = this.i - 1 - d, i0 = Math.floor(p), fr = p - i0;
    const a = this.buf[((i0 % n) + n) % n], b = this.buf[(((i0 + 1) % n) + n) % n];
    return a + (b - a) * fr;
  }
}

export function randn() { // cheap gaussian-ish
  return (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
}

// ITBs (individual throttle bodies, set({ intake: 'itb' })): every cylinder breathes through
// its own trumpet, so the intake is heard directly. Each intake stroke pulls one smooth gulp
// of air through its trumpet; what comes out of the open mouth is the change in that flow.
// Six smooth gulps a cycle make a deep, clean note on the firing frequency (no sharp edges,
// so nothing ticks), and because no two trumpets breathe quite alike, a lumpy growl at the
// engine-cycle rate around it. With the throttles shut they add nothing. An engine can
// override any of these with its own `itb: {...}`.
export const ITB = {
  width: 1.0,     // one gulp lasts this many firing intervals
  skew: 1.8,      // >1: the gulp builds fast and tails off (sets the overtones); it always
                  // starts and ends with zero slope, so it never clicks
  uneven: 2.0,    // how differently the trumpets breathe: the growl
  spread: 10,     // and how far apart in timing (crank degrees)
  jitter: 0.08,   // stroke-to-stroke variation
  octave: 0.55,   // every other trumpet breathes harder: a strong note an octave below the
                  // firing note, so the whole thing sounds an octave deeper
  level: 0.4,     // the note
  roar: 1.2,      // rush of air through the trumpets
  roarBand: [300, 2200],
  duck: 3.6,      // how much of the exhaust the trumpets cover up on the throttle
  tick: 0,        // valve-train tick left on the throttle
  // carbon airbox around the trumpets: a stiff, barely damped box. Sound bounces between its
  // walls (a hollow ring at the box's modes) and the air in it bounces on its snout (a deep boom)
  box: 0.0045,    // wall-to-wall round trip, seconds (a big box: rings deep, near 220, 440, 660 Hz)
  boxRing: 0.5,  // how long it rings (carbon: stiff, little damping)
  boxDamp: 1600, // the box's walls soak up the highest part of each bounce (Hz)
  boom: [80, 1.0, 9], // the snout's Helmholtz boom: Hz, Q, dB
  // the whole car with ITBs fitted (exhaust and all):
  lowCut: 70,             // no deep rumble below this
  drone: [[520, 1.4, -7], [850, 1.4, -7]], // 400-1000 Hz drone taken down: Hz, Q, dB
  rasp: [[1700, 1.0, 4.5], [3900, 0.8, 3.5]], // upper-mid rasp: +2 dB 1-2.5 kHz, +4 dB 2.5-6 kHz
  // air sucking through the trumpets: noise above ~5 kHz, gently rolled off above 14 kHz,
  // a steady floor plus a swell with the throttle (not the revs)
  hiss: 0, hissBand: [5000, 14000],
  hissFloor: 0.45, // share of it that stays at idle and between blips; the throttle swells it on top
  // the intake bark: a resonance around 700-900 Hz (higher with the revs) that barks on each
  // blip and lets go: it follows the throttle opening, 30 ms attack, 60 ms release
  bark: [700, 0.03, 3.5], barkGain: 6, barkAttack: 0.03, barkRelease: 0.06,
};
// how each trumpet differs from the average (firing order), scaled by `uneven`
export const ITB_UNEVEN = [0.26, 0.05, -0.23, -0.22, 0.25, -0.1, 0.15, -0.16];

export class M20Dsp {
  constructor(fs) {
    this.mode = 'off';         // off | crank | run | stopping | direct
    this.clock = 0; this.modeT0 = 0; this.stopFrom = 0;
    this.target = { rpm: IDLE_RPM, throttle: 0, exhaust: 'stock', ignition: 1, starter: 0, idleRpm: IDLE_RPM };
    this.c = { rpm: 0, throttle: 0, ignition: 0, starter: 0, idleRpm: IDLE_RPM };
    this.X = { ...EXHAUSTS.stock };   // current exhaust voicing, glides to the chosen preset
    this.cycleN = 0;                  // engine cycles, for the every-other-cycle chop
    this.zingAmp = 0;
    // naturalness: a slow random drift of the engine speed (a real idle control hunts at
    // random, not on a regular wave), and a small outdoor 'room': ground and nearby reflections
    this.wander = 0; this.wanderT = 0;
    this.refl = new Delay(4096); this.reflLp = new Biquad().set('lp', 3500, 0.7, 0, fs);
    this.ap = [113, 337, 541, 773].map((n) => ({ d: new Delay(n + 1), n }));
    this.roomLp = new Biquad().set('lp', 2800, 0.7, 0, fs); this.roomHp = new Biquad().set('hp', 120, 0.7, 0, fs);
    this.envF = 0;
    this.roarLp = new Biquad().set('lp', 3400, 0.6, 0, fs);   // exhaust flow roar (before the muffler)
    this.intakeRoar = new Biquad(); this.zj = 0;
    this.itbOn = 0; this.itbSet = ''; this.itbPrev = 0;
    this.itbRoarHp = new Biquad(); this.itbRoarLp = new Biquad(); this.itbDc = new Biquad();
    this.itbEq = [new Biquad(), new Biquad(), new Biquad(), new Biquad(), new Biquad(), new Biquad()]; // low cut x2, drone, rasp x2, drone
    this.itbHiss = [new Biquad(), new Biquad(), new Biquad()]; this.itbPost = [new Biquad(), new Biquad()]; this.itbBark = new Biquad();
    this.itbThrSlow = 0; this.itbEqW = 0; this.itbBarkEnv = 0; this.itbBarkSrc = 0;
    this.itbBox = new Delay(2048); this.itbBoxLp = 0; this.itbBoxA = 0; this.itbBoom = new Biquad();
    // turbo state: boost and shaft speed 0..1, lift-off envelopes and oscillator phases
    this.T = { on: 0, boost: 0, shaft: 0, armed: false, flut: 0, flutRate: 0, flutPh: 0,
               flutA: 1, whPh: 0, whPh2: 0, whAmp: 0, poof: 0, poofAtk: 1 };
    this.tWhoosh = new Biquad();
    this.tWhNoise = new Biquad(); this.tWhNoise2 = new Biquad(); // airy part of the whistle
    this.cabin = new Biquad().set('lp', 20000, 0.7, 0, fs); this.cabinHz = 20000; // in-car muffling
    this.tFlut = new Biquad().set('bp', 900, 0.6, 0, fs);   // a broad, breathy chatter
    this.tFlutLo = new Biquad().set('lp', 450, 0.7, 0, fs);
    this.tPoof = new Biquad().set('bp', 800, 0.6, 0, fs);   // a soft, breathy puff
    this.tPoofLo = new Biquad().set('lp', 1800, 0.7, 0, fs);
    this.subHz = 28;
    this.onCycle = null;
    this.fs = fs;
    this.phase = 0;            // engine cycle, 0..1 = cycleDeg crank degrees
    this.t = 0;
    this.hdrA = new Delay(512); this.hdrB = new Delay(512);
    this.pipe = new Delay(4096); this.pipe2 = new Delay(4096);
    this.pipeLp = 0; this.pipeLp2 = 0;
    this.useEngine('m20');
    this.thrS = 0; this.rpmS = 800;
    this.muffLp = new Biquad(); this.muffLp2 = new Biquad();
    this.body = new Biquad(); this.drone = new Biquad(); this.mid = new Biquad();
    this.dcHp = new Biquad().set('hp', 28, 0.7, 0, fs);
    this.raspBp = new Biquad(); this.raspHp = new Biquad().set('hp', 900, 0.7, 0, fs);
    this.rumbleBp = new Biquad(); this.rumbleLp = new Biquad().set('lp', 1200, 0.5, 0, fs);
    this.intakeBp = new Biquad();
    this.tickHp = new Biquad().set('hp', 3500, 0.7, 0, fs);
    this.sizzleBp = new Biquad().set('bp', 2000, 0.9, 0, fs); // a band, not full-range hiss
    this.starterBp = new Biquad().set('bp', 1100, 0.9, 0, fs);
    this.starterPh = 0;
    this.tickEnv = 0;
    this.popEnv = 0;           // pressure kick from an afterfire, goes through the exhaust
    this.popLp = 0;
    this.offT = 0;             // seconds since the throttle closed
    this.popArmed = false;     // was there real load at high rpm before the lift?
    this.popBudget = 0;        // pops left for this lift-off
    this.coef = 0;
    // scope: one engine cycle of output, posted ~12x/s
    this.cyc = new Float32Array(Math.ceil(fs * 0.4)); this.cycN = 0; this.sincePost = 0;
  }

  /** Switch engine profile ('m20' | 'ls3'). Keeps running at the current rpm. */
  useEngine(name) {
    const E = ENGINES[name];
    if (!E) return;
    this.engine = name;
    this.E = E;
    const n = E.firing.length;
    // per-cylinder character (in firing order): a real engine is never perfectly even
    this.jit = new Float32Array(n).fill(1);
    this.tjit = new Float32Array(n);   // per-cycle timing scatter, crank degrees
    this.pop = new Float32Array(n);
    this.lastX = new Float32Array(n).fill(1);
    this.itbJ = new Float32Array(n).fill(1);
    this.coef = 0;                      // refresh filters on the next block
  }

  /** Values from the game: { rpm, throttle (0..1), exhaust ('stock' | 'street' | 'race'), idleRpm, engine },
   *  and in 'direct' mode also { ignition (0/1), starter (0/1) }. */
  set(v) {
    if (v.engine && v.engine !== this.engine) this.useEngine(v.engine);
    Object.assign(this.target, v);
  }

  /** 'crank' (key start), 'start' (straight to idle), 'stop' (key off),
   *  'direct' (the game's engine model drives rpm, ignition and starter itself). */
  command(cmd) {
    this.modeT0 = this.clock;
    const idle = this.target.idleRpm;
    if (cmd === 'crank') { this.mode = 'crank'; this.target.rpm = idle; this.target.throttle = 0; }
    else if (cmd === 'start') { this.mode = 'run'; this.target.rpm = idle; this.rpmS = idle; }
    else if (cmd === 'stop') { this.mode = 'stopping'; this.stopFrom = this.rpmS; }
    else if (cmd === 'direct') { this.mode = 'direct'; this.rpmS = this.target.rpm; }
  }

  // 58 mm turbo: boost builds from about 2,600 rpm to full around 4,300 rpm under load, with
  // about half a second of lag; the shaft keeps spinning down for a while after a lift
  _turbo(n, t, c) {
    const T = this.T, dt = n / this.fs;
    // set({ turbo: 1 }) fits the aftermarket turbo; engines with a factoryTurbo always have
    // their stock one otherwise
    const fitted = t.turbo ? 1 : this.E.factoryTurbo ? 1 : 0;
    T.on += (fitted - T.on) * Math.min(1, dt / 0.15);
    if (T.on < 0.001 && !fitted) { T.boost = T.shaft = T.flut = T.poof = 0; return; }
    const r = this.rpmS, Z = t.turbo ? TURBOS[t.turboSize] || TURBOS.small : TURBOS[this.E.factoryTurbo] || TURBOS.small;
    // a lift only counts once the throttle stays shut a moment: rev-limiter cuts (about
    // 0.07 s) keep the boost, a real lift or a gear change (0.2 s or more) lets it go
    T.closedT = c.throttle < 0.15 ? (T.closedT || 0) + dt : 0;
    if (c.throttle >= 0.15) T.lastThr = c.throttle;
    const th = T.closedT > 0 && T.closedT < 0.09 ? (T.lastThr || 0) : c.throttle;
    if (typeof t.boost === 'number') {
      T.boost = Math.min(1, Math.max(0, t.boost)); // the game's own boost
    } else {
      // 48 mm (GT2860-class): boost from about 2,200 rpm, full by about 3,400, short lag
      const tgt = th * Math.min(1, Math.max(0, (r - Z.spool) / Z.range));
      const tau = tgt > T.boost ? Z.lag : th < 0.15 ? 0.12 : 0.25;
      T.boost += (tgt - T.boost) * Math.min(1, dt / tau);
    }
    const shaftT = Math.max(T.boost, (0.1 + 0.25 * th) * Math.min(1, r / 7000));
    T.shaft += (shaftT - T.shaft) * Math.min(1, dt / (shaftT > T.shaft ? Z.shaftUp : Z.shaftDown));
    T.Z = Z;
    // lift-off with boost: compressor flutter, or a factory bypass valve's soft poof
    if (th > 0.5) T.armed = true;
    if (T.armed && T.closedT >= 0.09) {
      T.armed = false;
      if (T.boost > 0.15 && fitted && Z.lift === 'poof') {
        const rf = Math.min(1, Math.max(0, (r - 2200) / 4300));
        T.poof = Math.min(1, T.boost * (0.35 + 0.65 * rf)); T.poofAtk = 0;
      } else if (T.boost > 0.15 && fitted) {
        // the higher the revs you lift at, the more air surges back: soft from low rpm,
        // full strength near the top, and still scaled by the boost you had
        const rf = Math.min(1, Math.max(0, (r - 2200) / 4300));
        T.flut = Math.min(1, T.boost * (0.05 + 0.95 * Math.pow(rf, 1.5)));
        T.flutRate = Z.flutter[0] + Z.flutter[1] * T.boost + 5 * rf; T.flutPh = 0;
      }
    }
  }

  _control(n) {
    const c = this.c, t = this.target, dt = this.clock - this.modeT0;
    // lift-off tracking for afterfire pops
    if (c.throttle < 0.06) {
      if (this.offT === 0 && this.popArmed && this.rpmS > 3500) {
        this.popBudget = Math.floor(Math.random() * this.X.pops * (this.E.popMul || 1)); // stock 0-1, street 0-2, race 0-4 (more on a rotary)
      }
      this.popArmed = false;
      this.offT += n / this.fs;
    } else {
      this.offT = 0;
      if (c.throttle > 0.6 && this.rpmS > 3500) this.popArmed = true;
    }
    const P = EXHAUSTS[exhaustName(t.exhaust)];
    for (const k in P) this.X[k] += (P[k] - this.X[k]) * 0.03; // ~0.1 s glide when you swap pipes
    c.idleRpm = t.idleRpm;
    if (this.mode === 'crank') {
      c.rpm = crankRpm(dt, t.idleRpm, this.E.crankFlare); c.throttle = 0;
      c.starter = dt < 1.05 ? 1 : 0; c.ignition = dt >= 0.95 ? 1 : 0;
      if (dt >= CRANK_SECONDS) { this.mode = 'run'; t.rpm = c.rpm; }
    } else if (this.mode === 'run') {
      c.rpm = t.rpm; c.throttle = t.throttle; c.ignition = 1; c.starter = 0;
    } else if (this.mode === 'direct') {
      c.rpm = t.rpm; c.throttle = t.throttle; c.ignition = t.ignition; c.starter = t.starter;
    } else if (this.mode === 'stopping') {
      c.rpm = Math.max(0, this.stopFrom * (1 - dt / 0.9)); c.throttle = 0; c.ignition = 0; c.starter = 0;
      if (dt > 0.9) this.mode = 'off';
    } else {
      c.rpm = 0; c.throttle = 0; c.ignition = 0; c.starter = 0;
    }
    this._turbo(n, t, c);
    this.clock += n / this.fs;
  }

  pulse(xDeg, width, sharp = 0, tail = 0) {
    // engines with a long blowdown tail (the rotary): sharp start, then the gas keeps flowing
    // and decays over `tail` degrees, so there is no silence between firings
    if (tail > 0) {
      if (xDeg <= 0 || xDeg > width + tail * 6) return 0;
      if (xDeg < width) { const u = xDeg / width; return sharp * u + (1 - sharp) * u * u * (3 - 2 * u); }
      return Math.exp(-(xDeg - width) / tail);
    }
    // exhaust blowdown: smooth rise and decay (a sharp edge here = buzz). A rotary's port
    // opens all at once, so it blends towards a sharper start.
    if (xDeg <= 0 || xDeg > width * 7) return 0;
    const u = xDeg / width;
    const smooth = u * u * Math.exp(2 * (1 - u));
    return sharp > 0 ? smooth * (1 - sharp) + u * Math.exp(1 - u) * sharp : smooth;
  }

  /** Fill `out` (Float32Array) with the next block of sound. */
  process(out) {
    const fs = this.fs, N = out.length;
    this._control(N);
    const C = this.c;

    // block-rate coefficient updates
    const thr0 = C.throttle, rpm0 = C.rpm, X = this.X;
    if (this.coef++ % 4 === 0) {
      const E = this.E, m = E.muff, open = X.open * (1 - 0.22 * this.T.on); // the turbine muffles a bit
      // the muffler lets more through as the revs rise: a higher-pitched note up top, idle as before
      this.muffLp.set('lp', (m[0] + m[1] * thr0 + rpm0 * m[2] * (E.muffRpm ?? 1.5)) * open, 0.6, 0, fs);
      this.tWhoosh.set('bp', 1100 + 3200 * this.T.shaft, 1.3, 0, fs);
      if (this.T.on > 0.001) { // the whistle's airy band follows the shaft
        const Zw = this.T.Z || TURBOS.small, fwB = Zw.fw[0] + (Zw.fw[1] - Zw.fw[0]) * this.T.shaft;
        this.tWhNoise.set('bp', fwB, 30, 0, fs); this.tWhNoise2.set('bp', fwB, 30, 0, fs);
      }
      this.muffLp2.set('lp', (m[3] + m[4] * thr0 + rpm0 * (E.muffRpm2 ?? 0.18)) * open, 0.5, 0, fs);
      this.body.set('pk', E.body[0], 1.1, E.body[1] + X.bodyDb, fs);
      this.drone.set('pk', E.drone[0] * X.droneHz, 1.6, E.drone[1] + X.droneDb, fs);
      if (E.mid) this.mid.set('pk', E.mid[0], 1.4, E.mid[1], fs);
      this.raspBp.set('bp', E.rasp[0] + rpm0 * E.rasp[1], 0.6, 0, fs);
      this.rumbleBp.set('bp', E.rumble[0] + rpm0 * E.rumble[1], 0.45, 0, fs);
      this.intakeBp.set('bp', E.intake[0] + rpm0 * E.intake[1], 1.4, 0, fs);
      this.intakeRoar.set('bp', 500 + rpm0 * 0.12, 0.7, 0, fs);
      const I = this.E.itb ? { ...ITB, ...this.E.itb } : ITB;
      if (this.itbSet !== this.engine) { // ITB voicing only changes with the engine
        this.itbSet = this.engine; this.I = I;
        this.itbRoarHp.set('hp', I.roarBand[0], 0.6, 0, fs); this.itbRoarLp.set('lp', I.roarBand[1], 0.6, 0, fs);
        this.itbDc.set('hp', 45, 0.7, 0, fs);
        this.itbBoom.set('pk', I.boom[0], I.boom[1], I.boom[2], fs);
        this.itbBoxA = 1 - Math.exp(-2 * Math.PI * I.boxDamp / fs);
        this.itbEq[0].set('hp', I.lowCut, 0.6, 0, fs); this.itbEq[1].set('hp', I.lowCut, 0.9, 0, fs);
        this.itbPost[0].set('hp', I.lowCut, 0.6, 0, fs); this.itbPost[1].set('hp', I.lowCut, 0.9, 0, fs);
        this.itbEq[2].set('pk', I.drone[0][0], I.drone[0][1], I.drone[0][2], fs);
        this.itbEq[5].set('pk', I.drone[1][0], I.drone[1][1], I.drone[1][2], fs);
        this.itbEq[3].set('pk', I.rasp[0][0], I.rasp[0][1], I.rasp[0][2], fs);
        this.itbEq[4].set('pk', I.rasp[1][0], I.rasp[1][1], I.rasp[1][2], fs);
        this.itbHiss[0].set('hp', I.hissBand[0], 0.7, 0, fs); this.itbHiss[1].set('hp', I.hissBand[0], 0.7, 0, fs);
        this.itbHiss[2].set('lp', I.hissBand[1], 0.5, 0, fs);
        this.itbBarkAtk = 1 - Math.exp(-1 / (I.barkAttack * fs)); this.itbBarkRel = 1 - Math.exp(-1 / (I.barkRelease * fs));
      }
    }
    if (this.I && this.itbOn > 0.001) this.itbBark.set('bp', this.I.bark[0] + rpm0 * this.I.bark[1], this.I.bark[2], 0, fs);
    const itbT = this.target.intake === 'itb' ? 1 : 0;

    const E = this.E, ncyl = E.firing.length;
    const cyc = E.cycleDeg || 720, revs = cyc / 360, sharp = E.pulseSharp || 0, tail = E.tail || 0;
    const tickAmt = E.tick ?? 1, inLag = E.intakeLag ?? 360;
    for (let i = 0; i < N; i++) {
      const rpmIn = C.rpm, thrIn = C.throttle, ign = C.ignition;
      const st = C.starter, idle = C.idleRpm;
      this.thrS += (thrIn - this.thrS) * 0.0015;
      this.rpmS += (rpmIn - this.rpmS) * 0.004;
      const thr = this.thrS;
      let rpm = this.rpmS;

      // idle lope + compression drag while cranking
      // full idle character within 100 rpm of the idle target (an idle control rarely sits
      // exactly on it), fading out over the next 400 rpm
      const nearIdle = Math.max(0, 1 - Math.max(0, Math.abs(rpm - idle) - 100) / 400) * (1 - thr);
      // cammed idle (louder exhausts): the chop is per firing (below), so the stock engine's
      // slow idle wobble fades out; it would only add a vague drift under the rhythm
      const lope = Math.max(X.lope, E.baseLope || 0) * nearIdle;
      rpm *= 1 + nearIdle * (1 - X.lope) * (E.lope[0] * Math.sin(TAU * 1.13 * this.t) + E.lope[1] * Math.sin(TAU * 0.41 * this.t));
      // random drift (slowly varying noise), larger at idle, small under load
      this.wanderT += (randn() - this.wanderT) * 0.0006;
      this.wander += (this.wanderT - this.wander) * 0.0004;
      rpm *= 1 + this.wander * (0.25 + 0.75 * nearIdle); // about +-1% at idle, less under load
      if (st > 0) rpm *= 1 - 0.35 * st * Math.max(0, Math.cos(TAU * this.phase * ncyl));
      rpm = Math.max(0, rpm);
      this.phase += rpm / 60 / revs / fs;    // 2 revolutions per cycle (3 for the rotary)
      if (this.phase >= 1) this.phase -= 1;
      this.t += 1 / fs;

      // combustion strength
      const overrun = thr < 0.06 && rpm > idle * 1.35; // fuel cut
      const fuel = overrun ? 0 : 1;
      // idle firings hit harder with a free-flowing exhaust (louder, punchier idle)
      const load = ign * fuel * (0.32 * (1 + (X.idleHit - 1) * (E.idleHitScale || 1) * (1 - thr)) + 0.68 * thr);
      const pump = E.pump;                     // air being pushed out with no combustion
      const width = E.width[0] - E.width[1] * thr; // crank degrees; harder hit under load

      let a = 0, b = 0, env = 0, inEnv = 0, hit = 0, itbB = 0;
      this.itbOn += (itbT - this.itbOn) * 0.0005;
      const itbAct = this.itbOn > 0.001, I = this.I, sp = cyc / ncyl;
      // with a louder exhaust the trumpets get angrier too: 0 stock, 0.5 street, 1 race
      const aggro = Math.min(1, Math.max(0, (X.level - 1) / 0.5));
      for (let k = 0; k < ncyl; k++) {
        // new cycle for this cylinder is detected from crank position alone; the random
        // timing scatter only moves where its pulse lands (otherwise one cycle can trigger twice)
        let xc = this.phase * cyc - E.angles[k] - E.cylTiming[k];
        xc = ((xc % cyc) + cyc) % cyc;
        if (xc < this.lastX[k]) { // this cylinder's exhaust valve just opened: new cycle for it
          // no two combustions are the same; this scatter is what turns buzz into rumble
          // a cammed idle is choppy but regular: less random scatter, more pattern
          const j = E.jitter + 0.04 + E.idleJitter * nearIdle * (1 - 0.6 * lope) + 0.03 * (1 - ign); // +0.04: no two firings alike
          this.jit[k] = Math.max(0.3, 1 + j * randn());
          this.tjit[k] = (3.5 + 1.5 * lope) * (E.scatter ?? 1) * randn();
          // choppy idle: a pattern over two engine cycles (a stumble, then a hard hit),
          // and now and then an extra weak firing so it never sounds like a loop
          if (lope > 0.001) {
            if (k === 0) this.cycleN++;
            const step = (this.cycleN & 1) * ncyl + k;
            this.jit[k] *= Math.max(0.15, 1 + lope * (E.chop[step] - 1));
            if (Math.random() < 0.04 * lope * (E.stumble ?? 1)) this.jit[k] *= 0.4;
          }
          // afterfire: only well into a real lift-off (not limiter or shift cuts), a few at most
          this.pop[k] = 0;
          if (this.popBudget > 0 && overrun && ign > 0.5 && rpm > 2400 &&
              this.offT > 0.35 && this.offT < 1.8 && Math.random() < 0.035) {
            this.pop[k] = 0.5 + 0.7 * Math.random();
            this.popEnv = this.pop[k];
            this.popBudget--;
          }
          this.tickEnv = 1;
          // every stack breathes a little differently (fixed), and no two strokes are alike
          if (this.I) this.itbJ[k] = Math.max(0.15, (1 + this.I.uneven * (1 + 0.5 * Math.min(1, Math.max(0, (X.level - 1) / 0.5))) * ITB_UNEVEN[k % 8] + this.I.octave * (k % 2 ? -1 : 1)) * (1 + this.I.jitter * randn()));
        }
        this.lastX[k] = xc;
        let x = xc - this.tjit[k];
        if (x < 0) x += cyc;
        const p = this.pulse(x, width, sharp, tail);
        const amp = E.cylGain[k] * this.jit[k] * (load + pump + this.pop[k] * 0.9);
        const v = p * amp;
        if (E.bank[k] === 0) a += v; else b += v;
        env += v;
        // what the turbulence noise rides on: the sharp start of each firing only (on the
        // rotary's long blowdown tail, riding on env would turn it into a steady hiss)
        const ht = E.hitTail || 25;
        hit += tail > 0 ? (x > 0 && x < width + ht * 5 ? amp * (x < width ? p : Math.exp(-(x - width) / ht)) : 0) : v;
        // intake valve opens ~360 deg later on the same cylinder
        const xi = x - inLag;
        if (xi > 0 && xi < 180) inEnv += Math.sin(Math.PI * xi / 180);
        if (itbAct) { // this cylinder's gulp of air through its own trumpet
          let xs = xi - I.spread * ITB_UNEVEN[(k + 3) % 8];
          if (xs < 0) xs += cyc;
          const u = xs / (I.width * sp);
          if (u < 1) { const g = Math.sin(Math.PI * (1 - Math.pow(1 - u, I.skew + 0.8 * aggro))); itbB += g * g * this.itbJ[k]; }
        }
      }

      // manifolds: slightly different runner lengths, partial reflection at the collector
      const dA = fs * E.header[0], dB = fs * E.header[1];
      const hA = this.hdrA.read(dA), hB = this.hdrB.read(dB);
      this.hdrA.write(a - 0.32 * hA);
      this.hdrB.write(b - 0.32 * hB);
      // afterfire kick: a short low-passed burst entering the pipe, so the
      // muffler shapes it into a thud-crack rather than a digital click
      this.popEnv *= 0.9965;
      this.popLp += ((this.popEnv > 0.005 ? randn() * this.popEnv : 0) - this.popLp) * 0.25;
      // flow roar: at high revs and load, turbulent gas noise rushing down the exhaust grows
      // steeply (about with flow squared); fed in before the muffler so it gets each engine's
      // tone. Partly pulsed with the firings. Quiet below about 4,000 rpm.
      const hr = Math.min(1.1, Math.max(0, rpm / (E.redline || 6500) - 0.3) / 0.7);
      const roar = Math.pow(hr, 1.2) * (0.04 + 0.96 * thr) // closed throttle: little flow, little roar * (E.roar ?? 1) * (0.8 + 0.2 * X.open);
      const rn = roar > 0.0005 ? this.roarLp.run(randn()) * roar * (0.55 + 0.45 * Math.min(2, env)) * 3.2 : 0;
      const refl = E.pipeRefl - X.refl;
      let pipeOut;
      if (!E.dual) {
        // one collector into one pipe (~3 m): inverted, lossy reflection from the open end
        const coll = hA + hB + this.popLp * 1.4 + rn;
        const back = this.pipe.read(fs * (E.pipe[0] / 343) * 2);
        this.pipeLp += (back - this.pipeLp) * 0.35;
        pipeOut = coll - refl * this.pipeLp;
        this.pipe.write(pipeOut);
      } else {
        // true duals: each bank down its own pipe, so its uneven 90/180/270 beat survives
        const inA = hA + this.popLp * 0.7 + rn * 0.5, inB = hB + this.popLp * 0.7 + rn * 0.5;
        const backA = this.pipe.read(fs * (E.pipe[0] / 343) * 2);
        const backB = this.pipe2.read(fs * (E.pipe[1] / 343) * 2);
        this.pipeLp += (backA - this.pipeLp) * 0.35;
        this.pipeLp2 += (backB - this.pipeLp2) * 0.35;
        const oA = inA - refl * this.pipeLp, oB = inB - refl * this.pipeLp2;
        this.pipe.write(oA); this.pipe2.write(oB);
        // the listener is nearer one tailpipe, so the two banks don't cancel into an even eight
        pipeOut = oA * E.listen[0] + oB * E.listen[1];
      }

      let y = this.muffLp2.run(this.muffLp.run(pipeOut));
      y = this.drone.run(this.body.run(y));
      if (E.mid) y = this.mid.run(y);

      // rumble: gas turbulence in the pipe, fills the gaps between the harmonics
      y += this.rumbleLp.run(this.rumbleBp.run(randn() * hit)) * (0.45 * (1 - 0.75 * lope) * E.idleNoise + 1.5 * thr) * X.rumble * E.rumble[2];

      // rasp: turbulence that rides on each pulse, grows with rpm and load
      // at idle the loud pipes' rasp stays low (it reads as hiss); it opens up with load
      const raspAmt = (0.05 * (1 - 0.7 * lope) * E.idleNoise + 0.22 * thr) * Math.min(1.3, Math.max(E.raspFloor || 0, rpm / 4500)) * X.rasp * E.rasp[2] * (1 - 0.4 * this.T.on);
      // the crack on top of an afterfire: short (popEnv^3 decays fast), band-limited by the
      // rasp filter, and quieter through the stock muffler
      const crack = this.popEnv > 0.02 ? randn() * this.popEnv ** 3 * X.crack : 0;
      y += this.raspHp.run(this.raspBp.run(randn() * hit * raspAmt + crack * 0.9));

      // intake roar (heard more than you'd think with the throttle open)
      y += this.intakeBp.run(randn() * inEnv) * E.intake[2] * thr * (0.3 + rpm / 6500);
      // intake roar: a broad rush that opens up at high revs and full throttle
      y += this.intakeRoar.run(randn()) * 0.28 * thr * thr * hr * hr * (E.intakeRoar ?? 1);

      // valve-train tick
      // sizzle: a little crackle on the loudest pulses of a loud exhaust (kept low and
      // band-limited: any more and the idle sounds like static)
      if (X.sizzle > 0.01) y += this.sizzleBp.run(randn() * hit * hit * hit) * 0.035 * X.sizzle * E.sizzle * (1 + 2 * thr);

      this.tickEnv *= 0.9;
      y += this.tickHp.run(randn() * this.tickEnv) * 0.012 * tickAmt * Math.min(1, rpm / 3000) * (1 - this.itbOn * thr * (1 - (this.I?.tick ?? 1))); // ITBs drown it on the throttle // none on a rotary


      // starter motor whine (pinion ~ 11x crank speed) with gear grind
      if (st > 0.001) {
        this.starterPh += (rpm / 60) * E.starterRatio / fs;
        this.starterPh -= Math.floor(this.starterPh);
        const saw = 2 * this.starterPh - 1;
        y += this.starterBp.run(saw + 0.4 * randn()) * 0.35 * st;
      }

      // ITBs: heard straight from the trumpets (under the bonnet, so still clear from the cabin).
      // The sound out of a trumpet mouth is the change in its flow: louder the faster it turns.
      if (itbAct) {
        const dB = itbB - this.itbPrev; this.itbPrev = itbB;
        // ~1 at 6,000 rpm; grows gently with the revs (it would double with them otherwise)
        const note = dB * (I.width * sp) / (36000 / fs) * Math.pow(6000 / Math.max(600, rpm), 0.75);
        const thrI = Math.sqrt(thr);                                 // they take over early in the pedal travel
        const roar = this.itbRoarLp.run(this.itbRoarHp.run(randn() * itbB)) * I.roar * (1 + 0.8 * aggro) * Math.min(1.2, 0.4 + rpm / 7500);
        // through the airbox: its wall-to-wall ring (a feedback comb, a little damped each bounce)
        // and the snout's boom
        const dry = note * I.level + roar;
        this.itbBarkSrc = dry * this.itbOn * ign;
        const back = this.itbBox.read(I.box * fs);
        this.itbBoxLp += (back - this.itbBoxLp) * this.itbBoxA;
        const inBox = dry + I.boxRing * this.itbBoxLp;
        this.itbBox.write(inBox);
        const it = this.itbBoom.run(inBox * (1 - 0.2 * I.boxRing)) * this.itbOn * ign * thrI;
        // the same on every engine and exhaust (the output stage scales by their levels)
        // the same on every engine (the output stage scales by its level); a louder exhaust's
        // output stage drives the trumpets harder too: louder, and into the limiter's bite
        this.itbOut = this.itbDc.run(it) * (1 - 0.35 * Math.min(1, this.target.cabin || 0)) / E.level;
      } else { this.itbOut = 0; this.itbPrev = 0; this.itbBarkSrc = 0; }

      // low cut follows the exhaust: louder pipes trade sub mud for punch
      const subT = Math.max(X.sub, E.subMin || 0);
      if (Math.abs(subT - this.subHz) > 0.5) { this.subHz = subT; this.dcHp.set('hp', subT, 0.7, 0, fs); }
      // in the car (set({ cabin: 1 })): the exhaust is heard through the bulkhead; the turbo
      // (added below) is under the bonnet in front of you, so it stays clear
      const cabT = 20000 - (20000 - 1100) * Math.min(1, Math.max(0, this.target.cabin || 0));
      if (Math.abs(cabT - this.cabinHz) > 1) { this.cabinHz += (cabT - this.cabinHz) * 0.01; this.cabin.set('lp', this.cabinHz, 0.7, 0, fs); }
      if (this.cabinHz < 19000) y = this.cabin.run(y);

      // turbo: a clean compressor whistle that follows the shaft (loud on throttle, still
      // singing as the shaft spins down after a lift), an air rush, and flutter on a lift
      const T = this.T;
      if (T.on > 0.001) {
        const Z = T.Z || TURBOS.small;
        const sh = T.shaft;
        // a real compressor whistle wavers a little; a perfectly steady sine sounds electronic
        const wob = 1 + 0.004 * Math.sin(TAU * 5.3 * this.t) + 0.003 * Math.sin(TAU * 2.1 * this.t + 1) + 0.002 * randn();
        const fw = (Z.fw[0] + (Z.fw[1] - Z.fw[0]) * sh) * wob; // small: up to about 7.2 kHz
        T.whPh += fw / fs; T.whPh -= Math.floor(T.whPh);
        T.whPh2 += fw * 2.01 / fs; T.whPh2 -= Math.floor(T.whPh2);
        // a factory turbo only whistles on real boost; an aftermarket one with shaft speed
        const wt = Z.lift === 'poof' ? T.boost * T.boost : Math.pow(sh, 1.5);
        T.whAmp += (wt * (0.55 + 0.45 * thr) - T.whAmp) * 0.0008;
        const tone = (Math.sin(TAU * T.whPh) + 0.15 * Math.sin(TAU * T.whPh2)) * 0.6;
        const air = this.tWhNoise2.run(this.tWhNoise.run(randn())) * 9; // narrow band of rushing air
        let ty = (tone + air) * 0.55 * Z.whistle * T.whAmp;
        // a factory turbo's air rush follows the boost (it dies with it); an aftermarket one the shaft
        const rs = Z.lift === 'poof' ? T.boost : sh;
        ty += this.tWhoosh.run(randn()) * 0.4 * (Z.rush ?? 1) * rs * rs * (0.2 + 0.8 * thr);
        if (T.poof > 0.0005) {
          T.poofAtk = Math.min(1, (T.poofAtk || 0) + 1 / (0.012 * fs)); // soft 12 ms onset
          ty += this.tPoofLo.run(this.tPoof.run(randn())) * T.poof * T.poofAtk * 1.0;
          T.poof *= 1 - 1 / (0.1 * fs);
        }
        if (T.flut > 0.0005) {
          T.flutRate *= 1 - 0.45 / fs;                // the chatter slows as the boost dies
          T.flutPh += T.flutRate / fs;
          if (T.flutPh >= 1) { T.flutPh -= 1; T.flutA = 0.8 + 0.4 * Math.random(); } // no two pulses alike
          // smooth swells, not hard gates: it dips about 12 dB between pulses
          const g = 0.4 + 0.6 * Math.pow(0.5 + 0.5 * Math.cos(TAU * T.flutPh), 2);
          const n = randn();
          ty += (this.tFlut.run(n) * 1 + this.tFlutLo.run(n) * 0.6) * g * T.flutA * T.flut * 12;
          T.flut *= 1 - 1 / (0.55 * fs);
        }
        y += ty * T.on;
      }
      // with ITBs the intake takes over under load: the stacks cover up part of the exhaust
      const itbDuck = itbAct ? 1 - Math.min(0.93, 0.4 * this.itbOn * Math.sqrt(thr) * I.duck * (1 - 0.55 * aggro)) : 1; // a race pipe still barks through
      if (itbAct) y *= itbDuck;

      // zing (engines that define it): clean tones locked to the firing, rising with rpm
      if (E.zing) {
        const Z = E.zing;
        const u = Math.min(1, Math.max(0, (rpm - Z.from) / (Z.to - Z.from)));
        const target = ign * Z.level * (0.04 + 0.96 * u * u * (3 - 2 * u)) * (0.45 + 0.55 * thr) * (0.85 + 0.15 * X.open);
        this.zingAmp += (target - this.zingAmp) * 0.002;
        // small random phase wobble: a howl from moving metal and air, not an organ note
        this.zj = this.zj * 0.9995 + randn() * 0.012;
        const fp = TAU * this.phase * ncyl + this.zj; // firing phase: ncyl firings per cycle
        let z = 0;
        for (const [h, a] of Z.harmonics) z += a * Math.sin(h * fp + this.zj * h * 0.7);
        // pulse a little with the actual firings, so it is part of the engine, not an organ note
        this.envF += (env - this.envF) * 0.02;
        y += z * this.zingAmp * (0.75 + 0.25 * Math.min(1.5, this.envF * 2)) * itbDuck;
      }
      y = this.dcHp.run(y);
      // outdoor room: a ground reflection (~3 ms) and nearby surfaces (7, 13 ms), plus a short,
      // soft diffuse tail; quiet, but it takes away the dry, in-the-box sound
      this.refl.write(y);
      let wet = this.reflLp.run(this.refl.read(fs * 0.0029) * 0.45 + this.refl.read(fs * 0.0073) * 0.28 + this.refl.read(fs * 0.013) * 0.2);
      let dif = this.roomHp.run(this.roomLp.run(this.refl.read(fs * 0.019)));
      for (const a of this.ap) { const dl = a.d.read(a.n - 1); const v = dif + 0.6 * dl; a.d.write(v); dif = dl - 0.6 * v; }
      y = y * 0.85 + wet * 0.5 + dif * 0.22;
      // the trumpets go in after the room: they are right in front of you, and a near-pure note
      // through the ground reflection would swell and vanish as the revs sweep past its notches
      if (itbAct) {
        y += this.itbOut;
        // the whole car with ITBs on the throttle: low cut here, the rest after the output stage
        // (below). It comes in with the throttle, so the idle is left exactly as it was
        this.itbEqW = this.itbOn * Math.min(1, 3 * thr);
        const Q = this.itbEq;
        y += (Q[1].run(Q[0].run(y)) - y) * this.itbEqW;
        // intake bark: a burst on each snap of the throttle (how far it moved in the last ~50 ms;
        // above a threshold, so the burst ends ~0.1 s in rather than fading for a third of a second)
        this.itbThrSlow += (thr - this.itbThrSlow) * (1 / (0.05 * fs));
        const open = Math.min(1, Math.max(0, thr - this.itbThrSlow - 0.15) * 3);
        this.itbBarkEnv += (open - this.itbBarkEnv) * (open > this.itbBarkEnv ? this.itbBarkAtk : this.itbBarkRel);
        y += this.itbBark.run(this.itbBarkSrc) * this.itbBarkEnv * I.barkGain / E.level;
        // air sucking through the trumpets: follows the throttle, not the revs
        const H = this.itbHiss;
        const hissLvl = I.hissFloor * Math.min(1, rpm / 400) + (1 - I.hissFloor) * thr; // fades out only when the engine stops
        y += H[2].run(H[1].run(H[0].run(randn()))) * I.hiss * this.itbOn * hissLvl / E.level;
      }
      let o = Math.tanh(y * 0.38 * E.level * X.level) * 1.35 * (E.post || 1); // gentle: mostly linear, only peaks round off
      // soft knee above 0.9 so loud engines never clip the output
      if (o > 0.9) o = 0.9 + 0.1 * Math.tanh((o - 0.9) / 0.1);
      else if (o < -0.9) o = -0.9 - 0.1 * Math.tanh((-o - 0.9) / 0.1);
      // with ITBs: after the output stage (its soft saturation would refill what the EQ takes out),
      // the low cut again, the 400-1000 Hz drone down and the upper-mid rasp up
      if (this.itbOn > 0.001) {
        const Q = this.itbEq;
        const e = Q[4].run(Q[3].run(Q[5].run(Q[2].run(this.itbPost[1].run(this.itbPost[0].run(o))))));
        o += (e - o) * this.itbEqW;
        // the rasp boost can push peaks back over: the same soft knee as above
        if (o > 0.9) o = 0.9 + 0.1 * Math.tanh((o - 0.9) / 0.1);
        else if (o < -0.9) o = -0.9 - 0.1 * Math.tanh((-o - 0.9) / 0.1);
      }
      out[i] = o;

      this.cyc[this.cycN] = o;
      if (this.cycN < this.cyc.length - 1) this.cycN++;
      this.sincePost++;
      if (this.phase < rpm / 60 / revs / fs) { // cycle wrapped (cylinder 1 exhaust opened)
        if (this.sincePost > fs / 12 && this.cycN > 16) {
          const pts = 360, s = new Float32Array(pts);
          for (let q = 0; q < pts; q++) s[q] = this.cyc[Math.floor(q / pts * this.cycN)];
          if (this.onCycle) this.onCycle(s, this.T.boost * this.T.on);
          this.sincePost = 0;
        }
        this.cycN = 0;
      }
    }
  }
}
