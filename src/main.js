// The Art of Touge: first playable. One car, one section (Cedar Hairpins), time attack.
import * as THREE from 'three';
import { Track, SECTION_NAME } from './sim/track.js';
import { CarSim } from './sim/car.js';
import { CARS } from './sim/specs.js';
import { globals } from './render/ps1.js';
import { Scenery } from './render/scenery.js';
import { CarModel } from './render/carModel.js';
import { Environment } from './render/environment.js';
import { presetFor, cycleLabel } from './game/timeOfDay.js';
import { Input } from './game/input.js';
import { CarAudio } from './game/audio.js';
import { TimeAttack } from './game/timeAttack.js';
import { Hud, formatTime } from './ui/hud.js';
import { loadSettings, saveSettings, renderSettings } from './ui/settings.js';

const PHYSICS_DT = 1 / 480;
const $ = (id) => document.getElementById(id);

// ---------- Setup ----------
const settings = loadSettings();
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setClearColor(0x000000);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.3, 4000);

const track = new Track();
const scenery = new Scenery(track, scene);
const env = new Environment(scene);
const spec = CARS.kazamaMR;
const car = new CarSim(spec, track);
const carModel = new CarModel(spec);
scene.add(carModel.root);

const input = new Input($('controls'));
const audio = new CarAudio();
const run = new TimeAttack('cedar-hairpins', scenery.startIndex, scenery.finishIndex);
const hud = new Hud($('hud'), track, scenery);

let started = false;
let paused = false;
let accumulator = 0;
let todTimer = 0;
let lastTime = performance.now();
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let camReady = false;
const camQuery = {};

// ---------- Settings ----------
function applySettings() {
  car.transmission = settings.transmission;
  car.steerAssist = settings.steerAssist;
  input.setSteerMode(settings.steering);
  input.setTransmission(settings.transmission);
  audio.setMuted(!settings.sound);
  resize();
  applyTimeOfDay();
}

function applyTimeOfDay() {
  env.apply(presetFor(settings.time, settings.cycleMinutes), carModel, scenery);
}

function onSettingChange(key, value) {
  settings[key] = value;
  saveSettings(settings);
  applySettings();
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const rh = settings.resolution;
  const rw = Math.round((rh * w) / Math.max(1, h));
  renderer.setSize(rw, rh, false);
  globals.uRes.value.set(rw, rh);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  hud.resize();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

// ---------- Flow: title, pause, results ----------
function startGame() {
  $('title').classList.add('hidden');
  started = true;
  audio.start();
  const el = document.documentElement;
  if (el.requestFullscreen && !document.fullscreenElement) {
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
      .catch(() => {});
  }
  restartRun();
}

function restartRun() {
  car.reset(8);
  run.reset();
  camReady = false;
  $('results').classList.add('hidden');
  const rec = run.record;
  hud.showBanner(SECTION_NAME, `TIME ATTACK  ·  RECORD ${rec ? formatTime(rec.time) : '--'}`);
}

function setPaused(p) {
  paused = p;
  $('pause').classList.toggle('hidden', !p);
  if (p) {
    renderSettings($('settings'), settings, onSettingChange);
    audio.suspend();
  } else {
    audio.resume();
    lastTime = performance.now();
  }
}

function showResults() {
  const r = run.lastResult;
  $('res-title').textContent = r.isRecord ? 'NEW RECORD!' : 'FINISH';
  $('res-time').textContent = formatTime(r.time);
  $('res-best').textContent = r.isRecord
    ? r.previous != null
      ? `Previous record ${formatTime(r.previous)} (−${(r.previous - r.time).toFixed(3)})`
      : 'First record on Cedar Hairpins'
    : `Record ${formatTime(run.record.time)} (+${(r.time - run.record.time).toFixed(3)})`;
  $('results').classList.remove('hidden');
}

function recover() {
  // Put the car back in the middle of the road, facing downhill. Cancels a run in progress.
  const i = Math.max(8, Math.min(track.count - 12, car.q.index));
  car.reset(i);
  camReady = false;
  if (run.cancel()) hud.showFlash('RUN CANCELLED', '#ff5a4a');
}

$('btn-start').addEventListener('click', startGame);
$('btn-pause').addEventListener('click', () => started && setPaused(true));
$('btn-resume').addEventListener('click', () => setPaused(false));
$('btn-restart').addEventListener('click', () => {
  setPaused(false);
  restartRun();
});
$('btn-again').addEventListener('click', restartRun);
$('btn-camera').addEventListener('click', () => onSettingChange('camera', settings.camera === 'chase' ? 'hood' : 'chase'));
$('btn-recover').addEventListener('click', recover);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && started) setPaused(!paused);
  if (e.code === 'KeyR' && started && !paused) recover();
  if (e.code === 'KeyV') onSettingChange('camera', settings.camera === 'chase' ? 'hood' : 'chase');
  if (e.code === 'Enter' && !started) startGame();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && started && !paused) setPaused(true);
});

// ---------- Camera ----------
function updateCamera(dt) {
  if (window.__touge?.debugCam) {
    window.__touge.debugCam(camera, car);
    return;
  }
  const fx = Math.sin(car.yaw);
  const fz = Math.cos(car.yaw);
  if (settings.camera === 'hood') {
    const p = new THREE.Vector3(car.x + fx * 0.75, car.y + 1.08, car.z + fz * 0.75);
    camera.position.copy(p);
    const look = new THREE.Vector3(car.x + fx * 20, car.y + 0.9 - car.pitch * 20, car.z + fz * 20);
    camera.up.set(Math.cos(car.yaw) * -car.roll, 1, -Math.sin(car.yaw) * -car.roll).normalize();
    camera.lookAt(look);
    camReady = false;
    return;
  }
  camera.up.set(0, 1, 0);
  // Chase camera: behind the car, swinging partly toward the direction of travel in a slide.
  let dx = fx;
  let dz = fz;
  const sp = car.speed;
  if (sp > 4 && car.forwardSpeed > 0) {
    const vx = car.vx / sp;
    const vz = car.vz / sp;
    dx = fx * 0.6 + vx * 0.4;
    dz = fz * 0.6 + vz * 0.4;
    const l = Math.hypot(dx, dz);
    dx /= l;
    dz /= l;
  }
  const dist = 5.6;
  const target = new THREE.Vector3(car.x - dx * dist, car.y + 1.85, car.z - dz * dist);
  const look = new THREE.Vector3(car.x + fx * 2, car.y + 0.95, car.z + fz * 2);
  if (!camReady) {
    camPos.copy(target);
    camLook.copy(look);
    camReady = true;
  }
  const k = 1 - Math.exp(-dt * 9);
  camPos.lerp(target, k);
  camLook.lerp(look, 1 - Math.exp(-dt * 14));
  // Keep the camera above the road surface.
  track.query(camPos.x, camPos.z, car.q.index, camQuery);
  const minY = camQuery.height + 0.9;
  if (camPos.y < minY) camPos.y = minY;
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

// ---------- Main loop ----------
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (!(dt > 0)) dt = 0;
  dt = Math.min(dt, 0.1);
  const portrait = window.innerHeight > window.innerWidth && matchMedia('(pointer: coarse)').matches;
  const active = started && !paused && !portrait && $('results').classList.contains('hidden');

  const controls = input.poll(dt);
  if (active) {
    for (const dir of controls.shifts) car.shift(dir, controls.clutch);
    // Screen steering is +right; the simulation uses +left.
    const simInput = { ...controls, steer: -controls.steer };
    accumulator += dt;
    let steps = 0;
    while (accumulator >= PHYSICS_DT && steps < 60) {
      car.step(PHYSICS_DT, simInput);
      accumulator -= PHYSICS_DT;
      steps++;
    }
    if (steps === 60) accumulator = 0;
    if (car.wallHit > 0) {
      audio.thump(car.wallHit);
      car.wallHit = 0;
    }
    audio.update(car);

    const event = run.update(dt, car.q.s);
    if (event === 'start') hud.showFlash('GO!', '#5dff6a', 1.2);
    if (event === 'record' || event === 'finish') showResults();

    // Automatic day/night cycle advances in real time.
    if (settings.time === 'auto') {
      settings.cycleMinutes += dt / 60;
      todTimer += dt;
      if (todTimer > 0.5) {
        todTimer = 0;
        applyTimeOfDay();
        saveSettings(settings);
      }
    }
  }

  // ---- Render ----
  carModel.update(car, dt, globals.uHeadOn.value > 0.5, controls.brake > 0.05);
  updateCamera(dt);
  const fx = Math.sin(car.yaw);
  const fz = Math.cos(car.yaw);
  globals.uHeadPos.value.set(car.x + fx * 1.9, car.y + 0.7, car.z + fz * 1.9);
  globals.uHeadDir.value.set(fx, -0.08, fz).normalize();
  env.update(camera);
  scenery.update(camera.position, globals.uFogFar.value);
  renderer.render(scene, camera);

  hud.draw(dt, {
    hidden: !started,
    car,
    run,
    units: settings.units,
    showClutch: settings.transmission === 'manual-clutch',
    todLabel: settings.time === 'auto' ? cycleLabel(settings.cycleMinutes) : null,
  });
}

applySettings();
// Debug/testing hook (used by automated browser tests).
window.__touge = { car, run, track, settings, startGame, restartRun, setPaused, applySettings, scene, carModel };
requestAnimationFrame(frame);
