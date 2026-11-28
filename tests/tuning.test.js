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
    if (Math.abs(car.slideAngle) < 0.25) maxG = Math.max(maxG, car.wheels.reduce((a, w) => a + Math.abs(w.fy), 0) / (1230 * 9.81));
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
    car.tune.coilovers = true;
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

async function corneringWith(setup) {
  const { car, run } = await makeWorld('autoClutch');
  Object.assign(car.tune, setup);
  car.trans.requestGear(2, 0);
  run(6, () => ({ throttle: car.forwardSpeed < 14 ? 1 : 0 }));
  let maxG = 0;
  run(4, (t) => {
    if (Math.abs(car.slideAngle) < 0.25) maxG = Math.max(maxG, car.wheels.reduce((a, w) => a + Math.abs(w.fy), 0) / (1230 * 9.81));
    return { throttle: car.forwardSpeed < 14 ? 1 : 0, steer: -Math.min(1, t / 3) };
  });
  return maxG;
}

test('camber: a few degrees adds cornering grip, far too much takes it away', async () => {
  const zero = await corneringWith({ camberFront: 0, camberRear: 0 });
  const three = await corneringWith({ camberFront: 3, camberRear: 2 });
  const six = await corneringWith({ camberFront: 6, camberRear: 6 });
  assert.ok(three > zero, `0: ${zero}, 3: ${three}`);
  assert.ok(six < three, `3: ${three}, 6: ${six}`);
});

test('wheel and sidewall sizes change the rolling radius, so the car sits higher or lower', async () => {
  const y = {};
  for (const [rim, profile] of [[14, 65], [17, 35], [15, 75]]) {
    const { car, run } = await makeWorld('manual');
    Object.assign(car.tune, { rim, profile });
    run(2);
    y[`${rim}/${profile}`] = car.body.translation().y;
  }
  assert.ok(y['15/75'] > y['14/65'] + 0.02 && y['17/35'] < y['14/65'] - 0.005, JSON.stringify(y));
});

test('sway bars and strut braces: stiffer bars cut body roll', async () => {
  const roll = {};
  for (const [name, f, r] of [['soft', 7000, 0], ['race', 32000, 22000]]) {
    const { car, run } = await makeWorld('autoClutch');
    Object.assign(car.tune, { antiRollFront: f, antiRollRear: r, strutFront: name === 'race', strutRear: name === 'race' });
    car.trans.requestGear(2, 0);
    run(6, () => ({ throttle: car.forwardSpeed < 14 ? 1 : 0 }));
    run(2.5, () => ({ throttle: car.forwardSpeed < 14 ? 1 : 0, steer: -0.5 }));
    const q = car.body.rotation();
    roll[name] = Math.abs(2 * (q.w * q.z + q.x * q.y));
  }
  assert.ok(roll.race < roll.soft * 0.8, JSON.stringify(roll));
});

test('slammed: -200 mm sits about 20 cm lower and still drives and corners', async () => {
  const y = {};
  for (const rh of [0, -200]) {
    const { car, run } = await makeWorld('autoClutch');
    car.tune.rideHeight = rh;
    car.tune.coilovers = true;
    run(2);
    y[rh] = car.body.translation().y;
    car.trans.requestGear(3, 0);
    run(8, () => ({ throttle: car.forwardSpeed < 17 ? 1 : 0 }));
    run(3, () => ({ throttle: car.forwardSpeed < 17 ? 1 : 0, steer: -0.5 }));
    const q = car.body.rotation();
    assert.ok(1 - 2 * (q.x * q.x + q.z * q.z) > 0.97, `upright at ${rh}`);
    assert.ok(car.speed > 12, `still moving at ${rh}: ${car.speed}`);
  }
  assert.ok(y[0] - y[-200] > 0.15, JSON.stringify(y));
});

test('stretched tyres: narrower, a little less grip, and never on semi-slicks', async () => {
  const { wheelSetup, TUNABLE_DEFAULTS } = await import('../src/config.js');
  const normal = wheelSetup({ ...TUNABLE_DEFAULTS, rim: 15 });
  const stretched = wheelSetup({ ...TUNABLE_DEFAULTS, rim: 15, stretch: true });
  const semi = wheelSetup({ ...TUNABLE_DEFAULTS, rim: 15, stretch: true, tire: 'semi' });
  assert.ok(stretched.width < stretched.rimWidth && stretched.gripScale < normal.gripScale);
  assert.equal(semi.stretched, false);
});

test('offset widens the track, and 20-inch rims fit', async () => {
  const { car, run } = await makeWorld('autoClutch');
  Object.assign(car.tune, { offsetFront: 50, offsetRear: 50, rim: 20, profile: 35 });
  run(2);
  assert.ok(Math.abs(car.wheels[0].x - car.wheels[1].x - (1.407 + 0.1)) < 0.001, `front track ${car.wheels[0].x - car.wheels[1].x}`);
  car.trans.requestGear(3, 0);
  run(8, () => ({ throttle: car.forwardSpeed < 17 ? 1 : 0 }));
  run(3, () => ({ throttle: car.forwardSpeed < 17 ? 1 : 0, steer: -0.5 }));
  const q = car.body.rotation();
  assert.ok(1 - 2 * (q.x * q.x + q.z * q.z) > 0.97 && car.speed > 12);
});

test('stock suspension ignores ride height and spring settings; coilovers apply them', async () => {
  const y = {};
  for (const coilovers of [false, true]) {
    const { car, run } = await makeWorld('manual');
    Object.assign(car.tune, { coilovers, rideHeight: -100 });
    run(2);
    y[coilovers] = car.body.translation().y;
  }
  assert.ok(Math.abs(y.false - 0.62) < 0.05 && y.false - y.true > 0.07, JSON.stringify(y));
});
