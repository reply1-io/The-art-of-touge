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

test('rev limiter holds the engine near 6,500 rpm', async () => {
  const { car, run } = await makeWorld('manual');
  let max = 0;
  run(2, (t) => {
    max = Math.max(max, car.rpm);
    return { throttle: 1 };
  });
  assert.ok(max > 6400 && max < 6900, `max rpm ${max}`);
});

test('0-60 mph in roughly the real car time and a believable top speed', async () => {
  const { car, run } = await makeWorld('autoClutch');
  car.trans.requestGear(1, 0);
  let t = 0;
  let t60 = null;
  let lastShift = 0;
  while (t < 45) {
    if (car.rpm > 6300 && car.trans.gear < 5 && t - lastShift > 0.6) {
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
  assert.ok(car.forwardSpeed < v0 - 1.2, `${v0} -> ${car.forwardSpeed}`);
});

test('brakes stop the car from 60 mph in a sensible distance', async () => {
  const { car, run } = await makeWorld('autoClutch');
  car.trans.requestGear(1, 0);
  let t = 0;
  let lastShift = 0;
  while (mph(car) < 60 && t < 20) {
    if (car.rpm > 6300 && car.trans.gear < 5 && t - lastShift > 0.6) {
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
  car.trans.requestGear(3, 0);
  run(8, () => ({ throttle: car.forwardSpeed < 17.8 ? 1 : 0 }));
  // On/off throttle like the touch button, just enough to hold about 40 mph.
  run(4, () => ({ throttle: car.forwardSpeed < 17.5 ? 1 : 0, steer: -0.45 }));
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

test('stalling only happens when pulling away, never while driving', async () => {
  const { car, run } = await makeWorld('manual');
  run(0.3, { clutch: true });
  car.trans.requestGear(1, 0);
  run(0.6, { clutch: true, throttle: 1 });
  run(3, { throttle: 1 });
  run(0.3, { clutch: true });
  car.trans.requestGear(4, car.forwardSpeed); // lug it in 4th at low speed with the clutch out
  run(2.5, {});
  assert.equal(car.engine.running, true, 'rolling: the engine bogs but does not die');
});

test('a slide recovers when you let go of everything (caster self-steer)', async () => {
  const { car, run } = await makeWorld('autoClutch');
  car.trans.requestGear(2, 0);
  run(5, () => ({ throttle: car.forwardSpeed < 15 ? 1 : 0 }));
  run(1.5, (t) => ({ handbrake: t < 0.45 ? 1 : 0, steer: -0.8, throttle: t > 0.45 && t < 1.3 ? 1 : 0 }));
  run(2.5, {});
  assert.ok(Math.abs(car.slideAngle) < 0.15, `still sliding ${(car.slideAngle * 180) / Math.PI} deg`);
  assert.ok(Math.abs(car.body.angvel().y) < 0.3, 'not spinning');
});

test('ABS keeps the wheels turning and the car steerable under full braking', async () => {
  const { car, run } = await makeWorld('autoClutch');
  car.trans.requestGear(3, 0);
  run(8, () => ({ throttle: car.forwardSpeed < 22 ? 1 : 0 }));
  let locked = 0;
  const yaw0 = car.body.rotation();
  run(1.5, () => {
    for (const w of car.wheels.slice(0, 2)) if (car.speed > 5 && Math.abs(w.omega) < 1) locked++;
    return { brake: 1, steer: -0.6 };
  });
  assert.equal(locked, 0, 'front wheels never lock');
  const q = car.body.rotation();
  const turned = Math.abs(2 * Math.asin(q.y) - 2 * Math.asin(yaw0.y));
  assert.ok(turned > 0.15, `car turned ${turned} rad while braking`);
});

test('turns in properly: full lock at speed uses the front tyres instead of ploughing', async () => {
  const { car, run } = await makeWorld('autoClutch');
  car.trans.requestGear(3, 0);
  run(14, () => ({ throttle: car.forwardSpeed < 35 / 2.237 ? 1 : 0 }));
  let prev = null;
  let sum = 0;
  let n = 0;
  run(2, (t) => {
    const lv = car.body.linvel();
    const course = Math.atan2(lv.x, lv.z);
    if (prev !== null && t > 0.6) {
      let d = course - prev;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      sum += (car.speed * Math.abs(d * 60)) / 9.81;
      n++;
    }
    prev = course;
    return { steer: -1 };
  });
  assert.ok(sum / n > 0.82, `cornering ${sum / n} g`);
  assert.ok(Math.abs(car.wheels[0].slipAngle) < 0.3, `front slip ${car.wheels[0].slipAngle} rad`);
});
