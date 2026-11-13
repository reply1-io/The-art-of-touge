// Synthesised car sound (Web Audio, no files).
//
// The engine note itself comes from the M20 straight-six synth (M20EngineSound.js); the simple
// oscillator engine described below is the fallback while it loads or if the browser blocks it.
//
// Engine: a straight six fires three times per crank revolution, so the main pitch is rpm / 20 Hz. The
// tone is built from a custom harmonic waveform (firing order pulses), a half-order "lumpy" layer,
// intake noise tuned to the revs, and a load-dependent drive stage, then a low-pass that opens with
// the throttle. On top: limiter bounce, overrun pops on lift-off and downshifts, stall sputter, the
// starter motor, tyre squeal, gear grind and wind.

import { M20EngineSound } from './M20EngineSound.js';
import m20DspSource from './m20-dsp.js?raw';
import { CAR } from '../config.js';

// Which synth engine profile each car uses (see ENGINES in m20-dsp.js).
const ENGINE_SOUND = { e30: 'm20', rx7: 'rotary13b' };

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
  // Weighted to the low harmonics for a deep, throaty note.
  const amps = [0, 1, 0.6, 0.3, 0.22, 0.1, 0.08, 0.04, 0.03, 0.02, 0.015, 0.01];
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

    // ---- M20 straight-six (procedural, see m20-dsp.js) ----
    // Loads in the background; until it is ready, or if the browser refuses it, the simple
    // oscillator engine below plays instead.
    this.m20Cabin = ctx.createBiquadFilter(); // the bulkhead when you drive from the seat
    this.m20Cabin.type = 'lowpass';
    this.m20Cabin.frequency.value = 20000;
    this.m20Bus = ctx.createGain();
    this.m20Bus.gain.value = 0.62;
    this.m20Cabin.connect(this.m20Bus).connect(this.master);
    this.crankT = 0;
    M20EngineSound.create(ctx, { dspSource: m20DspSource, engine: ENGINE_SOUND[CAR.id] || 'm20' })
      .then((m20) => {
        m20.connect(this.m20Cabin);
        const idle = CAR.engine.idleRpm;
        m20.setState({ rpm: this.prevRpm || idle, throttle: 0, ignition: this.prevRunning ? 1 : 0, starter: 0 });
        m20.direct({ idleRpm: idle });
        this.m20 = m20;
      })
      .catch(() => {
        // Keep the oscillator engine.
      });

    // ---- Engine ----
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 1.2;
    this.drive = ctx.createWaveShaper();
    this.drive.curve = driveCurve(1.6);
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.drive.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    // Body resonance (a gentle peak that follows the revs, like the exhaust note through the cabin).
    this.resonance = ctx.createBiquadFilter();
    this.resonance.type = 'peaking';
    this.resonance.Q.value = 3;
    this.resonance.gain.value = 6;
    // Bass from a free-flowing exhaust (street and race): a low shelf after the resonance.
    this.bass = ctx.createBiquadFilter();
    this.bass.type = 'lowshelf';
    this.bass.frequency.value = 150;
    this.bass.gain.value = 0;
    this.engineFilter.disconnect();
    this.engineFilter.connect(this.resonance).connect(this.bass).connect(this.engineGain);

    const wave = exhaustWave(ctx);
    this.fire = ctx.createOscillator();
    this.fire.setPeriodicWave(wave);
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0.55;
    this.fire.connect(this.fireGain).connect(this.drive);
    // Half-order layer: uneven firing gives a four-pot its throb at idle.
    this.lump = ctx.createOscillator();
    this.lump.type = 'sawtooth';
    this.lumpGain = ctx.createGain();
    this.lumpGain.gain.value = 0.5;
    this.lump.connect(this.lumpGain).connect(this.drive);
    // Slight detuned twin for a fuller note.
    this.fire2 = ctx.createOscillator();
    this.fire2.setPeriodicWave(wave);
    this.fire2Gain = ctx.createGain();
    this.fire2Gain.gain.value = 0.15;
    this.fire2.connect(this.fire2Gain).connect(this.drive);
    // Sub-octave rumble for the bigger exhausts.
    this.sub = ctx.createOscillator();
    this.sub.type = 'triangle';
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0;
    this.sub.connect(this.subGain).connect(this.drive);
    for (const o of [this.fire, this.lump, this.fire2, this.sub]) o.start();
    this.setExhaust(this.exhaust || 'stock');

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

    // Induction: the deep, hungry gulp of air through a pod filter or ITB trumpets. Low band of
    // noise, pulsed at the intake rate (half the firing frequency) by an oscillator.
    const ind = ctx.createBufferSource();
    ind.buffer = this.noise;
    ind.loop = true;
    this.indFilter = ctx.createBiquadFilter();
    this.indFilter.type = 'bandpass';
    this.indFilter.Q.value = 0.9;
    this.indFilter.frequency.value = 260;
    const indLow = ctx.createBiquadFilter();
    indLow.type = 'lowpass';
    indLow.frequency.value = 900;
    this.indPulse = ctx.createGain();
    this.indPulse.gain.value = 0.5;
    this.indLfo = ctx.createOscillator();
    this.indLfo.type = 'triangle';
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.5;
    this.indLfo.connect(lfoDepth).connect(this.indPulse.gain);
    this.indGain = ctx.createGain();
    this.indGain.gain.value = 0;
    // A tonal layer under the noise: the trumpets resonate a little.
    this.indTone = ctx.createOscillator();
    this.indTone.type = 'sine';
    const indToneGain = ctx.createGain();
    indToneGain.gain.value = 0.35;
    ind.connect(this.indFilter).connect(indLow).connect(this.indPulse).connect(this.indGain).connect(this.master);
    this.indTone.connect(indToneGain).connect(this.indPulse);
    ind.start();
    this.indLfo.start();
    this.indTone.start();

    // ITB grumble: a deep, soft, uneven rumble from the open trumpets. Low sawtooth at half the
    // firing rate, rounded off by a low-pass, throbbing at the cam rate.
    this.itb = ctx.createOscillator();
    this.itb.type = 'sawtooth';
    this.itb2 = ctx.createOscillator();
    this.itb2.type = 'triangle';
    const itbLow = ctx.createBiquadFilter();
    itbLow.type = 'lowpass';
    itbLow.frequency.value = 170;
    itbLow.Q.value = 0.6;
    this.itbLow = itbLow;
    this.itbThrob = ctx.createGain();
    this.itbThrob.gain.value = 0.6;
    this.itbLfo = ctx.createOscillator();
    this.itbLfo.type = 'sine';
    const itbDepth = ctx.createGain();
    itbDepth.gain.value = 0.4;
    this.itbLfo.connect(itbDepth).connect(this.itbThrob.gain);
    this.itbGain = ctx.createGain();
    this.itbGain.gain.value = 0;
    const itb2Gain = ctx.createGain();
    itb2Gain.gain.value = 0.7;
    this.itb.connect(itbLow);
    this.itb2.connect(itb2Gain).connect(itbLow);
    itbLow.connect(this.itbThrob).connect(this.itbGain).connect(this.master);
    for (const o of [this.itb, this.itb2, this.itbLfo]) o.start();

    // Turbo: a spool whine that rises with boost, and flutter on lift-off.
    this.whistle = ctx.createOscillator();
    this.whistle.type = 'sine';
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    const whistleBand = ctx.createBiquadFilter();
    whistleBand.type = 'bandpass';
    whistleBand.Q.value = 3;
    this.whistleBand = whistleBand;
    this.whistle.connect(whistleBand).connect(this.whistleGain).connect(this.master);
    this.whistle.start();
    // Diesel-style spool: most of the sound is air rushing through the compressor, a breathy
    // whoosh that rises with boost, under a low whine.
    const rush = ctx.createBufferSource();
    rush.buffer = this.noise;
    rush.loop = true;
    this.rushBand = ctx.createBiquadFilter();
    this.rushBand.type = 'bandpass';
    this.rushBand.Q.value = 2.2;
    this.rushGain = ctx.createGain();
    this.rushGain.gain.value = 0;
    rush.connect(this.rushBand).connect(this.rushGain).connect(this.master);
    rush.start();

    // Metal scraping on a rail or the road: harsh, gritty high noise.
    const scr = ctx.createBufferSource();
    scr.buffer = this.noise;
    scr.loop = true;
    const scrF = ctx.createBiquadFilter();
    scrF.type = 'bandpass';
    scrF.frequency.value = 3200;
    scrF.Q.value = 0.8;
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    const scrMod = ctx.createOscillator();
    scrMod.type = 'square';
    scrMod.frequency.value = 23;
    const scrModGain = ctx.createGain();
    scrModGain.gain.value = 0.3;
    // The chatter goes on its own gain stage, ahead of the volume, so silence really is silent
    // (wobbling the volume itself left a quiet 23 Hz tick running all the time).
    const scrChatter = ctx.createGain();
    scrChatter.gain.value = 0.7;
    scrMod.connect(scrModGain).connect(scrChatter.gain);
    scr.connect(scrF).connect(scrChatter).connect(this.scrapeGain).connect(this.master);
    scr.start();
    scrMod.start();

    // Carbon-ceramic brake squeal (big brake kit): a thin, high whistle at low speed under braking.
    this.squeak = ctx.createOscillator();
    this.squeak.type = 'triangle';
    this.squeak2 = ctx.createOscillator();
    this.squeak2.type = 'sine';
    const sqBand = ctx.createBiquadFilter();
    sqBand.type = 'bandpass';
    sqBand.frequency.value = 3600;
    sqBand.Q.value = 4;
    this.squeakGain = ctx.createGain();
    this.squeakGain.gain.value = 0;
    this.squeak.connect(sqBand);
    this.squeak2.connect(sqBand);
    sqBand.connect(this.squeakGain).connect(this.master);
    this.squeak.start();
    this.squeak2.start();

    // Road roar.
    const road = ctx.createBufferSource();
    road.buffer = this.noise;
    road.loop = true;
    this.roadFilter = ctx.createBiquadFilter();
    this.roadFilter.type = 'lowpass';
    this.roadFilter.frequency.value = 120;
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    road.connect(this.roadFilter).connect(this.roadGain).connect(this.master);
    road.start(0, 0.7);

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
    const grindChatter = ctx.createGain();
    grindChatter.gain.value = 0.5;
    grindMod.connect(grindModGain).connect(grindChatter.gain);
    grind.connect(grindFilter).connect(grindChatter).connect(this.grindGain).connect(this.master);
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

  // 'stock' | 'street' | 'race'
  setExhaust(type) {
    if (this.exhaust === type && this.exhaustApplied === !!this.ctx) return;
    this.exhaust = type;
    this.exhaustApplied = !!this.ctx;
    if (!this.ctx) return;
    const loud = type !== 'stock';
    this.bass.gain.value = loud ? 8 : 0;
    this.subGain.gain.value = loud ? 0.32 : 0;
  }

  // Intake: 'stock' | 'pod' | 'itb'; turbo: 'none' | 'small' | 'big'.
  setParts(intake, turbo) {
    this.intake = intake;
    this.turbo = turbo;
  }

  // In-car: the intake is right in front of you and the exhaust is behind the bulkhead.
  // Passing a post, a sign or a rail post at speed: a short rush of air on that side.
  whoosh(strength, pan) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1300, t);
    bp.frequency.exponentialRampToValueAtTime(500, t + 0.16);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12 * Math.min(1, strength), t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(bp).connect(g).connect(p).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.2);
  }

  setBigBrakes(on) {
    this.bigBrakes = on;
  }

  setInterior(on) {
    this.interior = on;
  }

  // Turbo flutter (compressor surge) on lift-off: with nowhere to go, the boosted air pushes
  // back through the turbo in a fast, chattering "stu-tu-tu-tu" that slows and fades as the
  // pressure drops. Each chatter is a short puff of low, breathy noise.
  // Small turbo on lift-off: one soft "poof", like a sneeze of air.
  #poof(strength) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(350, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.35 * strength, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.32);
  }

  #flutter(strength, big) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const count = Math.round((big ? 12 : 8) * (0.6 + 0.4 * strength));
    let at = t0 + 0.02;
    let gap = big ? 0.052 : 0.04; // seconds between chatters, growing as it winds down
    for (let k = 0; k < count; k++) {
      const fade = 1 - k / count;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = (big ? 330 : 680) - k * 14 + Math.random() * 50;
      bp.Q.value = 1.6;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = big ? 1100 : 1800;
      const g = ctx.createGain();
      const peak = 0.42 * strength * (0.35 + 0.65 * fade);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(peak, at + 0.006);
      g.gain.exponentialRampToValueAtTime(0.001, at + gap * 0.85);
      src.connect(bp).connect(lp).connect(g).connect(this.master);
      src.start(at, Math.random());
      src.stop(at + gap);
      at += gap;
      gap *= 1.07;
    }
    // A soft rush of air under the chatter.
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    const af = ctx.createBiquadFilter();
    af.type = 'bandpass';
    af.frequency.value = 900;
    af.Q.value = 0.7;
    const ag = ctx.createGain();
    ag.gain.setValueAtTime(0.0001, t0);
    ag.gain.linearRampToValueAtTime(0.08 * strength, t0 + 0.02);
    ag.gain.exponentialRampToValueAtTime(0.001, at);
    air.connect(af).connect(ag).connect(this.master);
    air.start(t0, Math.random());
    air.stop(at + 0.05);
  }

  // 0..1: how hard metal is scraping right now. The first moment of contact also clangs.
  setScrape(level, speed = 0) {
    if (!this.ctx) return;
    if (level > 0 && !(this.scraping > 0) && speed > 4) this.#clang(Math.min(1, speed / 25));
    this.scraping = level;
    this.scrapeGain.gain.setTargetAtTime(Math.min(1, level) * 0.5, this.ctx.currentTime, level > 0 ? 0.01 : 0.08);
  }

  // A hit: a dull thump of the body and a metallic ring.
  #clang(strength) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.9 * strength, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.3);
    for (const f of [620, 1310, 2140]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f * (0.95 + Math.random() * 0.1);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.linearRampToValueAtTime(0.12 * strength, t + 0.004);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(og).connect(this.master);
      o.start(t);
      o.stop(t + 0.4);
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
    f.frequency.value = this.exhaust && this.exhaust !== 'stock' ? 110 + Math.random() * 260 : 180 + Math.random() * 380;
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

  // vehicle: the simulation; ev: exhaust events (see exhaust.js); called once per rendered frame.
  update(vehicle, dt, ev = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const e = vehicle.engine;
    const tr = vehicle.trans;
    const rpm = Math.max(0, e.rpm);
    const running = e.running;
    const load = running ? e.throttleApplied : 0;

    // Engine note.
    const f = Math.max(rpm, 1) / 20;
    this.fire.frequency.setTargetAtTime(f, t, 0.012);
    this.fire2.frequency.setTargetAtTime(f * 1.006, t, 0.012);
    this.lump.frequency.setTargetAtTime(f / 2, t, 0.012);
    this.sub.frequency.setTargetAtTime(f / 2, t, 0.012);
    this.resonance.frequency.setTargetAtTime(clamp(f * 0.9, 60, 500), t, 0.03);
    const loud = this.exhaust && this.exhaust !== 'stock';
    this.engineFilter.frequency.setTargetAtTime((220 + load * 900 + rpm * 0.1) * (loud ? 0.82 : 1), t, 0.03);
    // The half-order rumble carries the low end, strongest at low revs.
    this.lumpGain.gain.setTargetAtTime(0.6 - clamp(rpm / 6500, 0, 1) * 0.25, t, 0.05);
    const turning = clamp(rpm / 500, 0, 1);
    let level = running ? 0.16 + load * 0.3 + (rpm / 6500) * 0.14 : 0.25 * turning * clamp(rpm / 1500, 0, 1);
    if (loud) level *= this.exhaust === 'race' ? 1.28 : 1.16;
    // Rev limiter: the fuel cut chops the note.
    if (e.limiterCut) level *= 0.35;
    this.engineGain.gain.setTargetAtTime(this.m20 ? 0 : level, t, e.limiterCut !== this.limiterWas ? 0.004 : 0.02);
    this.limiterWas = e.limiterCut;
    this.intakeFilter.frequency.setTargetAtTime(f * 1.6, t, 0.03);
    const inCar = this.interior ? 1 : 0;
    this.intakeGain.gain.setTargetAtTime(running ? load * 0.12 * clamp(rpm / 6000, 0.2, 1) * (1 + inCar) * (this.m20 ? 0.5 : 1) : 0, t, 0.04);
    // Induction roar: louder with ITBs, louder still from inside the car.
    const indLevel = { stock: 0.04, pod: 0.22, itb: 0.18 }[this.intake || 'stock'] * (1 + inCar * 1.4);
    // ITB grumble: strongest at low and middle revs and on the throttle, louder in the car.
    const isItb = this.intake === 'itb' && running;
    this.itb.frequency.setTargetAtTime(f / 2, t, 0.015);
    this.itb2.frequency.setTargetAtTime(f / 4, t, 0.015);
    this.itbLfo.frequency.setTargetAtTime(f / 8, t, 0.02);
    this.itbLow.frequency.setTargetAtTime(120 + rpm * 0.025 + load * 60, t, 0.03);
    this.itbGain.gain.setTargetAtTime(isItb ? (0.22 + load * 0.38) * (1.15 - rpm / 14000) * (1 + inCar * 0.9) : 0, t, 0.04);
    this.indLfo.frequency.setTargetAtTime(f / 2, t, 0.012);
    this.indTone.frequency.setTargetAtTime(clamp(f * 0.75, 30, 300), t, 0.02);
    this.indFilter.frequency.setTargetAtTime(160 + rpm * 0.05 + load * 120, t, 0.03);
    this.indGain.gain.setTargetAtTime(running ? indLevel * (0.25 + load * 0.75) * clamp(0.35 + rpm / 6500, 0, 1.2) : 0, t, 0.03);
    // Inside, the exhaust note is muffled by the bulkhead.
    if (inCar) this.engineFilter.frequency.setTargetAtTime((220 + load * 900 + rpm * 0.1) * 0.7, t, 0.03);
    // Turbo spool follows boost; it flutters when you lift with boost up.
    const boost = e.boost || 0;
    const big = this.turbo === 'big';
    if (this.turbo && this.turbo !== 'none') {
      // Spool: a lower, softer whine (the big turbo is deeper still) that rises gently with boost.
      const spool = (big ? 260 : 360) + boost * (big ? 620 : 760) + rpm * 0.03;
      this.whistle.frequency.setTargetAtTime(spool, t, 0.08);
      this.whistleBand.frequency.setTargetAtTime(spool, t, 0.08);
      this.whistleGain.gain.setTargetAtTime(boost * (big ? 0.07 : 0.05) * (1 + inCar * 0.5), t, 0.08);
      this.rushBand.frequency.setTargetAtTime(spool * 2.2, t, 0.08);
      this.rushGain.gain.setTargetAtTime(boost * (big ? 0.2 : 0.13) * (0.4 + 0.6 * vehicle.throttlePedal) * (1 + inCar * 0.5), t, 0.08);
      // Lift-off: the big turbo flutters; the small one just puffs once.
      if (this.prevBoost > 0.3 && vehicle.throttlePedal < 0.2 && this.prevThrottle > 0.5) {
        if (big) this.#flutter(Math.min(1, this.prevBoost * 1.2), true);
        else this.#poof(Math.min(1, this.prevBoost * 1.3));
      }
    } else {
      this.whistleGain.gain.setTargetAtTime(0, t, 0.05);
      this.rushGain.gain.setTargetAtTime(0, t, 0.05);
    }
    this.prevBoost = boost;

    // Events: stall, start, lift-off pops, downshift blips.
    if (this.m20) {
      // The M20 synth follows the engine model: stalls run down with the ignition off, and a
      // restart gets a short turn of the starter before it catches.
      if (!this.prevRunning && running) this.crankT = 0.45;
      const cranking = this.crankT > 0;
      this.crankT -= dt;
      this.m20Cabin.frequency.setTargetAtTime(inCar ? 1100 : 20000, t, 0.05);
      this.m20.setState({
        rpm: cranking ? 250 : rpm,
        throttle: cranking ? 0 : load,
        ignition: running && !cranking ? 1 : 0,
        starter: cranking ? 1 : 0,
        exhaust: this.exhaust || 'stock', // street/race: rowdier voice and a lopey idle
        idleRpm: e.spec?.idleRpm ?? 760,
      });
    } else {
      if (this.prevRunning && !running) this.#sputter();
      if (!this.prevRunning && running) this.#starter();
    }
    this.popTimer -= dt;
    // With the M20 synth, afterfire pops come from the synth itself (only on a real lift-off).
    if (loud && ev && !this.m20) {
      // Street and race: crackles and pops on every lift-off and gear change, bangs off the limiter.
      if (ev.lift) this.#crackle(6 + Math.floor(Math.random() * 5), 0.9);
      if (ev.shift) this.#crackle(3 + Math.floor(Math.random() * 3), 0.3);
      if (ev.limiter) this.#pop(t, 0.9);
      this.prevRunning = running;
      this.prevThrottle = vehicle.throttlePedal;
      this.prevGear = tr.gear;
      this.prevRpm = rpm;
    }
    const lifted = this.prevThrottle > 0.6 && vehicle.throttlePedal < 0.2;
    if (running && lifted && rpm > 3800 && this.popTimer <= 0 && !this.m20) {
      this.#crackle(3 + Math.floor(Math.random() * 4), 0.5);
      this.popTimer = 0.6;
    }
    const downshift = tr.gear > 0 && this.prevGear > tr.gear && rpm > this.prevRpm + 400;
    if (running && downshift && this.popTimer <= 0 && !this.m20) {
      this.#crackle(2 + Math.floor(Math.random() * 3), 0.35);
      this.popTimer = 0.4;
    }
    if (running && e.limiterCut && Math.random() < dt * 6 && !this.m20) this.#pop(t, 0.35);
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

    // Big brakes squeal as the car rolls to a stop on the pedal.
    const squealing = this.bigBrakes && vehicle.brakePedal > 0.3 && speed > 0.4 && speed < 7;
    const sq = squealing ? Math.min(1, (7 - speed) / 3) * Math.min(1, speed / 1.2) : 0;
    this.squeak.frequency.setTargetAtTime(3400 + Math.sin(t * 3.1) * 120 + speed * 30, t, 0.05);
    this.squeak2.frequency.setTargetAtTime(3405 * 1.5 + Math.sin(t * 2.3) * 90, t, 0.05);
    this.squeakGain.gain.setTargetAtTime(sq * 0.09, t, squealing ? 0.08 : 0.04);
    this.windGain.gain.setTargetAtTime(clamp((speed / 45) ** 2, 0, 1.2) * 0.32, t, 0.2);
    // Road roar: the tyres on the tarmac, a low rumble that builds with speed.
    this.roadGain.gain.setTargetAtTime(clamp(speed / 40, 0, 1.2) ** 1.5 * 0.1, t, 0.15);
    this.roadFilter.frequency.setTargetAtTime(90 + speed * 4, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(300 + speed * 18, t, 0.2);
    this.grindGain.gain.setTargetAtTime(tr.grindTimer > 0 ? 0.35 : 0, t, 0.01);
  }
}
