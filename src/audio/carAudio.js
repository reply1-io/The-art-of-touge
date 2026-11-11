// Synthesised car sound (Web Audio, no files).
//
// Engine: a four-cylinder fires twice per crank revolution, so the main pitch is rpm / 30 Hz. The
// tone is built from a custom harmonic waveform (firing order pulses), a half-order "lumpy" layer,
// intake noise tuned to the revs, and a load-dependent drive stage, then a low-pass that opens with
// the throttle. On top: limiter bounce, overrun pops on lift-off and downshifts, stall sputter, the
// starter motor, tyre squeal, gear grind and wind.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function makeNoise(ctx, seconds = 2) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// Exhaust pulse train: strong low harmonics, a dip, then a bright edge, like a recorded inline-four.
function exhaustWave(ctx) {
  const n = 24;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  const amps = [0, 1, 0.75, 0.42, 0.5, 0.28, 0.3, 0.16, 0.2, 0.1, 0.12, 0.07, 0.08, 0.05, 0.05, 0.04];
  for (let i = 1; i < n; i++) imag[i] = (amps[i] ?? 0.03) * (i % 2 ? 1 : -1);
  return ctx.createPeriodicWave(real, imag);
}

function driveCurve(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

export class CarAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.popTimer = 0;
    this.prevRpm = 0;
    this.prevThrottle = 0;
    this.prevGear = 0;
    this.prevRunning = true;
    this.limiterWas = false;
  }

  // Must be called from a tap (browsers only allow sound after the player interacts).
  start() {
    // iPhone: without this, Web Audio is silenced whenever the ring/silent switch is on silent.
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {
      // Older Safari: the silent clip below does the same job.
    }
    this.#unlockWithSilentClip();
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    ctx.resume?.();
    // Some browsers start (or re-suspend) the context until a touch: wake it on every touch.
    const wake = () => {
      if (ctx.state !== 'running' && !this.paused) ctx.resume?.();
    };
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('touchend', wake, { passive: true });
    this.noise = makeNoise(ctx);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp).connect(ctx.destination);

    // ---- Engine ----
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 1.2;
    this.drive = ctx.createWaveShaper();
    this.drive.curve = driveCurve(2.2);
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.drive.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    // Body resonance (a gentle peak that follows the revs, like the exhaust note through the cabin).
    this.resonance = ctx.createBiquadFilter();
    this.resonance.type = 'peaking';
    this.resonance.Q.value = 3;
    this.resonance.gain.value = 6;
    this.engineFilter.disconnect();
    this.engineFilter.connect(this.resonance).connect(this.engineGain);

    const wave = exhaustWave(ctx);
    this.fire = ctx.createOscillator();
    this.fire.setPeriodicWave(wave);
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0.55;
    this.fire.connect(this.fireGain).connect(this.drive);
    // Half-order layer: uneven firing gives a four-pot its throb at idle.
    this.lump = ctx.createOscillator();
    this.lump.type = 'triangle';
    this.lumpGain = ctx.createGain();
    this.lumpGain.gain.value = 0.25;
    this.lump.connect(this.lumpGain).connect(this.drive);
    // Slight detuned twin for a fuller note.
    this.fire2 = ctx.createOscillator();
    this.fire2.setPeriodicWave(wave);
    this.fire2Gain = ctx.createGain();
    this.fire2Gain.gain.value = 0.22;
    this.fire2.connect(this.fire2Gain).connect(this.drive);
    for (const o of [this.fire, this.lump, this.fire2]) o.start();

    // Intake / induction roar: noise band-passed around the upper harmonics.
    const intake = ctx.createBufferSource();
    intake.buffer = this.noise;
    intake.loop = true;
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.Q.value = 1.4;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    intake.connect(this.intakeFilter).connect(this.intakeGain).connect(this.master);
    intake.start();

    // ---- Tyres, wind, grind ----
    const squeal = ctx.createBufferSource();
    squeal.buffer = this.noise;
    squeal.loop = true;
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.value = 1100;
    this.squealFilter.Q.value = 9;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    squeal.connect(this.squealFilter).connect(this.squealGain).connect(this.master);
    squeal.start();

    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    const grind = ctx.createBufferSource();
    grind.buffer = this.noise;
    grind.loop = true;
    const grindFilter = ctx.createBiquadFilter();
    grindFilter.type = 'bandpass';
    grindFilter.frequency.value = 2400;
    grindFilter.Q.value = 2;
    this.grindGain = ctx.createGain();
    this.grindGain.gain.value = 0;
    const grindMod = ctx.createOscillator();
    grindMod.type = 'square';
    grindMod.frequency.value = 37;
    const grindModGain = ctx.createGain();
    grindModGain.gain.value = 0.5;
    grindMod.connect(grindModGain).connect(this.grindGain.gain);
    grind.connect(grindFilter).connect(this.grindGain).connect(this.master);
    grind.start();
    grindMod.start();
  }

  // Playing a short silent media clip inside the tap moves iOS Safari onto the media audio channel,
  // which keeps playing when the phone is switched to silent.
  #unlockWithSilentClip() {
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      const rate = 8000;
      const samples = 800;
      const buf = new ArrayBuffer(44 + samples * 2);
      const v = new DataView(buf);
      const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      str(0, 'RIFF');
      v.setUint32(4, 36 + samples * 2, true);
      str(8, 'WAVEfmt ');
      v.setUint32(16, 16, true);
      v.setUint16(20, 1, true);
      v.setUint16(22, 1, true);
      v.setUint32(24, rate, true);
      v.setUint32(28, rate * 2, true);
      v.setUint16(32, 2, true);
      v.setUint16(34, 16, true);
      str(36, 'data');
      v.setUint32(40, samples * 2, true);
      const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
      const el = new Audio(url);
      el.setAttribute('playsinline', '');
      el.loop = true;
      el.volume = 0.01;
      el.play().catch(() => {});
      this.silentClip = el;
    } catch {
      // Not critical: Web Audio still plays when the phone is not on silent.
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  suspend() {
    this.paused = true;
    this.ctx?.suspend?.();
  }

  resume() {
    this.paused = false;
    this.ctx?.resume?.();
  }

  // A single exhaust pop: a short, low noise burst with a sharp attack.
  #pop(when, strength = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 180 + Math.random() * 380;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.9 * strength, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.07 + Math.random() * 0.05);
    src.connect(f).connect(g).connect(this.master);
    src.start(when, Math.random());
    src.stop(when + 0.15);
  }

  #crackle(count, spread) {
    const t = this.ctx.currentTime;
    for (let i = 0; i < count; i++) this.#pop(t + Math.random() * spread, 0.5 + Math.random() * 0.6);
  }

  // Engine dies: a few uneven chuffs that slow down.
  #sputter() {
    const t = this.ctx.currentTime;
    let at = t;
    for (let i = 0; i < 6; i++) {
      at += 0.06 + i * 0.05 + Math.random() * 0.04;
      this.#pop(at, 0.8 - i * 0.1);
    }
  }

  // Starter motor whirr before the engine catches.
  #starter() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t);
    o.frequency.linearRampToValueAtTime(140, t + 0.5);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.18;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.6);
    lfo.connect(lfoGain).connect(g.gain);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.65);
    lfo.stop(t + 0.65);
  }

  // vehicle: the simulation; called once per rendered frame.
  update(vehicle, dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const e = vehicle.engine;
    const tr = vehicle.trans;
    const rpm = Math.max(0, e.rpm);
    const running = e.running;
    const load = running ? e.throttleApplied : 0;

    // Engine note.
    const f = Math.max(rpm, 1) / 30;
    this.fire.frequency.setTargetAtTime(f, t, 0.012);
    this.fire2.frequency.setTargetAtTime(f * 1.006, t, 0.012);
    this.lump.frequency.setTargetAtTime(f / 2, t, 0.012);
    this.resonance.frequency.setTargetAtTime(clamp(f * 2.2, 120, 1800), t, 0.03);
    this.engineFilter.frequency.setTargetAtTime(380 + load * 3200 + rpm * 0.35, t, 0.03);
    this.lumpGain.gain.setTargetAtTime(0.32 - clamp(rpm / 6000, 0, 1) * 0.22, t, 0.05);
    const turning = clamp(rpm / 500, 0, 1);
    let level = running ? 0.16 + load * 0.3 + (rpm / 7000) * 0.14 : 0.25 * turning * clamp(rpm / 1500, 0, 1);
    // Rev limiter: the fuel cut chops the note.
    if (e.limiterCut) level *= 0.35;
    this.engineGain.gain.setTargetAtTime(level, t, e.limiterCut !== this.limiterWas ? 0.004 : 0.02);
    this.limiterWas = e.limiterCut;
    this.intakeFilter.frequency.setTargetAtTime(f * 4, t, 0.03);
    this.intakeGain.gain.setTargetAtTime(running ? load * 0.12 * clamp(rpm / 6000, 0.2, 1) : 0, t, 0.04);

    // Events: stall, start, lift-off pops, downshift blips.
    if (this.prevRunning && !running) this.#sputter();
    if (!this.prevRunning && running) this.#starter();
    this.popTimer -= dt;
    const lifted = this.prevThrottle > 0.6 && vehicle.throttlePedal < 0.2;
    if (running && lifted && rpm > 3800 && this.popTimer <= 0) {
      this.#crackle(3 + Math.floor(Math.random() * 4), 0.5);
      this.popTimer = 0.6;
    }
    const downshift = tr.gear > 0 && this.prevGear > tr.gear && rpm > this.prevRpm + 400;
    if (running && downshift && this.popTimer <= 0) {
      this.#crackle(2 + Math.floor(Math.random() * 3), 0.35);
      this.popTimer = 0.4;
    }
    if (running && e.limiterCut && Math.random() < dt * 6) this.#pop(t, 0.35);
    this.prevRunning = running;
    this.prevThrottle = vehicle.throttlePedal;
    this.prevGear = tr.gear;
    this.prevRpm = rpm;

    // Tyres: squeal from sliding (lateral) and wheelspin or lock-up (longitudinal).
    let slip = 0;
    for (const w of vehicle.wheels) {
      if (!w.grounded) continue;
      const lat = Math.max(0, Math.abs(Math.tan(w.slipAngle)) - 0.1);
      const lon = Math.max(0, Math.abs(w.slipRatio) - 0.15);
      slip += Math.min(1, (lat * 2.2 + lon * 1.2) * (w.load / 2800));
    }
    const speed = vehicle.speed;
    const squeal = speed > 1.5 ? clamp(slip / 2, 0, 1) : 0;
    this.squealGain.gain.setTargetAtTime(squeal * 0.3, t, 0.05);
    this.squealFilter.frequency.setTargetAtTime(950 + squeal * 450 + Math.sin(t * 17) * 50, t, 0.05);

    this.windGain.gain.setTargetAtTime(clamp((speed / 50) ** 2, 0, 1) * 0.22, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(300 + speed * 18, t, 0.2);
    this.grindGain.gain.setTargetAtTime(tr.grindTimer > 0 ? 0.35 : 0, t, 0.01);
  }
}
