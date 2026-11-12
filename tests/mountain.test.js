import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { Road, HALF } from '../src/world/road.js';
import { Terrain } from '../src/world/terrain.js';
import { buildMountainPhysics } from '../src/world/mountainPhysics.js';
import { Vehicle } from '../src/physics/vehicle.js';
import { CAR, TUNABLE_DEFAULTS } from '../src/config.js';

const road = new Road(undefined, 5000, { width: 'narrow' }); // Akina as played: the skinny road
const terrain = new Terrain(road);

test('the pass is about 5 km and drops a few hundred metres from summit to town', () => {
  assert.ok(road.length > 4500 && road.length < 5500, `length ${road.length}`);
  assert.ok(road.top > 300 && road.top < 600, `drop ${road.top}`);
  for (const g of road.grade) assert.ok(g < 0.14, `grade ${g}`);
  assert.ok(Math.min(...road.grade) < 0, 'has some uphill');
  assert.ok(Math.max(...road.bank.map(Math.abs)) > 0.17, 'corners are steeply banked');
});

test('the road never crosses itself and corners stay drivable', () => {
  let closest = Infinity;
  for (let i = 0; i < road.count; i += 2) {
    for (let j = i + 60; j < road.count; j += 2) closest = Math.min(closest, Math.hypot(road.x[i] - road.x[j], road.z[i] - road.z[j]));
  }
  assert.ok(closest > 4 * HALF, `closest legs ${closest}`);
  let minR = Infinity;
  for (let i = 5; i < road.count - 5; i++) minR = Math.min(minR, 1 / Math.max(1e-6, Math.abs(road.kappa[i])));
  assert.ok(minR > 9.5, `tightest radius ${minR}`);
});

test('there is a chain of five consecutive hairpins', () => {
  const pins = [];
  for (let i = 0; i + 35 < road.count; i++) {
    let d = road.heading[i + 35] - road.heading[i];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) > 2.5 && (pins.length === 0 || i - pins[pins.length - 1] > 30)) pins.push(i);
  }
  let run = 1;
  let best = 1;
  for (let k = 1; k < pins.length; k++) {
    run = pins[k] - pins[k - 1] < 90 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  assert.ok(best >= 5, `longest chain ${best} (hairpins at ${pins.map((i) => i * 2)})`);
});

test('a few corners have drainage gutters on the inside', () => {
  let corners = 0;
  for (const a of [road.gutterLeft, road.gutterRight]) for (let i = 1; i < road.count; i++) if (a[i] > 0 && a[i - 1] === 0) corners++;
  assert.ok(corners >= 3 && corners <= 10, `${corners} gutter corners`);
});

test('the terrain never pokes through the road', () => {
  for (let i = 0; i < road.count; i++) {
    for (const l of [-HALF, 0, HALF]) {
      const [x, y, z] = road.pointAt(i, l);
      assert.ok(terrain.heightAt(x, z) < y - 0.05, `terrain above road at s=${i * 2}`);
    }
  }
});

test('no barrier blocks the road', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  buildMountainPhysics(world, road, terrain);
  world.step();
  const shape = new RAPIER.Cuboid(0.8, 0.5, 0.3);
  let blocked = 0;
  for (let i = 4; i < road.count - 4; i += 2) {
    for (const l of [-2, 0, 2]) {
      const p = road.pointAt(i, l, 0.9);
      const h = road.heading[i];
      world.intersectionsWithShape({ x: p[0], y: p[1], z: p[2] }, { x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) }, shape, (c) => {
        if (c.shape.type === RAPIER.ShapeType.Cuboid) blocked++;
        return true;
      });
    }
  }
  assert.equal(blocked, 0);
});

test('a careful driver can take the E30 from the summit to the town', async () => {
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
  for (let t = 0; t < 600; t += 1 / 60) {
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
    // Look far enough ahead to brake on the steep downhill sections.
    for (let j = q.index; j < Math.min(road.count, q.index + 60); j++) k = Math.max(k, Math.abs(road.kappa[j]));
    const target = Math.min(26, Math.sqrt((0.42 * 9.81) / Math.max(k, 1e-4)));
    car.step(1 / 60, { throttle: car.speed < target ? 1 : 0, brake: car.speed > target + 1.5 ? 1 : 0, handbrake: 0, clutch: false, steer: Math.max(-1, Math.min(1, -err * 2.2 + (q.lateral + road.w.LANE) * 0.15)) });
    world.step();
  }
  assert.ok(q.index >= road.finishIndex, `stopped at s=${q.s}`);
});
