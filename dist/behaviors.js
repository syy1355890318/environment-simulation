// Occupants, demo scenes, and the behaviors their placement triggers.
import {samePosition} from './model.js';
import {toCell, cellCenter, sameCell, isOccupiable, distanceToSegment, advanceWalk} from './spatial.js';
import {entitiesFrom, detectRelations, findCrowds} from './relations.js';
import {createMovementTracker, deliveryZones, primaryTrends} from './movement.js';

export const WARNING_SPEED = 0.4;
export const MAX_OCCUPANTS = 12;
const EVENT_LIFETIME = 6000;
const TRAIL_LENGTH = 60;
const TRAIL_SPACING = 0.3;
const TRAIL_LIFETIME = 2500;
const ON_PATH = 1;

export const OCCUPANT_TYPES = {
  person: {label: 'Person', prefix: 'P'},
  recipient: {label: 'Recipient', prefix: 'RC'},
  cone: {label: 'Warning cone', prefix: 'W'}
};

export const SCENES = [
  {id: 'city', name: 'City', description: 'An empty city. Add people and cones with the plus button.', occupants: []},
  {id: 'street', delivery: true, name: 'Street', description: 'A person beside the route and a recipient at the destination.', occupants: [
    {type: 'person', x: -6, z: 10}, {type: 'recipient', x: 12, z: -10}
  ]},
  {id: 'relations', name: 'Relations', description: 'Adjacent, adjacent across a building, between, and among.', occupants: [
    {type: 'person', x: 10, z: -12}, {type: 'person', x: 10, z: -14},
    {type: 'person', x: 4, z: -2}, {type: 'person', x: 4, z: 6},
    {type: 'cone', x: 14, z: 2}, {type: 'person', x: 18, z: 2}, {type: 'cone', x: 22, z: 2},
    {type: 'cone', x: -26, z: 20}, {type: 'cone', x: -18, z: 20}, {type: 'cone', x: -22, z: 12}, {type: 'person', x: -22, z: 16}
  ]},
  {id: 'crowd', delivery: true, name: 'Crowd', description: 'Three people on Market Street. Pick up, press Move, then drag one away.', occupants: [
    {type: 'person', x: -8, z: 10}, {type: 'person', x: -4, z: 10}, {type: 'person', x: 0, z: 10}
  ]},
  {id: 'warning', delivery: true, name: 'Warning', description: 'A cone beside the route slows the robot while adjacent.', occupants: [
    {type: 'cone', x: -8, z: 10}, {type: 'recipient', x: 12, z: -10}
  ]},
  {id: 'movement', name: 'Movement', description: 'A walker goes toward, past, and away from a standing person.', occupants: [
    {type: 'person', x: -8, z: -24, walk: [{x: -8, z: -24}, {x: 8, z: -24}]}, {type: 'person', x: 2, z: -22}
  ]}
];

export function createSpatialSystem(getModel) {
  const tracker = createMovementTracker();
  let sceneId = SCENES[0].id, clock = 0, factor = 1;
  let events = [], trails = new Map(), knownCrowds = new Set(), knownWarnings = new Set();
  let snapshot = emptySnapshot();

  function emptySnapshot() {
    return {relations: {adjacent: [], between: [], among: []}, crowds: [], warnings: [], trends: [], events: [], trails: [], zones: [], time: 0, robot: null};
  }
  const state = () => getModel().state;
  const log = (message, kind) => getModel().log(message, kind);
  const findOccupant = id => state().occupants.find(occupant => occupant.id === id);

  function nextId(type) {
    const prefix = OCCUPANT_TYPES[type].prefix;
    for (let i = 1; ; i++) if (!state().occupants.some(occupant => occupant.id === `${prefix}-${i}`)) return `${prefix}-${i}`;
  }

  function loadScene(id) {
    const scene = SCENES.find(item => item.id === id);
    if (!scene) throw new Error('Choose an existing scene.');
    if (state().movement) throw new Error('Finish movement before changing the scene.');
    sceneId = id;
    state().occupants = [];
    for (const {type, x, z, walk} of scene.occupants) state().occupants.push({
      id: nextId(type), type, position: {x, z},
      walk: walk ? {path: walk.map(p => ({...p})), speed: 2, target: 1, direction: 1} : null
    });
    tracker.clear();
    events = []; trails = new Map(); knownCrowds = new Set(); knownWarnings = new Set(); factor = 1;
    snapshot = emptySnapshot();
    return scene;
  }

  // Why a position is unavailable for an occupant, or null when it can stand there.
  function placementProblem(id, position) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return 'Enter finite x and z coordinates in meters.';
    const cell = toCell(position);
    if (!isOccupiable(cell)) return 'That location is not occupiable. Choose an open cell on the ground.';
    const {robot, package: parcel, movement, occupants, delivery} = state();
    if (occupants.some(other => other.id !== id && sameCell(toCell(other.position), cell))) return 'Another occupant already stands there.';
    if (delivery === false) return null;
    if (sameCell(toCell(robot.position), cell)) return 'The robot occupies that location.';
    if (!parcel.carriedBy && sameCell(toCell(parcel.position), cell)) return 'The package occupies that location.';
    if (movement && distanceToSegment(cellCenter(cell), robot.position, movement.end) < ON_PATH) return 'The robot is traversing that location.';
    return null;
  }

  function add(type, position) {
    if (!OCCUPANT_TYPES[type]) throw new Error('Choose person, recipient, or warning cone.');
    if (state().occupants.length >= MAX_OCCUPANTS) throw new Error(`The street holds at most ${MAX_OCCUPANTS} occupants.`);
    const problem = placementProblem(null, position);
    if (problem) throw new Error(problem);
    const occupant = {id: nextId(type), type, position: cellCenter(toCell(position)), walk: null};
    state().occupants.push(occupant);
    return occupant;
  }

  function firstOpenCell() {
    const cells = [];
    for (let row = -9; row <= 9; row++) for (let col = -11; col <= 11; col++) cells.push(cellCenter({col, row}));
    cells.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    const open = cells.find(position => !placementProblem(null, position) && (state().delivery === false || !state().segments.some(s => distanceToSegment(position, s.start, s.end) < ON_PATH)));
    if (!open) throw new Error('No open location remains.');
    return open;
  }

  function place(id, position) {
    const occupant = findOccupant(id);
    if (!occupant) throw new Error('Choose an existing occupant.');
    const problem = placementProblem(id, position);
    if (problem) throw new Error(problem);
    occupant.position = cellCenter(toCell(position));
    occupant.walk = null;
    return occupant;
  }

  function remove(id) {
    if (!findOccupant(id)) throw new Error('Choose an existing occupant.');
    state().occupants = state().occupants.filter(occupant => occupant.id !== id);
  }

  // Why the robot's next segment is obstructed, phrased to follow the segment id.
  function obstruction() {
    const segment = state().segments[state().nextIndex];
    if (!segment) return null;
    const entities = entitiesFrom(state());
    const crowd = findCrowds(entities).find(item => distanceToSegment(item.center, segment.start, segment.end) < item.radius);
    if (crowd) return `is blocked by a crowd of ${crowd.members.length}`;
    const occupant = state().occupants.find(item => distanceToSegment(item.position, segment.start, segment.end) < ON_PATH);
    return occupant ? `is occupied by ${occupant.id}` : null;
  }

  function updateTrails(primary) {
    for (const entity of entitiesFrom(state())) {
      const trail = trails.get(entity.id) || [];
      const last = trail.at(-1);
      if (!last || Math.hypot(entity.position.x - last.x, entity.position.z - last.z) >= TRAIL_SPACING) {
        if (last && Math.hypot(entity.position.x - last.x, entity.position.z - last.z) > 3) trail.length = 0;
        trail.push({x: entity.position.x, z: entity.position.z, kind: primary.find(item => item.mover === entity.id)?.kind || 'still', time: clock});
        if (trail.length > TRAIL_LENGTH) trail.shift();
      }
      trails.set(entity.id, trail.filter(point => clock - point.time <= TRAIL_LIFETIME));
    }
  }

  function tick(milliseconds) {
    clock += milliseconds;
    let changed = false;
    const current = state();
    current.occupants.forEach(occupant => advanceWalk(occupant, milliseconds));
    const entities = entitiesFrom(current);
    const relations = detectRelations(entities);
    const crowds = findCrowds(entities);

    const crowdKeys = new Set(crowds.map(crowd => crowd.members.join()));
    for (const crowd of crowds) if (!knownCrowds.has(crowd.members.join())) {
      log(`Crowd of ${crowd.members.length} formed: ${crowd.members.join(', ')}.`, 'warning');
      changed = true;
    }
    knownCrowds = crowdKeys;

    const touchesRobot = pair => pair.a === current.robot.id || pair.b === current.robot.id;
    const other = pair => pair.a === current.robot.id ? pair.b : pair.a;
    const robotNeighbors = relations.adjacent.filter(touchesRobot).map(other);
    const warnings = robotNeighbors.filter(id => findOccupant(id)?.type === 'cone');
    for (const id of warnings) if (!knownWarnings.has(id)) {
      log(`${id} is adjacent to the robot. Warning: slowing down.`, 'warning');
      changed = true;
    }
    knownWarnings = new Set(warnings);
    factor = warnings.length ? WARNING_SPEED : 1;

    const recipient = robotNeighbors.find(id => findOccupant(id)?.type === 'recipient');
    if (recipient && !current.movement && current.robot.carryingId && samePosition(current.robot.position, current.package.destination)) {
      log(`${recipient} is adjacent at the destination. Automatic handoff.`, 'success');
      getModel().deliver();
      changed = true;
    }

    const zones = current.delivery === false ? [] : deliveryZones(current);
    const {trends, events: fresh} = tracker.sample(clock, entitiesFrom(current), zones);
    for (const event of fresh) {
      events.push(event);
      if (event.mover !== current.robot.id) continue;
      const verb = {into: 'moved into the', out: 'moved out of the', past: 'moved past'}[event.kind];
      log(`Robot ${verb} ${event.referentName}.`);
      changed = true;
    }
    events = events.filter(event => clock - event.time <= EVENT_LIFETIME);
    const primary = primaryTrends(trends);
    updateTrails(primary);

    const live = entitiesFrom(current);
    snapshot = {
      relations, crowds, warnings, zones, time: clock, robot: {...current.robot.position},
      trends: primary.map(trend => ({...trend, moverPosition: {...live.find(entity => entity.id === trend.mover)?.position}})),
      events: events.map(event => ({...event, age: clock - event.time})),
      trails: [...trails.entries()].map(([id, points]) => ({id, points})).filter(trail => trail.points.length > 1)
    };
    return {changed, snapshot};
  }

  return {
    SCENES, loadScene, add, place, remove, tick, obstruction, placementProblem, firstOpenCell,
    reset: () => loadScene(sceneId),
    sceneId: () => sceneId,
    speedFactor: () => factor,
    snapshot: () => snapshot,
    occupants: () => state().occupants
  };
}
