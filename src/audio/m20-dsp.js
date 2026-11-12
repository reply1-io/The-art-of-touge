// DSP core that synthesizes a BMW M20 2.5 straight-six (E30 325i) from first principles.
// Runs inside an AudioWorklet when the browser allows it, otherwise on the main thread
// (see M20EngineSound.js). It has no imports so it can be shipped into a worklet as text.
//
// Signal path, per sample:
//   crank angle -> 6 exhaust pressure pulses (firing order 1-5-3-6-2-4, one every 120 deg)
//   -> two 3-into-1 manifolds (cyl 1-3 front, 4-6 rear; banks alternate on every firing)
//   -> collector -> exhaust pipe (delay line with inverted reflection = pipe resonances)
//   -> muffler (lowpass + body resonance) + turbulent "rasp" noise riding on each pulse
//   + intake roar (throttle) + valve-train tick + starter motor when cranking
//   -> soft clip.
//
// Per-cylinder strength differences and cycle-to-cycle jitter put energy at the
// half orders (cam rate), which is what makes it sound like an engine, not a buzzer.
// Motronic cuts fuel on overrun, so off-throttle above idle the pulses are just
// pumped air: weaker and duller. A proper lift-off from high revs can give a
// couple of pops (more with the sport exhaust); limiter and shift cuts never do.

export const FIRING = [1, 5, 3, 6, 2, 4];
export const TAU = Math.PI * 2;
export const IDLE_RPM = 800;
export const CRANK_SECONDS = 2.6;

/** rpm during the start-up: starter turning it over, catch, flare, settle. t = seconds since key turned. */
export function crankRpm(t) {
  if (t < 0.15) return 260 * (t / 0.15);
  if (t < 1.0) return 250;
  if (t < 1.25) return 250 + (1450 - 250) * ((t - 1.0) / 0.25);
  return IDLE_RPM + (1450 - IDLE_RPM) * Math.exp(-(t - 1.25) / 0.45);
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
    this.target = { rpm: IDLE_RPM, throttle: 0, exhaust: 0, ignition: 1, starter: 0, idleRpm: IDLE_RPM };
    this.c = { rpm: 0, throttle: 0, ignition: 0, starter: 0, exhaust: 0, idleRpm: IDLE_RPM };
    this.onCycle = null;
    this.fs = fs;
    this.phase = 0;            // engine cycle, 0..1 = 720 crank degrees
    this.t = 0;
    // fixed per-cylinder character (in firing order): a real engine is never perfectly even
    this.cylGain = [1.0, 0.9, 1.07, 0.95, 1.04, 0.88];
    this.cylTiming = [0, 1.5, -1, 2, -0.5, 1]; // crank degrees
    this.jit = new Float32Array(6).fill(1);
    this.tjit = new Float32Array(6); // per-cycle timing scatter, crank degrees
    this.pop = new Float32Array(6);
    this.lastX = new Float32Array(6).fill(1);
    this.hdrA = new Delay(512); this.hdrB = new Delay(512);
    this.pipe = new Delay(4096);
    this.pipeLp = 0;
    this.thrS = 0; this.rpmS = 800;
    this.muffLp = new Biquad(); this.muffLp2 = new Biquad();
    this.body = new Biquad(); this.drone = new Biquad();
    this.dcHp = new Biquad().set('hp', 28, 0.7, 0, fs);
    this.raspBp = new Biquad(); this.raspHp = new Biquad().set('hp', 900, 0.7, 0, fs);
    this.rumbleBp = new Biquad(); this.rumbleLp = new Biquad().set('lp', 1200, 0.5, 0, fs);
    this.intakeBp = new Biquad();
    this.tickHp = new Biquad().set('hp', 3500, 0.7, 0, fs);
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

  /** Values from the game: { rpm, throttle (0..1), exhaust (0 stock .. 1 sport), idleRpm },
   *  and in 'direct' mode also { ignition (0/1), starter (0/1) }. */
  set(v) { Object.assign(this.target, v); }

  /** 'crank' (key start), 'start' (straight to idle), 'stop' (key off),
   *  'direct' (the game's engine model drives rpm, ignition and starter itself). */
  command(cmd) {
    this.modeT0 = this.clock;
    if (cmd === 'crank') { this.mode = 'crank'; this.target.rpm = IDLE_RPM; this.target.throttle = 0; }
    else if (cmd === 'start') { this.mode = 'run'; this.target.rpm = IDLE_RPM; this.rpmS = IDLE_RPM; }
    else if (cmd === 'stop') { this.mode = 'stopping'; this.stopFrom = this.rpmS; }
    else if (cmd === 'direct') { this.mode = 'direct'; this.rpmS = this.target.rpm; }
  }

  _control(n) {
    const c = this.c, t = this.target, dt = this.clock - this.modeT0;
    // lift-off tracking for afterfire pops
    if (c.throttle < 0.06) {
      if (this.offT === 0 && this.popArmed && this.rpmS > 3500) {
        this.popBudget = Math.floor(Math.random() * (1.6 + 2.5 * c.exhaust)); // stock 0-1, sport 0-3
      }
      this.popArmed = false;
      this.offT += n / this.fs;
    } else {
      this.offT = 0;
      if (c.throttle > 0.6 && this.rpmS > 3500) this.popArmed = true;
    }
    c.exhaust += (t.exhaust - c.exhaust) * 0.05;
    c.idleRpm = t.idleRpm;
    if (this.mode === 'crank') {
      c.rpm = crankRpm(dt); c.throttle = 0;
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
    const thr0 = C.throttle, rpm0 = C.rpm, exh = C.exhaust;
    if (this.coef++ % 4 === 0) {
      const open = 1 + exh * 0.9;
      this.muffLp.set('lp', (420 + 700 * thr0 + rpm0 * 0.09) * open, 0.6, 0, fs);
      this.muffLp2.set('lp', (1500 + 1200 * thr0) * open, 0.5, 0, fs);
      this.body.set('pk', 115, 1.1, 4 + exh * 2, fs);
      this.drone.set('pk', 240 + exh * 40, 1.6, 1 + exh * 2.5, fs);
      this.raspBp.set('bp', 1200 + rpm0 * 0.15, 0.6, 0, fs);
      this.rumbleBp.set('bp', 260 + rpm0 * 0.06, 0.45, 0, fs);
      this.intakeBp.set('bp', 420 + rpm0 * 0.08, 1.4, 0, fs);
    }

    for (let i = 0; i < N; i++) {
      const rpmIn = C.rpm, thrIn = C.throttle, ign = C.ignition;
      const st = C.starter, idle = C.idleRpm;
      this.thrS += (thrIn - this.thrS) * 0.0015;
      this.rpmS += (rpmIn - this.rpmS) * 0.004;
      const thr = this.thrS;
      let rpm = this.rpmS;

      // idle lope + compression drag while cranking
      const nearIdle = Math.max(0, 1 - Math.abs(rpm - idle) / 400) * (1 - thr);
      rpm *= 1 + nearIdle * (0.007 * Math.sin(TAU * 1.13 * this.t) + 0.004 * Math.sin(TAU * 0.41 * this.t));
      if (st > 0) rpm *= 1 - 0.35 * st * Math.max(0, Math.cos(TAU * this.phase * 6));
      rpm = Math.max(0, rpm);
      this.phase += rpm / 120 / fs;          // 2 revolutions per cycle
      if (this.phase >= 1) this.phase -= 1;
      this.t += 1 / fs;

      // combustion strength
      const overrun = thr < 0.06 && rpm > idle * 1.35; // fuel cut
      const fuel = overrun ? 0 : 1;
      const load = ign * fuel * (0.32 + 0.68 * thr);
      const pump = 0.11;                       // air being pushed out with no combustion
      const width = 36 - 10 * thr;             // crank degrees; harder hit under load

      let a = 0, b = 0, env = 0, inEnv = 0;
      for (let k = 0; k < 6; k++) {
        let x = (this.phase - k / 6) * 720 - this.cylTiming[k] - this.tjit[k];
        x = ((x % 720) + 720) % 720;
        if (x < this.lastX[k]) { // this cylinder's exhaust valve just opened: new cycle for it
          // no two combustions are the same; this scatter is what turns buzz into rumble
          const j = 0.07 + 0.08 * nearIdle + 0.03 * (1 - ign);
          this.jit[k] = Math.max(0.5, 1 + j * randn());
          this.tjit[k] = 3.5 * randn();
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
        this.lastX[k] = x;
        const p = this.pulse(x, width);
        const amp = this.cylGain[k] * this.jit[k] * (load + pump + this.pop[k] * 0.9);
        const v = p * amp;
        if (FIRING[k] <= 3) a += v; else b += v;
        env += v;
        // intake valve opens ~360 deg later on the same cylinder
        const xi = x - 360;
        if (xi > 0 && xi < 180) inEnv += Math.sin(Math.PI * xi / 180);
      }

      // manifolds: slightly different runner lengths, partial reflection at the collector
      const dA = fs * 0.0016, dB = fs * 0.0023;
      const hA = this.hdrA.read(dA), hB = this.hdrB.read(dB);
      this.hdrA.write(a - 0.32 * hA);
      this.hdrB.write(b - 0.32 * hB);
      // afterfire kick: a short low-passed burst entering the pipe, so the
      // muffler shapes it into a thud-crack rather than a digital click
      this.popEnv *= 0.9965;
      this.popLp += ((this.popEnv > 0.005 ? randn() * this.popEnv : 0) - this.popLp) * 0.25;
      const coll = hA + hB + this.popLp * 1.4;

      // exhaust pipe ~3.1 m: inverted, lossy reflection from the open end
      const dP = fs * (3.1 / 343) * 2;
      const back = this.pipe.read(dP);
      this.pipeLp += (back - this.pipeLp) * 0.35;
      const pipeOut = coll - (0.5 - exh * 0.1) * this.pipeLp;
      this.pipe.write(pipeOut);

      let y = this.muffLp2.run(this.muffLp.run(pipeOut));
      y = this.drone.run(this.body.run(y));

      // rumble: gas turbulence in the pipe, fills the gaps between the harmonics
      y += this.rumbleLp.run(this.rumbleBp.run(randn() * env)) * (0.3 + 1.5 * thr) * (0.8 + exh * 0.4);

      // rasp: turbulence that rides on each pulse, grows with rpm and load
      const raspAmt = (0.05 + 0.22 * thr) * Math.min(1.3, rpm / 4500) * (0.7 + exh * 0.8);
      // the crack on top of an afterfire: short (popEnv^3 decays fast), band-limited by the
      // rasp filter, and quieter through the stock muffler
      const crack = this.popEnv > 0.02 ? randn() * this.popEnv ** 3 * (0.35 + 0.65 * exh) : 0;
      y += this.raspHp.run(this.raspBp.run(randn() * env * raspAmt + crack * 0.9));

      // intake roar (heard more than you'd think with the throttle open)
      y += this.intakeBp.run(randn() * inEnv) * 0.10 * thr * (0.3 + rpm / 6500);

      // valve-train tick
      this.tickEnv *= 0.9;
      y += this.tickHp.run(randn() * this.tickEnv) * 0.012 * Math.min(1, rpm / 3000);


      // starter motor whine (pinion ~ 11x crank speed) with gear grind
      if (st > 0.001) {
        this.starterPh += (rpm / 60) * 11 / fs;
        this.starterPh -= Math.floor(this.starterPh);
        const saw = 2 * this.starterPh - 1;
        y += this.starterBp.run(saw + 0.4 * randn()) * 0.35 * st;
      }

      y = this.dcHp.run(y);
      const o = Math.tanh(y * 0.38) * 1.35; // gentle: mostly linear, only peaks round off
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
