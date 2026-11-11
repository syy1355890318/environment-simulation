// The card for one agent and the wording around the simulation controls.
import {AGENT} from './agent.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const row = (label, value) => `<div class="row"><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;
const seconds = value => `${Math.round(value)} s`;
const meters = value => `${Math.round(value)} m`;

const GOALS = {
  visitor: `See all ${AGENT.exhibits} exhibits, then return to the gate. Each tour should take ${AGENT.tourLimit} s or less.`,
  courier: 'Carry parcels from the depot to exhibits, using as little energy as possible.'
};

function tripLine(agent, trip) {
  if (agent.type === 'courier') return `Delivery ${trip.index} · ${seconds(trip.time)} · ${Math.round(trip.energy)} energy`;
  return `Tour ${trip.index} · ${seconds(trip.time)} · ${meters(trip.distance)} · ${trip.time <= AGENT.tourLimit ? 'in time' : 'over time'}`;
}

export function agentCard(sim, id) {
  const agent = sim.agent(id);
  if (!agent) return null;
  const {trip, memory} = agent, stats = memory.stats(), elapsed = trip ? sim.time - trip.startedAt : 0;
  const now = agent.type === 'visitor'
    ? row('This tour', `${seconds(elapsed)} of ${AGENT.tourLimit} s`) + row('Walked', meters(trip ? agent.odometer - trip.odometer : 0)) +
      row('Exhibits seen', `${trip ? trip.visited.size : 0} of ${AGENT.exhibits}`)
    : row('This delivery', seconds(elapsed)) + row('Energy used', String(Math.round(trip ? agent.energy - trip.energy : 0))) +
      row('Battery', `${Math.round(agent.battery / AGENT.battery * 100)}%`);
  // The first trip and the latest few show how much landmarks help.
  const shown = agent.trips.length > 5 ? [agent.trips[0], ...agent.trips.slice(-4)] : agent.trips;
  const trips = shown.length ? `<ul class="plain">${shown.map(item => `<li>${escape(tripLine(agent, item))}</li>`).join('')}</ul>`
    : '<p class="hint">No trip finished yet.</p>';
  const places = memory.landmarks.filter(item => item.kind !== 'hindrance').map(item => item.name);
  const slow = memory.landmarks.length - places.length;
  return {
    title: `${agent.type === 'visitor' ? 'Visitor' : 'Courier'} ${agent.id}`,
    html: `<p class="lede">${escape(agent.status)}</p><p class="hint">${escape(GOALS[agent.type])}</p>${now}` +
      row('Streets mapped', `${Math.round(stats.passableKnown / sim.truth.passableCount * 100)}%`) +
      `<h3>Landmarks</h3><p class="hint">${escape(places.join(', ') || 'None yet')}${slow ? escape(`, and ${slow} patch${slow > 1 ? 'es' : ''} of slow ground`) : ''}</p>` +
      `<h3>Trips</h3>${trips}`
  };
}

export function simStatus(sim) {
  const {time, firstTrip, laterTrips} = sim.summary();
  const clock = `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
  if (firstTrip === null) return clock;
  return laterTrips === null ? `${clock} · first trips ${seconds(firstTrip)}` : `${clock} · first trips ${seconds(firstTrip)}, later ${seconds(laterTrips)}`;
}
