// Movement notions read from position history: toward/away, past, and into/out of a zone.
export const ZONE_RADIUS = 3;
const TREND_WINDOW = 600;
const MIN_TREND_TIME = 150;
const MIN_DISPLACEMENT = 0.2;
const MIN_RATE = 0.25;
const PAST_TRACK_RADIUS = 8;
const PAST_RADIUS = 4;
const PAST_CLEARANCE = 0.5;

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export const deliveryZones = state => [
  {id: 'pickup-zone', name: 'pickup zone', position: state.package.pickup, radius: ZONE_RADIUS},
  {id: 'destination-zone', name: 'destination zone', position: state.package.destination, radius: ZONE_RADIUS}
];

export function createMovementTracker() {
  const histories = new Map(), passes = new Map(), inside = new Map();

  function clear() { histories.clear(); passes.clear(); inside.clear(); }

  // Returns the trends now in effect and the events that happened in this sample.
  function sample(time, entities, zones = []) {
    const trends = [], events = [];
    const present = new Set(entities.map(entity => entity.id));
    for (const id of histories.keys()) if (!present.has(id)) histories.delete(id);
    for (const entity of entities) {
      const history = histories.get(entity.id) || [];
      history.push({time, position: {...entity.position}});
      while (history.length > 2 && time - history[1].time >= TREND_WINDOW) history.shift();
      histories.set(entity.id, history);
    }
    const referents = entities.concat(zones.map(zone => ({...zone, isZone: true})));
    for (const mover of entities) {
      const history = histories.get(mover.id), first = history[0];
      const elapsed = time - first.time;
      for (const zone of zones) {
        const key = `${mover.id}|${zone.id}`, now = distance(mover.position, zone.position) <= zone.radius;
        if (inside.has(key) && inside.get(key) !== now)
          events.push({kind: now ? 'into' : 'out', mover: mover.id, referent: zone.id, referentName: zone.name, position: {...mover.position}, time});
        inside.set(key, now);
      }
      if (distance(mover.position, first.position) < MIN_DISPLACEMENT) continue;
      for (const referent of referents) {
        if (referent.id === mover.id) continue;
        const separation = distance(mover.position, referent.position);
        const key = `${mover.id}|${referent.id}`;
        if (elapsed >= MIN_TREND_TIME) {
          const earlier = histories.get(referent.id)?.[0].position || referent.position;
          const rate = (separation - distance(first.position, earlier)) / (elapsed / 1000);
          if (Math.abs(rate) >= MIN_RATE) trends.push({
            kind: rate < 0 ? 'toward' : 'away', mover: mover.id, referent: referent.id,
            referentName: referent.name || referent.id, target: {...referent.position}, distance: separation, rate
          });
        }
        if (referent.isZone) continue;
        if (separation > PAST_TRACK_RADIUS) { passes.delete(key); continue; }
        const relative = {x: mover.position.x - referent.position.x, z: mover.position.z - referent.position.z};
        let pass = passes.get(key);
        if (!pass) { pass = {entry: relative, closest: separation, closestPosition: {...mover.position}, done: false}; passes.set(key, pass); }
        if (separation < pass.closest) { pass.closest = separation; pass.closestPosition = {...mover.position}; }
        // A pass needs the mover on the far side of the referent, so turning back does not count.
        const crossed = pass.entry.x * relative.x + pass.entry.z * relative.z <= 0;
        if (!pass.done && crossed && pass.closest <= PAST_RADIUS && separation >= pass.closest + PAST_CLEARANCE) {
          pass.done = true;
          events.push({kind: 'past', mover: mover.id, referent: referent.id, referentName: referent.id, position: pass.closestPosition, closest: pass.closest, time});
        }
      }
    }
    return {trends, events};
  }

  return {sample, clear};
}

// The nearest trend per mover is the one worth drawing.
export function primaryTrends(trends) {
  const nearest = new Map();
  for (const trend of trends) {
    const current = nearest.get(trend.mover);
    if (!current || trend.distance < current.distance) nearest.set(trend.mover, trend);
  }
  return [...nearest.values()];
}
