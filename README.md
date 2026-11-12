# The-art-of-touge

## Engine sound (E30 325i, M20 straight-six)

The car's engine audio is built from a real phone recording of an E30 idling and revving.

| Path | What it is |
| --- | --- |
| `tools/extract_engine_samples.py` | Turns a video/audio clip into game audio: splits off the start-up, finds the rpm for every 10 ms of the clip, writes the files below. |
| `assets/audio/e30/e30_m20_source.wav` | Idle + free revs, mono 48 kHz. |
| `assets/audio/e30/e30_m20_map.json` | rpm (and on/off throttle) for every 10 ms of the source. |
| `assets/audio/e30/e30_m20_start.wav` | The engine starting. |
| `src/audio/E30EngineSound.js` | Web Audio player. Give it rpm + throttle every frame and it plays slices of the recording taken where the real engine was at that rpm. |
| `engine-sound-demo.html` | Tach, gas/brake pedals, free-rev / drive / manual modes. |

Run the demo: `python3 -m http.server` in the repo root, then open http://localhost:8000/engine-sound-demo.html.

Use it in the game:

```js
import { E30EngineSound } from './src/audio/E30EngineSound.js';
const engine = await E30EngineSound.load(audioCtx, {
  source: 'assets/audio/e30/e30_m20_source.wav',
  map: 'assets/audio/e30/e30_m20_map.json',
  start: 'assets/audio/e30/e30_m20_start.wav',
});
engine.connect(audioCtx.destination);
engine.startWithCrank();
// each frame
engine.setRpm(car.rpm);
engine.setThrottle(car.throttle); // 0..1
```

The current clip covers about 1,000–2,200 rpm. Higher rpm is pitched up from the top of the clip and blended with a synthesized layer. To make high rpm sound real, record steady holds at 3,000 / 4,000 / 5,000 / 6,000 rpm and a 2nd-gear pull, then rerun:

```
python3 tools/extract_engine_samples.py clip.mov --idle-rpm 1000 --start-end 2.4 --idle 2.6 4.4
```

`--start-end` is where the start-up ends, and `--idle` is a stretch of steady idle (both in seconds). `--idle-rpm` is what the tach read at idle.
