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
import { TIRES, wheelSetup } from '../config.js';
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
function tyreCurve(s, slide, falloff) {
  if (s <= 1) return 1 - (1 - s) * (1 - s);
  const e = s - 1;
  return slide + (1 - slide) * Math.exp(-e * e * falloff);
}

export class Vehicle {
  constructor(world, spec, tune, mode = 'manual') {
    this.world = world;
    this.spec = spec;
    this.tune = tune;
    this.engine = new Engine(spec.engine);
    this.trans = new Transmission(spec, mode);
    this.steer = 0; // road-wheel angle, + = left
    this.throttlePedal = 0;
    this.brakePedal = 0;
    this.launching = true;
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
      w.relaxedAngle = 0;
    }
    this.steer = 0;
    this.throttlePedal = this.brakePedal = 0;
    this.launching = true;
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

    // ---- Pedals: on/off buttons, but a foot still takes a moment to press a pedal down ----
    this.throttlePedal += clamp((input.throttle ? 1 : 0) - this.throttlePedal, -10 * dt, 4 * dt);
    this.brakePedal += clamp((input.brake ? 1 : 0) - this.brakePedal, -10 * dt, 6 * dt);

    // ---- Steering: speed-sensitive lock, rate-limited like a real rack ----
    // Caster: with no hand on the wheel the front wheels swing toward the direction of travel, which
    // is what lets a real car catch a slide (the wheel spins into the countersteer by itself).
    // Less lock at speed, but the full lock comes back while the car is sliding so you can countersteer.
    const sliding = clamp((Math.abs(this.slideAngle) - 0.08) / 0.25, 0, 1);
    const falloff = t.steerSpeedFalloff * (1 - sliding) * clamp(Math.abs(fwdSpeed) / 38, 0, 1);
    let lock = s.maxSteer * t.steering * (1 - falloff);
    // At speed, full steering asks for the angle where the front tyres grip hardest (the corner the
    // car can actually make, plus the tyre's peak slip angle) instead of scrubbing them sideways.
    if (!sliding || sliding < 1) {
      const tyreNow = TIRES[t.tire] || TIRES.street;
      const v = Math.abs(fwdSpeed);
      const rMin = (v * v) / (tyreNow.mu * (t.grip ?? 1) * G) + 0.01;
      const best = Math.atan(s.wheelbase / rMin) + tyreNow.peakAngle * 0.45;
      lock = Math.min(lock, best + (s.maxSteer - best) * sliding);
    }
    const wheelInput = clamp(input.steer, -1, 1);
    let target = -wheelInput * Math.min(lock, s.maxSteer * 1.2);
    if (Math.abs(fwdSpeed) > 3) {
      const yawRate = dot(angvel, axisY);
      const frontLateral = dot(linvel, axisX) + yawRate * s.frontAxleZ;
      const travel = clamp(Math.atan2(frontLateral, Math.abs(fwdSpeed)), -s.maxSteer, s.maxSteer);
      target += (1 - Math.abs(wheelInput)) * travel * 0.55;
    }
    const rate = 5 * dt;
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
    // Ride height moves the suspension mounts relative to the body: raise it and the body sits higher.
    const ws = wheelSetup(t);
    this.wheelSetup = ws;
    const rh = clamp((t.rideHeight || 0) / 1000, -0.08, 0.05);
    this.mountY = s.wheelMountY - rh;
    const travel = Math.max(0.07, s.suspensionTravel + rh);
    const reach = s.suspensionRest + ws.radius;
    const down = scale(axisY, -1);
    for (const w of this.wheels) {
      const mount = add(pos, rotate(q, [w.x, this.mountY, w.z]));
      // The tyre has a footprint: probe just ahead of and behind the axle too and ride on the
      // highest point, so the wheel rolls over a sharp edge instead of dropping into it.
      let hit = null;
      for (const dz of [0, 0.16, -0.16]) {
        const o = dz === 0 ? mount : add(mount, scale(axisZ, dz));
        const ray = new RAPIER.Ray({ x: o[0], y: o[1], z: o[2] }, { x: down[0], y: down[1], z: down[2] });
        const h = this.world.castRayAndGetNormal(ray, reach, true, undefined, undefined, undefined, b);
        if (h && (!hit || h.timeOfImpact < hit.timeOfImpact - 0.002)) hit = { timeOfImpact: h.timeOfImpact, normal: h.normal, collider: h.collider, centre: dz === 0 };
        if (h && hit && dz === 0) hit.collider = h.collider;
      }
      w.prevCompression = w.compression;
      if (hit) {
        const toi = hit.timeOfImpact;
        w.grounded = true;
        w.compression = clamp(reach - toi, 0, s.suspensionRest);
        w.contact = add(mount, scale(down, toi));
        w.normal = v3(hit.normal);
        w.surface = this.surfaceOf ? this.surfaceOf(hit.collider.handle) : 'asphalt';
        w.center = add(w.contact, scale(axisY, ws.radius));
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
      // The damper rate is capped (real dampers blow off on sharp hits) and the bump stop is
      // progressive, so a big kerb or rut cannot fire the car into the air.
      let f = k * w.compression + c * clamp(vel, -1.2, 1.2);
      if (w.compression > travel) {
        const into = w.compression - travel;
        f += 60000 * into + 900000 * into * into;
      }
      // Never pull the car down harder than the spring could (no sticky suspension), and never push
      // more than the car's own weight times four in one corner.
      f = Math.min(f, s.mass * G * 4 * 0.25 * 4);
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
      // Grip from the tyre compound and the surface under it. On grass some tyres get nervous:
      // their grip wanders from moment to moment.
      const tyre = TIRES[t.tire] || TIRES.street;
      let mu = tyre.mu * (t.grip ?? 1) * ws.gripScale;
      if (w.surface === 'gravel') mu *= tyre.gravel;
      if (w.surface === 'grass') {
        w.grassJitter = clamp((w.grassJitter ?? 0) * 0.9 + (Math.random() - 0.5) * 0.5, -1, 1);
        mu *= tyre.grass * (1 + tyre.grassNoise * w.grassJitter);
      }
      // Negative camber: more cornering grip, a little less under braking and traction.
      w.mu = mu;
      w.latGrip = w.front ? ws.latFront : ws.latRear;
      w.lonGrip = w.front ? ws.lonFront : ws.lonRear;
    }

    // ---- Drivetrain: wheels, engine, clutch, gearbox and LSD, sub-stepped ----
    const tr = this.trans;
    const ratio = tr.ratio();
    const rearOmega = (this.wheels[2].omega + this.wheels[3].omega) / 2;
    tr.update(dt, input, { engineRpm: this.engine.rpm, inputRpm: rearOmega * ratio * RAD_TO_RPM });
    this.engine.torqueScale = t.torque;
    const h = dt / SUBSTEPS;
    const Iw = ws.inertia;
    const r = ws.radius;
    const Ie = s.engine.inertia;
    // The engine can only stall when pulling away from (or coming to) a stop, never while driving.
    if (speed < 0.6) this.launching = true;
    else if (speed > 4) this.launching = false;
    const allowStall = tr.mode === 'manual' && this.launching;
    const throttle = tr.throttleCut ? 0 : this.throttlePedal;
    const brake = this.brakePedal;
    const hand = clamp(input.handbrake, 0, 1);
    const [WL, WR] = [this.wheels[2], this.wheels[3]];
    for (const w of this.wheels) {
      w.fxSum = 0;
      w.fySum = 0;
    }
    let clutchTorqueSum = 0;
    let diffTorque = 0;
    const tyre = TIRES[t.tire] || TIRES.street;
    for (let k = 0; k < SUBSTEPS; k++) {
      for (const w of this.wheels) {
        if (!w.grounded || w.load <= 0) {
          w.fx = w.fy = 0;
          w.slipRatio = w.slipAngle = 0;
          continue;
        }
        const ground = Math.max(Math.abs(w.vx), 3);
        const slipRatio = (w.omega * r - w.vx) / ground;
        // Tyre relaxation: the carcass takes about half a metre of rolling to build up a new slip
        // angle, so grip arrives progressively instead of snapping on and off.
        const targetAngle = Math.atan2(w.vy, Math.max(Math.abs(w.vx), 3));
        const relax = clamp(((Math.abs(w.vx) + 2) * h) / (ws.relaxation * (w.front ? ws.relaxFront : ws.relaxRear)), 0, 1);
        w.relaxedAngle = (w.relaxedAngle ?? 0) + (targetAngle - (w.relaxedAngle ?? 0)) * relax;
        const slipAngle = w.relaxedAngle;
        const sx = slipRatio / tyre.peakSlip;
        const sy = Math.tan(slipAngle) / Math.tan(tyre.peakAngle * ws.peakScale);
        const sMag = Math.hypot(sx, sy);
        const loadSens = clamp(1 - 0.06 * (w.load / (cornerMass * G) - 1), 0.8, 1.1);
        let fx = 0;
        let fy = 0;
        if (sMag > 1e-6) {
          const f = w.mu * loadSens * w.load * tyreCurve(sMag, tyre.slide, tyre.falloff);
          fx = (f * sx * w.lonGrip) / sMag;
          fy = (-f * sy * w.latGrip) / sMag;
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
        diffTorque = Math.abs((j / h) * ratio);
      } else {
        diffTorque = 0;
      }
      // Differential. Open: the rears turn freely against each other. LSD: a speed difference is
      // resisted by preload plus a share of the drive torque. Welded: the rears are one axle.
      if (t.diff === 'welded') {
        const avg = (WL.omega + WR.omega) / 2;
        WL.omega = avg;
        WR.omega = avg;
      } else if (t.diff !== 'open') {
        const lockCap = (t.lsdPreload + t.lsdLock * diffTorque) * h;
        const jl = clamp(((WL.omega - WR.omega) * Iw) / 2, -lockCap, lockCap);
        WL.omega -= jl / Iw;
        WR.omega += jl / Iw;
      }
      // Brakes and handbrake: friction torque that cannot reverse the wheel.
      for (const w of this.wheels) {
        // Brake bias splits the same total braking between the axles.
        const bias = clamp(t.brakeBias ?? 0.68, 0.4, 0.85);
        const axleTotal = s.brakeTorqueFront + s.brakeTorqueRear;
        let tb = brake * axleTotal * (w.front ? bias : 1 - bias);
        // ABS: release the foot brake on a wheel the moment it starts to lock (not the handbrake).
        if (tb > 0 && w.grounded && Math.abs(w.vx) > 2) {
          const slip = (w.omega * r - w.vx) / Math.abs(w.vx);
          if (slip * Math.sign(w.vx) < -0.14) tb *= 0.15;
        }
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
