# The Art of Touge: Design Document

A mobile touge driving game, played in the phone's browser, with Gran Turismo 2 era (PS1) graphics.

---

## 1. Platform

- **Mobile first**: runs in the phone's web browser. No app store needed.
- **Landscape only**: the game asks the player to rotate the phone sideways.
- **Add to Home Screen**: opens full-screen like a native app (Progressive Web App).
- **Input**: touch only for now. Controller and wheel support may come later.
- **Recommended tech**: Three.js (WebGL) for rendering, with custom car physics instead of a generic physics engine.

## 2. Visual style: Gran Turismo 2

The game should look like Gran Turismo 2 (PlayStation, 1999): PS1 hardware limits, but cleaner and more polished than GT1.

**PS1 characteristics to recreate (with shaders):**
- Low render resolution (around 320×240), upscaled with sharp pixels
- Affine texture warping (no perspective correction)
- Vertex jitter (vertices snapped to a coarse grid)
- Limited color palette with dithering
- Short draw distance hidden by fog or distance fade

**What makes it GT2 rather than GT1:**
- Cleaner, more detailed car models
- Shiny environment-mapped reflections on car paint and windows
- More saturated, vivid colors
- Denser trackside detail: barriers, signs, trees, guardrails

**HUD: inspired by GT2, not a copy.** It keeps GT2's chunky bitmap font, orange/red accents and analog tach, but is built for touge and for phones:
- **Free roam is mostly clean**: speed, gear, a small tach and the time of day. Timers appear only during a run.
- **Section banner**: crossing into a named section slides in its name and record (e.g. "CEDAR HAIRPINS · REC 3:12.480").
- **Live split vs. personal best**: green when ahead, red when behind, updated at checkpoints.
- **Drift Score mode**: the score builds up on screen during a slide and locks in (or drops) when it ends.
- **Tach, gear and speed** sit up the right edge, clear of the pedal thumb; **minimap** sits up the left edge, clear of the steering thumb.
- **Rev light**: the tach's redline area flashes for shift timing.
- **Night**: HUD dims slightly so it doesn't overpower the headlights and fog.
- Units toggle: mph or km/h.

Menus (cabin, shops, garage) can borrow GT2's clean, list-style menu feel, with the cabin scene always visible behind them.

## 3. Home base: the cabin

- The game opens on a small one-person cabin in the mountains.
- A small bonfire burns outside, and a dog runs around the backyard chasing a ball.
- The player's current car is parked in the driveway.
- Time of day at the cabin matches the time-of-day setting for driving.
- The player never gets out of the car; the cabin is the backdrop for the menu.

**Main menu:**

| Button | Purpose |
|---|---|
| Marketplace | Buy cars listed by used car dealerships |
| Parts Shop | Buy performance parts |
| Garage | View, customize and tune your cars |
| Drive | Pull out of the driveway onto the mountain road |

## 4. First launch

- The player picks one free starter car and starts with **$0**.
- Starter choices (fictional names, models very close to the real cars):
  - **EF Civic look-alike**: front-wheel drive, light and nimble. Slides come from the handbrake and lift-off.
  - **AW11 MR2 look-alike**: mid-engine, rear-wheel drive. Rewarding, but can snap around.
  - **Evo III look-alike**: all-wheel drive turbo. Much stronger than the other two; balance still to be decided (detune it, or let it be the easy pick).

## 5. The mountain

- A long, narrow two-lane road starting at the cabin driveway.
- Heavy elevation changes, banked winding corners, a few straights, mountain scenery.
- **Full loop: about 30 minutes** of driving.
- Split into **named sections of 2–5 minutes each**, each with its own start, finish and records.
- No other cars by default. **Traffic can be toggled on.** No rivals.
- **No car damage.**

### Time of day

- **Automatic cycle**: 30 min day → 5 min sunset → 30 min night → 5 min sunrise
- **Fixed**: Sunrise, Daytime, Sunset or Night

## 6. Driving

- **Realistic sim physics**: weight transfer, a tire model, drivetrain simulation.
- Techniques the physics must support: inertia (feint) slides, clutch kicks, handbrake entries.

### Transmission (player's choice)

1. **Manual with clutch**: the only mode that allows clutch kicks
2. **Manual without clutch**: player shifts; the game handles the clutch
3. **Automatic**

### Steering (player's choice)

1. **On-screen wheel or slider**: analog thumb steering
2. **Left/right buttons**: steering eases in gradually the longer a button is held, so slides stay controllable

Tilt steering is not included.

### Other touch controls

Gas, brake, clutch, handbrake, shift up, shift down.

## 7. Game modes and earning money

Money is earned in two separate modes:

- **Time Attack**: on any named section (2–5 min) or the full loop.
- **Drift Score**: points for sliding technique (angle, speed, line, linking corners). Scoring is part of the game, not its main point.

### Economy rules

Progress must be earned; a few runs should never buy a new car.

- **Pay for performance**: clean, slow runs pay little; beating target times or personal bests pays much more.
- **Personal-best bonuses**: improving your own record pays well.
- **Diminishing returns**: repeating the same section back to back pays less each time, to encourage learning the whole mountain.
- **Mistakes cost money**: leaving the road or hitting walls reduces the payout.
- **The full loop pays the most.**
- **Rough targets** (to be tuned): a mid-tier car takes about 3–5 hours of good driving; a top-tier car 15–20+ hours.

## 8. Cars

- Fictional names, models very close to real cars.
- Garage holds **up to 10 cars**. Cars can be **sold**.
- Marketplace cars are all in like-new condition; mileage is not shown.

## 9. Parts Shop

| Category | Effect |
|---|---|
| Engine (intake, exhaust, ECU, internals) | More horsepower |
| Turbo / supercharger | Large power gain, with turbo lag |
| Transmission / gearing | Close-ratio gearbox, final drive |
| Clutch and flywheel | Lighter flywheel revs faster; stronger clutch for clutch kicks |
| Differential (LSD) | Predictable slides with both driven wheels locked together |
| Suspension (coilovers) | Lower, stiffer, adjustable |
| Tires | Street → sport → semi-slick grip |
| Brakes | Stronger stopping, less fade |
| Weight reduction | Lighter car |
| Steering angle kit | More steering lock for bigger slides |

**Buying adjustable parts unlocks the matching tuning sliders in the Garage.** Stock parts have little or no adjustment.

## 10. Garage

**Visual:**
- Paint
- Wheels
- Ride height
- OEM body kits

**Suspension tuning** (unlocked by parts):
- Damping
- Stiffness
- Camber
- Toe in/out
- Wheel offset

## 11. Multiplayer (later)

1. **Ghost cars first**: race a replay of your own best run, and later other players' runs.
2. **Live multiplayer later**: needs a server; the code should be structured so it can be added without a rewrite.

## 12. Open questions

- Which cars the Marketplace sells at launch (suggested 6–8 across price tiers)
- What happens when the player hits a traffic car, given there is no damage
- How to balance the Evo III against the other two starters
- Names for the mountain sections

## 13. First playable version

Build the driving first, then everything else on top of it:

1. One starter car (AW11 MR2 look-alike) on one 2–5 minute section
2. GT2-style rendering: low-res upscale, texture warping, vertex jitter, fog, car reflections
3. Touch controls: both steering options, pedals, clutch, handbrake, shifting
4. Sim physics tuned until the car feels right
5. Time attack timer and basic HUD

The cabin, menus, shops, economy, other cars and the full mountain come after the driving feels good.
