import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMovementTracker, deliveryZones, primaryTrends, ZONE_RADIUS} from '../dist/movement.js';
import {createDeliveryModel} from '../dist/model.js';

// Runs a mover along straight legs at a fixed speed and collects everything the tracker reports.
function run(path, others = [], {zones = [], speed = 4, step = 50, tracker = createMovementTracker()} = {}) {
  const collected = {trends: [], events: []};
  let time = 0, position = {...path[0]};
  const sample = () => {
    const result = tracker.sample(time, [{id: 'M', type: 'robot', position}, ...others], zones);
    collected.trends.push(...result.trends);
    collected.events.push(...result.events);
  };
  sample();
  for (const target of path.slice(1)) {
    const length = Math.hypot(target.x - position.x, target.z - position.z), steps = Math.ceil(length / (speed * step / 1000));
    const start = position;
    for (let i = 1; i <= steps; i++) {
      time += step;
      position = {x: start.x + (target.x - start.x) * i / steps, z: start.z + (target.z - start.z) * i / steps};
      sample();
    }
  }
  return collected;
}
const person = (id, x, z) => ({id, type: 'person', position: {x, z}});
const kinds = (list, kind) => list.filter(item => item.kind === kind);

test('moving closer to a referent is toward, never away', () => {
  const {trends} = run([{x: -20, z: 0}, {x: -10, z: 0}], [person('P', 0, 0)]);
  assert.ok(kinds(trends, 'toward').length > 0);
  assert.equal(kinds(trends, 'away').length, 0);
  assert.ok(trends.every(trend => trend.mover === 'M' && trend.referent === 'P' && trend.rate < 0));
});

test('moving farther from a referent is away, never toward', () => {
  const {trends} = run([{x: 10, z: 0}, {x: 20, z: 0}], [person('P', 0, 0)]);
  assert.ok(kinds(trends, 'away').length > 0);
  assert.equal(kinds(trends, 'toward').length, 0);
});

test('moving on a circle around a referent is neither toward nor away', () => {
  const circle = Array.from({length: 40}, (_, i) => ({x: 10 * Math.cos(i / 6), z: 10 * Math.sin(i / 6)}));
  const {trends} = run(circle, [person('P', 0, 0)]);
  assert.equal(trends.length, 0);
});

test('a stationary object reports no trend and no event', () => {
  const tracker = createMovementTracker();
  const entities = [person('A', 0, 0), person('B', 4, 0)];
  for (let time = 0; time < 2000; time += 100) {
    const result = tracker.sample(time, entities);
    assert.deepEqual(result, {trends: [], events: []});
  }
});

test('a trend waits for enough elapsed time before it is reported', () => {
  const tracker = createMovementTracker();
  tracker.sample(0, [{id: 'M', position: {x: 0, z: 0}}, person('P', 10, 0)]);
  assert.equal(tracker.sample(50, [{id: 'M', position: {x: 1, z: 0}}, person('P', 10, 0)]).trends.length, 0);
  assert.equal(tracker.sample(200, [{id: 'M', position: {x: 2, z: 0}}, person('P', 10, 0)]).trends.length, 1);
});

test('walking straight past a referent reports one past event at the closest point', () => {
  const {events} = run([{x: -12, z: 2}, {x: 12, z: 2}], [person('P', 0, 0)]);
  const past = kinds(events, 'past');
  assert.equal(past.length, 1);
  assert.equal(past[0].referent, 'P');
  assert.ok(Math.abs(past[0].position.x) < 0.3, `closest near x=0, got ${past[0].position.x}`);
  assert.ok(Math.abs(past[0].closest - 2) < 0.05);
});

test('turning back before the referent is not past', () => {
  const {events, trends} = run([{x: -12, z: 2}, {x: -3, z: 2}, {x: -12, z: 2}], [person('P', 0, 0)]);
  assert.equal(kinds(events, 'past').length, 0);
  assert.ok(kinds(trends, 'away').length > 0, 'turning back is still moving away');
});

test('passing far from a referent is not past', () => {
  const {events} = run([{x: -12, z: 6}, {x: 12, z: 6}], [person('P', 0, 0)]);
  assert.equal(kinds(events, 'past').length, 0);
});

test('stopping right beside a referent is not past until the mover has left it', () => {
  const {events} = run([{x: -12, z: 2}, {x: 0, z: 2}], [person('P', 0, 0)]);
  assert.equal(kinds(events, 'past').length, 0);
});

test('leaving the tracking radius allows a second pass', () => {
  const {events} = run([{x: -12, z: 2}, {x: 12, z: 2}, {x: -12, z: 2}], [person('P', 0, 0)]);
  assert.equal(kinds(events, 'past').length, 2);
});

test('a pass is judged relative to a referent that also moves', () => {
  const tracker = createMovementTracker();
  const events = [];
  for (let i = 0; i <= 60; i++) {
    const time = i * 50, x = -12 + i * 0.4;
    events.push(...tracker.sample(time, [{id: 'M', position: {x, z: 2}}, person('P', 0, 0 + i * 0.01)]).events);
  }
  assert.equal(kinds(events, 'past').filter(event => event.mover === 'M').length, 1);
});

test('crossing a zone boundary reports into and out exactly once each', () => {
  const zones = [{id: 'zone', name: 'test zone', position: {x: 0, z: 0}, radius: 3}];
  const {events} = run([{x: -8, z: 0}, {x: 8, z: 0}], [], {zones});
  assert.deepEqual(events.filter(event => event.kind !== 'past').map(event => event.kind), ['into', 'out']);
  assert.equal(kinds(events, 'into')[0].referentName, 'test zone');
  assert.ok(Math.abs(Math.hypot(kinds(events, 'into')[0].position.x, 0) - 3) < 0.3);
});

test('starting inside a zone is not an into event; leaving is an out event', () => {
  const zones = [{id: 'zone', name: 'zone', position: {x: 0, z: 0}, radius: 3}];
  const {events} = run([{x: 0, z: 0}, {x: 8, z: 0}], [], {zones});
  assert.deepEqual(events.map(event => event.kind), ['out']);
});

test('moving within a zone reports nothing', () => {
  const zones = [{id: 'zone', name: 'zone', position: {x: 0, z: 0}, radius: 3}];
  assert.deepEqual(run([{x: -1, z: 0}, {x: 1, z: 0}], [], {zones}).events, []);
});

test('a zone boundary is inclusive', () => {
  const tracker = createMovementTracker(), zones = [{id: 'zone', name: 'zone', position: {x: 0, z: 0}, radius: 3}];
  tracker.sample(0, [{id: 'M', position: {x: 5, z: 0}}], zones);
  assert.equal(tracker.sample(100, [{id: 'M', position: {x: 3, z: 0}}], zones).events[0].kind, 'into');
});

test('zones are also referents for toward and away', () => {
  const zones = [{id: 'zone', name: 'test zone', position: {x: 0, z: 0}, radius: 3}];
  const {trends} = run([{x: -20, z: 0}, {x: -10, z: 0}], [], {zones});
  assert.ok(trends.length > 0);
  assert.ok(trends.every(trend => trend.kind === 'toward' && trend.referentName === 'test zone'));
});

test('clearing the tracker forgets history, so a jump after a reset reports nothing', () => {
  const tracker = createMovementTracker(), zones = [{id: 'zone', name: 'zone', position: {x: 0, z: 0}, radius: 3}];
  tracker.sample(0, [{id: 'M', position: {x: 20, z: 0}}], zones);
  tracker.clear();
  assert.deepEqual(tracker.sample(100, [{id: 'M', position: {x: 0, z: 0}}], zones), {trends: [], events: []});
});

test('a removed entity leaves no history behind', () => {
  const tracker = createMovementTracker();
  tracker.sample(0, [{id: 'M', position: {x: 0, z: 0}}]);
  tracker.sample(100, []);
  assert.deepEqual(tracker.sample(200, [{id: 'M', position: {x: 9, z: 0}}]), {trends: [], events: []});
});

test('the primary trend per mover is the nearest referent', () => {
  const primary = primaryTrends([
    {mover: 'M', referent: 'far', distance: 9}, {mover: 'M', referent: 'near', distance: 2}, {mover: 'N', referent: 'x', distance: 5}
  ]);
  assert.deepEqual(primary.map(trend => trend.referent).sort(), ['near', 'x']);
});

test('delivery zones sit on the pickup and destination', () => {
  const {state} = createDeliveryModel();
  const zones = deliveryZones(state);
  assert.deepEqual(zones.map(zone => zone.position), [state.package.pickup, state.package.destination]);
  assert.ok(zones.every(zone => zone.radius === ZONE_RADIUS));
});
