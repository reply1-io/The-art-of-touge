import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/sim/track.js';
import { CarSim, TRANSMISSION } from '../src/sim/car.js';
import { CARS } from '../src/sim/specs.js';

const DT = 1 / 480;
const spec = CARS.kazamaMR;
const flat = new Track([{ len: 4000, turn: 0, grade: 0, hill: 1 }]);
const idle = { throttle: 0, brake: 0, clutch: 0, handbrake: 0, steer: 0 };

function rolling(track, speed, gear, transmission = TRANSMISSION.MANUAL) {
  const car = new CarSim(spec, track);
  car.transmission = transmission;
  car.steerAssist = false;
  car.vx = Math.sin(car.yaw) * speed;
  car.vz = Math.cos(car.yaw) * speed;
  car.gear = gear;
  for (const w of car.wheels) w.omega = speed / spec.wheelRadius;
  car.engineOmega = (speed / spec.wheelRadius) * spec.gears[gear - 1] * spec.finalDrive;
  car.coupling = 1;
  return car;
}

function simulate(car, seconds, inputAt) {
  for (let t = 0; t < seconds; t += DT) car.step(DT, inputAt(t));
}

test('stays still at rest and keeps idling', () => {
  const car = new CarSim(spec, flat);
  const x = car.x;
  const z = car.z;
  simulate(car, 5, () => idle);
  assert.ok(Math.hypot(car.x - x, car.z - z) < 0.01);
  assert.ok(car.rpm > 750 && car.rpm < 1100, `rpm ${car.rpm}`);
});

test('0-100 km/h in roughly the real car time (8-11 s)', () => {
  const car = new CarSim(spec, flat);
  car.transmission = TRANSMISSION.MANUAL;
  let t = 0;
  let lastShift = -1;
  while (car.speed * 3.6 < 100 && t < 20) {
    if (car.rpm > 7350 && t - lastShift > 0.5) {
      car.shift(1, 0);
      lastShift = t;
    }
    car.step(DT, { ...idle, throttle: 1 });
    t += DT;
  }
  assert.ok(t > 8 && t < 11, `0-100 took ${t.toFixed(2)} s`);
});

test('locked-wheel stop from 100 km/h within 40-60 m', () => {
  const car = rolling(flat, 100 / 3.6, 3);
  const z0 = car.z;
  simulate(car, 6, () => ({ ...idle, brake: 1, clutch: 1 }));
  assert.ok(car.speed < 0.5);
  const d = car.z - z0;
  assert.ok(d > 35 && d < 60, `stopping distance ${d.toFixed(1)} m`);
});

test('handbrake at 60 km/h rotates the car into a slide', () => {
  const car = rolling(flat, 16.7, 2);
  let maxAngle = 0;
  simulate(car, 0.9, (t) => {
    maxAngle = Math.max(maxAngle, Math.abs(car.driftAngle));
    return { ...idle, throttle: 0.2, handbrake: t < 0.5 ? 1 : 0, steer: t < 0.4 ? 0.6 : 0 };
  });
  assert.ok(maxAngle > (25 * Math.PI) / 180, `max slide ${((maxAngle * 180) / Math.PI).toFixed(1)} deg`);
});

test('clutch kick spins the rear tyres harder than plain throttle', () => {
  const peakSlip = (kick) => {
    const car = rolling(flat, 13.9, 2, TRANSMISSION.MANUAL_CLUTCH);
    let peak = 0;
    simulate(car, 1, (t) => {
      if (t > 0.45) peak = Math.max(peak, car.wheels[2].slipRatio, car.wheels[3].slipRatio);
      return { ...idle, throttle: 1, clutch: kick && t > 0.2 && t < 0.45 ? 1 : 0 };
    });
    return peak;
  };
  assert.ok(peakSlip(true) > peakSlip(false) * 2);
});

test('manual with clutch refuses to shift without the clutch pedal', () => {
  const car = rolling(flat, 10, 2, TRANSMISSION.MANUAL_CLUTCH);
  car.shift(1, 0);
  assert.equal(car.gear, 2);
  assert.equal(car.message, 'CLUTCH!');
  car.shift(1, 1);
  assert.equal(car.gear, 3);
});

test('automatic upshifts on its own and can select reverse at a stop', () => {
  const car = new CarSim(spec, flat);
  car.transmission = TRANSMISSION.AUTO;
  simulate(car, 14, () => ({ ...idle, throttle: 1 }));
  assert.ok(car.gear >= 3, `gear ${car.gear}`);
  const stopped = new CarSim(spec, flat);
  stopped.transmission = TRANSMISSION.AUTO;
  stopped.shift(-1, 0);
  assert.equal(stopped.gearLabel, 'R');
});

test('guardrails keep the car on the road', () => {
  const car = rolling(flat, 25, 3);
  simulate(car, 2, () => ({ ...idle, throttle: 0.5, steer: 1 }));
  assert.ok(Math.abs(car.q.lateral) < 4.4, `lateral ${car.q.lateral}`);
  assert.ok(Number.isFinite(car.x) && Number.isFinite(car.yawRate));
});

test('a simple autopilot can drive the whole section without the simulation blowing up', () => {
  const track = new Track();
  const car = new CarSim(spec, track);
  car.transmission = TRANSMISSION.AUTO;
  let t = 0;
  while (t < 400 && car.q.s < track.length - 20) {
    const i = Math.min(track.count - 1, car.hint + Math.round(8 + car.speed * 0.6));
    let err = Math.atan2(track.x[i] - car.x, track.z[i] - car.z) - car.yaw;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    let k = 0;
    for (let j = car.hint; j < Math.min(track.count, car.hint + 60); j++) k = Math.max(k, Math.abs(track.kappa[j]));
    const target = Math.min(40, Math.sqrt((0.75 * 9.81) / Math.max(k, 1e-4)));
    car.step(DT, { ...idle, throttle: car.speed < target ? 1 : 0, brake: car.speed > target + 2 ? 0.6 : 0, steer: Math.max(-1, Math.min(1, err * 2.5)) });
    t += DT;
    assert.ok(Number.isFinite(car.x), 'position is finite');
  }
  assert.ok(car.q.s > track.length - 25, `reached ${car.q.s.toFixed(0)} of ${track.length}`);
  assert.ok(t > 100 && t < 300, `took ${t.toFixed(0)} s`);
});
