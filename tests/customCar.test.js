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
  const part = { type: 'box', p: [0.6, 0.5, 1], s: [0.2, 0.2, 0.2], r: [0, 20, 0], mat: 'trim', mirror: true, d: 1 };
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

test('Car Builder: start from the E30 or the RX-7 body, and build onto it', async () => {
  await import('../src/render/carModel.js').catch(() => null); // registers the stock bodies (needs no DOM to load)
  const { stockPartPolys } = await import('../src/render/shapes/custom.js');
  for (const model of ['e30', 'rx7']) {
    const part = { type: 'stock', model, p: [0, 0, 0], s: [1, 1, 1], r: [0, 0, 0], mat: 'paint' };
    const sp = stockPartPolys(part);
    assert.ok(sp, `${model} registered`);
    assert.ok(sp.paint.length > 50 && sp.glass.length > 0 && sp.tail.length > 0, model);
    const shape = customShape({ id: 'custom-x', parts: [part, { type: 'wedge', p: [0, 1.2, -2], s: [1.4, 0.1, 0.3], r: [0, 0, 0], mat: 'black' }] });
    assert.ok(shape.nose > 1.85 && shape.tail < -1.95, `${model} ${shape.nose} ${shape.tail}`);
    // Moved up 10 cm, every point moves up 10 cm.
    const up = stockPartPolys({ ...part, p: [0, 0.1, 0] });
    assert.ok(Math.abs(up.paint[0].pts[0][1] - sp.paint[0].pts[0][1] - 0.1) < 1e-9);
  }
  // The E30's round headlamps come along.
  assert.equal(stockPartPolys({ type: 'stock', model: 'e30', p: [0, 0, 0], s: [1, 1, 1], r: [0, 0, 0] }).head.length, 4 * 12); // four round lamps, 12 triangles each
});

test('Car Builder: dragging a corner reshapes the part, and moves with it', async () => {
  const { partMesh, baseMesh } = await import('../src/render/shapes/custom.js');
  const part = { type: 'box', p: [0, 1, 0], s: [2, 1, 4], r: [0, 0, 0], mat: 'paint', d: 1 };
  const base = baseMesh(part);
  assert.equal(base.verts.length, 8); // a plain box: 8 corners
  const i = base.verts.findIndex((v) => v[0] > 0 && v[1] > 0 && v[2] > 0);
  const before = partMesh(part).verts[i];
  part.edits = { [i]: [0, 0.2, 0] }; // up a fifth of the height
  const after = partMesh(part).verts[i];
  assert.ok(Math.abs(after[1] - before[1] - 0.2) < 1e-9);
  // Every corner has its mirror image across the middle of the car.
  assert.ok(base.mirror.every((m) => m >= 0));
  // A stock body: hundreds of corners, every one welded so faces meeting there move together.
  await import('../src/render/carModel.js');
  const e30 = baseMesh({ type: 'stock', model: 'e30' });
  assert.ok(e30.verts.length > 200, `${e30.verts.length} corners`);
});

test('Car Builder: a sketched outline becomes a solid shape, facing out, any way it was drawn', async () => {
  const { partMesh, baseMesh, designPolys } = await import('../src/render/shapes/custom.js');
  // An L-shaped outline (not convex), 1 m by 0.6 m.
  const o = [[-0.5, -0.3], [0.5, -0.3], [0.5, 0], [0, 0], [0, 0.3], [-0.5, 0.3]];
  for (const view of ['side', 'top', 'front']) {
    const s = view === 'side' ? [0.2, 1, 1] : view === 'top' ? [1, 0.2, 1] : [1, 1, 0.2];
    const part = { type: 'sketch', view, o, p: [0, 1, 0], s, r: [0, 0, 0], mat: 'paint', d: 1 };
    assert.ok(baseMesh(part).faces.length >= 20, view);
    const { verts } = partMesh(part);
    const span = (k) => Math.max(...verts.map((v) => v[k])) - Math.min(...verts.map((v) => v[k]));
    const thick = view === 'side' ? 0 : view === 'top' ? 1 : 2;
    assert.ok(Math.abs(span(thick) - 0.2) < 1e-6, `${view} thickness ${span(thick)}`);
    // Every face of a plain rectangle points away from the middle of the solid.
    const polys = designPolys({ parts: [{ ...part, o: [[-0.5, -0.3], [0.5, -0.3], [0.5, 0.3], [-0.5, 0.3]] }] }).paint;
    let outward = 0;
    for (const p of polys) {
      const m = p.pts.reduce((a, v) => [a[0] + v[0] / 3, a[1] + v[1] / 3, a[2] + v[2] / 3], [0, 0, 0]);
      const d = [m[0], m[1] - 1, m[2]];
      if (p.out[0] * d[0] + p.out[1] * d[1] + p.out[2] * d[2] > 0) outward++;
    }
    assert.equal(outward, polys.length, `${view}: ${outward}/${polys.length} facing out`);
  }
});

test('Car Builder: the E30 and RX-7 come apart in about 50 pieces, covering the whole body', async () => {
  await import('../src/render/carModel.js');
  const { stockPieces, splitStock, designPolys } = await import('../src/render/shapes/custom.js');
  for (const model of ['e30', 'rx7']) {
    const pieces = stockPieces(model);
    assert.ok(pieces.length >= 40 && pieces.length <= 60, `${model}: ${pieces.length} pieces`);
    assert.equal(new Set(pieces.map((p) => p.name)).size, pieces.length, 'every piece has its own name');
    const whole = { type: 'stock', model, p: [0, 0, 0], s: [1, 1, 1], r: [0, 0, 0], mat: 'paint' };
    const count = (parts) => Object.values(designPolys({ parts })).reduce((n, l) => n + l.length, 0);
    assert.equal(count(splitStock(whole)), count([whole]), `${model}: the pieces make the whole body`);
  }
});
