#!/usr/bin/env python3
"""Turn a phone video of an engine idling + revving into game-ready engine audio.

Outputs (in --out):
  <name>_start.wav    the start-up / cranking part (before --start-end seconds)
  <name>_source.wav   the idle + revving part, mono, peak-normalised
  <name>_map.json     rpm for every 10 ms of <name>_source.wav, plus an
                      "on throttle" flag (rpm rising) - the engine-sound player
                      uses this to pick grains whose real rpm matches the
                      rpm the game asks for.

How rpm is found: the idle section gives a reference harmonic "fingerprint".
For every 10 ms frame we slide that fingerprint along a log-frequency axis;
the best-matching shift is the rpm ratio to idle (harmonics of an engine all
scale together with rpm). A Viterbi pass keeps the curve physically smooth.

Usage:
  python3 tools/extract_engine_samples.py IMG_0524.mov --idle-rpm 1000 \
      --start-end 2.4 --idle 2.6 4.4 --name e30_m20 --out assets/audio/e30

Needs ffmpeg, numpy and scipy.
"""
import argparse, json, os, subprocess, tempfile
import numpy as np
import scipy.io.wavfile as wavfile
import scipy.signal as sig

SR = 48000
HOP_S = 0.01
BINS_PER_OCT = 96


def load_audio(path):
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, "a.wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-map", "0:a:0",
                        "-ac", "1", "-ar", str(SR), wav], check=True)
        _, x = wavfile.read(wav)
    return x.astype(np.float64) / 32768.0


def track_ratio(x, idle_from, idle_to):
    nper, hop = 4096, int(SR * HOP_S)
    f, t, Z = sig.stft(x, SR, nperseg=nper, noverlap=nper - hop, nfft=16384,
                       boundary=None, padded=False)
    t = t  # centre of each frame, seconds
    A = np.log(np.abs(Z) + 1e-6)
    nb = int(BINS_PER_OCT * np.log2(1200 / 60))
    lf = 60 * 2 ** (np.arange(nb) / BINS_PER_OCT)
    L = np.stack([np.interp(lf, f, A[:, j]) for j in range(len(t))], 1)
    H = np.maximum(L - sig.savgol_filter(L, 49, 2, axis=0), 0)  # keep harmonic peaks only

    idle = (t > idle_from) & (t < idle_to)
    hi = int(BINS_PER_OCT * np.log2(500 / 60))
    T = H[:hi, idle].mean(1)
    T = (T - T.mean()) / T.std()
    shifts = np.arange(-20, BINS_PER_OCT * 2)
    S = np.full((len(shifts), len(t)), -9.0)
    for i, sh in enumerate(shifts):
        a, b = sh, hi + sh
        if a < 0 or b > nb:
            continue
        seg = H[a:b]
        seg = (seg - seg.mean(0)) / (seg.std(0) + 1e-9)
        S[i] = (seg * T[:, None]).mean(0)

    ns, nt = S.shape
    D, bp = S[:, 0].copy(), np.zeros((ns, nt), int)
    for j in range(1, nt):
        best, arg = np.full(ns, -1e9), np.zeros(ns, int)
        for d in range(-4, 5):
            cand = np.roll(D, d) - 0.02 * abs(d)
            if d > 0: cand[:d] = -1e9
            if d < 0: cand[d:] = -1e9
            m = cand > best
            best[m], arg[m] = cand[m], (np.arange(ns) - d)[m]
        D, bp[:, j] = best + S[:, j], arg
    p = np.zeros(nt, int)
    p[-1] = np.argmax(D)
    for j in range(nt - 1, 0, -1):
        p[j - 1] = bp[p[j], j]
    ratio = 2 ** (shifts[p] / BINS_PER_OCT)
    conf = S[p, np.arange(nt)]
    return t, ratio, conf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--idle-rpm", type=float, default=1000)
    ap.add_argument("--start-end", type=float, default=2.4, help="seconds of start-up to split off")
    ap.add_argument("--idle", type=float, nargs=2, default=[2.6, 4.4], help="steady idle window (s)")
    ap.add_argument("--name", default="e30_m20")
    ap.add_argument("--out", default="assets/audio/e30")
    a = ap.parse_args()

    x = load_audio(a.video)
    t, ratio, conf = track_ratio(x, a.idle[0], a.idle[1])
    rpm = sig.savgol_filter(ratio, 9, 2) * a.idle_rpm
    drpm = np.gradient(rpm, HOP_S)

    peak = np.max(np.abs(x)) or 1.0
    s0 = int(a.start_end * SR)
    os.makedirs(a.out, exist_ok=True)
    wavfile.write(os.path.join(a.out, f"{a.name}_start.wav"), SR,
                  (x[:s0] / peak * 0.9 * 32767).astype(np.int16))
    wavfile.write(os.path.join(a.out, f"{a.name}_source.wav"), SR,
                  (x[s0:] / peak * 0.9 * 32767).astype(np.int16))

    frames = []
    for ti, r, dr, c in zip(t, rpm, drpm, conf):
        if ti < a.start_end + 0.05 or ti > len(x) / SR - 0.05:
            continue
        frames.append([round(ti - a.start_end, 3), round(float(r)), 1 if dr > 1500 else 0,
                       round(float(c), 2)])
    meta = {
        "engine": "BMW M20 2.5 straight-six (E30 325i), exhaust mic",
        "sampleRate": SR,
        "hop": HOP_S,
        "idleRpm": a.idle_rpm,
        "minRpm": int(min(f[1] for f in frames)),
        "maxRpm": int(max(f[1] for f in frames)),
        "columns": ["time_s", "rpm", "on_throttle", "confidence"],
        "frames": frames,
    }
    with open(os.path.join(a.out, f"{a.name}_map.json"), "w") as fh:
        json.dump(meta, fh, separators=(",", ":"))
    print(f"rpm range {meta['minRpm']}-{meta['maxRpm']}, {len(frames)} frames, "
          f"{sum(f[2] for f in frames)} on-throttle")


if __name__ == "__main__":
    main()
