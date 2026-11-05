import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryModel, samePosition} from '../dist/model.js';
import {createSpatialSystem, SCENES, WARNING_SPEED, MAX_OCCUPANTS} from '../dist/behaviors.js';
import {toCell, isOccupiable, distanceToSegment} from '../dist/spatial.js';
import {occupantsAt, objectLocation} from '../dist/locations.js';

const STEP = 50;
function setup(sceneId = null) {
  const box = {model: createDeliveryModel()};
  const system = createSpatialSystem(() => box.model);
  if (sceneId) system.loadScene(sceneId);
  return {...box, box, system, state: box.model.state};
}
// Drives one traversal the way the app's frame loop does.
function traverse({model, system}) {
  const result = model.move(system.obstruction());
  if (result.ok === false) return result;
  let elapsed = 0;
  while (model.state.movement) {
    model.advance(STEP * system.speedFactor());
    system.tick(STEP);
    elapsed += STEP;
    assert.ok(elapsed < 60000, 'traversal did not finish');
  }
  system.tick(STEP);
  return {...result, elapsed};
}
const messages = model => model.state.history.map(entry => entry.message);

test('every scene places occupants on open, distinct cells off the robot', () => {
  for (const scene of SCENES) {
    const {system, state} = setup(scene.id);
    assert.equal(system.occupants().length, scene.occupants.length, scene.id);
    const keys = system.occupants().map(o => `${toCell(o.position).col},${toCell(o.position).row}`);
    assert.equal(new Set(keys).size, keys.length, `${scene.id} shares a cell`);
    for (const occupant of system.occupants()) {
      assert.ok(isOccupiable(toCell(occupant.position)), `${scene.id} ${occupant.id}`);
      assert.ok(!samePosition(occupant.position, state.robot.position), `${scene.id} ${occupant.id}`);
    }
    system.tick(STEP);
  }
});

test('the relations scene shows each of the three relations exactly as designed', () => {
  const {system} = setup('relations');
  const {relations, crowds} = system.tick(STEP).snapshot;
  assert.deepEqual(relations.adjacent.map(pair => [pair.a, pair.b, pair.acrossObstacle]), [['P-1', 'P-2', false], ['P-3', 'P-4', true]]);
  assert.deepEqual(relations.between.map(triple => [triple.a, triple.middle, triple.c]), [['W-1', 'P-5', 'W-2']]);
  assert.deepEqual(relations.among.map(group => [group.center, [...group.others].sort()]), [['P-6', ['W-3', 'W-4', 'W-5']]]);
  assert.equal(crowds.length, 0);
});

test('scenes without a walker do not move their occupants', () => {
  const {system} = setup('relations');
  const before = structuredClone(system.occupants());
  for (let i = 0; i < 40; i++) system.tick(STEP);
  assert.deepEqual(system.occupants(), before);
});

test('occupants snap to cells, and bad placements throw without changing anything', () => {
  const {system} = setup('street');
  const [occupant] = system.occupants(), before = {...occupant.position};
  assert.deepEqual(system.place(occupant.id, {x: 20.7, z: -6.4}).position, {x: 20, z: -6});
  const at = {...occupant.position};
  assert.throws(() => system.place(occupant.id, {x: 16, z: 8}), /not occupiable/, 'inside a building');
  assert.throws(() => system.place(occupant.id, {x: 40, z: 0}), /not occupiable/, 'off the map');
  assert.throws(() => system.place(occupant.id, {x: NaN, z: 0}), /finite/);
  assert.throws(() => system.place(occupant.id, null), /finite/);
  assert.throws(() => system.place(occupant.id, {x: 12, z: -10}), /Another occupant/);
  assert.throws(() => system.place(occupant.id, {x: -12, z: 8}), /robot/);
  assert.throws(() => system.place('nobody', {x: 0, z: 12}), /existing occupant/);
  assert.deepEqual(occupant.position, at);
  assert.notDeepEqual(at, before);
});

test('an occupant may stay in its own cell', () => {
  const {system} = setup('street');
  const [occupant] = system.occupants();
  assert.deepEqual(system.place(occupant.id, occupant.position).position, occupant.position);
});

test('occupants cannot stand on a package waiting on the ground, but can once it is carried', () => {
  const {system, model} = setup('street');
  const [occupant] = system.occupants();
  model.pickup();
  model.move();
  while (model.state.movement) model.advance(STEP);
  assert.equal(system.placementProblem(occupant.id, model.state.package.pickup), null);
  const other = setup('street');
  other.state.robot.position = {x: -2, z: 8};
  assert.match(other.system.placementProblem('P-1', other.state.package.pickup), /package/);
});

test('occupants cannot be dropped on the stretch the robot is traversing', () => {
  const {system, model} = setup('street');
  model.pickup();
  model.move();
  model.advance(500);
  assert.match(system.placementProblem('P-1', {x: -4, z: 8}), /traversing/);
  assert.equal(system.placementProblem('P-1', {x: -2, z: 2}), null, 'a later segment is free');
});

test('dragging a walker stops its walk', () => {
  const {system} = setup('movement');
  const walker = system.occupants()[0];
  assert.ok(walker.walk);
  system.tick(1000);
  system.place(walker.id, {x: 20, z: 12});
  system.tick(1000);
  assert.deepEqual(walker.position, {x: 20, z: 12});
  assert.equal(walker.walk, null);
});

test('adding and removing occupants assigns free ids and respects the limit', () => {
  const {system} = setup('street');
  assert.equal(system.add('person', {x: 20, z: 12}).id, 'P-2');
  system.remove('P-1');
  assert.equal(system.add('person', {x: 20, z: 14}).id, 'P-1');
  assert.throws(() => system.add('dragon', {x: 20, z: 16}), /Choose/);
  assert.throws(() => system.remove('P-9'), /existing occupant/);
  while (system.occupants().length < MAX_OCCUPANTS) system.add('cone', system.firstOpenCell());
  assert.throws(() => system.add('cone', system.firstOpenCell()), /at most/);
});

test('the first open cell is really open and off the route', () => {
  const {system, state} = setup('relations');
  const cell = system.firstOpenCell();
  assert.equal(system.placementProblem(null, cell), null);
  assert.ok(state.segments.every(s => distanceToSegment(cell, s.start, s.end) >= 1));
  assert.ok(Math.hypot(cell.x, cell.z) < 10, 'near the middle of the map, where it can be seen');
});

test('the scene cannot change mid-movement; reset restores the current scene', () => {
  const {system, model} = setup('warning');
  system.place('W-1', {x: 20, z: 12});
  model.pickup();
  model.move();
  assert.throws(() => system.loadScene('street'), /Finish movement/);
  while (model.state.movement) model.advance(STEP);
  system.reset();
  assert.equal(system.sceneId(), 'warning');
  assert.deepEqual(system.occupants()[0].position, {x: -8, z: 10});
  assert.throws(() => system.loadScene('nowhere'), /existing scene/);
});

test('reset after replacing the model repopulates the new model', () => {
  const {system, box} = setup('crowd');
  box.model = createDeliveryModel();
  assert.deepEqual(box.model.state.occupants, []);
  system.reset();
  assert.equal(box.model.state.occupants.length, 3);
});

test('a crowd over the next segment makes the robot wait, and retry works once it disperses', () => {
  const context = setup('crowd');
  const {model, system, state} = context;
  model.pickup();
  assert.match(system.obstruction(), /crowd of 3/);
  const result = traverse(context);
  assert.equal(result.ok, false);
  assert.equal(state.robot.motionState, 'waiting');
  assert.equal(state.nextIndex, 0);
  assert.deepEqual(state.robot.position, state.segments[0].start);
  assert.ok(messages(model).at(-1).startsWith('S1 is blocked by a crowd of 3'));
  assert.equal(state.package.deliveryStatus, 'in transit', 'still carrying');
  system.place('P-2', {x: 20, z: 12});
  assert.equal(system.obstruction(), null);
  assert.equal(state.robot.motionState, 'waiting', 'dispersal alone does not restart the robot');
  assert.ok(traverse(context).elapsed > 0);
  assert.equal(state.nextIndex, 1);
});

test('a crowd away from the next segment does not block it', () => {
  const {system} = setup('crowd');
  ['P-1', 'P-2', 'P-3'].forEach((id, i) => system.place(id, {x: -8 + 2 * i, z: 16}));
  system.tick(STEP);
  assert.equal(system.snapshot().crowds.length, 1);
  assert.equal(system.obstruction(), null);
});

test('forming a crowd is logged once until it dissolves and forms again', () => {
  const {system, model} = setup('crowd');
  const count = () => messages(model).filter(text => text.startsWith('Crowd of 3')).length;
  system.tick(STEP); system.tick(STEP);
  assert.equal(count(), 1);
  system.place('P-2', {x: 20, z: 12});
  system.tick(STEP);
  system.place('P-2', {x: -4, z: 10});
  assert.equal(system.tick(STEP).changed, true);
  assert.equal(count(), 2);
});

test('a single occupant on the next segment makes the robot wait; one beside it does not', () => {
  const context = setup('street');
  const {model, system, state} = context;
  model.pickup();
  assert.equal(system.obstruction(), null, 'P-1 stands beside Market Street');
  system.place('P-1', {x: -6, z: 8});
  assert.match(system.obstruction(), /occupied by P-1/);
  assert.equal(traverse(context).ok, false);
  assert.equal(state.nextIndex, 0);
  system.place('P-1', {x: -6, z: 10});
  traverse(context);
  assert.equal(state.nextIndex, 1);
});

test('the obstruction check only looks at the next segment and stops after the route', () => {
  const context = setup('street');
  const {model, system, state} = context;
  system.place('P-1', {x: -2, z: 2});
  model.pickup();
  assert.equal(system.obstruction(), null, 'on S2 while S1 is next');
  traverse(context);
  assert.match(system.obstruction(), /occupied by P-1/);
  system.place('P-1', {x: 20, z: 12});
  system.place('RC-1', {x: 20, z: 14});
  while (state.nextIndex < state.segments.length) traverse(context);
  assert.equal(system.obstruction(), null);
});

test('a user-blocked segment still reports its own reason first', () => {
  const {model, system, state} = setup('crowd');
  model.pickup();
  model.updateSegment('S1', {blocked: true});
  model.move(system.obstruction());
  assert.equal(state.history.at(-1).message, 'S1 is blocked. Robot is waiting.');
});

test('a cone adjacent to the robot warns and slows it, and speed recovers afterward', () => {
  const context = setup('warning');
  const {model, system} = context;
  model.pickup();
  assert.equal(system.speedFactor(), 1);
  const free = setup('street');
  free.system.place('P-1', {x: 20, z: 12});
  free.model.pickup();
  const baseline = traverse(free).elapsed;
  const slowed = traverse(context).elapsed;
  assert.ok(slowed > baseline, `slowed ${slowed} vs baseline ${baseline}`);
  assert.equal(messages(model).filter(text => text.includes('W-1 is adjacent to the robot')).length, 1);
  assert.equal(system.speedFactor(), 1, 'the cone is left behind');
  assert.equal(system.snapshot().warnings.length, 0);
});

test('the warning applies at the documented speed and only to cones', () => {
  const {system, state} = setup('warning');
  state.robot.position = {x: -8, z: 8};
  system.tick(STEP);
  assert.deepEqual(system.snapshot().warnings, ['W-1']);
  assert.equal(system.speedFactor(), WARNING_SPEED);
  system.remove('W-1');
  system.add('person', {x: -8, z: 10});
  system.tick(STEP);
  assert.equal(system.speedFactor(), 1);
});

test('a recipient adjacent at the destination takes the handoff automatically', () => {
  const context = setup('street');
  const {model, system, state} = context;
  model.pickup();
  while (state.nextIndex < state.segments.length - 1) traverse(context);
  assert.equal(state.package.deliveryStatus, 'in transit');
  traverse(context);
  assert.equal(state.package.deliveryStatus, 'delivered');
  assert.equal(state.robot.carryingId, null);
  assert.ok(messages(model).some(text => text === 'RC-1 is adjacent at the destination. Automatic handoff.'));
  assert.deepEqual(state.package.position, state.package.destination);
  assert.throws(() => model.pickup(), /already been delivered/);
  assert.doesNotThrow(() => system.tick(STEP), 'later ticks do not deliver again');
});

test('without a recipient, arrival still waits for Deliver', () => {
  const context = setup('street');
  const {model, system, state} = context;
  system.remove('RC-1');
  model.pickup();
  while (state.nextIndex < state.segments.length) traverse(context);
  assert.equal(state.package.deliveryStatus, 'in transit');
  assert.equal(state.robot.carryingId, 'PKG-001');
  model.deliver();
  assert.equal(state.package.deliveryStatus, 'delivered');
});

test('a recipient that is not adjacent does not take the handoff until it is placed adjacent', () => {
  const context = setup('street');
  const {model, system, state} = context;
  system.place('RC-1', {x: 14, z: -6});
  model.pickup();
  while (state.nextIndex < state.segments.length) traverse(context);
  assert.equal(state.package.deliveryStatus, 'in transit');
  system.place('RC-1', {x: 12, z: -10});
  system.tick(STEP);
  assert.equal(state.package.deliveryStatus, 'delivered');
});

test('a recipient beside the robot away from the destination does nothing', () => {
  const context = setup('street');
  const {model, system, state} = context;
  system.place('RC-1', {x: -2, z: 10});
  model.pickup();
  traverse(context);
  assert.equal(state.package.deliveryStatus, 'in transit');
  assert.equal(state.nextIndex, 1);
});

test('a recipient does not deliver a package the robot is not carrying', () => {
  const {system, state} = setup('street');
  state.robot.position = {...state.package.destination};
  system.tick(STEP);
  assert.equal(state.package.deliveryStatus, 'waiting');
});

test('an open cell between recipient and destination means no handoff', () => {
  const context = setup('street');
  const {model, system, state} = context;
  system.place('RC-1', {x: 14, z: -10});
  assert.ok(isOccupiable(toCell({x: 12, z: -10})), 'the gap is open');
  model.pickup();
  while (state.nextIndex < state.segments.length) traverse(context);
  assert.equal(state.package.deliveryStatus, 'in transit');
});

test('a recipient across a building counts as adjacent for the handoff', () => {
  const {model, system, state} = setup('street');
  model.pickup();
  const across = {x: 12, z: 8};
  state.package.destination = {...across};
  state.robot.position = {...across};
  state.package.position = {...across};
  system.place('RC-1', {x: 20, z: 8});
  system.tick(STEP);
  assert.equal(state.package.deliveryStatus, 'delivered');
});

test('a whole delivery produces out-of, past, and into for the robot', () => {
  const context = setup('street');
  const {model, state} = context;
  model.pickup();
  while (state.nextIndex < state.segments.length) traverse(context);
  const log = messages(model);
  assert.ok(log.includes('Robot moved out of the pickup zone.'));
  assert.ok(log.includes('Robot moved past P-1.'));
  assert.ok(log.includes('Robot moved into the destination zone.'));
  assert.ok(log.indexOf('Robot moved out of the pickup zone.') < log.indexOf('Robot moved into the destination zone.'));
});

test('the robot reports toward while it closes on its next referent, with a live position', () => {
  const context = setup('street');
  const {model, system} = context;
  system.place('P-1', {x: -2, z: 10});
  system.place('RC-1', {x: 20, z: 12});
  model.pickup();
  model.move(system.obstruction());
  const kinds = new Set();
  while (model.state.movement) {
    model.advance(STEP);
    const {snapshot} = system.tick(STEP);
    for (const trend of snapshot.trends.filter(item => item.mover === 'R-01')) {
      kinds.add(trend.kind);
      assert.deepEqual(trend.moverPosition, model.state.robot.position);
    }
  }
  assert.ok(kinds.has('toward'));
});

test('a walker makes toward, past, and away against a standing person', () => {
  const {system, model} = setup('movement');
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const {snapshot} = system.tick(STEP);
    for (const trend of snapshot.trends) if (trend.mover === 'P-1' && trend.referent === 'P-2') seen.add(trend.kind);
    for (const event of snapshot.events) if (event.mover === 'P-1' && event.referent === 'P-2') seen.add(event.kind);
  }
  assert.ok(seen.has('toward') && seen.has('past') && seen.has('away'), [...seen].join());
  assert.equal(messages(model).filter(text => text.includes('P-1')).length, 0, 'other movers do not flood the activity log');
});

test('events age out of the snapshot', () => {
  const {system, model} = setup('street');
  model.state.robot.position = {x: -5, z: 8};
  system.tick(STEP);
  model.state.robot.position = {x: -12, z: 8};
  system.tick(STEP);
  model.state.robot.position = {x: -2, z: 8};
  system.tick(STEP);
  assert.ok(system.snapshot().events.some(event => event.kind === 'out'));
  for (let i = 0; i < 130; i++) system.tick(STEP);
  assert.equal(system.snapshot().events.length, 0);
  assert.equal(system.snapshot().trails.length, 0);
});

test('placing occupants never touches delivery state', () => {
  const {system, state} = setup('street');
  const keys = ['robot', 'package', 'segments', 'nextIndex', 'distance'];
  const before = structuredClone(keys.map(key => state[key]));
  system.place('P-1', {x: 20, z: 12});
  system.add('cone', {x: 20, z: 14});
  system.remove('W-1');
  system.tick(STEP);
  assert.deepEqual(keys.map(key => state[key]), before);
});

test('the location explorer can find occupants', () => {
  const {system, state} = setup('street');
  const found = occupantsAt(state, {x: -6, z: 10}, 0.5);
  assert.deepEqual(found.map(item => item.id), ['P-1']);
  assert.equal(objectLocation(state, 'RC-1').status, 'recipient');
  system.remove('P-1');
  assert.deepEqual(occupantsAt(state, {x: -6, z: 10}, 0.5), []);
  assert.throws(() => objectLocation(state, 'P-1'));
});
