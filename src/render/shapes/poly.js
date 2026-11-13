// Shared building blocks for the low-poly car bodies: a mesh from convex polygons, mirroring
// across the centreline, lookup tables along the car, and the common colours.
import * as THREE from 'three';

export const WHITE = [0.94, 0.93, 0.9]; // Alpine White
export const BLACK = [0.06, 0.06, 0.07];
export const TRIM = [0.13, 0.13, 0.14];
export const GLASS = [0.16, 0.2, 0.25];
export const CHROME = [0.72, 0.74, 0.77];
export const UNDER = [0.04, 0.04, 0.05];
export const AMBER = [0.95, 0.55, 0.12];

// Builds a flat-shaded, vertex-coloured mesh from convex polygons. Each polygon is wound to face
// away from `center`, or along its own `out` hint.
export function polyGeometry(polys, center = [0, 0.1, 0]) {
  const pos = [];
  const col = [];
  for (const p of polys) {
    let pts = p.pts;
    const [a, b, c] = pts;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    let out = p.out;
    if (!out) {
      const m = pts.reduce((s, q) => [s[0] + q[0] / pts.length, s[1] + q[1] / pts.length, s[2] + q[2] / pts.length], [0, 0, 0]);
      out = [m[0] - center[0], m[1] - center[1], m[2] - center[2]];
    }
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) pts = [...pts].reverse();
    const color = p.color || WHITE;
    for (let k = 1; k < pts.length - 1; k++) {
      for (const v of [pts[0], pts[k], pts[k + 1]]) {
        pos.push(v[0], v[1], v[2]);
        col.push(color[0], color[1], color[2]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export const mirror = (p) => [-p[0], p[1], p[2]];
export const both = (poly) => [poly, { ...poly, pts: poly.pts.map(mirror), out: poly.out && [-poly.out[0], poly.out[1], poly.out[2]] }];

export function lerpTable(table, z) {
  if (z >= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (z >= table[i][0]) {
      const [z0, v0] = table[i - 1];
      const [z1, v1] = table[i];
      return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
    }
  }
  return table[table.length - 1][1];
}

