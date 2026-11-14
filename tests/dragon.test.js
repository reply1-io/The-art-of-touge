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

test('Kaido Mountain: eleven roads, no leg of the route comes too close to another', async () => {
  const { TRACKS } = await import('../src/world/tracks.js');
  const road = TRACKS.world.road();
  assert.equal(TRACKS.world.stages.length, 11);
  let closest = Infinity;
  for (let i = 0; i < road.count; i += 3)
    for (let j = i + 40; j < road.count - Math.max(0, 40 - i); j += 3) closest = Math.min(closest, Math.hypot(road.x[i] - road.x[j], road.z[i] - road.z[j]));
  assert.ok(closest > 4 * road.w.HALF, `closest legs ${closest}`);
  assert.ok(road.top > 80, `the summit is ${road.top} m above the village`);
  // A loop: the end of the road meets its start, at the same height and heading the same way.
  assert.ok(Math.hypot(road.x[0] - road.x[road.count - 1], road.z[0] - road.z[road.count - 1]) < 3, 'the loop closes');
  assert.ok(Math.abs(road.y[0] - road.y[road.count - 1]) < 0.3, 'no step at the join');
});

// How fast a well tuned car (about 300 hp, on semi-slicks) could possibly go anywhere on the map: flat out
// wherever it can, braking hard for every corner it needs to.
test('Kaido Mountain: every road is all corners, nowhere near 80 mph even flat out', async () => {
  const { TRACKS } = await import('../src/world/tracks.js');
  const road = TRACKS.world.road();
  const n = road.count;
  const cap = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) k = Math.max(k, Math.abs(road.kappa[j]));
    cap[i] = Math.sqrt((1.4 * 9.81) / Math.max(k, 1e-5)); // semi-slicks
  }
  const v = Float64Array.from(cap);
  v[0] = 0;
  // Round the loop twice, so the speed carried across the join counts too.
  for (let lap = 0; lap < 2; lap++) {
    for (let i = lap ? 0 : 1; i < n; i++) {
      const u = v[(i - 1 + n) % n];
      const a = Math.min(7, 220000 / (1200 * Math.max(u, 1))) - (0.45 * u * u) / 1200 + 9.81 * road.grade[i];
      v[i] = Math.min(cap[i], Math.sqrt(Math.max(0, u * u + 2 * a * 2)));
    }
  }
  for (let lap = 0; lap < 2; lap++) for (let i = n - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[(i + 1) % n] ** 2 + 2 * 9 * 2));
  const top = Math.max(...v) * 2.237;
  assert.ok(top < 76, `${top.toFixed(1)} mph possible`);
});
