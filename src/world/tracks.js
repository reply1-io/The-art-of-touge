// The roads you can drive.
import { Road } from './road.js';
import { AKINA_POINTS } from './akinaMap.js';
import { dragonPoints } from './dragonMap.js';
import { worldRoute, STAGES } from './worldMap.js';

const WORLD = worldRoute(81);
// The stage a distance along the world route belongs to.
export function stageAt(s) {
  let k = 0;
  while (k + 1 < WORLD.starts.length && WORLD.starts[k + 1] <= s) k++;
  return k;
}

export const TRACKS = {
  akina: {
    name: 'Akina',
    blurb: '5 km downhill · five hairpins',
    road: () => new Road(AKINA_POINTS, 5000, { width: 'narrow' }), // skinny Japanese touge road
    cornerLights: true,
    relief: 110, // ridges and valleys away from the road (m)
    peaks: 750, // height of the surrounding ranges (m)
    waterfalls: 2,
    rockCuts: false,
  },
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
    blurb: '9.5 km · seven roads around a big mountain',
    road: () =>
      new Road(WORLD.pts, 0, {
        world: true,
        twistGain: 0.3,
        gradeAt: (s) => {
          const st = STAGES[stageAt(s)];
          return { base: st.grade, roll: st.roll };
        },
      }),
    stages: STAGES.map((st, k) => ({ ...st, s0: WORLD.starts[k], s1: WORLD.starts[k + 1] ?? WORLD.length })),
    stageAt,
    cornerLights: true,
    relief: 120,
    peaks: 520,
    waterfalls: 6,
    rockCuts: true,
    world: true,
    // The summit car meet at the start, looking out from the mountain; the gas station by the lake.
    stopsOpts: { meetAtStart: true, meetSide: -1, stationAt: WORLD.starts[2] + 60 },
    // The peak the first road circles.
    peak: (road) => ({ x: 0, z: 0, r: 125, top: road.top + 6, rise: 70 }),
    // A lake by the Lakeside road and ponds wherever a road has them.
    lakes: (road) => worldLakes(road),
  },
};

// Lakes and ponds beside the roads that have them, on whichever side has open ground.
function worldLakes(road) {
  const out = [];
  STAGES.forEach((st, k) => {
    const n = st.scene.ponds;
    if (!n) return;
    const s0 = WORLD.starts[k] + 120;
    const s1 = (WORLD.starts[k + 1] ?? WORLD.length) - 120;
    for (let m = 0; m < n; m++) {
      const big = k === 2 && m === 1; // the lake proper, mid-way along Lakeside
      const r = big ? 95 : 22 + ((m * 37 + k * 11) % 20);
      const i = Math.round((s0 + ((s1 - s0) * (m + 0.5)) / n) / 2);
      for (const side of [1, -1]) {
        const off = 16 + r;
        if (road.clearance(i, side, off + r + 20) < off + r + 20) continue;
        const [x, , z] = road.pointAt(i, side * off);
        if (out.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + r + 30)) continue;
        out.push({ x, z, r, level: road.y[i] - 3.5 });
        break;
      }
    }
  });
  return out;
}
