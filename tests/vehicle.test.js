import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, DT } from './harness.js';

const mph = (car) => car.forwardSpeed * 2.23694;

test('settles level on its springs and idles in neutral', async () => {
  const { car, run } = await makeWorld('manual');
  run(2);
  const p = car.body.translation();
  assert.ok(Math.abs(p.y - 0.62) < 0.05, `ride height ${p.y}`);
  assert.ok(Math.abs(p.x) < 0.01 && Math.abs(p.z) < 0.05, 'does not creep');
  assert.ok(car.rpm > 700 && car.rpm < 950, `idle ${car.rpm}`);
  const loads = car.wheels.map((w) => w.load);
  assert.ok(loads[0] > loads[2], 'slightly nose-heavy like the real car');
});

test('full manual: no clutch means a grind, clutch in selects the gear', async () => {
  const { car, run } = await makeWorld('manual');
  run(0.5);
  assert.equal(car.trans.requestGear(1, 0), false);
  assert.equal(car.trans.gear, 0);
  run(0.3, { clutch: true });
  assert.equal(car.trans.requestGear(1, 0), true);
  assert.equal(car.trans.gear, 1);
});

test('full manual: dropping the clutch at idle stalls; START with the clutch in restarts', async () => {
  const { car, run } = await makeWorld('manual');
  run(0.3, { clutch: true });
  car.trans.requestGear(1, 0);
  run(1.5, { clutch: false });
  assert.equal(car.engine.running, false);
  run(0.3, { clutch: true });
  car.engine.start();
  run(0.5, { clutch: true });
  assert.equal(car.engine.running, true);
});

test('full manual: revs and a clutch release launch the car without stalling', async () => {
  const { car, run } = await makeWorld('manual');
  run(0.3, { clutch: true });
  car.trans.requestGear(1, 0);
  run(0.6, { clutch: true, throttle: 1 });
  run(3, { throttle: 1 });
  assert.equal(car.engine.running, true);
  assert.ok(mph(car) > 18, `speed ${mph(car)}`);
});

test('rev limiter holds the engine near 7,000 rpm', async () => {
  const { car, run } = await makeWorld('manual');
  let max = 0;
  run(2, (t) => {
    max = Math.max(max, car.rpm);
    return { throttle: 1 };
  });
  assert.ok(max > 6800 && max < 7400, `max rpm ${max}`);
});

test('0-60 mph in roughly the real car time and a believable top speed', async () => {
  const { car, run } = await makeWorld('autoClutch');
  car.trans.requestGear(1, 0);
  let t = 0;
  let t60 = null;
  let lastShift = 0;
  while (t < 45) {
    if (car.rpm > 6800 && car.trans.gear < 5 && t - lastShift > 0.6) {
      car.trans.requestGear(car.trans.gear + 1, car.forwardSpeed);
      lastShift = t;
    }
    run(DT, { throttle: 1 });
    t += DT;
    if (t60 === null && mph(car) >= 60) t60 = t;
  }
  assert.ok(t60 > 7 && t60 < 10.5, `0-60 ${t60}`);
  assert.ok(mph(car) > 110 && mph(car) < 135, `top ${mph(car)}`);
});

test('engine braking slows the car in gear with the throttle closed', async () => {
  const { car, run } = await makeWorld('autoClutch');
  car.trans.requestGear(2, 0);
  run(4, { throttle: 1 });
  const v0 = car.forwardSpeed;
  run(2, {});
  assert.ok(car.forwardSpeed < v0 - 1.5, `${v0} -> ${car.forwardSpeed}`);
});

test('brakes stop the car from 60 mph in a sensible distance', async () => {
  const { car, run } = await makeWorld('autoClutch');
  car.trans.requestGear(1, 0);
  let t = 0;
  let lastShift = 0;
  while (mph(car) < 60 && t < 20) {
    if (car.rpm > 6800 && car.trans.gear < 5 && t - lastShift > 0.6) {
      car.trans.requestGear(car.trans.gear + 1, car.forwardSpeed);
      lastShift = t;
    }
    run(DT, { throttle: 1 });
    t += DT;
  }
  const z0 = car.body.translation().z;
  run(6, { brake: 1 });
  const feet = (car.body.translation().z - z0) * 3.281;
  assert.ok(car.speed < 0.5);
  assert.ok(feet > 110 && feet < 190, `60-0 ${feet} ft`);
});

test('corners at a believable lateral g with body roll, and stays upright', async () => {
  const { car, run } = await makeWorld('autoClutch');
  car.trans.requestGear(2, 0);
  run(6, () => ({ throttle: car.forwardSpeed < 17.8 ? 1 : 0 }));
  run(4, () => ({ throttle: car.forwardSpeed < 17.8 ? 0.6 : 0, steer: -0.5 }));
  const yawRate = car.body.angvel().y;
  const g = (car.speed * Math.abs(yawRate)) / 9.81;
  assert.ok(g > 0.6 && g < 1.05, `lateral g ${g}`);
  const q = car.body.rotation();
  const up = 1 - 2 * (q.x * q.x + q.z * q.z);
  assert.ok(up > 0.98, 'upright');
});

test('handbrake and throttle swing the rear out: drifts come out of the physics', async () => {
  const { car, run } = await makeWorld('autoClutch');
  car.trans.requestGear(2, 0);
  run(5, () => ({ throttle: car.forwardSpeed < 16 ? 1 : 0 }));
  let maxSlide = 0;
  run(2, (t) => {
    maxSlide = Math.max(maxSlide, Math.abs(car.slideAngle));
    return { handbrake: t < 0.6 ? 1 : 0, steer: -0.7, throttle: t > 0.6 ? 1 : 0 };
  });
  assert.ok(maxSlide > (30 * Math.PI) / 180, `slide ${(maxSlide * 180) / Math.PI} deg`);
});

test('full automatic upshifts on its own and selects reverse only at a stop', async () => {
  const { car, run } = await makeWorld('auto');
  car.trans.setDrive('D', 0);
  run(12, { throttle: 1 });
  assert.ok(car.trans.gear >= 3, `gear ${car.trans.label}`);
  car.trans.setDrive('R', car.forwardSpeed);
  assert.notEqual(car.trans.drive, 'R');
  const fresh = (await makeWorld('auto')).car;
  fresh.trans.setDrive('R', 0);
  assert.equal(fresh.trans.label, 'R');
});

test('assisted modes never stall', async () => {
  for (const mode of ['autoClutch', 'auto']) {
    const { car, run } = await makeWorld(mode);
    if (mode === 'auto') car.trans.setDrive('D', 0);
    else car.trans.requestGear(3, 0);
    run(3, { brake: 1 });
    run(2, { throttle: 0.3 });
    assert.equal(car.engine.running, true, mode);
  }
});
