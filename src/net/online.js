// Online play: connects to a Touge relay server, sends this car's state, and keeps track of the
// other drivers on the same road. See server/server.js for the protocol.
import * as THREE from 'three';
import { CarModel } from '../render/carModel.js';
import { CAR, CARS, TUNABLE_DEFAULTS } from '../config.js';
import { HostRoom, joinLink, serverLink } from './p2p.js';

// What other players need to draw your car.
export const LOOK_KEYS = ['paint', 'wheel', 'rim', 'profile', 'stretch', 'offsetFront', 'offsetRear', 'camberFront', 'camberRear', 'headlights', 'taillights', 'exhaust', 'plateStyle', 'plateText', 'numbers', 'number', 'numberW', 'numberH', 'rideHeight', 'coilovers', 'seats'];

export function lookOf(tune) {
  const out = { car: CAR.id };
  for (const k of LOOK_KEYS) out[k] = tune[k];
  return out;
}

const SEND_HZ = 15;
const DELAY = 0.12; // seconds behind real time that other cars are drawn, to smooth the network

// Name tag drawn above a remote car.
function nameTag(name) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d');
  g.font = "32px 'VT323', monospace";
  const w = Math.min(250, g.measureText(name).width + 24);
  g.fillStyle = 'rgba(6,6,8,0.7)';
  g.fillRect((256 - w) / 2, 4, w, 40);
  g.fillStyle = '#ffb066';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 128, 25);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(2.4, 0.45, 1);
  s.position.y = 1.4;
  s.renderOrder = 10;
  return s;
}

export class Online {
  // scene: where remote cars are drawn; world: Rapier world, so remote cars are solid.
  constructor(scene, world, RAPIER) {
    this.scene = scene;
    this.world = world;
    this.RAPIER = RAPIER;
    this.link = null;
    this.room = null;
    this.error = '';
    this.onRoom = () => {};
    this.status = 'offline'; // 'offline' | 'connecting' | 'online' | 'error'
    this.serverName = '';
    this.players = new Map(); // id -> { name, model, body, buf: [{ t, s }] }
    this.sendTimer = 0;
    this.clock = 0;
    this.onChange = () => {};
    this.onChat = () => {};
  }

  get count() {
    return this.players.size;
  }

  // ---- Three ways online: host a room, join one by code, or use your own server ----
  host(code, name, road, time, tune) {
    this.disconnect();
    this.kind = 'host';
    const room = new HostRoom(code, { name, road, time });
    this.room = room;
    this.status = 'connecting';
    this.onChange();
    room.onOpen = () => this.#use(room.localLink(), name, road, tune);
    room.onError = (text) => this.#fail(text);
  }

  join(code, name, road, tune) {
    this.disconnect();
    this.kind = 'join';
    this.#use(joinLink(code), name, road, tune);
  }

  connect(url, name, road, tune) {
    this.disconnect();
    this.kind = 'server';
    this.#use(serverLink(url), name, road, tune);
  }

  // Change the road or time for everyone (host only).
  setRoom(patch) {
    this.room?.setSettings(patch);
  }

  get hosting() {
    return !!this.room && this.status === 'online';
  }

  #use(link, name, road, tune) {
    this.link = link;
    this.status = 'connecting';
    this.error = '';
    this.onChange();
    link.onopen = () => link.send({ t: 'hello', name, road, look: lookOf(tune) });
    link.onmessage = (m) => this.#handle(m);
    link.onerror = (text) => this.#fail(text);
    link.onclose = () => {
      if (this.link !== link) return;
      this.#clearPlayers();
      if (this.status === 'online') {
        this.status = 'error';
        this.error = 'The host left';
      }
      this.link = null;
      this.onChange();
    };
  }

  #fail(text) {
    const link = this.link;
    this.link = null;
    link?.close();
    this.room?.close();
    this.room = null;
    this.#clearPlayers();
    this.status = 'error';
    this.error = text || 'Could not connect';
    this.onChange();
  }

  disconnect() {
    const link = this.link;
    this.link = null;
    link?.close();
    this.room?.close();
    this.room = null;
    this.#clearPlayers();
    this.status = 'offline';
    this.error = '';
    this.onChange();
  }

  sendLook(tune) {
    if (this.status === 'online') this.link.send({ t: 'look', look: lookOf(tune) });
  }

  chat(text) {
    if (this.status === 'online' && text.trim()) this.link.send({ t: 'chat', text: text.slice(0, 80) });
  }

  #handle(m) {
    if (m.t === 'room') {
      this.roomInfo = m.room;
      this.onRoom(m.room);
    } else if (m.t === 'welcome') {
      this.status = 'online';
      this.serverName = m.server;
      this.myId = m.id;
      this.roomInfo = m.room || null;
      if (m.room) this.onRoom(m.room);
      for (const p of m.players) this.#add(p);
    } else if (m.t === 'full') {
      this.status = 'full';
      this.link?.close();
      this.error = 'That game is full';
    } else if (m.t === 'join') this.#add(m);
    else if (m.t === 'leave') this.#remove(m.id);
    else if (m.t === 'look') {
      const p = this.players.get(m.id);
      if (p) p.model.applySetup({ ...TUNABLE_DEFAULTS, ...m.look });
    } else if (m.t === 'state') {
      const p = this.players.get(m.id);
      if (p) {
        p.buf.push({ t: this.clock, s: m.s });
        if (p.buf.length > 30) p.buf.shift();
      }
    } else if (m.t === 'chat') this.onChat(m.name, m.text);
    this.onChange();
  }

  #add({ id, name, look }) {
    if (this.players.has(id)) return;
    const spec = CARS[look?.car] || CAR; // they may be driving a different car
    const model = new CarModel(spec);
    model.applySetup({ ...TUNABLE_DEFAULTS, ...look });
    model.root.add(nameTag(name));
    model.root.visible = false;
    this.scene.add(model.root);
    // A solid, moving box so you can bump into other cars (they are driven by their owners).
    const R = this.RAPIER;
    const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -500, 0));
    const collider = this.world.createCollider(R.ColliderDesc.cuboid(0.8, 0.45, 2.1).setTranslation(0, 0.1, 0).setFriction(0.3), body);
    collider.setEnabled(false); // turned on once the cars are apart (see update)
    const wheels = [
      [spec.trackFront / 2, spec.frontAxleZ, true],
      [-spec.trackFront / 2, spec.frontAxleZ, true],
      [spec.trackRear / 2, spec.rearAxleZ, false],
      [-spec.trackRear / 2, spec.rearAxleZ, false],
    ].map(([x, z, front]) => ({ x, z, front, compression: 0.11, steer: 0, angle: 0 }));
    this.players.set(id, { id, name, model, body, collider, buf: [], fake: { wheels, mountY: spec.wheelMountY }, braking: false });
  }

  #remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.scene.remove(p.model.root);
    this.world.removeRigidBody(p.body);
    this.players.delete(id);
  }

  #clearPlayers() {
    for (const id of [...this.players.keys()]) this.#remove(id);
  }

  // Send our car, and move the other cars along their received paths.
  update(dt, vehicle, controls, lightsOn) {
    this.clock += dt;
    if (this.status === 'online') {
      this.sendTimer -= dt;
      if (this.sendTimer <= 0) {
        this.sendTimer = 1 / SEND_HZ;
        const b = vehicle.body;
        const p = b.translation();
        const q = b.rotation();
        const v = b.linvel();
        const r2 = (n) => Math.round(n * 100) / 100;
        const r4 = (n) => Math.round(n * 10000) / 10000;
        this.link.send({ t: 'state', s: [r2(p.x), r2(p.y), r2(p.z), r4(q.x), r4(q.y), r4(q.z), r4(q.w), r2(v.x), r2(v.y), r2(v.z), r4(vehicle.steer), Math.round(vehicle.rpm), controls.brake > 0 ? 1 : 0] });
      }
    }
    const at = this.clock - DELAY;
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    for (const p of this.players.values()) {
      const buf = p.buf;
      if (!buf.length) continue;
      // Find the two states either side of `at` and blend between them.
      let a = buf[0];
      let b = buf[0];
      for (let k = 0; k < buf.length; k++) {
        if (buf[k].t <= at) a = buf[k];
        if (buf[k].t >= at) {
          b = buf[k];
          break;
        }
        b = buf[k];
      }
      const span = b.t - a.t;
      const f = span > 1e-4 ? Math.min(1, Math.max(0, (at - a.t) / span)) : 1;
      const s = a.s;
      const e = b.s;
      const root = p.model.root;
      root.position.set(s[0] + (e[0] - s[0]) * f, s[1] + (e[1] - s[1]) * f, s[2] + (e[2] - s[2]) * f);
      // Past the newest state, carry on with its velocity for a moment.
      if (at > b.t) root.position.addScaledVector(new THREE.Vector3(e[7], e[8], e[9]), Math.min(0.3, at - b.t));
      qa.set(s[3], s[4], s[5], s[6]);
      qb.set(e[3], e[4], e[5], e[6]);
      root.quaternion.slerpQuaternions(qa, qb, f);
      root.visible = true;
      for (const w of p.fake.wheels) {
        w.steer = w.front ? e[10] : 0;
        w.angle += (Math.hypot(e[7], e[9]) / 0.3) * dt;
      }
      p.model.syncWheels(p.fake);
      p.model.setLights(lightsOn, e[12] === 1);
      p.body.setNextKinematicTranslation(root.position);
      p.body.setNextKinematicRotation(root.quaternion);
      // Cars are solid to each other, except while overlapping (both just spawned at the start,
      // or one was put back on the road on top of the other): then they pass through until apart.
      const me = vehicle.body.translation();
      const gap = Math.hypot(root.position.x - me.x, root.position.y - me.y, root.position.z - me.z);
      const jumped = a !== b && Math.hypot(e[0] - s[0], e[2] - s[2]) > 8;
      if (jumped || gap < 4.6) p.solidWait = true;
      if (p.solidWait && gap > 5.5) p.solidWait = false;
      p.collider.setEnabled(!p.solidWait);
    }
  }
}
