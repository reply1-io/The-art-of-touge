import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { TRACKS } from '../src/world/tracks.js';
import { Terrain } from '../src/world/terrain.js';
import { buildMountainPhysics } from '../src/world/mountainPhysics.js';
import { Vehicle } from '../src/physics/vehicle.js';
import { CAR, TUNABLE_DEFAULTS } from '../src/config.js';

const REAL = Object.entries(TRACKS).filter(([, t]) => t.real);

// The land, lots and bridges for a real road, built the way the Mountain builds them.
function world(t) {
  const road = t.road();
  const n1 = road.count - 1;
  const bridges = (t.bridges?.() ?? []).map((b) => ({ ...b, i0: Math.round(b.f0 * n1), i1: Math.round(b.f1 * n1) }));
  const town = t.town === false ? { none: true } : { i: n1, ...t.town };
  const terrain = new Terrain(road, { margin: 180, relief: t.relief, lakes: t.lakes, stops: t.stopsOpts, town, bridges });
  return { road, terrain, bridges };
}

test('Real roads: two roads, both ways, every one in the road list', () => {
  const ids = REAL.map(([id]) => id);
  for (const id of ['tunitas-down', 'tunitas-up', 'us276-up', 'us276-down']) assert.ok(ids.includes(id), id);
});

test('Real roads: never cross themselves, no climb steeper than 12%', () => {
  for (const [id, t] of REAL) {
    const road = t.road();
    assert.ok(road.length > 5000, `${id}: ${road.length} m`);
    let closest = Infinity;
    for (let i = 0; i < road.count; i += 3) for (let j = i + 60; j < road.count; j += 3) closest = Math.min(closest, Math.hypot(road.x[i] - road.x[j], road.z[i] - road.z[j]));
    assert.ok(closest > 26, `${id}: legs ${closest.toFixed(1)} m apart`);
    for (const g of road.grade) assert.ok(Math.abs(g) < 0.12, `${id}: grade ${g}`);
  }
});

test('Real roads: the same road both ways', () => {
  for (const [a, b] of [['tunitas-down', 'tunitas-up'], ['us276-up', 'us276-down']]) {
    const ra = TRACKS[a].road();
    const rb = TRACKS[b].road();
    assert.ok(Math.abs(ra.length - rb.length) < 6, `${a}/${b} lengths`);
    const n = ra.count - 1;
    const m = rb.count - 1;
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const i = Math.round(f * n);
      const j = Math.round((1 - f) * m);
      assert.ok(Math.hypot(ra.x[i] - rb.x[j], ra.z[i] - rb.z[j]) < 6, `${a}/${b} at ${f}`);
      assert.ok(Math.abs(ra.y[i] - rb.y[j]) < 2, `${a}/${b} height at ${f}`);
    }
  }
});

test('Real roads: banked like the real roads (superelevated corners, flat straights)', () => {
  const most = { dragon: 0.07, 'tunitas-down': 0.015, 'tunitas-up': 0.015, 'us276-up': 0.06, 'us276-down': 0.06 };
  for (const [id, t] of REAL) {
    const road = t.road();
    let banked = 0;
    for (let i = 10; i < road.count - 10; i++) {
      const e = Math.tan(Math.abs(road.bank[i]));
      assert.ok(e <= most[id] + 0.002, `${id}: ${(e * 100).toFixed(1)}% banking`);
      if (e > most[id] * 0.6) banked++;
    }
    // The corners are banked, but not the whole road.
    assert.ok(banked > 20 && banked / road.count < 0.9, `${id}: banked ${banked}/${road.count}`);
  }
});

test('Real roads: heights match the real roads', () => {
  const span = (id) => {
    const r = TRACKS[id].road();
    return Math.max(...r.y) - Math.min(...r.y);
  };
  // Deals Gap 606 m down to about 280 m; Skyline 625 m to Highway 1 at 38 m; the Parkway at
  // 1,380 m down to the forest entrance at 651 m.
  assert.ok(Math.abs(span('dragon') - 326) < 15, `dragon ${span('dragon')}`);
  assert.ok(Math.abs(span('tunitas-down') - 587) < 15, `tunitas ${span('tunitas-down')}`);
  assert.ok(Math.abs(span('us276-down') - 729) < 15, `us276 ${span('us276-down')}`);
});

test('Real roads: the agreed stops are there', () => {
  const lots = (id) => world(TRACKS[id]).terrain.zones.filter((z) => z.kind === 'lot').map((z) => z.lot.label[0]);
  // Tunitas: a turnaround (both sides of the road) at each end.
  const tz = world(TRACKS['tunitas-down']).terrain.zones.filter((z) => z.lot?.culdesac);
  assert.equal(tz.length, 4);
  for (const id of ['us276-up', 'us276-down']) for (const n of ['国有林', '滝', '展望台']) assert.ok(lots(id).includes(n), `${id} ${n}`);
});

test('Real roads: people at the roadside, never standing on the road', async () => {
  const { crowdsFor } = await import('../src/world/crowds.js');
  for (const [id, t] of REAL) {
    const { road, terrain } = world(t);
    const { people, cars } = crowdsFor(road, terrain, { seed: road.count });
    assert.ok(people.length > 60, `${id}: ${people.length} people`);
    const q = {};
    for (const p of [...people, ...cars]) {
      road.query(p.x, p.z, -1, q);
      assert.ok(Math.abs(q.lateral) > road.w.PAVED + 0.3, `${id}: someone on the road at s=${q.s.toFixed(0)}`);
    }
  }
});
