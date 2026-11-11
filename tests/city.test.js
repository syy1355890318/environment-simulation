import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SIZE, BLOCKS, BUILDINGS, STREETS, PLACES} from '../dist/city.js';
import {BOUNDS, CELL, toCell, cellCenter, cellKey, isOccupiable} from '../dist/spatial.js';
import {describeCityPosition, findInCity, occupantsAt} from '../dist/locations.js';
import {createDeliveryModel} from '../dist/model.js';
import {createSpatialSystem, SCENES} from '../dist/behaviors.js';
import {entitiesFrom} from '../dist/relations.js';

const openCells = [];
for (let x = -SIZE.x; x <= SIZE.x; x += CELL) for (let z = -SIZE.z; z <= SIZE.z; z += CELL) {
  if (isOccupiable(toCell({x, z}))) openCells.push({x, z});
}
// Cells a street covers, by walking its centerline and widening to its width.
function streetCells(street) {
  const cells = [], alongX = street.start.z === street.end.z, half = street.width / 2 - 1;
  const length = Math.hypot(street.end.x - street.start.x, street.end.z - street.start.z);
  for (let d = 0; d <= length; d += CELL) for (let side = -half; side <= half; side += CELL) {
    cells.push(alongX ? {x: street.start.x + d, z: street.start.z + side} : {x: street.start.x + side, z: street.start.z + d});
  }
  return cells;
}

test('the city is about four times the old 46 by 38 m map', () => {
  assert.deepEqual(SIZE, {x: 48, z: 36});
  assert.ok(SIZE.x * 2 * SIZE.z * 2 >= 3.9 * 46 * 38);
});

test('there are at least eight streets and several alleys, all with distinct names', () => {
  assert.ok(STREETS.filter(street => street.width === 6).length >= 8);
  assert.ok(STREETS.filter(street => street.width === 2).length >= 3);
  assert.equal(new Set(STREETS.map(street => street.name)).size, STREETS.length);
  assert.equal(new Set(STREETS.map(street => street.id)).size, STREETS.length);
});

test('every street runs straight along an axis and is open for its whole length and width', () => {
  for (const street of STREETS) {
    assert.ok(street.start.x === street.end.x || street.start.z === street.end.z, street.name);
    for (const cell of streetCells(street)) assert.ok(isOccupiable(toCell(cell)), `${street.name} at ${cell.x}, ${cell.z}`);
  }
});

test('an alley is exactly one cell wide', () => {
  for (const street of STREETS.filter(item => item.width === 2)) {
    const alongX = street.start.z === street.end.z;
    // Sample a stretch flanked by buildings: Lantern Alley and Mill Lane cross other streets elsewhere.
    const sample = {'lantern-alley': {x: -16, z: -28}, 'mill-lane': {x: -40, z: -12}, 'tanner-alley': {x: 38, z: -14}, 'baker-yard': {x: 40, z: 16}}[street.id];
    assert.ok(isOccupiable(toCell(sample)), street.name);
    for (const side of [-CELL, CELL]) {
      const beside = alongX ? {x: sample.x, z: sample.z + side} : {x: sample.x + side, z: sample.z};
      assert.equal(isOccupiable(toCell(beside)), false, `${street.name} beside ${beside.x}, ${beside.z}`);
    }
  }
});

test('every open cell can be reached from every other', () => {
  const open = new Set(openCells.map(cell => cellKey(toCell(cell))));
  const seen = new Set([cellKey(toCell(openCells[0]))]), queue = [toCell(openCells[0])];
  while (queue.length) {
    const {col, row} = queue.pop();
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = {col: col + dc, row: row + dr}, key = cellKey(next);
      if (open.has(key) && !seen.has(key)) { seen.add(key); queue.push(next); }
    }
  }
  assert.equal(seen.size, open.size);
});

test('open cells are streets, the plaza, or the park, and nothing else', () => {
  const allowed = new Set(STREETS.flatMap(streetCells).map(cell => cellKey(toCell(cell))));
  for (const block of BLOCKS.filter(item => item.kind !== 'building')) {
    for (let x = Math.ceil(block.x0 / 2) * 2; x <= block.x1; x += CELL) for (let z = Math.ceil(block.z0 / 2) * 2; z <= block.z1; z += CELL) allowed.add(cellKey(toCell({x, z})));
  }
  const strays = openCells.filter(cell => !allowed.has(cellKey(toCell(cell))));
  assert.deepEqual(strays, []);
});

test('buildings stay inside the map and never overlap', () => {
  BUILDINGS.forEach((a, i) => {
    assert.ok(a.w >= 3 && a.d >= 3, `building ${i} is at least 3 m each way`);
    assert.ok(Math.abs(a.x) + a.w / 2 <= SIZE.x && Math.abs(a.z) + a.d / 2 <= SIZE.z);
    for (const b of BUILDINGS.slice(i + 1)) {
      assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.z - b.z) >= (a.d + b.d) / 2, `buildings ${i} overlap`);
    }
  });
});

test('there is no ring of open cells around the edge of the map', () => {
  assert.ok(BOUNDS.x < SIZE.x && BOUNDS.z < SIZE.z);
  for (const corner of [{x: 44, z: 32}, {x: -44, z: 32}, {x: 44, z: -32}, {x: -44, z: -32}]) assert.equal(isOccupiable(toCell(corner)), false);
});

test('every place stands on an open cell, with five exhibits and two chargers', () => {
  for (const place of PLACES) {
    assert.ok(isOccupiable(toCell(place.position)), place.name);
    assert.deepEqual(cellCenter(toCell(place.position)), place.position, `${place.name} is on a cell center`);
  }
  assert.equal(PLACES.filter(place => place.kind === 'exhibit').length, 5);
  assert.equal(PLACES.filter(place => place.kind === 'charger').length, 2);
});

test('the chargers sit in alleys, so finding them takes exploring', () => {
  for (const charger of PLACES.filter(place => place.kind === 'charger')) {
    assert.match(describeCityPosition({x: charger.position.x + 4, z: charger.position.z}), /^On (Mill Lane|Baker Yard)$/);
  }
});

test('positions are described by place, street, junction, open space, or nearest place', () => {
  assert.equal(describeCityPosition({x: 24, z: 4}), 'At Fountain');
  assert.equal(describeCityPosition({x: 20, z: 8}), 'On Market Street');
  assert.equal(describeCityPosition({x: -2, z: 8}), 'Market Street and Garden Passage junction');
  assert.equal(describeCityPosition({x: 16, z: 0}), 'In the plaza');
  assert.equal(describeCityPosition({x: -24, z: 14}), 'In the park');
  assert.match(describeCityPosition({x: 4, z: 2}), /^\d+(\.\d+)? m from /);
  assert.throws(() => describeCityPosition({x: NaN, z: 0}));
});

test('search finds places and streets by name, offers candidates, and invents nothing', () => {
  assert.deepEqual(findInCity('fountain').position, {x: 24, z: 4});
  assert.equal(findInCity(' Market Street ').kind, 'segment');
  assert.equal(findInCity('market').name, 'Market Street');
  assert.equal(findInCity('Market Street').length, 88);
  const chargers = findInCity('charger');
  assert.equal(chargers.kind, 'candidates');
  assert.deepEqual(chargers.candidates.map(item => item.name), ['Charger A', 'Charger B']);
  assert.equal(findInCity('pickup').kind, 'error');
  assert.equal(findInCity('').kind, 'error');
});

test('with delivery off, the robot and package are not on the map', () => {
  const model = createDeliveryModel();
  model.state.delivery = false;
  const system = createSpatialSystem(() => model);
  system.loadScene('city');
  assert.deepEqual(entitiesFrom(model.state), []);
  const pickup = model.state.package.pickup;
  assert.equal(system.placementProblem(null, pickup), null, 'the robot cell is free');
  const person = system.add('person', pickup);
  assert.deepEqual(occupantsAt(model.state, pickup, 0.5).map(item => item.id), [person.id]);
  const {snapshot} = system.tick(50);
  assert.deepEqual(snapshot.zones, []);
  assert.deepEqual(snapshot.relations, {adjacent: [], between: [], among: []});
});

test('with delivery off, relations and movement among occupants still work and nothing is logged for the robot', () => {
  const model = createDeliveryModel();
  model.state.delivery = false;
  const system = createSpatialSystem(() => model);
  system.loadScene('relations');
  const {relations} = system.tick(50).snapshot;
  assert.equal(relations.adjacent.length, 2);
  assert.equal(relations.between.length, 1);
  assert.equal(relations.among.length, 1);
  system.loadScene('movement');
  const seen = new Set();
  for (let i = 0; i < 200; i++) for (const event of system.tick(50).snapshot.events) seen.add(`${event.kind} ${event.mover}`);
  assert.ok(seen.has('past P-1'));
  assert.ok(model.state.history.every(entry => !entry.message.startsWith('Robot moved')));
});

test('scenes that need the robot are marked, and the rest include an empty city', () => {
  assert.deepEqual(SCENES.filter(scene => scene.delivery).map(scene => scene.id), ['street', 'crowd', 'warning']);
  assert.deepEqual(SCENES.filter(scene => !scene.delivery).map(scene => scene.id), ['city', 'relations', 'movement']);
  assert.deepEqual(SCENES[0].occupants, []);
});
