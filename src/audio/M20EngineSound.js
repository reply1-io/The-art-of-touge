// M20EngineSound - procedural E30 325i (BMW M20B25 straight-six) engine audio.
// No samples: the sound is synthesized by M20Dsp (m20-dsp.js).
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
// Where it runs: an AudioWorklet built from the DSP code in memory (no extra file
// to fetch, so it also works in sandboxed pages), or, if the browser refuses that,
// a ScriptProcessor on the main thread. `engine.backend` says which.
//
// Browser rule: create/resume the AudioContext inside the click/tap handler,
// before any await, or phones keep it silent.

import { M20Dsp, Biquad, Delay, randn, crankRpm, CRANK_SECONDS, IDLE_RPM, FIRING, TAU } from './m20-dsp.js';
export { crankRpm, CRANK_SECONDS, IDLE_RPM };

function workletSource(dspSource) {
  // Best: the original m20-dsp.js text (bundlers rename things when minifying, which breaks
  // rebuilding it from function text). Otherwise rebuild it from the live classes.
  const dsp = dspSource
    ? dspSource.replace(/^export /gm, '')
    : [
        `const TAU = ${TAU};`,
        `const FIRING = ${JSON.stringify(FIRING)};`,
        `const IDLE_RPM = ${IDLE_RPM};`,
        `const CRANK_SECONDS = ${CRANK_SECONDS};`,
        randn, crankRpm, Biquad, Delay, M20Dsp,
      ].map(String).join('\n');
  return [
    dsp,
    `class M20Processor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.d = new M20Dsp(sampleRate);
        this.d.onCycle = (s) => this.port.postMessage({ cycle: s }, [s.buffer]);
        this.port.onmessage = (e) => {
          const m = e.data;
          if (m.set) this.d.set(m.set);
          if (m.cmd) this.d.command(m.cmd);
        };
      }
      process(_i, outputs) { this.d.process(outputs[0][0]); return true; }
    }
    registerProcessor('m20-engine', M20Processor);`,
  ].map(String).join('\n');
}

const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

export class M20EngineSound {
  /**
   * @param {AudioContext} ctx
   * @param {{ dspSource?: string }} [opts] dspSource: the text of m20-dsp.js. Pass it when the
   *   code is minified by a bundler (with Vite: import dspSource from './m20-dsp.js?raw').
   */
  static async create(ctx, { dspSource } = {}) {
    const e = new M20EngineSound(ctx);
    if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        const url = URL.createObjectURL(new Blob([workletSource(dspSource)], { type: 'text/javascript' }));
        await timeout(ctx.audioWorklet.addModule(url), 4000);
        const node = new AudioWorkletNode(ctx, 'm20-engine', {
          numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
        });
        node.port.onmessage = (m) => { if (m.data.cycle) e.onCycle?.(m.data.cycle); };
        e._send = (m) => node.port.postMessage(m);
        e.node = node;
        e.backend = 'worklet';
      } catch (err) {
        e.workletError = err;
      }
    }
    if (!e.node) {
      const dsp = new M20Dsp(ctx.sampleRate);
      dsp.onCycle = (s) => e.onCycle?.(s);
      const node = ctx.createScriptProcessor(1024, 1, 1);
      node.onaudioprocess = (ev) => dsp.process(ev.outputBuffer.getChannelData(0));
      e._send = (m) => { if (m.set) dsp.set(m.set); if (m.cmd) dsp.command(m.cmd); };
      e.node = node;
      e.backend = 'main-thread';
    }
    e.node.connect(e.output);
    return e;
  }

  constructor(ctx) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    this.cranking = false;
    this.running = false;
    this.onCycle = null; // (Float32Array: one engine cycle of output) => void
  }

  connect(dest) { this.output.connect(dest); return this; }
  disconnect() { this.output.disconnect(); }

  setRpm(rpm) { if (!this.cranking) this._send({ set: { rpm } }); }
  setThrottle(t) { this._send({ set: { throttle: Math.min(1, Math.max(0, t)) } }); }
  setExhaust(x) { this._send({ set: { exhaust: x } }); }

  start() {
    this.running = true;
    this._send({ cmd: 'start' });
    this._fade(1, 0.2);
  }

  /** Starter motor, catch, flare, settle to idle. Resolves when it is idling. */
  startWithCrank() {
    this.cranking = true;
    this.running = true;
    this._send({ cmd: 'crank' });
    this._fade(1, 0.05);
    return new Promise((res) => setTimeout(() => { this.cranking = false; res(); }, (CRANK_SECONDS + 0.05) * 1000));
  }

  /**
   * Let your own engine model drive everything: call this once, then every frame
   * engine.setState({ rpm, throttle, ignition: running ? 1 : 0, starter: cranking ? 1 : 0 }).
   * Stalls, run-downs and restarts then sound right without the built-in scripts.
   */
  direct({ idleRpm = IDLE_RPM } = {}) {
    this.running = true;
    this._send({ set: { idleRpm } });
    this._send({ cmd: 'direct' });
    this._fade(1, 0.05);
  }

  setState(v) { this._send({ set: v }); }

  /** Key off: ignition cut, engine runs down and stops. */
  stop() {
    this.running = false;
    this._send({ cmd: 'stop' });
    this._fade(0, 1.2);
  }

  _fade(v, s) {
    const g = this.output.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(v, now + s);
  }
}
