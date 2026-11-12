// AudioWorklet that synthesizes a BMW M20 2.5 straight-six (E30 325i) from first principles.
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
// pumped air: weaker and duller, with the odd pop.

const FIRING = [1, 5, 3, 6, 2, 4];
const TAU = Math.PI * 2;

class Biquad {
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

class Delay {
  constructor(n) { this.buf = new Float32Array(n); this.i = 0; }
  write(x) { this.buf[this.i] = x; this.i = (this.i + 1) % this.buf.length; }
  read(d) { // d samples ago, fractional
    const n = this.buf.length, p = this.i - 1 - d, i0 = Math.floor(p), fr = p - i0;
    const a = this.buf[((i0 % n) + n) % n], b = this.buf[(((i0 + 1) % n) + n) % n];
    return a + (b - a) * fr;
  }
}

function randn() { // cheap gaussian-ish
  return (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
}

class M20Processor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 800, minValue: 0, maxValue: 9000 },
      { name: 'throttle', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'ignition', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'starter', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'exhaust', defaultValue: 0, minValue: 0, maxValue: 1 }, // 0 stock, 1 sport
      { name: 'idleRpm', defaultValue: 800, minValue: 400, maxValue: 1500 },
    ];
  }

  constructor() {
    super();
    const fs = sampleRate;
    this.fs = fs;
    this.phase = 0;            // engine cycle, 0..1 = 720 crank degrees
    this.t = 0;
    // fixed per-cylinder character (in firing order): a real engine is never perfectly even
    this.cylGain = [1.0, 0.9, 1.07, 0.95, 1.04, 0.88];
    this.cylTiming = [0, 1.5, -1, 2, -0.5, 1]; // crank degrees
    this.jit = new Float32Array(6).fill(1);
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
    this.intakeBp = new Biquad();
    this.tickHp = new Biquad().set('hp', 3500, 0.7, 0, fs);
    this.starterBp = new Biquad().set('bp', 1100, 0.9, 0, fs);
    this.starterPh = 0;
    this.tickEnv = 0;
    this.popEnv = 0;
    this.coef = 0;
    // scope: one engine cycle of output, posted ~12x/s
    this.cyc = new Float32Array(Math.ceil(fs * 0.4)); this.cycN = 0; this.sincePost = 0;
  }

  pulse(xDeg, width) {
    // exhaust blowdown: very fast rise, exponential-ish decay
    if (xDeg <= 0 || xDeg > width * 9) return 0;
    const u = xDeg / width;
    return u * Math.exp(1 - u);
  }

  process(_in, outputs, P) {
    const out = outputs[0][0];
    const fs = this.fs, N = out.length;
    const g = (name, i) => { const a = P[name]; return a.length > 1 ? a[i] : a[0]; };

    // block-rate coefficient updates
    const thr0 = g('throttle', 0), rpm0 = g('rpm', 0), exh = g('exhaust', 0);
    if (this.coef++ % 4 === 0) {
      const open = 1 + exh * 0.9;
      this.muffLp.set('lp', (650 + 1400 * thr0 + rpm0 * 0.18) * open, 0.75, 0, fs);
      this.muffLp2.set('lp', (2600 + 2500 * thr0) * open, 0.6, 0, fs);
      this.body.set('pk', 115, 1.1, 4 + exh * 2, fs);
      this.drone.set('pk', 240 + exh * 40, 2.2, 2.5 + exh * 3, fs);
      this.raspBp.set('bp', 1600 + rpm0 * 0.25, 0.7, 0, fs);
      this.intakeBp.set('bp', 420 + rpm0 * 0.08, 1.4, 0, fs);
    }

    for (let i = 0; i < N; i++) {
      const rpmIn = g('rpm', i), thrIn = g('throttle', i), ign = g('ignition', i);
      const st = g('starter', i), idle = g('idleRpm', i);
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
      const width = 26 - 8 * thr;              // crank degrees; harder hit under load

      let a = 0, b = 0, env = 0, inEnv = 0;
      for (let k = 0; k < 6; k++) {
        let x = (this.phase - k / 6) * 720 - this.cylTiming[k];
        x = ((x % 720) + 720) % 720;
        if (x < this.lastX[k]) { // this cylinder's exhaust valve just opened: new cycle for it
          const j = 0.025 + 0.09 * nearIdle + 0.03 * (1 - ign);
          this.jit[k] = Math.max(0.5, 1 + j * randn());
          // overrun pop: unburnt mixture lighting in the hot pipe
          this.pop[k] = overrun && ign > 0.5 && rpm > 2600 && Math.random() < 0.012 * (rpm / 4000) ? 1 : 0;
          if (this.pop[k]) this.popEnv = 1;
          this.tickEnv = 1;
        }
        this.lastX[k] = x;
        const p = this.pulse(x, width);
        const amp = this.cylGain[k] * this.jit[k] * (load + pump + this.pop[k] * 1.6);
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
      const coll = hA + hB;

      // exhaust pipe ~3.1 m: inverted, lossy reflection from the open end
      const dP = fs * (3.1 / 343) * 2;
      const back = this.pipe.read(dP);
      this.pipeLp += (back - this.pipeLp) * 0.35;
      const pipeOut = coll - (0.5 - exh * 0.1) * this.pipeLp;
      this.pipe.write(pipeOut);

      let y = this.muffLp2.run(this.muffLp.run(pipeOut));
      y = this.drone.run(this.body.run(y));

      // rasp: turbulence that rides on each pulse, grows with rpm and load
      const raspAmt = (0.10 + 0.5 * thr) * Math.min(1.4, rpm / 4500) * (0.7 + exh * 0.8);
      y += this.raspHp.run(this.raspBp.run(randn() * env)) * raspAmt;

      // intake roar (heard more than you'd think with the throttle open)
      y += this.intakeBp.run(randn() * inEnv) * 0.10 * thr * (0.3 + rpm / 6500);

      // valve-train tick
      this.tickEnv *= 0.9;
      y += this.tickHp.run(randn() * this.tickEnv) * 0.012 * Math.min(1, rpm / 3000);

      // overrun pop crack
      this.popEnv *= 0.993;
      y += this.popEnv > 0.01 ? randn() * this.popEnv * 0.5 : 0;

      // starter motor whine (pinion ~ 11x crank speed) with gear grind
      if (st > 0.001) {
        this.starterPh += (rpm / 60) * 11 / fs;
        this.starterPh -= Math.floor(this.starterPh);
        const saw = 2 * this.starterPh - 1;
        y += this.starterBp.run(saw + 0.4 * randn()) * 0.35 * st;
      }

      y = this.dcHp.run(y);
      const o = Math.tanh(y * 0.75) * 0.9;
      out[i] = o;

      this.cyc[this.cycN] = o;
      if (this.cycN < this.cyc.length - 1) this.cycN++;
      this.sincePost++;
      if (this.phase < rpm / 120 / fs) { // cycle wrapped (cylinder 1 exhaust opened)
        if (this.sincePost > fs / 12 && this.cycN > 16) {
          const pts = 360, s = new Float32Array(pts);
          for (let q = 0; q < pts; q++) s[q] = this.cyc[Math.floor(q / pts * this.cycN)];
          this.port.postMessage(s, [s.buffer]);
          this.sincePost = 0;
        }
        this.cycN = 0;
      }
    }
    return true;
  }
}

registerProcessor('m20-engine', M20Processor);
