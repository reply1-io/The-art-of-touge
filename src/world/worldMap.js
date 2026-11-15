// "Kaido Mountain": eleven roads joined end to end into one loop that winds back and forth across
// the whole map. It starts at the car meet just below the summit of the central mountain, works
// its way across the hillsides past the village, and comes back round to the meet: no dead ends.
//
// Layout: the map is split into 170 m cells. The route visits the cells one after another (a walk
// that never revisits a cell), and between cell centres the road twists its way along: so two
// parts of the route are always at least a cell apart, with forest, ponds and lakes between them.
// Cells the walk misses become lakes. Every road is all corners: no straight is long enough to
// get near 80 mph.
//
// Generated in world metres from a fixed seed, so it is the same every time.

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEG = Math.PI / 180;
export const CELL = 170; // metres between cell centres
const RMAX = 760; // cells whose centre is within this of the peak are part of the map

// Corner styles. r: arc radius range; a: arc angle range (degrees); gap: longest link between
// arcs; limit: how far the road may point away from the way it is heading (degrees). hairpins:
// switchbacks across the hillside instead of arcs.
const STYLE = {
  hairpins: { hairpins: true },
  tight: { r: [13, 40], a: [40, 150], gap: 8, limit: 75 }, // the Dragon's Tail
  technical: { r: [18, 55], a: [35, 120], gap: 14, limit: 70 },
  medium: { r: [25, 75], a: [30, 100], gap: 20, limit: 62 },
  flowing: { r: [35, 80], a: [25, 85], gap: 16, limit: 58 },
};

// The eleven roads, in route order. cells: how many cell-to-cell legs each takes (scaled to fit
// the walk); grade is not used any more: heights come from the mountain itself (heightAt).
export const STAGES = [
  { name: 'Summit Switchbacks', blurb: 'Hairpin after hairpin down from the car meet', style: 'hairpins', cells: 3, scene: { trees: 0.7, maple: 0.2, rock: 0.6, ponds: 0 } },
  { name: 'Cedar Esses', blurb: 'Linked bends through tall dark cedars', style: 'medium', cells: 5, scene: { trees: 1.3, maple: 0.02, rock: 0.15, ponds: 0 } },
  { name: 'Lakeside', blurb: 'Flowing curves between the ponds', style: 'flowing', cells: 5, scene: { trees: 0.6, maple: 0.25, rock: 0, ponds: 3 } },
  { name: "Dragon's Tail", blurb: 'Hundreds of tight corners and no straights, deep in the forest', style: 'tight', cells: 8, scene: { trees: 1.2, maple: 0.12, rock: 0.3, ponds: 0 } },
  { name: 'Rock Canyon', blurb: 'Medium corners between mossy rock walls', style: 'technical', cells: 5, scene: { trees: 0.5, maple: 0.05, rock: 1, ponds: 1 } },
  { name: 'Maple Hairpins', blurb: 'Switchbacks stacked down a hillside of red maples', style: 'hairpins', cells: 3, scene: { trees: 0.9, maple: 0.75, rock: 0.3, ponds: 0 } },
  { name: 'Shrine Road', blurb: 'Narrow, twisting, past the old shrine', style: 'technical', cells: 4, scene: { trees: 1, maple: 0.35, rock: 0.4, ponds: 1 } },
  { name: 'Fox Hollow', blurb: 'Quick esses through the hollows', style: 'medium', cells: 5, scene: { trees: 1.1, maple: 0.15, rock: 0.2, ponds: 2 } },
  { name: 'Waterfall Pass', blurb: 'Tight and steep along the falls', style: 'tight', cells: 4, scene: { trees: 0.8, maple: 0.1, rock: 0.8, ponds: 1 } },
  { name: 'Old Logging Road', blurb: 'Bumpy, tight and forgotten', style: 'technical', cells: 4, scene: { trees: 1.4, maple: 0.05, rock: 0.2, ponds: 0 } },
  { name: 'Valley Run', blurb: 'Flowing past the village and back up to the meet', style: 'flowing', cells: 5, scene: { trees: 0.8, maple: 0.2, rock: 0, ponds: 3 } },
];

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The lie of the land: a broad mountain in the middle falling to the valleys at the edge, with
// rolling hills on top. Roads follow it, so neighbouring roads sit at matching heights.
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  return 125 * (1 - smoothstep(60, 980, r)) + 9 * Math.sin(x / 210 + 1.3) * Math.cos(z / 190 + 0.4) + 6 * Math.sin((x - z) / 120 + 2.1);
}

// A walk over the cells that never revisits one, from a cell next to the peak back to a cell next
// to where it started (so the route closes into a loop), covering most of the map: a depth-first search that tries the neighbour with the
// fewest free neighbours of its own first (so it does not wall itself in), and backs up when stuck.
function cellWalk(rand) {
  const key = (i, j) => `${i},${j}`;
  const lim = Math.ceil(RMAX / CELL);
  const cells = [];
  for (let i = -lim; i <= lim; i++) for (let j = -lim; j <= lim; j++) if ((i || j) && Math.hypot(i, j) * CELL <= RMAX) cells.push([i, j]);
  const free = new Set(cells.map(([i, j]) => key(i, j)));
  const total = cells.length;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const degree = (i, j) => dirs.reduce((n, [a, b]) => n + (free.has(key(i + a, j + b)) ? 1 : 0), 0);
  const goal = Math.ceil(total * 0.9);
  const start = dirs[Math.floor(rand() * 4)];
  const path = [start];
  free.delete(key(...start));
  let budget = 60000;
  const dfs = () => {
    const [li, lj] = path[path.length - 1];
    if (path.length >= goal && Math.abs(li - start[0]) + Math.abs(lj - start[1]) === 1) return true;
    if (--budget < 0) return false;
    const [i, j] = path[path.length - 1];
    const next = dirs
      .map(([a, b]) => [i + a, j + b])
      .filter(([x, y]) => free.has(key(x, y)))
      .map((c) => [c, degree(...c) + rand() * 0.8])
      .sort((p, q) => p[1] - q[1]);
    for (const [c] of next) {
      path.push(c);
      free.delete(key(...c));
      if (dfs()) return true;
      path.pop();
      free.add(key(...c));
    }
    return false;
  };
  if (!dfs()) return null;
  const holes = [...free].map((k) => k.split(',').map(Number));
  return { path, holes, total };
}

// seed: a seed known to work (the route is checked as it is built); if it does not, the seeds
// after it are tried in turn.
export function worldRoute(seed = 1000) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const out = tryRoute(seed + attempt);
    if (out) return out;
  }
  throw new Error('no route');
}

function tryRoute(seed) {
  const rand = mulberry(seed);
  const walk = cellWalk(rand);
  if (!walk) return null;
  const { path, holes } = walk;

  // Cell centres, nudged a little so the grid does not show.
  const wps = path.map(([i, j]) => [i * CELL + (rand() - 0.5) * 30, j * CELL + (rand() - 0.5) * 30]);
  // ...and back to the first cell to close the loop.
  wps.push(wps[0]);
  const legs = wps.length - 1;

  // Share the legs out between the roads.
  const want = STAGES.reduce((n, st) => n + st.cells, 0);
  const legStage = [];
  let acc = 0;
  STAGES.forEach((st, k) => {
    acc += st.cells;
    const end = k === STAGES.length - 1 ? legs : Math.round((acc / want) * legs);
    while (legStage.length < end) legStage.push(k);
  });

  const pts = [];
  const starts = [];
  let [x, z] = wps[0];
  let h = Math.atan2(wps[1][0] - x, wps[1][1] - z);
  let s = 0;
  const step = (len, k) => {
    for (let d = 0; d < len; d += 1) {
      h += k;
      x += Math.sin(h);
      z += Math.cos(h);
      pts.push([x, z]);
    }
    s += len;
  };
  const wrap = (a) => {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  };
  // Turn to face heading `want` on an arc of radius r.
  const face = (want, r) => {
    const d = wrap(want - h);
    if (Math.abs(d) > 0.01) step(Math.max(1, Math.round(Math.abs(d) * r)), d / Math.max(1, Math.round(Math.abs(d) * r)));
  };
  pts.push([x, z]);
  const [x0, z0, h0] = [x, z, h];
  step(36, 0); // out of the car meet

  let side = 1;
  for (let leg = 0; leg < legs; leg++) {
    const k = legStage[leg];
    if (starts.length === k) starts.push(s);
    const sty = STYLE[STAGES[k].style];
    const [ax, az] = wps[leg];
    const [bx, bz] = wps[leg + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const along = () => (x - ax) * ux + (z - az) * uz;
    const closing = leg === legs - 1;
    const lateral = () => (x - ax) * uz - (z - az) * ux;

    // (Not on the first leg: the meet's lot sits beside it.)
    if (sty.hairpins && len > 120 && leg > 0) {
      // Switchbacks across the leg: legs out to one side and back, a hairpin at each end, each
      // pair of hairpins stepping 30 m along the leg.
      const r = 15;
      const W = 34; // how far either side of the line the hairpins sit
      const dirU = Math.atan2(ux, uz);
      let sgn = lateral() > 0 ? -1 : 1; // head across toward the far side first
      face(dirU + (sgn * Math.PI) / 2, 18);
      let pins = 0;
      while (along() < len - 70 && pins++ < 12) {
        // Run across to the far side, then hairpin back.
        const target = sgn * W;
        const run = Math.max(8, Math.round(Math.abs(target - lateral())));
        step(run, 0);
        // Turn the way that moves along the leg.
        const tx = Math.cos(h);
        const tz = -Math.sin(h);
        const turn = tx * ux + tz * uz > 0 ? 1 : -1;
        step(Math.round(Math.PI * r), turn / r);
        sgn = -sgn;
      }
      // Back to the line, and on toward the next cell.
      step(Math.max(6, Math.round(Math.abs(lateral()) - 18)), 0);
      continue;
    }

    // Twisting along the leg: each corner is aimed at a point a little further along the line,
    // so the road wriggles about it but always makes progress.
    const style = leg === 0 ? STYLE.medium : sty.hairpins ? STYLE.technical : sty;
    let guard = 0;
    while (along() < len - (closing ? 65 : 30) && guard++ < 200) {
      const t = Math.min(len, Math.max(0, along()) + 55);
      const aimX = ax + ux * t;
      const aimZ = az + uz * t;
      const base = Math.atan2(aimX - x, aimZ - z);
      if (rand() < 0.78) side = -side;
      const radius = style.r[0] + Math.pow(rand(), 1.3) * (style.r[1] - style.r[0]);
      let angle = (style.a[0] + rand() * (style.a[1] - style.a[0])) * DEG;
      const dev = wrap(h - base);
      const lim = style.limit * DEG;
      if (Math.abs(dev + side * angle) > lim) {
        if (Math.abs(dev - side * angle) <= lim) side = -side;
        else angle = Math.max(0.3, lim - Math.abs(dev));
        if (Math.abs(dev + side * angle) > lim) side = -Math.sign(dev) || 1;
      }
      step(Math.max(4, Math.round(angle * radius)), side / radius);
      step(Math.round(rand() * style.gap), 0);
    }
  }
  // Close the loop: one smooth curve back into the start, facing the way the route set off.
  {
    const d = Math.hypot(x0 - x, z0 - z);
    const c = d * 0.36;
    const P = [
      [x, z],
      [x + Math.sin(h) * c, z + Math.cos(h) * c],
      [x0 - Math.sin(h0) * c, z0 - Math.cos(h0) * c],
      [x0, z0],
    ];
    const m = Math.ceil(d * 1.4);
    let [px, pz] = [x, z];
    for (let q = 1; q <= m; q++) {
      const t = q / m;
      const u = 1 - t;
      const bx = u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0];
      const bz = u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1];
      s += Math.hypot(bx - px, bz - pz);
      pts.push([bx, bz]);
      [px, pz] = [bx, bz];
    }
  }

  // Never closer than 40 m to another part of the route (24 m within the same stretch).
  const G = 40;
  const grid = new Map();
  for (let i = 0; i < pts.length; i += 3) {
    const kx = Math.floor(pts[i][0] / G);
    const kz = Math.floor(pts[i][1] / G);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const j of grid.get(`${kx + a},${kz + b}`) || []) {
          // Switchback legs sit 30 m apart; anything else keeps a full 40 m away.
          // Measured round the loop both ways: the end joins up with the start.
          const gap = Math.min(i - j, pts.length - (i - j));
          const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
          if ((gap > 150 && d < 23) || (gap > 700 && d < G)) return null;
        }
      }
    }
    const kk = `${kx},${kz}`;
    if (!grid.has(kk)) grid.set(kk, []);
    grid.get(kk).push(i);
  }
  // Cells the route missed, for lakes.
  const empty = holes.map(([i, j]) => [i * CELL, j * CELL]);
  return { pts, starts, length: s, empty, seed, cells: path, wps: wps.slice(0, -1) };
}

// ---------- Link roads: junctions off the loop ----------
// Where two parts of the loop pass close by each other (70-190 m apart) but are far apart along
// the road, a short twisty road can join them: turn off at a junction on one and come out on the
// other. Each link starts and ends square to the loop, at the edge of its tarmac, on a gentle bit
// of road, and gets switchbacks if it has a lot of height to make up.
//
// road: the loop as built (Road). avoid(i): true where the loop has a lot or pull-off that a
// junction must not cut into. Returns [{ pts, a, b, sideA, sideB }]: the link's points (world
// metres) and the loop samples and sides it leaves from and joins.
export function planLinks(road, W, avoid = () => false, count = 8, seed = 7) {
  const rand = mulberry(seed);
  const PAV = road.w.PAVED + 0.3;
  const n = road.count;
  // Junction spots: gentle bits of road clear of lots, gutters and the meet.
  const flatAt = (i) => {
    if (i < 60 || i > n - 60 || avoid(i)) return false;
    for (let j = i - 3; j <= i + 3; j++) if (Math.abs(road.kappa[j]) > 1 / 28 || road.gutterLeft[j] || road.gutterRight[j]) return false;
    return true;
  };
  const spots = [];
  for (let i = 60; i < n - 60; i += 5) if (flatAt(i)) spots.push(i);
  // Is the straight line between two points clear of the loop (away from its ends)?
  const lineClear = (ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az);
    for (let d = 22; d < L - 22; d += 6) {
      const px = ax + ((bx - ax) * d) / L;
      const pz = az + ((bz - az) * d) / L;
      let hit = false;
      road.forEachNear(px, pz, 20, (k) => {
        if (!hit && Math.hypot(road.x[k] - px, road.z[k] - pz) < 18) hit = true;
      });
      if (hit) return false;
    }
    return true;
  };
  const pairs = [];
  for (const i of spots) {
    const hi = road.heading[i];
    road.forEachNear(road.x[i], road.z[i], 190, (j) => {
      if (j <= i || !flatAt(j)) return;
      const along = Math.min(j - i, n - (j - i));
      if (along < 300) return;
      const dx = road.x[j] - road.x[i];
      const dz = road.z[j] - road.z[i];
      const D = Math.hypot(dx, dz);
      if (D < 70 || D > 190) return;
      // Square to the road at both ends.
      const si = (dx * Math.cos(hi) - dz * Math.sin(hi)) / D;
      const hj = road.heading[j];
      const sj = (-dx * Math.cos(hj) + dz * Math.sin(hj)) / D;
      if (Math.abs(si) < 0.6 || Math.abs(sj) < 0.6) return;
      const dy = Math.abs(road.y[j] - road.y[i]);
      if (dy / D > 0.3) return;
      if (!lineClear(road.x[i], road.z[i], road.x[j], road.z[j])) return;
      pairs.push({ i, j, sideA: Math.sign(si), sideB: Math.sign(sj), score: Math.abs(si) + Math.abs(sj) - Math.abs(D - 120) / 120 - dy / D + rand() * 0.6 });
    });
  }
  pairs.sort((p, q) => q.score - p.score);
  const usedAt = [];
  const links = [];
  const wrap = (a) => {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  };
  const farFromUsed = (i) => usedAt.every((u) => Math.min(Math.abs(u - i), n - Math.abs(u - i)) > 120);
  for (const pr of pairs) {
    if (links.length >= count) break;
    if (!farFromUsed(pr.i) || !farFromUsed(pr.j)) continue;
    const A = { i: pr.i, side: pr.sideA };
    const B = { i: pr.j, side: pr.sideB };
    const pa = road.pointAt(A.i, A.side * PAV);
    const pb = road.pointAt(B.i, B.side * PAV);
    // Heading straight out from the loop at A; arriving straight in at B.
    const hA = road.heading[A.i] + (A.side * Math.PI) / 2;
    const hB = road.heading[B.i] + (B.side * Math.PI) / 2 + Math.PI;
    const pts = [[pa[0], pa[2]]];
    let x = pa[0];
    let z = pa[2];
    let h = hA;
    const step = (len, k) => {
      for (let d = 0; d < len; d++) {
        h += k;
        x += Math.sin(h);
        z += Math.cos(h);
        pts.push([x, z]);
      }
    };
    step(12, 0);
    // Steep between the two ends? Switchbacks first, to make the road long enough to climb gently.
    const need = Math.abs(road.y[B.i] - road.y[A.i]) / 0.085 + 30;
    const extra = need - (12 + Math.hypot(pb[0] - x, pb[2] - z) * 1.25);
    if (extra > 0) {
      const W = 28; // the switchbacks reach this far either side of the line from A to B
      const r = 14;
      const ux = (pb[0] - x) / Math.hypot(pb[0] - x, pb[2] - z);
      const uz = (pb[2] - z) / Math.hypot(pb[0] - x, pb[2] - z);
      const ox = x;
      const oz = z;
      const lateral = () => (x - ox) * uz - (z - oz) * ux;
      const dirU = Math.atan2(ux, uz);
      let sgn = 1;
      // Face across the line, then run back and forth, a hairpin at each end.
      const want = dirU + (sgn * Math.PI) / 2;
      const dd = wrap(want - h);
      const n0 = Math.max(1, Math.round(Math.abs(dd) * 14));
      step(n0, dd / n0);
      let got = 0;
      for (let pin = 0; pin < 10 && got < extra; pin++) {
        const run = Math.max(6, Math.round(Math.abs(sgn * W - lateral())));
        step(run, 0);
        const tx = Math.cos(h);
        const tz = -Math.sin(h);
        const turn = tx * ux + tz * uz > 0 ? 1 : -1;
        step(Math.round(Math.PI * r), turn / r);
        got += run + Math.PI * r - 2 * r;
        sgn = -sgn;
      }
      step(Math.max(6, Math.round(Math.abs(lateral()))), 0);
    }
    let side = 1;
    let guard = 0;
    while (Math.hypot(pb[0] - x, pb[2] - z) > 65 && guard++ < 60) {
      const base = Math.atan2(pb[0] - x, pb[2] - z);
      if (rand() < 0.8) side = -side;
      const radius = 22 + rand() * 30;
      let angle = (25 + rand() * 60) * DEG;
      const dev = wrap(h - base);
      const lim = 55 * DEG;
      if (Math.abs(dev + side * angle) > lim) {
        if (Math.abs(dev - side * angle) <= lim) side = -side;
        else angle = Math.max(0.2, lim - Math.abs(dev));
        if (Math.abs(dev + side * angle) > lim) side = -Math.sign(dev) || 1;
      }
      step(Math.max(4, Math.round(Math.min(angle * radius, 40))), side / radius);
      step(Math.round(rand() * 8), 0);
    }
    if (guard >= 60) continue;
    // Into the loop at B along a smooth curve.
    const d = Math.hypot(pb[0] - x, pb[2] - z);
    const c = d * 0.42;
    const P = [[x, z], [x + Math.sin(h) * c, z + Math.cos(h) * c], [pb[0] - Math.sin(hB) * c, pb[2] - Math.cos(hB) * c], [pb[0], pb[2]]];
    const m = Math.ceil(d * 1.3);
    for (let q = 1; q <= m; q++) {
      const t = q / m;
      const u = 1 - t;
      pts.push([0, 1].map((e) => u * u * u * P[0][e] + 3 * u * u * t * P[1][e] + 3 * u * t * t * P[2][e] + t * t * t * P[3][e]));
    }
    // Keep away from the loop (apart from near its two ends) and from the other links.
    let ok = true;
    const len = pts.length;
    for (let q = 0; q < len && ok; q += 3) {
      const [px, pz] = pts[q];
      const nearEnd = Math.min(q, len - 1 - q);
      const clear = nearEnd < 18 ? 0 : nearEnd < 36 ? 11 : 22;
      if (clear) {
        road.forEachNear(px, pz, clear + 2, (i) => {
          if (ok && Math.hypot(road.x[i] - px, road.z[i] - pz) < clear) ok = false;
        });
      }
      for (const o of links) for (let r = 0; r < o.pts.length && ok; r += 4) if (Math.hypot(o.pts[r][0] - px, o.pts[r][1] - pz) < 40) ok = false;
    }
    if (!ok) continue;
    usedAt.push(A.i, B.i);
    links.push({ pts, a: A.i, b: B.i, sideA: A.side, sideB: B.side });
  }
  return links;
}
