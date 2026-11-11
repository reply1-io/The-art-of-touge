// The pass, traced from a top-down map of Mt. Akina (Haruna), in map pixels (x east, y south),
// listed downhill: from the summit by the lake (top right) to the town at the bottom (bottom left).
// The tight wiggles in section 3 are laid out as a chain of five consecutive switchback hairpins.

// Five switchbacks: six strands 8 px apart joined by semicircular hairpins, alternating west and east.
function hairpinChain() {
  const ys = [122, 130, 138, 146, 154, 162];
  const west = 173;
  const east = 194;
  const pts = [[195.5, 117], [193.5, 120.6]];
  for (let k = 0; k < ys.length; k++) {
    const y = ys[k];
    const goingWest = k % 2 === 0;
    const [from, to] = goingWest ? [k === 0 ? 190 : east - 4, west] : [west + 4, east];
    pts.push([from, y], [(from + to) / 2, y], [to, y]);
    if (k === ys.length - 1) break;
    // Semicircle round the end of this strand to the next one.
    const dir = goingWest ? -1 : 1;
    for (const a of [-60, -30, 0, 30, 60]) {
      const r = (a * Math.PI) / 180;
      pts.push([to + dir * 4 * Math.cos(r), y + 4 + 4 * Math.sin(r)]);
    }
  }
  pts.push([198, 163.5], [200, 168]);
  return pts;
}

export const AKINA_POINTS = [
  // Section 4: summit, lakeside start, then the flowing esses heading west.
  [372, 100], [366, 106], [360, 113], [353, 122], [347, 128], [341, 123], [337, 112], [334, 103],
  [329, 98], [324, 102], [321, 113], [317, 125], [311, 130], [304, 127], [297, 118], [291, 111],
  [284, 109], [276, 113], [268, 116], [263, 111], [261, 100], [263, 89], [267, 79], [266, 71],
  [256, 66], [240, 62], [222, 58], [208, 56], [199, 58], [197, 64], [204, 69], [216, 72],
  [222, 80], [218, 92], [211, 104], [204, 109], [198, 108], [195, 113],
  // Section 3: the five-hairpin chain, switchbacking down the slope (generated above).
  ...hairpinChain(),
  [200, 176], [199, 186], [201, 195],
  [208, 203], [221, 209], [233, 214], [240, 220], [239, 227], [230, 227], [217, 221], [203, 215],
  [188, 212], [172, 211], [152, 209], [131, 213], [116, 217], [106, 225], [103, 236],
  // Section 2: back east along the wavy lower road, then the long fast diagonal.
  [110, 242], [120, 237], [132, 232], [143, 237], [158, 234], [174, 235], [189, 231], [199, 236],
  [205, 243], [203, 250], [193, 254], [175, 258], [158, 266], [142, 277], [128, 285], [117, 291],
  [109, 298], [100, 303], [94, 311],
  // Section 1: the fast run south into the hard hairpin, the narrow loop, and down into town.
  [91, 323], [93, 338], [97, 350], [99, 359], [95, 366], [86, 365], [78, 356], [66, 343],
  [57, 331], [50, 320], [43, 317], [38, 323], [40, 334], [48, 345], [61, 357], [74, 368],
  [80, 380], [76, 395], [68, 412], [61, 432], [57, 448], [55, 462],
];
