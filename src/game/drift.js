// Drift scoring. Hold a slide to build points: more angle and more speed score faster. Link
// slides together (switching direction raises the multiplier) and bank the chain when you
// straighten up for a moment. Hitting a rail, spinning or running onto the grass loses the chain.

const MIN_ANGLE = 0.2; // rad (about 11°) before a slide counts
const MIN_SPEED = 8; // m/s
const GRACE = 1.4; // s of grip allowed between linked slides
const MAX_MULT = 5;

export class DriftScore {
  constructor() {
    this.reset();
  }

  reset() {
    this.total = 0;
    this.best = 0;
    this.chain = 0; // points in the current chain, before the multiplier
    this.mult = 1;
    this.grace = 0;
    this.side = 0;
    this.active = false;
    this.angle = 0;
    this.message = ''; // 'BANKED +1,234' or 'CHAIN LOST'
    this.messageTimer = 0;
  }

  // vehicle: the simulation; hitRail: true while the car is against a barrier.
  update(dt, vehicle, hitRail) {
    if (this.messageTimer > 0) this.messageTimer -= dt;
    const slide = vehicle.slideAngle;
    const speed = vehicle.speed;
    const angle = Math.abs(slide);
    this.angle = angle;
    const offRoad = vehicle.wheels.filter((w) => w.grounded && w.surface === 'grass').length >= 3;
    const sliding = angle > MIN_ANGLE && speed > MIN_SPEED && vehicle.forwardSpeed > 2;
    const inChain = this.chain > 0 || this.active;

    if (inChain && (hitRail || angle > 1.75 || offRoad)) {
      this.#end(false);
      return;
    }
    if (sliding) {
      const side = Math.sign(slide);
      // Flicking from one side to the other links the slides and raises the multiplier.
      if (this.active === false && this.chain > 0 && side !== this.side) this.mult = Math.min(MAX_MULT, this.mult + 1);
      else if (this.active && side !== this.side && this.side !== 0) this.mult = Math.min(MAX_MULT, this.mult + 1);
      this.side = side;
      this.active = true;
      this.grace = GRACE;
      const deg = (angle * 180) / Math.PI;
      this.chain += dt * deg * speed * 1.5;
    } else if (this.active || this.chain > 0) {
      this.active = false;
      this.grace -= dt;
      if (this.grace <= 0) this.#end(true);
    }
  }

  #end(banked) {
    const score = Math.round(this.chain * this.mult);
    if (banked && score > 0) {
      this.total += score;
      this.best = Math.max(this.best, score);
      this.message = `+${score.toLocaleString('en-US')}`;
    } else if (score > 50) this.message = 'CHAIN LOST';
    this.messageTimer = this.message ? 1.6 : 0;
    this.chain = 0;
    this.mult = 1;
    this.active = false;
    this.side = 0;
    this.grace = 0;
  }

  // What the HUD shows.
  get display() {
    return {
      chain: Math.round(this.chain * this.mult),
      mult: this.mult,
      active: this.chain > 0,
      total: this.total,
      message: this.messageTimer > 0 ? this.message : '',
      angle: this.angle,
    };
  }
}
