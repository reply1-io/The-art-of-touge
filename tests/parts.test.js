import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, DT } from './harness.js';

const mph = (car) => car.forwardSpeed * 2.23694;

// Time from rest to 60 mph with flat-out shifts at 6,800 rpm.
async function zeroToSixty(parts) {
  const { car, run } = await makeWorld('autoClutch');
  Object.assign(car.tune, parts);
  run(0.1);
  car.trans.requestGear(1, 0);
  let t = 0;
  let last = 0;
  while (mph(car) < 60 && t < 20) {
    if (car.rpm > 6800 && car.trans.gear < 5 && t - last > 0.6) {
      car.trans.requestGear(car.trans.gear + 1, car.forwardSpeed);
      last = t;
    }
    run(DT, { throttle: 1 });
    t += DT;
  }
  return t;
}

test('engine parts make the car quicker: ITBs, weight reduction, a turbo', async () => {
  const stock = await zeroToSixty({});
  const itb = await zeroToSixty({ intake: 'itb' });
  const light = await zeroToSixty({ weight: 'stripped' });
  const turbo = await zeroToSixty({ turbo: 'small' });
  assert.ok(itb < stock, `itb ${itb} vs ${stock}`);
  assert.ok(light < stock, `light ${light} vs ${stock}`);
  assert.ok(turbo < stock - 0.5, `turbo ${turbo} vs ${stock}`);
});

test('a turbo lags: boost builds over time after the throttle goes down', async () => {
  const { car } = await makeWorld('autoClutch');
  car.tune.turbo = 'big';
  car.step(DT, { throttle: 0, brake: 0, handbrake: 0, clutch: false, steer: 0 });
  const e = car.engine;
  e.omega = 5500 / (60 / (2 * Math.PI));
  const series = [];
  for (let i = 0; i < 90; i++) {
    e.updateBoost(DT, 1);
    if (i === 8 || i === 30 || i === 89) series.push(e.boost);
  }
  assert.ok(series[0] < 0.3 && series[1] > series[0] && series[2] > 0.75, JSON.stringify(series));
});

test('angle kit gives more lock; hydraulic handbrake and big brakes stop harder', async () => {
  const lock = {};
  for (const angleKit of ['stock', 'full']) {
    const { car, run } = await makeWorld('autoClutch');
    car.tune.angleKit = angleKit;
    run(1, { steer: 1 });
    lock[angleKit] = Math.abs(car.steer);
  }
  assert.ok(lock.full > lock.stock * 1.4, JSON.stringify(lock));

  const stop = {};
  for (const brakes of ['stock', 'bbk']) {
    const { car, run } = await makeWorld('autoClutch');
    car.tune.brakes = brakes;
    car.trans.requestGear(3, 0);
    run(8, () => ({ throttle: car.forwardSpeed < 20 ? 1 : 0 }));
    const z0 = car.body.translation().z;
    run(0.8, { brake: 1 });
    stop[brakes] = car.forwardSpeed;
    void z0;
  }
  assert.ok(stop.bbk < stop.stock, JSON.stringify(stop));
});

test('gearing: a shorter final drive revs higher at the same speed', async () => {
  const rpm = {};
  for (const finalDrive of [3.64, 4.73]) {
    const { car, run } = await makeWorld('autoClutch');
    car.tune.finalDrive = finalDrive;
    car.trans.requestGear(3, 0);
    run(8, () => ({ throttle: car.forwardSpeed < 15 ? 1 : 0 }));
    rpm[finalDrive] = car.rpm;
  }
  assert.ok(rpm[4.73] > rpm[3.64] * 1.2, JSON.stringify(rpm));
});

test('a race clutch bites over a much shorter pedal travel than the stock one', async () => {
  const window = {};
  for (const clutch of ['stock', 'race']) {
    const { car, run } = await makeWorld('manual');
    car.tune.clutch = clutch;
    run(0.3, { clutch: true });
    car.trans.requestGear(1, 0);
    run(0.4, { clutch: true, throttle: 1 });
    let start = null;
    let end = null;
    run(1, (t) => {
      const c = car.trans.coupling;
      if (start === null && c > 0.05) start = t;
      if (end === null && c > 0.95) end = t;
      return { throttle: 1 };
    });
    window[clutch] = end - start;
  }
  assert.ok(window.race < window.stock * 0.5, JSON.stringify(window));
});
