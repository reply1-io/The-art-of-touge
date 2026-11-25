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

test('Real roads: four roads, both ways, every one in the road list', () => {
  const ids = REAL.map(([id]) => id);
  for (const id of ['berthoud', 'tunitas-down', 'tunitas-up', 'us276-up', 'us276-down', 'chiefjoseph-west', 'chiefjoseph-east']) assert.ok(ids.includes(id), id);
});

test('Real roads: never cross themselves, no climb steeper than 8%', () => {
  for (const [id, t] of REAL) {
    const road = t.road();
    assert.ok(road.length > 5000, `${id}: ${road.length} m`);
    let closest = Infinity;
    for (let i = 0; i < road.count; i += 3) for (let j = i + 60; j < road.count; j += 3) closest = Math.min(closest, Math.hypot(road.x[i] - road.x[j], road.z[i] - road.z[j]));
    assert.ok(closest > 26, `${id}: legs ${closest.toFixed(1)} m apart`);
    for (const g of road.grade) assert.ok(Math.abs(g) < 0.08, `${id}: grade ${g}`);
  }
});

test('Real roads: the same road both ways', () => {
  for (const [a, b] of [['tunitas-down', 'tunitas-up'], ['us276-up', 'us276-down'], ['chiefjoseph-west', 'chiefjoseph-east']]) {
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

test('Real roads: hairpins flat, only some sweepers banked', () => {
  for (const [id, t] of REAL) {
    const road = t.road();
    let flatHairpin = 0;
    let hairpin = 0;
    let banked = 0;
    for (let i = 10; i < road.count - 10; i++) {
      const k = Math.abs(road.kappa[i]);
      if (k > 1 / 20) {
        hairpin++;
        if (Math.abs(road.bank[i]) < 0.07) flatHairpin++;
      }
      if (Math.abs(road.bank[i]) > 0.06) banked++;
    }
    if (hairpin) assert.ok(flatHairpin / hairpin > 0.9, `${id}: ${flatHairpin}/${hairpin} hairpin samples flat`);
    // Some banking, but nowhere near every corner.
    if (id !== 'tunitas-down' && id !== 'tunitas-up') assert.ok(banked > 20, `${id}: banked ${banked}`);
    assert.ok(banked / road.count < 0.35, `${id}: banked ${banked}/${road.count}`);
  }
  // Tunitas Creek is flat all the way.
  const tun = TRACKS['tunitas-down'].road();
  for (const b of tun.bank) assert.ok(Math.abs(b) < 0.05, `Tunitas bank ${b}`);
});

test('Real roads: the agreed stops are there', () => {
  const lots = (id) => world(TRACKS[id]).terrain.zones.filter((z) => z.kind === 'lot').map((z) => z.lot.label[0]);
  assert.ok(lots('berthoud').includes('BERTHOUD PASS'));
  assert.equal(TRACKS.berthoud.stages.length, 2);
  // Tunitas: a turnaround (both sides of the road) at each end.
  const tz = world(TRACKS['tunitas-down']).terrain.zones.filter((z) => z.lot?.culdesac);
  assert.equal(tz.length, 4);
  for (const id of ['us276-up', 'us276-down']) for (const n of ['PISGAH', 'LOOKING GLASS', 'BLUE RIDGE']) assert.ok(lots(id).includes(n), `${id} ${n}`);
  for (const id of ['chiefjoseph-west', 'chiefjoseph-east']) for (const n of ['CHIEF JOSEPH', 'DEAD INDIAN PASS', 'SUNLIGHT CREEK']) assert.ok(lots(id).includes(n), `${id} ${n}`);
});

test('Chief Joseph: across the Sunlight Creek Bridge, high over the gorge', async () => {
  const t = TRACKS['chiefjoseph-west'];
  const { road, terrain, bridges } = world(t);
  const b = bridges[0];
  const m = (b.i0 + b.i1) >> 1;
  assert.ok(road.y[m] - terrain.heightAt(road.x[m], road.z[m]) > 50, 'deep gorge under the bridge');
  await RAPIER.init();
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  w.timestep = 1 / 60;
  const layout = buildMountainPhysics(w, road, terrain);
  for (let i = b.i0; i <= b.i1; i++) assert.ok(layout.rail[1][i] && layout.rail[-1][i], `rails on the bridge at ${i}`);
  // Drive across it.
  const car = new Vehicle(w, CAR, { ...TUNABLE_DEFAULTS }, 'auto');
  const i0 = b.i0 - 120;
  const p = road.pointAt(i0, -road.w.LANE);
  car.reset([p[0], p[1] + 0.8, p[2]], road.heading[i0]);
  car.trans.setDrive('D', 0);
  const q = {};
  let hint = i0;
  for (let s = 0; s < 120; s += 1 / 60) {
    const pos = car.body.translation();
    road.query(pos.x, pos.z, hint, q);
    hint = q.index;
    if (q.index >= b.i1 + 20) break;
    assert.ok(pos.y > q.height - 1.5, `fell through at s=${q.s}`);
    const la = Math.min(road.count - 1, q.index + Math.round(3 + car.speed * 0.4));
    const [tx, , tz] = road.pointAt(la, -road.w.LANE);
    const r = car.body.rotation();
    const yaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
    let err = Math.atan2(tx - pos.x, tz - pos.z) - yaw;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    car.step(1 / 60, { throttle: car.speed < 20 ? 1 : 0, brake: 0, handbrake: 0, clutch: false, steer: Math.max(-1, Math.min(1, -err * 2.2 + (q.lateral + road.w.LANE) * 0.15)) });
    w.step();
  }
  assert.ok(q.index >= b.i1 + 20, `stopped at s=${q.s}`);
});
