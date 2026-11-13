// Tyre smoke: soft puffs from any tyre that is sliding or spinning hard. Puffs start small and
// dense at the contact patch, then swell, drift with the wind and fade.
import * as THREE from 'three';

const MAX = 180;

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class TyreSmoke {
  constructor(scene) {
    const mat = new THREE.SpriteMaterial({ map: puffTexture(), transparent: true, depthWrite: false, color: 0xe8e8ea });
    this.puffs = [];
    for (let i = 0; i < MAX; i++) {
      const s = new THREE.Sprite(mat.clone());
      s.visible = false;
      s.renderOrder = 5;
      scene.add(s);
      this.puffs.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), size: 1 });
    }
    this.next = 0;
    this.carry = [0, 0, 0, 0]; // fractional puffs owed per wheel
    this.tint = new THREE.Color(0xe8e8ea);
  }

  // Smoke reads lighter by day, warm at sunset, dim blue-grey at night.
  setTint(hex) {
    this.tint.setHex(hex);
  }

  #emit(x, y, z, strength, carVel) {
    const p = this.puffs[this.next];
    this.next = (this.next + 1) % MAX;
    p.life = p.max = 1.2 + Math.random() * 1.3 * strength;
    p.size = 0.6 + Math.random() * 0.4;
    p.vel.set(carVel.x * 0.15 + (Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.6, carVel.z * 0.15 + (Math.random() - 0.5) * 1.2);
    p.s.position.set(x, y + 0.25, z);
    p.s.material.color.copy(this.tint);
    p.strength = strength;
    p.s.visible = true;
  }

  // vehicle: the simulation. Wheels that slide or spin produce puffs in proportion.
  update(dt, vehicle) {
    const v = vehicle.body.linvel();
    vehicle.wheels.forEach((w, k) => {
      if (!w.grounded || !w.contact || w.surface === 'grass') return;
      const lat = Math.max(0, Math.abs(Math.tan(w.slipAngle)) - 0.25);
      const spin = Math.max(0, Math.abs(w.slipRatio) - 0.3);
      const slipSpeed = Math.abs(w.omega * 0.3 - w.vx) + Math.abs(w.vy);
      const amount = Math.min(1.5, (lat * 3 + spin * 1.5) * Math.min(1, slipSpeed / 6));
      if (amount < 0.05) return;
      this.carry[k] += amount * dt * 22;
      while (this.carry[k] >= 1) {
        this.carry[k] -= 1;
        this.#emit(w.contact[0], w.contact[1], w.contact[2], Math.min(1, amount), v);
      }
    });
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        continue;
      }
      const age = 1 - p.life / p.max;
      p.vel.multiplyScalar(1 - dt * 0.8);
      p.s.position.addScaledVector(p.vel, dt);
      const size = p.size * (1 + age * 5);
      p.s.scale.set(size, size, 1);
      p.s.material.opacity = 0.55 * p.strength * (1 - age) * Math.min(1, age * 8 + 0.2);
    }
  }
}
