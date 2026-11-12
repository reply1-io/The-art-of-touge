# The-art-of-touge

## Engine sound: E30 325i (M20B25 straight-six)

The engine sound is fully procedural: no recordings, synthesized live in the browser with the Web Audio API.

| Path | What it is |
| --- | --- |
| `src/audio/m20-dsp.js` | The synth itself: six exhaust pulses per cycle in firing order 1-5-3-6-2-4, two 3-into-1 manifolds, the exhaust pipe, the muffler, rasp, intake, overrun fuel cut and pops, plus the starter motor. Afterfire pops only on a real lift-off from above 3,500 rpm (stock about 1 in 2 lifts, sport 1-3), never on limiter or shift cuts. |
| `src/audio/M20EngineSound.js` | What the game calls: `setRpm`, `setThrottle`, `setExhaust`, `startWithCrank`, `stop`. Runs the synth in an AudioWorklet, or on the main thread if the browser blocks that. Create and resume the `AudioContext` inside the tap/click handler, before any `await`, or phones stay silent. |
| `engine-sound-demo.html` | Tach, gas/brake pedals, free rev / drive / manual modes, stock/sport exhaust, live scope of one engine cycle. |

Run the demo: `python3 -m http.server` in the repo root, then open http://localhost:8000/engine-sound-demo.html.

`python3 tools/build_demo.py` writes `dist/engine-sound-demo.html`, a single-file copy with the engine code inlined (that is the version published as the shareable page).

Use it in the game:

```js
import { M20EngineSound } from './src/audio/M20EngineSound.js';
const engine = await M20EngineSound.create(audioCtx);
engine.connect(audioCtx.destination);
await engine.startWithCrank();
// each frame from the car sim
engine.setRpm(car.rpm);
engine.setThrottle(car.throttle); // 0..1, 0 above idle = overrun
```

Your car sim owns the rev limiter and gearbox. Set the throttle to 0 at the limiter (6,500 rpm) and the engine sounds like it.
