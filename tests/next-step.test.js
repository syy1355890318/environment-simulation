import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryModel} from '../dist/model.js';
import {nextStep} from '../dist/next-step.js';
import {parseCoordinates} from '../dist/locations.js';

const finish = model => model.advance(model.state.movement.duration);

test('a fresh delivery asks for pickup', () => {
  const step = nextStep(createDeliveryModel().state);
  assert.equal(step.action, 'pickup');
  assert.equal(step.label, 'Pick up');
  assert.equal(step.canWait, true);
});

test('after pickup each step names the next segment, then asks to deliver', () => {
  const model = createDeliveryModel();
  model.pickup();
  for (const name of ['Market Street', 'Garden Passage', 'Canal Walk', 'Willow Lane']) {
    const step = nextStep(model.state);
    assert.equal(step.action, 'move');
    assert.equal(step.text, `Next: ${name}`);
    model.move();
    finish(model);
  }
  const arrived = nextStep(model.state);
  assert.equal(arrived.action, 'deliver');
  assert.equal(arrived.text, 'At destination');
});

test('while moving there is nothing to press', () => {
  const model = createDeliveryModel();
  model.pickup();
  model.move();
  assert.deepEqual(nextStep(model.state), {text: 'Moving along Market Street', action: null, canWait: false});
});

test('after delivery the only step is to start over', () => {
  const model = createDeliveryModel();
  model.pickup();
  for (let i = 0; i < 4; i++) { model.move(); finish(model); }
  model.deliver();
  const step = nextStep(model.state);
  assert.equal(step.action, 'reset');
  assert.equal(step.canWait, false);
});

test('a problem with the next segment is stated, and Move stays available to retry', () => {
  const cases = [
    [{blocked: true}, null, 'Market Street blocked'],
    [{clearWidth: 0.7}, null, 'Market Street too narrow'],
    [{}, 'is occupied by P-1', 'Market Street is occupied by P-1']
  ];
  for (const [changes, obstruction, text] of cases) {
    const model = createDeliveryModel();
    model.pickup();
    model.updateSegment('S1', changes);
    const step = nextStep(model.state, obstruction);
    assert.equal(step.text, text);
    assert.equal(step.action, 'move');
    assert.equal(step.warning, true);
  }
});

test('a blocked segment outranks an obstruction', () => {
  const model = createDeliveryModel();
  model.pickup();
  model.updateSegment('S1', {blocked: true});
  assert.equal(nextStep(model.state, 'is occupied by P-1').text, 'Market Street blocked');
});

test('a robot told to wait can still move on', () => {
  const model = createDeliveryModel();
  model.pickup();
  model.wait();
  assert.equal(nextStep(model.state).action, 'move');
});

test('coordinates parse with or without parentheses and units', () => {
  assert.deepEqual(parseCoordinates('-2, 2'), {x: -2, z: 2});
  assert.deepEqual(parseCoordinates('(10, -4.5)'), {x: 10, z: -4.5});
  assert.deepEqual(parseCoordinates(' ( −12 , 8 ) m '), {x: -12, z: 8});
});

test('anything else is not coordinates', () => {
  for (const text of ['', 'pickup', '3', '1, 2, 3', 'a, b', '50% along S2', '1,']) assert.equal(parseCoordinates(text), null, text);
});
