// The roads you can drive: the Dragon's Tail, 8 km of corner after corner through the forest, and
// four real roads (see realRoads.js), each in both directions.
import { Road } from './road.js';
import { dragonPoints } from './dragonMap.js';
import { REAL_TRACKS } from './realRoads.js';

export const TRACKS = {
  dragon: {
    name: "Dragon's Tail",
    blurb: '8 km · hundreds of corners, no straights',
    region: 'Forest pass',
    desc: 'Hundreds of tight corners and not one straight, through cedar and maple forest from the gas station to the village. Your cabin and workshop are 2 km in.',
    road: () => new Road(dragonPoints(8000), 0, { world: true, gradeBase: 0.02, twistGain: 0.2 }),
    cornerLights: false,
    relief: 150,
    peaks: 1100,
    waterfalls: 5,
    rockCuts: true,
    // A gas station at the start, the car-show lot halfway, and your cabin and workshop in the
    // forest about 2 km in.
    stopsOpts: { homeAt: 2000 },
  },
  ...REAL_TRACKS,
};
