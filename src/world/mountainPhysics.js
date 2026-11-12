// Physics colliders for the mountain: the road surface (with gutters), the terrain, guardrails and
// the invisible walls. Rapier only, so it can be tested in Node.
import RAPIER from '@dimforge/rapier3d-compat';
import { crossSection, barrierLayout, RAIL, GUTTER_OUT, SHOULDER } from './road.js';
import { ZONE_INNER, stationLayout, showLayout } from './stops.js';

function yawQuat(yaw) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

// Straight box colliders along a run of points [x, y, z] (one every `every` samples).
function boxRun(world, pts, halfWidth, height, yOffset, friction) {
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay, az] = pts[k];
    const [bx, by, bz] = pts[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.2) continue;
    const yaw = Math.atan2(bx - ax, bz - az);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfWidth, height / 2, len / 2 + 0.05)
        .setTranslation((ax + bx) / 2, (ay + by) / 2 + yOffset + height / 2, (az + bz) / 2)
        .setRotation(yawQuat(yaw))
        .setFriction(friction),
    );
  }
}

export function buildMountainPhysics(world, road, terrain) {
  // Road: one triangle mesh with the full cross-section.
  const cols = crossSection(road, 0).length;
  const verts = new Float32Array(road.count * cols * 3);
  for (let i = 0; i < road.count; i++) {
    crossSection(road, i).forEach(([l, dy], c) => {
      const p = road.pointAt(i, l, dy);
      verts.set(p, (i * cols + c) * 3);
    });
  }
  // One triangle mesh per surface, so the tyres can tell asphalt from gravel and grass.
  const kinds = crossSection(road, 0).map(([, , kind]) => (kind === 'asphalt' || kind === 'gutter' ? 'asphalt' : kind === 'shoulder' ? 'gravel' : 'grass'));
  // Columns between the gutter lips count as asphalt (the gutter is concrete).
  const surfaceOfColumn = (c) => {
    const a = kinds[c];
    const b = kinds[c + 1];
    if (a === 'asphalt' && b === 'asphalt') return 'asphalt';
    const off = Math.abs(crossSection(road, 0)[c][0]) + Math.abs(crossSection(road, 0)[c + 1][0]);
    return off / 2 < road.w.GUTTER_OUT + 0.03 ? 'asphalt' : off / 2 < road.w.SHOULDER + 0.1 ? 'gravel' : 'grass';
  };
  const byHandle = new Map();
  for (const surface of ['asphalt', 'gravel', 'grass']) {
    const idx = [];
    for (let i = 0; i < road.count - 1; i++) {
      for (let c = 0; c < cols - 1; c++) {
        if (surfaceOfColumn(c) !== surface) continue;
        const a = i * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const col = world.createCollider(RAPIER.ColliderDesc.trimesh(verts, new Uint32Array(idx)).setFriction(1.0));
    byHandle.set(col.handle, surface);
  }

  // Terrain heightfield (Rapier: rows along z, columns along x, column-major).
  const { nx, nz, cell, heights } = terrain;
  const hf = new Float32Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) hf[iz + ix * nz] = heights[iz * nx + ix];
  const sx = (nx - 1) * cell;
  const sz = (nz - 1) * cell;
  const ground = world.createCollider(
    RAPIER.ColliderDesc.heightfield(nz - 1, nx - 1, hf, { x: sx, y: 1, z: sz })
      .setTranslation(terrain.x0 + sx / 2, 0, terrain.z0 + sz / 2)
      .setFriction(0.8),
  );
  byHandle.set(ground.handle, 'grass');

  // Guardrails and invisible walls.
  const layout = barrierLayout(road, terrain);
  // Pull-offs and lots: no rail between them and the road, the invisible wall moved out past them,
  // a drivable asphalt surface, a rail round the outer edge, and solid pumps and buildings.
  const zones = terrain.zones || [];
  for (const z of zones) {
    for (let j = z.i0; j <= z.i1; j++) {
      layout.rail[z.side][j] = 0;
      layout.wall[z.side][j] = Math.max(layout.wall[z.side][j], z.outerAt(j) + 1.6);
    }
    const cols = 7;
    const zv = [];
    const zi = [];
    for (let j = z.i0; j <= z.i1; j++) {
      const outer = Math.max(z.outerAt(j), z.inner + 0.3);
      for (let c = 0; c < cols; c++) {
        const l = z.inner + ((outer - z.inner) * c) / (cols - 1);
        const p = road.pointAt(j, z.side * l);
        zv.push(p[0], z.heightAt(road, j, l), p[2]);
      }
    }
    for (let r = 0; r < z.i1 - z.i0; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        zi.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    }
    const col = world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(zv), new Uint32Array(zi)).setFriction(1.0));
    byHandle.set(col.handle, 'asphalt');
    const edge = [];
    for (let j = z.i0; j <= z.i1; j += 2) {
      const l = z.outerAt(j) + 0.3;
      const p = road.pointAt(j, z.side * l);
      edge.push([p[0], z.heightAt(road, j, l), p[2]]);
    }
    boxRun(world, edge, 0.08, 0.85, 0, 0.15);
    const solid = (pt, hx, hy, hz) =>
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(pt.x, pt.y + hy, pt.z).setRotation(yawQuat(pt.yaw)));
    if (z.kind === 'station') {
      const st = stationLayout(road, z);
      for (const p of st.pumps) solid(p, 0.45, 0.9, 0.35);
      for (const p of st.pillars) solid(p, 0.2, 2.5, 0.2);
      solid(st.kiosk, 2.6, 1.6, 4.2);
      solid(st.truck, 1.25, 1.6, 3.6);
      solid(st.pylon, 0.25, 3, 0.25);
      solid(st.air, 0.3, 0.7, 0.3);
    } else if (z.kind === 'show') {
      solid(showLayout(road, z).cabin, 3.2, 1.8, 2.6);
    }
  }
  layout.zones = zones;
  for (const side of [1, -1]) {
    let run = [];
    const flush = () => {
      if (run.length > 1) boxRun(world, run, 0.08, 0.85, 0, 0.15);
      run = [];
    };
    for (let i = 0; i < road.count; i++) {
      if (layout.rail[side][i]) {
        if (i % 3 === 0 || !layout.rail[side][i + 1]) run.push(road.pointAt(i, side * (road.w.RAIL + 0.1)));
      } else flush();
    }
    flush();
    const wallPts = [];
    for (let i = 0; i < road.count; i += 3) wallPts.push(road.pointAt(i, side * layout.wall[side][i], -1));
    wallPts.push(road.pointAt(road.count - 1, side * layout.wall[side][road.count - 1], -1));
    boxRun(world, wallPts, 0.3, 6, 0, 0.1);
  }
  // Barriers across both ends of the road.
  for (const [i, dir] of [
    [0, -1],
    [road.count - 1, 1],
  ]) {
    const h = road.heading[i];
    const p = road.pointAt(i, 0);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(12, 3, 0.5)
        .setTranslation(p[0] + Math.sin(h) * dir * 2, p[1] + 2, p[2] + Math.cos(h) * dir * 2)
        .setRotation(yawQuat(h)),
    );
  }
  layout.surfaceOf = (handle) => byHandle.get(handle) || 'asphalt';
  return layout;
}
