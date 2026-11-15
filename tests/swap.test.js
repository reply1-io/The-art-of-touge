import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_SWAPS } from '../src/config.js';

test('engine swaps: every swap lists its specs and the car it comes from; the rotary can be fitted', () => {
  for (const [id, sw] of Object.entries(ENGINE_SWAPS)) {
    for (const k of ['name', 'donor', 'layout', 'displacement', 'aspiration', 'hp', 'hpRpm', 'nm', 'nmRpm', 'redline', 'kg', 'blurb']) assert.ok(sw[k], `${id} has ${k}`);
    if (sw.ready) assert.ok(sw.engine?.torqueCurve?.length, `${id} has an engine model`);
  }
  const r = ENGINE_SWAPS.rotary;
  assert.ok(r.ready);
  // The torque curve matches the card: peak power within 5% of what the card says.
  let best = 0;
  for (let rpm = 1000; rpm <= r.engine.limiterRpm; rpm += 50) {
    const c = r.engine.torqueCurve;
    let k = 1;
    while (k < c.length - 1 && c[k][0] < rpm) k++;
    const [x0, y0] = c[k - 1];
    const [x1, y1] = c[k];
    best = Math.max(best, ((y0 + ((y1 - y0) * (rpm - x0)) / (x1 - x0)) * rpm) / 7121);
  }
  assert.ok(Math.abs(best - r.hp) / r.hp < 0.05, `peak ${best.toFixed(0)} hp vs ${r.hp}`);
  for (const id of ['1jz', '4age', 'ls3', 'k24', 'm50', 'sr20']) assert.ok(ENGINE_SWAPS[id], `${id} listed`);
});
