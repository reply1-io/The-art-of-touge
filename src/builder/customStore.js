// Cars you build in the Car Builder, kept in this browser. No three.js here, so the car list
// (config.js) can read them.
//
// A design: { id: 'custom-…', name, base: 'e30' | 'rx7' (how it drives, and its wheels),
//   paint: '#rrggbb', parts: [part] }
// A part: { type: 'box' | 'wedge' | 'taper' | 'cyl' | 'ball',
//   p: [x, y, z] metres (x left, y up from the ground, z forward), s: [width, height, length],
//   r: [pitch, yaw, roll] degrees, mat: 'paint' | 'trim' | 'black' | 'chrome' | 'glass' | 'head' |
//   'tail' | 'color', color: '#rrggbb' (for 'color'), mirror: true (a copy on the other side),
//   t: 0..1 (taper: how narrow the top is) }

export const STORE_KEY = 'touge.customCars.v1';

export function loadDesigns() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY));
    return Array.isArray(list) ? list.filter((d) => d && d.id && Array.isArray(d.parts)) : [];
  } catch {
    return [];
  }
}

export function saveDesigns(list) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function saveDesign(design) {
  const list = loadDesigns().filter((d) => d.id !== design.id);
  list.push(design);
  return saveDesigns(list);
}

export function deleteDesign(id) {
  return saveDesigns(loadDesigns().filter((d) => d.id !== id));
}

export function newId() {
  return 'custom-' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
}
