// Engine: torque curve, idle control, rev limiter, engine braking, stalling and restarting.
// Pure JavaScript (no Rapier), so it can be tested on its own.

export const RAD_TO_RPM = 60 / (2 * Math.PI);

function interpolate(table, x) {
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

export class Engine {
  constructor(spec) {
    this.spec = spec;
    this.torqueScale = 1;
    this.omega = spec.idleRpm / RAD_TO_RPM;
    this.running = true;
    this.limiterCut = false;
    this.throttleApplied = 0; // throttle after idle control and limiter (for sound and HUD)
    this.lastTorque = 0;
    this.justStalled = false;
    this.turbo = null; // { gain, spool, range, lag } from the tuning shop
    this.intake = null; // rpm -> extra torque (N m)
    this.boost = 0; // 0..1 of full boost
  }

  // Turbo boost builds with revs and throttle, and lags behind them.
  updateBoost(dt, throttle) {
    const tb = this.turbo;
    if (!tb || !this.running) {
      this.boost = Math.max(0, this.boost - dt * 3);
      return;
    }
    const rpm = this.rpm;
    const k = Math.min(1, Math.max(0, (rpm - tb.spool) / tb.range));
    const target = (this.limiterCut ? 0.6 : throttle) * k * k * (3 - 2 * k);
    const tau = target > this.boost ? tb.lag : 0.12; // spools slowly, dumps quickly
    this.boost += (target - this.boost) * Math.min(1, dt / tau);
  }

  // Full-throttle torque at an rpm with the fitted parts (boost given as 0..1).
  fullTorque(rpm, boost = this.boost) {
    let tq = interpolate(this.spec.torqueCurve, rpm) * this.torqueScale;
    if (this.intake) tq += this.intake(rpm) * this.torqueScale;
    if (this.turbo) tq *= 1 + this.turbo.gain * boost;
    return tq;
  }

  get rpm() {
    return this.omega * RAD_TO_RPM;
  }

  // Net torque on the crank for this step, before the clutch.
  torque(throttle) {
    const s = this.spec;
    const rpm = this.rpm;
    const friction = s.frictionTorque + s.frictionPerRpm * rpm;
    if (!this.running) {
      this.throttleApplied = 0;
      // A dead engine only resists turning.
      this.lastTorque = -Math.sign(this.omega) * friction;
      return this.lastTorque;
    }
    if (rpm > s.limiterRpm) this.limiterCut = true;
    else if (rpm < s.limiterResumeRpm) this.limiterCut = false;
    let thr = this.limiterCut ? 0 : throttle;
    // Idle control holds about 850 rpm, but cannot save the engine from a heavy clutch load.
    thr = Math.max(thr, Math.min(1, Math.max(0, (s.idleRpm - rpm) / 150)) * 0.5);
    this.throttleApplied = thr;
    const full = this.fullTorque(rpm);
    this.lastTorque = thr * full - (1 - thr) * friction;
    return this.lastTorque;
  }

  // Integrate the crank alone (clutch impulses are applied separately by the drivetrain).
  integrate(torque, dt) {
    this.omega += (torque / this.spec.inertia) * dt;
    if (!this.running && Math.abs(this.omega) < 0.5) this.omega = 0;
  }

  // Call after the clutch has acted. Returns true on the step the engine stalls.
  checkStall(allowStall) {
    this.justStalled = false;
    if (!this.running) return false;
    if (allowStall) {
      if (this.rpm < this.spec.stallRpm) {
        this.running = false;
        this.limiterCut = false;
        this.justStalled = true;
        return true;
      }
    } else if (this.rpm < this.spec.idleRpm * 0.75) {
      // Assisted modes: the engine is never allowed to die.
      this.omega = (this.spec.idleRpm * 0.75) / RAD_TO_RPM;
    }
    return false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    // The starter spins it up to idle; if the clutch is still engaged in gear it will stall again.
    this.omega = Math.max(this.omega, this.spec.idleRpm / RAD_TO_RPM);
  }
}
