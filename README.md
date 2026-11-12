# The Art of Touge

A physics-based touge (mountain pass) driving game for mobile browsers. Three.js + Rapier, plain
JavaScript, no backend. Builds to a static site.

## Status: Phase 2 — the mountain

- **Car:** BMW E30 318is, low-poly, Alpine White, BBS-style mesh wheels.
- **Physics:** Rapier rigid-body chassis with four suspension raycasts, springs, dampers, anti-roll
  bars and a combined-slip tyre model. Each wheel spins on its own, driven through the clutch, a
  Getrag 240 five-speed (3.72 / 2.02 / 1.32 / 1.00 / 0.81, 4.10 final) and a limited-slip diff, so
  wheelspin, weight transfer, body roll and drifts come out of the simulation.
- **Engine:** M42 torque curve (136 hp, 172 N m), rpm tied to wheel speed through the gears, rev
  limiter at about 7,000 rpm, engine braking, and stalling.
- **Transmission settings** (title screen and pause menu, saved on the device):
  1. **Full Manual** — clutch to shift; shifting without it grinds; drop the clutch at idle and it stalls.
  2. **Manual, Auto Clutch** — use the H-shifter; the clutch is worked for you; no stalling.
  3. **Full Automatic** — D / R only.
- **Touch controls:** drag-to-steer (speed-sensitive), on/off GAS / BRAKE / HANDBRAKE, hold CLUTCH,
  and an H-pattern shifter you drag through the gate (R top-left, 1-2, 3-4, 5).
- **HUD:** tachometer, mph, gear, clutch indicator, timer.
- **Dev tuning panel:** pause menu → "Tuning panel" (or press `). Grip, springs, damping, anti-roll,
  torque, steering and LSD, applied live.

- **The pass:** about 5 km downhill, traced from a map of Mt. Akina: summit start by the lake, the
  lakeside esses, a chain of five consecutive hairpins, the long fast diagonal, the hard hairpin at
  the end of the fast run south, and the town at the bottom. 307 m of drop, grades up to 10%,
  cambered corners, drainage gutters on the inside of a few corners.
- **Physics:** road and gutters as a triangle mesh, terrain as a heightfield, guardrails on the
  drop-off side and outside of tight corners, invisible walls keeping you on the mountain.
- **Night:** dark blue sky with stars and moon, fog, headlights that light the road, streetlights
  at the hairpins, cedar forest, lit houses in town.
- **Timing:** the clock starts at the start line and stops at the finish (best time for this visit).

- **Dragon's Tail:** a second road in the spirit of the Tail of the Dragon (US 129): 8 km, about
  175 corners, nothing straighter than about 10 m. Pick the road on the title screen or in the menu.

Coming next: Phase 3 (saved best time, ghost replay, instant restart, polish), Phase 4 (deploy steps).

## Keyboard (desktop testing)

Arrows or WASD drive, Space handbrake, Shift clutch, 1-5 gears, R reverse, N neutral, E start the
engine, C camera, Esc pause, Backspace restart at the summit, T back on the road, ` tuning panel.

## Develop

```sh
npm install
npm run dev      # local dev server (also reachable from a phone on the same Wi-Fi)
npm test         # headless physics tests
npm run build    # static site in dist/
```

## Play full screen

The game is published to GitHub Pages by `.github/workflows/pages.yml` on every push.

1. One-time setup: repository **Settings → Pages → Source: Deploy from a branch → Branch: `gh-pages`, `/ (root)`** → Save.
2. Open **https://reply1-io.github.io/The-art-of-touge/** on your phone.
3. iPhone: Share → **Add to Home Screen**. Android: ⋮ → **Add to Home screen** / **Install app**.
4. Launch it from the home-screen icon: it opens full screen in landscape with no browser bars.
