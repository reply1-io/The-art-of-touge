// Several roads seen as one, for the ground around them: the loop plus its link roads. The loop's
// samples come first, with their own indices, then each link's. Provides what the terrain needs
// from a road: positions, heights, headings and banking, and a lookup of samples near a point.
export class RoadSet {
  // main: the loop (Road). links: [{ road, a, b }] where a and b are the loop samples it joins.
  constructor(main, links) {
    this.main = main;
    this.roads = [main, ...links.map((l) => l.road)];
    this.top = main.top;
    this.w = main.w;
    this.count = this.roads.reduce((n, r) => n + r.count, 0);
    for (const key of ['x', 'y', 'z', 'heading', 'bank', 'kappa']) this[key] = new Float64Array(this.count);
    this.owner = new Uint16Array(this.count);
    this.local = new Uint32Array(this.count);
    // For a link sample, the loop sample at the nearer of its two junctions (for anything that is
    // grouped along the loop, such as which trees cull together).
    this.mainIdx = new Uint32Array(this.count);
    let o = 0;
    this.roads.forEach((r, k) => {
      for (const key of ['x', 'y', 'z', 'heading', 'bank', 'kappa']) this[key].set(r[key], o);
      for (let i = 0; i < r.count; i++) {
        this.owner[o + i] = k;
        this.local[o + i] = i;
        this.mainIdx[o + i] = k === 0 ? i : i < r.count / 2 ? links[k - 1].a : links[k - 1].b;
      }
      o += r.count;
    });
    this.cell = 24;
    this.hash = new Map();
    for (let i = 0; i < this.count; i++) {
      const key = `${Math.floor(this.x[i] / this.cell)},${Math.floor(this.z[i] / this.cell)}`;
      let list = this.hash.get(key);
      if (!list) this.hash.set(key, (list = []));
      list.push(i);
    }
  }

  forEachNear(x, z, radius, fn) {
    const c = this.cell;
    const r = Math.ceil(radius / c);
    const cx = Math.floor(x / c);
    const cz = Math.floor(z / c);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const list = this.hash.get(`${cx + dx},${cz + dz}`);
        if (list) for (const i of list) fn(i);
      }
    }
  }

  pointAt(i, l, dy = 0) {
    return this.roads[this.owner[i]].pointAt(this.local[i], l, dy);
  }
}
