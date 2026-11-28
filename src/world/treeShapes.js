// Tree shapes for the roadside forest, one geometry per part, shared by every instance.
// Each carries vertex colours for light and shade (dark inside and underneath, bright at the
// branch tips and the sunny top), which the per-tree instance colour then tints.
// Sizes are unit shapes: the forest code scales them to each tree's height.
import * as THREE from 'three';

// Small seeded random, so every load builds the same trees.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Triangle soup -> non-indexed geometry with flat normals (the game's faceted look).
function soup(pos, col, uv) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
function tri(pos, col, a, b, c, ca, cb, cc) {
  pos.push(...a, ...b, ...c);
  col.push(ca, ca, ca, cb, cb, cb, cc, cc, cc);
}

// ---------- Foliage textures: grey (tinted per tree), with see-through gaps ----------
// Drawn once on a canvas. Alpha-tested, so the edges of every bough and clump break up into
// needles and leaves instead of hard polygon edges. Mostly opaque, so the trees stay solid far off
// (the small mip levels average out to opaque).
const texCache = {};
function canvasTex(key, draw) {
  if (texCache[key] || typeof document === 'undefined') return texCache[key] || null;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  draw(g, rng(key.length * 97));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  texCache[key] = t;
  return t;
}

// Material for card foliage (leaves, redwood sprays): both sides lit with the crown's outward
// normals. Three.js normally flips the normal on the back of a two-sided face, which would make the
// far side of every card dark; here both sides keep the crown normal.
export function foliageMaterial(map) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, map, alphaTest: 0.45, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'),
    );
  };
  m.customProgramCacheKey = () => 'foliage';
  return m;
}

// A conifer bough seen from above: a midrib from the bottom centre fanning to the top edge, with
// side twigs covered in short needles. Ragged, see-through tips along the top.
export function needleTexture() {
  return canvasTex('needles', (g, r) => {
    const twig = (x0, y0, x1, y1, w, depth) => {
      g.strokeStyle = `rgb(${70 + r() * 30},${70 + r() * 30},${60 + r() * 20})`;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.floor(len / 3);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t;
        const a = Math.atan2(y1 - y0, x1 - x0);
        const nl = 7 + r() * 6 * (1 - t * 0.5);
        for (const s of [1, -1]) {
          const b = a + s * (0.9 + r() * 0.4);
          const v = 150 + r() * 105;
          g.strokeStyle = `rgb(${v},${v},${v * 0.92})`;
          g.lineWidth = 1.6;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + Math.cos(b) * nl, y + Math.sin(b) * nl);
          g.stroke();
        }
      }
      if (depth > 0) {
        for (let i = 1; i < 5; i++) {
          const t = i / 5;
          const x = x0 + (x1 - x0) * t;
          const y = y0 + (y1 - y0) * t;
          const a = Math.atan2(y1 - y0, x1 - x0);
          for (const s of [1, -1]) {
            const b = a + s * (0.6 + r() * 0.3);
            const l = len * (0.45 - t * 0.25) * (0.8 + r() * 0.4);
            twig(x, y, x + Math.cos(b) * l, y + Math.sin(b) * l, w * 0.5, depth - 1);
          }
        }
      }
    };
    // Dense base layer so the inner part is solid, then the boughs on top.
    g.fillStyle = 'rgb(90,92,84)';
    g.beginPath();
    g.moveTo(128, 256);
    g.lineTo(0, 40);
    g.lineTo(256, 40);
    g.fill();
    for (let k = 0; k < 9; k++) {
      const x1 = 10 + k * 29.5 + (r() - 0.5) * 12;
      twig(128 + (r() - 0.5) * 20, 256, x1, 8 + r() * 14, 3, 1);
    }
  });
}

// Redwood sprays: flat sprigs of short needles, layered in a wide, flattened clump.
export function sprayTexture() {
  return canvasTex('sprays', (g, r) => {
    const sprig = (x, y, a, len, v) => {
      const x1 = x + Math.cos(a) * len;
      const y1 = y + Math.sin(a) * len;
      g.strokeStyle = `rgb(${v * 0.6},${v * 0.6},${v * 0.5})`;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x1, y1);
      g.stroke();
      g.strokeStyle = `rgb(${v},${v},${Math.round(v * 0.9)})`;
      g.lineWidth = 2.2;
      for (let t = 0.1; t < 1; t += 0.09) {
        const px = x + (x1 - x) * t;
        const py = y + (y1 - y) * t;
        const nl = 6 * (1 - t * 0.6);
        for (const s of [1, -1]) {
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(px + Math.cos(a + s * 1.3) * nl, py + Math.sin(a + s * 1.3) * nl);
          g.stroke();
        }
      }
    };
    for (let i = 0; i < 260; i++) {
      // Inside a wide ellipse, denser in the middle.
      const t = r() * Math.PI * 2;
      const k = Math.sqrt(r());
      const x = 128 + Math.cos(t) * k * 92;
      const y = 128 + Math.sin(t) * k * 70;
      const deep = 1 - k;
      sprig(x, y, r() * Math.PI * 2, 14 + r() * 18, Math.round(90 + r() * 120 + 30 * (1 - deep)));
    }
  });
}

// A leaf cluster: an uneven ball of overlapping leaves on a transparent ground, with single leaves
// sticking out round the edge. Grey, so each tree's colour tints it.
export function leafTexture() {
  return canvasTex('leaves', (g, r) => {
    const lobes = Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * Math.PI * 2 + r() * 0.6;
      const d = 22 + r() * 22;
      return [128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 36 + r() * 18];
    });
    lobes.push([128, 128, 64]);
    const inside = (x, y, pad) => lobes.some(([cx, cy, cr]) => Math.hypot(x - cx, y - cy) < cr + pad);
    const leaf = (x, y, v) => {
      g.save();
      g.translate(x, y);
      g.rotate(r() * Math.PI * 2);
      const L = 6 + r() * 6;
      g.fillStyle = `rgb(${v},${v},${Math.round(v * 0.9)})`;
      g.beginPath();
      g.moveTo(-L, 0);
      g.quadraticCurveTo(0, -L * 0.55, L, 0);
      g.quadraticCurveTo(0, L * 0.55, -L, 0);
      g.fill();
      g.restore();
    };
    // Shadowed leaves deep in the cluster first, sunlit ones on top, loose leaves round the edge.
    for (let i = 0; i < 2600; i++) {
      const x = r() * 256;
      const y = r() * 256;
      if (!inside(x, y, -6)) continue;
      leaf(x, y, 70 + r() * 70);
    }
    for (let i = 0; i < 2200; i++) {
      const x = r() * 256;
      const y = r() * 256;
      if (!inside(x, y, 4)) continue;
      leaf(x, y, 130 + r() * 125);
    }
  });
}

// ---------- 1. Spruce / fir: drooping tiers of jagged branches ----------
// Unit cone space: base radius about 1 at y = 0, tip at y = 1. Each tier is a skirt of branches
// that hangs down at the tips, with deep notches between them so light shows through the edge.
export function spruceCrown({ tiers = 12, branches = 8, droop = 0.06, seed = 7 } = {}) {
  const r = rng(seed);
  const pos = [];
  const col = [];
  const uv = [];
  for (let i = 0; i < tiers; i++) {
    const f = i / tiers;
    const yb = f * 0.86;
    const rad = Math.pow(1 - f, 1.05) * (0.9 + r() * 0.2);
    const apex = [0, yb + 0.2 - f * 0.04, 0];
    const turn = r() * Math.PI * 2;
    const shade = 0.62 + f * 0.45; // lower tiers sit in the shade of the ones above
    const rim = [];
    for (let j = 0; j < branches; j++) {
      const a = turn + ((j + (r() - 0.5) * 0.35) / branches) * Math.PI * 2;
      const len = rad * (0.82 + r() * 0.3);
      rim.push([Math.cos(a) * len, yb - droop * (0.6 + r()), Math.sin(a) * len]);
    }
    for (let j = 0; j < branches; j++) {
      const p = rim[j];
      const q = rim[(j + 1) % branches];
      // Notch: pulled in towards the trunk and up, between two branch tips.
      const nx = (p[0] + q[0]) * 0.3;
      const nz = (p[2] + q[2]) * 0.3;
      const notch = [nx, yb + 0.05, nz];
      const tip = Math.min(1.25, shade * 1.15);
      tri(pos, col, apex, p, notch, shade * 0.55, tip, shade * 0.7);
      tri(pos, col, apex, notch, q, shade * 0.55, shade * 0.7, tip);
      uv.push(0.5, 0, 0, 1, 0.5, 0.8, 0.5, 0, 0.5, 0.8, 1, 1);
    }
  }
  // Leader: the thin spire at the very top.
  const top = [0, 1, 0];
  for (let j = 0; j < 3; j++) {
    const a = (j / 3) * Math.PI * 2;
    const b = ((j + 1) / 3) * Math.PI * 2;
    tri(pos, col, top, [Math.cos(a) * 0.05, 0.84, Math.sin(a) * 0.05], [Math.cos(b) * 0.05, 0.84, Math.sin(b) * 0.05], 1.25, 1.0, 1.0);
    uv.push(0.5, 0.3, 0.45, 0.1, 0.55, 0.1);
  }
  return soup(pos, col, uv);
}

// Redwood trunk: unit height, a wide fluted buttress at the ground tapering to the crown, with
// dark furrows down the fibrous bark. Base radius about 0.28 like the plain trunk.
export function redwoodTrunk() {
  const pos = [];
  const col = [];
  const sides = 10;
  const rings = [0, 0.04, 0.12, 0.3, 0.6, 1];
  const radius = (y, k) => {
    const flare = 1 + 1.4 * Math.exp(-y / 0.06);
    const flute = k % 2 ? 0.86 : 1; // furrows
    return 0.42 * (1 - y * 0.6) * flare * flute;
  };
  const ring = (y) =>
    Array.from({ length: sides }, (_, k) => {
      const a = (k / sides) * Math.PI * 2;
      const rad = radius(y, k);
      return [Math.cos(a) * rad, y, Math.sin(a) * rad];
    });
  for (let i = 0; i < rings.length - 1; i++) {
    const A = ring(rings[i]);
    const B = ring(rings[i + 1]);
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      const c1 = k % 2 ? 0.62 : 1;
      const c2 = k2 % 2 ? 0.62 : 1;
      const low = rings[i] < 0.05 ? 0.8 : 1; // damp, dark bark at the foot
      tri(pos, col, A[k], B[k], B[k2], c1 * low, c1, c2);
      tri(pos, col, A[k], B[k2], A[k2], c1 * low, c2, c2 * low);
    }
  }
  return soup(pos, col);
}

// Foliage made of clusters: each cluster is three crossed cards carrying an alpha texture, so the
// outline is leaves or needles, not polygon edges. Normals point out from the crown's axis, so the
// whole crown lights as one rounded mass: sunlit on top and outside, shaded underneath and inside.
// clumps: [x, y, z, radius]; flat < 1 squashes the upright cards (flat, layered sprays).
function cardCrown(clumps, r, { flat = 1, axisNormals = false, dark = 0.4, center = [0, 0, 0], radius = 0.95, size = 1.25 } = {}) {
  const pos = [];
  const col = [];
  const uv = [];
  const nrm = [];
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const yMin = Math.min(...clumps.map((c) => c[1]));
  const yMax = Math.max(...clumps.map((c) => c[1]));
  for (const [cx, cy, cz, cr] of clumps) {
    const c = v3(cx, cy, cz);
    const s = cr * size; // the foliage fills about 80% of the card
    const spin = r() * Math.PI;
    const cards = [
      [v3(Math.cos(spin), 0, Math.sin(spin)), v3(0, flat, 0)],
      [v3(Math.cos(spin + Math.PI / 2), 0, Math.sin(spin + Math.PI / 2)), v3(0, flat, 0)],
      [v3(Math.cos(spin), 0, Math.sin(spin)), v3(-Math.sin(spin), 0, Math.cos(spin))],
    ];
    for (const [u, w] of cards) {
      const tilt = new THREE.Quaternion().setFromAxisAngle(v3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), (r() - 0.5) * 0.5);
      u.applyQuaternion(tilt);
      w.applyQuaternion(tilt);
      const corner = (a, b) => c.clone().addScaledVector(u, a * s).addScaledVector(w, b * s);
      const P = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      const T = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const p = P[k];
        pos.push(p.x, p.y, p.z);
        uv.push(T[k][0], T[k][1]);
        const n = (axisNormals ? v3(p.x, 0.35, p.z) : p.clone().sub(v3(...center)).add(v3(0, 0.25 * radius, 0))).normalize();
        nrm.push(n.x, n.y, n.z);
        const rad = axisNormals ? Math.max(0.05, Math.abs(cx) + Math.abs(cz)) : radius;
        const out = Math.min(1, Math.hypot(p.x - center[0], p.z - center[2]) / rad);
        const high = Math.max(0, Math.min(1, (p.y - yMin) / Math.max(0.01, yMax - yMin)));
        const lum = dark + 0.35 * high + (1 - dark - 0.1) * 0.6 * out;
        col.push(lum, lum, lum);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// ---------- 3. Broadleaf (oak, maple, beech, aspen) ----------
// Built as one tree in tree-height units (scale evenly by the height, ground at y = 0): the
// branches, and leaf clusters grown at the branch tips, so the crown follows the branches and
// you see limbs in the gaps between the clusters.
export function broadCrown(seed = 5) {
  return broadTree(seed).crown;
}
export function broadTrunk(seed = 5) {
  return broadTree(seed).trunk;
}

// ---------- 2b. Coast redwood crown: dense, flat sprays clumped along the upper trunk ----------
// Unit cone space: y 0 to 1, widest low down, narrowing to a ragged top. Sprays hang off all
// sides of the trunk, layered, with gaps here and there.
export function redwoodCrown(seed = 11) {
  const r = rng(seed);
  const clumps = [];
  const n = 30;
  for (let i = 0; i < n; i++) {
    const f = i / n;
    const y = f * 0.95;
    const reach = (f < 0.25 ? 0.7 + f * 1.2 : 1 - (f - 0.25) * 1.15) * (0.75 + r() * 0.4);
    const a = i * 2.39996 + r() * 0.6; // golden angle: spread round the trunk
    const d = Math.max(0.08, reach * (0.45 + r() * 0.25));
    clumps.push([Math.cos(a) * d, y, Math.sin(a) * d, Math.max(0.12, reach * (0.38 + r() * 0.15))]);
  }
  clumps.push([0, 1, 0, 0.12]);
  return cardCrown(clumps, r, { flat: 0.55, axisNormals: true, dark: 0.35 });
}

// Broadleaf trunk and branches, in tree-height units (scale evenly by the tree's height): a trunk
// that tapers all the way up into a leader, main limbs leaving it at different heights and
// angles, each splitting into smaller branches that reach out to the edge of the crown.
// Every branch is thinner than the one it grows from, so nothing thickens on the way up.
const treeCache = new Map();
function broadTree(seed) {
  if (treeCache.has(seed)) return treeCache.get(seed);
  const r = rng(seed);
  const clumps = [];
  const pos = [];
  const col = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const limb = (a, b, ra, rb, ca, cb, sides = 5) => {
    const dir = V().subVectors(b, a).normalize();
    const side = V(0, 0, 1).cross(dir);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();
    const up = V().crossVectors(dir, side);
    const ringAt = (p, rad) =>
      Array.from({ length: sides }, (_, k) => {
        const t = (k / sides) * Math.PI * 2;
        return p.clone().addScaledVector(side, Math.cos(t) * rad).addScaledVector(up, Math.sin(t) * rad).toArray();
      });
    const A = ringAt(a, ra);
    const B = ringAt(b, rb);
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      const s1 = 0.7 + 0.3 * Math.cos((k / sides) * Math.PI * 2 - 0.8);
      const s2 = 0.7 + 0.3 * Math.cos((k2 / sides) * Math.PI * 2 - 0.8);
      tri(pos, col, A[k], B[k], B[k2], ca * s1, cb * s1, cb * s2);
      tri(pos, col, A[k], B[k2], A[k2], ca * s1, cb * s2, ca * s2);
    }
  };
  // Trunk: three sections with a little wander, base radius 2.6% of the height, root flare.
  const base = 0.026;
  const trunkR = (y) => base * (1 - y * 1.05) + 0.003;
  const pts = [V(0, 0, 0), V(0.004, 0.3, 0.002), V(-0.01, 0.58, 0.01), V(0.006, 0.88, -0.004)];
  limb(V(0, -0.02, 0), V(0, 0.04, 0), base * 1.5, trunkR(0.04), 0.6, 0.7, 6);
  for (let i = 0; i < pts.length - 1; i++) limb(pts[i].clone().setY(Math.max(0.04, pts[i].y)), pts[i + 1], trunkR(Math.max(0.04, pts[i].y)), trunkR(pts[i + 1].y), 0.7, 0.85, 6);
  const along = (y) => {
    for (let i = 0; i < pts.length - 1; i++) {
      if (y <= pts[i + 1].y) return pts[i].clone().lerp(pts[i + 1], (y - pts[i].y) / (pts[i + 1].y - pts[i].y));
    }
    return pts[pts.length - 1].clone();
  };
  // Main limbs: spiralling round the trunk, low ones long and spreading, high ones short and steep.
  const mains = 10;
  for (let i = 0; i < mains; i++) {
    const f = i / (mains - 1);
    const y0 = 0.28 + f * 0.46 + (r() - 0.5) * 0.04;
    const a = i * 2.39996 + (r() - 0.5) * 0.4;
    const rise = 0.5 + f * 0.6 + r() * 0.15; // angle above level, radians
    const len = (0.34 - f * 0.14) * (0.92 + r() * 0.16);
    const p0 = along(y0);
    const d = V(Math.cos(a) * Math.cos(rise), Math.sin(rise), Math.sin(a) * Math.cos(rise));
    const mid = p0.clone().addScaledVector(d, len * 0.55);
    // A gentle bend: the outer half turns up and out a little.
    const d2 = d.clone().add(V(0, 0.25, 0)).normalize();
    const end = mid.clone().addScaledVector(d2, len * 0.45);
    const r0 = trunkR(y0) * 0.62;
    limb(p0, mid, r0, r0 * 0.6, 0.8, 0.9);
    limb(mid, end, r0 * 0.6, r0 * 0.15, 0.9, 1);
    clumps.push([...end.toArray(), 0.12 + r() * 0.03]);
    clumps.push([...mid.toArray(), 0.1 + r() * 0.02]);
    // Side branches off each limb, forking out to fill the crown.
    for (let k = 0; k < 4; k++) {
      const t = 0.3 + k * 0.2;
      const from = t < 0.55 ? p0.clone().lerp(mid, t / 0.55) : mid.clone().lerp(end, (t - 0.55) / 0.45);
      const ra = (t < 0.55 ? r0 * (1 - 0.4 * (t / 0.55)) : r0 * 0.6 * (1 - (t - 0.55) / 0.45 * 0.75)) * 0.55;
      const sa = a + (k % 2 ? 1 : -1) * (0.6 + r() * 0.5);
      const sr = rise + 0.2 + r() * 0.3;
      const sl = len * (0.35 + r() * 0.15);
      const tip = from.clone().add(V(Math.cos(sa) * Math.cos(sr) * sl, Math.sin(sr) * sl, Math.sin(sa) * Math.cos(sr) * sl));
      limb(from, tip, ra, 0.002, 0.9, 1, 4);
      clumps.push([...tip.toArray(), 0.1 + r() * 0.03]);
    }
  }
  clumps.push([pts[3].x, pts[3].y + 0.02, pts[3].z, 0.13]);
  clumps.push([pts[2].x, pts[2].y + 0.1, pts[2].z, 0.14]);
  const out = { trunk: soup(pos, col), crown: cardCrown(clumps, r, { dark: 0.5, center: [0, 0.62, 0], radius: 0.36, size: 1.3 }) };
  treeCache.set(seed, out);
  return out;
}

// Plain conifer trunk with the same shading (unit height, base radius 0.28).
export function coniferTrunk() {
  const g = new THREE.CylinderGeometry(0.12, 0.28, 1, 6, 1, true).toNonIndexed();
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  const col = [];
  for (let i = 0; i < p.count; i++) {
    const c = 0.55 + 0.45 * Math.max(0, Math.cos(Math.atan2(p.getZ(i), p.getX(i)) - 0.6));
    col.push(c, c, c);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
