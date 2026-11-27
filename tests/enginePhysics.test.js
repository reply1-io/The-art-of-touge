import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soundSpeed, buildProfile, PRESETS, LAYOUTS, PIPE_TEMP } from '../src/audio/enginePhysics.js';
import { M20Dsp } from '../src/audio/m20-dsp.js';

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

// small radix-2 FFT for the audio checks (re, im in place)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(a * k), s = Math.sin(a * k);
        const xr = re[i + k + len / 2] * c - im[i + k + len / 2] * s, xi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
        re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi;
      }
    }
  }
}

function render(spec, rpm, thr, seconds = 1.6) {
  const { profile } = buildProfile(spec);
  const fs = 48000, d = new M20Dsp(fs);
  d.set({ profile, rpm, throttle: thr, idleRpm: spec.idle }); d.command('start'); d.set({ rpm, throttle: thr });
  const y = new Float32Array(Math.round(fs * seconds));
  for (let i = 0; i < y.length; i += 128) d.process(y.subarray(i, Math.min(y.length, i + 128)));
  return y.subarray(Math.round(fs * 0.4));
}
const rms = (y) => 10 * Math.log10(y.reduce((s, v) => s + v * v, 0) / y.length);
// share of the sound above 1 kHz (dB of the total)
function highShare(y) {
  const N = 8192; let hi = 0, all = 0;
  for (let s = 0; s + N <= y.length; s += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = y[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im);
    for (let k = 1; k < N / 2; k++) { const p = re[k] * re[k] + im[k] * im[k]; all += p; if ((k * 48000) / N > 1000) hi += p; }
  }
  return 10 * Math.log10(hi / all);
}
function centroid(y) {
  const N = 8192; let num = 0, den = 0;
  for (let s = 0; s + N <= y.length; s += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = y[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im);
    for (let k = 1; k < N / 2; k++) { const p = re[k] * re[k] + im[k] * im[k]; num += p * (k * 48000) / N; den += p; }
  }
  return num / den;
}
// the pipe's round-trip echo (2L / c) shows as a peak in the cepstrum
function echoMs(y, firingHz) {
  const N = 8192, C = new Float64Array(N);
  for (let s = 0; s + N <= y.length; s += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = y[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im);
    const lr = new Float64Array(N), li = new Float64Array(N);
    for (let k = 0; k < N; k++) lr[k] = Math.log(Math.hypot(re[k], im[k]) + 1e-9);
    fft(lr, li); // forward FFT of a real, even sequence = N x inverse
    for (let k = 0; k < N; k++) C[k] += Math.abs(lr[k]);
  }
  const per = 1000 / firingHz; let best = 0, at = 0;
  for (let k = 0; k < N / 2; k++) {
    const q = (k / 48000) * 1000;
    if (q < 3 || q > 30) continue;
    let skip = false;
    for (let m = 1; m < 8; m++) if (Math.abs(q - m * per) < 0.6) skip = true;
    if (!skip && C[k] > best) { best = C[k]; at = q; }
  }
  return at;
}

test('engine physics: speed of sound, firing frequency, pipe, resonator, header tuning', () => {
  near(soundSpeed(20), 343.2, 0.5, 'speed of sound in 20 C air');
  near(soundSpeed(PIPE_TEMP), 539, 2, 'speed of sound at 450 C');
  const { derived: k } = buildProfile(PRESETS.k24);
  near(k.displacement, 2.354, 0.01, 'K24 displacement (87 x 99 mm, 4 cyl)');
  near(k.firingIdle, 25, 0.01, 'inline-4 at 750 rpm fires 25 times a second');
  const c = soundSpeed(PIPE_TEMP);
  near(k.pipeModes[0], c / (4 * PRESETS.k24.pipeLen), 0.01, 'pipe quarter-wave c / 4L');
  near(k.pipeModes[1], 3 * k.pipeModes[0], 0.01, 'odd modes only');
  near(k.resonatorHz, c / (4 * PRESETS.k24.resLen / 1000), 0.01, 'resonator cancels c / 4L');
  near(k.tunedRpm, (850 * (180 + PRESETS.k24.evo)) / (PRESETS.k24.primary / 25.4 + 3), 0.01, 'header tuned rpm');
  near(buildProfile(PRESETS.ls3).derived.displacement, 6.16, 0.02, 'LS3 displacement');
  near(buildProfile(PRESETS.ls3).derived.firingIdle, (650 / 60) * 4, 0.01, 'V8 fires 4 times a revolution');
});

test('engine physics: every preset and layout builds a complete, valid profile', () => {
  for (const [name, spec] of Object.entries(PRESETS)) {
    const { profile: p } = buildProfile(spec);
    const n = p.firing.length;
    for (const key of ['angles', 'bank', 'cylGain', 'cylTiming']) assert.equal(p[key].length, n, `${name} ${key}`);
    assert.equal(p.chop.length, 2 * n, `${name} chop`);
    const nums = JSON.stringify(p).match(/-?\d+(\.\d+)?(e-?\d+)?|null/g);
    assert.ok(!JSON.stringify(p).includes('NaN') && !JSON.stringify(p).includes('Infinity'), `${name} finite`);
    assert.ok(nums.length > 20);
  }
  for (const layout of Object.keys(LAYOUTS)) {
    const { profile: p } = buildProfile({ ...PRESETS.k24, layout });
    assert.equal(p.angles.length, LAYOUTS[layout].firing.length, layout);
  }
});

test('engine physics in the sound: the pipe echo arrives 2L / c later, for each length', () => {
  const c = soundSpeed(PIPE_TEMP);
  for (const L of [2, 4]) {
    const spec = { ...PRESETS.k24, pipeLen: L, muffler: 'none', resonator: 'none', cat: false };
    const y = render(spec, 6500, 1, 2.0);
    near(echoMs(y, (6500 / 60) * 2), ((2 * L) / c) * 1000, 0.25, `echo for a ${L} m pipe (ms)`);
  }
});

test('engine physics in the sound: a straight pipe is louder and brighter than an OEM muffler', () => {
  const base = { ...PRESETS.k24, resonator: 'none', cat: false };
  const oem = render({ ...base, muffler: 'turbo' }, 4000, 1), open = render({ ...base, muffler: 'none' }, 4000, 1);
  assert.ok(rms(open) > rms(oem) + 2, `louder: ${rms(open).toFixed(1)} vs ${rms(oem).toFixed(1)} dB`);
  assert.ok(centroid(open) > centroid(oem) * 1.2, `brighter: ${centroid(open).toFixed(0)} vs ${centroid(oem).toFixed(0)} Hz`);
  const small = render({ ...base, muffler: 'chambered', mufflerVol: 6 }, 4000, 1), big = render({ ...base, muffler: 'chambered', mufflerVol: 30 }, 4000, 1);
  assert.ok(highShare(big) < highShare(small) - 2, `a bigger can is darker: ${highShare(big).toFixed(1)} vs ${highShare(small).toFixed(1)} dB above 1 kHz`);
  assert.ok(rms(big) < rms(small), `and quieter: ${rms(big).toFixed(1)} vs ${rms(small).toFixed(1)} dB`);
});

// level of an order (multiple of the firing frequency) relative to the firing note
function orderDb(y, firingHz, h) {
  const N = 1 << 16, re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < Math.min(N, y.length); i++) re[i] = y[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.min(N, y.length)));
  fft(re, im);
  const at = (hz) => { let m = 0; for (let k = Math.floor(((hz - 2) * N) / 48000); k <= Math.ceil(((hz + 2) * N) / 48000); k++) m = Math.max(m, re[k] * re[k] + im[k] * im[k]); return m; };
  return 10 * Math.log10(at(h * firingHz) / at(firingHz));
}

test('engine physics in the sound: a cross-plane V8 burbles (3/8 order), a flat-plane screams (1/2 order)', () => {
  const ff = (2500 / 60) * 4;
  const cross = render({ ...PRESETS.ls3, layout: 'v8_cross', routing: 'dual' }, 2500, 0.5, 2.0);
  const flat = render({ ...PRESETS.ls3, layout: 'v8_flat', routing: 'dual' }, 2500, 0.5, 2.0);
  assert.ok(orderDb(cross, ff, 0.375) > orderDb(flat, ff, 0.375) + 12, 'cross-plane: strong 3/8 order (each bank fires unevenly)');
  assert.ok(orderDb(flat, ff, 0.5) > orderDb(cross, ff, 0.5) + 12, 'flat-plane: strong 1/2 order (each bank is an even four)');
  const x = render({ ...PRESETS.ls3, layout: 'v8_cross', routing: 'xpipe' }, 2500, 0.5, 2.0);
  assert.ok(orderDb(x, ff, 0.375) < orderDb(cross, ff, 0.375) - 10, 'an X-pipe evens the cross-plane burble out');
});
