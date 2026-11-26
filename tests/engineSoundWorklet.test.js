import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workletSource } from '../src/audio/M20EngineSound.js';
import { ENGINES } from '../src/audio/m20-dsp.js';

// The engine synth runs on the audio thread from code rebuilt as text. If that text misses
// anything the synth uses, the audio thread throws and the page goes silent, with no error on
// the page itself. Run both ways of building it, on every engine, with every part fitted.
function run(src, set) {
  let Proc;
  class AudioWorkletProcessor { constructor() { this.port = { postMessage() {}, onmessage: null }; } }
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', src)(AudioWorkletProcessor, (_n, C) => { Proc = C; }, 48000);
  const p = new Proc();
  p.port.onmessage({ data: { set } });
  p.port.onmessage({ data: { cmd: 'start' } });
  const out = [[new Float32Array(128)]];
  let s = 0;
  for (let i = 0; i < 400; i++) { p.process([], out); for (const v of out[0][0]) s += v * v; }
  return s;
}

const raw = readFileSync(new URL('../src/audio/m20-dsp.js', import.meta.url), 'utf8');
for (const [how, src] of [['rebuilt from the live classes', workletSource()], ['from the source text', workletSource(raw)]]) {
  test(`engine synth on the audio thread (${how}) makes sound with every engine and part`, () => {
    for (const engine of Object.keys(ENGINES)) {
      for (const parts of [{}, { intake: 'itb' }, { exhaust: 'race', turbo: 1 }]) {
        const energy = run(src, { engine, idleRpm: ENGINES[engine].idleRpm, rpm: 4000, throttle: 1, ...parts });
        assert.ok(Number.isFinite(energy) && energy > 0, `${engine} ${JSON.stringify(parts)}`);
      }
    }
  });
}
