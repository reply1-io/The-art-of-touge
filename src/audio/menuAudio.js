// Menu sounds: a click on every button, and the menu song looping while you are in a menu (the
// title screen, settings, roads, the pause menu, race setup, results, or the tuning shop). It fades
// out when you drive and back in when you come back to a menu.
//
// The song file is the 12-second loop with a second of the music either side of it, so the loop
// points (1 s and 13 s) sit inside the music however much silence the decoder adds at the start:
// both points move together and the loop stays seamless.
const LOOP_START = 1;
const LOOP_END = 13;
const MUSIC_VOLUME = 0.32;
const CLICK_VOLUME = 1; // the clip as recorded, full volume
const MENU_SCREENS = ['title', 'settings', 'roads', 'pause', 'race', 'results', 'shop'];

export class MenuAudio {
  constructor(base = './') {
    this.base = base;
    this.ctx = null;
    this.music = null; // decoded song
    this.click = null; // decoded click
    this.src = null; // the playing song
    this.gain = null;
    this.enabled = true;
    this.inMenu = false;
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
    this.#fade();
  }

  async #start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.ctx.destination);
    const load = async (name) => {
      const res = await fetch(`${this.base}audio/${name}`);
      const buf = await res.arrayBuffer();
      return await new Promise((ok, fail) => this.ctx.decodeAudioData(buf, ok, fail));
    };
    try {
      this.click = await load('click.wav');
    } catch {
      // No click sound: fine.
    }
    try {
      this.music = await load('menu-music.mp3');
      const src = this.ctx.createBufferSource();
      src.buffer = this.music;
      src.loop = true;
      src.loopStart = LOOP_START;
      src.loopEnd = Math.min(LOOP_END, this.music.duration);
      src.connect(this.gain);
      src.start(0, LOOP_START);
      this.src = src;
      this.#fade();
    } catch {
      // No music: fine.
    }
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
      this.#fade();
    }
  }

  #fade() {
    if (!this.ctx || !this.gain) return;
    const t = this.ctx.currentTime;
    const to = this.enabled && this.inMenu ? MUSIC_VOLUME : 0;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(to, t + (to > 0 ? 1.2 : 0.6));
  }
}
