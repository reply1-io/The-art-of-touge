// Soft guardrails. Just before the rail the car meets a cushion: a spring and damper that push it
// back toward the road and let it slide along, like a W-beam flexing on its posts. The hard rail
// collider behind it only catches what the cushion cannot.
//
// probe(x, z, out) says whether a point is inside the cushion: it sets out.pen (metres into it) and
// out.nx, out.nz (unit direction back toward the road) and returns true, or returns false.

const STIFFNESS = 110000; // N/m per contact point
const DAMPING = 7000; // N s/m per contact point, only while moving into the rail
const MAX_FORCE = 26000; // N per contact point
const SCRUB = 0.12; // sliding friction against the rail (share of the push)

// Points around the body (body space: +x left, +z forward) that can touch a rail.
const POINTS = [
  [0.82, 2.05], [-0.82, 2.05],
  [0.84, 0.0], [-0.84, 0.0],
  [0.82, -2.1], [-0.82, -2.1],
];

function rotate(q, v) {
  const { x, y, z, w } = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

export class SoftBarrier {
  constructor(probe) {
    this.probe = probe;
    this.hit = { pen: 0, nx: 0, nz: 0 };
    this.touching = false;
    this.impact = 0; // strongest push this step (N), for sound or shake
    this.contacts = [];
  }

  apply(body) {
    const p = body.translation();
    const q = body.rotation();
    const v = body.linvel();
    const w = body.angvel();
    const hit = this.hit;
    this.touching = false;
    this.impact = 0;
    this.contacts = []; // [{ x, y, z, nx, nz, f }] for sparks
    for (const [bx, bz] of POINTS) {
      const r = rotate(q, [bx, -0.1, bz]);
      const x = p.x + r[0];
      const z = p.z + r[2];
      if (!this.probe(x, z, hit)) continue;
      // Velocity of this point of the body.
      const vx = v.x + w.y * r[2] - w.z * r[1];
      const vz = v.z + w.x * r[1] - w.y * r[0];
      const vn = vx * hit.nx + vz * hit.nz; // + = moving back toward the road
      let f = STIFFNESS * hit.pen + (vn < 0 ? -DAMPING * vn : 0);
      f = Math.min(f, MAX_FORCE);
      // A little scrub along the rail, opposing the slide.
      const tx = vx - vn * hit.nx;
      const tz = vz - vn * hit.nz;
      const tl = Math.hypot(tx, tz) || 1;
      const fx = hit.nx * f - (tx / tl) * f * SCRUB;
      const fz = hit.nz * f - (tz / tl) * f * SCRUB;
      body.addForceAtPoint({ x: fx, y: 0, z: fz }, { x, y: p.y + r[1], z }, true);
      this.touching = true;
      this.contacts.push({ x, y: p.y + r[1], z, nx: hit.nx, nz: hit.nz, f });
      this.impact = Math.max(this.impact, f);
    }
  }
}
