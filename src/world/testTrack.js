// Phase 1 test track: a big flat asphalt pad with a painted skidpad, a slalom and knock-over cones.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

const PAD = 600; // metres per side

function asphaltTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#3b3e44';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 50 + Math.random() * 30;
    g.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // Grid lines every 10 m so speed and slides are easy to read.
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(PAD / 10, PAD / 10);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class TestTrack {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.cones = [];

    // Physics: one big static box as the ground, plus walls far out so you cannot leave the pad.
    world.createCollider(RAPIER.ColliderDesc.cuboid(PAD / 2, 0.5, PAD / 2).setTranslation(0, -0.5, 0).setFriction(1.0));
    for (const [x, z, hx, hz] of [
      [PAD / 2, 0, 1, PAD / 2],
      [-PAD / 2, 0, 1, PAD / 2],
      [0, PAD / 2, PAD / 2, 1],
      [0, -PAD / 2, PAD / 2, 1],
    ]) {
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 3, hz).setTranslation(x, 3, z));
    }

    // Visuals.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(PAD, PAD), new THREE.MeshLambertMaterial({ map: asphaltTexture() }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshLambertMaterial({ color: 0x2f4a2a }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -1.5; // well below the pad so the two never fight for depth
    scene.add(grass);

    const paint = new THREE.MeshBasicMaterial({ color: 0xe8e8e0 });
    // Skidpad: a 30 m radius circle ahead and to the left of the start.
    const ring = new THREE.Mesh(new THREE.RingGeometry(29.8, 30.2, 96), paint);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(-60, 0.01, 90);
    scene.add(ring);
    // Start line and a long straight lane.
    for (const x of [-4, 4]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 400), paint);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x, 0.01, 190);
      scene.add(line);
    }

    // Cones: a slalom down the lane, 18 m apart, and a ring around the skidpad.
    const spots = [];
    for (let i = 0; i < 10; i++) spots.push([i % 2 ? 1.6 : -1.6, 60 + i * 18]);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      spots.push([-60 + Math.cos(a) * 33, 90 + Math.sin(a) * 33]);
    }
    const coneGeo = new THREE.ConeGeometry(0.17, 0.5, 8);
    coneGeo.translate(0, 0.25, 0);
    const coneMat = new THREE.MeshLambertMaterial({ color: 0xff6a13, flatShading: true });
    for (const [x, z] of spots) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.25, z).setLinearDamping(0.4).setAngularDamping(0.6));
      world.createCollider(RAPIER.ColliderDesc.cone(0.25, 0.17).setMass(2).setFriction(0.8), body);
      const mesh = new THREE.Mesh(coneGeo, coneMat);
      scene.add(mesh);
      this.cones.push({ body, mesh, home: [x, z] });
    }
  }

  // Ray-friendly ground height (flat pad).
  heightAt() {
    return 0;
  }

  resetCones() {
    for (const c of this.cones) {
      c.body.setTranslation({ x: c.home[0], y: 0.25, z: c.home[1] }, true);
      c.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  sync() {
    for (const c of this.cones) {
      const p = c.body.translation();
      const q = c.body.rotation();
      // The cone collider is centred; the mesh origin is at its base.
      c.mesh.position.set(p.x, p.y, p.z);
      c.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      c.mesh.translateY(-0.25);
    }
  }
}
