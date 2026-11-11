import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BUILDINGS, toCell, cellCenter, snapToCell, cellsBetween, isOccupiable, distanceToSegment, advanceWalk} from '../dist/spatial.js';
import {findAdjacent, findBetween, findAmong, findCrowds, convexHull, entitiesFrom} from '../dist/relations.js';
import {createDeliveryModel} from '../dist/model.js';

const entity = (id, x, z, type = 'person') => ({id, type, position: {x, z}});
const pairs = list => findAdjacent(list).map(pair => `${pair.a}-${pair.b}`);
const middles = list => findBetween(list).map(triple => `${triple.a}|${triple.middle}|${triple.c}`);

test('cells are 2 m squares centered on even coordinates, without negative zero', () => {
  assert.deepEqual(toCell({x: -0.4, z: 0.4}), {col: 0, row: 0});
  assert.deepEqual(cellCenter({col: 0, row: 0}), {x: 0, z: 0});
  assert.deepEqual(snapToCell({x: 3.2, z: -6.9}), {x: 4, z: -6});
  assert.deepEqual(snapToCell({x: 2.9, z: -7.1}), {x: 2, z: -8});
});

test('every route node and route cell is occupiable', () => {
  const {segments} = createDeliveryModel().state;
  for (const s of segments) {
    const a = toCell(s.start), b = toCell(s.end);
    for (const cell of [a, b, ...cellsBetween(a, b)]) assert.ok(isOccupiable(cell), `${s.id} ${cell.col},${cell.row}`);
  }
});

test('building footprints and off-map cells are not occupiable; open ground is', () => {
  for (const b of BUILDINGS) assert.equal(isOccupiable(toCell({x: b.x, z: b.z})), false, `${b.x},${b.z}`);
  assert.equal(isOccupiable(toCell({x: 48, z: 0})), false);
  assert.equal(isOccupiable(toCell({x: 0, z: 36})), false);
  assert.equal(isOccupiable(toCell({x: 22, z: 2})), true, 'the plaza');
  assert.equal(isOccupiable(toCell({x: 12, z: 8})), true, 'Market Street');
});

test('cells between two cells are symmetric and exclude the endpoints', () => {
  const a = {col: 0, row: 0}, b = {col: 3, row: 1};
  assert.deepEqual(cellsBetween(a, b), cellsBetween(b, a));
  assert.deepEqual(cellsBetween(a, {col: 3, row: 0}), [{col: 1, row: 0}, {col: 2, row: 0}]);
  assert.deepEqual(cellsBetween(a, {col: 1, row: 1}), []);
  assert.deepEqual(cellsBetween(a, a), []);
});

test('adjacent means no occupiable cell between, orthogonally or diagonally', () => {
  assert.deepEqual(pairs([entity('A', 20, 0), entity('B', 20, 2)]), ['A-B']);
  assert.deepEqual(pairs([entity('A', 20, 0), entity('B', 22, 2)]), ['A-B']);
  assert.deepEqual(pairs([entity('A', 20, 0), entity('B', 20, 4)]), [], 'one open cell separates them');
});

test('adjacent does not depend on argument order', () => {
  const a = entity('A', 4, -2), b = entity('B', 4, 6);
  assert.equal(findAdjacent([a, b]).length, 1);
  assert.equal(findAdjacent([b, a]).length, 1);
});

test('objects sharing a cell are co-located, not adjacent', () => {
  assert.deepEqual(pairs([entity('A', 20, -6), entity('B', 20, -6)]), []);
  assert.deepEqual(pairs([entity('A', 20, -6), entity('B', 20.4, -6.4)]), []);
});

test('a building between two objects makes them adjacent, marked as across an obstacle', () => {
  const [pair] = findAdjacent([entity('A', 4, -2), entity('B', 4, 6)]);
  assert.equal(pair.acrossObstacle, true);
  assert.equal(findAdjacent([entity('A', 20, 0), entity('B', 20, 2)])[0].acrossObstacle, false);
});

test('an open cell beside a building keeps objects non-adjacent', () => {
  assert.deepEqual(pairs([entity('A', 4, -2), entity('B', 4, 8)]), [], '(4, 6) is open');
});

test('an occupied cell is still occupiable, so the outer objects are not adjacent', () => {
  assert.deepEqual(pairs([entity('A', 20, 0), entity('M', 20, 2), entity('C', 20, 4)]).sort(), ['A-M', 'M-C']);
});

test('moving objects are judged by the cell they currently occupy', () => {
  assert.deepEqual(pairs([entity('A', 20.9, 2.9), entity('B', 20, 0)]), ['A-B'], 'A rounds to (20, 2)');
  assert.deepEqual(pairs([entity('A', 20.9, 3.1), entity('B', 20, 0)]), [], 'A rounds to (20, 4)');
});

test('between requires the middle on the straight line between the outer objects', () => {
  assert.deepEqual(middles([entity('A', -2, -8), entity('B', 2, -8), entity('C', 6, -8)]), ['A|B|C']);
  assert.deepEqual(middles([entity('A', 0, -8), entity('B', 4, -4), entity('C', 8, 0)]), ['A|B|C'], 'diagonal');
});

test('between rejects objects off the line, beyond the ends, or sharing an end cell', () => {
  assert.deepEqual(middles([entity('A', -2, -8), entity('B', 2, -6), entity('C', 6, -8)]), []);
  assert.deepEqual(middles([entity('A', -2, -8), entity('C', 2, -8), entity('B', 6, -8)]).filter(t => t === 'A|B|C'), []);
  assert.deepEqual(middles([entity('A', -2, -8), entity('B', -2, -8), entity('C', 6, -8)]), []);
});

test('between does not fire for near-misses on shallow lines', () => {
  assert.deepEqual(middles([entity('A', -12, 8), entity('B', -8, 10), entity('C', -6, 10)]), []);
});

test('between ignores outer objects beyond its span', () => {
  assert.deepEqual(middles([entity('A', -8, 12), entity('B', 0, 12), entity('C', 8, 12)]), []);
  assert.equal(findBetween([entity('A', -8, 12), entity('B', 0, 12), entity('C', 8, 12)], 16).length, 1);
});

test('convex hull drops interior and collinear points', () => {
  const hull = convexHull([{x: 0, z: 0}, {x: 4, z: 0}, {x: 2, z: 0}, {x: 4, z: 4}, {x: 0, z: 4}, {x: 2, z: 2}]);
  assert.equal(hull.length, 4);
  assert.ok(!hull.some(p => p.x === 2));
});

test('among requires strictly inside at least three others', () => {
  const center = entity('X', -8, 14);
  const others = [entity('A', -12, 16), entity('B', -4, 16), entity('C', -8, 10)];
  const [result] = findAmong([center, ...others]);
  assert.equal(result.center, 'X');
  assert.deepEqual(result.others.sort(), ['A', 'B', 'C']);
  assert.equal(findAmong([center, others[0], others[1]]).length, 0, 'two others are not enough');
});

test('among rejects outside points, boundary points, and flat outlines', () => {
  const triangle = [entity('A', -12, 16), entity('B', -4, 16), entity('C', -8, 10)];
  assert.ok(!findAmong([entity('X', -14, 12), ...triangle]).some(r => r.center === 'X'), 'outside');
  assert.ok(!findAmong([entity('X', -8, 16), ...triangle]).some(r => r.center === 'X'), 'on an edge');
  const line = [entity('A', 0, 12), entity('B', 2, 12), entity('C', 6, 12)];
  assert.equal(findAmong([entity('X', 4, 12), ...line]).length, 0, 'collinear outline');
});

test('among counts distinct cells, so co-located objects do not form an outline', () => {
  const stacked = [entity('A', -12, 16), entity('A2', -12, 16), entity('B', -4, 16)];
  assert.equal(findAmong([entity('X', -8, 15), ...stacked]).length, 0);
});

test('among ignores objects outside its radius', () => {
  const far = [entity('A', -16, 18), entity('B', 0, 18), entity('C', -8, 6)];
  assert.equal(findAmong([entity('X', -8, 14), ...far]).length, 0);
  assert.equal(findAmong([entity('X', -8, 14), ...far], 10).length, 1);
});

test('crowds need three people linked within two cells; cones and robots do not count', () => {
  assert.equal(findCrowds([entity('A', 0, 12), entity('B', 4, 12)]).length, 0);
  const [crowd] = findCrowds([entity('A', 0, 12), entity('B', 4, 12), entity('C', 8, 12)]);
  assert.deepEqual(crowd.members, ['A', 'B', 'C'], 'linked transitively');
  assert.equal(findCrowds([entity('A', 0, 12), entity('B', 4, 12), entity('C', 10, 12)]).length, 0, 'too far');
  assert.equal(findCrowds([entity('A', 0, 12), entity('B', 2, 12), entity('C', 4, 12, 'cone')]).length, 0);
  assert.equal(findCrowds([entity('A', 0, 12), entity('B', 2, 12), entity('C', 4, 12, 'robot')]).length, 0);
  assert.equal(findCrowds([entity('A', 0, 12), entity('B', 2, 12), entity('C', 4, 12, 'recipient')]).length, 1);
});

test('a crowd circle encloses every member', () => {
  const list = [entity('A', 0, 12), entity('B', 4, 12), entity('C', 2, 16)];
  const [crowd] = findCrowds(list);
  for (const member of list) assert.ok(Math.hypot(member.position.x - crowd.center.x, member.position.z - crowd.center.z) < crowd.radius);
});

test('a carried package is not a separate object on the ground', () => {
  const model = createDeliveryModel();
  assert.deepEqual(entitiesFrom(model.state).map(item => item.id), ['R-01', 'PKG-001']);
  model.pickup();
  assert.deepEqual(entitiesFrom(model.state).map(item => item.id), ['R-01']);
});

test('distance to a segment clamps at its ends', () => {
  const start = {x: 0, z: 0}, end = {x: 10, z: 0};
  assert.equal(distanceToSegment({x: 5, z: 3}, start, end), 3);
  assert.equal(distanceToSegment({x: -4, z: 3}, start, end), 5);
  assert.equal(distanceToSegment({x: 2, z: 2}, start, start), Math.hypot(2, 2));
});

test('walkers go back and forth at their speed and spend leftover distance on the next leg', () => {
  const walker = {position: {x: 0, z: 0}, walk: {path: [{x: 0, z: 0}, {x: 4, z: 0}], speed: 2, target: 1, direction: 1}};
  advanceWalk(walker, 1000);
  assert.deepEqual(walker.position, {x: 2, z: 0});
  advanceWalk(walker, 1500);
  assert.deepEqual(walker.position, {x: 3, z: 0}, 'overshot the end and turned back');
  assert.equal(walker.walk.target, 0);
  advanceWalk(walker, 2000);
  assert.deepEqual(walker.position, {x: 1, z: 0}, 'turned at the start');
  const still = {position: {x: 1, z: 1}, walk: null};
  advanceWalk(still, 1000);
  assert.deepEqual(still.position, {x: 1, z: 1});
});
