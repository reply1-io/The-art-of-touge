import { test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from '../src/physics/vehicle.js';
import { CAR, TUNABLE_DEFAULTS } from '../src/config.js';
import { TRACKS } from '../src/world/tracks.js';
import { Terrain } from '../src/world/terrain.js';
import { buildMountainPhysics } from '../src/world/mountainPhysics.js';
import { BotDriver } from '../src/game/bot.js';
test('probe', async () => {
  await RAPIER.init();
  const road = TRACKS.akina.road();
  const terrain = new Terrain(road, { margin: 260, relief: 110 });
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const layout = buildMountainPhysics(world, road, terrain);
  const car = new Vehicle(world, CAR, { ...TUNABLE_DEFAULTS }, 'auto');
  car.surfaceOf = layout.surfaceOf;
  const i0 = road.startIndex - 12;
  const p = road.pointAt(i0, road.w.LANE);
  car.reset([p[0], p[1] + 0.8, p[2]], road.heading[i0]);
  car.trans.setDrive('D', 0);
  const bot = new BotDriver(road);
  const q = {}; let hint = i0;
  for (let t = 0; t < 70; t += 1 / 60) {
    const pos = car.body.translation();
    road.query(pos.x, pos.z, hint, q); hint = q.index;
    const inp = bot.drive(car, q, null);
    if (Math.round(t * 60) % 60 === 0) console.log(t.toFixed(0), q.index, q.lateral.toFixed(2), car.speed.toFixed(1), inp.steer.toFixed(2), inp.throttle, inp.brake, car.trans.label, Math.round(car.rpm));
    car.step(1 / 60, inp); world.step();
  }
});
