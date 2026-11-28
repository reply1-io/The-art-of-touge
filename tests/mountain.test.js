import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { Road, HALF } from '../src/world/road.js';
import { TRACKS } from '../src/world/tracks.js';
import { Terrain } from '../src/world/terrain.js';
import { buildMountainPhysics } from '../src/world/mountainPhysics.js';

// The Kaido Mountain map, built the way the game builds it.
const track = TRACKS.dragon;
const road = track.road();
const links = [];
const terrain = new Terrain(road, { margin: 180, relief: track.relief, stops: track.stopsOpts });

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

test('no ledges: nothing stands proud of the tarmac anywhere on the road', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  buildMountainPhysics(world, road, terrain, links);
  world.step();
  const bad = [];
  for (const [name, r] of [['road', road]]) {
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

test('your place: a cabin and workshop lot in the forest, with the way in and out laid out', () => {
  const home = terrain.zones.find((z) => z.kind === 'home');
  assert.ok(home, 'the home lot is on the road');
  assert.ok(home.i0 * 2 > 1500 && home.i0 * 2 < 2600, `about 2 km in (at ${home.i0 * 2} m)`);
});
