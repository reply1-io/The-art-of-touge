// M20EngineSound - procedural E30 325i (BMW M20B25 straight-six) engine audio.
// No samples: the sound is synthesized in an AudioWorklet (m20-worklet.js).
//
//   const engine = await M20EngineSound.create(audioCtx);
//   engine.connect(audioCtx.destination);
//   await engine.startWithCrank();   // or engine.start()
//   // every frame from your car sim:
//   engine.setRpm(car.rpm);
//   engine.setThrottle(car.throttle);  // 0..1; 0 above idle = overrun (fuel cut)
//   engine.setExhaust(0);              // 0 stock, 1 sport
//   engine.stop();
//
// The rev limiter, gears etc. belong to your car sim: cut the throttle to 0 when
// it hits the limiter and the engine will sound like it.

export const IDLE_RPM = 800;

/** rpm the engine follows during startWithCrank(), t in seconds since the call. */
export function crankRpm(t) {
  if (t < 0.15) return 260 * (t / 0.15);
  if (t < 1.0) return 250;                        // starter turning it over
  if (t < 1.25) return 250 + (1450 - 250) * ((t - 1.0) / 0.25); // catches, flares
  return IDLE_RPM + (1450 - IDLE_RPM) * Math.exp(-(t - 1.25) / 0.45);
}
export const CRANK_SECONDS = 2.6;

export class M20EngineSound {
  static async create(ctx, { workletUrl = new URL('./m20-worklet.js', import.meta.url) } = {}) {
    await ctx.audioWorklet.addModule(workletUrl);
    return new M20EngineSound(ctx);
  }

  constructor(ctx) {
    this.ctx = ctx;
    this.node = new AudioWorkletNode(ctx, 'm20-engine', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
    });
    this.p = (name) => this.node.parameters.get(name);
    this.p('idleRpm').value = IDLE_RPM;
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    this.node.connect(this.output);
    this.cranking = false;
    this.running = false;
    this.onCycle = null; // (Float32Array one engine cycle of output) => void
    this.node.port.onmessage = (e) => this.onCycle?.(e.data);
  }

  connect(dest) { this.output.connect(dest); return this; }
  disconnect() { this.output.disconnect(); }

  setRpm(rpm) { if (!this.cranking) this._set('rpm', rpm, 0.015); }
  setThrottle(t) { this._set('throttle', Math.min(1, Math.max(0, t)), 0.01); }
  setExhaust(x) { this._set('exhaust', x, 0.1); }

  start() {
    const now = this.ctx.currentTime;
    this.running = true;
    this.p('ignition').setValueAtTime(1, now);
    this.p('starter').setValueAtTime(0, now);
    this.p('rpm').setValueAtTime(IDLE_RPM, now);
    this._fade(1, 0.2);
  }

  /** Starter motor, catch, flare, settle to idle. Resolves when it is idling. */
  startWithCrank() {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.02;
    this.cranking = true;
    this.running = true;
    const n = 256, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = crankRpm((i / (n - 1)) * CRANK_SECONDS);
    const rpm = this.p('rpm');
    rpm.cancelScheduledValues(t0);
    rpm.setValueCurveAtTime(curve, t0, CRANK_SECONDS);
    this.p('starter').setValueAtTime(1, t0);
    this.p('starter').setValueAtTime(0, t0 + 1.05);
    this.p('ignition').setValueAtTime(0, t0);
    this.p('ignition').setValueAtTime(1, t0 + 0.95);
    this.p('throttle').setValueAtTime(0, t0);
    this._fade(1, 0.05);
    return new Promise((res) => setTimeout(() => {
      this.cranking = false;
      res();
    }, (CRANK_SECONDS + 0.05) * 1000));
  }

  /** Key off: ignition cut, engine runs down and stops. */
  stop() {
    const now = this.ctx.currentTime;
    this.running = false;
    this.p('ignition').setValueAtTime(0, now);
    this.p('throttle').setValueAtTime(0, now);
    const rpm = this.p('rpm');
    rpm.cancelScheduledValues(now);
    rpm.setValueAtTime(rpm.value, now);
    rpm.linearRampToValueAtTime(0, now + 0.9);
    this._fade(0, 1.2);
  }

  _set(name, v, tc) {
    const now = this.ctx.currentTime;
    this.p(name).setTargetAtTime(v, now, tc);
  }

  _fade(v, s) {
    const g = this.output.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(v, now + s);
  }
}
