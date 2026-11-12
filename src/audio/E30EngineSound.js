// E30EngineSound - rpm-driven engine audio built from a real recording.
//
// How it works
// ------------
// The source recording (idle + free revs) comes with a map that says what rpm
// the engine was at for every 10 ms of audio (see tools/extract_engine_samples.py).
// Every few tens of milliseconds we play a short windowed "grain" of the
// recording taken from a spot where the real engine was at (nearly) the rpm the
// game wants, with a small playbackRate correction for the exact rpm.
// While the rpm stays close we keep reading forward through the recording, so
// it sounds like the real tape; when the rpm moves away we jump to a better
// matching spot. Above the highest recorded rpm the closest grains are
// pitch-shifted up and an optional synthesized layer (straight-six firing
// orders) fills in the body that pitch-shifting loses.
//
// Usage
// -----
//   const engine = await E30EngineSound.load(ctx, {
//     source: 'assets/audio/e30/e30_m20_source.wav',
//     map:    'assets/audio/e30/e30_m20_map.json',
//     start:  'assets/audio/e30/e30_m20_start.wav',   // optional
//   });
//   engine.connect(ctx.destination);
//   engine.start();               // or engine.startWithCrank()
//   // every frame:
//   engine.setRpm(rpm);
//   engine.setThrottle(throttle); // 0..1
//   engine.stop();

const GRAIN_LEN = 0.08;   // seconds
const GRAIN_HOP = 0.04;   // 50% overlap, triangular windows sum flat
const LOOKAHEAD = 0.12;   // schedule this far ahead of ctx.currentTime
const CONT_TOL = 0.10;    // keep reading forward while the tape is within +-10% of the wanted rpm
const POOL_TOL = 0.04;    // when we do jump, pick from spots within +-4% ...
const MIN_POOL = 24;      // ... or the 24 nearest, so we never loop one spot (that buzzes)

export class E30EngineSound {
  static async load(ctx, urls) {
    const [source, map, start] = await Promise.all([
      fetchAudio(ctx, urls.source),
      fetch(urls.map).then((r) => r.json()),
      urls.start ? fetchAudio(ctx, urls.start) : null,
    ]);
    return new E30EngineSound(ctx, { source, map, start });
  }

  constructor(ctx, { source, map, start = null }) {
    this.ctx = ctx;
    this.source = source;
    this.startBuffer = start;
    this.hop = map.hop;
    this.idleRpm = map.idleRpm;
    this.minRpm = map.minRpm;
    this.maxRpm = map.maxRpm;
    // frames: {t, rpm, on, conf}
    this.frames = map.frames.map(([t, rpm, on, conf]) => ({ t, rpm, on: !!on, conf }));
    this.frameT0 = this.frames[0].t;
    const usable = this.frames.filter(
      (f) => f.conf > 0.25 && f.t + GRAIN_LEN * 4 < source.duration,
    );
    this.byRpm = usable.slice().sort((a, b) => a.rpm - b.rpm);

    this.rpm = this.idleRpm;
    this.targetRpm = this.idleRpm;
    this.throttle = 0;
    this.synthEnabled = true;
    this.running = false;
    this.cursor = 0;
    this.nextGrain = 0;
    this._lastThrottle = 0;

    // --- graph: grains + synth -> load filter -> master ---
    this.grainBus = ctx.createGain();
    this.lowShelf = ctx.createBiquadFilter();
    this.lowShelf.type = 'lowshelf';
    this.lowShelf.frequency.value = 180;
    this.grainBus.connect(this.lowShelf);

    this.loadFilter = ctx.createBiquadFilter();
    this.loadFilter.type = 'lowpass';
    this.loadFilter.Q.value = 0.5;
    this.loadFilter.frequency.value = 3000;
    this.lowShelf.connect(this.loadFilter);

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.loadFilter.connect(this.master);
    this.output = ctx.createGain(); // engine + start-up sample + crackle
    this.master.connect(this.output);

    this._buildSynth();
    this._buildCrackle();
  }

  connect(dest) { this.output.connect(dest); return this; }
  disconnect() { this.output.disconnect(); }

  setRpm(rpm) { this.targetRpm = Math.max(300, rpm); }
  setThrottle(t) {
    t = Math.min(1, Math.max(0, t));
    // lift-off from high rpm -> exhaust crackle
    const now = this.ctx.currentTime;
    if (this._lastThrottle > 0.5 && t < 0.15 && this.rpm > 2600 &&
        now - (this._lastCrackle || 0) > 0.6) {
      this._lastCrackle = now;
      this.crackle();
    }
    this._lastThrottle = t;
    this.throttle = t;
  }
  setSynthLayer(on) { this.synthEnabled = on; }

  start(fadeIn = 0.25) {
    if (this.running) return;
    this.running = true;
    const now = this.ctx.currentTime;
    this.rpm = this.targetRpm;
    this.cursor = this._findGrain(Math.max(this.rpm, this.minRpm), false).t;
    this.nextGrain = now + 0.02;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(1, now + fadeIn);
    this.synthOut.gain.setValueAtTime(0, now);
    this._timer = setInterval(() => this._tick(), 20);
    this._tick();
  }

  /** Play the recorded start-up, then hand over to the live engine. */
  startWithCrank() {
    if (!this.startBuffer) return this.start();
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.startBuffer;
    const g = ctx.createGain();
    src.connect(g).connect(this.output);
    const now = ctx.currentTime;
    const d = this.startBuffer.duration;
    g.gain.setValueAtTime(1, now + d - 0.25);
    g.gain.linearRampToValueAtTime(0, now + d);
    src.start(now);
    this.targetRpm = this.idleRpm;
    setTimeout(() => this.start(0.25), Math.max(0, (d - 0.3) * 1000));
    return d;
  }

  stop(fadeOut = 0.4) {
    if (!this.running) return;
    this.running = false;
    clearInterval(this._timer);
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + fadeOut);
  }

  // ---------------------------------------------------------------- internals

  _tick() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (this.nextGrain < now) this.nextGrain = now + 0.005;
    while (this.nextGrain < now + LOOKAHEAD) {
      // follow the requested rpm quickly but not instantly (avoids zipper jumps)
      this.rpm += (this.targetRpm - this.rpm) * 0.6;
      this._grain(this.nextGrain);
      this.nextGrain += GRAIN_HOP;
    }
    this._updateTone(now);
  }

  _grain(when) {
    const ctx = this.ctx;
    const rpm = this.rpm;
    // the rpm we look for on the tape; outside the recorded range we take the
    // nearest recorded spot and let playbackRate do the rest
    const want = Math.min(Math.max(rpm, this.minRpm), this.maxRpm * 0.97);
    const wantOn = this.throttle > 0.5;
    let f = this._frameAt(this.cursor);
    const classOk = f.on === wantOn || !this._classPool(want, wantOn);
    if (Math.abs(Math.log(want / f.rpm)) > CONT_TOL || !classOk ||
        this.cursor + GRAIN_LEN * Math.max(rpm / f.rpm, 1) * 3 > this.source.duration) {
      f = this._findGrain(want, wantOn);
      this.cursor = f.t;
    }
    let rate = rpm / f.rpm;
    rate = Math.min(4, Math.max(0.5, rate));

    const src = ctx.createBufferSource();
    src.buffer = this.source;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(1, when + GRAIN_LEN / 2);
    g.gain.linearRampToValueAtTime(0, when + GRAIN_LEN);
    src.connect(g).connect(this.grainBus);
    src.start(when, Math.max(0, this.cursor), GRAIN_LEN * rate + 0.01);
    src.stop(when + GRAIN_LEN + 0.02);
    src.onended = () => g.disconnect();
    this.cursor += GRAIN_HOP * rate;
  }

  _frameAt(t) {
    const i = Math.round((t - this.frameT0) / this.hop);
    return this.frames[Math.min(this.frames.length - 1, Math.max(0, i))];
  }

  _pool(rpm) {
    const arr = this.byRpm;
    let a = lowerBound(arr, rpm * Math.exp(-POOL_TOL));
    let b = lowerBound(arr, rpm * Math.exp(POOL_TOL));
    while (b - a < MIN_POOL && (a > 0 || b < arr.length)) {
      // grow towards whichever side is closer in rpm
      const da = a > 0 ? rpm - arr[a - 1].rpm : Infinity;
      const db = b < arr.length ? arr[b].rpm - rpm : Infinity;
      if (da <= db) a--; else b++;
    }
    return arr.slice(a, b);
  }

  _classPool(rpm, on) {
    const key = Math.round(rpm / 25) + (on ? 'on' : 'off');
    this._cache ??= new Map();
    if (!this._cache.has(key)) {
      const same = this._pool(rpm).filter((f) => f.on === on);
      this._cache.set(key, same.length >= 6 ? same : null);
    }
    return this._cache.get(key);
  }

  _findGrain(rpm, wantOn) {
    const pool = this._classPool(rpm, wantOn) || this._pool(rpm);
    return pool[(Math.random() * pool.length) | 0];
  }

  _updateTone(now) {
    const rpm = this.rpm, thr = this.throttle;
    const k = 0.05;
    // more load = louder and brighter
    this.grainBus.gain.setTargetAtTime(0.75 + 0.35 * thr, now, k);
    this.loadFilter.frequency.setTargetAtTime(2200 + 7000 * thr + rpm * 0.6, now, k);
    // pitch-shifting up thins the low end: give some back
    const shift = Math.max(1, rpm / this.maxRpm);
    this.lowShelf.gain.setTargetAtTime(Math.min(9, 6 * Math.log2(shift)), now, k);

    // synth layer fades in above the recorded range
    const fire = rpm / 20; // straight-six: 3 power strokes per crank revolution
    this.oscFire.frequency.setTargetAtTime(fire, now, 0.02);
    this.oscHalf.frequency.setTargetAtTime(fire / 2, now, 0.02);
    this.oscDouble.frequency.setTargetAtTime(fire * 2, now, 0.02);
    const x = (rpm - this.maxRpm * 0.9) / (this.maxRpm * 1.2);
    const blend = this.synthEnabled ? smoothstep(Math.min(1, Math.max(0, x))) : 0;
    this.synthOut.gain.setTargetAtTime(blend * (0.18 + 0.22 * thr), now, k);
    this.synthTone.frequency.setTargetAtTime(600 + fire * 4 + thr * 1500, now, k);
  }

  _buildSynth() {
    const ctx = this.ctx;
    this.oscFire = ctx.createOscillator(); this.oscFire.type = 'sawtooth';
    this.oscHalf = ctx.createOscillator(); this.oscHalf.type = 'sine';
    this.oscDouble = ctx.createOscillator(); this.oscDouble.type = 'triangle';
    const mix = ctx.createGain(); mix.gain.value = 0.5;
    const gh = ctx.createGain(); gh.gain.value = 0.6;
    const gd = ctx.createGain(); gd.gain.value = 0.35;
    this.oscFire.connect(mix);
    this.oscHalf.connect(gh).connect(mix);
    this.oscDouble.connect(gd).connect(mix);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / 1023) * 2 - 1) * 2.5);
    shaper.curve = curve;
    this.synthTone = ctx.createBiquadFilter();
    this.synthTone.type = 'lowpass';
    this.synthTone.Q.value = 2.5;
    this.synthOut = ctx.createGain();
    this.synthOut.gain.value = 0;
    mix.connect(shaper).connect(this.synthTone).connect(this.synthOut).connect(this.loadFilter);
    for (const o of [this.oscFire, this.oscHalf, this.oscDouble]) o.start();
  }

  _buildCrackle() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 0.1;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  /** A burst of overrun pops, like lifting off at high rpm. */
  crackle(count = 3 + ((Math.random() * 6) | 0)) {
    if (!this.running) return;
    const ctx = this.ctx;
    let t = ctx.currentTime + 0.05;
    for (let i = 0; i < count; i++) {
      t += 0.04 + Math.random() * 0.14;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 500 + Math.random() * 1600;
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      const amp = 0.5 + Math.random() * 0.9;
      const dur = 0.012 + Math.random() * 0.03;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(bp).connect(g).connect(this.output);
      src.start(t, Math.random() * 0.05, dur + 0.01);
    }
  }
}

async function fetchAudio(ctx, url) {
  const buf = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.arrayBuffer();
  });
  return ctx.decodeAudioData(buf);
}

function lowerBound(arr, rpm) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m].rpm < rpm) lo = m + 1; else hi = m;
  }
  return lo;
}

function smoothstep(x) { return x * x * (3 - 2 * x); }
