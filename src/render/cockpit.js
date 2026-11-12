// The cockpit for the in-car camera: dashboard, steering wheel, gear lever, handbrake, and two simple
// arms (no hands) that hold the wheel. The right arm reaches for the gear lever on a shift and for
// the handbrake while it is pulled. Built in the car body's own space (+x left, +y up from the
// ground, +z forward). The E30 here is left-hand drive.
import * as THREE from 'three';

const DRIVER_X = 0.36;
const WHEEL = new THREE.Vector3(DRIVER_X, 0.93, 0.02); // steering wheel centre
const WHEEL_R = 0.185;
const WHEEL_TILT = 0.42; // rad: the wheel leans back toward the driver
const STEER_RATIO = 15; // road-wheel angle -> steering-wheel angle
export const EYE = new THREE.Vector3(DRIVER_X, 1.2, -0.5);
const SHOULDERS = [new THREE.Vector3(DRIVER_X + 0.21, 1.0, -0.44), new THREE.Vector3(DRIVER_X - 0.21, 1.0, -0.44)];
const UPPER = 0.32;
const FORE = 0.36;
const LEVER_BASE = new THREE.Vector3(0.02, 0.5, 0.02);
const LEVER_LEN = 0.24;
const HANDBRAKE_PIVOT = new THREE.Vector3(0.05, 0.45, -0.62);
const HANDBRAKE_LEN = 0.3;

// H-pattern knob offsets for each gear: [sideways (+ left), fore-aft (+ forward)].
const GATE = { 1: [0.05, 0.05], 2: [0.05, -0.05], 3: [0, 0.05], 4: [0, -0.05], 5: [-0.05, 0.05], [-1]: [-0.05, -0.05], 0: [0, 0] };

const tmp = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

// Chunky pixel-art sleeve texture: a few blocky shades of jacket with a dark cuff band at the far
// end, sampled with hard edges so it reads as pixels.
function sleeveTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 8;
  const g = c.getContext('2d');
  const shades = ['#5d6678', '#6a7486', '#535c6d', '#6a7486'];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 4; x++) {
      g.fillStyle = shades[(x + y * 3) % 4];
      g.fillRect(x, y, 1, 1);
    }
  }
  g.fillStyle = '#2b2f38';
  g.fillRect(0, 0, 4, 1); // cuff (v = 0 is the far end of the limb after the flip below)
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A square-section block stretched between two points.
function limb(radius, mat) {
  const geo = new THREE.BoxGeometry(radius * 2, 1, radius * 2);
  geo.translate(0, 0.5, 0);
  const m = new THREE.Mesh(geo, mat);
  m.place = (a, b) => {
    tmp.subVectors(b, a);
    const len = tmp.length();
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(up, tmp.normalize());
    m.scale.set(1, len, 1);
  };
  return m;
}

export class Cockpit {
  constructor() {
    this.root = new THREE.Group();
    this.root.visible = false;
    const dark = new THREE.MeshLambertMaterial({ color: 0x1b1c20, flatShading: true });
    const panel = new THREE.MeshLambertMaterial({ color: 0x2a2b30, flatShading: true });
    const cloth = new THREE.MeshLambertMaterial({ color: 0x3a3c44, side: THREE.DoubleSide });
    const sleeve = new THREE.MeshLambertMaterial({ map: sleeveTexture(), flatShading: true });
    this.sleeve = sleeve;

    // Dashboard (with a face down to the floor), floor, and the instrument hood.
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.66, 0.5), panel);
    dash.position.set(0, 0.62, 0.5);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 2).rotateX(-Math.PI / 2), dark);
    floor.position.set(0, 0.3, -0.35);
    this.root.add(floor);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.2), dark);
    hood.position.set(DRIVER_X, 1.0, 0.33);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.1), new THREE.MeshBasicMaterial({ color: 0x0c0a08 }));
    face.position.set(DRIVER_X, 0.955, 0.24);
    face.rotation.x = -0.35;
    face.rotation.y = Math.PI;
    // Two little orange-lit dials.
    const dialMat = new THREE.MeshBasicMaterial({ color: 0xff8c1a });
    for (const dx of [-0.08, 0.08]) {
      const d = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.036, 16), dialMat);
      d.position.set(DRIVER_X + dx, 0.958, 0.238);
      d.rotation.copy(face.rotation);
      this.root.add(d);
    }
    // Centre console, door cards and the headliner.
    const consoleBox = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.7), panel);
    consoleBox.position.set(0, 0.42, 0.05);
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.6), cloth);
    roof.rotation.x = Math.PI / 2;
    roof.position.set(0, 1.34, -0.45);
    this.root.add(dash, hood, face, consoleBox, roof);
    // Passenger seat (the one you can see): a cloth road seat, or a bucket with tall side wings.
    this.seats = { stock: this.#stockSeat(cloth, panel), bucket: this.#bucketSeat() };
    for (const seat of Object.values(this.seats)) {
      seat.position.set(-DRIVER_X, 0.32, -0.62);
      this.root.add(seat);
    }
    this.setSeats('stock');
    for (const side of [1, -1]) {
      // Door cards from the floor up to the window line.
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.55, 1.9), panel);
      door.position.set(side * 0.75, 0.57, -0.3);
      this.root.add(door);
    }

    // Steering wheel: rim, three spokes and a hub, on a column into the dash.
    this.wheelPivot = new THREE.Group();
    this.wheelPivot.position.copy(WHEEL);
    this.wheelPivot.rotation.x = WHEEL_TILT;
    this.root.add(this.wheelPivot);
    this.wheel = new THREE.Group();
    this.wheelPivot.add(this.wheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R, 0.018, 6, 24), dark);
    this.wheel.add(rim);
    for (const a of [Math.PI / 2 + Math.PI, 0.25, Math.PI - 0.25]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(WHEEL_R, 0.03, 0.012), dark);
      spoke.position.set((Math.cos(a) * WHEEL_R) / 2, (Math.sin(a) * WHEEL_R) / 2, 0);
      spoke.rotation.z = a;
      this.wheel.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 10).rotateX(Math.PI / 2), dark);
    this.wheel.add(hub);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.3, 8).rotateX(Math.PI / 2), dark);
    column.position.z = 0.16;
    this.wheelPivot.add(column);

    // Gear lever with a round knob, and the handbrake lever between the seats.
    this.lever = new THREE.Group();
    this.lever.position.copy(LEVER_BASE);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, LEVER_LEN, 6).translate(0, LEVER_LEN / 2, 0), dark);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshLambertMaterial({ color: 0x111113 }));
    knob.position.y = LEVER_LEN;
    const boot = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.08, 8), new THREE.MeshLambertMaterial({ color: 0x151517 }));
    boot.position.y = 0.03;
    this.lever.add(stick, knob, boot);
    this.root.add(this.lever);
    this.handbrake = new THREE.Group();
    this.handbrake.position.copy(HANDBRAKE_PIVOT);
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, HANDBRAKE_LEN).translate(0, 0, HANDBRAKE_LEN / 2), dark);
    this.handbrake.add(hb);
    this.root.add(this.handbrake);

    // Arms: upper arm and forearm each, in a dark jacket. No hands.
    this.arms = [0, 1].map(() => {
      const upper = limb(0.058, sleeve);
      const fore = limb(0.05, sleeve);
      this.root.add(upper, fore);
      return { upper, fore, hand: new THREE.Vector3(), elbow: new THREE.Vector3() };
    });
    this.rightTask = 'wheel';
    this.shiftTimer = 0;
    this.hbPull = 0;
    this.knobPos = new THREE.Vector3();
    this.gearShown = 0;
    this.leverTilt = new THREE.Vector2();
  }

  setSeats(type) {
    for (const [k, seat] of Object.entries(this.seats)) seat.visible = k === type;
  }

  #stockSeat(cloth, panel) {
    const g = new THREE.Group();
    const fabric = new THREE.MeshLambertMaterial({ color: 0x4a4d57, flatShading: true });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.5), fabric);
    base.position.set(0, 0.07, 0.1);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.58, 0.12), fabric);
    back.position.set(0, 0.4, -0.14);
    back.rotation.x = -0.18;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.1), fabric);
    head.position.set(0, 0.78, -0.21);
    g.add(base, back, head);
    void cloth;
    void panel;
    return g;
  }

  #bucketSeat() {
    const g = new THREE.Group();
    const shell = new THREE.MeshLambertMaterial({ color: 0x18191c, flatShading: true });
    const pad = new THREE.MeshLambertMaterial({ color: 0x7a1414, flatShading: true });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.52), shell);
    base.position.set(0, 0.06, 0.1);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.8, 0.08), shell);
    back.position.set(0, 0.5, -0.16);
    back.rotation.x = -0.12;
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.04), pad);
    cushion.position.set(0, 0.38, -0.1);
    cushion.rotation.x = -0.12;
    g.add(base, back, cushion);
    // Side wings that hold you in, at the hips and the shoulders.
    for (const side of [1, -1]) {
      const hip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.42), shell);
      hip.position.set(side * 0.24, 0.2, 0.02);
      const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.4, 0.2), shell);
      shoulder.position.set(side * 0.22, 0.62, -0.12);
      shoulder.rotation.y = side * 0.25;
      g.add(hip, shoulder);
    }
    // Harness slots near the top.
    for (const side of [1, -1]) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.09), new THREE.MeshBasicMaterial({ color: 0x050505 }));
      slot.position.set(side * 0.08, 0.82, -0.2);
      g.add(slot);
    }
    return g;
  }

  // Shift the gear: the right hand goes to the lever for a moment.
  shift() {
    this.shiftTimer = 0.45;
  }

  // vehicle: the simulation; handbrake: 0..1 input.
  update(dt, vehicle, handbrake) {
    if (!this.root.visible) return;
    const wheelAngle = -vehicle.steer * STEER_RATIO;
    this.wheel.rotation.z = wheelAngle;
    // Lever position follows the gear through the H pattern.
    const g = GATE[vehicle.trans.gear] || GATE[0];
    this.leverTilt.x += (g[0] - this.leverTilt.x) * Math.min(1, dt * 18);
    this.leverTilt.y += (g[1] - this.leverTilt.y) * Math.min(1, dt * 18);
    this.lever.rotation.set(this.leverTilt.y * 3.2, 0, -this.leverTilt.x * 3.2);
    this.hbPull += ((handbrake > 0.5 ? 1 : 0) - this.hbPull) * Math.min(1, dt * 14);
    this.handbrake.rotation.x = -0.15 - this.hbPull * 0.45;

    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    const task = handbrake > 0.5 ? 'handbrake' : this.shiftTimer > 0 ? 'shift' : 'wheel';
    // Hands on the rim at about ten to two, turning with the wheel (they let go past 110°).
    const held = Math.max(-1.9, Math.min(1.9, wheelAngle));
    for (let i = 0; i < 2; i++) {
      const arm = this.arms[i];
      const side = i === 0 ? 1 : -1; // 0 = left arm
      let target;
      if (i === 1 && task === 'shift') {
        target = new THREE.Vector3(0, LEVER_LEN, 0).applyEuler(this.lever.rotation).add(this.lever.position);
      } else if (i === 1 && task === 'handbrake') {
        target = new THREE.Vector3(0, 0.03, HANDBRAKE_LEN * 0.85).applyEuler(this.handbrake.rotation).add(this.handbrake.position);
      } else {
        const a = (side > 0 ? Math.PI * 0.18 : Math.PI * 0.82) + held;
        // A point on the rim, in the wheel's tilted plane.
        const p = new THREE.Vector3(Math.cos(a) * WHEEL_R, Math.sin(a) * WHEEL_R, 0);
        p.applyEuler(this.wheelPivot.rotation).add(WHEEL);
        target = p;
      }
      if (arm.hand.lengthSq() === 0) arm.hand.copy(target);
      arm.hand.lerp(target, Math.min(1, dt * 16));
      // Two-bone reach: the elbow bends down and outward.
      const S = SHOULDERS[i];
      const toHand = tmp.subVectors(arm.hand, S);
      const d = Math.min(toHand.length(), (UPPER + FORE) * 0.98);
      const dir = toHand.clone().normalize();
      const a = (UPPER * UPPER - FORE * FORE + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, UPPER * UPPER - a * a));
      const pole = new THREE.Vector3(side * 0.6, -1, -0.2);
      pole.addScaledVector(dir, -pole.dot(dir)).normalize();
      arm.elbow.copy(S).addScaledVector(dir, a).addScaledVector(pole, h);
      const reach = S.clone().addScaledVector(dir, d);
      arm.upper.place(S, arm.elbow);
      arm.fore.place(arm.elbow, reach);
    }
  }
}
