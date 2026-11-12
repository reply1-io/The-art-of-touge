// Exhaust events shared by the sound and the flames: lifting off at high revs, gear changes, and
// each bang off the rev limiter.
export class ExhaustEvents {
  constructor() {
    this.prevThrottle = 0;
    this.prevGear = 0;
    this.prevLimiter = false;
    this.cool = { lift: 0, shift: 0, limiter: 0 };
    this.ev = { lift: false, shift: false, limiter: false };
  }

  // type: 'stock' | 'street' | 'race'
  update(vehicle, dt, type) {
    const e = vehicle.engine;
    const tr = vehicle.trans;
    const rpm = e.rpm;
    const ev = this.ev;
    for (const k of Object.keys(this.cool)) this.cool[k] -= dt;
    const loud = type !== 'stock';
    ev.lift = e.running && this.prevThrottle > 0.55 && vehicle.throttlePedal < 0.2 && rpm > (loud ? 3000 : 3800) && this.cool.lift <= 0;
    ev.shift = e.running && tr.gear !== this.prevGear && tr.gear !== 0 && this.prevGear !== 0 && rpm > 2500 && this.cool.shift <= 0;
    ev.limiter = e.running && e.limiterCut && !this.prevLimiter && this.cool.limiter <= 0;
    if (ev.lift) this.cool.lift = 0.5;
    if (ev.shift) this.cool.shift = 0.3;
    if (ev.limiter) this.cool.limiter = 0.07;
    // Gear changes through neutral (clutch in, lever across) still count as one shift.
    if (tr.gear !== 0) this.prevGear = tr.gear;
    this.prevThrottle = vehicle.throttlePedal;
    this.prevLimiter = e.limiterCut;
    return ev;
  }
}
