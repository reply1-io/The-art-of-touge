// Synthesised sound: engine (follows rpm and load), tyre squeal (follows slip), wall thumps.
// Must be started from a user gesture (browser autoplay rules).

export class CarAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(ctx.destination);

    // Engine: two detuned saws at the firing frequency plus a sub-octave square, through a low-pass.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 2.5;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.oscs = [];
    for (const [type, mult, gain] of [
      ['sawtooth', 1, 0.5],
      ['sawtooth', 1.007, 0.35],
      ['square', 0.5, 0.35],
      ['triangle', 2, 0.15],
    ]) {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(this.engineFilter);
      o.start();
      this.oscs.push({ o, mult });
    }

    // Shared noise buffer.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    // Intake/exhaust breath on throttle.
    const breath = ctx.createBufferSource();
    breath.buffer = buf;
    breath.loop = true;
    this.breathFilter = ctx.createBiquadFilter();
    this.breathFilter.type = 'bandpass';
    this.breathFilter.Q.value = 1.2;
    this.breathGain = ctx.createGain();
    this.breathGain.gain.value = 0;
    breath.connect(this.breathFilter).connect(this.breathGain).connect(this.master);
    breath.start();

    // Tyre squeal.
    const squeal = ctx.createBufferSource();
    squeal.buffer = buf;
    squeal.loop = true;
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.value = 950;
    this.squealFilter.Q.value = 9;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    squeal.connect(this.squealFilter).connect(this.squealGain).connect(this.master);
    squeal.start();

    // Gravel/road rumble.
    const rumble = ctx.createBufferSource();
    rumble.buffer = buf;
    rumble.loop = true;
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.value = 180;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumble.connect(this.rumbleFilter).connect(this.rumbleGain).connect(this.master);
    rumble.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  suspend() {
    this.ctx?.suspend?.();
  }

  resume() {
    this.ctx?.resume?.();
  }

  thump(strength) {
    if (!this.ctx || strength < 0.8) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(Math.min(1, strength / 8), now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    src.connect(f).connect(g).connect(this.master);
    src.start(now, Math.random());
    src.stop(now + 0.4);
  }

  update(car) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = Math.max(600, car.rpm);
    const fire = (rpm / 60) * 2; // 4-cylinder: two firings per revolution
    for (const { o, mult } of this.oscs) o.frequency.setTargetAtTime(fire * mult, t, 0.015);
    const load = car.throttleApplied;
    this.engineFilter.frequency.setTargetAtTime(300 + load * 1800 + rpm * 0.25, t, 0.03);
    this.engineGain.gain.setTargetAtTime(0.1 + load * 0.16 + (rpm / 8000) * 0.06, t, 0.03);
    this.breathFilter.frequency.setTargetAtTime(fire * 3, t, 0.03);
    this.breathGain.gain.setTargetAtTime(load * 0.07 * (rpm / 7000), t, 0.05);

    let slip = 0;
    let gravel = 0;
    for (const w of car.wheels) {
      const lat = Math.max(0, Math.abs(Math.tan(w.slipAngle)) - 0.12);
      const lon = Math.max(0, Math.abs(w.slipRatio) - 0.14);
      const amount = Math.min(1, (lat * 2.5 + lon * 1.5) * (w.load / 2600));
      slip += w.surface ? 0 : amount;
      gravel += w.surface ? 1 : 0;
    }
    const speed = car.speed;
    const squeal = speed > 2 ? Math.min(1, slip / 2) : 0;
    this.squealGain.gain.setTargetAtTime(squeal * 0.22, t, 0.04);
    this.squealFilter.frequency.setTargetAtTime(850 + squeal * 300 + Math.sin(t * 13) * 40, t, 0.05);
    this.rumbleGain.gain.setTargetAtTime(Math.min(1, speed / 30) * (0.05 + gravel * 0.08), t, 0.1);
  }
}
