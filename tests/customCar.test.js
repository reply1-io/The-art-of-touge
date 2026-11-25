import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customShape, designPolys, starterParts, partGeometry } from '../src/render/shapes/custom.js';

const design = { id: 'custom-test', name: 'Test', base: 'e30', paint: '#ff0000', parts: starterParts() };

test('Car Builder: the starter car becomes a body the game can draw', () => {
  const polys = designPolys(design);
  assert.ok(polys.paint.length > 20);
  assert.ok(polys.glass.length > 0 && polys.head.length > 0 && polys.tail.length > 0);
  const shape = customShape(design);
  assert.ok(shape.nose > 2 && shape.nose < 2.3, `nose ${shape.nose}`);
  assert.ok(shape.tail < -2 && shape.tail > -2.3, `tail ${shape.tail}`);
  assert.ok(Math.abs(shape.section(0).hw - 0.81) < 0.02);
  const built = shape.build();
  for (const k of ['paint', 'cabinTop', 'trim']) assert.ok(Array.isArray(built.shell[k]));
});

test('Car Builder: a mirrored part gets a copy on the other side, facing out', () => {
  const part = { type: 'box', p: [0.6, 0.5, 1], s: [0.2, 0.2, 0.2], r: [0, 20, 0], mat: 'trim', mirror: true };
  const polys = designPolys({ parts: [part] }).trim;
  assert.equal(polys.length, 24); // 12 triangles each side
  const left = polys.filter((p) => p.pts[0][0] > 0);
  const right = polys.filter((p) => p.pts[0][0] < 0);
  assert.equal(left.length, 12);
  assert.equal(right.length, 12);
  // Every face points away from the middle of its own box.
  for (const p of polys) {
    const cx = Math.sign(p.pts[0][0]) * 0.6;
    const m = p.pts.reduce((s, v) => [s[0] + v[0] / 3, s[1] + v[1] / 3, s[2] + v[2] / 3], [0, 0, 0]);
    const d = [m[0] - cx, m[1] - 0.5, m[2] - 1];
    assert.ok(p.out[0] * d[0] + p.out[1] * d[1] + p.out[2] * d[2] > 0);
  }
});

test('Car Builder: a wedge slopes down to the front', () => {
  const g = partGeometry({ type: 'wedge', p: [0, 1, 0], s: [1, 1, 1], r: [0, 0, 0] });
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) if (pos.getZ(i) > 0.4) assert.ok(pos.getY(i) < 0.51);
});
