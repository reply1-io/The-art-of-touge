import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './harness.js';

async function cornering(tire) {
  const { car, run } = await makeWorld('autoClutch');
  Object.assign(car.tune, { tire });
  car.trans.requestGear(2, 0);
  run(6, () => ({ throttle: car.forwardSpeed < 14 ? 1 : 0 }));
  let maxG = 0;
  run(4, (t) => {
    if (Math.abs(car.slideAngle) < 0.25) maxG = Math.max(maxG, car.wheels.reduce((a, w) => a + Math.abs(w.fy), 0) / (1100 * 9.81));
    return { throttle: car.forwardSpeed < 14 ? 1 : 0, steer: -Math.min(1, t / 3) };
  });
  return maxG;
}

test('tyre compounds rank by grip: stock < drift < street < semi-slick', async () => {
  const g = {};
  for (const t of ['stock', 'drift', 'street', 'semi']) g[t] = await cornering(t);
  assert.ok(g.stock < g.drift && g.drift < g.street && g.street < g.semi, JSON.stringify(g));
});

test('semi-slicks lose far more grip on grass than on asphalt', async () => {
  const { car, run } = await makeWorld('autoClutch');
  Object.assign(car.tune, { tire: 'semi' });
  run(1);
  car.surfaceOf = () => 'grass';
  run(0.1);
  const grass = car.wheels[0].mu;
  car.surfaceOf = () => 'asphalt';
  run(0.1);
  assert.ok(grass < car.wheels[0].mu * 0.5, `grass ${grass} vs asphalt ${car.wheels[0].mu}`);
});

test('differentials: open lets the inside rear spin, LSD and welded keep the rears together', async () => {
  const spread = {};
  for (const diff of ['open', 'lsd', 'welded']) {
    const { car, run } = await makeWorld('autoClutch');
    Object.assign(car.tune, { tire: 'street', diff });
    car.trans.requestGear(1, 0);
    run(4, () => ({ throttle: car.forwardSpeed < 7 ? 1 : 0 }));
    let d = 0;
    run(2, () => {
      d = Math.max(d, Math.abs(car.wheels[2].omega - car.wheels[3].omega));
      return { throttle: 1, steer: -1 };
    });
    spread[diff] = d;
  }
  assert.ok(spread.open > 10 * Math.max(spread.lsd, 0.5), JSON.stringify(spread));
  assert.ok(spread.welded < 0.01, JSON.stringify(spread));
});

test('ride height raises and lowers the car', async () => {
  const heights = {};
  for (const rh of [-50, 0, 30]) {
    const { car, run } = await makeWorld('manual');
    car.tune.rideHeight = rh;
    run(2);
    heights[rh] = car.body.translation().y;
  }
  assert.ok(heights[-50] < heights[0] - 0.04 && heights[30] > heights[0] + 0.02, JSON.stringify(heights));
});

test('brake bias moves braking between the axles', async () => {
  const rearForce = async (bias) => {
    const { car, run } = await makeWorld('autoClutch');
    car.tune.brakeBias = bias;
    car.trans.requestGear(2, 0);
    run(4, () => ({ throttle: car.forwardSpeed < 12 ? 1 : 0 }));
    let f = 0;
    let r = 0;
    run(0.4, () => {
      f += -car.wheels[0].fx - car.wheels[1].fx;
      r += -car.wheels[2].fx - car.wheels[3].fx;
      return { brake: 1 };
    });
    void f;
    return r;
  };
  // Front braking is limited by front grip, so compare what the rear axle does.
  assert.ok((await rearForce(0.5)) > (await rearForce(0.8)) * 1.3);
});
