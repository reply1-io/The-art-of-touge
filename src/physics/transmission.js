// Gearbox and clutch for the three transmission settings.
//   manual     - you work the clutch; shifting without it grinds and fails; the engine can stall.
//   autoClutch - you use the H-shifter; the clutch is worked for you; no stalling.
//   auto       - D / R only; the box picks gears from rpm and throttle.

export const MODES = ['manual', 'autoClutch', 'auto'];
export const MODE_LABELS = { manual: 'Full Manual', autoClutch: 'Manual, Auto Clutch', auto: 'Full Automatic' };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class Transmission {
  constructor(spec, mode = 'manual') {
    this.spec = spec;
    this.mode = mode;
    this.gear = 0; // -1 reverse, 0 neutral, 1..5
    this.coupling = 1; // 0 = clutch fully disengaged, 1 = fully engaged
    this.pedal = 0; // clutch pedal position after the foot ramp (1 = pressed)
    this.shiftTimer = 0;
    this.drive = 'D'; // automatic selector
    this.message = '';
    this.messageTimer = 0;
    this.grindTimer = 0; // > 0 while the grind sound should play
    this.gears = spec.gears;
    this.finalDrive = spec.finalDrive;
    this.bite = [0.25, 0.8];
  }

  // Gear set, final drive and clutch bite from the tuning shop.
  setParts(p) {
    this.gears = p.gears;
    this.finalDrive = p.finalDrive;
    this.bite = p.bite;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'auto') {
      this.drive = this.gear === -1 ? 'R' : 'D';
      this.gear = this.drive === 'R' ? -1 : 1;
    }
  }

  // In the assisted modes the box lifts the throttle while it changes gear, like a real automatic
  // (otherwise the engine would scream to the limiter with the clutch open and dump into the next gear).
  get throttleCut() {
    return this.mode !== 'manual' && this.shiftTimer > 0;
  }

  ratio(gear = this.gear) {
    const s = this.spec;
    if (gear === 0) return 0;
    if (gear === -1) return -s.reverse * this.finalDrive;
    return this.gears[gear - 1] * this.finalDrive;
  }

  get label() {
    if (this.mode === 'auto') {
      if (this.drive === 'R') return 'R';
      return `D${this.gear}`;
    }
    return this.gear === -1 ? 'R' : this.gear === 0 ? 'N' : String(this.gear);
  }

  #flash(text, seconds = 1.2) {
    this.message = text;
    this.messageTimer = seconds;
  }

  // Called by the H-shifter when the knob reaches a gate (or leaves one: gear 0).
  // Returns true if the gear went in.
  requestGear(gear, forwardSpeed) {
    if (this.mode === 'auto') return false;
    if (gear === this.gear) return true;
    if (gear === 0) {
      this.gear = 0;
      return true;
    }
    if (gear === -1 && forwardSpeed > 1.5) {
      this.grindTimer = 0.35;
      this.#flash('GRIND - TOO FAST FOR REVERSE');
      return false;
    }
    if (this.mode === 'manual' && this.pedal < 0.85) {
      this.grindTimer = 0.35;
      this.#flash('GRIND - USE THE CLUTCH');
      return false;
    }
    this.gear = gear;
    if (this.mode === 'autoClutch') this.shiftTimer = 0.22;
    return true;
  }

  // Automatic selector: 'D' or 'R'. Only changes near standstill.
  setDrive(drive, forwardSpeed) {
    if (this.mode !== 'auto' || drive === this.drive) return;
    if (Math.abs(forwardSpeed) > 1.5) {
      this.#flash('STOP FIRST');
      return;
    }
    this.drive = drive;
    this.gear = drive === 'R' ? -1 : 1;
    this.shiftTimer = 0.3;
  }

  // inputs: { clutch (bool), throttle 0..1, handbrake 0..1 }
  // drive: { engineRpm, inputRpm (gearbox input shaft rpm from the wheels) }
  update(dt, inputs, drive) {
    if (this.messageTimer > 0) this.messageTimer -= dt;
    if (this.grindTimer > 0) this.grindTimer -= dt;
    if (this.shiftTimer > 0) this.shiftTimer = Math.max(0, this.shiftTimer - dt);

    // The clutch button is a foot: it drops in quickly and lets out over about a third of a second,
    // so a gentle launch is possible with a single on/off button, and a quick tap is a clutch kick.
    const pressed = inputs.clutch ? 1 : 0;
    const rate = pressed > this.pedal ? 16 : 3.2;
    this.pedal += clamp(pressed - this.pedal, -rate * dt, rate * dt);
    // Pedal to engagement: bites between 30% and 75% of travel.
    const pedalCoupling = 1 - smoothstep(this.bite[0], this.bite[1], this.pedal);

    if (this.mode === 'manual') {
      this.coupling = pedalCoupling;
      return;
    }

    if (this.mode === 'auto') this.#autoShift(inputs.throttle, drive.engineRpm, drive.inputRpm);

    let target = 1;
    if (this.gear === 0) target = 0;
    else if (this.shiftTimer > 0) target = this.shiftTimer > 0.1 ? 0 : 1 - this.shiftTimer / 0.1;
    else if (Math.abs(drive.inputRpm) < 1250) {
      // Launch: slip the clutch, biting harder as the revs rise.
      target = inputs.throttle > 0.05 ? smoothstep(1000, 2600, drive.engineRpm) : 0;
    }
    if (inputs.handbrake > 0.5) target = 0;
    target = Math.min(target, pedalCoupling);
    const r = 9 * dt;
    this.coupling += clamp(target - this.coupling, -r * 2, r);
  }

  #autoShift(throttle, engineRpm, inputRpm) {
    if (this.drive !== 'D' || this.shiftTimer > 0 || this.gear < 1) return;
    const up = 3000 + 3600 * clamp(throttle, 0, 1);
    const down = 1500 + 2300 * clamp(throttle, 0, 1);
    const last = this.gears.length;
    if (engineRpm > up && this.gear < last && this.coupling > 0.9) {
      this.gear++;
      this.shiftTimer = 0.28;
    } else if (engineRpm < down && this.gear > 1) {
      const next = (Math.abs(inputRpm) * this.ratio(this.gear - 1)) / this.ratio(this.gear);
      if (next < 6300) {
        this.gear--;
        this.shiftTimer = 0.28;
      }
    }
  }
}
