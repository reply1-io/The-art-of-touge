// Vehicle simulation: tires, suspension load transfer, engine, clutch, gearbox and differential.
// Pure math with no three.js dependency, so it can be tested in Node.
//
// The body moves in the road plane (x, z, yaw) and follows the road vertically through a spring,
// which gives load changes over crests and dips. Each wheel has its own spin speed, so wheelspin,
// lock-ups, clutch kicks and handbrake entries come out of the simulation rather than scripts.

const G = 9.81;
const RPM = 60 / (2 * Math.PI); // rad/s -> rpm
const AIR_DENSITY = 1.2;

export const TRANSMISSION = {
  MANUAL_CLUTCH: 'manual-clutch',
  MANUAL: 'manual',
  AUTO: 'auto',
};

function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Normalised combined-slip tire curve: rises to 1 at s = 1, then falls to `slide` as the tire slides.
function tireCurve(s, slide) {
  if (s <= 1) return 1 - (1 - s) * (1 - s);
  const e = s - 1;
  return slide + (1 - slide) * Math.exp(-e * e * 1.5);
}

export class CarSim {
  constructor(spec, track) {
    this.spec = spec;
    this.track = track;
    this.transmission = TRANSMISSION.MANUAL;
    this.steerAssist = true;
    const L = spec.wheelbase;
    this.a = L * (1 - spec.frontWeight); // CG to front axle
    this.b = L * spec.frontWeight; // CG to rear axle
    // Wheel order: front-left, front-right, rear-left, rear-right. Positions in the car frame (u forward, v left).
    this.wheels = [
      { u: this.a, v: spec.trackFront / 2, front: true },
      { u: this.a, v: -spec.trackFront / 2, front: true },
      { u: -this.b, v: spec.trackRear / 2, front: false },
      { u: -this.b, v: -spec.trackRear / 2, front: false },
    ].map((w) => ({
      ...w,
      omega: 0,
      angle: 0, // accumulated rotation, for rendering
      load: 0,
      slipRatio: 0,
      slipAngle: 0,
      fx: 0,
      fy: 0,
      grip: 1,
      surface: 0, // 0 asphalt, 1 shoulder
    }));
    const k = (spec.mass * G) / spec.suspensionSag;
    this.springK = k;
    this.springC = 2 * spec.suspensionDamping * Math.sqrt(k * spec.mass);
    this.q = {};
    this.reset(8);
  }

  reset(index = 8) {
    const t = this.track;
    this.hint = index;
    this.x = t.x[index];
    this.z = t.z[index];
    this.y = t.y[index];
    this.vy = 0;
    this.yaw = t.heading[index];
    this.vx = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.pitch = 0;
    this.roll = 0;
    this.steer = 0; // road-wheel angle, positive = left
    this.engineOmega = this.spec.engine.idle / RPM;
    this.gear = 1;
    this.coupling = 0; // actual clutch engagement 0..1
    this.shiftTimer = 0;
    this.limiterCut = false;
    this.accelU = 0;
    this.accelV = 0;
    this.loadU = 0; // filtered accelerations used for load transfer
    this.loadV = 0;
    this.groundY = this.y;
    this.prevGroundY = this.y;
    this.wallHit = 0; // strongest wall impact speed this frame (m/s)
    this.message = '';
    this.messageTimer = 0;
    this.clutchTorque = 0;
    this.throttleApplied = 0;
    for (const w of this.wheels) {
      w.omega = 0;
      w.slipRatio = 0;
      w.slipAngle = 0;
      w.fx = 0;
      w.fy = 0;
    }
    this.track.query(this.x, this.z, this.hint, this.q);
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  // Signed forward speed in m/s.
  get forwardSpeed() {
    return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
  }

  get rpm() {
    return this.engineOmega * RPM;
  }

  get gearLabel() {
    return this.gear === -1 ? 'R' : this.gear === 0 ? 'N' : String(this.gear);
  }

  // Slip angle of the whole car (radians), positive when the velocity points to the left of the nose.
  get driftAngle() {
    const sp = this.speed;
    if (sp < 3) return 0;
    const fu = this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
    const fv = this.vx * Math.cos(this.yaw) - this.vz * Math.sin(this.yaw);
    return Math.atan2(fv, Math.abs(fu));
  }

  #flash(msg) {
    this.message = msg;
    this.messageTimer = 1.2;
  }

  #gearRatio(gear) {
    const s = this.spec;
    if (gear === 0) return 0;
    if (gear === -1) return -s.reverse * s.finalDrive;
    return s.gears[gear - 1] * s.finalDrive;
  }

  #drivenOmega() {
    const w = this.wheels;
    return this.spec.driven === 'rear' ? (w[2].omega + w[3].omega) / 2 : (w[0].omega + w[1].omega) / 2;
  }

  // ---- Gear changes (called once per frame with button edges) ----
  shift(dir, clutchPedal) {
    const maxGear = this.spec.gears.length;
    const fwd = this.forwardSpeed;
    if (this.transmission === TRANSMISSION.AUTO) {
      if (dir < 0 && this.gear === 1 && Math.abs(fwd) < 1.5) this.gear = -1;
      else if (dir > 0 && this.gear === -1 && Math.abs(fwd) < 1.5) this.gear = 1;
      else if (this.gear >= 1) this.gear = clamp(this.gear + dir, 1, maxGear);
      this.shiftTimer = 0.25;
      return;
    }
    let target = this.gear + dir;
    if (target > maxGear) return;
    if (target < -1) return;
    if (target === -1 && fwd > 1.5) {
      this.#flash('TOO FAST FOR REVERSE');
      return;
    }
    if (this.transmission === TRANSMISSION.MANUAL_CLUTCH && target !== 0 && clutchPedal < 0.6) {
      this.#flash('CLUTCH!');
      return;
    }
    this.gear = target;
    if (this.transmission === TRANSMISSION.MANUAL) this.shiftTimer = 0.22;
  }

  // ---- Clutch engagement for each transmission mode ----
  #updateCoupling(dt, input) {
    const s = this.spec;
    const pedal = clamp(input.clutch || 0, 0, 1);
    // Pedal travel: fully engaged until 20% pressed, fully free beyond 80%.
    const pedalCoupling = 1 - smoothstep(0.2, 0.8, pedal);
    if (this.transmission === TRANSMISSION.MANUAL_CLUTCH) {
      this.coupling = pedalCoupling;
      return;
    }
    // Automatic clutch: open during shifts, slips for launches, opens with the handbrake and when stopping.
    let target = 1;
    if (this.shiftTimer > 0) {
      target = this.shiftTimer > 0.1 ? 0 : 1 - this.shiftTimer / 0.1;
    } else {
      const inRpm = Math.abs(this.#drivenOmega() * this.#gearRatio(this.gear)) * RPM;
      if (inRpm < s.engine.idle * 1.4) {
        target = input.throttle > 0.02 ? smoothstep(s.engine.idle + 200, s.engine.idle + 2400, this.rpm) : 0;
      }
    }
    if ((input.handbrake || 0) > 0.3) target = 0;
    target = Math.min(target, pedalCoupling);
    // The automatic clutch moves quickly but not instantly.
    const rate = 8 * dt;
    this.coupling += clamp(target - this.coupling, -rate * 2, rate);
  }

  #autoShift(throttle) {
    if (this.transmission !== TRANSMISSION.AUTO || this.shiftTimer > 0 || this.gear < 1) return;
    const rpm = this.rpm;
    const maxGear = this.spec.gears.length;
    const up = 3600 + (this.spec.engine.redline - 300 - 3600) * clamp(throttle, 0, 1);
    const down = 1700 + 2300 * clamp(throttle, 0, 1);
    if (rpm > up && this.gear < maxGear && this.coupling > 0.9) {
      this.gear++;
      this.shiftTimer = 0.25;
    } else if (rpm < down && this.gear > 1) {
      // Only downshift if the engine will not over-rev.
      const next = this.#gearRatio(this.gear - 1);
      if (Math.abs(this.#drivenOmega() * next) * RPM < this.spec.engine.redline - 600) {
        this.gear--;
        this.shiftTimer = 0.25;
      }
    }
  }

  #engineTorque(throttle) {
    const e = this.spec.engine;
    const rpm = this.rpm;
    // Rev limiter (fuel cut with hysteresis).
    if (rpm > e.limiter) this.limiterCut = true;
    else if (rpm < e.limiter - 250) this.limiterCut = false;
    let thr = this.limiterCut ? 0 : throttle;
    // Idle control keeps the engine running.
    thr = Math.max(thr, clamp((e.idle - rpm) / 150, 0, 1) * 0.6);
    this.throttleApplied = thr;
    const full = interp(e.torque, rpm);
    const friction = e.friction + e.frictionPerRpm * rpm;
    return thr * full - (1 - thr) * friction;
  }

  // ---- One simulation step ----
  // input: { throttle, brake, clutch, handbrake, steer (-1 right .. +1 left) }
  step(dt, input) {
    const s = this.spec;
    const q = this.q;
    const m = s.mass;

    if (this.shiftTimer > 0) this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    if (this.messageTimer > 0) this.messageTimer -= dt;

    // ---- Road under the car ----
    this.track.query(this.x, this.z, this.hint, q);
    this.hint = q.index;

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    // Car-frame velocity (u forward, v left).
    const vu = this.vx * sinY + this.vz * cosY;
    const vv = this.vx * cosY - this.vz * sinY;

    // ---- Steering ----
    let targetSteer = clamp(input.steer || 0, -1, 1) * s.maxSteer;
    if (this.steerAssist && Math.abs(vu) > 4) {
      // Keep the front wheels within a speed-dependent window around the direction of travel.
      // This keeps touch steering controllable at speed without blocking countersteer.
      const frontV = vv + this.yawRate * this.a;
      const travel = clamp(Math.atan2(frontV, Math.abs(vu)), -s.maxSteer, s.maxSteer);
      const window = Math.max((7 * Math.PI) / 180, s.maxSteer * (1 - Math.abs(vu) / 38));
      targetSteer = clamp(targetSteer, travel - window, travel + window);
    }
    const steerStep = s.steerRate * dt;
    this.steer += clamp(targetSteer - this.steer, -steerStep, steerStep);

    // ---- Vertical: follow the road through a spring ----
    this.prevGroundY = this.groundY;
    this.groundY = q.height;
    const groundVel = (this.groundY - this.prevGroundY) / dt;
    const comp = this.groundY - this.y + s.suspensionSag;
    let spring = 0;
    if (comp > 0) spring = Math.max(0, this.springK * comp - this.springC * (this.vy - groundVel));
    this.vy += (spring / m - G) * dt;
    this.y += this.vy * dt;
    if (this.y < this.groundY - 0.1) {
      // Bump stop.
      this.y = this.groundY - 0.1;
      if (this.vy < groundVel) this.vy = groundVel;
    }
    const normalForce = spring / Math.max(q.ny, 0.5);

    // ---- Load transfer ----
    const lag = clamp(dt / 0.09, 0, 1);
    this.loadU += (this.accelU - this.loadU) * lag;
    this.loadV += (this.accelV - this.loadV) * lag;
    const loadScale = normalForce / (m * G);
    const longT = (m * this.loadU * s.cgHeight) / s.wheelbase;
    const front = normalForce * s.frontWeight - longT * loadScale;
    const rear = normalForce * (1 - s.frontWeight) + longT * loadScale;
    const latF = (s.rollStiffnessFront * m * this.loadV * s.cgHeight) / s.trackFront * loadScale;
    const latR = ((1 - s.rollStiffnessFront) * m * this.loadV * s.cgHeight) / s.trackRear * loadScale;
    const W = this.wheels;
    // Accelerating to the left (positive loadV) moves load onto the right-hand wheels.
    W[0].load = Math.max(0, front / 2 - latF);
    W[1].load = Math.max(0, front / 2 + latF);
    W[2].load = Math.max(0, rear / 2 - latR);
    W[3].load = Math.max(0, rear / 2 + latR);

    // ---- Tire forces ----
    let fu = 0;
    let fv = 0;
    let mz = 0;
    const r = s.wheelRadius;
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      const delta = w.front ? this.steer : 0;
      const cd = Math.cos(delta);
      const sd = Math.sin(delta);
      const pu = vu - this.yawRate * w.v;
      const pv = vv + this.yawRate * w.u;
      const wx = pu * cd + pv * sd; // along the wheel
      const wy = -pu * sd + pv * cd; // across the wheel

      // Surface: asphalt or loose shoulder.
      const lat = q.lateral + w.u * Math.sin(this.yaw - q.heading) + w.v * Math.cos(this.yaw - q.heading);
      w.surface = Math.abs(lat) > 3.1 ? 1 : 0;
      const staticLoad = (m * G * (w.front ? s.frontWeight : 1 - s.frontWeight)) / 2;
      const loadSens = 1 - 0.12 * (w.load / staticLoad - 1);
      const mu = s.tireMu * (w.surface ? 0.72 : 1) * clamp(loadSens, 0.7, 1.15);
      w.grip = mu;

      const ground = Math.max(Math.abs(wx), 2.5);
      const slipRatio = (w.omega * r - wx) / ground;
      const slipAngle = Math.atan2(wy, Math.max(Math.abs(wx), 2.5));
      const sx = slipRatio / s.tireSlipPeak;
      const sy = Math.tan(slipAngle) / Math.tan(s.tireAnglePeak);
      const sMag = Math.hypot(sx, sy);
      let fx = 0;
      let fy = 0;
      if (sMag > 1e-6 && w.load > 0) {
        const f = mu * w.load * tireCurve(sMag, s.tireSlide);
        fx = (f * sx) / sMag;
        fy = (-f * sy) / sMag;
      }
      // Stability limits: a tire cannot push harder than it takes to remove its own slip this step.
      const fxMax = (Math.abs(w.omega * r - wx) * s.wheelInertia) / (r * r * dt);
      fx = clamp(fx, -fxMax, fxMax);
      const fyMax = (Math.abs(wy) * (w.load / G)) / dt;
      fy = clamp(fy, -fyMax, fyMax);
      // Rolling resistance.
      const roll = 0.012 * w.load;

      w.fx = fx;
      w.fy = fy;
      w.slipRatio = slipRatio;
      w.slipAngle = slipAngle;

      const cu = fx * cd - fy * sd;
      const cv = fx * sd + fy * cd;
      fu += cu;
      fv += cv;
      mz += w.u * cv - w.v * cu;

      // Wheel spin from the tire reaction and rolling resistance.
      w.omega -= ((fx * r) / s.wheelInertia) * dt;
      const rollStep = ((roll * r) / s.wheelInertia) * dt;
      w.omega = Math.abs(w.omega) <= rollStep ? 0 : w.omega - Math.sign(w.omega) * rollStep;
    }

    // ---- Engine, clutch, gearbox, differential ----
    this.#updateCoupling(dt, input);
    this.#autoShift(input.throttle || 0);
    const throttle = clamp(input.throttle || 0, 0, 1);
    const engineT = this.#engineTorque(throttle);
    this.engineOmega += (engineT / s.engine.inertia) * dt;
    const ratio = this.#gearRatio(this.gear);
    const dA = s.driven === 'rear' ? W[2] : W[0];
    const dB = s.driven === 'rear' ? W[3] : W[1];
    this.clutchTorque = 0;
    if (ratio !== 0 && this.coupling > 0.001) {
      // Implicit clutch: the impulse that would sync engine and gearbox, limited by clutch capacity.
      const inOmega = ((dA.omega + dB.omega) / 2) * ratio;
      const drivelineInertia = (2 * s.wheelInertia) / (ratio * ratio);
      const want = (this.engineOmega - inOmega) / (1 / s.engine.inertia + 1 / drivelineInertia);
      const cap = s.clutchTorque * this.coupling * dt;
      const j = clamp(want, -cap, cap);
      this.engineOmega -= j / s.engine.inertia;
      const wheelImpulse = (j * ratio * s.drivelineEfficiency) / 2; // open diff: equal torque split
      dA.omega += wheelImpulse / s.wheelInertia;
      dB.omega += wheelImpulse / s.wheelInertia;
      this.clutchTorque = j / dt;
    }
    if (s.diff === 'lsd') {
      // Clutch-type LSD: resist speed difference between the driven wheels.
      const lock = (40 + 0.6 * Math.abs(this.clutchTorque * ratio)) * dt;
      const want = ((dA.omega - dB.omega) * s.wheelInertia) / 2;
      const j = clamp(want, -lock, lock);
      dA.omega -= j / s.wheelInertia;
      dB.omega += j / s.wheelInertia;
    }
    // Anti-stall: the engine never drops below a minimum speed.
    const minOmega = 650 / RPM;
    if (this.engineOmega < minOmega) this.engineOmega = minOmega;

    // ---- Brakes ----
    const brake = clamp(input.brake || 0, 0, 1);
    const hand = clamp(input.handbrake || 0, 0, 1);
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      let tb = brake * (w.front ? s.brakeTorqueFront : s.brakeTorqueRear);
      if (!w.front) tb += hand * s.handbrakeTorque;
      if (tb <= 0) continue;
      const stepOmega = (tb / s.wheelInertia) * dt;
      w.omega = Math.abs(w.omega) <= stepOmega ? 0 : w.omega - Math.sign(w.omega) * stepOmega;
    }
    for (const w of W) w.angle += w.omega * dt;

    // ---- Body ----
    const speed = Math.hypot(this.vx, this.vz);
    const drag = 0.5 * AIR_DENSITY * s.dragArea * speed;
    let ax = (fu * sinY + fv * cosY) / m - drag * this.vx / m;
    let az = (fu * cosY - fv * sinY) / m - drag * this.vz / m;
    // The road surface pushes along its normal: this is what makes the car roll downhill and lean on banks.
    ax += (normalForce * q.nx) / m;
    az += (normalForce * q.nz) / m;
    this.vx += ax * dt;
    this.vz += az * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.yawRate += (mz / s.yawInertia) * dt;
    this.yaw += this.yawRate * dt;
    this.accelU = fu / m;
    this.accelV = fv / m;

    // Body attitude for rendering (approximate pitch and roll from load transfer).
    this.pitch = clamp(-this.loadU * 0.012, -0.06, 0.06);
    this.roll = clamp(this.loadV * 0.014, -0.08, 0.08);

    this.#collideWalls();
  }

  // Keep the car between the guardrail and the mountainside with a rigid-body impulse at the worst corner.
  #collideWalls() {
    const s = this.spec;
    const q = this.q;
    this.track.query(this.x, this.z, this.hint, q);
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const hl = s.length / 2;
    const hw = s.width / 2;
    for (const side of [1, -1]) {
      const limit = side > 0 ? q.limitLeft : -q.limitRight;
      let worst = 0;
      let cu = 0;
      let cv = 0;
      for (const [u, v] of [
        [hl, hw],
        [hl, -hw],
        [-hl, hw],
        [-hl, -hw],
      ]) {
        // Corner offset projected onto the road's left axis.
        const wx = u * sinY + v * cosY;
        const wz = u * cosY - v * sinY;
        const lat = (q.lateral + wx * q.leftX + wz * q.leftZ) * side;
        const pen = lat - limit;
        if (pen > worst) {
          worst = pen;
          cu = u;
          cv = v;
        }
      }
      if (worst <= 0) continue;
      // Wall normal points back toward the road.
      const nx = -q.leftX * side;
      const nz = -q.leftZ * side;
      this.x += nx * worst;
      this.z += nz * worst;
      // Contact point relative to the CG in world space.
      const rx = cu * sinY + cv * cosY;
      const rz = cu * cosY - cv * sinY;
      // Velocity of the contact point (yaw about +y: v = w x r -> (w*rz, -w*rx)).
      const pvx = this.vx + this.yawRate * rz;
      const pvz = this.vz - this.yawRate * rx;
      const vn = pvx * nx + pvz * nz;
      if (vn >= 0) continue;
      const rCrossN = rz * nx - rx * nz; // torque arm for an impulse along n
      const e = 0.15;
      const jn = (-(1 + e) * vn) / (1 / s.mass + (rCrossN * rCrossN) / s.yawInertia);
      // Friction along the wall.
      const tx = -nz;
      const tz = nx;
      const vt = pvx * tx + pvz * tz;
      const rCrossT = rz * tx - rx * tz;
      const jtMax = 0.35 * jn;
      const jt = clamp(-vt / (1 / s.mass + (rCrossT * rCrossT) / s.yawInertia), -jtMax, jtMax);
      this.vx += (jn * nx + jt * tx) / s.mass;
      this.vz += (jn * nz + jt * tz) / s.mass;
      this.yawRate += (jn * rCrossN + jt * rCrossT) / s.yawInertia;
      this.wallHit = Math.max(this.wallHit, -vn);
    }

    // Barriers across the road at both ends of the section.
    const tx = Math.sin(q.heading);
    const tz = Math.cos(q.heading);
    const ends = [
      [2.5 + hl, 1],
      [this.track.length - 2.5 - hl, -1],
    ];
    for (const [limitS, dir] of ends) {
      const pen = (limitS - q.s) * dir;
      if (pen <= 0) continue;
      this.x += tx * pen * dir;
      this.z += tz * pen * dir;
      const vt = (this.vx * tx + this.vz * tz) * dir;
      if (vt < 0) {
        this.vx -= tx * vt * dir * 1.2;
        this.vz -= tz * vt * dir * 1.2;
        this.wallHit = Math.max(this.wallHit, -vt);
      }
      this.yawRate *= 0.9;
    }
  }
}
