// The Art of Touge - Phase 2: the E30 on the Akina-inspired pass at night.
import './styles.css';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CAR } from './config.js';
import { Vehicle } from './physics/vehicle.js';
import { SoftBarrier } from './physics/barrier.js';
import { RAIL } from './world/road.js';
import { MODES, MODE_LABELS } from './physics/transmission.js';
import { CarModel } from './render/carModel.js';
import { CameraRig } from './render/camera.js';
import { VhsRenderer } from './render/vhs.js';
import { Mountain } from './world/mountain.js';
import { Sky } from './world/sky.js';
import { TIMES } from './world/timeOfDay.js';
import { LensFlare } from './render/lensFlare.js';
import { TRACKS } from './world/tracks.js';
import { Input } from './controls/input.js';
import { Shifter } from './controls/shifter.js';
import { Hud, formatTime } from './ui/hud.js';
import { CarAudio } from './audio/carAudio.js';
import { ExhaustEvents } from './audio/exhaust.js';
import { DriftScore } from './game/drift.js';
import { Sparks } from './render/sparks.js';
import { HEADLIGHTS } from './config.js';
import { TuningPanel } from './ui/tuning.js';
import { Shop } from './ui/shop.js';
import { loadSettings, saveSettings, loadTuning, saveTuning } from './settings.js';

const DT = 1 / 60; // fixed physics step
const MAX_STEPS = 5;
const $ = (id) => document.getElementById(id);

const settings = loadSettings();
const tune = loadTuning();

// ---------- Rendering ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const vhs = new VhsRenderer(renderer, 1);
const scene = new THREE.Scene();
// Night: dark blue fog, moonlight and a soft sky fill. The headlights are the main light.
let FOG_FAR = 340;
scene.background = new THREE.Color(0x0b1430);
// Exponential haze: close things stay crisp, the far ranges fade into the sky.
scene.fog = new THREE.FogExp2(0x0b1430, 0.0011);
const camera = new THREE.PerspectiveCamera(60, 1, 0.15, 9000);
const moon = new THREE.DirectionalLight(0x9fb4ff, 0.85);
moon.position.set(-45, 55, -70);
scene.add(moon);
const hemi = new THREE.HemisphereLight(0x4a5e96, 0x14161c, 1.15);
scene.add(hemi);
// Headlights: one spot light that rides on the car and lights the road ahead.
const headlight = new THREE.SpotLight(0xfff2d8, 1300, 150, 0.6, 0.6, 1.5);
scene.add(headlight, headlight.target);
const sky = new Sky(scene);
const flare = new LensFlare($('flare'));
const sunDir = new THREE.Vector3(0, 1, 0);
let timePreset = TIMES.night;

// Sun (or moon) direction for this road: low over the road's general direction of travel, so you
// drive toward it a good part of the time.
function sunDirection(preset) {
  const az = mountain.sunAz;
  const el = (preset.sunElevation * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

// Does a peak of the far ranges stand between the camera and the sun?
function behindRange(from) {
  for (let d = 300; d < 9000; d *= 1.18) {
    const x = from.x + sunDir.x * d;
    const z = from.z + sunDir.z * d;
    if (mountain.rangeHeightAt(x, z) > from.y + sunDir.y * d) return true;
  }
  return false;
}

function applyTime() {
  if (!mountain) return;
  const p = TIMES[settings.time] || TIMES.night;
  timePreset = p;
  scene.background.setHex(p.fog);
  scene.fog.color.setHex(p.fog);
  scene.fog.density = p.fogDensity;
  FOG_FAR = p.detailRange;
  sunDir.copy(sunDirection(p));
  moon.color.setHex(p.sunColor);
  moon.intensity = p.sunIntensity;
  moon.position.copy(sunDir).multiplyScalar(100);
  hemi.color.setHex(p.hemiSky);
  hemi.groundColor.setHex(p.hemiGround);
  hemi.intensity = p.hemiIntensity;
  headlight.visible = p.lights;
  sky.setTime(p, sunDir);
  mountain.setTime(p);
  camera.updateProjectionMatrix();
}

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
const exhaustEvents = new ExhaustEvents();
const drift = new DriftScore();
let sparks;
const sparkP = new THREE.Vector3();
const sparkPush = new THREE.Vector3();
rig.mode = settings.camera;

let world;
let vehicle;
let carModel;
let shadow;
let mountain;
let barrier;
const run = { phase: 'ready', time: 0, best: null, hint: -1 };
const roadQ = {};
let lastGear = null;
let shifter;
let tuning;
let running = false;
let paused = false;
let accumulator = 0;
let last = performance.now();
let fps = 60;
const prevPos = new THREE.Vector3();
const prevQuat = new THREE.Quaternion();
const curPos = new THREE.Vector3();
const curQuat = new THREE.Quaternion();

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  vhs.setSize(w, h);
  camera.aspect = w / Math.max(1, h);
  // Shift the picture up so the car sits above the touch controls instead of behind them.
  camera.setViewOffset(w, h, 0, h * 0.2, w, h);
  camera.updateProjectionMatrix();
  hud.resize();
  flare.resize();
  shopRef?.resize(w, h);
}
let shopRef = null;
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
        : key === 'map'
          ? Object.entries(TRACKS).map(([id, t]) => [id, t.name])
          : key === 'time'
          ? Object.entries(TIMES).map(([id, t]) => [id, t.name])
          : key === 'picture'
          ? [['sharp', 'Sharp'], ['retro', 'Retro pixels']]
          : key === 'sound' || key === 'vhs'
          ? [[true, 'On'], [false, 'Off']]
          : key === 'steering'
            ? [['buttons', 'Buttons'], ['slider', 'Slider']]
            : key === 'shifter'
              ? [['drag', 'Drag knob'], ['tap', 'Tap gears']]
              : [['chase', 'Chase'], ['cockpit', 'In car'], ['bumper', 'Bumper']];
    box.innerHTML = '';
    for (const [value, label] of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (settings[key] === value) b.classList.add('sel');
      b.addEventListener('click', () => {
        // Switching road rebuilds the whole world: save and reload.
        if (key === 'map' && settings.map !== value) {
          settings.map = value;
          saveSettings(settings);
          location.reload();
          return;
        }
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
  applyTime();
  updateTitleSub();
  rig.mode = settings.camera;
  audio.setMuted(!settings.sound);
  vhs.strength = settings.vhs ? 0.45 : 0;
  // Picture: 'sharp' renders at screen resolution, 'retro' at half (chunky pixels).
  vhs.pixelSize = settings.picture === 'retro' ? 2 : 1;
  vhs.setSize(window.innerWidth, window.innerHeight);
  $('vhs').classList.toggle('off', !settings.vhs);
  $('controls').dataset.steering = settings.steering;
  shifter?.setMode(settings.shifter);
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

function placeCar(pose) {
  vehicle.reset(pose.pos, pose.yaw);
  if (vehicle.mode === 'auto') vehicle.trans.setDrive('D', 0);
  shifter.setGear(vehicle.trans.gear);
  run.hint = pose.index;
  rig.snap();
  capturePose();
  capturePose();
}

// Back to the summit start line.
function resetCar() {
  placeCar(mountain.spawn);
  drift.reset();
  run.phase = 'ready';
  run.time = 0;
}

// Back on the road where you are (stuck, rolled or off the road). Cancels a timed run.
function recoverCar() {
  placeCar(mountain.recoverAt(run.hint - 5));
  if (run.phase === 'running') {
    run.phase = 'ready';
    run.time = 0;
    toast('RUN CANCELLED');
  }
}

function setPaused(p) {
  paused = p;
  $('pause').classList.toggle('hidden', !p);
  document.body.classList.toggle('paused', p);
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
  // Launched from the home-screen icon the game is already full screen (the manifest asks for it),
  // so only ask the browser for full screen when playing in a normal tab.
  const installed = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  const el = document.documentElement;
  if (!installed && el.requestFullscreen && !document.fullscreenElement) {
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
$('btn-recover').addEventListener('click', () => {
  recoverCar();
  setPaused(false);
});
$('btn-cam').addEventListener('click', () => {
  settings.camera = { chase: 'cockpit', cockpit: 'bumper', bumper: 'chase' }[settings.camera] || 'chase';
  saveSettings(settings);
  applySettings();
  renderChoices();
});
$('btn-tuning').addEventListener('click', () => tuning.toggle());
const shop = new Shop($('shop'), tune, () => {
  saveTuning(tune);
  carModel?.applySetup(tune);
  headlight.color.setHex((HEADLIGHTS[tune.headlights] || HEADLIGHTS.white)[1]);
});
shopRef = shop;
shop.resize(window.innerWidth, window.innerHeight);
$('btn-shop').addEventListener('click', () => shop.open());
$('btn-shop2').addEventListener('click', () => shop.open());
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return; // typing a build name
  if (!running) {
    if (e.code === 'Enter') $('btn-drive').click();
    return;
  }
  if (e.code === 'Escape') setPaused(!paused);
  if (e.code === 'Backspace') resetCar();
  if (e.code === 'KeyT') recoverCar();
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

// ---------- Downhill time attack: start line to finish line ----------
function updateRun(dt) {
  const p = vehicle.body.translation();
  mountain.road.query(p.x, p.z, run.hint, roadQ);
  run.hint = roadQ.index;
  const r = mountain.road;
  const start = r.startIndex * 2;
  const finish = r.finishIndex * 2;
  if (run.phase === 'ready' && roadQ.s >= start && roadQ.s < start + 20) {
    run.phase = 'running';
    run.time = 0;
    toast('GO!', 1);
  } else if (run.phase === 'running') {
    run.time += dt;
    if (roadQ.s >= finish) {
      run.phase = 'finished';
      const best = run.best == null || run.time < run.best;
      if (best) run.best = run.time;
      toast(`${best ? 'NEW BEST ' : 'FINISH '}${formatTime(run.time)}`, 4);
    }
  }
}

// ---------- Sparks: rails, walls and bottoming out ----------
function throwSparks() {
  const v = vehicle.body.linvel();
  const speed = Math.hypot(v.x, v.z);
  let scrape = 0;
  if (speed < 2.5) {
    audio.setScrape(0);
    return;
  }
  const n = Math.min(6, 1 + Math.floor(speed / 6));
  // Against a guardrail: sparks spray back along the rail from each contact.
  for (const c of barrier.contacts) {
    sparkP.set(c.x, c.y - 0.15, c.z);
    sparkPush.set(c.nx, 0, c.nz);
    sparks.emit(sparkP, v, sparkPush, n);
    scrape = Math.max(scrape, 0.5 + c.f / 30000);
  }
  // Body against a wall, a rock face or the ground (Rapier contacts).
  for (const col of [vehicle.collider, vehicle.cabinCollider]) {
    world.contactPairsWith(col, (other) => {
      world.contactPair(col, other, (m) => {
        for (let i = 0; i < m.numSolverContacts(); i++) {
          const p = m.solverContactPoint(i);
          sparkP.set(p.x, p.y, p.z);
          sparkPush.set(0, 0, 0);
          sparks.emit(sparkP, v, sparkPush, n);
          scrape = Math.max(scrape, 0.8);
        }
      });
    });
  }
  // Bottoming out: sparks from under the sills.
  for (const w of vehicle.wheels) {
    if (!(w.scrape > 0)) continue;
    sparkP.set(w.x * 0.85, -0.6, w.z * 0.75);
    carModel.root.localToWorld(sparkP);
    sparkPush.set(0, 0, 0);
    sparks.emit(sparkP, v, sparkPush, Math.max(1, Math.round(n * Math.min(1, w.scrape * 30))));
    scrape = Math.max(scrape, 0.3 + w.scrape * 15);
  }
  audio.setScrape(scrape);
}

// ---------- Title screen: a slow flight along the pass ----------
let titleS = 0;
const titleLook = new THREE.Vector3();
function titleCamera(dt) {
  const r = mountain.road;
  titleS = (titleS + dt * 14) % ((r.count - 80) * 2);
  const f = 20 + titleS / 2;
  const i = Math.floor(f);
  const k = f - i;
  const lerp = (arr, j) => arr[j] + (arr[j + 1] - arr[j]) * k;
  // Smooth the path by averaging a stretch of road, so the camera glides instead of following
  // every corner.
  const avg = (arr, j, span) => {
    let sum = 0;
    for (let n = -span; n <= span; n++) sum += arr[Math.max(0, Math.min(r.count - 1, j + n))];
    return sum / (2 * span + 1);
  };
  const x = avg(r.x, i, 30);
  const z = avg(r.z, i, 30);
  const y = Math.max(lerp(r.y, i), avg(r.y, i, 30)) + 24;
  const a = Math.min(r.count - 1, i + 70);
  camera.position.set(x, y, z);
  titleLook.set(avg(r.x, a, 20), avg(r.y, a, 20) + 4, avg(r.z, a, 20));
  camera.lookAt(titleLook);
}

function updateTitleSub() {
  const t = TRACKS[settings.map] || TRACKS.akina;
  const time = TIMES[settings.time] || TIMES.night;
  $('title-sub').innerHTML = '';
  const b = document.createElement('b');
  b.textContent = t.name;
  $('title-sub').append(b, ` · ${t.blurb} · ${time.name}`);
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
      barrier.apply(vehicle.body);
      world.step();
      capturePose();
      accumulator -= DT;
      steps++;
    }
    if (steps === MAX_STEPS) accumulator = 0;
    updateRun(dt);
    throwSparks();
    drift.update(dt, vehicle, barrier.touching && barrier.impact > 9000);
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
  if (active) {
    const ev = exhaustEvents.update(vehicle, dt, tune.exhaust);
    audio.setExhaust(tune.exhaust || 'stock');
    audio.setParts(tune.intake || 'stock', tune.turbo || 'none');
    audio.update(vehicle, dt, ev);
    // Race exhaust: little flames off the limiter, on shifts and on lift-off.
    if (tune.exhaust === 'race') {
      if (ev.lift) carModel.flame(1);
      if (ev.shift) carModel.flame(0.8);
      if (ev.limiter) carModel.flame(0.6);
    }
  }
  carModel.updateFx(dt);
  sparks.update(dt);
  // In-car view: cockpit on, arms follow the wheel, the shifter and the handbrake.
  carModel.setInterior(running && rig.mode === 'cockpit' && !window.__touge?.debugCam);
  if (vehicle.trans.gear !== lastGear) {
    if (lastGear !== null) carModel.cockpit.shift();
    lastGear = vehicle.trans.gear;
  }
  carModel.cockpit.update(dt, vehicle, controls.handbrake);
  rig.headSway = tune.seats === 'bucket' ? 0.1 : 1;
  audio.setInterior?.(running && rig.mode === 'cockpit');
  $('start').classList.toggle('hidden', vehicle.engine.running);
  $('clutch').style.setProperty('--engaged', `${Math.round((1 - vehicle.trans.coupling) * 100)}%`);

  // The tuning shop has the screen: draw the garage and the turntable instead of the road.
  if (shop.isOpen) {
    shop.update(dt);
    vhs.render(shop.scene, shop.camera, now / 1000);
    flare.draw(dt, camera, sunDir, 0, [0, 0, 0], false);
    hud.draw(null);
    return;
  }

  // Interpolate the car between physics steps for smooth motion on any refresh rate.
  const alpha = active ? accumulator / DT : 1;
  carModel.root.position.lerpVectors(prevPos, curPos, alpha);
  carModel.root.quaternion.slerpQuaternions(prevQuat, curQuat, alpha);
  carModel.syncWheels(vehicle);
  carModel.setLights(timePreset.lights, controls.brake > 0);
  const nose = new THREE.Vector3(0, -0.05, 2.1).applyQuaternion(carModel.root.quaternion).add(carModel.root.position);
  headlight.position.copy(nose);
  headlight.target.position.copy(new THREE.Vector3(0, -1.6, 22).applyQuaternion(carModel.root.quaternion).add(carModel.root.position));
  if (window.__touge?.debugCam) window.__touge.debugCam(camera, carModel.root);
  else if (!running) titleCamera(dt);
  else rig.update(dt, carModel.root, vehicle.body.linvel());
  sky.update(camera);
  mountain.update(camera.position, timePreset.detailRange, timePreset.groundRange, dt);
  vhs.render(scene, camera, now / 1000);
  // Lens flare when facing the sun, unless the mountain is in the way.
  let sunVisible = false;
  if (timePreset.flare > 0) {
    const ray = new RAPIER.Ray(camera.position, sunDir);
    sunVisible = !world.castRay(ray, 900, true, undefined, undefined, undefined, vehicle.body) && !behindRange(camera.position);
  }
  flare.draw(dt, camera, sunDir, timePreset.flare, timePreset.flareTint, sunVisible);

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
          lapTime: run.time,
          bestTime: run.best,
          boost: tune.turbo && tune.turbo !== 'none' ? vehicle.engine.boost : null,
          drift: drift.display,
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
  $('loading').textContent = 'Building the mountain…';
  await new Promise((r) => setTimeout(r, 30));
  mountain = new Mountain(world, scene, settings.map);
  vehicle = new Vehicle(world, CAR, tune, settings.mode);
  vehicle.surfaceOf = mountain.layout.surfaceOf;
  // Guardrails are a cushion, not a wall: see physics/barrier.js.
  const railQ = {};
  barrier = new SoftBarrier((x, z, out) => {
    const r = mountain.road;
    r.query(x, z, run.hint, railQ);
    const side = railQ.lateral > 0 ? 1 : -1;
    if (!mountain.layout.rail[side][railQ.index]) return false;
    const pen = Math.abs(railQ.lateral) - (RAIL - 0.45);
    if (pen <= 0 || pen > 1.5) return false;
    out.pen = pen;
    out.nx = -side * Math.cos(railQ.heading);
    out.nz = side * Math.sin(railQ.heading);
    return true;
  });
  carModel = new CarModel(CAR);
  carModel.applySetup(tune);
  headlight.color.setHex((HEADLIGHTS[tune.headlights] || HEADLIGHTS.white)[1]);
  scene.add(carModel.root);
  sparks = new Sparks(scene);
  // Blob shadow rides under the car, at ground level in the car's own frame.
  shadow = blobShadow();
  shadow.position.y = -0.6;
  carModel.root.add(shadow);
  shifter = new Shifter($('shifter'), (gear) => vehicle.trans.requestGear(gear, vehicle.forwardSpeed));
  shifter.setMode(settings.shifter);
  tuning = new TuningPanel($('tuning'), tune, () => saveTuning(tune));
  tuning.toggle(false);
  resetCar();
  applySettings();
  renderChoices();
  $('loading').textContent = '';
  $('btn-drive').disabled = false;
  // Testing hook for automated browser checks.
  window.__touge = { get sparksDbg() { return sparks; }, drift, shop, audio, sunDir, flare, camera, RAPIER, applySettings: () => applySettings(), vehicle, world, settings, tune, input, shifter, resetCar, recoverCar, mountain, run, scene, carModel };
}

$('btn-drive').disabled = true;
renderChoices();
boot().catch((err) => {
  console.error(err);
  $('loading').textContent = `Could not start the physics engine: ${err.message}`;
});
requestAnimationFrame(frame);
