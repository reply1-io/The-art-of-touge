# The Art of Touge

A mobile touge driving game, played in the phone's browser, with Gran Turismo 2 era graphics.

See [docs/DESIGN.md](docs/DESIGN.md) for the full design.

## Current state: first playable

- **Car:** Kazama MR-II (AW11 MR2 look-alike), 1.6 twin-cam, mid-engine, rear-wheel drive
- **Road:** Cedar Hairpins, a 3.1 km downhill section with four hairpins (about 2–3 minutes)
- **Mode:** time attack with two splits and a saved record
- **Physics:** tire slip, load transfer, engine, clutch, gearbox and open differential, so slides, clutch kicks and handbrake entries come out of the simulation
- **Look:** PS1 rendering (240p, wobbly vertices, warping textures, per-vertex lighting and fog, 15-bit dithered color) with GT2-style shiny paint
- **Settings:** transmission (manual + clutch, manual, automatic), steering (slider or buttons, optional assist), time of day (auto cycle, sunrise, day, sunset, night), camera, units, resolution, sound

## Controls

Hold the phone sideways.

| Control | What it does |
|---|---|
| Left thumb | Steering: drag the slider, or use the ◀ ▶ buttons |
| ▲ / ▼ | Shift up / down |
| GAS / BRAKE | The top of each pedal is full pressure; lower down is lighter |
| HAND | Handbrake |
| CLUTCH | Manual + clutch mode only. Slide your thumb up from GAS to kick the clutch while staying on the throttle |
| RECOVER | Puts the car back on the road (cancels the current run) |

On a computer: arrow keys or WASD, Space handbrake, Shift clutch, E / Q shift, R recover, V camera, Esc pause.

## Running it

It is a static site with no build step.

```sh
npm install      # only needed for tests (three.js is vendored in vendor/)
npm run serve    # http://localhost:8080
npm test         # track and physics tests
```

To play on a phone, host the folder on any static host (for example GitHub Pages) and open it in the phone's browser. "Add to Home Screen" opens it full-screen.
