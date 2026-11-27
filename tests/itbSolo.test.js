import { test } from 'node:test';
import assert from 'node:assert/strict';
import { M20Dsp } from '../src/audio/m20-dsp.js';

function render(engine, rpm, throttle, extra = {}) {
  const d = new M20Dsp(48000);
  d.set({ engine, intake: 'itb', ...extra }); d.command('direct'); d.set({ rpm, throttle });
  const y = new Float32Array(48000);
  for (let i = 0; i < y.length; i += 128) d.process(y.subarray(i, i + 128));
  return y.subarray(24000);
}
const db = (y) => 10 * Math.log10(y.reduce((s, v) => s + v * v, 0) / y.length + 1e-20);

test('ITBs on their own: both the six and the four play, stay finite and out of the limiter', () => {
  for (const eng of ['m20', 'itb4']) {
    for (const [rpm, thr] of [[900, 0], [3000, 0.5], [7000, 1]]) {
      const y = render(eng, rpm, thr, { solo: 'itb' });
      assert.ok(y.every(Number.isFinite), `${eng} ${rpm} finite`);
      assert.ok(db(y) > -40, `${eng} at ${rpm} rpm is heard (${db(y).toFixed(1)} dB)`);
      assert.ok(y.filter((v) => Math.abs(v) > 0.9).length / y.length < 0.01, `${eng} at ${rpm} rpm mostly under the limiter`);
    }
  }
});

test('solo takes the exhaust out: without ITBs fitted the solo flag changes nothing', () => {
  const d1 = render('m20', 3000, 0.5, { intake: 'stock', solo: 'itb' }), d2 = render('m20', 3000, 0.5, { intake: 'stock' });
  assert.ok(Math.abs(db(d1) - db(d2)) < 1.5, 'stock intake ignores solo');
});

// how much of the sound is in a band (dB of the total), from a plain DFT on a few bins per band
function bandShare(y, lo, hi) {
  const N = 4096, x = y.subarray(0, N); let inB = 0, all = 0;
  for (let k = 1; k < N / 2; k += 2) {
    let re = 0, im = 0; const w = (2 * Math.PI * k) / N;
    for (let i = 0; i < N; i++) { const v = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); re += v * Math.cos(w * i); im -= v * Math.sin(w * i); }
    const p = re * re + im * im, f = (k * 48000) / N; all += p; if (f >= lo && f < hi) inB += p;
  }
  return 10 * Math.log10(inB / all);
}

test('ITBs on their own, off the throttle: a breathy hiss, not a low hum (mic over the trumpets)', () => {
  for (const eng of ['m20', 'itb4']) {
    const idle = render(eng, eng === 'm20' ? 900 : 950, 0, { solo: 'itb' });
    assert.ok(bandShare(idle, 400, 6000) > bandShare(idle, 20, 150) + 3, `${eng}: more 400 Hz-6 kHz breath than low hum at idle`);
    assert.ok(bandShare(idle, 6000, 14000) > -25, `${eng}: air on top stays audible at idle`);
  }
});
