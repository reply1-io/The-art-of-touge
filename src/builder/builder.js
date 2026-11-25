// The Car Builder: put shapes together into a car body around the wheels, then save it to your
// garage and drive it. Works by touch: tap a shape to pick it, then drag it to move it, drag its
// handles to size it, or drag its corners to reshape it (the E30 and RX-7 bodies too).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CARS } from '../config.js';
import { CarModel } from '../render/carModel.js';
import { copies, MATS, starterParts, STOCK_NAMES, partMesh, triLook, baseMesh, localCorners, partMatrix } from '../render/shapes/custom.js';
import { loadDesigns, saveDesign, deleteDesign, newId } from './customStore.js';

const $ = (id) => document.getElementById(id);
const DRAFT = 'touge.builderDraft.v1';
// Opened as a page in the chat (not inside the game): ADD TO GAME hands over the car's code to
// paste to Claude, who builds it into the game.
const STANDALONE = document.body.dataset.mode === 'artifact';
const SETTINGS = 'touge.settings.v4';

// ---------- The design being worked on ----------
// A new car: the plain starter body, or the game's E30 or RX-7 to build onto.
function blank(start = 'e30') {
  const parts = start === 'plain' ? starterParts() : [stockPart(start)];
  const paint = start === 'rx7' ? '#c8241d' : '#efeee6';
  return { id: newId(), name: start === 'plain' ? 'My car' : `My ${start === 'rx7' ? 'RX-7' : 'E30'}`, base: start === 'rx7' ? 'rx7' : 'e30', paint, parts };
}
function stockPart(model) {
  return { type: 'stock', model, p: [0, 0, 0], s: [1, 1, 1], r: [0, 0, 0], mat: 'paint' };
}
let design;
try {
  design = JSON.parse(localStorage.getItem(DRAFT)) || blank();
} catch {
  design = blank();
}
let selected = -1;
let mode = 'move';
const steps = { move: 0.05, size: 0.05, turn: 5 };
const undoStack = [];

function remember() {
  undoStack.push(JSON.stringify(design));
  if (undoStack.length > 80) undoStack.shift();
}
function saveDraft() {
  try {
    localStorage.setItem(DRAFT, JSON.stringify(design));
  } catch {
    // The draft just isn't kept between visits.
  }
}

// ---------- Scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1e25);
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
camera.position.set(4.6, 2.4, 5.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.6, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.52;
controls.minDistance = 1.2;
controls.maxDistance = 14;
scene.add(new THREE.HemisphereLight(0xdde6ff, 0x3a3328, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(4, 7, 3);
scene.add(sun);
const grid = new THREE.GridHelper(10, 20, 0x4a5260, 0x2a3038);
scene.add(grid);
// An arrow on the ground pointing to the front of the car.
const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 3).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe8a33a }));
arrow.position.set(0, 0.01, 3.1);
scene.add(arrow);

const partsGroup = new THREE.Group();
scene.add(partsGroup);
const wheelGroup = new THREE.Group();
scene.add(wheelGroup);
let ghost = null;
let ghostOn = false;

const paintMat = new THREE.MeshPhongMaterial({ color: design.paint, flatShading: true, shininess: 70, specular: 0x555555 });
const glassMat = new THREE.MeshLambertMaterial({ color: 0x29323d, transparent: true, opacity: 0.85, flatShading: true });
const headMat = new THREE.MeshLambertMaterial({ color: 0xe8ecf0, emissive: 0x666666, flatShading: true });
const tailMat = new THREE.MeshLambertMaterial({ color: 0xd0141c, emissive: 0x400000, flatShading: true });
const solidMats = new Map();
function matFor(part) {
  if (part.mat === 'paint') return paintMat;
  if (part.mat === 'glass') return glassMat;
  if (part.mat === 'head') return headMat;
  if (part.mat === 'tail') return tailMat;
  const c = part.mat === 'color' ? part.color || '#888888' : '#' + new THREE.Color(...MATS[part.mat]).getHexString();
  if (!solidMats.has(c)) solidMats.set(c, new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
  return solidMats.get(c);
}

// Each part's meshes (itself and its mirror copy), rebuilt when it changes.
let meshes = [];
const selBox = new THREE.Box3Helper(new THREE.Box3(), 0xffd23f);
scene.add(selBox);
// The shapes sit a hair behind the handles and corner dots drawn on them.
for (const m of [paintMat, glassMat, headMat, tailMat]) Object.assign(m, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const trimMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const BUCKET_MAT = { paint: paintMat, glass: glassMat, head: headMat, tail: tailMat, trim: trimMat };

// A part's meshes: one per kind of surface (paint, trim, glass, lamps), for itself and its copy.
function partMeshes(part, i) {
  const list = [];
  for (const mirrored of copies(part)) {
    const { verts, faces, meta } = partMesh(part, mirrored);
    const by = {};
    faces.forEach((f, k) => {
      const look = triLook(part, meta[k]);
      const b = (by[look.bucket] ??= { pos: [], col: [] });
      for (const v of f) {
        b.pos.push(...verts[v]);
        b.col.push(...look.color);
      }
    });
    for (const [bucket, { pos, col }] of Object.entries(by)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, BUCKET_MAT[bucket]);
      m.userData = { part: i, mirrored };
      partsGroup.add(m);
      list.push(m);
    }
  }
  return list;
}

// light: only the shapes change (a drag), so the panel and its buttons stay as they are.
function rebuild(light = false) {
  for (const m of partsGroup.children) m.geometry.dispose();
  partsGroup.clear();
  meshes = design.parts.map((part, i) => partMeshes(part, i));
  paintMat.color.set(design.paint);
  showSelection(light);
  saveDraft();
}

function showSelection(light = false) {
  selBox.visible = selected >= 0 && !!meshes[selected] && mode !== 'shape';
  if (selected >= 0 && meshes[selected]) {
    selBox.box.makeEmpty();
    for (const m of meshes[selected]) {
      m.geometry.computeBoundingBox();
      selBox.box.union(m.geometry.boundingBox);
    }
  }
  $('panel').classList.toggle('open', selected >= 0);
  document.body.classList.toggle('editing', selected >= 0);
  $('hint').style.display = selected >= 0 ? 'none' : '';
  showHandles();
  if (selected >= 0 && !light) renderPanel();
}

// The wheels of the car it is built on, where the game will put them.
function buildWheels() {
  wheelGroup.clear();
  const spec = CARS[design.base] || CARS.e30;
  const tyre = new THREE.MeshLambertMaterial({ color: 0x18181a });
  const rim = new THREE.MeshLambertMaterial({ color: 0x9da2a8 });
  const r = spec.wheelRadius || 0.305;
  for (const z of [spec.frontAxleZ ?? 1.28, spec.rearAxleZ ?? -1.29]) {
    const track = (z > 0 ? spec.trackFront : spec.trackRear || spec.trackFront) || 1.41;
    for (const side of [1, -1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.2, 18).rotateZ(Math.PI / 2), tyre);
      w.position.set((side * track) / 2, r, z);
      const face = new THREE.Mesh(new THREE.CircleGeometry(r * 0.6, 14).rotateY((side * Math.PI) / 2), rim);
      face.position.set((side * track) / 2 + side * 0.101, r, z);
      wheelGroup.add(w, face);
    }
  }
  if (ghostOn) makeGhost();
}

// The car it is built on, see-through, to build around.
function makeGhost() {
  if (ghost) scene.remove(ghost);
  ghost = null;
  if (!ghostOn) return;
  const spec = CARS[design.base] || CARS.e30;
  const model = new CarModel(spec, spec.shape);
  ghost = model.body;
  model.cockpit.root.visible = false;
  ghost.removeFromParent();
  ghost.position.set(0, 0, 0);
  ghost.traverse((o) => {
    if (!o.isMesh) return;
    o.material = new THREE.MeshBasicMaterial({ color: 0x7fb8ff, transparent: true, opacity: 0.14, depthWrite: false, wireframe: false });
    o.raycast = () => {};
  });
  scene.add(ghost);
}

// ---------- Editing panel ----------
const AXES = {
  move: [['SIDE', 0], ['UP', 1], ['FORWARD', 2]],
  size: [['WIDTH', 0], ['HEIGHT', 1], ['LENGTH', 2]],
  turn: [['TILT ↕', 0], ['TURN ↔', 1], ['LEAN', 2]],
};
const STEP_CHOICES = { move: [0.01, 0.05, 0.2], size: [0.01, 0.05, 0.2], turn: [1, 5, 15] };
const MAT_NAMES = { paint: 'PAINT', trim: 'TRIM', black: 'BLACK', chrome: 'CHROME', glass: 'GLASS', head: 'HEADLIGHT', tail: 'TAILLIGHT', color: 'COLOUR' };

function key() {
  return mode === 'move' ? 'p' : mode === 'size' ? 's' : 'r';
}
// A stock body is sized as a share of its real size (100%); everything else in centimetres.
const isStock = () => design.parts[selected]?.type === 'stock';
function fmt(v) {
  if (mode === 'size' && isStock()) return `${Math.round(v * 100)}%`;
  return mode === 'turn' ? `${Math.round(v)}°` : `${(v * 100).toFixed(0)} cm`;
}

function renderPanel() {
  const part = design.parts[selected];
  for (const b of document.querySelectorAll('#modes [data-mode]')) b.classList.toggle('on', b.dataset.mode === mode);
  const styling = mode === 'style';
  const shaping = mode === 'shape';
  $('style').style.display = styling ? '' : 'none';
  $('shape').style.display = shaping ? '' : 'none';
  $('axes').style.display = mode === 'turn' ? '' : 'none';
  $('steps').style.display = mode === 'turn' ? '' : 'none';
  $('drag-hint').style.display = mode === 'move' || mode === 'size' || shaping ? '' : 'none';
  $('drag-hint').textContent = {
    move: 'Drag the shape to move it. Spin the view to drag it another way (side view: up and along, top view: across).',
    size: 'Drag the orange handles to stretch or shrink each side.',
    shape: 'Drag any yellow dot to reshape. SOFT pulls the dots around it too; MIRROR does the other side the same.',
  }[mode] || '';
  if (shaping) {
    $('b-sym').classList.toggle('on', shapeOpts.sym);
    for (const b of document.querySelectorAll('[data-soft]')) b.classList.toggle('on', +b.dataset.soft === shapeOpts.soft);
    $('detail-row').style.display = part.type === 'stock' ? 'none' : '';
    for (const b of document.querySelectorAll('[data-detail]')) b.classList.toggle('on', +b.dataset.detail === (part.d ?? 2));
    return;
  }
  if (mode !== 'turn' && !styling) return;
  if (styling) {
    const mats = $('mats');
    mats.innerHTML = '';
    if (part.type === 'stock') {
      // The stock body keeps its own trim, glass and lamps; its paint is the car's colour.
      mats.innerHTML = '<span class="lbl">The body is painted the car colour (the swatch at the top). Add shapes to change it.</span>';
      $('pcolor').style.display = 'none';
      $('b-mirror').style.display = 'none';
      $('taper').style.display = $('taper-lbl').style.display = 'none';
      return;
    }
    $('b-mirror').style.display = '';
    for (const [m, label] of Object.entries(MAT_NAMES)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.className = part.mat === m ? 'on' : '';
      b.onclick = () => {
        remember();
        part.mat = m;
        rebuild();
      };
      mats.append(b);
    }
    $('pcolor').value = part.color || '#888888';
    $('pcolor').style.display = part.mat === 'color' ? '' : 'none';
    $('b-mirror').classList.toggle('on', !!part.mirror);
    $('taper').style.display = $('taper-lbl').style.display = part.type === 'taper' ? '' : 'none';
    $('taper').value = part.t ?? 0.65;
    return;
  }
  const axes = $('axes');
  axes.innerHTML = '';
  valEls = [];
  for (const [label, k] of AXES[mode]) {
    const row = document.createElement('div');
    row.className = 'axis';
    row.innerHTML = `<span class="lbl">${label}</span><button type="button">−</button><span class="val">${fmt(part[key()][k])}</span><button type="button">+</button>`;
    const [minus, plus] = row.querySelectorAll('button');
    valEls[k] = row.querySelector('.val');
    holdRepeat(minus, () => nudge(k, -1));
    holdRepeat(plus, () => nudge(k, 1));
    axes.append(row);
  }
  const st = $('steps');
  st.innerHTML = '<span class="lbl">STEP</span>';
  for (const v of STEP_CHOICES[mode]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = mode === 'turn' ? `${v}°` : `${Math.round(v * 100)} cm`;
    b.className = steps[mode] === v ? 'on' : '';
    b.onclick = () => {
      steps[mode] = v;
      renderPanel();
    };
    st.append(b);
  }
}

function nudge(k, dir) {
  const part = design.parts[selected];
  const arr = part[key()];
  let v = arr[k] + dir * (mode === 'size' && isStock() ? 0.01 : steps[mode]);
  if (mode === 'size') v = Math.max(isStock() ? 0.5 : 0.01, isStock() ? Math.min(1.5, v) : v);
  if (mode === 'move' && k === 1) v = Math.max(-0.2, v);
  if (mode === 'turn') v = ((((v + 180) % 360) + 360) % 360) - 180;
  arr[k] = Math.round(v * 1000) / 1000;
  rebuild(true);
  if (valEls[k]) valEls[k].textContent = fmt(arr[k]);
}
let valEls = [];

// Press and hold a button to keep going (after a short pause), like a keyboard key.
function holdRepeat(btn, fn) {
  let timer = null;
  const stop = () => {
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    remember();
    fn();
    timer = setTimeout(() => (timer = setInterval(fn, 70)), 380);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
  window.addEventListener('pointerup', stop);
}

for (const b of document.querySelectorAll('#modes [data-mode]')) {
  b.onclick = () => {
    mode = b.dataset.mode;
    showSelection();
  };
}
$('b-done').onclick = () => {
  selected = -1;
  showSelection();
};
$('b-del').onclick = () => {
  remember();
  design.parts.splice(selected, 1);
  selected = -1;
  rebuild();
};
$('b-dup').onclick = () => {
  remember();
  const copy = JSON.parse(JSON.stringify(design.parts[selected]));
  copy.p[1] += 0.1;
  design.parts.push(copy);
  selected = design.parts.length - 1;
  rebuild();
  toast('Copied: the copy is just above the original');
};
$('b-mirror').onclick = () => {
  remember();
  const part = design.parts[selected];
  part.mirror = !part.mirror;
  if (part.mirror && Math.abs(part.p[0]) < 0.02) toast('Move it to one side (SIDE) to see the mirror copy');
  rebuild();
};
$('pcolor').oninput = (e) => {
  const part = design.parts[selected];
  part.color = e.target.value;
  rebuild(true);
};
$('pcolor').onchange = () => remember();
$('taper').oninput = (e) => {
  design.parts[selected].t = +e.target.value;
  rebuild(true);
};

// ---------- Adding shapes ----------
const NEW = {
  box: { s: [0.6, 0.3, 0.8] },
  wedge: { s: [1.4, 0.4, 0.8] },
  taper: { s: [1.4, 0.5, 2], t: 0.65 },
  cyl: { s: [0.3, 0.3, 0.3] },
  ball: { s: [0.3, 0.3, 0.3] },
};
for (const b of document.querySelectorAll('[data-add]')) {
  b.onclick = () => {
    remember();
    const type = b.dataset.add;
    if (type === 'e30' || type === 'rx7') {
      // The whole body, where the game puts it, on that car's wheels.
      design.parts.push(stockPart(type));
      design.base = type;
      selected = design.parts.length - 1;
      mode = 'move';
      syncTop();
      buildWheels();
      rebuild();
      toast(`${STOCK_NAMES[type]} added: build onto it, or tap it to move or size it`);
      return;
    }
    design.parts.push({ type, p: [0, 1.5, 0], s: [...NEW[type].s], r: [0, 0, 0], mat: 'paint', ...(NEW[type].t ? { t: NEW[type].t } : {}) });
    selected = design.parts.length - 1;
    mode = 'move';
    rebuild();
    toast('New shape above the car: move it into place');
  };
}

// ---------- Handles: orange size handles, yellow corner dots ----------
const handles = new THREE.Group();
handles.renderOrder = 10;
scene.add(handles);
const handleMat = new THREE.MeshBasicMaterial({ color: 0xff8a1f, depthTest: false, transparent: true });
const handleGeo = new THREE.BoxGeometry(1, 1, 1);
const dotMat = new THREE.PointsMaterial({ color: 0xffd23f, size: 6, sizeAttenuation: false });
const activeDot = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3b30, depthTest: false }));
activeDot.renderOrder = 11;
activeDot.visible = false;
scene.add(activeDot);
let dots = null;
const shapeOpts = { sym: true, soft: 0.1 };

// The part's own box: its corners' extent in its own space.
function localBox(part) {
  const b = new THREE.Box3();
  for (const c of localCorners(part)) b.expandByPoint(new THREE.Vector3(...c));
  return b;
}

function showHandles() {
  handles.clear();
  dots = null;
  if (selected < 0) return;
  const part = design.parts[selected];
  const m = partMatrix(part);
  const camDist = camera.position.distanceTo(controls.target);
  if (mode === 'size') {
    const b = localBox(part);
    const c = b.getCenter(new THREE.Vector3());
    for (let a = 0; a < 3; a++) {
      for (const sign of [1, -1]) {
        const local = c.clone();
        local.setComponent(a, sign > 0 ? b.max.getComponent(a) : b.min.getComponent(a));
        const h = new THREE.Mesh(handleGeo, handleMat);
        h.position.copy(local.clone().applyMatrix4(m));
        h.scale.setScalar(camDist * 0.014);
        h.userData = { axis: a, sign, local };
        h.renderOrder = 10;
        handles.add(h);
      }
    }
  }
  if (mode === 'shape') {
    const { verts, faces, meta } = partMesh(part);
    // A stock body: dots on its panels and glass only (the trim lines, badges and lamps on them
    // follow with SOFT), so they don't bury the car.
    let ids = verts.map((_, i) => i);
    if (part.type === 'stock') {
      const keep = new Set();
      faces.forEach((f, k) => (meta[k].bucket === 'paint' || meta[k].bucket === 'glass') && f.forEach((v) => keep.add(v)));
      // And one dot per 9 cm patch of it: drag one with SOFT on to move the patch around it.
      const cells = new Set();
      ids = [...keep].filter((i) => {
        const c = verts[i].map((x) => Math.round(x / 0.09)).join(',');
        if (cells.has(c)) return false;
        cells.add(c);
        return true;
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(ids.flatMap((i) => verts[i]), 3));
    dots = new THREE.Points(g, dotMat);
    dots.userData.ids = ids;
    handles.add(dots);
  }
}

// ---------- Dragging: shapes, size handles and corners ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function aim(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray;
}
// Where the pointer is on a flat sheet facing the camera through `point`.
function onSheet(plane, out = new THREE.Vector3()) {
  return ray.ray.intersectPlane(plane, out);
}
// How far along a line (through o, along d) the pointer is.
function alongLine(o, d) {
  const u = ray.ray.direction;
  const w0 = new THREE.Vector3().subVectors(o, ray.ray.origin);
  const b = d.dot(u);
  const den = 1 - b * b;
  if (Math.abs(den) < 1e-4) return null;
  return (b * u.dot(w0) - d.dot(w0)) / den;
}

let drag = null;
function startDrag(e) {
  if (selected < 0 || e.target !== renderer.domElement || !e.isPrimary) return false;
  aim(e);
  const part = design.parts[selected];
  const camDir = camera.getWorldDirection(new THREE.Vector3());
  if (mode === 'size') {
    const hit = ray.intersectObjects(handles.children)[0];
    if (!hit) return false;
    const h = hit.object;
    const m = partMatrix(part);
    const dir = new THREE.Vector3().setComponent(h.userData.axis, h.userData.sign).transformDirection(m);
    const box = localBox(part);
    const opp = h.userData.local.clone();
    opp.setComponent(h.userData.axis, h.userData.sign > 0 ? box.min.getComponent(h.userData.axis) : box.max.getComponent(h.userData.axis));
    drag = { kind: 'size', axis: h.userData.axis, o: h.position.clone(), dir, t0: alongLine(h.position, dir) ?? 0, s0: [...part.s], p0: [...part.p], ext: box.max.getComponent(h.userData.axis) - box.min.getComponent(h.userData.axis), opp };
  } else if (mode === 'shape') {
    if (!dots) return false;
    const dist = camera.position.distanceTo(controls.target);
    ray.params.Points.threshold = dist * 0.03;
    const hits = ray.intersectObject(dots);
    if (!hits.length) return false;
    // The dot nearest the pointer, among those not hidden behind the body.
    const surface = ray.intersectObjects(meshes[selected])[0];
    const front = hits.filter((h) => !surface || h.distance < surface.distance + 0.04);
    const hit = (front.length ? front : hits).sort((a, b) => a.distanceToRay - b.distanceToRay)[0];
    const world = new THREE.Vector3().fromBufferAttribute(dots.geometry.getAttribute('position'), hit.index);
    const i = dots.userData.ids[hit.index];
    const m = partMatrix(part);
    drag = {
      kind: 'corner',
      i,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, world),
      start: onSheet(new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, world)) || world.clone(),
      toLocal: new THREE.Matrix3().setFromMatrix4(m).invert(),
      corners0: localCorners(part),
      world0: partMesh(part).verts,
      edits0: JSON.parse(JSON.stringify(part.edits || {})),
      mirror: baseMesh(part).mirror,
    };
    activeDot.position.copy(world);
    activeDot.scale.setScalar(dist * 0.012);
    activeDot.visible = true;
  } else if (mode === 'move') {
    const hit = ray.intersectObjects(meshes[selected])[0];
    if (!hit) return false;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, hit.point);
    drag = { kind: 'move', plane, start: hit.point.clone(), p0: [...part.p], flip: hit.object.userData.mirrored ? -1 : 1 };
  } else return false;
  remember();
  return true;
}

function moveDrag(e) {
  aim(e);
  const part = design.parts[selected];
  const mm = (v) => Math.round(v * 1000) / 1000;
  if (drag.kind === 'move') {
    const p = onSheet(drag.plane);
    if (!p) return;
    const d = p.sub(drag.start);
    part.p = [mm(drag.p0[0] + d.x * drag.flip), mm(Math.max(-0.2, drag.p0[1] + d.y)), mm(drag.p0[2] + d.z)];
  } else if (drag.kind === 'size') {
    const t = alongLine(drag.o, drag.dir);
    if (t == null) return;
    const grow = t - drag.t0;
    const a = drag.axis;
    const min = part.type === 'stock' ? 0.5 : 0.01 / Math.max(1e-6, drag.ext);
    const max = part.type === 'stock' ? 1.6 : Infinity;
    part.s = [...drag.s0];
    part.s[a] = Math.min(max, Math.max(min, (drag.ext * drag.s0[a] + grow) / drag.ext));
    part.s[a] = Math.round(part.s[a] * 1000) / 1000;
    // Keep the opposite side where it was.
    part.p = [...drag.p0];
    const before = drag.opp.clone().applyMatrix4(partMatrix({ ...part, s: drag.s0 }));
    const after = drag.opp.clone().applyMatrix4(partMatrix(part));
    part.p = [mm(drag.p0[0] + before.x - after.x), mm(drag.p0[1] + before.y - after.y), mm(drag.p0[2] + before.z - after.z)];
  } else if (drag.kind === 'corner') {
    const p = onSheet(drag.plane);
    if (!p) return;
    const dw = p.sub(drag.start);
    const dl = dw.clone().applyMatrix3(drag.toLocal);
    const edits = JSON.parse(JSON.stringify(drag.edits0));
    const R = shapeOpts.soft;
    const c0 = drag.world0[drag.i];
    const push = (j, w, mirrored) => {
      const e = edits[j] || [0, 0, 0];
      const dx = mirrored ? -dl.x : dl.x;
      // A corner on the centreline stays on it when both sides move together.
      const onMiddle = shapeOpts.sym && drag.mirror[j] === j;
      edits[j] = [e[0] + (onMiddle ? 0 : dx * w), e[1] + dl.y * w, e[2] + dl.z * w].map((v) => Math.round(v * 10000) / 10000);
    };
    const done = new Set();
    drag.world0.forEach((v, j) => {
      const d = Math.hypot(v[0] - c0[0], v[1] - c0[1], v[2] - c0[2]);
      // The dot you hold moves all the way; with SOFT, the ones around it less the further off.
      const w = j === drag.i ? 1 : R > 0 && d < R ? (1 - (d / R) ** 2) ** 2 : 0;
      if (w <= 0) return;
      push(j, w, false);
      done.add(j);
      const mj = drag.mirror[j];
      if (shapeOpts.sym && mj >= 0 && mj !== j && !done.has(mj)) {
        push(mj, w, true);
        done.add(mj);
      }
    });
    for (const [k, e] of Object.entries(edits)) if (!e[0] && !e[1] && !e[2]) delete edits[k];
    part.edits = edits;
    activeDot.position.fromArray(partMesh(part).verts[drag.i]);
  }
  rebuild(true);
}

// Grab before the view controls do, so dragging a shape doesn't also spin the view.
document.addEventListener(
  'pointerdown',
  (e) => {
    if (drag || !startDrag(e)) return;
    e.stopPropagation();
    e.preventDefault();
    controls.enabled = false;
  },
  true,
);
window.addEventListener('pointermove', (e) => drag && e.isPrimary && moveDrag(e));
const endDrag = () => {
  if (!drag) return;
  drag = null;
  controls.enabled = true;
  activeDot.visible = false;
  showHandles();
};
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
// Handles stay the same size on screen as you zoom.
controls.addEventListener('change', () => {
  if (mode === 'size' && !drag) showHandles();
});

// ---------- Picking a shape by tapping it ----------
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) return;
  aim(e);
  const hit = ray.intersectObjects(partsGroup.children)[0];
  // In SHAPE mode a tap that misses the shape keeps it picked (it is easy to miss a dot).
  if (!hit && mode === 'shape' && selected >= 0) return;
  selected = hit ? hit.object.userData.part : -1;
  showSelection();
});

// ---------- Shape options ----------
$('b-sym').onclick = () => {
  shapeOpts.sym = !shapeOpts.sym;
  renderPanel();
};
for (const b of document.querySelectorAll('[data-soft]'))
  b.onclick = () => {
    shapeOpts.soft = +b.dataset.soft;
    renderPanel();
  };
for (const b of document.querySelectorAll('[data-detail]'))
  b.onclick = () => {
    const part = design.parts[selected];
    if ((part.d ?? 2) === +b.dataset.detail) return;
    remember();
    part.d = +b.dataset.detail;
    // A new set of corners: the old reshaping doesn't fit them.
    if (part.edits) {
      delete part.edits;
      toast('More/fewer corners: its reshaping was reset (UNDO brings it back)');
    }
    rebuild();
  };
$('b-reset-shape').onclick = () => {
  const part = design.parts[selected];
  if (!part.edits) return toast('Nothing to reset');
  remember();
  delete part.edits;
  rebuild();
  toast('Back to its plain shape');
};

// ---------- Top bar ----------
function syncTop() {
  $('name').value = design.name;
  $('base').value = design.base;
  $('paint').value = design.paint;
}
$('name').oninput = (e) => {
  design.name = e.target.value;
  saveDraft();
};
$('base').onchange = (e) => {
  design.base = e.target.value;
  buildWheels();
  saveDraft();
};
$('paint').oninput = (e) => {
  design.paint = e.target.value;
  paintMat.color.set(design.paint);
  saveDraft();
};
$('b-undo').onclick = () => {
  if (!undoStack.length) return toast('Nothing to undo');
  design = JSON.parse(undoStack.pop());
  if (selected >= design.parts.length) selected = -1;
  syncTop();
  buildWheels();
  rebuild();
};
$('b-ghost').onclick = () => {
  ghostOn = !ghostOn;
  $('b-ghost').classList.toggle('on', ghostOn);
  makeGhost();
};
$('b-wheels').onclick = () => {
  wheelGroup.visible = !wheelGroup.visible;
  $('b-wheels').classList.toggle('on', wheelGroup.visible);
};
// Quick views: three-quarter, side, front, back, top.
const VIEWS = [
  [4.6, 2.4, 5.2],
  [6.5, 0.9, 0],
  [0, 1, 6.5],
  [0, 1.2, -6.5],
  [0.01, 7, 0],
];
let view = 0;
$('b-view').onclick = () => {
  view = (view + 1) % VIEWS.length;
  controls.target.set(0, 0.6, 0);
  camera.position.set(...VIEWS[view]).sub(controls.target).setLength(fitDist()).add(controls.target);
};

function store() {
  if (!design.name.trim()) design.name = 'My car';
  if (!design.parts.length) {
    toast('Add some shapes first');
    return false;
  }
  if (!saveDesign(JSON.parse(JSON.stringify(design)))) {
    toast('Could not save: storage is full or blocked');
    return false;
  }
  return true;
}
$('b-save').onclick = () => store() && toast(`Saved "${design.name}" to your garage`);
$('b-drive').onclick = () => {
  if (!store()) return;
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS)) || {};
    s.car = design.id;
    localStorage.setItem(SETTINGS, JSON.stringify(s));
  } catch {
    // Pick it in the garage instead.
  }
  location.href = './index.html';
};
$('b-back').onclick = () => (location.href = './index.html');

if (STANDALONE) {
  $('b-back').style.display = 'none';
  $('b-drive').textContent = 'ADD TO GAME';
  $('b-drive').onclick = () => {
    if (!store()) return;
    const code = JSON.stringify(design);
    modal(`<div class="row"><strong style="flex:1">ADD "${''}" TO THE GAME</strong></div>
      <p>Tap COPY, then paste it into the chat with Claude. Claude builds it into Art of Touge for good, in your garage on every device.</p>
      <textarea id="m-code" readonly></textarea>
      <div class="row"><button type="button" id="m-copy" class="go">COPY</button><button type="button" id="m-close">CLOSE</button></div>`);
    $('modal-box').querySelector('strong').textContent = `ADD "${design.name}" TO THE GAME`;
    $('m-code').value = code;
    $('m-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(code);
        toast('Copied: now paste it in the chat');
      } catch {
        $('m-code').focus();
        $('m-code').select();
        toast('Select all the text and copy it');
      }
    };
    $('m-close').onclick = () => $('modal').classList.remove('open');
  };
}

// ---------- My cars, and sharing a car as code ----------
function modal(html) {
  $('modal-box').innerHTML = html;
  $('modal').classList.add('open');
}
$('modal').onclick = (e) => e.target === $('modal') && $('modal').classList.remove('open');
$('b-cars').onclick = () => {
  const list = loadDesigns();
  modal(`<div class="row"><strong style="flex:1">MY CARS</strong><button type="button" id="m-new">NEW CAR</button></div>
    ${list.length ? '' : '<p class="lbl">Nothing saved yet. Tap SAVE to keep the car you are building.</p>'}
    ${list.map((d) => `<div class="car"><span></span><button type="button" data-open="${d.id}">OPEN</button><button type="button" data-del="${d.id}">DELETE</button></div>`).join('')}`);
  [...$('modal-box').querySelectorAll('.car span')].forEach((s, i) => (s.textContent = `${list[i].name} · ${list[i].parts.length} shapes`));
  $('m-new').onclick = () => {
    modal(`<div class="row"><strong style="flex:1">START A NEW CAR FROM</strong></div>
      <div class="row"><button type="button" data-start="plain">PLAIN BODY</button><button type="button" data-start="e30">THE E30</button><button type="button" data-start="rx7">THE RX-7</button></div>`);
    for (const s of $('modal-box').querySelectorAll('[data-start]'))
      s.onclick = () => {
        remember();
        design = blank(s.dataset.start);
        selected = -1;
        syncTop();
        buildWheels();
        rebuild();
        $('modal').classList.remove('open');
      };
  };
  for (const b of $('modal-box').querySelectorAll('[data-open]'))
    b.onclick = () => {
      remember();
      design = JSON.parse(JSON.stringify(list.find((d) => d.id === b.dataset.open)));
      selected = -1;
      syncTop();
      buildWheels();
      rebuild();
      $('modal').classList.remove('open');
    };
  for (const b of $('modal-box').querySelectorAll('[data-del]'))
    b.onclick = () => {
      const d = list.find((x) => x.id === b.dataset.del);
      if (b.dataset.sure !== '1') {
        b.dataset.sure = '1';
        b.textContent = 'SURE?';
        b.classList.add('go');
        return;
      }
      deleteDesign(d.id);
      $('b-cars').onclick();
    };
};
$('b-code').onclick = () => {
  const code = JSON.stringify(design);
  modal(`<div class="row"><strong style="flex:1">CAR CODE</strong></div>
    <p class="lbl">Copy this to keep the car or send it to someone (or to Claude, to build it into the game for good). Paste a code here and tap LOAD to open a car.</p>
    <textarea id="m-code"></textarea>
    <div class="row"><button type="button" id="m-copy">COPY</button><button type="button" id="m-load">LOAD</button><button type="button" id="m-close">CLOSE</button></div>`);
  $('m-code').value = code;
  $('m-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('m-code').value);
      toast('Copied');
    } catch {
      $('m-code').select();
      toast('Select all and copy');
    }
  };
  $('m-load').onclick = () => {
    try {
      const d = JSON.parse($('m-code').value);
      if (!Array.isArray(d.parts)) throw new Error('no parts');
      remember();
      design = { ...blank(), ...d, id: d.id && !loadDesigns().some((x) => x.id === d.id && x.name !== d.name) ? d.id : newId() };
      selected = -1;
      syncTop();
      buildWheels();
      rebuild();
      $('modal').classList.remove('open');
    } catch {
      toast('That is not a car code');
    }
  };
  $('m-close').onclick = () => $('modal').classList.remove('open');
};

let toastTimer = 0;
function toast(text) {
  $('toast').textContent = text;
  $('toast').style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').style.display = 'none'), 2200);
}

// ---------- Run ----------
// A phone held upright sees less of the car side to side: stand further back.
const fitDist = () => (camera.aspect < 1 ? 7.4 / Math.max(0.45, camera.aspect) : 7.4);
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  controls.maxDistance = Math.max(14, fitDist() * 1.6);
  const off = camera.position.clone().sub(controls.target);
  camera.position.copy(controls.target).add(off.setLength(fitDist()));
}
window.addEventListener('resize', resize);
resize();
syncTop();
buildWheels();
rebuild();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
// For testing: the design, picking a part, and where a roof corner is on screen.
window.__builder = {
  get design() {
    return design;
  },
  select: (i) => {
    selected = i;
    showSelection();
  },
  dotScreen: () => {
    if (!dots) return null;
    const { verts } = partMesh(design.parts[selected]);
    let best = 0;
    verts.forEach((v, i) => v[1] + v[0] * 0.3 > verts[best][1] + verts[best][0] * 0.3 && (best = i));
    const p = new THREE.Vector3(...verts[best]).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height];
  },
};
