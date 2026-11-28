// Makes the drone clips for the Roads screen: for each road, loads the game on that road, flies a
// drone along it frame by frame, and encodes the frames with ffmpeg into public/drone/<road>.mp4
// and .webm (plus a poster .jpg). Run with the preview server up: npx vite preview --port 4173
//   node scripts/drone.mjs [road ...]
import { createRequire } from 'module';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = new URL('../public/drone/', import.meta.url).pathname;
// Where along each road to film (fraction of its length), and the time of day.
const SHOTS = {
  dragon: { at: 0.3, time: 'sunset' },
  berthoud: { at: 0.6, time: 'day' }, // above the trees
  'tunitas-down': { at: 0.86, time: 'sunset' }, // out of the redwoods, the grass hills to the sea
  'us276-down': { at: 0.4, time: 'day' },
  'chiefjoseph-east': { at: 0.55, time: 'sunset' },
};
const FPS = 24;
const SECONDS = 6;
const SPEED = 26; // metres a second the drone flies

mkdirSync(OUT, { recursive: true });
const roads = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
for (const id of roads) {
  const shot = SHOTS[id];
  const pg = await b.newPage({ viewport: { width: 640, height: 360 } });
  await pg.addInitScript(([map, time]) => localStorage.setItem('touge.settings.v4', JSON.stringify({ map, time, vhs: true })), [id, shot.time]);
  await pg.goto('http://localhost:4173/');
  await pg.waitForFunction(() => window.__touge?.mountain, null, { timeout: 180000 });
  const len = await pg.evaluate(() => window.__touge.mountain.road.length);
  await pg.evaluate(() => window.__touge.droneStart());
  const dir = join(tmpdir(), `drone-${id}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  const s0 = len * shot.at;
  // A few frames first so the world round the drone is shown.
  for (let k = 0; k < 3; k++) await pg.evaluate((s) => window.__touge.droneFrame(s), s0);
  for (let k = 0; k < FPS * SECONDS; k++) {
    const url = await pg.evaluate((s) => window.__touge.droneFrame(s), s0 + (k * SPEED) / FPS);
    writeFileSync(join(dir, `f${String(k).padStart(4, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, 'f%04d.jpg'), '-vf', 'scale=480:-2', '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', '-an', join(OUT, `${id}.mp4`)]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(OUT, `${id}.mp4`), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1', '-an', join(OUT, `${id}.webm`)]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(dir, 'f0030.jpg'), '-vf', 'scale=480:-2', '-q:v', '5', join(OUT, `${id}.jpg`)]);
  rmSync(dir, { recursive: true, force: true });
  console.log(id, 'done');
  await pg.close();
}
await b.close();
