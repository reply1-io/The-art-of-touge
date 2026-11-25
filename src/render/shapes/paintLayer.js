// Drawing on a car (the Car Builder's DRAW mode): brush strokes laid on the body like paint.
//
// The drawing is kept as five flat pictures of the car, as seen from the left, the right, the top,
// the front and the back, packed into one texture. Each spot of the body shows the pictures that
// face the way it does, blended where it faces between two (a rounded corner), so a stroke runs
// smoothly over the whole car. Strokes are kept as points on the body, so the drawing can be
// redrawn anywhere (the builder, the game) and handed over as a few kilobytes of code.
//
// A stroke: { c: '#rrggbb', r: radius (m), h: 1 hard | 0 soft, e: 1 to erase,
//   d: [[x, y, z, nx, ny, nz], ...] points along it on the body, with which way the body faces }
import * as THREE from 'three';

const S = 200; // pixels per metre (5 mm a pixel)
const GAP = 8;
// The box the drawing covers (car space: x left, y up from the ground, z forward).
const X = [-1.2, 1.2];
const Y = [-0.2, 2.2];
const Z = [-3, 3];
const LZ = (Z[1] - Z[0]) * S; // 1200
const LX = (X[1] - X[0]) * S; // 480
const LY = (Y[1] - Y[0]) * S; // 480
export const ATLAS_W = LZ;
export const ATLAS_H = LY * 3 + LX + GAP * 3;

// The five views: which way each looks, and where its picture sits in the texture.
// [axis, sign, x0, y0, u (which coordinate goes across), v (which goes down)]
const VIEWS = [
  { n: [1, 0, 0], x0: 0, y0: 0, u: 2, v: 1 }, // the left side
  { n: [-1, 0, 0], x0: 0, y0: LY + GAP, u: 2, v: 1 }, // the right side
  { n: [0, 1, 0], x0: 0, y0: (LY + GAP) * 2, u: 2, v: 0 }, // the top
  { n: [0, 0, 1], x0: 0, y0: (LY + GAP) * 3, u: 0, v: 1 }, // the front
  { n: [0, 0, -1], x0: LX + GAP, y0: (LY + GAP) * 3, u: 0, v: 1 }, // the back
];
const RANGE = [X, Y, Z];

// How much each view shows a spot facing n (they add up to 1, or all 0 underneath).
export function viewWeights(n) {
  const w = VIEWS.map((vw) => Math.max(0, vw.n[0] * n[0] + vw.n[1] * n[1] + vw.n[2] * n[2]) ** 3);
  const sum = w.reduce((a, b) => a + b, 0);
  return sum > 1e-5 ? w.map((x) => x / sum) : w.map(() => 0);
}

// Where a point of the car lands in a view's picture, in pixels.
function pixel(vw, p) {
  const [ua, va] = [vw.u, vw.v];
  return [vw.x0 + (p[ua] - RANGE[ua][0]) * S, vw.y0 + (RANGE[va][1] - p[va]) * S];
}

// One dab of the brush at p (facing n): a round spot in every view that shows that spot.
export function dab(ctx, p, n, stroke) {
  const w = viewWeights(n);
  const r = Math.max(1, stroke.r * S);
  const col = new THREE.Color(stroke.c);
  const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
  ctx.globalCompositeOperation = stroke.e ? 'destination-out' : 'source-over';
  VIEWS.forEach((vw, i) => {
    if (w[i] < 0.08) return;
    const [x, y] = pixel(vw, p);
    ctx.save();
    // Keep it in its own picture.
    ctx.beginPath();
    ctx.rect(vw.x0, vw.y0, vw.u === 2 ? LZ : LX, vw.v === 0 ? LX : LY);
    ctx.clip();
    if (stroke.h) {
      ctx.fillStyle = `rgba(${rgb},1)`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Soft: strongest in the middle, fading to nothing at the edge; it builds up as you go over.
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rgb},0.35)`);
      g.addColorStop(0.5, `rgba(${rgb},0.18)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  });
  ctx.globalCompositeOperation = 'source-over';
}

// A whole stroke: dabs every third of the brush's width between the points along it.
export function drawStroke(ctx, stroke) {
  const pts = stroke.d;
  if (!pts.length) return;
  const gap = Math.max(0.003, stroke.r * (stroke.h ? 0.3 : 0.25));
  dab(ctx, pts[0].slice(0, 3), pts[0].slice(3), stroke);
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(len / gap));
    for (let j = 1; j <= n; j++) {
      const t = j / n;
      const lerp = (i) => a[i] + (b[i] - a[i]) * t;
      dab(ctx, [lerp(0), lerp(1), lerp(2)], [lerp(3), lerp(4), lerp(5)], stroke);
    }
  }
}

// The drawing's texture, drawn from its strokes (null if there are none and none is wanted).
export function paintTexture(strokes, canvas = null) {
  const c = canvas || document.createElement('canvas');
  c.width = ATLAS_W;
  c.height = ATLAS_H;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  for (const s of strokes || []) drawStroke(ctx, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.premultiplyAlpha = true; // so blending the views and dividing by coverage gives back the colour
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return { canvas: c, ctx, tex };
}

// Show the drawing on a material: each spot blends the views that face its way, over its own
// colour. The mesh's own space must be car space (it is, for car bodies and the builder).
export function addPaintLayer(material, tex) {
  material.userData.paintTex = tex;
  material.customProgramCacheKey = () => 'paint-layer';
  material.onBeforeCompile = (sh) => {
    sh.uniforms.paintAtlas = { value: tex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPaintPos;\nvarying vec3 vPaintNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaintPos = position;\nvPaintNrm = normal;');
    const view = (vw) => {
      const ax = ['x', 'y', 'z'];
      const u = `(${vw.x0.toFixed(1)} + (p.${ax[vw.u]} - (${RANGE[vw.u][0].toFixed(3)})) * ${S.toFixed(1)}) / ${ATLAS_W.toFixed(1)}`;
      const v = `(${vw.y0.toFixed(1)} + (${RANGE[vw.v][1].toFixed(3)} - p.${ax[vw.v]}) * ${S.toFixed(1)}) / ${ATLAS_H.toFixed(1)}`;
      return `vec2(${u}, ${v})`;
    };
    const sum = VIEWS.map((vw, i) => `w${i} * texture2D(paintAtlas, ${view(vw)})`).join(' + ');
    const weights = VIEWS.map((vw, i) => `float w${i} = pow(max(0.0, dot(n, vec3(${vw.n.map((x) => x.toFixed(1)).join(', ')}))), 3.0);`).join('\n');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D paintAtlas;\nvarying vec3 vPaintPos;\nvarying vec3 vPaintNrm;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 p = vPaintPos;
          vec3 n = normalize(vPaintNrm);
          ${weights}
          float ws = w0 + w1 + w2 + w3 + w4;
          if (ws > 1e-4) {
            w0 /= ws; w1 /= ws; w2 /= ws; w3 /= ws; w4 /= ws;
            vec4 paint = ${sum};
            if (paint.a > 0.002) {
              diffuseColor.rgb = mix(diffuseColor.rgb, paint.rgb / max(paint.a, 1e-3), clamp(paint.a, 0.0, 1.0));
              diffuseColor.a = mix(diffuseColor.a, 1.0, paint.a);
            }
          }
        }`,
      );
  };
  material.needsUpdate = true;
}

// A stroke point, rounded to the millimetre (and the facing to a hundredth) to keep codes short.
export function strokePoint(p, n) {
  return [...p.map((v) => Math.round(v * 1000) / 1000), ...n.map((v) => Math.round(v * 100) / 100)];
}
