// Raycast vehicle on a Rapier rigid body.
//
// The chassis is a real rigid body. Each wheel casts a ray down from its suspension mount; the
// hit gives spring compression, and the spring/damper force plus the tyre force are applied to
// the chassis at the contact point. Every wheel has its own spin speed, driven through the
// clutch, gearbox and a limited-slip differential, so wheelspin, lock-ups, weight transfer,
// body roll and drifts all come out of the simulation.
//
// Body space: +x left, +y up, +z forward.

import RAPIER from '@dimforge/rapier3d-compat';
import { Engine, RAD_TO_RPM } from './engine.js';
import { Transmission } from './transmission.js';

const G = 9.81;
const SUBSTEPS = 8; // wheel / drivetrain integration steps per physics step
const AIR_DENSITY = 1.2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// --- tiny vector helpers on [x, y, z] arrays ---
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const v3 = (v) => [v.x, v.y, v.z];
function rotate(q, v) {
  // v' = q * v * q^-1
  const { x, y, z, w } = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

// Normalised combined-slip tyre curve: rises to 1 at s = 1, then falls toward `slide`.
function tyreCurve(s, slide) {
  if (s <= 1) return 1 - (1 - s) * (1 - s);
  const e = s - 1;
  return slide + (1 - slide) * Math.exp(-e * e * 1.4);
}

export class Vehicle {
  constructor(world, spec, tune, mode = 'manual') {
    this.world = world;
    this.spec = spec;
    this.tune = tune;
    this.engine = new Engine(spec.engine);
    this.trans = new Transmission(spec, mode);
    this.steer = 0; // road-wheel angle, + = left
    this.wheels = [
      { x: spec.trackFront / 2, z: spec.frontAxleZ, front: true, left: true },
      { x: -spec.trackFront / 2, z: spec.frontAxleZ, front: true, left: false },
      { x: spec.trackRear / 2, z: spec.rearAxleZ, front: false, left: true },
      { x: -spec.trackRear / 2, z: spec.rearAxleZ, front: false, left: false },
    ].map((w) => ({
      ...w,
      omega: 0,
      angle: 0, // accumulated spin, for rendering
      steer: 0,
      compression: 0,
      prevCompression: 0,
      load: 0,
      grounded: false,
      slipRatio: 0,
      slipAngle: 0,
      fx: 0,
      fy: 0,
      center: [0, 0, 0], // world position of the wheel centre, for rendering
      contact: null,
    }));
    this.#createBody();
  }

  #createBody() {
    const s = this.spec;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 1, 0)
      .setCcdEnabled(true)
      .setAdditionalMassProperties(s.mass, s.centerOfMass, s.inertia, { x: 0, y: 0, z: 0, w: 1 });
    this.body = this.world.createRigidBody(desc);
    const he = s.halfExtents;
    // Main body box sits a little above the mount line; the colliders carry no mass of their own.
    const main = RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z).setTranslation(0, 0.12, 0).setDensity(0).setFriction(0.35).setRestitution(0.05);
    this.collider = this.world.createCollider(main, this.body);
    // Cabin box, so the car does not roll into the ground on its roof edge.
    const cabin = RAPIER.ColliderDesc.cuboid(0.68, 0.22, 0.95).setTranslation(0, 0.62, -0.15).setDensity(0).setFriction(0.35);
    this.world.createCollider(cabin, this.body);
  }

  get mode() {
    return this.trans.mode;
  }

  setMode(mode) {
    this.trans.setMode(mode);
  }

  reset(position, yaw) {
    const b = this.body;
    b.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
    b.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    b.resetForces(true);
    for (const w of this.wheels) {
      w.omega = 0;
      w.compression = w.prevCompression = 0;
    }
    this.steer = 0;
    this.engine.omega = this.spec.engine.idleRpm / RAD_TO_RPM;
    this.engine.running = true;
    this.trans.gear = this.trans.mode === 'auto' ? (this.trans.drive === 'R' ? -1 : 1) : 0;
    this.trans.coupling = 1;
  }

  // Signed speed along the car's nose, m/s.
  get forwardSpeed() {
    const v = v3(this.body.linvel());
    return dot(v, rotate(this.body.rotation(), [0, 0, 1]));
  }

  get speed() {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  // Angle between where the nose points and where the car is going (radians, + = sliding right).
  get slideAngle() {
    const v = v3(this.body.linvel());
    const q = this.body.rotation();
    const f = dot(v, rotate(q, [0, 0, 1]));
    const l = dot(v, rotate(q, [1, 0, 0]));
    if (Math.hypot(f, l) < 3) return 0;
    return Math.atan2(l, Math.abs(f));
  }

  get rpm() {
    return this.engine.rpm;
  }

  // input: { throttle 0/1, brake 0/1, handbrake 0/1, clutch bool, steer -1 (left) .. +1 (right) }
  step(dt, input) {
    const s = this.spec;
    const t = this.tune;
    const b = this.body;
    const q = b.rotation();
    const pos = v3(b.translation());
    const linvel = v3(b.linvel());
    const angvel = v3(b.angvel());
    const com = v3(b.worldCom());
    const axisX = rotate(q, [1, 0, 0]);
    const axisY = rotate(q, [0, 1, 0]);
    const axisZ = rotate(q, [0, 0, 1]);
    const speed = Math.hypot(linvel[0], linvel[1], linvel[2]);
    const fwdSpeed = dot(linvel, axisZ);

    b.resetForces(true);
    b.resetTorques(true);

    // ---- Steering: speed-sensitive lock, rate-limited like a real rack ----
    const lock = s.maxSteer * t.steering * (1 - t.steerSpeedFalloff * clamp(Math.abs(fwdSpeed) / 38, 0, 1));
    const target = -clamp(input.steer, -1, 1) * Math.min(lock, s.maxSteer * 1.2);
    const rate = 3.2 * dt;
    this.steer += clamp(target - this.steer, -rate, rate);
    // Ackermann: the inside wheel turns more.
    for (const w of this.wheels) {
      if (!w.front || Math.abs(this.steer) < 1e-4) {
        w.steer = w.front ? this.steer : 0;
        continue;
      }
      const R = s.wheelbase / Math.tan(this.steer);
      w.steer = Math.atan(s.wheelbase / (R - w.x));
    }

    // ---- Suspension raycasts ----
    const reach = s.suspensionRest + s.wheelRadius;
    const down = scale(axisY, -1);
    for (const w of this.wheels) {
      const mount = add(pos, rotate(q, [w.x, s.wheelMountY, w.z]));
      const ray = new RAPIER.Ray({ x: mount[0], y: mount[1], z: mount[2] }, { x: down[0], y: down[1], z: down[2] });
      const hit = this.world.castRayAndGetNormal(ray, reach, true, undefined, undefined, undefined, b);
      w.prevCompression = w.compression;
      if (hit) {
        const toi = hit.timeOfImpact;
        w.grounded = true;
        w.compression = clamp(reach - toi, 0, s.suspensionRest);
        w.contact = add(mount, scale(down, toi));
        w.normal = v3(hit.normal);
        w.center = add(w.contact, scale(axisY, s.wheelRadius));
      } else {
        w.grounded = false;
        w.compression = 0;
        w.contact = null;
        w.center = add(mount, scale(down, s.suspensionRest));
      }
    }
    // Spring, damper, bump stop and anti-roll bars.
    const cornerMass = s.mass / 4;
    for (const w of this.wheels) {
      if (!w.grounded) {
        w.load = 0;
        continue;
      }
      const k = w.front ? t.springFront : t.springRear;
      const c = 2 * t.damping * Math.sqrt(k * cornerMass);
      const vel = (w.compression - w.prevCompression) / dt;
      let f = k * w.compression + c * vel;
      if (w.compression > s.suspensionTravel) f += 250000 * (w.compression - s.suspensionTravel);
      w.load = Math.max(0, f);
    }
    for (const [l, r, kArb] of [
      [this.wheels[0], this.wheels[1], t.antiRollFront],
      [this.wheels[2], this.wheels[3], t.antiRollRear],
    ]) {
      const d = kArb * (l.compression - r.compression);
      if (l.grounded) l.load = Math.max(0, l.load + d);
      if (r.grounded) r.load = Math.max(0, r.load - d);
    }

    // ---- Tyre contact frames and slip velocities ----
    for (const w of this.wheels) {
      if (!w.grounded) continue;
      const cs = Math.cos(w.steer);
      const sn = Math.sin(w.steer);
      const heading = add(scale(axisZ, cs), scale(axisX, sn));
      const n = w.normal;
      w.fwd = norm(sub(heading, scale(n, dot(heading, n))));
      w.side = norm(cross(n, w.fwd)); // points left
      const r = sub(w.contact, com);
      const pv = add(linvel, cross(angvel, r));
      w.vx = dot(pv, w.fwd);
      w.vy = dot(pv, w.side);
      w.mu = t.grip;
    }

    // ---- Drivetrain: wheels, engine, clutch, gearbox and LSD, sub-stepped ----
    const tr = this.trans;
    const ratio = tr.ratio();
    const rearOmega = (this.wheels[2].omega + this.wheels[3].omega) / 2;
    tr.update(dt, input, { engineRpm: this.engine.rpm, inputRpm: rearOmega * ratio * RAD_TO_RPM });
    this.engine.torqueScale = t.torque;
    const h = dt / SUBSTEPS;
    const Iw = s.wheelInertia;
    const r = s.wheelRadius;
    const Ie = s.engine.inertia;
    const allowStall = tr.mode === 'manual';
    const throttle = tr.throttleCut ? 0 : clamp(input.throttle, 0, 1);
    const brake = clamp(input.brake, 0, 1);
    const hand = clamp(input.handbrake, 0, 1);
    const [WL, WR] = [this.wheels[2], this.wheels[3]];
    for (const w of this.wheels) {
      w.fxSum = 0;
      w.fySum = 0;
    }
    let clutchTorqueSum = 0;
    for (let k = 0; k < SUBSTEPS; k++) {
      for (const w of this.wheels) {
        if (!w.grounded || w.load <= 0) {
          w.fx = w.fy = 0;
          w.slipRatio = w.slipAngle = 0;
          continue;
        }
        const ground = Math.max(Math.abs(w.vx), 3);
        const slipRatio = (w.omega * r - w.vx) / ground;
        const slipAngle = Math.atan2(w.vy, Math.max(Math.abs(w.vx), 3));
        const sx = slipRatio / 0.11;
        const sy = Math.tan(slipAngle) / Math.tan(0.14);
        const sMag = Math.hypot(sx, sy);
        const loadSens = clamp(1 - 0.1 * (w.load / (cornerMass * G) - 1), 0.75, 1.12);
        let fx = 0;
        let fy = 0;
        if (sMag > 1e-6) {
          const f = w.mu * loadSens * w.load * tyreCurve(sMag, 0.86);
          fx = (f * sx) / sMag;
          fy = (-f * sy) / sMag;
        }
        // A tyre cannot push harder than it takes to remove its own slip in this step.
        const fxMax = (Math.abs(w.omega * r - w.vx) * Iw) / (r * r * h);
        fx = clamp(fx, -fxMax, fxMax);
        const fyMax = (Math.abs(w.vy) * (w.load / G)) / dt;
        fy = clamp(fy, -fyMax, fyMax);
        w.fx = fx;
        w.fy = fy;
        w.slipRatio = slipRatio;
        w.slipAngle = slipAngle;
        w.fxSum += fx;
        w.fySum += fy;
        w.omega -= ((fx * r) / Iw) * h;
        const rollStep = ((s.rollingResistance * w.load * r) / Iw) * h;
        w.omega = Math.abs(w.omega) <= rollStep ? 0 : w.omega - Math.sign(w.omega) * rollStep;
      }
      // Engine and clutch.
      this.engine.integrate(this.engine.torque(throttle), h);
      if (ratio !== 0 && tr.coupling > 0.001) {
        const inOmega = ((WL.omega + WR.omega) / 2) * ratio;
        const Id = (2 * Iw) / (ratio * ratio);
        const want = (this.engine.omega - inOmega) / (1 / Ie + 1 / Id);
        const cap = s.clutchTorque * tr.coupling * h;
        const j = clamp(want, -cap, cap);
        this.engine.omega -= j / Ie;
        const each = (j * ratio * s.drivelineEfficiency) / 2;
        WL.omega += each / Iw;
        WR.omega += each / Iw;
        clutchTorqueSum += j / h;
        // Limited-slip: resist a speed difference across the axle (preload + share of drive torque).
        const lockCap = (t.lsdPreload + t.lsdLock * Math.abs((j / h) * ratio)) * h;
        const jl = clamp(((WL.omega - WR.omega) * Iw) / 2, -lockCap, lockCap);
        WL.omega -= jl / Iw;
        WR.omega += jl / Iw;
      } else {
        // Out of gear the LSD still holds a little preload.
        const lockCap = t.lsdPreload * h;
        const jl = clamp(((WL.omega - WR.omega) * Iw) / 2, -lockCap, lockCap);
        WL.omega -= jl / Iw;
        WR.omega += jl / Iw;
      }
      // Brakes and handbrake: friction torque that cannot reverse the wheel.
      for (const w of this.wheels) {
        let tb = brake * (w.front ? s.brakeTorqueFront : s.brakeTorqueRear);
        if (!w.front) tb += hand * s.handbrakeTorque;
        if (tb <= 0) continue;
        const d = (tb / Iw) * h;
        w.omega = Math.abs(w.omega) <= d ? 0 : w.omega - Math.sign(w.omega) * d;
      }
      this.engine.checkStall(allowStall);
    }
    this.clutchTorque = clutchTorqueSum / SUBSTEPS;

    // ---- Apply forces to the chassis ----
    for (const w of this.wheels) {
      w.angle += w.omega * dt;
      if (!w.grounded) continue;
      w.fx = w.fxSum / SUBSTEPS;
      w.fy = w.fySum / SUBSTEPS;
      const f = add(add(scale(axisY, w.load), scale(w.fwd, w.fx)), scale(w.side, w.fy));
      b.addForceAtPoint({ x: f[0], y: f[1], z: f[2] }, { x: w.contact[0], y: w.contact[1], z: w.contact[2] }, true);
    }
    const drag = 0.5 * AIR_DENSITY * s.dragArea * speed;
    b.addForce({ x: -drag * linvel[0], y: -drag * linvel[1], z: -drag * linvel[2] }, true);
  }
}
