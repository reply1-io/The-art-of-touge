// People at the side of the road: crowds in the lots and pulloffs and little groups on the outside
// of the good corners, most of them filming on their phones. Where everyone stands is worked out
// here (pure JavaScript) so the visuals and the physics agree.
//
// A person: { x, y, z, yaw (facing), pose, look: [shirt, pants, skin, hat], i (road sample) }
// pose: 0 filming (phone held up in both hands), 1 filming one-handed, arm high, 2 arms crossed,
// 3 pointing, 4 photographer behind a camera on a tripod.

import { zonePoint } from './stops.js';

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

export const SHIRTS = [0xc0392b, 0x2c3e50, 0xecf0f1, 0x1b1b1b, 0x2e86c1, 0xf39c12, 0x27ae60, 0x8e44ad, 0x7f8c8d, 0xd35400, 0xf1c40f, 0x16a085];
export const PANTS = [0x1f2a44, 0x2b2b2b, 0x4a4036, 0x5d6d7e, 0x34495e, 0x6e5a40];
export const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0x5c3a21, 0xffdbac];

// Facing from the roadside toward the road at sample i, standing on `side`.
const facing = (road, i, side) => road.heading[i] - (side * Math.PI) / 2;

export function crowdsFor(road, terrain, { seed = 7, busy = 1 } = {}) {
  const rand = mulberry(seed);
  const people = [];
  const cars = []; // parked at the pulloffs: { x, y, z, yaw, paint }
  const pick = (n) => Math.floor(rand() * n);
  const look = () => [pick(SHIRTS.length), pick(PANTS.length), pick(SKIN.length), rand() < 0.35 ? pick(4) : -1];
  const pose = () => {
    const r = rand();
    return r < 0.42 ? 0 : r < 0.62 ? 1 : r < 0.8 ? 2 : r < 0.92 ? 3 : 4;
  };
  const add = (x, z, yaw, i, p = pose()) => {
    const y = terrain.heightAt(x, z);
    people.push({ x, y, z, yaw: yaw + (rand() - 0.5) * 0.7, pose: p, look: look(), i });
  };
  const zones = terrain.zones || [];

  // In the lots: a crowd along the road edge, watching and filming.
  for (const zn of zones) {
    let n = 0;
    if (zn.kind === 'lot') n = zn.lot?.culdesac ? 4 + pick(4) : 8 + pick(7);
    else if (zn.kind === 'pulloff') n = rand() < 0.85 * busy ? 2 + pick(4) : 0;
    else if (zn.kind === 'show') n = 4 + pick(4);
    // A car or two parked along a pulloff (their owners are the ones filming), so the people
    // stand out at the back edge of it.
    const parked = zn.kind === 'pulloff' && n > 0 ? 1 + (rand() < 0.4 ? 1 : 0) : 0;
    for (let k = 0; k < parked; k++) {
      const pt = zonePoint(road, zn, parked === 1 ? 0.5 : 0.33 + k * 0.34, zn.inner + 2.6);
      cars.push({ x: pt.x, y: pt.y, z: pt.z, yaw: pt.yaw, paint: pick(6) });
    }
    for (let k = 0; k < n; k++) {
      const f = 0.15 + rand() * 0.7;
      const l = parked ? zn.inner + zn.width - 0.7 + rand() * 0.4 : zn.inner + 1 + rand() * Math.min(3.5, Math.max(0.5, zn.width - 2));
      const pt = zonePoint(road, zn, f, l);
      // On the lot surface, not the land under it.
      people.push({ x: pt.x, y: pt.y, z: pt.z, yaw: facing(road, pt.j, zn.side) + (rand() - 0.5) * 0.8, pose: pose(), look: look(), i: pt.j });
    }
  }

  const inZone = (i, side) => zones.some((zn) => zn.side === side && i >= zn.i0 - 10 && i <= zn.i1 + 10);
  // On the outside of the tight corners: a few people just past the rail, on the verge.
  let last = -1e9;
  for (let i = 40; i < road.count - 40; i++) {
    const k = road.kappa[i];
    if (Math.abs(k) < 1 / 75 || i - last < 45) continue;
    if (rand() > 0.75 * busy) {
      last = i;
      continue;
    }
    const side = k > 0 ? -1 : 1;
    if (inZone(i, side) || terrain.bridgeAt?.(i) || road.clearance(i, side, 14) < 14) continue;
    // Tight corners draw the bigger crowds.
    const n = (Math.abs(k) > 1 / 30 ? 4 : 2) + pick(5);
    for (let m = 0; m < n; m++) {
      const j = Math.max(1, Math.min(road.count - 2, i + Math.round((rand() - 0.5) * 18)));
      const l = road.w.RAIL + 1.4 + rand() * 2.2;
      const p = road.pointAt(j, side * l);
      add(p[0], p[2], facing(road, j, side), j);
    }
    last = i;
  }
  // Odd ones and twos along the rest of the road: someone walking up to a better spot.
  for (let i = 60; i < road.count - 60; i += 90 + pick(80)) {
    const side = rand() < 0.5 ? 1 : -1;
    if (inZone(i, side) || terrain.bridgeAt?.(i) || road.clearance(i, side, 12) < 12) continue;
    const n = 1 + pick(2);
    for (let m = 0; m < n; m++) {
      const p = road.pointAt(i + m * 2, side * (road.w.RAIL + 1.3 + rand() * 1.5));
      add(p[0], p[2], facing(road, i, side), i);
    }
  }
  return { people, cars };
}

// Rough size of a person for the physics: half extents.
export const PERSON_HALF = [0.28, 0.9, 0.22];
