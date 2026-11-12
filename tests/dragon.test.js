import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { TRACKS } from '../src/world/tracks.js';
import { HALF } from '../src/world/road.js';
import { Terrain } from '../src/world/terrain.js';
import { buildMountainPhysics } from '../src/world/mountainPhysics.js';
import { Vehicle } from '../src/physics/vehicle.js';
import { CAR, TUNABLE_DEFAULTS } from '../src/config.js';

const road = TRACKS.dragon.road();

test("Dragon's Tail: long, packed with corners, no straights, never crosses itself", () => {
  assert.ok(road.length > 7500, `length ${road.length}`);
  let corners = 0;
  let inCorner = false;
  let sign = 0;
  let straight = 0;
  let longest = 0;
  let minR = Infinity;
  for (let i = 0; i < road.count; i++) {
    const k = road.kappa[i];
    const c = Math.abs(k) > 1 / 90;
    if (c && (!inCorner || Math.sign(k) !== sign)) corners++;
    inCorner = c;
    if (c) sign = Math.sign(k);
    straight = c ? 0 : straight + 2;
    if (i > 60 && i < road.count - 70) longest = Math.max(longest, straight);
    if (i > 5 && i < road.count - 5) minR = Math.min(minR, 1 / Math.max(1e-6, Math.abs(k)));
  }
  assert.ok(corners / (road.length / 1000) > 15, `${corners} corners`);
  assert.ok(longest <= 30, `longest straight ${longest} m`);
  assert.ok(minR > 11, `tightest radius ${minR}`);
  let closest = Infinity;
  for (let i = 0; i < road.count; i += 3) for (let j = i + 60; j < road.count; j += 3) closest = Math.min(closest, Math.hypot(road.x[i] - road.x[j], road.z[i] - road.z[j]));
  assert.ok(closest > 4 * HALF, `closest legs ${closest}`);
});

test("Dragon's Tail: a careful driver gets from start to finish", async () => {
  const terrain = new Terrain(road, { margin: 180 });
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  buildMountainPhysics(world, road, terrain);
  const car = new Vehicle(world, CAR, { ...TUNABLE_DEFAULTS }, 'auto');
  const i0 = road.startIndex - 12;
  const p = road.pointAt(i0, -road.w.LANE);
  car.reset([p[0], p[1] + 0.8, p[2]], road.heading[i0]);
  car.trans.setDrive('D', 0);
  const q = {};
  let hint = i0;
  for (let t = 0; t < 1200; t += 1 / 60) {
    const pos = car.body.translation();
    road.query(pos.x, pos.z, hint, q);
    hint = q.index;
    if (q.index >= road.finishIndex) break;
    assert.ok(pos.y > q.height - 1.5, `fell through at s=${q.s}`);
    const la = Math.min(road.count - 1, q.index + Math.round(3 + car.speed * 0.4));
    const [tx, , tz] = road.pointAt(la, -road.w.LANE);
    const r = car.body.rotation();
    const yaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
    let err = Math.atan2(tx - pos.x, tz - pos.z) - yaw;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    let k = 0;
    for (let j = q.index; j < Math.min(road.count, q.index + 60); j++) k = Math.max(k, Math.abs(road.kappa[j]));
    const target = Math.min(26, Math.sqrt((0.42 * 9.81) / Math.max(k, 1e-4)));
    car.step(1 / 60, { throttle: car.speed < target ? 1 : 0, brake: car.speed > target + 1.5 ? 1 : 0, handbrake: 0, clutch: false, steer: Math.max(-1, Math.min(1, -err * 2.2 + (q.lateral + road.w.LANE) * 0.15)) });
    world.step();
  }
  assert.ok(q.index >= road.finishIndex, `stopped at s=${q.s}`);
});
