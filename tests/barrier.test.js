import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { makeWorld, DT } from './harness.js';
import { SoftBarrier } from '../src/physics/barrier.js';

// A straight rail along z at x = 6 (the car's left), approached at an angle at about 45 mph.
async function hitRail(soft) {
  const { world, car, step, run } = await makeWorld('autoClutch');
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.08, 0.45, 400).setTranslation(6.1, 0.45, 0).setFriction(0.15));
  const barrier = soft ? new SoftBarrier((x, z, out) => {
    const pen = x - (6.02 - 0.47);
    if (pen <= 0) return false;
    out.pen = pen;
    out.nx = -1;
    out.nz = 0;
    return true;
  }) : null;
  car.trans.requestGear(3, 0);
  run(9, () => ({ throttle: car.forwardSpeed < 20 ? 1 : 0 }));
  // Turn toward the rail (left) at roughly 20 degrees.
  run(0.35, { steer: -0.5 });
  let peak = 0;
  let prev = car.body.linvel();
  let spin = 0;
  for (let i = 0; i < 180; i++) {
    car.step(DT, { throttle: 0, brake: 0, handbrake: 0, clutch: false, steer: 0 });
    barrier?.apply(car.body);
    world.step();
    const v = car.body.linvel();
    peak = Math.max(peak, Math.hypot(v.x - prev.x, v.z - prev.z) / DT / 9.81);
    spin = Math.max(spin, Math.abs(car.body.angvel().y));
    prev = v;
  }
  void step;
  return { peak, spin, x: car.body.translation().x, speed: car.speed };
}

test('guardrails cushion the car instead of slamming it', async () => {
  const hard = await hitRail(false);
  const soft = await hitRail(true);
  assert.ok(soft.peak < hard.peak * 0.6, `peak g soft ${soft.peak} hard ${hard.peak}`);
  assert.ok(soft.spin < 1.5, `yaw rate after the hit ${soft.spin}`);
  assert.ok(soft.x < 6, 'stays on the road side of the rail');
  assert.ok(soft.speed > 10, `keeps moving along the rail at ${soft.speed} m/s`);
});
