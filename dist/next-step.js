import {samePosition} from './model.js';

// The one thing the delivery needs now: a sentence and, when something can be done, an action.
export function nextStep(state, obstruction = null) {
  const {robot, package: parcel, segments, nextIndex, movement} = state;
  const next = segments[nextIndex];
  if (movement) return {text: `Moving along ${segments.find(s => s.id === robot.traversingId).name}`, action: null, canWait: false};
  if (parcel.deliveryStatus === 'delivered') return {text: 'Delivered', action: 'reset', label: 'Start over', canWait: false};
  if (parcel.deliveryStatus === 'waiting') return {text: 'Package waiting at pickup', action: 'pickup', label: 'Pick up', canWait: true};
  if (samePosition(robot.position, parcel.destination)) return {text: 'At destination', action: 'deliver', label: 'Deliver', canWait: true};
  const problem = next.blocked ? 'blocked' : next.clearWidth <= robot.width ? 'too narrow' : obstruction;
  return {text: problem ? `${next.name} ${problem}` : `Next: ${next.name}`, action: 'move', label: 'Move', canWait: true, warning: !!problem};
}
