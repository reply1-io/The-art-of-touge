import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outside, newlyEnclosed, outlines, simplifyLoop } from '../src/builder/sketchPad.js';

const grid = (w, h, fn) => Uint8Array.from({ length: w * h }, (_, i) => (fn(i % w, Math.floor(i / w)) ? 1 : 0));

test('Sketch pen: drawing a closed ring fills it in; an erased hole stays open', () => {
  const w = 40;
  const h = 30;
  const ring = (x, y) => x >= 5 && x <= 30 && y >= 5 && y <= 25 && !(x >= 7 && x <= 28 && y >= 7 && y <= 23);
  // Before the last side was drawn the ring was open.
  const open = grid(w, h, (x, y) => ring(x, y) && x < 29);
  const before = outside(open, w, h);
  const after = grid(w, h, ring);
  const fill = newlyEnclosed(after, before, w, h);
  assert.equal(fill[15 * w + 15], 1, 'the middle fills');
  assert.equal(fill[2 * w + 2], 0, 'outside stays empty');
  // Erase a hole in a solid block: drawing elsewhere doesn't fill it back.
  const holed = grid(w, h, (x, y) => x >= 5 && x <= 30 && y >= 5 && y <= 25 && !(x >= 12 && x <= 18 && y >= 12 && y <= 18));
  const b2 = outside(holed, w, h);
  const withDot = Uint8Array.from(holed);
  withDot[2 * w + 35] = 1;
  assert.equal(newlyEnclosed(withDot, b2, w, h)[15 * w + 15], 0);
});

test('Sketch pen: outlines of blobs, with their holes', () => {
  const w = 50;
  const h = 30;
  const m = grid(w, h, (x, y) => (x >= 2 && x <= 20 && y >= 2 && y <= 20 && !(x >= 8 && x <= 12 && y >= 8 && y <= 12)) || (x >= 30 && x <= 45 && y >= 5 && y <= 15));
  const blobs = outlines(m, w, h);
  assert.equal(blobs.length, 2);
  const ring = blobs.find((b) => b.holes.length);
  assert.ok(ring, 'one blob has a hole');
  assert.equal(ring.holes.length, 1);
  // A rectangle's outline is four corners.
  const rect = blobs.find((b) => !b.holes.length);
  assert.equal(simplifyLoop(rect.outer, 0.5).length, 4);
});
