// Position relations among objects on the occupiable grid. Pure functions of entity positions.
import {toCell, cellCenter, sameCell, cellKey, cellsBetween, isOccupiable} from './spatial.js';

export const BETWEEN_MAX_SPAN = 14;
export const BETWEEN_TOLERANCE = 0.25;
export const AMONG_RADIUS = 6;
export const CROWD_SIZE = 3;
const CROWD_LINK_CELLS = 2;
const CROWD_MARGIN = 1.2;
const PEOPLE = ['person', 'recipient'];

// Carried packages travel with the robot and are not separate objects on the ground.
export function entitiesFrom(state) {
  const entities = [{id: state.robot.id, type: 'robot', position: state.robot.position}];
  if (!state.package.carriedBy) entities.push({id: state.package.id, type: 'package', position: state.package.position});
  return entities.concat((state.occupants || []).map(({id, type, position}) => ({id, type, position})));
}

// Adjacent: distinct cells with no occupiable location between them. An occupied cell
// is still occupiable; a cell inside a building is not, so a wall can make two objects adjacent.
export function findAdjacent(entities) {
  const pairs = [];
  entities.forEach((a, i) => entities.slice(i + 1).forEach(b => {
    const cellA = toCell(a.position), cellB = toCell(b.position);
    if (sameCell(cellA, cellB)) return;
    const gap = cellsBetween(cellA, cellB);
    if (gap.every(cell => !isOccupiable(cell)))
      pairs.push({a: a.id, b: b.id, from: cellCenter(cellA), to: cellCenter(cellB), acrossObstacle: gap.length > 0});
  }));
  return pairs;
}

// Between: the middle object's cell center lies on the straight line joining the two outer objects' cells.
export function findBetween(entities, maxSpan = BETWEEN_MAX_SPAN) {
  const triples = [];
  entities.forEach((a, i) => entities.slice(i + 1).forEach(c => {
    const from = cellCenter(toCell(a.position)), to = cellCenter(toCell(c.position));
    const dx = to.x - from.x, dz = to.z - from.z, span = Math.hypot(dx, dz);
    if (span === 0 || span > maxSpan) return;
    for (const middle of entities) {
      if (middle === a || middle === c) continue;
      const point = cellCenter(toCell(middle.position));
      if (sameCell(toCell(point), toCell(from)) || sameCell(toCell(point), toCell(to))) continue;
      const along = ((point.x - from.x) * dx + (point.z - from.z) * dz) / (span * span);
      const off = Math.abs((point.x - from.x) * dz - (point.z - from.z) * dx) / span;
      if (along > 0 && along < 1 && off <= BETWEEN_TOLERANCE) triples.push({a: a.id, middle: middle.id, c: c.id, from, to, point});
    }
  }));
  return triples;
}

const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

export function convexHull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const half = list => {
    const chain = [];
    for (const p of list) {
      while (chain.length >= 2 && cross(chain.at(-2), chain.at(-1), p) <= 0) chain.pop();
      chain.push(p);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

// Among: strictly inside the outline of at least three other objects within reach.
export function findAmong(entities, radius = AMONG_RADIUS) {
  const results = [];
  for (const center of entities) {
    const cell = toCell(center.position), point = cellCenter(cell);
    const cells = new Map();
    const others = [];
    for (const other of entities) {
      if (other === center) continue;
      const otherCell = toCell(other.position), otherPoint = cellCenter(otherCell);
      if (sameCell(cell, otherCell) || Math.hypot(otherPoint.x - point.x, otherPoint.z - point.z) > radius) continue;
      cells.set(cellKey(otherCell), otherPoint);
      others.push(other.id);
    }
    if (cells.size < 3) continue;
    const hull = convexHull([...cells.values()]);
    if (hull.length < 3) continue;
    if (hull.every((p, i) => cross(p, hull[(i + 1) % hull.length], point) > 0)) results.push({center: center.id, others, point, hull});
  }
  return results;
}

// Crowd: three or more people linked through neighbors at most two cells apart.
export function findCrowds(entities) {
  const people = entities.filter(entity => PEOPLE.includes(entity.type));
  const seen = new Set(), crowds = [];
  for (const start of people) {
    if (seen.has(start)) continue;
    const group = [start];
    seen.add(start);
    for (const member of group) {
      const cell = toCell(member.position);
      for (const other of people) {
        if (seen.has(other)) continue;
        const otherCell = toCell(other.position);
        if (Math.max(Math.abs(cell.col - otherCell.col), Math.abs(cell.row - otherCell.row)) <= CROWD_LINK_CELLS) {
          seen.add(other);
          group.push(other);
        }
      }
    }
    if (group.length < CROWD_SIZE) continue;
    const center = {
      x: group.reduce((sum, entity) => sum + entity.position.x, 0) / group.length,
      z: group.reduce((sum, entity) => sum + entity.position.z, 0) / group.length
    };
    const radius = Math.max(...group.map(entity => Math.hypot(entity.position.x - center.x, entity.position.z - center.z))) + CROWD_MARGIN;
    crowds.push({members: group.map(entity => entity.id).sort(), center, radius});
  }
  return crowds;
}

export const detectRelations = entities => ({
  adjacent: findAdjacent(entities), between: findBetween(entities), among: findAmong(entities)
});
