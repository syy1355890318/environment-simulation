// What an agent can sense right now: a cone of vision that walls block, plus its immediate surroundings.
import {W, OBSTACLE, indexOf, centerOf, distance} from './nav.js';

export const VISION = {range: 10, fov: 100 * Math.PI / 180, near: 1.6};
const SAMPLE = 0.4;

export const angleBetween = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// True when nothing opaque lies between the eye and the target cell. The target itself may be a wall.
export function lineOfSight(cells, eye, target, targetIndex) {
  const length = distance(eye, target), steps = Math.ceil(length / SAMPLE);
  for (let step = 1; step < steps; step++) {
    const index = indexOf(eye.x + (target.x - eye.x) * step / steps, eye.z + (target.z - eye.z) * step / steps);
    if (index === targetIndex) return true;
    if (index < 0 || cells[index] === OBSTACLE) return false;
  }
  return true;
}

export function inView(observer, point, vision = VISION) {
  const d = distance(observer.position, point);
  if (d > vision.range) return false;
  if (d <= vision.near) return true;
  return angleBetween(Math.atan2(point.z - observer.position.z, point.x - observer.position.x), observer.heading) <= vision.fov / 2;
}

export function perceive(truth, observer, others = [], vision = VISION) {
  const eye = observer.position, cells = [], types = [];
  const reach = Math.ceil(vision.range), home = indexOf(eye.x, eye.z);
  const seen = new Set();
  for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
    const index = indexOf(eye.x + dx, eye.z + dz);
    if (index < 0) continue;
    const center = centerOf(index);
    if (!inView(observer, center, vision)) continue;
    if (index !== home && !lineOfSight(truth.cells, eye, center, index)) continue;
    cells.push(index);
    types.push(truth.cells[index]);
    seen.add(index);
  }
  return {
    cells, types,
    places: truth.places.filter(place => seen.has(place.cell)),
    agents: others.filter(other => inView(observer, other.position, vision) && lineOfSight(truth.cells, eye, other.position, indexOf(other.position.x, other.position.z)))
      .map(other => ({id: other.id, position: {...other.position}, heading: other.heading}))
  };
}
