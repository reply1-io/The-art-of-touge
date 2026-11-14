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
    // Rain: a hiss of fine drops on the leaves and the road, over a soft patter.
    const rain = ctx.createBufferSource();
    rain.buffer = a.noise;
    rain.loop = true;
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'highpass';
    hiss.frequency.value = 1500;
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 6500;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(hiss).connect(soft).connect(this.rainGain).connect(this.out);
    rain.start(0, Math.random() * 1.5);
    const patter = ctx.createBufferSource();
    patter.buffer = a.noise;
    patter.loop = true;
    const pf = ctx.createBiquadFilter();
    pf.type = 'bandpass';
    pf.frequency.value = 700;
    pf.Q.value = 0.7;
    this.patterGain = ctx.createGain();
    this.patterGain.gain.value = 0;
    patter.connect(pf).connect(this.patterGain).connect(this.out);
    patter.start(0, Math.random() * 1.5);
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
    this.rainGain.gain.setTargetAtTime(time === 'rain' ? 0.05 : 0, t, 1.5);
    this.patterGain.gain.setTargetAtTime(time === 'rain' ? 0.035 : 0, t, 1.5);
    if (time === 'day' || time === 'sunset') {
      this.birdTimer -= dt;
      if (this.birdTimer <= 0) {
        this.#bird();
        this.birdTimer = time === 'day' ? rand(0.6, 2.6) : rand(2.5, 7);
      }
    }
    // Other cars on the mountain: full runs through the gears, and shorter moments in between.
    this.carTimer -= dt;
    if (this.carTimer <= 0) {
      const pick = Math.random();
      if (pick < 0.4) this.#distantCar();
      else if (pick < 0.6) this.#revOut();
      else if (pick < 0.8) this.#screech();
      else this.#blips();
      this.carTimer = rand(9, 22);
    }
    // More of the forest: a woodpecker or crows by day, frogs at dusk and night, an owl at night.
    this.critterTimer = (this.critterTimer ?? rand(6, 12)) - dt;
    if (this.critterTimer <= 0) {
      if (time === 'day') (Math.random() < 0.5 ? this.#woodpecker() : this.#crow());
      else if (time === 'sunset') (Math.random() < 0.5 ? this.#frogs() : this.#crow());
      else if (time === 'rain') this.#frogs();
      else (Math.random() < 0.55 ? this.#frogs() : this.#owl());
      this.critterTimer = rand(7, 16);
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

  // A distant engine sound chain (sawtooth + sub, low-passed, panned, into the echo).
  #engineVoice(pan, level) {
    const ctx = this.audio.ctx;
    const p = this.#pan(pan);
    const far = ctx.createBiquadFilter();
    far.type = 'lowpass';
    far.frequency.value = rand(600, 950);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(far).connect(p);
    p.connect(this.out);
    p.connect(this.echo);
    const a = ctx.createOscillator();
    a.type = 'sawtooth';
    const b = ctx.createOscillator();
    b.type = 'square';
    const bg = ctx.createGain();
    bg.gain.value = 0.4;
    a.connect(g);
    b.connect(bg).connect(g);
    void level;
    return { g, a, b, set: (t, hz, ramp = true) => {
      for (const [o, k] of [[a, 1], [b, 0.5]]) (ramp ? o.frequency.linearRampToValueAtTime(hz * k, t) : o.frequency.setValueAtTime(hz * k, t));
    }, stop: (t) => { a.start(); b.start(); a.stop(t); b.stop(t); } };
  }

  // Someone bouncing off the rev limiter somewhere below.
  #revOut() {
    const ctx = this.audio.ctx;
    const t0 = ctx.currentTime + 0.05;
    const v = this.#engineVoice(rand(-0.9, 0.9));
    const hz = (rpm) => rpm / 20;
    const peak = rand(0.03, 0.05);
    v.set(t0, hz(2500), false);
    v.g.gain.setValueAtTime(0.0001, t0);
    v.g.gain.linearRampToValueAtTime(peak, t0 + 0.4);
    v.set(t0 + 1.0, hz(6800));
    let t = t0 + 1.0;
    // The limiter: the note chops between 6,600 and 6,800 a few times a second.
    for (let k = 0; k < 10; k++) {
      v.set(t + 0.06, hz(6400));
      v.set(t + 0.12, hz(6800));
      v.g.gain.setValueAtTime(peak * 0.5, t + 0.06);
      v.g.gain.setValueAtTime(peak, t + 0.12);
      t += 0.12;
    }
    v.set(t + 0.8, hz(1500));
    v.g.gain.linearRampToValueAtTime(0.0001, t + 1.0);
    v.stop(t + 1.1);
  }

  // A few sharp throttle blips, like a driver warming up or heel-and-toeing.
  #blips() {
    const ctx = this.audio.ctx;
    const t0 = ctx.currentTime + 0.05;
    const v = this.#engineVoice(rand(-0.9, 0.9));
    const hz = (rpm) => rpm / 20;
    const peak = rand(0.025, 0.04);
    v.set(t0, hz(950), false);
    v.g.gain.setValueAtTime(peak * 0.4, t0);
    let t = t0 + 0.3;
    for (let k = 0; k < 3 + Math.floor(Math.random() * 3); k++) {
      v.set(t + 0.12, hz(rand(4500, 6200)));
      v.g.gain.linearRampToValueAtTime(peak, t + 0.12);
      v.set(t + 0.6, hz(1000));
      v.g.gain.linearRampToValueAtTime(peak * 0.4, t + 0.6);
      t += rand(0.7, 1.1);
    }
    v.g.gain.linearRampToValueAtTime(0.0001, t + 0.5);
    v.stop(t + 0.6);
  }

  // Tyres screaming through a corner somewhere across the valley.
  #screech() {
    const ctx = this.audio.ctx;
    const t0 = ctx.currentTime + 0.05;
    const pan = this.#pan(rand(-0.9, 0.9));
    pan.connect(this.out);
    pan.connect(this.echo);
    const src = ctx.createBufferSource();
    src.buffer = this.audio.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 9;
    bp.frequency.setValueAtTime(rand(850, 1100), t0);
    bp.frequency.linearRampToValueAtTime(rand(1100, 1400), t0 + 1.5);
    const g = ctx.createGain();
    const len = rand(1.2, 2.6);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(rand(0.03, 0.05), t0 + 0.25);
    g.gain.setValueAtTime(rand(0.025, 0.045), t0 + len - 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t0 + len);
    src.connect(bp).connect(g).connect(pan);
    src.start(t0, Math.random());
    src.stop(t0 + len + 0.1);
    // Usually the engine comes back on as it exits.
    if (Math.random() < 0.7) setTimeout(() => this.audio.ctx && this.#blips(), len * 700);
  }

  // Short tuned knocks: a woodpecker drumming.
  #woodpecker() {
    const ctx = this.audio.ctx;
    const pan = this.#pan(rand(-1, 1));
    pan.connect(this.out);
    let t = ctx.currentTime + 0.05;
    const n = 10 + Math.floor(Math.random() * 10);
    for (let k = 0; k < n; k++) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = rand(700, 900);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.02 * (1 - k / n / 2), t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.04);
      t += 0.045;
    }
  }

  // A crow's harsh "caw", two or three times.
  #crow() {
    const ctx = this.audio.ctx;
    const pan = this.#pan(rand(-1, 1));
    pan.connect(this.out);
    pan.connect(this.echo);
    let t = ctx.currentTime + 0.05;
    for (let k = 0; k < 2 + Math.floor(Math.random() * 2); k++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(rand(520, 600), t);
      o.frequency.linearRampToValueAtTime(rand(400, 460), t + 0.3);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1300;
      f.Q.value = 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.03, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      o.connect(f).connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.35);
      t += rand(0.45, 0.65);
    }
  }

  // Frogs: a run of low croaks from the water.
  #frogs() {
    const ctx = this.audio.ctx;
    const pan = this.#pan(rand(-1, 1));
    pan.connect(this.out);
    let t = ctx.currentTime + 0.05;
    for (let k = 0; k < 6 + Math.floor(Math.random() * 8); k++) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = rand(140, 200);
      const am = ctx.createOscillator();
      am.frequency.value = 38;
      const amg = ctx.createGain();
      amg.gain.value = 0.5;
      const g = ctx.createGain();
      g.gain.value = 0;
      am.connect(amg).connect(g.gain);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(0.03, t + 0.03);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(lp).connect(env).connect(pan);
      o.start(t);
      am.start(t);
      o.stop(t + 0.25);
      am.stop(t + 0.25);
      t += rand(0.25, 0.6);
    }
  }

  // An owl: "hoo ... hoo-hoo".
  #owl() {
    const ctx = this.audio.ctx;
    const pan = this.#pan(rand(-1, 1));
    pan.connect(this.out);
    pan.connect(this.echo);
    let t = ctx.currentTime + 0.05;
    for (const len of [0.5, 0.18, 0.45]) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(390, t);
      o.frequency.linearRampToValueAtTime(360, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.025, t + 0.06);
      g.gain.linearRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + len + 0.02);
      t += len + (len < 0.3 ? 0.08 : 0.35);
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
