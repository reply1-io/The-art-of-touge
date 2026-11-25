// The SKETCH pad's picture work, kept apart so it can be tested: the drawing is a grid of pixels,
// 1 where there is ink or fill, 0 where there is nothing.

// Which empty pixels can be reached from the edge of the pad (flood fill through empty pixels).
export function outside(mask, w, h) {
  const out = new Uint8Array(w * h);
  const stack = [];
  const push = (i) => {
    if (!out[i] && !mask[i]) {
      out[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  return out;
}

// The pixels a stroke just closed in: empty, reachable from the edge before it, not after. (A
// hole you erased earlier was already closed in, so it is left alone.)
export function newlyEnclosed(maskAfter, outsideBefore, w, h) {
  const after = outside(maskAfter, w, h);
  const fill = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (!maskAfter[i] && outsideBefore[i] && !after[i]) fill[i] = 1;
  return fill;
}

// The outlines of the filled areas, as closed loops of [x, y] in pixels (marching squares, at
// pixel corners). Returns [{ outer: loop, holes: [loop, ...] }, ...], one per separate blob.
export function outlines(mask, w, h) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);
  // Edges between filled and empty pixels, each joining two corner points.
  const segs = [];
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const a = at(x, y);
      if (a !== at(x + 1, y)) segs.push([[x + 1, y], [x + 1, y + 1]]); // vertical edge
      if (a !== at(x, y + 1)) segs.push([[x, y + 1], [x + 1, y + 1]]); // horizontal edge
    }
  }
  const key = (p) => p[0] * 100003 + p[1];
  const ends = new Map();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop = [segs[i][0]];
    let cur = segs[i][1];
    let guard = segs.length + 5;
    while (guard-- > 0) {
      if (key(cur) === key(loop[0])) break;
      loop.push(cur);
      const next = ends.get(key(cur)).find((j) => !used[j]);
      if (next == null) break;
      used[next] = 1;
      const s = segs[next];
      cur = key(s[0]) === key(cur) ? s[1] : s[0];
    }
    if (loop.length >= 4) loops.push(straighten(loop));
  }
  // Outer outlines and holes: a loop inside an odd number of others is a hole.
  const inside = (p, loop) => {
    let c = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [xi, yi] = loop[i];
      const [xj, yj] = loop[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  // A point just inside the loop's first edge, to test with.
  const probe = (loop) => [(loop[0][0] + loop[1][0]) / 2 + 0.01, (loop[0][1] + loop[1][1]) / 2 + 0.013];
  const depth = loops.map((l, i) => loops.reduce((d, o, j) => d + (i !== j && inside(probe(l), o) ? 1 : 0), 0));
  const blobs = [];
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 0) blobs.push({ outer: l, holes: [] });
  });
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 0) return;
    // The hole belongs to the deepest outer outline around it.
    let best = null;
    let bestDepth = -1;
    blobs.forEach((b, k) => {
      const d = depth[loops.indexOf(b.outer)];
      if (d > bestDepth && inside(probe(l), b.outer)) [best, bestDepth] = [k, d];
    });
    if (best != null) blobs[best].holes.push(l);
  });
  return blobs;
}

// Drop the points in the middle of straight runs.
function straighten(loop) {
  return loop.filter((p, i) => {
    const a = loop[(i + loop.length - 1) % loop.length];
    const b = loop[(i + 1) % loop.length];
    return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
  });
}

// Fewer points around a closed loop, keeping its shape within tol (same units as the loop).
export function simplifyLoop(loop, tol) {
  if (loop.length < 5) return loop;
  // Split at the two points furthest apart, and simplify each half as a line.
  let far = 0;
  let fd = 0;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2;
    if (d > fd) [fd, far] = [d, i];
  }
  const a = simplifyLine(loop.slice(0, far + 1), tol);
  const b = simplifyLine([...loop.slice(far), loop[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function simplifyLine(pts, tol) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-9;
  let worst = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > worst) [worst, at] = [d, i];
  }
  if (worst <= tol) return [a, b];
  return [...simplifyLine(pts.slice(0, at + 1), tol).slice(0, -1), ...simplifyLine(pts.slice(at), tol)];
}
