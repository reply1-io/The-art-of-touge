// Low-poly mid-engine wedge coupe (AW11 MR2 look-alike), built in code.
// Car space: +z forward, +y up, +x left. Origin on the ground under the centre of gravity.
import * as THREE from 'three';
import { carMaterial, ensureColor } from './ps1.js';
import { whiteTexture, drawEnvMap, toTexture } from './textures.js';

// Builds a flat-shaded mesh from a list of convex polygons given as point arrays.
// Each polygon is wound to face away from `center`, so the order the points are listed in does not matter.
function polyGeometry(polys, center = [0, 0.6, 0]) {
  const pos = [];
  const col = [];
  const uv = [];
  for (const poly of polys) {
    const color = poly.color ?? [1, 1, 1];
    let pts = poly.pts;
    const [a, b, c] = pts;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const m = pts.reduce((acc, p) => [acc[0] + p[0] / pts.length, acc[1] + p[1] / pts.length, acc[2] + p[2] / pts.length], [0, 0, 0]);
    const out = [m[0] - center[0], m[1] - center[1], m[2] - center[2]];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) pts = [...pts].reverse();
    for (let k = 1; k < pts.length - 1; k++) {
      for (const p of [pts[0], pts[k], pts[k + 1]]) {
        pos.push(p[0], p[1], p[2]);
        col.push(color[0], color[1], color[2]);
        uv.push(0.5, 0.5);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals(); // non-indexed: face normals, i.e. flat shading
  return g;
}

const mirror = (p) => [-p[0], p[1], p[2]];

// Lower body as a loft through stations: [z, halfWidth, bottom, shoulder, top]
const STATIONS = [
  [-1.97, 0.76, 0.3, 0.62, 0.8],
  [-1.86, 0.82, 0.26, 0.66, 0.88],
  [-1.2, 0.83, 0.24, 0.66, 0.87],
  [-0.4, 0.83, 0.22, 0.64, 0.84],
  [0.6, 0.83, 0.22, 0.6, 0.8],
  [1.2, 0.82, 0.24, 0.56, 0.73],
  [1.75, 0.79, 0.27, 0.5, 0.64],
  [1.97, 0.72, 0.32, 0.46, 0.57],
];

function bodyPolys() {
  const polys = [];
  const ring = ([z, hw, bot, sh, top]) => [
    [hw * 0.93, bot, z],
    [hw, sh * 0.55 + bot * 0.45, z],
    [hw, sh, z],
    [hw * 0.9, top, z],
    [-hw * 0.9, top, z],
    [-hw, sh, z],
    [-hw, sh * 0.55 + bot * 0.45, z],
    [-hw * 0.93, bot, z],
  ];
  const rings = STATIONS.map(ring);
  const trim = [0.12, 0.12, 0.13];
  for (let s = 0; s < rings.length - 1; s++) {
    const a = rings[s];
    const b = rings[s + 1];
    for (let k = 0; k < 7; k++) {
      // Lower band (below the side crease) is black trim, like the real car's bumpers and sills.
      const isLower = k === 0 || k === 6;
      polys.push({ pts: [a[k], a[k + 1], b[k + 1], b[k]], color: isLower ? trim : [1, 1, 1] });
    }
  }
  // Rear panel and nose caps.
  polys.push({ pts: rings[0] });
  polys.push({ pts: rings[rings.length - 1] });
  return polys;
}

function cabinPolys() {
  // Greenhouse: base on the beltline, narrower roof.
  const base = { zr: -1.12, zf: 0.62, hw: 0.76, y: 0.84 };
  const roof = { zr: -0.58, zf: 0.0, hw: 0.6, y: 1.24 };
  const bl = [base.hw, base.y, base.zr];
  const bf = [base.hw, base.y - 0.04, base.zf];
  const rl = [roof.hw, roof.y, roof.zr];
  const rf = [roof.hw, roof.y, roof.zf];
  return {
    glass: [
      { pts: [mirror(bf), bf, rf, mirror(rf)] }, // windscreen
      { pts: [bl, mirror(bl), mirror(rl), rl] }, // rear window
      { pts: [bf, bl, rl, rf] }, // side windows
      { pts: [mirror(bl), mirror(bf), mirror(rf), mirror(rl)] },
    ],
    roof: [{ pts: [rf, rl, mirror(rl), mirror(rf)] }],
  };
}

function wheelGeometry(radius, width) {
  const segs = 10;
  const polys = [];
  const tire = [0.13, 0.13, 0.14];
  for (let s = 0; s < segs; s++) {
    const a0 = (s / segs) * Math.PI * 2;
    const a1 = ((s + 1) / segs) * Math.PI * 2;
    const p = (a, x, r = radius) => [x, Math.sin(a) * r, Math.cos(a) * r];
    polys.push({ pts: [p(a0, width / 2), p(a1, width / 2), p(a1, -width / 2), p(a0, -width / 2)], color: tire });
    // Outer face: rim with alternating spokes so rotation is visible.
    const rim = s % 2 ? [0.72, 0.72, 0.74] : [0.42, 0.42, 0.45];
    polys.push({ pts: [[width / 2, 0, 0], p(a1, width / 2, radius * 0.66), p(a0, width / 2, radius * 0.66)], color: rim });
    polys.push({ pts: [p(a0, width / 2, radius * 0.66), p(a1, width / 2, radius * 0.66), p(a1, width / 2), p(a0, width / 2)], color: tire });
    polys.push({ pts: [[-width / 2, 0, 0], p(a0, -width / 2), p(a1, -width / 2)], color: tire });
  }
  return polyGeometry(polys, [0, 0, 0]);
}

export class CarModel {
  constructor(spec) {
    this.spec = spec;
    this.root = new THREE.Group(); // positioned at the car, yaw only
    this.body = new THREE.Group(); // pitch and roll
    this.root.add(this.body);

    this.envCanvas = document.createElement('canvas');
    this.envCanvas.width = 64;
    this.envCanvas.height = 32;
    this.envTexture = toTexture(this.envCanvas, false);
    this.envTexture.wrapS = THREE.RepeatWrapping;
    const white = whiteTexture();

    this.paint = new THREE.Color(...spec.paint);
    const paintMat = carMaterial({ map: white, envMap: this.envTexture, paint: this.paint, reflect: 0.55 });
    const trimMat = carMaterial({ map: white, envMap: this.envTexture, reflect: 0.05 });
    const glassMat = carMaterial({ map: white, envMap: this.envTexture, paint: new THREE.Color(0.08, 0.1, 0.13), reflect: 0.85 });
    this.tailMat = carMaterial({ map: white, envMap: this.envTexture, paint: new THREE.Color(0.55, 0.05, 0.05), reflect: 0.3 });
    this.headMat = carMaterial({ map: white, envMap: this.envTexture, paint: new THREE.Color(0.9, 0.9, 0.85), reflect: 0.2 });

    // Body shell: painted parts and black trim share one geometry via vertex colours,
    // but trim must not take the paint colour, so split them.
    const polys = bodyPolys();
    const isTrim = (p) => (p.color ?? [1, 1, 1])[0] <= 0.5;
    const painted = polys.filter((p) => !isTrim(p));
    const trim = polys.filter(isTrim);
    const cabin = cabinPolys();
    // Engine-cover louvres and a small rear spoiler.
    const spoiler = [
      { pts: [[0.74, 0.92, -1.9], [-0.74, 0.92, -1.9], [-0.74, 0.95, -1.7], [0.74, 0.95, -1.7]] },
      { pts: [[0.74, 0.88, -1.9], [0.74, 0.92, -1.9], [0.74, 0.95, -1.7], [0.74, 0.88, -1.72]] },
      { pts: [[-0.74, 0.88, -1.9], [-0.74, 0.88, -1.72], [-0.74, 0.95, -1.7], [-0.74, 0.92, -1.9]] },
    ];
    const vents = [];
    for (const side of [1, -1]) {
      // Side intake behind the doors.
      vents.push({
        pts: [
          [0.832 * side, 0.5, -0.95],
          [0.832 * side, 0.5, -0.6],
          [0.832 * side, 0.64, -0.55],
          [0.832 * side, 0.64, -0.95],
        ],
        color: [0.08, 0.08, 0.09],
      });
    }
    const bodyMesh = new THREE.Mesh(polyGeometry([...painted, ...cabin.roof, ...spoiler]), paintMat);
    const trimMesh = new THREE.Mesh(polyGeometry([...trim, ...vents]), trimMat);
    const glassMesh = new THREE.Mesh(polyGeometry(cabin.glass), glassMat);
    this.body.add(bodyMesh, trimMesh, glassMesh);

    // Tail light band across the rear panel.
    const tail = polyGeometry([
      { pts: [[0.74, 0.58, -1.985], [0.74, 0.74, -1.985], [0.16, 0.74, -1.985], [0.16, 0.58, -1.985]] },
      { pts: [[-0.16, 0.58, -1.985], [-0.16, 0.74, -1.985], [-0.74, 0.74, -1.985], [-0.74, 0.58, -1.985]] },
    ]);
    const tailMesh = new THREE.Mesh(tail, this.tailMat);
    this.body.add(tailMesh);
    // Black rear bumper, number plate, and front bumper.
    const bumpers = polyGeometry([
      { pts: [[0.8, 0.27, -1.99], [0.8, 0.5, -1.99], [-0.8, 0.5, -1.99], [-0.8, 0.27, -1.99]], color: [0.1, 0.1, 0.11] },
      { pts: [[0.8, 0.5, -1.99], [0.8, 0.5, -1.86], [-0.8, 0.5, -1.86], [-0.8, 0.5, -1.99]], color: [0.1, 0.1, 0.11] },
      { pts: [[0.2, 0.31, -1.995], [0.2, 0.46, -1.995], [-0.2, 0.46, -1.995], [-0.2, 0.31, -1.995]], color: [0.85, 0.85, 0.75] },
      { pts: [[0.74, 0.3, 1.985], [0.74, 0.44, 1.985], [-0.74, 0.44, 1.985], [-0.74, 0.3, 1.985]], color: [0.1, 0.1, 0.11] },
    ]);
    this.body.add(new THREE.Mesh(bumpers, trimMat));
    // Front turn-signal / bumper lights.
    const front = polyGeometry([
      { pts: [[0.66, 0.35, 1.99], [0.4, 0.35, 1.99], [0.4, 0.41, 1.99], [0.66, 0.41, 1.99]] },
      { pts: [[-0.4, 0.35, 1.99], [-0.66, 0.35, 1.99], [-0.66, 0.41, 1.99], [-0.4, 0.41, 1.99]] },
    ]);
    this.body.add(new THREE.Mesh(front, this.headMat));

    // Pop-up headlights: pods hinged at their rear edge.
    this.popups = [];
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.5 * side, 0.6, 1.42);
      const pod = polyGeometry([
        { pts: [[0.17, 0, 0], [-0.17, 0, 0], [-0.17, 0, 0.38], [0.17, 0, 0.38]] }, // lid (painted)
        { pts: [[0.17, -0.14, 0.38], [0.17, 0, 0.38], [-0.17, 0, 0.38], [-0.17, -0.14, 0.38]], color: [0.12, 0.12, 0.13] },
        { pts: [[0.17, 0, 0], [0.17, 0, 0.38], [0.17, -0.14, 0.38], [0.17, -0.14, 0]] },
        { pts: [[-0.17, 0, 0], [-0.17, -0.14, 0], [-0.17, -0.14, 0.38], [-0.17, 0, 0.38]] },
      ], [0, -0.07, 0.19]);
      const lidMesh = new THREE.Mesh(pod, paintMat);
      pivot.add(lidMesh);
      const lamp = new THREE.Mesh(
        polyGeometry([{ pts: [[0.14, -0.12, 0.385], [0.14, -0.02, 0.385], [-0.14, -0.02, 0.385], [-0.14, -0.12, 0.385]] }], [0, -0.07, 0.19]),
        this.headMat,
      );
      pivot.add(lamp);
      this.body.add(pivot);
      this.popups.push(pivot);
    }
    this.popupAngle = 0;

    // Wheels.
    this.wheelMeshes = [];
    const wg = wheelGeometry(spec.wheelRadius, 0.19);
    const L = spec.wheelbase;
    const a = L * (1 - spec.frontWeight);
    const b = L * spec.frontWeight;
    const places = [
      [spec.trackFront / 2, a],
      [-spec.trackFront / 2, a],
      [spec.trackRear / 2, -b],
      [-spec.trackRear / 2, -b],
    ];
    for (const [x, z] of places) {
      const steer = new THREE.Group();
      steer.position.set(x, spec.wheelRadius, z);
      const spin = new THREE.Mesh(wg, trimMat);
      // Mirror the right-hand wheels so the rim faces outward.
      if (x < 0) spin.scale.x = -1;
      steer.add(spin);
      this.root.add(steer);
      this.wheelMeshes.push({ steer, spin });
    }
    // The body was modelled around the wheelbase centre; the CG (the origin) sits slightly behind it.
    this.bodyZ = (a - b) / 2;

    // Drop shadow: dark quad under the car.
    const shadow = polyGeometry([{ pts: [[0.7, 0.04, -1.55], [0.7, 0.04, 1.85], [-0.7, 0.04, 1.85], [-0.7, 0.04, -1.55]], color: [0.05, 0.05, 0.05] }], [0, -1, 0]);
    this.shadow = new THREE.Mesh(shadow, carMaterial({ map: white, envMap: this.envTexture, lit: false, paint: new THREE.Color(0.06, 0.06, 0.06) }));
    this.root.add(this.shadow);

    for (const o of [bodyMesh, trimMesh, glassMesh]) ensureColor(o.geometry);
  }

  _up = new THREE.Vector3();
  _fwd = new THREE.Vector3();
  _left = new THREE.Vector3();
  _basis = new THREE.Matrix4();

  setPaint(rgb) {
    this.paint.setRGB(...rgb);
  }

  updateEnv(sky) {
    drawEnvMap(this.envCanvas.getContext('2d'), 64, 32, sky);
    this.envTexture.needsUpdate = true;
  }

  // Sync with the simulation each frame.
  update(car, dt, lightsOn, braking) {
    this.root.position.set(car.x, car.y, car.z);
    // Align with the road surface: up = road normal, forward = heading projected onto the road.
    const q = car.q;
    const up = this._up.set(q.nx, q.ny, q.nz);
    const fwd = this._fwd.set(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const left = this._left.crossVectors(up, fwd);
    this._basis.makeBasis(left, up, fwd);
    this.root.quaternion.setFromRotationMatrix(this._basis);
    this.body.rotation.set(car.pitch, 0, car.roll, 'YXZ');
    this.body.position.set(0, 0.02, this.bodyZ);
    for (let i = 0; i < 4; i++) {
      const w = this.wheelMeshes[i];
      w.steer.rotation.y = i < 2 ? car.steer : 0;
      w.spin.rotation.x = car.wheels[i].angle;
    }
    const target = lightsOn ? 1 : 0;
    this.popupAngle += Math.max(-dt * 2.5, Math.min(dt * 2.5, target - this.popupAngle));
    for (const p of this.popups) p.rotation.x = -this.popupAngle * 0.95;
    this.headMat.uniforms.uEmissive.value.setScalar(lightsOn ? 0.9 : 0);
    const tail = braking ? 0.85 : lightsOn ? 0.4 : 0;
    this.tailMat.uniforms.uEmissive.value.setRGB(tail, tail * 0.08, tail * 0.06);
  }
}
