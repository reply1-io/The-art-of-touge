// The rival driver for battles. It drives a real car through the same physics as you, looking
// ahead along the road to brake for corners and steering after a point in front of it.
//
// Aggressive: it takes the inside of corners, and when you close up behind it moves across to
// cover your line. Beatable: it corners at a bit less grip than your car can reach (most of all in
// hairpins), so you can out-brake it or get a better exit, and once your nose is alongside it
// gives you room instead of pushing you off.

const G = 9.81;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class BotDriver {
  constructor(road, { grip = 0.8, hairpinGrip = 0.68, brake = 6.2, topSpeed = 42 } = {}) {
    this.road = road;
    this.grip = grip; // lateral g it is willing to use in normal corners
    this.hairpinGrip = hairpinGrip; // and in tight ones
    this.brake = brake; // m/s^2 it plans to brake at
    this.topSpeed = topSpeed;
    this.line = 0; // current lateral target (m, + = left)
    this.hint = 0;
  }

  // Corner speed the bot allows at sample j.
  #cornerSpeed(j) {
    const k = Math.abs(this.road.kappa[j]);
    if (k < 1e-4) return this.topSpeed;
    const g = k > 1 / 18 ? this.hairpinGrip : this.grip;
    return Math.min(this.topSpeed, Math.sqrt((g * G) / k));
  }

  // vehicle: the bot's Vehicle; q: its road query { index, lateral, s }; rival: the player's road
  // query or null. Returns a driving input.
  drive(vehicle, q, rival) {
    const road = this.road;
    const v = Math.max(0, vehicle.forwardSpeed);
    // Fastest speed that still lets it brake down to every corner ahead in time.
    let target = this.topSpeed;
    for (let j = q.index; j < Math.min(road.count - 1, q.index + 140); j += 2) {
      const d = (j - q.index) * 2;
      const vc = this.#cornerSpeed(j);
      target = Math.min(target, Math.sqrt(vc * vc + 2 * this.brake * d));
    }
    // Racing line: drift toward the inside of the corner ahead.
    const ahead = Math.min(road.count - 1, q.index + 12);
    const half = road.w.HALF - 0.95;
    let line = clamp(Math.sign(road.kappa[ahead]) * Math.min(1, Math.abs(road.kappa[ahead]) * 40) * half * 0.45, -half, half);
    // Defend: with the rival close behind, move across to cover its line, unless it is already
    // alongside (then leave it room).
    if (rival) {
      const gap = rival.s - q.s; // < 0: the rival is behind
      if (gap < -1 && gap > -22) line = clamp(rival.lateral, -half, half);
      else if (gap >= -1 && gap < 4.5) line = clamp(q.lateral + Math.sign(q.lateral - rival.lateral || 1) * 0.6, -half, half);
    }
    const rate = 1.4 / 60; // metres per step it will move across the road
    this.line += clamp(line - this.line, -rate, rate);
    // Pure pursuit to a point on that line in front of the car.
    // Aiming far ahead cuts the inside of a tight corner (into the inside rail), so the aim point
    // comes in close in hairpins: the cut is about L^2 * curvature / 2.
    let kMax = 1e-4;
    for (let j = q.index; j < Math.min(road.count - 1, q.index + 10); j++) kMax = Math.max(kMax, Math.abs(road.kappa[j]));
    const L = clamp(Math.min(6 + v * 0.7, Math.sqrt(3 / kMax)), 8, 40);
    const la = Math.min(road.count - 1, q.index + Math.max(1, Math.round(L / 2)));
    const [tx, , tz] = road.pointAt(la, this.line);
    const p = vehicle.body.translation();
    const r = vehicle.body.rotation();
    const yaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
    let err = Math.atan2(tx - p.x, tz - p.z) - yaw;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    const steer = clamp(-err * 2.4 + clamp(vehicle.slideAngle, -0.5, 0.5) * 0.8, -1, 1);
    return {
      throttle: v < target - 0.5 ? 1 : v < target ? 0.4 : 0,
      brake: v > target + 1.2 ? 1 : 0,
      handbrake: 0,
      clutch: false,
      steer,
    };
  }
}
