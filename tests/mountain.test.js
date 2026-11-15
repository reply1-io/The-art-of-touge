import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { Road, HALF } from '../src/world/road.js';
import { TRACKS } from '../src/world/tracks.js';
import { Terrain } from '../src/world/terrain.js';
import { buildMountainPhysics } from '../src/world/mountainPhysics.js';

// The Kaido Mountain map, built the way the game builds it.
const track = TRACKS.world;
const road = track.road();
const links = track.links(road);
const terrain = new Terrain(road, { links, margin: 180, relief: track.relief, lakes: track.lakes, peak: track.peak(road), stops: track.stopsOpts, level: true, town: track.town(road) });

test('Kaido Mountain is about 13 km of road across a mountain', () => {
  assert.ok(road.length > 12000 && road.length < 16000, `length ${road.length}`);
  assert.ok(road.top > 80, `drop ${road.top}`);
  for (const g of road.grade) assert.ok(g < 0.16, `grade ${g}`);
  assert.equal(track.stages.length, 11);
  assert.ok(track.stages.some((st) => st.name === "Dragon's Tail"), "the Dragon's Tail is on the map");
});

test('the road never crosses itself and corners stay drivable', () => {
  let closest = Infinity;
  for (let i = 0; i < road.count; i += 2) {
    for (let j = i + 60; j < road.count - Math.max(0, 60 - i); j += 2) closest = Math.min(closest, Math.hypot(road.x[i] - road.x[j], road.z[i] - road.z[j]));
  }
  assert.ok(closest > 4 * HALF, `closest legs ${closest}`);
  let minR = Infinity;
  for (let i = 5; i < road.count - 5; i++) minR = Math.min(minR, 1 / Math.max(1e-6, Math.abs(road.kappa[i])));
  assert.ok(minR > 9.5, `tightest radius ${minR}`);
});

test('Maple Hairpins has a chain of five consecutive hairpins', () => {
  const st = track.stages.find((x) => x.name === 'Maple Hairpins');
  const pins = [];
  for (let i = Math.round(st.s0 / 2); i + 35 < Math.round(st.s1 / 2); i++) {
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
      const th = terrain.heightAt(x, z);
      assert.ok(th < y - 0.05, `terrain above road at s=${i * 2} lat ${l}: ${th.toFixed(2)} vs ${y.toFixed(2)}`);
    }
  }
});

test('no barrier blocks the road', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  buildMountainPhysics(world, road, terrain, links);
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

test('junctions: link roads join the loop at the edge of its tarmac, level with it', () => {
  assert.ok(links.length >= 4, `${links.length} links`);
  const PAV = road.w.PAVED + 0.3;
  for (const l of links) {
    const r = l.road;
    for (const [i, side, k] of [
      [l.a, l.sideA, 0],
      [l.b, l.sideB, r.count - 1],
    ]) {
      const p = road.pointAt(i, side * PAV);
      assert.ok(Math.hypot(p[0] - r.x[k], p[2] - r.z[k]) < 1.5, 'link meets the loop');
      assert.ok(Math.abs(p[1] - r.y[k]) < 0.15, `step of ${(p[1] - r.y[k]).toFixed(2)} m at a junction`);
    }
    // The ground stays under the link road.
    for (let i = 0; i < r.count; i++) {
      for (const lat of [-HALF, 0, HALF]) {
        const [x, y, z] = r.pointAt(i, lat);
        assert.ok(terrain.heightAt(x, z) < y + 0.05, `terrain above a link road at ${i * 2} m`);
      }
    }
  }
});

test('junctions: nothing solid stands across a link road or its junctions', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  buildMountainPhysics(world, road, terrain, links);
  world.step();
  const shape = new RAPIER.Cuboid(0.8, 0.5, 0.3);
  let blocked = 0;
  for (const l of links) {
    const r = l.road;
    for (let i = 0; i < r.count; i += 2) {
      for (const lat of [-1.5, 0, 1.5]) {
        const p = r.pointAt(i, lat, 0.9);
        const h = r.heading[i];
        world.intersectionsWithShape({ x: p[0], y: p[1], z: p[2] }, { x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) }, shape, (c) => {
          if (c.shape.type === RAPIER.ShapeType.Cuboid) blocked++;
          return true;
        });
      }
    }
  }
  assert.equal(blocked, 0);
});

test('the loop has no ends: a car rolls across the join at the car meet', async () => {
  await RAPIER.init();
  const { Vehicle } = await import('../src/physics/vehicle.js');
  const { CAR, TUNABLE_DEFAULTS } = await import('../src/config.js');
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  buildMountainPhysics(world, road, terrain, links);
  const car = new Vehicle(world, CAR, { ...TUNABLE_DEFAULTS }, 'auto');
  const i0 = road.count - 25;
  const p = road.pointAt(i0, -road.w.LANE);
  car.reset([p[0], p[1] + 0.8, p[2]], road.heading[i0]);
  car.trans.setDrive('D', 0);
  const q = {};
  let hint = i0;
  for (let t = 0; t < 20; t += 1 / 60) {
    const pos = car.body.translation();
    road.query(pos.x, pos.z, hint, q);
    hint = q.index;
    const la = (q.index + 6) % (road.count - 1);
    const [tx, , tz] = road.pointAt(la, -road.w.LANE);
    const r = car.body.rotation();
    const yaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
    let err = Math.atan2(tx - pos.x, tz - pos.z) - yaw;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    car.step(1 / 60, { throttle: car.speed < 9 ? 0.6 : 0, brake: 0, handbrake: 0, clutch: false, steer: Math.max(-1, Math.min(1, -err * 2)) });
    world.step();
    if (q.index > 5 && q.index < 60) break;
  }
  assert.ok(q.index > 5 && q.index < 60, `stuck at sample ${q.index} of ${road.count}`);
});

test('no ledges: nothing stands proud of the tarmac anywhere on the loop or a link road', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  buildMountainPhysics(world, road, terrain, links);
  world.step();
  const bad = [];
  for (const [name, r] of [['loop', road], ...links.map((l, k) => [`link ${k}`, l.road])]) {
    for (let i = 0; i < r.count; i++) {
      for (let lat = -r.w.PAVED; lat <= r.w.PAVED + 0.01; lat += 0.7) {
        const p = r.pointAt(i, lat);
        const hit = world.castRay(new RAPIER.Ray({ x: p[0], y: p[1] + 3, z: p[2] }, { x: 0, y: -1, z: 0 }), 6, true);
        if (hit && p[1] + 3 - hit.timeOfImpact > p[1] + 0.12) bad.push(`${name} at ${i * 2} m`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 5), []);
});

test('lake water never reaches a road', () => {
  for (const lk of terrain.lakes) {
    for (let i = 0; i < terrain.road.count; i++) {
      if (Math.hypot(terrain.road.x[i] - lk.x, terrain.road.z[i] - lk.z) < lk.r + 32) assert.ok(terrain.road.y[i] > lk.level + 1, 'a road runs under the water');
    }
  }
});
