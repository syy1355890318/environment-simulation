// Ground-plane positions in meters are the single source of location truth.
import {BLOCKS, PLACES, STREETS} from './city.js';
import {distanceToSegment} from './spatial.js';

const EPSILON = 1e-7;
const copy = p => ({x: p.x, z: p.z});
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const number = n => Number(n.toFixed(2)).toString();
const normalize = text => String(text).toLowerCase().trim()
  .replace(/[–—&-]/g, ' ').replace(/\band\b/g, ' ').replace(/\s+/g, ' ');
const shortName = name => name.replace(/\s+(Street|Passage|Walk|Lane)$/i, '');

export function validPosition(position) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) {
    throw new Error('Enter finite x and z coordinates in meters.');
  }
  return copy(position);
}

export function toFrame(state, position, frame = 'world') {
  const p = validPosition(position);
  if (frame === 'world') return p;
  if (frame !== 'pickup') throw new Error('Choose World or Relative to pickup.');
  return {x: p.x - state.package.pickup.x, z: p.z - state.package.pickup.z};
}

export function fromFrame(state, position, frame = 'world') {
  const p = validPosition(position);
  if (frame === 'world') return p;
  if (frame !== 'pickup') throw new Error('Choose World or Relative to pickup.');
  return {x: p.x + state.package.pickup.x, z: p.z + state.package.pickup.z};
}

// Typed coordinates such as "-2, 2" or "(10, -4) m". Anything else is not coordinates.
export function parseCoordinates(text) {
  const match = String(text).replace(/−/g, '-').match(/^\s*\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?\s*(?:m|meters|metres)?\s*$/i);
  return match ? {x: Number(match[1]), z: Number(match[2])} : null;
}

export function getLandmarks(state) {
  const segments = state.segments;
  const landmarks = [{id: 'pickup', name: 'Market Street pickup',
    position: copy(state.package.pickup), aliases: ['pickup', 'pickup point', 'market pickup', 'market street pickup']}];
  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i], b = segments[i + 1];
    if (distance(a.end, b.start) > EPSILON) continue;
    landmarks.push({id: `junction-${a.id}-${b.id}`, name: `${a.name}–${b.name} junction`,
      position: copy(a.end), aliases: [
        `${a.name} ${b.name} junction`, `${shortName(a.name)} ${shortName(b.name)} junction`,
        `${b.name} ${a.name} junction`, `${shortName(b.name)} ${shortName(a.name)} junction`
      ]});
  }
  landmarks.push({id: 'destination', name: 'Willow Lane destination',
    position: copy(state.package.destination), aliases: ['destination', 'dropoff', 'drop off', 'willow destination', 'willow lane destination']});
  return landmarks;
}

export function projectOnSegment(position, segment) {
  const p = validPosition(position), dx = segment.end.x - segment.start.x, dz = segment.end.z - segment.start.z;
  const length = Math.hypot(dx, dz);
  const fraction = length ? Math.max(0, Math.min(1,
    ((p.x - segment.start.x) * dx + (p.z - segment.start.z) * dz) / (length * length))) : 0;
  const projected = {x: segment.start.x + fraction * dx, z: segment.start.z + fraction * dz};
  return {position: projected, fraction, length, along: fraction * length, distance: distance(p, projected)};
}

export function segmentsAt(state, position) {
  return state.segments.filter(segment => projectOnSegment(position, segment).distance <= EPSILON);
}

export function describePosition(state, position) {
  const p = validPosition(position), landmarks = getLandmarks(state);
  const landmark = landmarks.find(item => distance(item.position, p) <= EPSILON);
  if (landmark) return `At ${landmark.name}`;
  const segment = segmentsAt(state, p)[0];
  if (segment) {
    const projection = projectOnSegment(p, segment);
    const endpoint = landmarks.find(item => distance(item.position, segment.end) <= EPSILON);
    return `${number(projection.along)} m along ${segment.name} toward ${endpoint?.name || 'its end'}`;
  }
  const nearest = landmarks.reduce((best, item) => distance(p, item.position) < distance(p, best.position) ? item : best);
  const dx = p.x - nearest.position.x, dz = p.z - nearest.position.z, directions = [];
  if (Math.abs(dx) > EPSILON) directions.push(`${number(Math.abs(dx))} m ${dx > 0 ? 'east' : 'west'}`);
  if (Math.abs(dz) > EPSILON) directions.push(`${number(Math.abs(dz))} m ${dz > 0 ? 'south' : 'north'}`);
  return `${directions.join(' and ')} of ${nearest.name}`;
}

export function objectLocation(state, id) {
  if (id === state.robot.id) return {kind: 'point', id, name: `Robot ${id}`, position: copy(state.robot.position),
    relation: state.robot.carryingId ? `Carrying ${state.robot.carryingId}` : 'Carrying no package', status: state.robot.motionState};
  if (id === state.package.id) return {kind: 'point', id, name: `Package ${id}`, position: copy(state.package.position),
    relation: state.package.carriedBy ? `Carried by ${state.package.carriedBy}` : 'Not carried', status: state.package.deliveryStatus};
  const occupant = (state.occupants || []).find(item => item.id === id);
  if (occupant) return {kind: 'point', id, name: `${occupant.type[0].toUpperCase()}${occupant.type.slice(1)} ${id}`, position: copy(occupant.position),
    relation: occupant.walk ? 'Walking' : 'Standing', status: occupant.type};
  const segment = state.segments.find(item => item.id === id);
  if (segment) return {kind: 'segment', id, name: segment.name, start: copy(segment.start), end: copy(segment.end),
    position: {x: (segment.start.x + segment.end.x) / 2, z: (segment.start.z + segment.end.z) / 2},
    length: distance(segment.start, segment.end), relation: 'Path extent; marker shows midpoint'};
  throw new Error('Choose an existing robot, package, or path segment.');
}

export function occupantsAt(state, position, radius = 0.5) {
  const p = validPosition(position);
  if (!Number.isFinite(radius) || radius < 0) throw new Error('Search radius must be a finite number, zero or greater.');
  return [...(state.delivery === false ? [] : [state.robot.id, state.package.id]), ...(state.occupants || []).map(item => item.id)].map(id => objectLocation(state, id))
    .map(object => ({...object, distance: distance(p, object.position)}))
    .filter(object => object.distance <= radius + EPSILON);
}

export function resolveDescription(state, description) {
  if (/^\s*[-−]\s*\d/.test(String(description))) return {kind: 'error', message: 'Distances and percentages along a path must be nonnegative.'};
  const text = normalize(description).replace(/^at (?:the )?/, '');
  if (!text) return {kind: 'error', message: 'Enter a landmark, path, or distance along a path.'};
  const landmarks = getLandmarks(state);
  const point = landmark => ({kind: 'point', id: landmark.id, name: landmark.name, position: copy(landmark.position)});
  const matched = landmarks.find(item => [item.name, ...item.aliases].some(alias => normalize(alias) === text));
  if (matched) return point(matched);
  if (['robot', normalize(state.robot.id)].includes(text)) return objectLocation(state, state.robot.id);
  if (['package', normalize(state.package.id)].includes(text)) return objectLocation(state, state.package.id);
  const segmentMatch = state.segments.find(item => [item.id, item.name].some(alias => normalize(alias) === text));
  if (segmentMatch) return objectLocation(state, segmentMatch.id);
  const along = text.match(/^(halfway|midpoint|start|end|\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*(?:m|meters|metres))\s+(?:along|of)\s+(.+)$/);
  if (along) {
    const segment = state.segments.find(item => [item.id, item.name].some(alias => normalize(alias) === along[2]));
    if (!segment) return {kind: 'error', message: 'That path is unknown. Choose one of the four named paths.'};
    const length = distance(segment.start, segment.end), amount = along[1];
    let fraction = ['halfway', 'midpoint'].includes(amount) ? 0.5 : amount === 'start' ? 0 : amount === 'end' ? 1 :
      amount.endsWith('%') ? parseFloat(amount) / 100 : parseFloat(amount) / length;
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return {kind: 'error', message: `Use 0–100% or a distance from 0 to ${number(length)} m along ${segment.name}.`};
    const position = {x: segment.start.x + (segment.end.x - segment.start.x) * fraction,
      z: segment.start.z + (segment.end.z - segment.start.z) * fraction};
    return {kind: 'point', name: `${segment.name} · ${number(fraction * 100)}%`, position};
  }
  const candidates = [
    ...landmarks.map(item => ({...point(item), aliases: [item.name, ...item.aliases]})),
    ...state.segments.map(item => ({...objectLocation(state, item.id), aliases: [item.name]}))
  ].filter(item => item.aliases.some(alias => normalize(alias).includes(text)))
    .map(({aliases, ...item}) => item);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return {kind: 'candidates', candidates, message: 'Several places match. Choose a specific location below.'};
  return {kind: 'error', message: 'Unknown description. Try “pickup”, “halfway along Garden Passage”, or “6 m along Garden Passage”.'};
}

const streetsAt = position => STREETS.filter(street => distanceToSegment(position, street.start, street.end) <= street.width / 2 + EPSILON);
const streetResult = street => ({kind: 'segment', id: street.id, name: street.name, start: copy(street.start), end: copy(street.end),
  position: {x: (street.start.x + street.end.x) / 2, z: (street.start.z + street.end.z) / 2}, length: distance(street.start, street.end)});

// Where a point is in the city: a named place, a street or junction, an open space, or the nearest place.
export function describeCityPosition(position) {
  const p = validPosition(position);
  const here = PLACES.find(item => distance(item.position, p) <= 1);
  if (here) return `At ${here.name}`;
  const streets = streetsAt(p);
  if (streets.length > 1) return `${streets[0].name} and ${streets[1].name} junction`;
  if (streets.length === 1) return `On ${streets[0].name}`;
  const open = BLOCKS.find(item => item.kind !== 'building' && p.x >= item.x0 && p.x <= item.x1 && p.z >= item.z0 && p.z <= item.z1);
  if (open) return `In the ${open.kind}`;
  const nearest = PLACES.reduce((best, item) => distance(p, item.position) < distance(p, best.position) ? item : best);
  return `${number(distance(p, nearest.position))} m from ${nearest.name}`;
}

// Resolve a typed place or street name. Several partial matches are offered as candidates.
export function findInCity(text) {
  const query = normalize(text);
  if (!query) return {kind: 'error', message: 'Enter a place, a street, or coordinates.'};
  const all = [...PLACES.map(item => ({kind: 'point', id: item.id, name: item.name, position: copy(item.position)})), ...STREETS.map(streetResult)];
  const exact = all.find(item => normalize(item.name) === query);
  if (exact) return exact;
  const candidates = all.filter(item => normalize(item.name).includes(query));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return {kind: 'candidates', candidates, message: 'Several places match. Choose one below.'};
  return {kind: 'error', message: 'Unknown place. Try “Fountain”, “Market Street”, or “20, 2”.'};
}
