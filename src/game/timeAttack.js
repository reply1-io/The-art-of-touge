// Time attack on a named section: start gate, two split checkpoints, finish gate, saved records.

const STORAGE_KEY = 'touge.records.v1';

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveRecords(records) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Storage can be unavailable (private mode); records then last for this session only.
  }
}

export class TimeAttack {
  constructor(sectionId, startS, finishS) {
    this.sectionId = sectionId;
    this.startS = startS;
    this.finishS = finishS;
    this.checkpoints = [startS + (finishS - startS) / 3, startS + ((finishS - startS) * 2) / 3];
    this.records = loadRecords();
    this.reset();
  }

  get record() {
    return this.records[this.sectionId] || null; // { time, splits: [] }
  }

  reset() {
    this.phase = 'ready'; // ready -> running -> finished
    this.time = 0;
    this.splits = [];
    this.split = null; // delta vs record at the last checkpoint
    this.splitTime = 0; // seconds left to show the delta
    this.lastS = null;
  }

  cancel() {
    if (this.phase === 'running') {
      this.reset();
      return true;
    }
    return false;
  }

  // Returns an event string when something happens: 'start', 'split', 'finish', 'record'.
  update(dt, s) {
    let event = null;
    const prev = this.lastS ?? s;
    this.lastS = s;
    if (this.splitTime > 0) this.splitTime -= dt;
    if (this.phase === 'ready') {
      if (prev < this.startS && s >= this.startS) {
        this.phase = 'running';
        this.time = 0;
        this.splits = [];
        event = 'start';
      }
      return event;
    }
    if (this.phase !== 'running') return null;
    this.time += dt;
    const next = this.checkpoints[this.splits.length];
    if (next != null && prev < next && s >= next) {
      this.splits.push(this.time);
      const rec = this.record?.splits?.[this.splits.length - 1];
      this.split = rec != null ? this.time - rec : null;
      this.splitTime = 4;
      event = 'split';
    }
    if (prev < this.finishS && s >= this.finishS) {
      this.phase = 'finished';
      const rec = this.record;
      this.lastResult = { time: this.time, previous: rec?.time ?? null, isRecord: !rec || this.time < rec.time };
      if (this.lastResult.isRecord) {
        this.records[this.sectionId] = { time: this.time, splits: this.splits.slice() };
        saveRecords(this.records);
        event = 'record';
      } else {
        event = 'finish';
      }
    }
    return event;
  }
}
