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
