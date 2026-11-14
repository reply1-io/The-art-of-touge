// Medal times for each road, worked out from the road itself: how long a stock car driven flat
// out wherever the corners allow (and braking hard for each one) would take from the start line
// to the finish. Gold is close to that; silver and bronze give more room.

const STEP = 2; // metres between road samples

export const MEDALS = [
  { id: 'gold', name: 'Gold', color: '#f5c542', margin: 1.12 },
  { id: 'silver', name: 'Silver', color: '#d4dbe3', margin: 1.25 },
  { id: 'bronze', name: 'Bronze', color: '#cd7f45', margin: 1.42 },
];

// Seconds for an ideal run from sample i0 to i1.
export function idealTime(road, i0, i1) {
  const n = i1 - i0 + 1;
  const cap = new Float64Array(n);
  for (let q = 0; q < n; q++) {
    const i = i0 + q;
    let k = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(road.count - 1, i + 2); j++) k = Math.max(k, Math.abs(road.kappa[j]));
    cap[q] = Math.sqrt((0.95 * 9.81) / Math.max(k, 1e-5));
  }
  // A rolling start, as in a race.
  const v = Float64Array.from(cap);
  v[0] = Math.min(cap[0], 8);
  for (let q = 1; q < n; q++) {
    const u = v[q - 1];
    const a = Math.min(5.5, 125000 / (1250 * Math.max(u, 1))) - (0.42 * u * u) / 1250 + 9.81 * road.grade[i0 + q];
    v[q] = Math.min(cap[q], Math.sqrt(Math.max(1, u * u + 2 * a * STEP)));
  }
  for (let q = n - 2; q >= 0; q--) v[q] = Math.min(v[q], Math.sqrt(v[q + 1] ** 2 + 2 * 7.5 * STEP));
  let t = 0;
  for (let q = 1; q < n; q++) t += (2 * STEP) / (v[q] + v[q - 1]);
  return t;
}

// { gold, silver, bronze } target times for a stretch of road.
export function medalTimes(road, i0, i1) {
  const t = idealTime(road, i0, i1);
  return Object.fromEntries(MEDALS.map((m) => [m.id, Math.round(t * m.margin)]));
}

// The best medal a time earns, or null.
export function medalFor(times, time) {
  if (!times || time == null) return null;
  return MEDALS.find((m) => time <= times[m.id]) || null;
}
