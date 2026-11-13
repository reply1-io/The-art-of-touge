// The mountain around you: wind through the cedars, birds by day, crickets after sunset, and now
// and then another car somewhere on the pass, its engine echoing off the hillsides as it works
// through the gears (with the odd distant tyre squeal).
//
// Uses the car audio's context and output, so the Sound setting and pausing apply to it too.

const rand = (a, b) => a + Math.random() * (b - a);

export class Ambience {
  constructor(audio) {
    this.audio = audio;
    this.ready = false;
    this.time = 'day';
    this.birdTimer = 2;
    this.carTimer = rand(12, 25);
  }

  #setup() {
    const a = this.audio;
    const ctx = a.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(a.master);
    // Echo off the mountain: a slow delay with a little feedback and the highs rolled off.
    this.echo = ctx.createDelay(1.5);
    this.echo.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dark = ctx.createBiquadFilter();
    dark.type = 'lowpass';
    dark.frequency.value = 900;
    this.echo.connect(dark).connect(fb).connect(this.echo);
    dark.connect(this.out);
    // Wind in the trees: filtered noise that breathes slowly.
    const wind = ctx.createBufferSource();
    wind.buffer = a.noise;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 420;
    wf.Q.value = 0.5;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.03;
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.09;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = 0.022;
    gust.connect(gustDepth).connect(this.windGain.gain);
    wind.connect(wf).connect(this.windGain).connect(this.out);
    wind.start(0, Math.random() * 1.5);
    gust.start();
    // Crickets: a high trill pulsing in bursts.
    this.cricket = ctx.createOscillator();
    this.cricket.frequency.value = 4400;
    const trill = ctx.createOscillator();
    trill.type = 'square';
    trill.frequency.value = 32;
    const trillGain = ctx.createGain();
    trillGain.gain.value = 0;
    const burst = ctx.createOscillator();
    burst.type = 'square';
    burst.frequency.value = 1.6;
    const burstDepth = ctx.createGain();
    burstDepth.gain.value = 0.5;
    const trillDepth = ctx.createGain();
    trillDepth.gain.value = 0.5;
    trill.connect(trillDepth).connect(trillGain.gain);
    burst.connect(burstDepth).connect(trillGain.gain);
    this.cricketGain = ctx.createGain();
    this.cricketGain.gain.value = 0;
    this.cricket.connect(trillGain).connect(this.cricketGain).connect(this.out);
    for (const o of [this.cricket, trill, burst]) o.start();
    this.ready = true;
  }

  // time: 'day' | 'sunset' | 'night'
  update(dt, time) {
    const a = this.audio;
    if (!a.ctx) return;
    if (!this.ready) this.#setup();
    const ctx = a.ctx;
    const t = ctx.currentTime;
    if (time !== this.time) this.time = time;
    this.cricketGain.gain.setTargetAtTime(time === 'night' ? 0.012 : time === 'sunset' ? 0.006 : 0, t, 1);
    if (time === 'day' || time === 'sunset') {
      this.birdTimer -= dt;
      if (this.birdTimer <= 0) {
        this.#bird();
        this.birdTimer = time === 'day' ? rand(1.2, 4.5) : rand(4, 10);
      }
    }
    this.carTimer -= dt;
    if (this.carTimer <= 0) {
      this.#distantCar();
      this.carTimer = rand(28, 60);
    }
  }

  #pan(v) {
    const p = this.audio.ctx.createStereoPanner();
    p.pan.value = v;
    return p;
  }

  // A short phrase of two to four quick whistles.
  #bird() {
    const ctx = this.audio.ctx;
    const pan = this.#pan(rand(-0.9, 0.9));
    pan.connect(this.out);
    let at = ctx.currentTime + 0.05;
    const base = rand(2600, 4200);
    const n = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const len = rand(0.06, 0.14);
      o.frequency.setValueAtTime(base * rand(0.9, 1.1), at);
      o.frequency.exponentialRampToValueAtTime(base * rand(1.2, 1.6), at + len);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.018, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(g).connect(pan);
      o.start(at);
      o.stop(at + len + 0.02);
      at += len + rand(0.03, 0.12);
    }
  }

  // Another car somewhere on the mountain: it pulls through three or four gears, lifts, and
  // sometimes squeals a tyre, far away and echoing.
  #distantCar() {
    const ctx = this.audio.ctx;
    const t0 = ctx.currentTime + 0.1;
    const side = rand(-0.8, 0.8);
    const pan = this.#pan(side);
    const far = ctx.createBiquadFilter();
    far.type = 'lowpass';
    far.frequency.value = rand(500, 800);
    const level = ctx.createGain();
    level.gain.value = 0;
    level.connect(far).connect(pan);
    pan.connect(this.out);
    pan.connect(this.echo);
    const eng = ctx.createOscillator();
    eng.type = 'sawtooth';
    const eng2 = ctx.createOscillator();
    eng2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.4;
    eng.connect(level);
    eng2.connect(g2).connect(level);
    // Engine pitch: a six fires 3x per revolution.
    let at = t0;
    const gears = 3 + Math.floor(Math.random() * 2);
    const hz = (rpm) => rpm / 20;
    eng.frequency.setValueAtTime(hz(3200), at);
    eng2.frequency.setValueAtTime(hz(3200) / 2, at);
    // Fade in from far away.
    const peak = rand(0.025, 0.045);
    level.gain.setValueAtTime(0.0001, at);
    level.gain.linearRampToValueAtTime(peak, at + 1.5);
    for (let k = 0; k < gears; k++) {
      const pull = rand(1.1, 1.8) + k * 0.25;
      eng.frequency.linearRampToValueAtTime(hz(6300), at + pull);
      eng2.frequency.linearRampToValueAtTime(hz(6300) / 2, at + pull);
      at += pull;
      // Shift: the revs drop.
      eng.frequency.linearRampToValueAtTime(hz(4300), at + 0.18);
      eng2.frequency.linearRampToValueAtTime(hz(4300) / 2, at + 0.18);
      at += 0.18;
    }
    // Lift for a corner, then fade out as it goes behind the mountain.
    eng.frequency.linearRampToValueAtTime(hz(2600), at + 1.2);
    eng2.frequency.linearRampToValueAtTime(hz(2600) / 2, at + 1.2);
    level.gain.setValueAtTime(peak, at);
    level.gain.linearRampToValueAtTime(0.0001, at + 2.5);
    for (const o of [eng, eng2]) {
      o.start(t0);
      o.stop(at + 2.6);
    }
    if (Math.random() < 0.55) {
      // A distant squeal as it turns in.
      const sq = ctx.createBufferSource();
      sq.buffer = this.audio.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1000;
      bp.Q.value = 8;
      const sg = ctx.createGain();
      const s0 = at + 0.3;
      sg.gain.setValueAtTime(0.0001, s0);
      sg.gain.linearRampToValueAtTime(0.03, s0 + 0.2);
      sg.gain.linearRampToValueAtTime(0.0001, s0 + 1.1);
      sq.connect(bp).connect(sg).connect(pan);
      sq.start(s0, Math.random());
      sq.stop(s0 + 1.2);
    }
  }
}
