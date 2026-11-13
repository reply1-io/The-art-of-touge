// DSP core that synthesizes piston engines from first principles: the BMW M20 2.5
// straight-six (E30 325i) and the GM LS3 6.2 V8. Each engine is a profile in ENGINES.
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
// Exhausts are their own sound presets (EXHAUSTS): stock, street and race change the
// muffler, rasp, rumble, resonances and drive, and the aftermarket ones add a heavy
// cammed, choppy idle: some cylinders burn weak every cycle, alternate cycles hit
// harder, now and then one stumbles. Tuned against a recording of a cammed LS V8 idle.

export const TAU = Math.PI * 2;
export const CRANK_SECONDS = 2.6;

// Engine profiles. angles: crank degrees (0..720) at which each cylinder's exhaust valve
// opens, in firing order; bank: which manifold/pipe that cylinder feeds.
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
    level: 1.4,
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

export class M20Dsp {
  constructor(fs) {
    this.mode = 'off';         // off | crank | run | stopping | direct
    this.clock = 0; this.modeT0 = 0; this.stopFrom = 0;
    this.target = { rpm: IDLE_RPM, throttle: 0, exhaust: 'stock', ignition: 1, starter: 0, idleRpm: IDLE_RPM };
    this.c = { rpm: 0, throttle: 0, ignition: 0, starter: 0, idleRpm: IDLE_RPM };
    this.X = { ...EXHAUSTS.stock };   // current exhaust voicing, glides to the chosen preset
    this.cycleN = 0;                  // engine cycles, for the every-other-cycle chop
    this.subHz = 28;
    this.onCycle = null;
    this.fs = fs;
    this.phase = 0;            // engine cycle, 0..1 = 720 crank degrees
    this.t = 0;
    this.hdrA = new Delay(512); this.hdrB = new Delay(512);
    this.pipe = new Delay(4096); this.pipe2 = new Delay(4096);
    this.pipeLp = 0; this.pipeLp2 = 0;
    this.useEngine('m20');
    this.thrS = 0; this.rpmS = 800;
    this.muffLp = new Biquad(); this.muffLp2 = new Biquad();
    this.body = new Biquad(); this.drone = new Biquad();
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

  _control(n) {
    const c = this.c, t = this.target, dt = this.clock - this.modeT0;
    // lift-off tracking for afterfire pops
    if (c.throttle < 0.06) {
      if (this.offT === 0 && this.popArmed && this.rpmS > 3500) {
        this.popBudget = Math.floor(Math.random() * this.X.pops); // stock 0-1, street 0-2, race 0-4
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
    this.clock += n / this.fs;
  }

  pulse(xDeg, width) {
    // exhaust blowdown: smooth rise and decay (a sharp edge here = buzz)
    if (xDeg <= 0 || xDeg > width * 7) return 0;
    const u = xDeg / width;
    return u * u * Math.exp(2 * (1 - u));
  }

  /** Fill `out` (Float32Array) with the next block of sound. */
  process(out) {
    const fs = this.fs, N = out.length;
    this._control(N);
    const C = this.c;

    // block-rate coefficient updates
    const thr0 = C.throttle, rpm0 = C.rpm, X = this.X;
    if (this.coef++ % 4 === 0) {
      const E = this.E, m = E.muff, open = X.open;
      this.muffLp.set('lp', (m[0] + m[1] * thr0 + rpm0 * m[2]) * open, 0.6, 0, fs);
      this.muffLp2.set('lp', (m[3] + m[4] * thr0) * open, 0.5, 0, fs);
      this.body.set('pk', E.body[0], 1.1, E.body[1] + X.bodyDb, fs);
      this.drone.set('pk', E.drone[0] * X.droneHz, 1.6, E.drone[1] + X.droneDb, fs);
      this.raspBp.set('bp', E.rasp[0] + rpm0 * E.rasp[1], 0.6, 0, fs);
      this.rumbleBp.set('bp', E.rumble[0] + rpm0 * E.rumble[1], 0.45, 0, fs);
      this.intakeBp.set('bp', E.intake[0] + rpm0 * E.intake[1], 1.4, 0, fs);
    }

    const E = this.E, ncyl = E.firing.length;
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
      const lope = X.lope * nearIdle;
      rpm *= 1 + nearIdle * (1 - X.lope) * (E.lope[0] * Math.sin(TAU * 1.13 * this.t) + E.lope[1] * Math.sin(TAU * 0.41 * this.t));
      if (st > 0) rpm *= 1 - 0.35 * st * Math.max(0, Math.cos(TAU * this.phase * ncyl));
      rpm = Math.max(0, rpm);
      this.phase += rpm / 120 / fs;          // 2 revolutions per cycle
      if (this.phase >= 1) this.phase -= 1;
      this.t += 1 / fs;

      // combustion strength
      const overrun = thr < 0.06 && rpm > idle * 1.35; // fuel cut
      const fuel = overrun ? 0 : 1;
      // idle firings hit harder with a free-flowing exhaust (louder, punchier idle)
      const load = ign * fuel * (0.32 * (1 + (X.idleHit - 1) * (1 - thr)) + 0.68 * thr);
      const pump = E.pump;                     // air being pushed out with no combustion
      const width = E.width[0] - E.width[1] * thr; // crank degrees; harder hit under load

      let a = 0, b = 0, env = 0, inEnv = 0;
      for (let k = 0; k < ncyl; k++) {
        // new cycle for this cylinder is detected from crank position alone; the random
        // timing scatter only moves where its pulse lands (otherwise one cycle can trigger twice)
        let xc = this.phase * 720 - E.angles[k] - E.cylTiming[k];
        xc = ((xc % 720) + 720) % 720;
        if (xc < this.lastX[k]) { // this cylinder's exhaust valve just opened: new cycle for it
          // no two combustions are the same; this scatter is what turns buzz into rumble
          // a cammed idle is choppy but regular: less random scatter, more pattern
          const j = E.jitter + E.idleJitter * nearIdle * (1 - 0.6 * lope) + 0.03 * (1 - ign);
          this.jit[k] = Math.max(0.3, 1 + j * randn());
          this.tjit[k] = (3.5 + 1.5 * lope) * randn();
          // choppy idle: a pattern over two engine cycles (a stumble, then a hard hit),
          // and now and then an extra weak firing so it never sounds like a loop
          if (lope > 0.001) {
            if (k === 0) this.cycleN++;
            const step = (this.cycleN & 1) * ncyl + k;
            this.jit[k] *= Math.max(0.15, 1 + lope * (E.chop[step] - 1));
            if (Math.random() < 0.04 * lope) this.jit[k] *= 0.4;
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
        }
        this.lastX[k] = xc;
        let x = xc - this.tjit[k];
        if (x < 0) x += 720;
        const p = this.pulse(x, width);
        const amp = E.cylGain[k] * this.jit[k] * (load + pump + this.pop[k] * 0.9);
        const v = p * amp;
        if (E.bank[k] === 0) a += v; else b += v;
        env += v;
        // intake valve opens ~360 deg later on the same cylinder
        const xi = x - 360;
        if (xi > 0 && xi < 180) inEnv += Math.sin(Math.PI * xi / 180);
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
      const refl = E.pipeRefl - X.refl;
      let pipeOut;
      if (!E.dual) {
        // one collector into one pipe (~3 m): inverted, lossy reflection from the open end
        const coll = hA + hB + this.popLp * 1.4;
        const back = this.pipe.read(fs * (E.pipe[0] / 343) * 2);
        this.pipeLp += (back - this.pipeLp) * 0.35;
        pipeOut = coll - refl * this.pipeLp;
        this.pipe.write(pipeOut);
      } else {
        // true duals: each bank down its own pipe, so its uneven 90/180/270 beat survives
        const inA = hA + this.popLp * 0.7, inB = hB + this.popLp * 0.7;
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

      // rumble: gas turbulence in the pipe, fills the gaps between the harmonics
      y += this.rumbleLp.run(this.rumbleBp.run(randn() * env)) * (0.3 * (1 - 0.75 * lope) * E.idleNoise + 1.5 * thr) * X.rumble * E.rumble[2];

      // rasp: turbulence that rides on each pulse, grows with rpm and load
      // at idle the loud pipes' rasp stays low (it reads as hiss); it opens up with load
      const raspAmt = (0.05 * (1 - 0.7 * lope) * E.idleNoise + 0.22 * thr) * Math.min(1.3, rpm / 4500) * X.rasp * E.rasp[2];
      // the crack on top of an afterfire: short (popEnv^3 decays fast), band-limited by the
      // rasp filter, and quieter through the stock muffler
      const crack = this.popEnv > 0.02 ? randn() * this.popEnv ** 3 * X.crack : 0;
      y += this.raspHp.run(this.raspBp.run(randn() * env * raspAmt + crack * 0.9));

      // intake roar (heard more than you'd think with the throttle open)
      y += this.intakeBp.run(randn() * inEnv) * E.intake[2] * thr * (0.3 + rpm / 6500);

      // valve-train tick
      // sizzle: a little crackle on the loudest pulses of a loud exhaust (kept low and
      // band-limited: any more and the idle sounds like static)
      if (X.sizzle > 0.01) y += this.sizzleBp.run(randn() * env * env * env) * 0.035 * X.sizzle * E.sizzle * (1 + 2 * thr);

      this.tickEnv *= 0.9;
      y += this.tickHp.run(randn() * this.tickEnv) * 0.012 * Math.min(1, rpm / 3000);


      // starter motor whine (pinion ~ 11x crank speed) with gear grind
      if (st > 0.001) {
        this.starterPh += (rpm / 60) * E.starterRatio / fs;
        this.starterPh -= Math.floor(this.starterPh);
        const saw = 2 * this.starterPh - 1;
        y += this.starterBp.run(saw + 0.4 * randn()) * 0.35 * st;
      }

      // low cut follows the exhaust: louder pipes trade sub mud for punch
      if (Math.abs(X.sub - this.subHz) > 0.5) { this.subHz = X.sub; this.dcHp.set('hp', X.sub, 0.7, 0, fs); }
      y = this.dcHp.run(y);
      let o = Math.tanh(y * 0.38 * E.level * X.level) * 1.35; // gentle: mostly linear, only peaks round off
      // soft knee above 0.9 so loud engines never clip the output
      if (o > 0.9) o = 0.9 + 0.1 * Math.tanh((o - 0.9) / 0.1);
      else if (o < -0.9) o = -0.9 - 0.1 * Math.tanh((-o - 0.9) / 0.1);
      out[i] = o;

      this.cyc[this.cycN] = o;
      if (this.cycN < this.cyc.length - 1) this.cycN++;
      this.sincePost++;
      if (this.phase < rpm / 120 / fs) { // cycle wrapped (cylinder 1 exhaust opened)
        if (this.sincePost > fs / 12 && this.cycN > 16) {
          const pts = 360, s = new Float32Array(pts);
          for (let q = 0; q < pts; q++) s[q] = this.cyc[Math.floor(q / pts * this.cycN)];
          if (this.onCycle) this.onCycle(s);
          this.sincePost = 0;
        }
        this.cycN = 0;
      }
    }
  }
}
