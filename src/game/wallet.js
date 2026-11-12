// Money and owned parts. Prices are rough real-world averages for E30 parts, in US dollars (parts
// plus fitting). Cosmetic tweaks (paint, plate, number boards, alignment, offset and coilover
// settings) are free; buying the hardware is what costs.
import { TUNABLE_DEFAULTS } from '../config.js';

const KEY = 'touge.wallet.v1';
export const START_MONEY = 3000;

// key -> option value -> price. Anything not listed is free; the stock option is always owned.
export const PRICES = {
  tire: { drift: 360, stock: 0, street: 640, semi: 1100 },
  diff: { open: 150, lsd: 0, welded: 250 },
  wheel: { bbs: 0, gold: 1800, six: 1400, steel: 250 },
  rim: { 14: 0, 15: 350, 16: 600, 17: 850, 18: 1100, 19: 1400, 20: 1800 },
  stretch: { false: 0, true: 120 },
  exhaust: { stock: 0, street: 650, race: 1100 },
  intake: { stock: 0, pod: 120, itb: 2800 },
  turbo: { none: 0, small: 3500, big: 5500 },
  clutch: { stock: 0, sport: 450, race: 900 },
  gearbox: { stock: 0, close: 1600 },
  finalDrive: { 3.46: 500, 3.64: 500, 3.73: 0, 3.91: 500, 4.1: 500, 4.27: 500, 4.45: 500 },
  coilovers: { false: 0, true: 1200 },
  antiRollFront: { 7000: 120, 14000: 0, 22000: 180, 32000: 260 },
  antiRollRear: { 0: 60, 7000: 0, 14000: 160, 22000: 230 },
  strutFront: { false: 0, true: 150 },
  strutRear: { false: 0, true: 130 },
  brakes: { stock: 0, bbk: 2400 },
  handbrake: { stock: 0, hydro: 280 },
  angleKit: { stock: 0, kit: 650, full: 1300 },
  weight: { stock: 0, light: 200, stripped: 1500 },
  seats: { stock: 0, bucket: 900 },
  headlights: { white: 0, yellow: 90, blue: 60 },
  taillights: { red: 0, smoked: 220, clear: 260 },
  numbers: { false: 0, true: 40 },
};

export const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

export class Wallet {
  constructor(tune) {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(KEY));
    } catch {
      saved = null;
    }
    if (saved && typeof saved.money === 'number') {
      this.money = saved.money;
      this.owned = new Set(saved.owned || []);
    } else {
      // First run with money: whatever is already fitted to the car counts as owned.
      this.money = START_MONEY;
      this.owned = new Set();
      for (const key of Object.keys(PRICES)) this.owned.add(key + ':' + tune[key]);
      this.save();
    }
    this.onChange = () => {};
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ money: this.money, owned: [...this.owned] }));
    } catch {
      // Private browsing: progress lasts for this visit only.
    }
    this.onChange?.();
  }

  price(key, value) {
    return PRICES[key]?.[String(value)] ?? 0;
  }

  owns(key, value) {
    if (!PRICES[key]) return true;
    if (String(TUNABLE_DEFAULTS[key]) === String(value)) return true;
    return this.price(key, value) === 0 || this.owned.has(key + ':' + value);
  }

  // Buy a part. Returns true if it is now owned.
  buy(key, value) {
    if (this.owns(key, value)) return true;
    const p = this.price(key, value);
    if (this.money < p) return false;
    this.money -= p;
    this.owned.add(key + ':' + value);
    this.save();
    return true;
  }

  earn(amount) {
    this.money += Math.max(0, Math.round(amount));
    this.save();
  }
}
