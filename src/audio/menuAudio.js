// Music and menu sounds.
//   In a menu (title, settings, roads, pause, race setup, results, tuning shop): the menu song.
//   Driving: the song you picked (Song 1, Song 2, the menu song) or nothing.
// Switching song, or going between a menu and the road, fades cleanly: the old song fades out
// while the new one fades in. Every button also clicks.
//
// Each song file is its loop with a second of the music either side, so the loop points (1 s and
// 1 s + the loop length) sit inside the music however much silence the decoder adds at the start:
// both points move together and the loop stays seamless.
export const SONGS = {
  song1: { name: 'Song 1', file: 'song-1.mp3', loop: 11.617 },
  song2: { name: 'Song 2', file: 'song-2.mp3', loop: 22.384 },
  menu: { name: 'Menu song', file: 'menu-music.mp3', loop: 12.0 },
};
// What can play while driving, in the order the music button steps through.
export const DRIVE_MUSIC = [
  ['song1', 'Song 1'],
  ['song2', 'Song 2'],
  ['menu', 'Menu song'],
  ['off', 'Off'],
];
const MUSIC_VOLUME = 0.64;
const CLICK_VOLUME = 0.5;
const FADE_IN = 1.4; // seconds
const FADE_OUT = 0.9;
const MENU_SCREENS = ['title', 'settings', 'roads', 'pause', 'race', 'results', 'shop'];

export class MenuAudio {
  constructor(base = './') {
    this.base = base;
    this.ctx = null;
    this.buffers = {}; // decoded songs by id
    this.loading = {};
    this.click = null;
    this.playing = null; // { id, src, gain }
    this.enabled = true;
    this.inMenu = false;
    this.driveSong = 'song1'; // what plays while driving ('off' for nothing)
    // Browsers only allow sound after a tap: start on the first one.
    const unlock = () => this.#start();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    // A click on any button.
    document.addEventListener(
      'click',
      (e) => {
        const b = e.target instanceof Element ? e.target.closest('button') : null;
        if (b && !b.disabled) this.playClick();
      },
      { capture: true },
    );
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.#sync();
  }

  // What plays while driving: a SONGS id or 'off'.
  setDriveSong(id) {
    this.driveSong = id;
    this.#sync();
  }

  async #start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.#sync();
    try {
      this.click = await this.#decode('click.wav');
    } catch {
      // No click sound: fine.
    }
  }

  async #decode(file) {
    const res = await fetch(`${this.base}audio/${file}`);
    const buf = await res.arrayBuffer();
    return await new Promise((ok, fail) => this.ctx.decodeAudioData(buf, ok, fail));
  }

  // The decoded song (loaded the first time it is wanted).
  #song(id) {
    if (this.buffers[id]) return Promise.resolve(this.buffers[id]);
    this.loading[id] ??= this.#decode(SONGS[id].file).then((b) => (this.buffers[id] = b));
    return this.loading[id];
  }

  playClick() {
    if (!this.enabled || !this.ctx || !this.click) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.click;
    const g = this.ctx.createGain();
    g.gain.value = CLICK_VOLUME;
    s.connect(g).connect(this.ctx.destination);
    s.start();
  }

  // Call every frame: is a menu showing?
  update() {
    let menu = false;
    for (const id of MENU_SCREENS) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) {
        menu = true;
        break;
      }
    }
    if (menu !== this.inMenu) {
      this.inMenu = menu;
      this.#sync();
    }
  }

  // The song that should be playing now (or null).
  #wanted() {
    if (!this.enabled) return null;
    const id = this.inMenu ? 'menu' : this.driveSong;
    return SONGS[id] ? id : null;
  }

  // Fade from whatever is playing to what should be.
  async #sync() {
    if (!this.ctx) return;
    const want = this.#wanted();
    if ((this.playing?.id ?? null) === want) return;
    // Fade the old song out, then let it go.
    if (this.playing) {
      const { src, gain } = this.playing;
      const t = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + FADE_OUT);
      try {
        src.stop(t + FADE_OUT + 0.05);
      } catch {
        // already stopped
      }
      this.playing = null;
    }
    if (!want) return;
    const token = (this.token = (this.token || 0) + 1);
    let buffer;
    try {
      buffer = await this.#song(want);
    } catch {
      return; // couldn't load: stay quiet
    }
    // Something else was asked for while it loaded.
    if (token !== this.token || this.#wanted() !== want || this.playing) return;
    const song = SONGS[want];
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = 1;
    src.loopEnd = Math.min(1 + song.loop, buffer.duration);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(this.ctx.destination);
    const t = this.ctx.currentTime;
    src.start(t, 1);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(MUSIC_VOLUME, t + FADE_IN);
    this.playing = { id: want, src, gain };
  }
}
