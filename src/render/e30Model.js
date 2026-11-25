// The detailed E30 body: "1986 BMW E30 (FL, LP)" by Krzysztof Stolorz (KrStolorz on Sketchfab),
// loaded once from public/models/e30.glb and cloned for every E30 on the road.
// The file is in metres, +x left, +y up, +z forward, with y = 0 on the ground: the same axes as the
// car's body group, so it only needs sliding along z to put its axles on the physics axles.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Sharp edges: where two faces meet at more than this angle the shading breaks into a hard
// crease; gentler curves (headlamps, wheels, the roof) stay smooth and round.
const CREASE = (22 * Math.PI) / 180;

const URL = `${import.meta.env?.BASE_URL ?? './'}models/e30.glb`;

// Node names lose spaces and dots on loading, so compare letters and digits only.
const norm = (s) => String(s).replace(/[^a-z0-9]/gi, '').toLowerCase();
function find(root, name) {
  const k = norm(name);
  let hit = null;
  root.traverse((o) => {
    if (!hit && norm(o.name) === k) hit = o;
  });
  return hit;
}
function boxOf(o) {
  return new THREE.Box3().setFromObject(o);
}

// Lambert instead of the file's PBR materials: matches the rest of the game and is cheap on phones.
function convert(m) {
  const name = m.name || '';
  if (name === 'Glass') {
    return new THREE.MeshPhongMaterial({ color: 0x1b2329, transparent: true, opacity: 0.5, shininess: 90, specular: 0x777777, depthWrite: false });
  }
  const out = new THREE.MeshLambertMaterial({ color: m.color, map: m.map || null, side: m.side });
  if (name === 'Lights_orange') out.emissive.setHex(0x2a0800);
  return out;
}

function prepare(gltf, frontAxle, rearAxle) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  // Wheel template: the rear-left wheel (not steered in the file), centred, axle along x, rim
  // facing +x like the game's own wheels.
  const src = find(scene, 'B_wheel.L_11');
  const tyre = new THREE.Object3D();
  const copy = src.clone(true);
  src.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
  tyre.add(copy);
  tyre.updateMatrixWorld(true);
  const wb = boxOf(tyre);
  const size = wb.getSize(new THREE.Vector3());
  copy.position.sub(wb.getCenter(new THREE.Vector3()));

  // Axles in the file, from the wheel centres, before the wheels come off the body.
  const zOf = (n) => boxOf(find(scene, n)).getCenter(new THREE.Vector3()).z;
  const front = (find(scene, 'Knuckle.L_32').getWorldPosition(new THREE.Vector3()).z + find(scene, 'Knuckle.R_37').getWorldPosition(new THREE.Vector3()).z) / 2;
  const rear = (zOf('B_wheel.L_12') + zOf('B_wheel.R_16')) / 2;
  for (const n of ['B_wheel.L_12', 'B_wheel.R_16', 'Knuckle.L_32', 'Knuckle.R_37']) find(scene, n)?.removeFromParent();

  const body = new THREE.Group();
  body.add(scene);
  scene.position.z += (frontAxle + rearAxle) / 2 - (front + rear) / 2;
  body.updateMatrixWorld(true);

  // Materials: paint, headlamps and tail lamps are swapped per car for the game's own (so the
  // shop colours and the brake lights work); the rest are shared.
  const cache = new Map();
  const shared = (m) => {
    if (!cache.has(m)) cache.set(m, convert(m));
    return cache.get(m);
  };
  let backPlate = null;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.shared = true; // geometry belongs to the template: never dispose it
    const name = o.material?.name;
    o.userData.role = name === 'Paint' ? 'paint' : name === 'Lights_white' ? 'head' : name === 'Lights_red' ? 'tail' : null;
    // The game draws its own licence plate (text from the shop), so hide the file's back plate.
    if (name === 'Plate' && norm(o.parent?.name).startsWith('regplateback')) {
      backPlate = boxOf(o);
      o.visible = false;
    }
    o.material = shared(o.material);
    o.geometry = toCreasedNormals(o.geometry, CREASE);
  });
  tyre.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.shared = true;
    o.geometry = toCreasedNormals(o.geometry, CREASE);
    o.material = shared(o.material);
  });

  const bb = boxOf(body);
  // Body sides at door height (the mirrors stick out further).
  const sides = boxOf(find(scene, 'Body (New)_39'));
  return {
    body,
    tyre,
    tyreRadius: size.y / 2,
    tyreWidth: size.x,
    nose: bb.max.z,
    tail: bb.min.z,
    halfWidth: (sides.max.x - sides.min.x) / 2,
    plate: backPlate
      ? { x: (backPlate.min.x + backPlate.max.x) / 2, y: (backPlate.min.y + backPlate.max.y) / 2, z: backPlate.min.z - 0.004 }
      : null,
  };
}

let loading = null;
// The template, or null if the file cannot be loaded (the car then keeps its built-in body).
export function loadE30(frontAxle, rearAxle) {
  if (typeof document === 'undefined') return Promise.resolve(null);
  loading ??= new GLTFLoader()
    .loadAsync(URL)
    .then((g) => prepare(g, frontAxle, rearAxle))
    .catch((e) => {
      console.warn('[e30] model not loaded, using the built-in body', e);
      return null;
    });
  return loading;
}

// One wheel from the template, sized to the tyre the physics uses.
export function makeE30Wheel(t, ws) {
  const g = new THREE.Group();
  const w = t.tyre.clone(true);
  const s = ws.radius / t.tyreRadius;
  w.scale.set(ws.width / 1000 / t.tyreWidth, s, s);
  g.add(w);
  return g;
}
