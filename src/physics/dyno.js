// Dyno: full-throttle torque and power curves for a setup, with the turbo at its steady boost.
import { CAR, partsSetup } from '../config.js';

function interpolate(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

// Returns [{ rpm, nm, hp }] from 1,000 to 7,000 rpm, plus the peaks.
export function dynoRun(tune) {
  const p = partsSetup(tune);
  const pts = [];
  let peakHp = { hp: 0, rpm: 0 };
  let peakNm = { nm: 0, rpm: 0 };
  for (let rpm = 1000; rpm <= 7000; rpm += 100) {
    let nm = interpolate(CAR.engine.torqueCurve, rpm) * (tune.torque ?? 1);
    if (p.intake) nm *= p.intake(rpm);
    if (p.turbo) {
      const k = Math.min(1, Math.max(0, (rpm - p.turbo.spool) / p.turbo.range));
      nm *= 1 + p.turbo.gain * k * k * (3 - 2 * k);
    }
    const hp = (nm * rpm) / 7121; // metric horsepower
    pts.push({ rpm, nm, hp });
    if (hp > peakHp.hp) peakHp = { hp, rpm };
    if (nm > peakNm.nm) peakNm = { nm, rpm };
  }
  return { pts, peakHp, peakNm, mass: p.mass };
}
