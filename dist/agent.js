// A spatial agent: it senses, remembers, decides, and steers. It never touches the true city.
import {HINDRANCE, indexOf, distance} from './nav.js';
import {createMemory} from './agent-memory.js';
import {findPath, findFrontier, isFrontier, smoothPath, clearLine} from './planner.js';

export const AGENT = {
  speed: {visitor: 2, courier: 3},
  // How much worse slow ground is to each type: visitors lose time, couriers lose energy.
  hindranceCost: {visitor: 2.5, courier: 6},
  hindranceSpeed: 0.4, hindranceEnergy: 3,
  exhibits: 5, tourLimit: 300,
  battery: 300, lowBattery: 0.3, flatSpeed: 0.35,
  arrive: 1.3, turnRate: 5, personalSpace: 2.5
};
const STOP = {x: 0, z: 0};
const TRAIL_SPACING = 1, TRAIL_LENGTH = 400;

export function createAgent({id, type, gate, random}) {
  const memory = createMemory();
  const agent = {
    id, type, gate, memory,
    position: {...gate.position},
    heading: Math.atan2(-gate.position.z, -gate.position.x),
    status: 'Starting', path: null, target: null, visible: [],
    odometer: 0, energy: 0, battery: AGENT.battery,
    trips: [], trip: null, stage: 'pickup', job: null, trail: [{...gate.position}]
  };
  let pathIndex = 0, pause = 0, pendingTrip = false, decideIn = 0, stuck = 0, lastLandmark = null, legStart = 0;
  let squeeze = 0;

  const here = () => indexOf(agent.position.x, agent.position.z);
  const cost = () => ({hindranceCost: AGENT.hindranceCost[type]});

  function startTrip(time, useLandmarks) {
    memory.startTrip(useLandmarks);
    agent.trip = {index: agent.trips.length + 1, startedAt: time, odometer: agent.odometer, energy: agent.energy, visited: new Set(), landmarks: useLandmarks};
    lastLandmark = null;
    legStart = agent.odometer;
    agent.path = agent.target = null;
  }
  function finishTrip(time) {
    const {index, startedAt, odometer, energy, landmarks} = agent.trip;
    agent.trips.push({index, time: time - startedAt, distance: agent.odometer - odometer, energy: agent.energy - energy, landmarks});
    pendingTrip = true;
    pause = 2;
  }

  // The landmark the agent should head for now, or null when it does not know where to go.
  function wanted() {
    const known = memory.landmarks;
    if (type === 'courier') {
      if (agent.battery / AGENT.battery < AGENT.lowBattery) {
        const chargers = known.filter(item => item.kind === 'charger');
        if (chargers.length) return nearest(chargers);
      }
      return agent.stage === 'pickup' ? known.find(item => item.kind === 'depot') || null : memory.landmarkFor(agent.job.id);
    }
    const unseen = known.filter(item => item.kind === 'exhibit' && !agent.trip.visited.has(item.placeId));
    if (unseen.length) return nearest(unseen);
    return agent.trip.visited.size >= AGENT.exhibits ? memory.landmarkFor(gate.id) : null;
  }
  // Prefer a distance the agent has actually walked over a straight-line guess.
  function nearest(landmarks) {
    const estimate = item => lastLandmark?.routes[item.id] ?? distance(agent.position, item.position) * 1.3;
    return landmarks.reduce((best, item) => estimate(item) < estimate(best) ? item : best);
  }

  function follow(route, target, status) {
    agent.path = smoothPath(memory.cells, route);
    pathIndex = Math.min(1, agent.path.length - 1);
    agent.target = target;
    agent.status = status;
  }
  function describeSearch() {
    if (type === 'courier') return agent.stage === 'pickup' ? 'Looking for the depot' : `Looking for ${agent.job.name}`;
    return agent.trip.visited.size >= AGENT.exhibits ? 'Looking for the gate' : `Looking for exhibits (${agent.trip.visited.size} of ${AGENT.exhibits} seen)`;
  }
  function describeGoing(landmark) {
    if (landmark.kind === 'charger') return 'Going to charge';
    if (landmark.kind === 'gate') return 'Returning to the gate';
    if (type === 'courier') return agent.stage === 'pickup' ? 'Going to the depot' : `Delivering to ${landmark.name}`;
    return `Walking to ${landmark.name}`;
  }

  function decide() {
    const cell = here(), goal = wanted();
    if (goal) {
      const route = findPath(memory.cells, cell, goal.cell, cost());
      if (route) { follow(route, {kind: 'landmark', landmark: goal}, describeGoing(goal)); return; }
    }
    // Keep walking to a frontier that is still worth reaching.
    if (!goal && agent.target?.kind === 'frontier' && agent.path && isFrontier(memory.cells, memory.swept, agent.target.cell)) return;
    let route = findFrontier(memory.cells, memory.swept, cell, {...cost(), toward: goal?.position});
    if (!route) {
      memory.resweep();
      route = findFrontier(memory.cells, memory.swept, cell, cost());
    }
    if (route) follow(route, {kind: 'frontier', cell: route.at(-1)}, goal ? describeGoing(goal) : describeSearch());
    else { agent.path = agent.target = null; agent.status = 'Nowhere left to look'; }
  }

  function arrive(landmark, time) {
    memory.recordRoute(lastLandmark, landmark, agent.odometer - legStart);
    lastLandmark = landmark;
    legStart = agent.odometer;
    landmark.visits++;
    agent.path = agent.target = null;
    if (landmark.kind === 'charger') { agent.battery = AGENT.battery; pause = 2; agent.status = 'Charging'; return; }
    if (type === 'visitor') {
      if (landmark.kind === 'exhibit') { agent.trip.visited.add(landmark.placeId); pause = 1; agent.status = `Looking at ${landmark.name}`; }
      else if (landmark.kind === 'gate') { agent.status = 'Back at the gate'; finishTrip(time); }
      return;
    }
    if (agent.stage === 'pickup') {
      agent.job = agent.exhibits[Math.floor(random() * agent.exhibits.length)];
      agent.stage = 'deliver';
      pause = 1.5;
      agent.status = `Collected a parcel for ${agent.job.name}`;
    } else {
      agent.stage = 'pickup';
      agent.job = null;
      agent.status = `Delivered to ${landmark.name}`;
      finishTrip(time);
    }
  }

  // Did the agent just reach something it was after?
  function reached(time) {
    const near = item => distance(agent.position, item.position) < AGENT.arrive;
    if (agent.target?.kind === 'landmark' && near(agent.target.landmark)) return arrive(agent.target.landmark, time), true;
    if (type !== 'visitor') return false;
    const passing = memory.landmarks.find(item => item.kind === 'exhibit' && !agent.trip.visited.has(item.placeId) && near(item));
    if (passing) arrive(passing, time);
    return !!passing;
  }

  agent.exhibits = [];
  // One tick of thinking. Returns the velocity the agent wants.
  agent.step = (dt, percept, time, useLandmarks) => {
    if (!agent.trip) startTrip(time, useLandmarks);
    agent.visible = percept.cells;
    squeeze = Math.max(0, squeeze - dt);
    const found = memory.observe({...percept, places: percept.places.filter(place => place.kind !== 'gate' || place.id === gate.id)}, time);
    if (pause > 0) {
      pause -= dt;
      if (pause <= 0 && pendingTrip) { pendingTrip = false; startTrip(time, useLandmarks); }
      return STOP;
    }
    if (reached(time)) return STOP;
    decideIn -= dt;
    if (!agent.path || found.length || decideIn <= 0) { decide(); decideIn = 1; }
    if (!agent.path) return STOP;
    // Move on to the next leg early only when the way to it is already clear; otherwise finish the corner.
    while (pathIndex < agent.path.length - 1) {
      const gap = distance(agent.position, agent.path[pathIndex]);
      if (gap >= 0.7 || (gap >= 0.2 && !clearLine(memory.cells, agent.position, agent.path[pathIndex + 1], true))) break;
      pathIndex++;
    }
    const waypoint = agent.path[pathIndex];
    if (pathIndex === agent.path.length - 1 && distance(agent.position, waypoint) < 0.3) { agent.path = null; decideIn = 0; return STOP; }

    let dx = waypoint.x - agent.position.x, dz = waypoint.z - agent.position.z;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length; dz /= length;
    // Steer around others in view, keeping to the right, and slow when one is close ahead.
    let slow = 1;
    for (const other of percept.agents) {
      const gap = distance(agent.position, other.position);
      if (gap >= AGENT.personalSpace || gap === 0) continue;
      const weight = (AGENT.personalSpace - gap) / AGENT.personalSpace;
      const ax = (agent.position.x - other.position.x) / gap, az = (agent.position.z - other.position.z) / gap;
      const ahead = -(ax * Math.cos(agent.heading) + az * Math.sin(agent.heading)) > 0.3;
      dx += ax * weight * 1.5 - Math.sin(agent.heading) * weight * (ahead ? 0.9 : 0);
      dz += az * weight * 1.5 + Math.cos(agent.heading) * weight * (ahead ? 0.9 : 0);
      if (ahead && gap < 1.2) slow = Math.min(slow, 0.45);
    }
    const turn = Math.atan2(Math.sin(Math.atan2(dz, dx) - agent.heading), Math.cos(Math.atan2(dz, dx) - agent.heading));
    agent.heading += Math.max(-AGENT.turnRate * dt, Math.min(AGENT.turnRate * dt, turn));
    const flat = type === 'courier' && agent.battery <= 0 ? AGENT.flatSpeed : 1;
    const speed = AGENT.speed[type] * Math.max(0.15, Math.cos(Math.min(Math.abs(turn), Math.PI / 2))) * slow * flat;
    return {x: Math.cos(agent.heading) * speed, z: Math.sin(agent.heading) * speed};
  };

  // The simulation reports where the agent actually ended up.
  agent.moved = (position, ground, wanted, dt) => {
    const step = distance(agent.position, position), spent = step * (ground === HINDRANCE ? AGENT.hindranceEnergy : 1);
    agent.position = position;
    agent.odometer += step;
    agent.energy += spent;
    if (type === 'courier') agent.battery = Math.max(0, agent.battery - spent);
    if (distance(agent.trail.at(-1), position) >= TRAIL_SPACING) {
      agent.trail.push({...position});
      if (agent.trail.length > TRAIL_LENGTH) agent.trail.shift();
    }
    stuck = wanted > 0.02 && step < wanted * 0.25 ? stuck + dt : 0;
    if (stuck > 2.5) {
      // Boxed in: turn aside, allow a tighter squeeze for a moment, and think again.
      stuck = 0;
      squeeze = 2;
      agent.heading += (random() - 0.5) * 3;
      decideIn = 0;
    }
  };
  agent.squeezing = () => squeeze > 0;
  agent.pathAhead = () => agent.path ? [agent.position, ...agent.path.slice(pathIndex)] : [];
  return agent;
}
