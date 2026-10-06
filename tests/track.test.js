import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track, RAIL_OFFSET } from '../src/sim/track.js';

const track = new Track();

test('section is a 2-5 minute drive', () => {
  // At a typical 60-90 km/h average, 2-5 minutes is roughly 2-7 km.
  assert.ok(track.length > 2000 && track.length < 7000, `length ${track.length}`);
});

test('road never crosses or touches itself', () => {
  let closest = Infinity;
  for (let i = 0; i < track.count; i += 2) {
    for (let j = i + 120; j < track.count; j += 2) {
      closest = Math.min(closest, Math.hypot(track.x[i] - track.x[j], track.z[i] - track.z[j]));
    }
  }
  assert.ok(closest > RAIL_OFFSET * 4, `closest approach ${closest.toFixed(1)} m`);
});

test('mountain road: overall descent, steep but drivable grades, tight hairpins', () => {
  const drop = track.y[0] - track.y[track.count - 1];
  assert.ok(drop > 80, `drop ${drop}`);
  let maxGrade = 0;
  let minRadius = Infinity;
  for (let i = 0; i < track.count; i++) {
    maxGrade = Math.max(maxGrade, Math.abs(track.grade[i]));
    if (Math.abs(track.kappa[i]) > 1e-6) minRadius = Math.min(minRadius, 1 / Math.abs(track.kappa[i]));
  }
  assert.ok(maxGrade <= 0.12, `max grade ${maxGrade}`);
  assert.ok(minRadius > 12 && minRadius < 25, `min radius ${minRadius}`);
});

test('query returns the road under a point', () => {
  const q = {};
  const i = 700;
  const p = track.pointAt(i, 1.5);
  track.query(p.x, p.z, i - 5, q);
  assert.ok(Math.abs(q.lateral - 1.5) < 0.05, `lateral ${q.lateral}`);
  assert.ok(Math.abs(q.height - p.y) < 0.05, `height ${q.height} vs ${p.y}`);
  assert.ok(Math.abs(q.s - i) < 1, `s ${q.s}`);
  assert.ok(q.ny > 0.95, 'normal points up');
});
