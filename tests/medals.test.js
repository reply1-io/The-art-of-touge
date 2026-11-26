import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS } from '../src/world/tracks.js';
import { medalTimes, medalFor } from '../src/game/medals.js';

test('medals: gold < silver < bronze, at a believable average speed', () => {
  const road = TRACKS.dragon.road();
  const m0 = medalTimes(road, road.startIndex, road.finishIndex);
  assert.ok(m0.gold < m0.silver && m0.silver < m0.bronze);
  const kmh = ((road.finishIndex - road.startIndex) * 2) / m0.gold * 3.6;
  assert.ok(kmh > 35 && kmh < 90, `gold pace ${kmh.toFixed(0)} km/h`);
  const m = { gold: 60, silver: 70, bronze: 80 };
  assert.equal(medalFor(m, 59)?.id, 'gold');
  assert.equal(medalFor(m, 75)?.id, 'bronze');
  assert.equal(medalFor(m, 81), null);
  assert.equal(medalFor(m, null), null);
});
