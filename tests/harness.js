// Headless physics harness shared by the tests.
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from '../src/physics/vehicle.js';
import { CAR, TUNABLE_DEFAULTS } from '../src/config.js';

export const DT = 1 / 60;
let ready = null;

export async function makeWorld(mode = 'manual') {
  if (!ready) ready = RAPIER.init();
  await ready;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0).setFriction(0.9));
  const car = new Vehicle(world, CAR, { ...TUNABLE_DEFAULTS }, mode);
  car.reset([0, 0.75, 0], 0);
  const idle = { throttle: 0, brake: 0, handbrake: 0, clutch: false, steer: 0 };
  const step = (input) => {
    car.step(DT, { ...idle, ...input });
    world.step();
  };
  const run = (seconds, inputFn) => {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) step(typeof inputFn === 'function' ? inputFn(i * DT, car) : inputFn || {});
  };
  return { world, car, step, run, idle };
}
