import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, DT } from './harness.js';
import { DriftScore } from '../src/game/drift.js';
import { dynoRun } from '../src/physics/dyno.js';
import { TUNABLE_DEFAULTS } from '../src/config.js';

test('drift scoring: a held slide builds a chain that is banked when the car straightens', async () => {
  const { car, run } = await makeWorld('autoClutch');
  Object.assign(car.tune, { angleKit: 'kit' });
  const score = new DriftScore();
  car.trans.requestGear(2, 0);
  const tick = (input) => (t) => {
    score.update(DT, car, false);
    return typeof input === 'function' ? input(t) : input;
  };
  run(5, tick(() => ({ throttle: car.forwardSpeed < 16 ? 1 : 0 })));
  let peak = 0;
  run(2.5, tick((t) => {
    peak = Math.max(peak, score.display.chain);
    return { handbrake: t < 0.5 ? 1 : 0, steer: t < 1.2 ? -0.8 : 0.3, throttle: t > 0.4 ? 1 : 0 };
  }));
  run(4, tick({}));
  assert.ok(peak > 100, `chain reached ${peak}`);
  assert.ok(score.total > 100, `banked ${score.total}`);
});

test('drift scoring: hitting a rail loses the chain', async () => {
  const { car, run } = await makeWorld('autoClutch');
  const score = new DriftScore();
  car.trans.requestGear(2, 0);
  run(5, () => ({ throttle: car.forwardSpeed < 16 ? 1 : 0 }));
  run(1, (t) => {
    score.update(DT, car, false);
    return { handbrake: t < 0.5 ? 1 : 0, steer: -0.8, throttle: 1 };
  });
  assert.ok(score.display.chain > 0);
  score.update(DT, car, true);
  assert.equal(score.display.chain, 0);
  assert.equal(score.total, 0);
});

test('dyno: stock is about 136 hp; ITBs and turbos add power', () => {
  const stock = dynoRun(TUNABLE_DEFAULTS);
  assert.ok(Math.abs(stock.peakHp.hp - 136) < 6, `stock ${stock.peakHp.hp}`);
  const itb = dynoRun({ ...TUNABLE_DEFAULTS, intake: 'itb' });
  const big = dynoRun({ ...TUNABLE_DEFAULTS, turbo: 'big' });
  assert.ok(itb.peakHp.hp > stock.peakHp.hp * 1.05 && big.peakHp.hp > stock.peakHp.hp * 1.8, `${itb.peakHp.hp} ${big.peakHp.hp}`);
});
