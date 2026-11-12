// "Dragon's Tail": a road in the spirit of the Tail of the Dragon (US 129, Deals Gap) - corner after
// corner after corner with no real straights. Generated from a fixed seed so it is the same every time.
//
// The road is built from linked arcs (radius 13-45 m, 35-150 degrees each) joined by short transitions
// of at most 10 m. Its heading always stays within 75 degrees of due east, so the road only ever moves
// east overall and can never cross itself, however much it wriggles.

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

export function dragonPoints(length = 8000, seed = 318) {
  const rand = mulberry(seed);
  const base = Math.PI / 2; // due east (heading = atan2(dx, dz))
  const limit = (75 * Math.PI) / 180;
  const pts = [[0, 0]];
  let x = 0;
  let z = 0;
  let h = base;
  let s = 0;
  let side = 1;
  const step = (len, k) => {
    for (let d = 0; d < len; d += 1) {
      h += k;
      x += Math.sin(h);
      z += Math.cos(h);
      pts.push([x, z]);
    }
    s += len;
  };
  step(80, 0); // the start straight by the store
  while (s < length - 120) {
    // Mostly alternate left and right; sometimes link two corners the same way.
    if (rand() < 0.78) side = -side;
    const radius = 13 + Math.pow(rand(), 1.4) * 32;
    let angle = ((35 + rand() * 115) * Math.PI) / 180;
    const dev = h - base;
    // Keep within the heading band: turn the other way, or shorten the corner.
    if (Math.abs(dev + side * angle) > limit) {
      if (Math.abs(dev - side * angle) <= limit) side = -side;
      else angle = Math.max(0.35, limit - Math.abs(dev));
      if (Math.abs(dev + side * angle) > limit) side = -Math.sign(dev) || 1;
    }
    step(Math.round(angle * radius), side / radius);
    step(Math.round(rand() * 10), 0);
  }
  step(120, 0); // run-out into the finish
  return pts;
}
