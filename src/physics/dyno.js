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
  // Past the end, keep falling at the last slope (a raised rev limit reaches beyond the table).
  const [x0, y0] = table[table.length - 2];
  const [x1, y1] = table[table.length - 1];
  return Math.max(y1 * 0.35, y1 + (Math.min(0, y1 - y0) * (x - x1)) / (x1 - x0));
}

// Returns [{ rpm, nm, hp }] from 1,000 rpm to the limiter, plus the peaks. engine: which engine
// (the one fitted unless given, e.g. the car's own for the stock line).
export function dynoRun(tune, engine = CAR.engine) {
  const p = partsSetup(tune);
  const pts = [];
  let peakHp = { hp: 0, rpm: 0 };
  let peakNm = { nm: 0, rpm: 0 };
  const top = Math.max(7000, Math.floor(((engine.limiterRpm ?? 7000) + p.revExtra) / 100) * 100);
  for (let rpm = 1000; rpm <= top; rpm += 100) {
    let nm = interpolate(engine.torqueCurve, rpm) * (tune.torque ?? 1);
    if (p.intake) nm += p.intake(rpm) * (tune.torque ?? 1);
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
