import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TRACKS } from '../src/world/tracks.js';
import { Deer } from '../src/world/deer.js';

test('deer always cross well ahead: even flat out you cannot reach them', () => {
  const road = TRACKS.dragon.road();
  const scene = new THREE.Scene();
  let closest = Infinity;
  for (const v0 of [8, 20, 35, 50]) {
    const deer = new Deer(scene, road, { heightAt: () => 0 });
    deer.timer = 0;
    let s = 400;
    let v = v0;
    for (let k = 0; k < 60 * 12; k++) {
      const dt = 1 / 60;
      v = Math.min(60, v + 5 * dt); // hard acceleration the whole time
      s += v * dt;
      const i = Math.floor(s / 2);
      deer.update(dt, i, v);
      const car = road.pointAt(i, -1.7);
      for (const d of deer.herd) {
        if (!d.m.visible) continue;
        closest = Math.min(closest, Math.hypot(d.m.position.x - car[0], d.m.position.z - car[2]));
      }
    }
  }
  assert.ok(closest > 12, `closest approach ${closest} m`);
});
