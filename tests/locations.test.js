import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryModel} from '../dist/model.js';
import {toFrame, fromFrame, getLandmarks, describePosition, segmentsAt, objectLocation, occupantsAt, resolveDescription} from '../dist/locations.js';

test('landmarks uniquely identify the three shared junctions and both path memberships', () => {
  const state = createDeliveryModel().state;
  assert.equal(getLandmarks(state).length, 5);
  const junction = {x: -2, z: 8};
  assert.equal(describePosition(state, junction), 'At Market Street–Garden Passage junction');
  assert.deepEqual(segmentsAt(state, junction).map(s => s.id), ['S1', 'S2']);
  assert.deepEqual(resolveDescription(state, 'Market-Garden junction').position, junction);
  assert.deepEqual(resolveDescription(state, 'At the Market-Garden junction').position, junction);
});

test('world and pickup frames round trip and explain north with negative z', () => {
  const state = createDeliveryModel().state;
  assert.deepEqual(toFrame(state, {x: -2, z: -4}, 'pickup'), {x: 10, z: -12});
  assert.deepEqual(toFrame(state, state.package.pickup, 'pickup'), {x: 0, z: 0});
  assert.deepEqual(toFrame(state, state.package.destination, 'pickup'), {x: 22, z: -18});
  const p = {x: 2.125, z: -3.875};
  assert.deepEqual(fromFrame(state, toFrame(state, p, 'pickup'), 'pickup'), p);
  assert.deepEqual(toFrame(state, p, 'world'), p);
  assert.throws(() => toFrame(state, p, 'screen'));
  assert.throws(() => fromFrame(state, {x: NaN, z: 0}));
});

test('occupancy includes colocated entities without implying that waiting package is carried', () => {
  const state = createDeliveryModel().state;
  const occupants = occupantsAt(state, state.package.pickup, 0);
  assert.deepEqual(occupants.map(item => item.id), ['R-01', 'PKG-001']);
  assert.equal(occupants[1].relation, 'Not carried');
  assert.equal(resolveDescription(state, 'package onboard R-01').kind, 'error');
  assert.deepEqual(occupantsAt(state, {x: 0, z: 0}, 0.5), []);
});

test('occupancy radius uses an inclusive boundary and validates inputs', () => {
  const state = createDeliveryModel().state;
  assert.equal(occupantsAt(state, {x: -11, z: 8}, 1).length, 2);
  assert.equal(occupantsAt(state, {x: -10.999999, z: 8}, 1).length, 0);
  for (const radius of [-1, NaN, Infinity]) assert.throws(() => occupantsAt(state, state.package.pickup, radius));
  for (const x of [NaN, Infinity, undefined]) assert.throws(() => occupantsAt(state, {x, z: 0}));
});

test('object queries follow motion, waiting, and explicit delivery without mutating the model', () => {
  const model = createDeliveryModel();
  model.pickup(); model.move(); model.advance(1250);
  assert.deepEqual(objectLocation(model.state, 'PKG-001').position, {x: -7, z: 8});
  assert.equal(objectLocation(model.state, 'PKG-001').relation, 'Carried by R-01');
  assert.equal(occupantsAt(model.state, {x: -7, z: 8}, 0).length, 2);
  model.advance(1250); model.wait();
  assert.equal(objectLocation(model.state, 'PKG-001').status, 'in transit');
  for (let i = 1; i < 4; i++) {model.move(); model.advance(model.state.movement.duration);}
  model.deliver();
  const before = structuredClone(model.state);
  assert.equal(objectLocation(model.state, 'PKG-001').relation, 'Not carried');
  assert.equal(occupantsAt(model.state, model.state.package.destination, 0).length, 2);
  resolveDescription(model.state, 'destination'); describePosition(model.state, model.state.robot.position);
  assert.deepEqual(model.state, before);
});

test('descriptions resolve fractions and distances to specific points', () => {
  const state = createDeliveryModel().state;
  for (const text of ['halfway along Garden Passage', '  HALFWAY   ALONG garden passage ', 'midpoint of S2', '50% along Garden Passage', '6 meters along Garden Passage']) {
    assert.deepEqual(resolveDescription(state, text).position, {x: -2, z: 2});
  }
  assert.match(describePosition(state, {x: -2, z: 2}), /^6 m along Garden Passage/);
  assert.equal(resolveDescription(state, '13 m along Garden Passage').kind, 'error');
  assert.equal(resolveDescription(state, '101% along S1').kind, 'error');
  assert.equal(resolveDescription(state, '-1 m along S1').kind, 'error');
  assert.equal(resolveDescription(state, '6 m along Unknown').kind, 'error');
});

test('whole paths remain regions and ambiguous names return candidates', () => {
  const state = createDeliveryModel().state;
  const region = resolveDescription(state, 'Garden Passage');
  assert.equal(region.kind, 'segment');
  assert.deepEqual(region.start, {x: -2, z: 8});
  assert.deepEqual(region.end, {x: -2, z: -4});
  assert.equal(region.length, 12);
  assert.equal(resolveDescription(state, 'junction').candidates.length, 3);
  assert.ok(resolveDescription(state, 'Garden').candidates.length > 1);
  assert.equal(resolveDescription(state, 'narnia').kind, 'error');
  assert.equal(resolveDescription(state, '').kind, 'error');
});

test('endpoint descriptions use named junctions and off-route points use cardinal offsets', () => {
  const state = createDeliveryModel().state;
  assert.deepEqual(resolveDescription(state, 'end of S1').position, {x: -2, z: 8});
  assert.deepEqual(resolveDescription(state, '0% along S2').position, {x: -2, z: 8});
  assert.equal(describePosition(state, {x: -12, z: 6}), '2 m north of Market Street pickup');
  assert.throws(() => objectLocation(state, 'unknown'));
});
