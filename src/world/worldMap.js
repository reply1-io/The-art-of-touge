// "Kaido Mountain": seven roads joined end to end into one route. It starts at the car meet on the
// summit of a big central mountain, spirals down around it, then runs a lap of the valleys around
// the mountain, each road with its own character, and finishes in the village at the bottom.
// Drive it downhill from the summit, or turn round and drive it up.
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

// The seven roads. grade: average downhill slope; roll: how much the road rises and falls on top;
// scene: what grows and stands beside it.
export const STAGES = [
  { name: 'Summit Spiral', blurb: 'Fast sweepers circling the mountain from the summit meet', grade: 0.085, roll: 0.5, scene: { trees: 0.7, maple: 0.15, rock: 0.5, ponds: 0 } },
  { name: 'Cedar Sweepers', blurb: 'Long, quick bends through tall dark cedars', grade: 0.05, roll: 0.8, scene: { trees: 1.3, maple: 0.02, rock: 0.15, ponds: 0 } },
  { name: 'Lakeside', blurb: 'Gentle curves along the lake shore, nearly flat', grade: 0.012, roll: 0.25, scene: { trees: 0.6, maple: 0.25, rock: 0, ponds: 3 } },
  { name: "Dragon's Tail", blurb: 'Hundreds of tight corners and no straights, deep in the forest', grade: 0.035, roll: 0.6, scene: { trees: 1.2, maple: 0.12, rock: 0.3, ponds: 0 } },
  { name: 'Rock Canyon', blurb: 'Medium-speed corners between mossy rock walls', grade: 0.06, roll: 0.7, scene: { trees: 0.5, maple: 0.05, rock: 1, ponds: 1 } },
  { name: 'Maple Hairpins', blurb: 'Six hairpins stacked down a hillside of red maples', grade: 0.07, roll: 0.3, scene: { trees: 0.9, maple: 0.75, rock: 0.3, ponds: 0 } },
  { name: 'Valley Run', blurb: 'Fast and flowing, down past the ponds to the village', grade: 0.03, roll: 0.6, scene: { trees: 0.8, maple: 0.2, rock: 0, ponds: 3 } },
];

// Corner styles for the six outer roads: arc radius and angle ranges, the straight between arcs,
// how far the road may point away from its general direction, and how much it drifts outward.
const STYLES = [
  null,
  { rMin: 70, rMax: 180, aMin: 30, aMax: 80, gap: 40, limit: 50, bias: 6, length: 1100 },
  { rMin: 120, rMax: 300, aMin: 15, aMax: 45, gap: 80, limit: 35, bias: 3, length: 1100 },
  { rMin: 13, rMax: 45, aMin: 35, aMax: 150, gap: 10, limit: 72, bias: 3, length: 2600 }, // the Dragon's Tail
  { rMin: 30, rMax: 70, aMin: 40, aMax: 100, gap: 25, limit: 60, bias: 5, length: 1000 },
  { hairpins: 6, leg: 75, r: 14 },
  { rMin: 90, rMax: 250, aMin: 20, aMax: 60, gap: 120, limit: 40, bias: 2, length: 1200 },
];

export function worldRoute(seed = 77) {
  const rand = mulberry(seed);
  const pts = [];
  const starts = []; // metres along the route where each road begins
  let x;
  let z;
  let h;
  let s = 0;
  const push = () => pts.push([x, z]);
  const step = (len, k) => {
    for (let d = 0; d < len; d += 1) {
      h += k;
      x += Math.sin(h);
      z += Math.cos(h);
      push();
    }
    s += len;
  };

  // ---- 1. Summit Spiral: one and a quarter turns around the peak, from 130 m out to 520 m ----
  starts.push(0);
  const turns = 1.25;
  const th0 = 0;
  const N = 2600;
  let px = null;
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const th = th0 + t * turns * 2 * Math.PI;
    const r = 130 + 390 * t + Math.sin(t * 23) * 9 * t;
    const nx = r * Math.sin(th);
    const nz = r * Math.cos(th);
    if (px && Math.hypot(nx - px[0], nz - px[1]) < 1) continue;
    pts.push([nx, nz]);
    if (px) s += Math.hypot(nx - px[0], nz - px[1]);
    px = [nx, nz];
  }
  x = px[0];
  z = px[1];
  const [ax, az] = pts[pts.length - 2];
  h = Math.atan2(x - ax, z - az);

  // ---- 2-7. The outer lap ----
  for (let st = 1; st < STYLES.length; st++) {
    starts.push(s);
    const sty = STYLES[st];
    if (sty.hairpins) {
      // Switchbacks: a leg around the mountain, a tight hairpin turning outward, a leg back, and so
      // on, stepping down the hillside away from the peak.
      let sign = -1;
      for (let k = 0; k < sty.hairpins; k++) {
        // Square up to the tangent before each leg.
        const phi = Math.atan2(x, z);
        const want = phi + Math.PI / 2 + (sign < 0 ? 0 : Math.PI);
        let d = want - h;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        step(30, d / 30);
        step(Math.round(sty.leg + rand() * 20), 0);
        step(Math.round(Math.PI * sty.r), sign / sty.r);
        sign = -sign;
      }
      step(40, 0);
      continue;
    }
    const s0 = s;
    let side = 1;
    while (s - s0 < sty.length) {
      const phi = Math.atan2(x, z);
      const base = phi + Math.PI / 2 - sty.bias * DEG;
      if (rand() < 0.75) side = -side;
      const radius = sty.rMin + Math.pow(rand(), 1.3) * (sty.rMax - sty.rMin);
      let angle = (sty.aMin + rand() * (sty.aMax - sty.aMin)) * DEG;
      let dev = h - base;
      while (dev > Math.PI) dev -= 2 * Math.PI;
      while (dev < -Math.PI) dev += 2 * Math.PI;
      const lim = sty.limit * DEG;
      if (Math.abs(dev + side * angle) > lim) {
        if (Math.abs(dev - side * angle) <= lim) side = -side;
        else angle = Math.max(0.3, lim - Math.abs(dev));
        if (Math.abs(dev + side * angle) > lim) side = -Math.sign(dev) || 1;
      }
      step(Math.round(angle * radius), side / radius);
      step(Math.round(rand() * sty.gap), 0);
    }
  }
  step(120, 0); // into the village
  return { pts, starts, length: s };
}
