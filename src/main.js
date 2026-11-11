// The Art of Touge - Phase 1: the E30 on a flat test track.
import './styles.css';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CAR } from './config.js';
import { Vehicle } from './physics/vehicle.js';
import { MODES, MODE_LABELS } from './physics/transmission.js';
import { CarModel } from './render/carModel.js';
import { CameraRig } from './render/camera.js';
import { TestTrack } from './world/testTrack.js';
import { Input } from './controls/input.js';
import { Shifter } from './controls/shifter.js';
import { Hud } from './ui/hud.js';
import { CarAudio } from './audio/carAudio.js';
import { TuningPanel } from './ui/tuning.js';
import { loadSettings, saveSettings, loadTuning, saveTuning } from './settings.js';

const DT = 1 / 60; // fixed physics step
const MAX_STEPS = 5;
const SPAWN = { pos: [0, 0.75, 20], yaw: 0 };
const $ = (id) => document.getElementById(id);

const settings = loadSettings();
const tune = loadTuning();

// ---------- Rendering ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ab8d6);
scene.fog = new THREE.Fog(0x9ab8d6, 80, 420);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1500);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-40, 80, 30);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xb8c6e0, 1.1));

function blobShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 5.0), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

const hud = new Hud($('hud'));
const input = new Input($('controls'));
const rig = new CameraRig(camera);
const audio = new CarAudio();
rig.mode = settings.camera;

let world;
let vehicle;
let track;
let carModel;
let shadow;
let shifter;
let tuning;
let running = false;
let paused = false;
let accumulator = 0;
let last = performance.now();
let lapTime = 0;
let fps = 60;
const prevPos = new THREE.Vector3();
const prevQuat = new THREE.Quaternion();
const curPos = new THREE.Vector3();
const curQuat = new THREE.Quaternion();

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  // Shift the picture up so the car sits above the touch controls instead of behind them.
  camera.setViewOffset(w, h, 0, h * 0.2, w, h);
  camera.updateProjectionMatrix();
  hud.resize();
}
window.addEventListener('resize', resize);
resize();

// ---------- UI ----------
let toastTimer = 0;
function toast(text, seconds = 1.4) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  toastTimer = seconds;
}

function renderChoices() {
  for (const box of document.querySelectorAll('.choices')) {
    const key = box.dataset.setting;
    const options =
      key === 'mode'
        ? MODES.map((m) => [m, MODE_LABELS[m]])
        : key === 'sound'
          ? [[true, 'On'], [false, 'Off']]
          : [['chase', 'Chase'], ['bumper', 'Bumper']];
    box.innerHTML = '';
    for (const [value, label] of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (settings[key] === value) b.classList.add('sel');
      b.addEventListener('click', () => {
        settings[key] = value;
        saveSettings(settings);
        applySettings();
        renderChoices();
      });
      box.appendChild(b);
    }
  }
}

function applySettings() {
  rig.mode = settings.camera;
  audio.setMuted(!settings.sound);
  if (vehicle && vehicle.mode !== settings.mode) {
    vehicle.setMode(settings.mode);
    if (settings.mode === 'auto') vehicle.trans.setDrive('D', 0);
    else vehicle.trans.requestGear(0, 0);
    shifter?.setGear(vehicle.trans.gear);
  }
  const mode = settings.mode;
  $('shifter').classList.toggle('hidden', mode === 'auto');
  $('dr').classList.toggle('hidden', mode !== 'auto');
  $('clutch').classList.toggle('hidden', mode !== 'manual');
}

function resetCar() {
  vehicle.reset(SPAWN.pos, SPAWN.yaw);
  if (vehicle.mode === 'auto') vehicle.trans.setDrive('D', 0);
  shifter.setGear(vehicle.trans.gear);
  track.resetCones();
  lapTime = 0;
  rig.snap();
  capturePose();
  capturePose();
}

function setPaused(p) {
  paused = p;
  $('pause').classList.toggle('hidden', !p);
  if (p) {
    input.releaseAll();
    audio.suspend();
  } else {
    audio.resume();
  }
  last = performance.now();
}

$('btn-drive').addEventListener('click', () => {
  $('title').classList.add('hidden');
  $('controls').classList.remove('hidden');
  $('topbar').classList.remove('hidden');
  running = true;
  audio.start();
  audio.setMuted(!settings.sound);
  const el = document.documentElement;
  if (el.requestFullscreen && !document.fullscreenElement) {
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
      .catch(() => {});
  }
  resetCar();
});
$('btn-pause').addEventListener('click', () => setPaused(true));
$('btn-resume').addEventListener('click', () => setPaused(false));
$('btn-restart').addEventListener('click', () => {
  resetCar();
  setPaused(false);
});
$('btn-cam').addEventListener('click', () => {
  settings.camera = settings.camera === 'chase' ? 'bumper' : 'chase';
  saveSettings(settings);
  applySettings();
  renderChoices();
});
$('btn-tuning').addEventListener('click', () => tuning.toggle());
window.addEventListener('keydown', (e) => {
  if (!running) {
    if (e.code === 'Enter') $('btn-drive').click();
    return;
  }
  if (e.code === 'Escape') setPaused(!paused);
  if (e.code === 'Backspace') resetCar();
  if (e.code === 'KeyC') $('btn-cam').click();
  if (e.code === 'Backquote') tuning.toggle();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) setPaused(true);
});

// ---------- Driving events ----------
function handleEvents(events) {
  const tr = vehicle.trans;
  for (const ev of events) {
    if (ev.type === 'gear' && tr.mode !== 'auto') {
      if (tr.requestGear(ev.gear, vehicle.forwardSpeed)) shifter.setGear(ev.gear);
    } else if (ev.type === 'drive') {
      tr.setDrive(ev.drive, vehicle.forwardSpeed);
    } else if (ev.type === 'start') {
      if (vehicle.engine.running) continue;
      if (tr.mode === 'manual' && tr.gear !== 0 && tr.pedal < 0.8) {
        toast('CLUTCH IN OR NEUTRAL TO START');
        continue;
      }
      vehicle.engine.start();
    }
  }
}

function capturePose() {
  prevPos.copy(curPos);
  prevQuat.copy(curQuat);
  const p = vehicle.body.translation();
  const q = vehicle.body.rotation();
  curPos.set(p.x, p.y, p.z);
  curQuat.set(q.x, q.y, q.z, q.w);
}

// ---------- Main loop ----------
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0)) dt = 0;
  dt = Math.min(dt, 0.1);
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  if (!vehicle) return;

  const portrait = window.innerHeight > window.innerWidth && matchMedia('(pointer: coarse)').matches;
  const active = running && !paused && !portrait;
  const controls = input.poll(dt);
  if (active) {
    handleEvents(controls.events);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= DT && steps < MAX_STEPS) {
      vehicle.step(DT, controls);
      world.step();
      capturePose();
      accumulator -= DT;
      steps++;
    }
    if (steps === MAX_STEPS) accumulator = 0;
    lapTime += dt;
    const tr = vehicle.trans;
    if (tr.messageTimer > 0 && tr.message) {
      toast(tr.message, tr.messageTimer);
      tr.message = '';
    }
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) $('toast').classList.remove('show');
  }
  if (active) audio.update(vehicle, dt);
  $('start').classList.toggle('hidden', vehicle.engine.running);
  $('clutch').style.setProperty('--engaged', `${Math.round((1 - vehicle.trans.coupling) * 100)}%`);

  // Interpolate the car between physics steps for smooth motion on any refresh rate.
  const alpha = active ? accumulator / DT : 1;
  carModel.root.position.lerpVectors(prevPos, curPos, alpha);
  carModel.root.quaternion.slerpQuaternions(prevQuat, curQuat, alpha);
  carModel.syncWheels(vehicle);
  carModel.setLights(false, controls.brake > 0);
  shadow.position.set(carModel.root.position.x, track.heightAt() + 0.02, carModel.root.position.z);
  shadow.rotation.z = new THREE.Euler().setFromQuaternion(carModel.root.quaternion, 'YXZ').y;
  track.sync();
  if (window.__touge?.debugCam) window.__touge.debugCam(camera, carModel.root);
  else rig.update(dt, carModel.root, vehicle.body.linvel());
  renderer.render(scene, camera);

  const tr = vehicle.trans;
  hud.draw(
    running
      ? {
          rpm: vehicle.rpm,
          redline: CAR.engine.redline,
          speedMph: vehicle.forwardSpeed * 2.23694,
          gear: tr.label,
          showGear: tr.mode === 'auto',
          running: vehicle.engine.running,
          needClutchToStart: tr.mode === 'manual' && tr.gear !== 0,
          lapTime,
          bestTime: null,
          fps,
        }
      : null,
  );
}

// ---------- Start-up ----------
async function boot() {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  track = new TestTrack(world, scene);
  vehicle = new Vehicle(world, CAR, tune, settings.mode);
  carModel = new CarModel(CAR);
  scene.add(carModel.root);
  shadow = blobShadow();
  scene.add(shadow);
  shifter = new Shifter($('shifter'), (gear) => vehicle.trans.requestGear(gear, vehicle.forwardSpeed));
  tuning = new TuningPanel($('tuning'), tune, () => saveTuning(tune));
  tuning.toggle(false);
  vehicle.reset(SPAWN.pos, SPAWN.yaw);
  if (vehicle.mode === 'auto') vehicle.trans.setDrive('D', 0);
  capturePose();
  capturePose();
  applySettings();
  renderChoices();
  $('loading').textContent = '';
  $('btn-drive').disabled = false;
  // Testing hook for automated browser checks.
  window.__touge = { vehicle, world, settings, tune, input, shifter, resetCar };
}

$('btn-drive').disabled = true;
renderChoices();
boot().catch((err) => {
  console.error(err);
  $('loading').textContent = `Could not start the physics engine: ${err.message}`;
});
requestAnimationFrame(frame);
