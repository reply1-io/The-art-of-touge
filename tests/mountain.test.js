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
const terrain = new Terrain(road, { margin: 180, relief: track.relief, lakes: track.lakes, peak: track.peak(road), stops: track.stopsOpts, level: true });

test('Kaido Mountain is about 11 km and drops a few hundred metres from the summit', () => {
  assert.ok(road.length > 9000 && road.length < 13000, `length ${road.length}`);
  assert.ok(road.top > 250, `drop ${road.top}`);
  for (const g of road.grade) assert.ok(g < 0.16, `grade ${g}`);
  assert.equal(track.stages.length, 7);
  assert.ok(track.stages.some((st) => st.name === "Dragon's Tail"), "the Dragon's Tail is on the map");
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
