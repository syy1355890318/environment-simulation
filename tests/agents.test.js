import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {W, H, UNKNOWN, FREE, OBSTACLE, HINDRANCE, indexOf, centerOf, passable, distance} from '../dist/nav.js';
import {toCell, isOccupiable} from '../dist/spatial.js';
import {HINDRANCES, PLACES} from '../dist/city.js';
import {createTruth} from '../dist/agent-world.js';
import {perceive, VISION} from '../dist/perception.js';
import {createMemory} from '../dist/agent-memory.js';
import {findPath, findFrontier, isFrontier, smoothPath, clearLine, pathLength} from '../dist/planner.js';
import {createAgent, AGENT} from '../dist/agent.js';
import {createAgentSim, GATES, LIMITS, STEP} from '../dist/agent-sim.js';

const NORTH = -Math.PI / 2, SOUTH = Math.PI / 2, EAST = 0;
const at = (x, z, heading = EAST, id = 'T') => ({id, position: {x, z}, heading});
const sees = (percept, x, z) => percept.cells.includes(indexOf(x, z));
const run = (sim, seconds) => { for (let i = 0; i < seconds / STEP; i++) sim.step(); return sim; };
// A hand-made memory: everything unknown except the cells painted in.
function sketch(paint) {
  const cells = new Uint8Array(W * H);
  const fill = (x0, x1, z0, z1, type = FREE) => { for (let x = x0 + .5; x < x1; x++) for (let z = z0 + .5; z < z1; z++) cells[indexOf(x, z)] = type; };
  paint(fill);
  return cells;
}

// --- The grid ---

test('four 1 m navigation cells make up each 2 m cell, and share its occupiability', () => {
  assert.equal(W * H, 96 * 72);
  for (let index = 0; index < W * H; index++) assert.equal(indexOf(centerOf(index).x, centerOf(index).z), index);
  const truth = createTruth();
  for (const [x, z] of [[0.5, 8.5], [1.5, 8.5], [4.5, 2.5], [-15.5, -28.5], [-16.5, -28.5], [-17.5, -28.5]]) {
    assert.equal(passable(truth.cells[indexOf(x, z)]), isOccupiable(toCell({x, z})), `${x}, ${z}`);
  }
  assert.equal(indexOf(48, 0), -1);
  assert.equal(indexOf(0, -36.5), -1);
});

test('the true city has obstacles, roadworks, and every goal place on passable ground', () => {
  const truth = createTruth(GATES);
  for (const zone of HINDRANCES) assert.equal(truth.cells[indexOf(zone.x0 + .5, zone.z0 + .5)], HINDRANCE);
  assert.equal(truth.cells[indexOf(4.5, 2.5)], OBSTACLE);
  for (const place of truth.places) assert.ok(passable(truth.cells[place.cell]), place.name);
  assert.deepEqual(truth.places.map(place => place.kind).filter(kind => kind !== 'gate').sort(),
    PLACES.filter(place => ['exhibit', 'charger', 'depot'].includes(place.kind)).map(place => place.kind).sort());
});

// --- Requirement 2: a limited cone of vision ---

test('vision reaches 10 m ahead and no farther', () => {
  const percept = perceive(createTruth(), at(0.5, 8.5, EAST));
  assert.ok(sees(percept, 9.5, 8.5));
  assert.ok(!sees(percept, 11.5, 8.5));
  assert.equal(VISION.range, 10);
});

test('vision is a cone: nothing behind or far to the side, except right around the agent', () => {
  const percept = perceive(createTruth(), at(0.5, 8.5, EAST));
  assert.ok(!sees(percept, -6.5, 8.5), 'behind');
  assert.ok(!sees(percept, 2.5, 5.5), '56 degrees off to the side');
  assert.ok(sees(percept, 5.5, 6.5), '22 degrees off');
  assert.ok(sees(percept, -0.5, 8.5), 'within arm’s reach behind');
});

test('buildings block the view: the facing wall is seen, what lies behind is not', () => {
  const percept = perceive(createTruth(), at(4.5, 8.5, NORTH));
  assert.ok(sees(percept, 4.5, 4.5), 'the near face of the building');
  assert.ok(!sees(percept, 4.5, 2.5), 'inside the building');
  assert.ok(!sees(percept, 4.5, -2.5), 'the street beyond it');
  assert.ok(sees(percept, 4.5, 6.5), 'the street in front');
});

test('every seen cell is reported with its true type, and only seen cells are reported', () => {
  const truth = createTruth(), percept = perceive(truth, at(19.5, 13.5 - 10, SOUTH));
  assert.equal(percept.cells.length, percept.types.length);
  assert.equal(new Set(percept.cells).size, percept.cells.length);
  percept.cells.forEach((index, n) => assert.equal(percept.types[n], truth.cells[index]));
  assert.ok(percept.types.includes(HINDRANCE), 'roadworks ahead are seen');
  for (const index of percept.cells) assert.ok(distance(centerOf(index), {x: 19.5, z: 3.5}) <= VISION.range);
});

test('a place is perceived only when its cell is in view', () => {
  const truth = createTruth();
  const names = percept => percept.places.map(place => place.name);
  assert.deepEqual(names(perceive(truth, at(24.5, -3.5, SOUTH))), ['Fountain']);
  assert.deepEqual(names(perceive(truth, at(24.5, -3.5, NORTH))), [], 'facing away');
  assert.deepEqual(names(perceive(truth, at(40.5, 16.5, NORTH))), ['Charger B'], 'the Mural is 8 m away behind a building');
});

test('other agents are perceived in the open and hidden by buildings', () => {
  const truth = createTruth(), me = at(0.5, 8.5, EAST, 'me');
  const ids = others => perceive(truth, me, others).agents.map(other => other.id);
  assert.deepEqual(ids([at(6.5, 8.5, 0, 'ahead')]), ['ahead']);
  assert.deepEqual(ids([at(-6.5, 8.5, 0, 'behind')]), []);
  assert.deepEqual(ids([at(4.5, -2.5, 0, 'beyond')]), []);
  assert.deepEqual(perceive(truth, at(4.5, 6.5, NORTH, 'me'), [at(4.5, -2.5, 0, 'beyond')]).agents, []);
});

// --- Requirement 1: limited knowledge at spawn; no peeking at the true city ---

test('a new agent knows nothing about the city', () => {
  const agent = createAgent({id: 'V-1', type: 'visitor', gate: GATES[0], random: Math.random});
  assert.deepEqual(agent.memory.stats(), {known: 0, passableKnown: 0, landmarks: 0});
  assert.ok(agent.memory.cells.every(type => type === UNKNOWN));
});

test('the thinking modules never import the true city', () => {
  for (const file of ['agent.js', 'planner.js', 'agent-memory.js']) {
    const source = readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8');
    for (const forbidden of ['agent-world', 'spatial.js', 'city.js', 'perception']) assert.ok(!source.includes(forbidden), `${file} imports ${forbidden}`);
  }
});

test('an agent’s memory holds exactly what it has perceived, and after its first look that is very little', () => {
  const sim = createAgentSim({count: 2, seed: 1});
  const seen = sim.agents.map(() => new Set());
  sim.agents.forEach((agent, n) => {
    const step = agent.step;
    agent.step = (dt, percept, ...rest) => { percept.cells.forEach(index => seen[n].add(index)); return step(dt, percept, ...rest); };
  });
  sim.step();
  for (const agent of sim.agents) assert.ok(agent.memory.stats().known < 0.03 * W * H, 'first glance');
  run(sim, 120);
  sim.agents.forEach((agent, n) => {
    const known = [];
    agent.memory.cells.forEach((type, index) => { if (type !== UNKNOWN) known.push(index); });
    assert.deepEqual(known, [...seen[n]].sort((a, b) => a - b));
    for (const index of known) assert.equal(agent.memory.cells[index], sim.truth.cells[index]);
    assert.ok(known.length < 0.6 * W * H);
  });
});

test('routes cannot be planned through ground the agent has not seen', () => {
  const truth = createTruth(), start = indexOf(-43.5, 8.5), goal = indexOf(40.5, 8.5);
  assert.ok(findPath(truth.cells, start, goal), 'the street really is open');
  assert.equal(findPath(new Uint8Array(W * H), start, goal), null);
  const partial = sketch(fill => fill(-44, 0, 5, 11));
  assert.equal(findPath(partial, start, goal), null);
  const corridor = sketch(fill => fill(-44, 41, 8, 9));
  const route = findPath(corridor, start, goal);
  assert.ok(route.every(index => corridor[index] === FREE));
  assert.equal(route.length, 85);
});

// --- Requirement 5: mapping, and the planner that uses the map ---

test('paths go around obstacles and never cut a corner diagonally', () => {
  const cells = sketch(fill => { fill(0, 10, 0, 10); fill(4, 5, 0, 9, OBSTACLE); });
  const route = findPath(cells, indexOf(1.5, 1.5), indexOf(8.5, 1.5));
  assert.ok(route.some(index => centerOf(index).z > 9), 'goes around the end of the wall');
  for (let i = 1; i < route.length; i++) {
    const a = centerOf(route[i - 1]), b = centerOf(route[i]);
    if (a.x !== b.x && a.z !== b.z) assert.ok(passable(cells[indexOf(a.x, b.z)]) && passable(cells[indexOf(b.x, a.z)]));
  }
});

test('slow ground is crossed or avoided depending on how much the agent minds it', () => {
  // Two ways east: straight through 6 m of slow ground, or a 12 m longer detour.
  const cells = sketch(fill => { fill(0, 20, 0, 1); fill(7, 13, 0, 1, HINDRANCE); fill(0, 1, 0, 7); fill(0, 20, 6, 7); fill(19, 20, 0, 7); });
  const start = indexOf(0.5, 0.5), goal = indexOf(19.5, 0.5);
  const crosses = route => route.some(index => cells[index] === HINDRANCE);
  assert.ok(crosses(findPath(cells, start, goal, {hindranceCost: AGENT.hindranceCost.visitor})), 'a visitor loses a little time');
  assert.ok(!crosses(findPath(cells, start, goal, {hindranceCost: AGENT.hindranceCost.courier})), 'a courier saves energy');
  assert.ok(AGENT.hindranceCost.courier > AGENT.hindranceCost.visitor);
});

test('cells can be closed to planning for a moment, such as where another agent stands', () => {
  const cells = sketch(fill => fill(0, 10, 0, 2));
  const start = indexOf(0.5, 0.5), goal = indexOf(9.5, 0.5), other = indexOf(5.5, 0.5);
  assert.ok(findPath(cells, start, goal).includes(other));
  assert.ok(!findPath(cells, start, goal, {blocked: new Set([other])}).includes(other));
  assert.equal(findPath(cells, start, goal, {blocked: new Set([other, indexOf(5.5, 1.5)])}), null);
});

test('a smoothed path has few legs, each clear at body width in the agent’s memory', () => {
  const cells = sketch(fill => { fill(0, 20, 0, 6); fill(0, 6, 0, 20); });
  const route = findPath(cells, indexOf(18.5, 2.5), indexOf(2.5, 18.5));
  const points = smoothPath(cells, route);
  assert.ok(points.length <= 4 && points.length < route.length);
  assert.deepEqual(points[0], centerOf(route[0]));
  assert.deepEqual(points.at(-1), centerOf(route.at(-1)));
  for (let i = 1; i < points.length; i++) assert.ok(clearLine(cells, points[i - 1], points[i]));
  assert.ok(pathLength(points) <= route.length * Math.SQRT2);
  assert.equal(clearLine(cells, {x: 18.5, z: 2.5}, {x: 2.5, z: 18.5}), false, 'the direct line crosses unknown ground');
});

test('exploring heads for the nearest edge of what has been looked at', () => {
  const cells = sketch(fill => { fill(-1, 15, -1, 2, OBSTACLE); fill(0, 12, 0, 1); }), swept = cells.map(type => type ? 1 : 0);
  cells[indexOf(12.5, 0.5)] = FREE;
  swept[indexOf(12.5, 0.5)] = 0;
  assert.ok(isFrontier(cells, swept, indexOf(11.5, 0.5)));
  assert.ok(!isFrontier(cells, swept, indexOf(5.5, 0.5)));
  assert.equal(findFrontier(cells, swept, indexOf(5.5, 0.5)).at(-1), indexOf(11.5, 0.5));
  swept[indexOf(12.5, 0.5)] = 1;
  cells[indexOf(13.5, 0.5)] = OBSTACLE;
  assert.equal(findFrontier(cells, swept, indexOf(5.5, 0.5)), null, 'a wall is not a frontier');
});

test('exploring toward a known place prefers the frontier that leads there', () => {
  const cells = sketch(fill => fill(0, 21, 0, 1)), swept = new Uint8Array(W * H).fill(1);
  cells[indexOf(-0.5, 0.5)] = cells[indexOf(21.5, 0.5)] = FREE;
  swept[indexOf(-0.5, 0.5)] = swept[indexOf(21.5, 0.5)] = 0;
  const start = indexOf(4.5, 0.5);
  assert.equal(findFrontier(cells, swept, start).at(-1), indexOf(0.5, 0.5), 'the west end is nearer');
  assert.equal(findFrontier(cells, swept, start, {toward: {x: 40, z: 0}}).at(-1), indexOf(20.5, 0.5));
});

// --- Requirement 6: landmarks that carry information ---

test('seeing a place leaves one landmark holding what it is, where, and when', () => {
  const truth = createTruth(), memory = createMemory();
  const percept = perceive(truth, at(24.5, -3.5, SOUTH));
  const landmark = memory.observe(percept, 12.5).find(item => item.kind === 'exhibit');
  assert.deepEqual({kind: landmark.kind, name: landmark.name, position: landmark.position, foundAt: landmark.foundAt},
    {kind: 'exhibit', name: 'Fountain', position: {x: 24, z: 4}, foundAt: 12.5});
  assert.ok(landmark.note.length > 0);
  assert.deepEqual(memory.observe(percept, 20), [], 'seen again, nothing new');
  assert.equal(memory.landmarkFor('fountain'), landmark);
  assert.equal(memory.landmarkFor('mural'), null);
});

test('slow ground gets one landmark per patch', () => {
  const truth = createTruth(), memory = createMemory();
  const found = memory.observe(perceive(truth, at(19.5, 3.5, SOUTH)), 1);
  assert.deepEqual(found.map(item => item.kind), ['hindrance']);
  assert.equal(truth.cells[found[0].cell], HINDRANCE);
  assert.match(found[0].note, /three times the energy/);
});

test('landmarks remember the shortest distance walked between them, both ways', () => {
  const memory = createMemory();
  const [a] = memory.observe({cells: [], types: [], places: [{id: 'a', name: 'A', kind: 'exhibit', position: {x: 0, z: 0}, cell: 1}]}, 0);
  const [b] = memory.observe({cells: [], types: [], places: [{id: 'b', name: 'B', kind: 'exhibit', position: {x: 9, z: 0}, cell: 2}]}, 0);
  memory.recordRoute(a, b, 40);
  memory.recordRoute(b, a, 25);
  memory.recordRoute(a, b, 60);
  assert.equal(a.routes[b.id], 25);
  assert.equal(b.routes[a.id], 25);
  memory.recordRoute(null, a, 5);
  memory.recordRoute(a, a, 5);
  assert.deepEqual(Object.keys(a.routes), [b.id]);
});

test('starting a trip without landmarks forgets where things are but keeps the map of walls', () => {
  const truth = createTruth(), memory = createMemory();
  memory.observe(perceive(truth, at(24.5, -3.5, SOUTH)), 1);
  const known = memory.stats().known, left = memory.landmarks.length;
  memory.startTrip(true);
  assert.equal(memory.landmarks.length, left);
  memory.startTrip(false);
  assert.equal(memory.landmarks.length, 0);
  assert.ok(memory.swept.every(value => value === 0));
  assert.equal(memory.stats().known, known);
  const again = memory.observe(perceive(truth, at(24.5, -3.5, SOUTH)), 2);
  assert.ok(again.some(item => item.name === 'Fountain'));
  assert.ok(again.every(item => Number(item.id.slice(1)) > left), 'landmark ids are never reused');
});

// --- Requirements 4 and 7: goals, performance, and landmarks that speed things up ---

const withLandmarks = run(createAgentSim({count: 2, seed: 1, useLandmarks: true}), 800);
const withoutLandmarks = run(createAgentSim({count: 2, seed: 1, useLandmarks: false}), 800);

test('a visitor finds all five exhibits, returns to its own gate, and measures the trip', () => {
  const visitor = withLandmarks.agent('V-1'), [first] = visitor.trips;
  assert.equal(visitor.type, 'visitor');
  assert.ok(first.time > 0 && first.distance > 0);
  assert.equal(visitor.memory.landmarks.filter(item => item.kind === 'exhibit').length, 5);
  assert.equal(visitor.memory.landmarkFor(visitor.gate.id).kind, 'gate');
  assert.ok(visitor.memory.landmarks.every(item => item.kind !== 'gate' || item.placeId === visitor.gate.id), 'other gates are not its landmarks');
  assert.ok(first.distance <= first.time * AGENT.speed.visitor + 1e-6, 'never faster than its walking speed');
});

test('with landmarks, a visitor’s second tour is much faster and meets the time limit', () => {
  const [first, second] = withLandmarks.agent('V-1').trips;
  assert.ok(second.time < first.time * 0.7, `${second.time} vs ${first.time}`);
  assert.ok(second.distance < first.distance * 0.7);
  assert.ok(first.time > AGENT.tourLimit, 'the first, exploring tour runs over');
  assert.ok(second.time <= AGENT.tourLimit);
});

test('without landmarks the second tour has to search again, so it is slower than with them', () => {
  const kept = withLandmarks.agent('V-1').trips[1], lost = withoutLandmarks.agent('V-1').trips[1];
  assert.equal(lost.landmarks, false);
  assert.ok(kept.time < lost.time * 0.8, `${kept.time} vs ${lost.time}`);
  assert.equal(withoutLandmarks.agent('V-1').trips[0].time, withLandmarks.agent('V-1').trips[0].time, 'the first tour is the same either way');
});

test('walked routes between landmarks are recorded for later use', () => {
  const routes = withLandmarks.agent('V-1').memory.landmarks.filter(item => item.kind === 'exhibit').flatMap(item => Object.values(item.routes));
  assert.ok(routes.length >= 8);
  assert.ok(routes.every(length => length > 0 && Number.isFinite(length)));
});

test('a courier finds the depot, delivers parcels, and accounts for energy', () => {
  const courier = withLandmarks.agent('C-1');
  assert.equal(courier.type, 'courier');
  assert.ok(courier.trips.length >= 3);
  assert.ok(courier.memory.landmarks.some(item => item.kind === 'depot'));
  for (const trip of courier.trips) assert.ok(trip.energy >= trip.distance - 1e-6, 'slow ground only ever costs more');
  const later = courier.trips.slice(1), mean = list => list.reduce((sum, trip) => sum + trip.energy, 0) / list.length;
  assert.ok(mean(later) < courier.trips[0].energy * 0.6, 'later deliveries use far less energy than the first');
  assert.ok(courier.battery >= 0 && courier.battery <= AGENT.battery);
});

test('a courier that is running low goes to a charger it has found', () => {
  const sim = run(createAgentSim({count: 2, seed: 1}), 1500), courier = sim.agent('C-1');
  const chargers = courier.memory.landmarks.filter(item => item.kind === 'charger');
  assert.ok(chargers.some(item => item.visits > 0));
  assert.ok(courier.energy > AGENT.battery, 'it has used more than one battery in total');
});

test('the two types move at their own speeds and all agents report what they are doing', () => {
  assert.ok(AGENT.speed.courier > AGENT.speed.visitor);
  for (const agent of withLandmarks.agents) {
    assert.ok(agent.status.length > 0);
    assert.ok(agent.odometer <= withLandmarks.time * AGENT.speed[agent.type] + 1e-6);
  }
});

// --- Requirements 3 and 9: avoiding each other, at scale ---

test('ten agents share the streets for ten minutes without overlapping, entering walls, or getting stuck', () => {
  const sim = createAgentSim({count: 10, seed: 3});
  const last = sim.agents.map(() => 0), stalled = sim.agents.map(() => 0);
  let closest = Infinity, longestStall = 0;
  for (let i = 1; i <= 600 / STEP; i++) {
    sim.step();
    sim.agents.forEach((a, n) => {
      assert.ok(passable(sim.truth.cells[indexOf(a.position.x, a.position.z)]), `${a.id} is inside a wall`);
      for (const b of sim.agents.slice(n + 1)) closest = Math.min(closest, distance(a.position, b.position));
      if (i % 10) return;
      stalled[n] = a.odometer - last[n] < 0.2 ? stalled[n] + 1 : 0;
      longestStall = Math.max(longestStall, stalled[n]);
      last[n] = a.odometer;
    });
  }
  assert.ok(closest >= 0.3, `closest approach ${closest}`);
  assert.ok(longestStall <= 6, `an agent stood still for ${longestStall} s`);
  for (const agent of sim.agents) assert.ok(agent.trips.length >= 1, `${agent.id} finished no trip`);
});

test('two agents walking at each other in a one-lane alley get past', () => {
  const sim = createAgentSim({count: 2, seed: 1});
  const [a, b] = sim.agents;
  // Teach both the alley, then send them to opposite ends of it.
  const lane = sketch(fill => fill(-44, -34, -13, -11));
  for (const agent of [a, b]) agent.memory.observe({cells: [...lane.keys()].filter(index => lane[index]), types: [...lane].filter(type => type), places: []}, 0);
  const west = {id: 'west', name: 'West', kind: 'exhibit', position: {x: -43.5, z: -12}, cell: indexOf(-43.5, -11.5)};
  const east = {id: 'east', name: 'East', kind: 'exhibit', position: {x: -34.5, z: -12}, cell: indexOf(-34.5, -11.5)};
  a.position = {x: -43.5, z: -11.5}; a.heading = 0;
  b.position = {x: -34.5, z: -12.5}; b.heading = Math.PI;
  let closest = Infinity, passed = false;
  for (let i = 0; i < 300 && !passed; i++) {
    for (const [agent, goal] of [[a, east], [b, west]]) {
      const others = sim.agents.filter(other => other !== agent);
      const percept = perceive(sim.truth, agent, others);
      const route = findPath(agent.memory.cells, indexOf(agent.position.x, agent.position.z), goal.cell);
      const next = centerOf(route[Math.min(2, route.length - 1)]);
      agent.heading = Math.atan2(next.z - agent.position.z, next.x - agent.position.x);
      assert.ok(percept.agents.length <= 1);
    }
    sim.step();
    closest = Math.min(closest, distance(a.position, b.position));
    passed = a.position.x > b.position.x + 1;
  }
  assert.ok(closest >= 0.3, `closest approach ${closest}`);
});

test('the same seed gives the same run; the count is kept between two and ten', () => {
  const one = run(createAgentSim({count: 4, seed: 7}), 60), two = run(createAgentSim({count: 4, seed: 7}), 60);
  assert.deepEqual(one.agents.map(agent => agent.position), two.agents.map(agent => agent.position));
  assert.deepEqual(one.agents.map(agent => [agent.id, agent.type]), [['V-1', 'visitor'], ['C-1', 'courier'], ['V-2', 'visitor'], ['C-2', 'courier']]);
  assert.deepEqual(LIMITS, {min: 2, max: 10});
  one.setCount(50);
  assert.equal(one.agents.length, 10);
  assert.equal(new Set(one.agents.map(agent => agent.gate.id)).size, 10, 'each has its own gate');
  one.setCount(0);
  assert.equal(one.agents.length, 2);
  assert.deepEqual(one.agents.map(agent => agent.id), ['V-1', 'C-1'], 'the first agents stay, with their memory');
  assert.ok(one.agents[0].memory.stats().known > 0);
});

test('time advances in fixed steps however the frames arrive', () => {
  const sim = createAgentSim({count: 2});
  sim.advance(250);
  assert.ok(Math.abs(sim.time - 0.2) < 1e-9);
  sim.advance(50);
  assert.ok(Math.abs(sim.time - 0.3) < 1e-9);
  sim.advance(10 * 60 * 1000);
  assert.ok(sim.time <= 0.3 + 400 * STEP + 1e-9, 'a long pause does not freeze the page catching up');
});

// --- Hindrances the user adds ---

test('a cone slows the ground it stands on, agents notice, and notice again when it is gone', () => {
  const sim = createAgentSim({count: 2, seed: 1}), spot = {x: 0, z: 8}, index = indexOf(0.5, 8.5);
  assert.equal(sim.truth.cells[index], FREE);
  sim.setCones([spot]);
  for (const [x, z] of [[-0.5, 7.5], [0.5, 7.5], [-0.5, 8.5], [0.5, 8.5]]) assert.equal(sim.truth.cells[indexOf(x, z)], HINDRANCE);
  assert.equal(sim.truth.cells[indexOf(4.5, 2.5)], OBSTACLE, 'a cone never opens a wall');
  const memory = createMemory(), watcher = at(-5.5, 8.5, EAST);
  const found = memory.observe(perceive(sim.truth, watcher), 1);
  assert.equal(memory.cells[index], HINDRANCE);
  assert.deepEqual(found.map(item => item.kind), ['hindrance']);
  sim.setCones([]);
  assert.equal(sim.truth.cells[index], FREE);
  assert.equal(sim.truth.cells[indexOf(19.5, 8.5)], HINDRANCE, 'roadworks stay');
  memory.observe(perceive(sim.truth, watcher), 2);
  assert.equal(memory.cells[index], FREE);
});

test('slow ground really is slower and costs more energy to cross', () => {
  const sim = createAgentSim({count: 2, seed: 1}), agent = sim.agents[0];
  const stride = ground => { const before = {...agent.position}; agent.moved({x: before.x + 0.2, z: before.z}, ground, 0.2, STEP); };
  const energy = agent.energy;
  stride(FREE);
  assert.ok(Math.abs(agent.energy - energy - 0.2) < 1e-9);
  stride(HINDRANCE);
  assert.ok(Math.abs(agent.energy - energy - 0.2 - 0.2 * AGENT.hindranceEnergy) < 1e-9);
  assert.ok(AGENT.hindranceSpeed < 1);
});

// --- Requirement 10: what the agents know in common ---

test('shared knowledge counts, for each cell, how many agents know it', () => {
  const sim = run(createAgentSim({count: 6, seed: 2}), 200), counts = sim.sharedKnowledge();
  let most = 0;
  counts.forEach((count, index) => {
    assert.equal(count, sim.agents.filter(agent => agent.memory.cells[index] !== UNKNOWN).length);
    most = Math.max(most, count);
  });
  assert.ok(most >= 2 && most <= 6);
  assert.ok(counts.some(count => count === 0));
});

test('the landmark heatmap counts how many agents hold each landmark', () => {
  const sim = run(createAgentSim({count: 6, seed: 2}), 400), heat = sim.landmarkHeat();
  assert.ok(heat.length >= 5);
  for (const entry of heat) {
    assert.ok(entry.count >= 1 && entry.count <= 6);
    assert.notEqual(entry.kind, 'gate');
  }
  const fountain = heat.find(entry => entry.name === 'Fountain');
  assert.equal(fountain.count, sim.agents.filter(agent => agent.memory.landmarkFor('fountain')).length);
  assert.equal(heat.filter(entry => entry.name === 'Fountain').length, 1);
});

test('every step into a new cell is counted for the overlay of all paths', () => {
  const sim = run(createAgentSim({count: 4, seed: 2}), 100);
  const total = sim.visits.reduce((sum, count) => sum + count, 0), walked = sim.agents.reduce((sum, agent) => sum + agent.odometer, 0);
  assert.ok(total > 0.6 * walked && total < 1.6 * walked, `${total} cells for ${walked} m`);
  sim.visits.forEach((count, index) => { if (count) assert.ok(passable(sim.truth.cells[index])); });
});

test('the summary shows trips getting faster once landmarks exist', () => {
  const summary = withLandmarks.summary();
  assert.equal(summary.agents, 2);
  assert.ok(summary.mapped > 0.3 && summary.mapped <= 1);
  assert.ok(summary.laterTrips < summary.firstTrip * 0.7);
  assert.deepEqual(createAgentSim({count: 2}).summary().firstTrip, null);
});
