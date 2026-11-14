import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS } from '../src/world/tracks.js';
import { medalTimes, medalFor } from '../src/game/medals.js';

test('medals: every road has gold < silver < bronze, at believable average speeds', () => {
  const t = TRACKS.world;
  const road = t.road();
  for (const st of t.stages) {
    const i0 = Math.round(st.s0 / 2) + 30;
    const i1 = Math.round(st.s1 / 2);
    const m = medalTimes(road, i0, i1);
    assert.ok(m.gold < m.silver && m.silver < m.bronze, st.name);
    const kmh = ((i1 - i0) * 2) / m.gold * 3.6;
    assert.ok(kmh > 35 && kmh < 90, `${st.name}: gold pace ${kmh.toFixed(0)} km/h`);
  }
  const m = { gold: 60, silver: 70, bronze: 80 };
  assert.equal(medalFor(m, 59)?.id, 'gold');
  assert.equal(medalFor(m, 75)?.id, 'bronze');
  assert.equal(medalFor(m, 81), null);
  assert.equal(medalFor(m, null), null);
});
