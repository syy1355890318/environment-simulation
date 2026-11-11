// Runs the agents against the true city in fixed steps, and summarizes what they know together.
import {W, H, UNKNOWN, HINDRANCE, indexOf, centerOf, passable, distance} from './nav.js';
import {createTruth} from './agent-world.js';
import {perceive} from './perception.js';
import {createAgent, AGENT} from './agent.js';

export const STEP = 0.1;
export const LIMITS = {min: 2, max: 10};
const MAX_STEPS_PER_CALL = 400, BODY = 0.3, GAP = 0.7, SQUEEZE_GAP = 0.3;
// Agents enter at the ends of the main streets.
const GATE_POSITIONS = [[-44, 8], [44, -4], [-2, -32], [28, 32], [-30, -32], [44, 24], [-44, -22], [10, -32], [-44, 24], [44, 8]];
export const GATES = GATE_POSITIONS.map(([x, z], n) => ({id: `gate-${n + 1}`, name: `Gate ${n + 1}`, kind: 'gate', position: {x: x + .5, z: z + .5}}));

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function createAgentSim({count = 4, seed = 1, useLandmarks = true} = {}) {
  const truth = createTruth(GATES), agents = [], visits = new Uint16Array(W * H);
  const exhibits = truth.places.filter(place => place.kind === 'exhibit').map(({id, name}) => ({id, name}));
  let time = 0, pending = 0, landmarks = useLandmarks;

  function setCount(next) {
    const wanted = Math.max(LIMITS.min, Math.min(LIMITS.max, Math.round(next)));
    while (agents.length > wanted) agents.pop();
    while (agents.length < wanted) {
      const n = agents.length, type = n % 2 ? 'courier' : 'visitor';
      const agent = createAgent({id: `${type === 'courier' ? 'C' : 'V'}-${Math.floor(n / 2) + 1}`, type, gate: GATES[n], random: mulberry(seed * 1000 + n)});
      agent.exhibits = exhibits;
      agents.push(agent);
    }
  }

  // The body must fit: its center and four points around it stand on passable ground.
  function fits(x, z) {
    for (const [ox, oz] of [[0, 0], [BODY, 0], [-BODY, 0], [0, BODY], [0, -BODY]]) {
      const index = indexOf(x + ox, z + oz);
      if (index < 0 || !passable(truth.cells[index])) return false;
    }
    return true;
  }
  function crowded(agent, x, z) {
    const gap = agent.squeezing() ? SQUEEZE_GAP : GAP;
    return agents.some(other => other !== agent && Math.hypot(other.position.x - x, other.position.z - z) < gap &&
      Math.hypot(other.position.x - x, other.position.z - z) < distance(other.position, agent.position));
  }

  function step() {
    time += STEP;
    for (const agent of agents) {
      const percept = perceive(truth, agent, agents.filter(other => other !== agent));
      const velocity = agent.step(STEP, percept, time, landmarks);
      const from = agent.position, ground = truth.cells[indexOf(from.x, from.z)];
      const scale = STEP * (ground === HINDRANCE ? AGENT.hindranceSpeed : 1);
      const dx = velocity.x * scale, dz = velocity.z * scale, wanted = Math.hypot(dx, dz);
      let to = from;
      // Try the full move, then sliding along a wall, then stepping back to the middle of the cell.
      const middle = centerOf(indexOf(from.x, from.z)), off = distance(from, middle) || 1;
      const recenter = [(middle.x - from.x) / off * wanted, (middle.z - from.z) / off * wanted];
      for (const [mx, mz] of [[dx, dz], [dx, 0], [0, dz], recenter]) {
        const x = from.x + mx, z = from.z + mz;
        if (Math.hypot(mx, mz) >= wanted * 0.3 && wanted > 0 && fits(x, z) && !crowded(agent, x, z)) { to = {x, z}; break; }
      }
      const before = indexOf(from.x, from.z), after = indexOf(to.x, to.z);
      if (after !== before && visits[after] < 65535) visits[after]++;
      agent.moved(to, ground, wanted, STEP);
    }
  }

  setCount(count);

  return {
    agents, truth, visits, GATES,
    get time() { return time; },
    get useLandmarks() { return landmarks; },
    setCount,
    setLandmarks(value) { landmarks = !!value; },
    setCones: positions => truth.setCones(positions),
    step,
    // Advance by wall-clock milliseconds already multiplied by the playback speed.
    advance(milliseconds) {
      pending += milliseconds;
      let steps = 0;
      while (pending >= STEP * 1000 - 1e-6 && steps++ < MAX_STEPS_PER_CALL) { pending -= STEP * 1000; step(); }
      if (pending > STEP * 1000) pending = 0;
    },
    agent: id => agents.find(agent => agent.id === id) || null,
    // For each cell, how many agents know it.
    sharedKnowledge() {
      const counts = new Uint8Array(W * H);
      for (const agent of agents) {
        const cells = agent.memory.cells;
        for (let index = 0; index < counts.length; index++) if (cells[index] !== UNKNOWN) counts[index]++;
      }
      return counts;
    },
    // For each landmark anyone has left, how many agents have it.
    landmarkHeat() {
      const heat = new Map();
      for (const agent of agents) for (const landmark of agent.memory.landmarks) {
        if (landmark.kind === 'gate') continue;
        const key = landmark.placeId || `${landmark.kind}:${Math.round(landmark.position.x / 6)},${Math.round(landmark.position.z / 6)}`;
        const entry = heat.get(key) || {name: landmark.name, kind: landmark.kind, position: landmark.position, count: 0};
        entry.count++;
        heat.set(key, entry);
      }
      return [...heat.values()];
    },
    summary() {
      const average = list => list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
      const trips = agents.flatMap(agent => agent.trips);
      return {
        time, agents: agents.length,
        mapped: average(agents.map(agent => agent.memory.stats().passableKnown / truth.passableCount)),
        firstTrip: average(trips.filter(trip => trip.index === 1).map(trip => trip.time)),
        laterTrips: average(trips.filter(trip => trip.index > 1).map(trip => trip.time)),
        trips: trips.length
      };
    }
  };
}
