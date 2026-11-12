// The roads you can drive.
import { Road } from './road.js';
import { AKINA_POINTS } from './akinaMap.js';
import { dragonPoints } from './dragonMap.js';

export const TRACKS = {
  akina: {
    name: 'Akina',
    blurb: '5 km downhill · five hairpins',
    road: () => new Road(AKINA_POINTS, 5000),
    cornerLights: true,
  },
  dragon: {
    name: "Dragon's Tail",
    blurb: '8 km · hundreds of corners, no straights',
    road: () => new Road(dragonPoints(8000), 0, { world: true, gradeBase: 0.02, twistGain: 0.2 }),
    cornerLights: false,
  },
};
