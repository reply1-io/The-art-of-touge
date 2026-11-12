// Races. Time Attack: run the road against the clock, optionally chasing a ghost of your best run.
// Battle: run it against a rival driver. Both start with a 3-2-1 countdown on the line below the
// summit, pay out money at the finish, and save your best time (and its ghost) on the device.
import * as THREE from 'three';
import { Vehicle } from '../physics/vehicle.js';
import { SoftBarrier } from '../physics/barrier.js';
import { CarModel } from '../render/carModel.js';
import { CAR, TUNABLE_DEFAULTS } from '../config.js';
import { BotDriver } from './bot.js';

const RECORDS_KEY = 'touge.records.v1';
const GHOST_DT = 0.1; // seconds between ghost samples

// Prize money per road: time attack base (scaled by pace) and battle win / loss.
const PRIZES = {
  akina: { par: 255, base: 500, win: 1500, lose: 200 },
  dragon: { par: 540, base: 800, win: 2200, lose: 300 },
};

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveRecords(r) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(r));
  } catch {
    // Storage full or private browsing: the record lasts for this visit.
  }
}

// A see-through copy of the car for the ghost.
function ghostModel(look) {
  const m = new CarModel(CAR);
  m.applySetup({ ...TUNABLE_DEFAULTS, ...look });
  m.root.traverse((o) => {
    if (!o.isMesh && !o.isSprite) return;
    o.material = o.material.clone();
    o.material.transparent = true;
    o.material.opacity = 0.32;
    o.material.depthWrite = false;
    o.renderOrder = 3;
  });
  m.cockpit.root.visible = false;
  return m;
}

export class Race {
  // ctx: { scene, world, mountain, roadId, wallet, toast(text, seconds) }
  constructor(ctx) {
    Object.assign(this, ctx);
    this.road = this.mountain.road;
    this.records = loadRecords();
    this.active = false;
    this.phase = 'off'; // 'countdown' | 'running' | 'done'
    this.mode = 'attack'; // 'attack' | 'battle'
    this.q = {};
    this.botQ = {};
  }

  get record() {
    return this.records[this.roadId] || null;
  }

  get prize() {
    return PRIZES[this.roadId] || PRIZES.akina;
  }

  // Begin a race. placePlayer(pose) puts the player's car on the grid.
  start(mode, ghostOn, placePlayer) {
    this.abort();
    this.mode = mode;
    this.active = true;
    this.phase = 'countdown';
    this.count = 3.6;
    this.lastCount = 4;
    this.time = 0;
    this.penalty = 0;
    this.samples = [];
    this.sampleTimer = 0;
    this.botTime = null;
    this.botStuck = 0;
    const road = this.road;
    const i = road.startIndex - 6;
    const pose = (lat) => {
      const p = road.pointAt(i, lat);
      return { pos: [p[0], p[1] + 0.8, p[2]], yaw: road.heading[i], index: i };
    };
    placePlayer(pose(mode === 'battle' ? -road.w.LANE : -road.w.LANE * 0.4));
    if (mode === 'battle') this.#spawnBot(pose(road.w.LANE));
    const rec = this.record;
    if (mode === 'attack' && ghostOn && rec?.ghost?.length) {
      this.ghost = ghostModel(rec.look || {});
      this.ghostData = rec.ghost;
      this.ghostIdx = 0;
      this.scene.add(this.ghost.root);
    }
  }

  #spawnBot(pose) {
    if (!this.bot) {
      this.bot = new Vehicle(this.world, CAR, { ...TUNABLE_DEFAULTS, tire: 'street', diff: 'lsd' }, 'auto');
      this.bot.surfaceOf = this.mountain.layout.surfaceOf;
      this.botModel = new CarModel(CAR);
      this.botModel.applySetup({ ...TUNABLE_DEFAULTS, paint: '#16171b', wheel: 'gold', rim: 15, profile: 50, numbers: true, number: 86, plateStyle: 'yellow', plateText: 'RIVAL', rideHeight: -30, coilovers: true });
      this.scene.add(this.botModel.root);
      const layout = this.mountain.layout;
      const road = this.road;
      const rq = {};
      this.botBarrier = new SoftBarrier((x, z, out) => {
        road.query(x, z, this.botQ.index ?? 0, rq);
        const side = rq.lateral > 0 ? 1 : -1;
        if (!layout.rail[side][rq.index]) return false;
        const pen = Math.abs(rq.lateral) - (road.w.RAIL - 0.45);
        if (pen <= 0 || pen > 1.5) return false;
        out.pen = pen;
        out.nx = -side * Math.cos(rq.heading);
        out.nz = side * Math.sin(rq.heading);
        return true;
      });
      this.prevPos = new THREE.Vector3();
      this.curPos = new THREE.Vector3();
      this.prevQuat = new THREE.Quaternion();
      this.curQuat = new THREE.Quaternion();
    }
    this.driver = new BotDriver(this.road);
    this.bot.body.setGravityScale(1, true);
    this.bot.reset(pose.pos, pose.yaw);
    this.bot.trans.setDrive('D', 0);
    this.botQ = { index: pose.index, lateral: this.road.w.LANE, s: pose.index * 2 };
    this.botModel.root.visible = true;
    this.#captureBot();
    this.#captureBot();
  }

  #captureBot() {
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
    const p = this.bot.body.translation();
    const r = this.bot.body.rotation();
    this.curPos.set(p.x, p.y, p.z);
    this.curQuat.set(r.x, r.y, r.z, r.w);
  }

  abort() {
    this.active = false;
    this.phase = 'off';
    if (this.ghost) {
      this.scene.remove(this.ghost.root);
      this.ghost = null;
    }
    if (this.bot) {
      // Park the rival far below the world so it is out of the way.
      this.bot.reset([0, -400, 0], 0);
      this.bot.body.setGravityScale(0, true);
      this.botModel.root.visible = false;
    }
  }

  // The player's controls, as the race allows them: held on the brakes until GO.
  filter(controls) {
    if (this.phase !== 'countdown') return controls;
    return { ...controls, brake: 1, handbrake: 1 };
  }

  // Recovering the car mid-race costs five seconds.
  recovered() {
    if (this.phase === 'running') {
      this.penalty += 5;
      this.toast('+5 s', 1.2);
    }
  }

  // One physics step (before world.step). vehicle: the player's car.
  step(dt, vehicle, playerHint) {
    if (!this.active) return;
    const road = this.road;
    const p = vehicle.body.translation();
    road.query(p.x, p.z, playerHint, this.q);
    if (this.phase === 'countdown') {
      this.count -= dt;
      const n = Math.ceil(this.count - 0.6);
      if (n !== this.lastCount && n >= 1 && n <= 3) this.toast(String(n), 0.8);
      this.lastCount = n;
      if (this.count <= 0.6) {
        this.phase = 'running';
        this.toast('GO!', 1);
      }
    } else if (this.phase === 'running') {
      this.time += dt;
      this.sampleTimer -= dt;
      if (this.sampleTimer <= 0) {
        this.sampleTimer = GHOST_DT;
        const r = vehicle.body.rotation();
        const f = (v) => Math.round(v * 100) / 100;
        const g = (v) => Math.round(v * 1000) / 1000;
        this.samples.push([f(this.time), f(p.x), f(p.y), f(p.z), g(r.x), g(r.y), g(r.z), g(r.w), Math.round(this.q.s)]);
      }
      if (this.q.index >= road.finishIndex) this.#finish(vehicle);
    }
    // The rival.
    if (this.mode === 'battle' && this.bot) {
      const b = this.bot.body.translation();
      road.query(b.x, b.z, this.botQ.index ?? 0, this.botQ);
      let input = this.driver.drive(this.bot, this.botQ, this.q);
      if (this.phase === 'countdown') input = { ...input, throttle: 0, brake: 1, handbrake: 1 };
      if (this.botTime !== null || this.phase === 'done') input = { throttle: 0, brake: 1, handbrake: 0, clutch: false, steer: 0 };
      this.bot.step(dt, input);
      this.botBarrier.apply(this.bot.body);
      if (this.phase === 'running' && this.botTime === null) {
        if (this.botQ.index >= road.finishIndex) this.botTime = this.time;
        // Stuck (pinned on a rail, spun into the bank): put it back on the road.
        this.botStuck = this.bot.speed < 1.2 ? this.botStuck + dt : 0;
        if (this.botStuck > 2.5) {
          const k = Math.max(4, this.botQ.index - 2);
          const pt = road.pointAt(k, road.w.LANE);
          this.bot.reset([pt[0], pt[1] + 0.8, pt[2]], road.heading[k]);
          this.bot.trans.setDrive('D', 0);
          this.botStuck = 0;
        }
      }
    }
  }

  // After world.step.
  afterStep() {
    if (this.active && this.mode === 'battle' && this.bot) this.#captureBot();
  }

  // Draw the ghost and the rival (once per frame). alpha: interpolation between physics steps.
  render(dt, alpha, lightsOn) {
    if (!this.active) return;
    if (this.bot && this.mode === 'battle') {
      const root = this.botModel.root;
      root.position.lerpVectors(this.prevPos, this.curPos, alpha);
      root.quaternion.slerpQuaternions(this.prevQuat, this.curQuat, alpha);
      this.botModel.syncWheels(this.bot);
      this.botModel.setLights(lightsOn, this.bot.brakePedal > 0.2);
    }
    if (this.ghost && this.ghostData) {
      const d = this.ghostData;
      const t = this.phase === 'countdown' ? 0 : this.time;
      while (this.ghostIdx < d.length - 2 && d[this.ghostIdx + 1][0] < t) this.ghostIdx++;
      const a = d[this.ghostIdx];
      const b = d[Math.min(d.length - 1, this.ghostIdx + 1)];
      const f = b[0] > a[0] ? Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))) : 0;
      const root = this.ghost.root;
      root.position.set(a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f);
      root.quaternion.slerpQuaternions(new THREE.Quaternion(a[4], a[5], a[6], a[7]), new THREE.Quaternion(b[4], b[5], b[6], b[7]), f);
      root.visible = t < d[d.length - 1][0] + 1;
    }
  }

  // What the HUD shows during a race.
  hud() {
    if (!this.active) return null;
    const out = { time: this.time + this.penalty };
    if (this.mode === 'battle' && this.bot) {
      const ahead = this.q.s >= (this.botQ.s ?? 0);
      out.position = this.botTime !== null && this.phase !== 'done' ? '2ND' : ahead ? '1ST' : '2ND';
      out.gap = Math.abs(this.q.s - (this.botQ.s ?? 0));
    }
    // Ahead (-) or behind (+) the ghost / best run at this point of the road.
    const d = this.ghostData || this.record?.ghost;
    if (this.mode === 'attack' && d && d.length && this.phase === 'running') {
      let lo = 0;
      let hi = d.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (d[mid][8] < this.q.s) lo = mid + 1;
        else hi = mid;
      }
      out.delta = this.time - d[lo][0];
    }
    return out;
  }

  #finish(vehicle) {
    this.phase = 'done';
    const time = this.time + this.penalty;
    const rec = this.record;
    const pb = !rec || time < rec.best;
    let earned = 0;
    let won = null;
    if (this.mode === 'attack') {
      const pace = Math.min(1.6, Math.max(0.4, (this.prize.par / time) ** 2));
      earned = Math.round((this.prize.base * pace) / 10) * 10 + (pb ? 250 : 0);
    } else {
      won = this.botTime === null || time < this.botTime;
      earned = won ? this.prize.win : this.prize.lose;
    }
    if (pb) {
      this.records[this.roadId] = { best: time, ghost: this.samples, look: this.look?.() || {} };
      saveRecords(this.records);
    }
    this.wallet.earn(earned);
    this.result = { mode: this.mode, time, best: this.record.best, pb, earned, won, botTime: this.botTime };
    this.onFinish?.(this.result);
    void vehicle;
  }
}
