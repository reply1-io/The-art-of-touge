// The roads you can drive.
import { Road } from './road.js';
import { dragonPoints } from './dragonMap.js';
import { worldRoute, STAGES, heightAt, CELL } from './worldMap.js';

const WORLD = worldRoute(15319);
// The stage a distance along the world route belongs to.
export function stageAt(s) {
  let k = 0;
  while (k + 1 < WORLD.starts.length && WORLD.starts[k + 1] <= s) k++;
  return k;
}

export const TRACKS = {
  dragon: {
    name: "Dragon's Tail",
    blurb: '8 km · hundreds of corners, no straights',
    road: () => new Road(dragonPoints(8000), 0, { world: true, gradeBase: 0.02, twistGain: 0.2 }),
    cornerLights: false,
    relief: 150,
    peaks: 1100,
    waterfalls: 5,
    rockCuts: true,
  },
  world: {
    name: 'Kaido Mountain',
    blurb: `${Math.round(WORLD.length / 1000)} km loop · eleven twisting roads across a mountain`,
    road: () => new Road(WORLD.pts, 0, { world: true, heightAt, loop: true }),
    stages: STAGES.map((st, k) => ({ ...st, s0: WORLD.starts[k], s1: WORLD.starts[k + 1] ?? WORLD.length })),
    stageAt,
    // The village sits on the Valley Run, at the point furthest from the peak.
    town: (road) => {
      const k = STAGES.length - 1;
      let best = 0;
      for (let i = Math.round(WORLD.starts[k] / 2); i < road.count - 200; i++) if (Math.hypot(road.x[i], road.z[i]) > Math.hypot(road.x[best], road.z[best])) best = i;
      return { i: best, r: 85 };
    },
    cornerLights: true,
    relief: 120,
    peaks: 520,
    waterfalls: 6,
    rockCuts: true,
    world: true,
    // The summit car meet at the start, looking out from the mountain; the gas station by the lake.
    stopsOpts: { meetAtStart: true, meetSide: -1, stationAt: WORLD.starts[2] + 60 },
    // The peak in the middle of the map, rising above the highest road.
    peak: (road) => ({ x: 0, z: 0, r: 120, top: road.top + 4, rise: 95 }),
    // Lakes in the cells the route misses, ponds in the gaps between roads, and ponds beside the
    // roads that have them.
    lakes: (road) => worldLakes(road),
  },
};

// Lakes and ponds: a lake in each cell the route misses, ponds in the corners between cells where
// roads leave room, and ponds beside the roads that have them.
function worldLakes(road) {
  const out = [];
  // Distance from (x, z) to the nearest road, and the lowest road height nearby.
  const near = (x, z, reach) => {
    let d = Infinity;
    let low = Infinity;
    for (let i = 0; i < road.count; i += 2) {
      const e = Math.hypot(road.x[i] - x, road.z[i] - z);
      if (e < d) d = e;
      if (e < reach) low = Math.min(low, road.y[i]);
    }
    return { d, low };
  };
  const free = (x, z, r) => !out.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + r + 25);
  const add = (x, z, rMax, rMin) => {
    const n = near(x, z, rMax + 70);
    const r = Math.min(rMax, n.d - 24);
    if (r < rMin || !free(x, z, r) || Math.hypot(x, z) < 200) return;
    out.push({ x, z, r, level: (n.low === Infinity ? road.y[0] : n.low) - 3.5 });
  };
  for (const [x, z] of WORLD.empty) add(x, z, 85, 30);
  for (let i = -5; i <= 4; i++) {
    for (let j = -5; j <= 4; j++) {
      const x = (i + 0.5) * CELL;
      const z = (j + 0.5) * CELL;
      if (Math.hypot(x, z) > 800) continue;
      // Not every gap: about half, picked by position.
      if ((i * 7 + j * 13 + 40) % 5 > 1) continue;
      add(x, z, 34, 16);
    }
  }
  STAGES.forEach((st, k) => {
    const n = st.scene.ponds;
    if (!n) return;
    const s0 = WORLD.starts[k] + 80;
    const s1 = (WORLD.starts[k + 1] ?? WORLD.length) - 80;
    for (let m = 0; m < n; m++) {
      const r = 18 + ((m * 37 + k * 11) % 14);
      const i = Math.round((s0 + ((s1 - s0) * (m + 0.5)) / n) / 2);
      for (const side of [1, -1]) {
        const off = 16 + r;
        if (road.clearance(i, side, off + r + 20) < off + r + 20) continue;
        const [x, , z] = road.pointAt(i, side * off);
        if (!free(x, z, r)) continue;
        out.push({ x, z, r, level: road.y[i] - 3.5 });
        break;
      }
    }
  });
  return out;
}
