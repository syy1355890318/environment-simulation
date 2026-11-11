// The true state of the city. Agents never read this; only perception does, on their behalf.
import {PLACES, HINDRANCES} from './city.js';
import {toCell, isOccupiable} from './spatial.js';
import {W, H, FREE, OBSTACLE, HINDRANCE, indexOf, centerOf} from './nav.js';

const GOAL_KINDS = ['exhibit', 'charger', 'depot'];

export function createTruth(gates = []) {
  const base = new Uint8Array(W * H);
  for (let index = 0; index < base.length; index++) base[index] = isOccupiable(toCell(centerOf(index))) ? FREE : OBSTACLE;
  const cells = new Uint8Array(W * H);
  const places = [...PLACES.filter(item => GOAL_KINDS.includes(item.kind)), ...gates]
    .map(item => ({...item, cell: indexOf(item.position.x, item.position.z)}));

  function slow(x0, x1, z0, z1) {
    for (let x = x0 + .5; x < x1; x++) for (let z = z0 + .5; z < z1; z++) {
      const index = indexOf(x, z);
      if (index >= 0 && base[index] === FREE) cells[index] = HINDRANCE;
    }
  }
  // Roadworks are fixed; a cone slows the 2 m cell it stands on.
  function setCones(positions = []) {
    cells.set(base);
    for (const zone of HINDRANCES) slow(zone.x0, zone.x1, zone.z0, zone.z1);
    for (const p of positions) slow(p.x - 1, p.x + 1, p.z - 1, p.z + 1);
  }
  setCones();
  return {cells, places, setCones, passableCount: base.reduce((sum, type) => sum + (type === FREE ? 1 : 0), 0)};
}
