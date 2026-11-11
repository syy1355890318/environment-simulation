// The navigation grid agents move and remember on: 1 m cells, four to each 2 m occupancy cell.
import {SIZE} from './city.js';

export const W = SIZE.x * 2, H = SIZE.z * 2;
export const UNKNOWN = 0, FREE = 1, OBSTACLE = 2, HINDRANCE = 3;

export const indexOf = (x, z) => {
  const i = Math.floor(x + SIZE.x), j = Math.floor(z + SIZE.z);
  return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i;
};
export const centerOf = index => ({x: index % W - SIZE.x + .5, z: Math.floor(index / W) - SIZE.z + .5});
export const passable = type => type === FREE || type === HINDRANCE;
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
