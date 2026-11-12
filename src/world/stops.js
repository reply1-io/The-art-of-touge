// Places to pull off the road: small pull-offs on the outside of some corners, a gas station at
// the start of the road, and a big car-show lot with a parts cabin halfway down. Pure JavaScript,
// shared by the terrain, the physics and the visuals so they all agree.
//
// A zone runs along the road from sample i0 to i1 on one side. Its surface starts at the outer lip
// of the drainage gutter and reaches `width` metres further out (narrower at the tapered ends).

import { GUTTER_OUT } from './road.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export const ZONE_INNER = GUTTER_OUT; // wide-road default; each zone has its own `inner`

export class Zone {
  constructor(kind, i0, i1, side, width, taper, road) {
    this.inner = road ? road.w.GUTTER_OUT : ZONE_INNER; // where the zone starts, from the centreline
    this.shoulder = road ? road.w.SHOULDER : 5.4;
    this.kind = kind; // 'pulloff' | 'station' | 'show'
    this.i0 = i0;
    this.i1 = i1;
    this.side = side;
    this.width = width;
    this.taper = taper; // samples at each end over which the width grows
  }

  contains(i) {
    return i >= this.i0 && i <= this.i1;
  }

  // Width of the zone at sample i (0 outside it).
  widthAt(i) {
    if (!this.contains(i)) return 0;
    const t = Math.min(i - this.i0, this.i1 - i);
    return this.width * smoothstep(0, this.taper, t);
  }

  // Outer edge, metres from the centreline.
  outerAt(i) {
    return this.inner + this.widthAt(i);
  }

  // Height of the zone surface at sample i, lateral distance l (metres, unsigned): it follows the
  // road's banked plane to the end of the shoulder, then stays level.
  heightAt(road, i, l) {
    return road.pointAt(i, this.side * Math.min(l, this.shoulder))[1] + 0.02;
  }
}

// The lowest-curvature stretch of n samples within [from, to] that has room on one side.
function quietStretch(road, from, to, n, need) {
  let best = null;
  for (let i = Math.max(10, from); i + n < Math.min(road.count - 10, to); i += 2) {
    let worst = 0;
    for (let j = i; j <= i + n; j++) worst = Math.max(worst, Math.abs(road.kappa[j]));
    for (const side of [-1, 1]) {
      if (best && worst >= best.worst) continue;
      let ok = true;
      for (let j = i; j <= i + n && ok; j += 3) if (road.clearance(j, side, need) < need) ok = false;
      if (ok) best = { i, side, worst };
    }
  }
  return best;
}

export function stopsFor(road) {
  const zones = [];
  const free = (i0, i1, side) => zones.every((z) => z.side !== side || i1 < z.i0 - 20 || i0 > z.i1 + 20);
  const room = (i0, i1, side, need) => {
    for (let j = i0; j <= i1; j += 2) if (road.clearance(j, side, need) < need) return false;
    return true;
  };

  // Gas station: on the right-hand side where you start, just before the start line.
  const s0 = 2;
  const s1 = Math.max(s0 + 14, road.startIndex - 8);
  const sSide = room(s0, s1, -1, 34) ? -1 : 1;
  zones.push(new Zone('station', s0, s1, sSide, 24, 3, road));

  // Car-show lot halfway down: the quietest 80 m near the middle with room beside it.
  const mid = Math.floor(road.count / 2);
  const show = quietStretch(road, mid - 120, mid + 120, 40, 34);
  if (show) zones.push(new Zone('show', show.i, show.i + 40, show.side, 22, 5, road));

  // Small pull-offs on the outside of medium corners, about every 600 m.
  let last = -1e9;
  for (let i = 40; i < road.count - 40; i++) {
    if (i - last < 300) continue;
    const k = road.kappa[i];
    if (Math.abs(k) < 1 / 90 || Math.abs(k) > 1 / 28) continue;
    const side = k > 0 ? -1 : 1; // outside of the corner
    const i0 = i - 9;
    const i1 = i + 9;
    if (!free(i0, i1, side) || !room(i0, i1, side, 22)) continue;
    zones.push(new Zone('pulloff', i0, i1, side, 5.5, 5, road));
    last = i;
  }
  return zones;
}

// The zone at sample i on `side`, if any.
export function zoneAt(zones, i, side) {
  for (const z of zones) if (z.side === side && z.contains(i)) return z;
  return null;
}

// A point in a zone: `f` is how far along it (0..1), `l` metres out from the road centreline.
// Returns { x, y, z, yaw } with yaw the road's heading there.
export function zonePoint(road, zone, f, l) {
  const j = Math.round(zone.i0 + f * (zone.i1 - zone.i0));
  const p = road.pointAt(j, zone.side * l);
  return { x: p[0], y: zone.heightAt(road, j, l), z: p[2], yaw: road.heading[j], j };
}

// Gas station: a canopy over two islands of two pumps, and the kiosk at the back of the lot.
export function stationLayout(road, zone) {
  const L0 = zone.inner;
  const canopy = zonePoint(road, zone, 0.5, L0 + 11);
  // Pillars and pumps are laid out square under the canopy (in its own frame: x across the road,
  // z along it), so they always line up with the roof, even where the road curves.
  const c = Math.cos(canopy.yaw);
  const sn = Math.sin(canopy.yaw);
  const under = (x, z) => ({ x: canopy.x + x * c + z * sn, y: canopy.y, z: canopy.z - x * sn + z * c, yaw: canopy.yaw });
  const pumps = [];
  for (const x of [-2, 2]) for (const z of [-3.6, 3.6]) pumps.push(under(x, z));
  const pillars = [];
  for (const x of [-4.6, 4.6]) for (const z of [-6.6, 6.6]) pillars.push(under(x, z));
  return {
    pumps,
    pillars,
    canopy,
    kiosk: zonePoint(road, zone, 0.5, L0 + 20.5),
    truck: zonePoint(road, zone, 0.86, L0 + 18.5), // box truck parked out of the way
    pylon: zonePoint(road, zone, 0.16, L0 + 2.2), // tall price sign by the road
    air: zonePoint(road, zone, 0.3, L0 + 19.5), // air and water stand
  };
}

// Car-show lot: a row of marked bays along the back, and the parts cabin at the far end.
export function showLayout(road, zone) {
  const L0 = zone.inner;
  const bays = [];
  for (let f = 0.14; f <= 0.66; f += 0.075) bays.push(zonePoint(road, zone, f, L0 + 16));
  return { bays, cabin: zonePoint(road, zone, 0.84, L0 + 15) };
}
