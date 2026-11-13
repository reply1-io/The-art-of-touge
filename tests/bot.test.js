import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from '../src/physics/vehicle.js';
import { SoftBarrier } from '../src/physics/barrier.js';
import { CAR, TUNABLE_DEFAULTS } from '../src/config.js';
import { TRACKS } from '../src/world/tracks.js';
import { Terrain } from '../src/world/terrain.js';
import { buildMountainPhysics } from '../src/world/mountainPhysics.js';
import { BotDriver } from '../src/game/bot.js';

async function botRun(id) {
  await RAPIER.init();
  const road = TRACKS[id].road();
  const terrain = new Terrain(road, { margin: road.length > 6000 ? 180 : 260, relief: TRACKS[id].relief });
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
  const q = { index: i0, lateral: 0, s: 0 };
  let hint = i0;
  const barrier = new SoftBarrier((x, z, out) => {
    const rq = {};
    road.query(x, z, hint, rq);
    const side = rq.lateral > 0 ? 1 : -1;
    if (!layout.rail[side][rq.index]) return false;
    const pen = Math.abs(rq.lateral) - (road.w.RAIL - 0.45);
    if (pen <= 0 || pen > 1.5) return false;
    out.pen = pen;
    out.nx = -side * Math.cos(rq.heading);
    out.nz = side * Math.sin(rq.heading);
    return true;
  });
  let t = 0;
  let railHits = 0;
  for (; t < 900; t += 1 / 60) {
    const pos = car.body.translation();
    road.query(pos.x, pos.z, hint, q);
    hint = q.index;
    if (q.index >= road.finishIndex) break;
    car.step(1 / 60, bot.drive(car, q, null));
    barrier.apply(car.body);
    if (barrier.touching) railHits++;
    world.step();
  }
  return { done: q.index >= road.finishIndex, t, railHits, s: q.s };
}

for (const id of ['akina', 'dragon']) {
  test(`the rival bot drives ${id} top to bottom cleanly`, async () => {
    const r = await botRun(id);
    console.log(id, JSON.stringify(r));
    assert.ok(r.done, `stopped at s=${r.s}`);
    // Grass grip has a random wobble, so the odd brush varies run to run; 3 s over a whole run is fine.
    assert.ok(r.railHits < 180, `rail contact for ${r.railHits} steps`);
  });
}
