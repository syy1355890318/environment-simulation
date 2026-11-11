// One agent's spatial knowledge: the cells it has seen and the landmarks it has left.
import {W, H, UNKNOWN, HINDRANCE, centerOf, passable, distance} from './nav.js';

const NOTES = {
  exhibit: 'An exhibit to see.', charger: 'Recharges a battery.', depot: 'Parcels are collected here.',
  gate: 'Where I came in.', hindrance: 'Slow ground. Costs three times the energy.'
};
const HINDRANCE_SPACING = 7;

export function createMemory() {
  const cells = new Uint8Array(W * H), swept = new Uint8Array(W * H), landmarks = [];
  let known = 0, passableKnown = 0, serial = 0;

  function leave(data, time) {
    const landmark = {id: `L${++serial}`, foundAt: time, visits: 0, routes: {}, note: NOTES[data.kind], ...data, position: {...data.position}};
    landmarks.push(landmark);
    return landmark;
  }

  // Records a percept and returns the landmarks it led to.
  function observe(percept, time) {
    const found = [];
    percept.cells.forEach((index, n) => {
      const before = cells[index], type = percept.types[n];
      if (before === UNKNOWN) known++;
      passableKnown += (passable(type) ? 1 : 0) - (passable(before) ? 1 : 0);
      cells[index] = type;
      swept[index] = 1;
      if (type === HINDRANCE && before !== HINDRANCE) {
        const position = centerOf(index);
        if (!landmarks.some(item => item.kind === 'hindrance' && distance(item.position, position) < HINDRANCE_SPACING))
          found.push(leave({kind: 'hindrance', name: 'Slow ground', position, cell: index}, time));
      }
    });
    for (const place of percept.places) {
      if (!landmarks.some(item => item.placeId === place.id))
        found.push(leave({kind: place.kind, name: place.name, placeId: place.id, position: place.position, cell: place.cell}, time));
    }
    return found;
  }

  // Remember how far it was to walk between two landmarks, keeping the shortest.
  function recordRoute(from, to, length) {
    if (!from || from === to) return;
    const best = Math.min(length, from.routes[to.id] ?? Infinity);
    from.routes[to.id] = to.routes[from.id] = best;
  }

  // Without landmarks nothing about where things are carries over, so the city must be searched again.
  function startTrip(keepLandmarks) {
    if (keepLandmarks) return;
    landmarks.length = 0;
    swept.fill(0);
  }

  return {
    cells, swept, landmarks, observe, recordRoute, startTrip,
    resweep: () => swept.fill(0),
    landmarkFor: placeId => landmarks.find(item => item.placeId === placeId) || null,
    stats: () => ({known, passableKnown, landmarks: landmarks.length})
  };
}
