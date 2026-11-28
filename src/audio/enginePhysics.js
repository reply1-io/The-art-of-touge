// Engine physics: turns real engine and exhaust parts into a sound profile for the engine synth
// (m20-dsp.js). Nothing here is tuned by ear for a particular car; every number comes from the
// parts through the acoustics and mechanics below, so changing a part changes the sound the way
// it would on a real car.
//
//   const { profile, derived } = buildProfile(spec);
//   engine.setProfile(profile);          // M20EngineSound
//
// The physics, briefly:
// - Firing: when each cylinder fires comes from the crank geometry and firing order. Even-fire
//   engines fire every 720 / n degrees; odd-fire V6s alternate 90 and 150. Which exhaust each
//   pulse goes down (bank, header pair) comes from the layout and header type: that is where a
//   cross-plane V8 burbles, a flat-plane V8 screams and an unequal-length boxer rumbles.
// - Gas: sound travels faster in hot exhaust. Speed of sound c = 331.3 * sqrt(1 + T / 273.15) m/s;
//   about 650 m/s in the headers (~800 C), 540 m/s down the pipe (~450 C), 343 m/s in 20 C air.
// - Pipes: the tailpipe is a quarter-wave resonator (closed at the collector, open at the tip):
//   it rings at (2n - 1) * c / 4L. Header primaries carry each pulse L / c seconds to the collector.
// - Mufflers: a chamber of volume V with a neck of area A and length l rings at the Helmholtz
//   frequency c / 2pi * sqrt(A / (V * l)); bigger cans cut more highs. Straight pipes cut nothing.
// - Resonator: a quarter-wave side branch of length L cancels c / 4L (the drone frequency).
// - Pulses: the earlier the exhaust valve opens, the longer and softer the blowdown; higher
//   compression gives a sharper pulse. Valve overlap makes the idle lope.
// - Headers are tuned for the rpm where the reflected wave returns in time to help scavenging:
//   rpm = 850 * (180 + EVO) / (L_inches + 3) (the classic primary-length rule).

export const soundSpeed = (tempC) => 331.3 * Math.sqrt(1 + tempC / 273.15); // m/s
export const HEADER_TEMP = 800;   // C, exhaust gas in the primaries at load
export const PIPE_TEMP = 450;     // C, down the pipe
export const AIR_TEMP = 20;       // C, intake air

const even = (n) => Array.from({ length: n }, (_, k) => (720 / n) * k);

// Layouts: firing order (cylinder numbers), firing angles (crank degrees, in firing order), the
// side each cylinder sits on (for V and boxer engines), and how the crank makes it sound.
export const LAYOUTS = {
  i3: { label: 'Inline 3', firing: [1, 2, 3], angles: even(3), side: {}, note: 'Fires every 240 degrees: a lumpy, off-beat three.' },
  i4: { label: 'Inline 4', firing: [1, 3, 4, 2], angles: even(4), side: {}, note: 'Fires every 180 degrees: twice a revolution, a buzzy four.' },
  i5: { label: 'Inline 5', firing: [1, 2, 4, 5, 3], angles: even(5), side: {}, note: 'Fires every 144 degrees: the warble of a five.' },
  i6: { label: 'Inline 6', firing: [1, 5, 3, 6, 2, 4], angles: even(6), side: {}, note: 'Fires every 120 degrees, perfectly balanced: a smooth six.' },
  v6_60: { label: 'V6, 60 degrees (even fire)', firing: [1, 2, 3, 4, 5, 6], angles: even(6), side: { 1: 0, 3: 0, 5: 0, 2: 1, 4: 1, 6: 1 },
    note: 'Even fire every 120 degrees, alternating banks.' },
  v6_90odd: { label: 'V6, 90 degrees (odd fire)', firing: [1, 6, 5, 4, 3, 2], angles: [0, 90, 240, 330, 480, 570], side: { 1: 0, 3: 0, 5: 0, 2: 1, 4: 1, 6: 1 },
    note: 'Odd fire, 90 then 150 degrees between firings: an uneven, gruff V6.' },
  v8_cross: { label: 'V8, cross-plane', firing: [1, 8, 4, 3, 6, 5, 7, 2], angles: even(8), side: { 1: 0, 3: 0, 5: 0, 7: 0, 2: 1, 4: 1, 6: 1, 8: 1 },
    note: 'Even fire overall, but each bank fires unevenly (two in a row on one side): the burble.' },
  v8_flat: { label: 'V8, flat-plane', firing: [1, 5, 3, 7, 4, 8, 2, 6], angles: even(8), side: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1, 6: 1, 7: 1, 8: 1 },
    note: 'Banks strictly alternate, each like an inline four: a high scream.' },
  boxer4: { label: 'Flat 4 (boxer)', firing: [1, 3, 2, 4], angles: even(4), side: { 1: 0, 3: 0, 2: 1, 4: 1 },
    note: 'Two in a row on each side; with unequal-length headers the pulses reach the collector unevenly: the boxer rumble.' },
  v10: { label: 'V10', firing: [1, 6, 5, 10, 2, 7, 3, 8, 4, 9], angles: even(10), side: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1 },
    note: 'Fires every 72 degrees: a high, hard wail.' },
  v12: { label: 'V12', firing: [1, 7, 5, 11, 3, 9, 6, 12, 2, 8, 4, 10], angles: even(12), side: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1 },
    note: 'Fires every 60 degrees: dense and smooth, a shriek at the top.' },
};

export const HEADERS = {
  log: 'Cast log manifold (short, all cylinders of a side together)',
  longtube: 'Long-tube headers, 4-1 / 6-1 / 8-1 (one collector per side)',
  tri_y: 'Tri-Y headers, 4-2-1 (cylinders paired 360 degrees apart)',
  unequal: 'Unequal-length headers (one side longer)',
};
export const ROUTING = { single: 'Single pipe (Y-pipe)', xpipe: 'Dual into an X-pipe', dual: 'True dual (each side its own pipe)' };
export const MUFFLERS = {
  none: 'None (straight pipe)',
  straight: 'Straight-through (glasspack / perforated core)',
  chambered: 'Chambered',
  turbo: 'Turbo / reverse-flow (OEM style)',
};
export const RESONATORS = { none: 'None', straight: 'Straight-through', tuned: 'Tuned quarter-wave (drone cancel)' };
export const INTAKES = { airbox: 'Stock airbox', coldair: 'Cold-air tube, open filter', itb: 'Individual throttle bodies' };

// Ready-made specs of real engines (published bore, stroke, compression; typical exhaust).
export const PRESETS = {
  k24: { label: 'Honda K24A2 (RSX / TSX)', layout: 'i4', bore: 87, stroke: 99, cr: 10.5, idle: 750, redline: 7100,
    evo: 40, overlap: 20, header: 'tri_y', primary: 400, primaryDia: 42, routing: 'single', pipeDia: 57, pipeLen: 3.2,
    cat: true, resonator: 'tuned', resLen: 600, muffler: 'turbo', mufflerVol: 12, intake: 'airbox', turbo: 'none' },
  m20: { label: 'BMW M20B25 (E30 325i)', layout: 'i6', bore: 84, stroke: 75, cr: 9.7, idle: 900, redline: 6500,
    evo: 45, overlap: 16, header: 'log', primary: 300, primaryDia: 38, routing: 'single', pipeDia: 55, pipeLen: 3.1,
    cat: true, resonator: 'straight', resLen: 500, muffler: 'chambered', mufflerVol: 15, intake: 'airbox', turbo: 'none' },
  ls3: { label: 'GM LS3 6.2 (Corvette C6)', layout: 'v8_cross', bore: 103.25, stroke: 92, cr: 10.7, idle: 650, redline: 6600,
    evo: 50, overlap: 28, header: 'log', primary: 350, primaryDia: 45, routing: 'dual', pipeDia: 64, pipeLen: 3.4,
    cat: true, resonator: 'none', resLen: 500, muffler: 'turbo', mufflerVol: 14, intake: 'airbox', turbo: 'none' },
  ej25: { label: 'Subaru EJ25 (WRX / STI)', layout: 'boxer4', bore: 99.5, stroke: 79, cr: 8.2, idle: 750, redline: 6700,
    evo: 50, overlap: 22, header: 'unequal', primary: 450, primaryDia: 42, routing: 'single', pipeDia: 76, pipeLen: 3.0,
    cat: true, resonator: 'straight', resLen: 400, muffler: 'straight', mufflerVol: 8, intake: 'airbox', turbo: 'small' },
  flatv8: { label: 'Flat-plane V8 (Ferrari F136)', layout: 'v8_flat', bore: 94, stroke: 81, cr: 12.5, idle: 1000, redline: 9000,
    evo: 60, overlap: 40, header: 'longtube', primary: 650, primaryDia: 44, routing: 'dual', pipeDia: 60, pipeLen: 2.4,
    cat: true, resonator: 'none', resLen: 400, muffler: 'straight', mufflerVol: 10, intake: 'airbox', turbo: 'none' },
  i5: { label: 'Audi 2.5 TFSI five', layout: 'i5', bore: 82.5, stroke: 92.8, cr: 10, idle: 800, redline: 7000,
    evo: 45, overlap: 20, header: 'longtube', primary: 450, primaryDia: 42, routing: 'single', pipeDia: 70, pipeLen: 3.0,
    cat: true, resonator: 'straight', resLen: 400, muffler: 'chambered', mufflerVol: 12, intake: 'airbox', turbo: 'big' },
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// a fixed pseudo-random sequence, so a given spec always sounds the same
function seeded(seed) { let s = seed % 2147483647 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

/** Build a synth profile and the derived physics numbers from a parts spec. */
export function buildProfile(spec) {
  const L = LAYOUTS[spec.layout] || LAYOUTS.i4;
  const n = L.firing.length;
  const rnd = seeded(Math.round(spec.bore * 13 + spec.stroke * 7 + n * 101));

  // ---- engine geometry
  const boreM = spec.bore / 1000, strokeM = spec.stroke / 1000;
  const cylL = (Math.PI / 4) * boreM * boreM * strokeM * 1000;            // litres per cylinder
  const dispL = cylL * n;
  const bs = spec.bore / spec.stroke;                                       // bore / stroke
  const pistonSpeed = (2 * strokeM * spec.redline) / 60;                    // mean, m/s at redline
  const firingHz = (rpm) => (rpm / 60) * (n / 2);                           // four-stroke: n firings per 2 revs

  // ---- gas
  const cHdr = soundSpeed(HEADER_TEMP), cPipe = soundSpeed(PIPE_TEMP), cAir = soundSpeed(AIR_TEMP);

  // ---- which exhaust branch each pulse goes down (synth has two: A and B)
  const vee = Object.keys(L.side).length > 0;
  const bank = L.firing.map((cyl, k) => {
    if (spec.header === 'tri_y' && !vee) return k % 2;                     // pairs 360 degrees apart
    if (vee) return L.side[cyl];                                            // each side its own collector
    if (spec.header === 'log') return cyl <= n / 2 ? 0 : 1;                 // front / rear half of the manifold
    return 0;                                                               // one collector for all
  });
  const dual = vee && spec.routing === 'dual';

  // header primaries: each pulse travels L / c to the collector; unequal headers: one side 1.6x longer
  const prim = spec.primary / 1000;
  const header = [prim / cHdr, (spec.header === 'unequal' ? prim * 1.6 : prim * 1.08) / cHdr];
  // reflection inside the runners: short cast logs reflect more, long smooth tubes less
  const hdrFb = spec.header === 'log' ? 0.45 : spec.header === 'longtube' ? 0.22 : 0.3;
  // tuned rpm of the primaries (classic rule; primary length in inches, EVO in degrees BBDC)
  const tunedRpm = (850 * (180 + spec.evo)) / (spec.primary / 25.4 + 3);

  // ---- the pipe: a quarter-wave resonator, c / 4L at the pipe temperature. The synth's pipe
  // delay assumes 343 m/s, so pass the length it should have in air to ring at the hot frequency
  const pipeEff = spec.pipeLen * (343 / cPipe);
  const pipeModes = [1, 3, 5].map((k) => (k * cPipe) / (4 * spec.pipeLen));
  // a wider pipe radiates more at the open end and reflects less
  const pipeRefl = clamp(0.56 - (spec.pipeDia - 50) * 0.004, 0.3, 0.6);

  // ---- muffler and resonator
  const vol = Math.max(1, spec.mufflerVol);
  const vf = clamp(Math.sqrt(12 / vol), 0.6, 1.6);                          // bigger can, lower cutoff
  const wide = Math.pow(spec.pipeDia / 57, 0.35);                           // wider pipe, more gets through
  const pipeArea = (Math.PI / 4) * (spec.pipeDia / 1000) ** 2;
  const helmholtz = (cPipe / (2 * Math.PI)) * Math.sqrt(pipeArea / ((vol / 1000) * 0.12)); // neck ~ 0.12 m
  const M = {
    none: { muff: [2200, 1500, 0.15, 5000, 3000], rasp: 1.7, pops: 2.0, level: 1.45, sizzle: 1.2 },
    straight: { muff: [900, 900, 0.12, 2600, 1600], rasp: 1.25, pops: 1.4, level: 1.22, sizzle: 0.8 },
    chambered: { muff: [520, 700, 0.09, 1600, 1000], rasp: 0.85, pops: 1.0, level: 1.1, sizzle: 0.4 },
    turbo: { muff: [380, 500, 0.07, 1000, 400], rasp: 0.6, pops: 0.6, level: 1.0, sizzle: 0.2 },
  }[spec.muffler] || null;
  let muffScale = (spec.muffler === 'none' ? 1 : vf) * wide;
  let level = M.level * Math.pow(cylL / 0.5, 0.25) * Math.pow(spec.pipeDia / 57, 0.4);
  let rasp = M.rasp * Math.pow(bs, 0.8) * Math.pow(spec.pipeDia / 57, 0.3);
  // a bigger can (more expansion) quiets everything that passes through it, the rasp included
  if (spec.muffler !== 'none') { rasp *= Math.pow(vf, 1.2); level *= Math.pow(vf, 0.35); }
  let pops = M.pops;
  const eq = [];
  if (spec.muffler === 'chambered') eq.push([helmholtz, 2.0, 4]);           // the chamber's bark
  if (spec.cat) { muffScale *= 0.85; rasp *= 0.85; pops *= 0.35; level *= 0.9; }
  let resonatorHz = null;
  if (spec.resonator === 'tuned') {                                         // quarter-wave side branch
    resonatorHz = cPipe / (4 * (spec.resLen / 1000));
    eq.push([resonatorHz, 5, -12]);
  } else if (spec.resonator === 'straight') { muffScale *= 0.92; rasp *= 0.9; }
  const muff = [M.muff[0] * muffScale, M.muff[1] * muffScale, M.muff[2], M.muff[3] * muffScale, M.muff[4] * muffScale];

  // ---- the pulse itself: earlier exhaust opening, longer blowdown; higher compression, sharper
  const width = [clamp(14 + 0.3 * spec.evo, 16, 40) / Math.pow(bs, 0.3), 4];
  const pulseSharp = clamp((spec.cr - 8.5) / 10, 0, 0.45);
  // valve overlap: the idle lopes (reversion, misfire-like stumbles)
  const lope = clamp((spec.overlap - 25) / 40, 0, 1);
  const chop = Array.from({ length: 2 * n }, () => 1 + (rnd() - 0.5) * 0.9 * (0.3 + lope));

  // ---- intake
  let intakeHz, intakeGain, intakeRoar = 0.8;
  if (spec.intake === 'coldair') { intakeHz = cAir / (4 * 0.6); intakeGain = 0.22; intakeRoar = 1.6; }
  else { // airbox: a Helmholtz resonator (snout ~70 mm x 0.25 m, ~8 L box)
    intakeHz = (cAir / (2 * Math.PI)) * Math.sqrt(((Math.PI / 4) * 0.07 ** 2) / (0.008 * 0.25));
    intakeGain = 0.08;
  }

  // ---- loudness of each firing: displacement; small differences between cylinders
  const cylGain = L.firing.map(() => 1 + (rnd() - 0.5) * 0.12);
  const cylTiming = L.firing.map(() => (rnd() - 0.5) * 2.5);

  const profile = {
    label: `${L.label}, ${dispL.toFixed(1)} L`,
    firing: L.firing, angles: L.angles, bank, cylGain, cylTiming,
    idleRpm: spec.idle, redline: spec.redline, crankFlare: spec.idle + 700, starterRatio: 11,
    dual, listen: dual ? [0.7, 0.3] : undefined,
    header, hdrFb, pipe: [pipeEff, pipeEff * (dual ? 1.04 : 1)], pipeRefl,
    width, pulseSharp, pump: 0.11, jitter: 0.05, idleJitter: 0.05 + 0.1 * lope, lope: [0.006, 0.003], baseLope: lope * 0.8,
    chop, sizzle: M.sizzle, idleNoise: 1, popMul: pops,
    muff, muffRpm: 1.2, muffRpm2: 0.15,
    body: [clamp(pipeModes[0], 40, 200), 3], drone: [clamp(pipeModes[1], 80, 600), 2],
    rasp: [clamp(1200 * (57 / spec.pipeDia), 700, 2200), 0.12, rasp], raspLp: spec.muffler === 'straight' ? 4000 : undefined,
    rumble: [220, 0.05, clamp(Math.pow(cylL / 0.5, 0.5), 0.5, 1.6)],
    intake: [intakeHz, 0.06, intakeGain], intakeRoar,
    eq: eq.length ? eq : undefined,
    level: level * 0.9, tick: 0.5, room: 0.6, fastCut: true,
  };

  const derived = {
    displacement: dispL, cylinderVolume: cylL, boreStroke: bs, pistonSpeed,
    firingIdle: firingHz(spec.idle), firingRedline: firingHz(spec.redline),
    cHeader: cHdr, cPipe, cAir, pipeModes, tunedRpm, helmholtz: spec.muffler === 'chambered' ? helmholtz : null,
    resonatorHz, intakeHz, layoutNote: L.note, lope,
  };
  return { profile, derived };
}

/** A rough torque curve for the builder's rev model (N m at rpm), from displacement and cams. */
export function torqueAt(spec, rpm) {
  const L = LAYOUTS[spec.layout] || LAYOUTS.i4;
  const disp = (Math.PI / 4) * (spec.bore / 1000) ** 2 * (spec.stroke / 1000) * 1000 * L.firing.length;
  const peakNm = disp * 95 * (1 + (spec.cr - 10) * 0.03);                   // ~95 N m per litre NA
  const peakRpm = clamp(3000 + spec.overlap * 60 + (spec.bore / spec.stroke - 1) * 2500, 2500, spec.redline * 0.85);
  const spread = spec.redline * 0.75;
  return Math.max(peakNm * 0.45, peakNm * (1 - ((rpm - peakRpm) / spread) ** 2));
}
