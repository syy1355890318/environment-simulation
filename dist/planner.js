// Route planning over an agent's own memory. Nothing here can see the true city.
import {W, H, FREE, OBSTACLE, HINDRANCE, indexOf, centerOf, passable, distance} from './nav.js';

const DIAGONAL = Math.SQRT2;
const MOVES = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, DIAGONAL], [1, -1, DIAGONAL], [-1, 1, DIAGONAL], [-1, -1, DIAGONAL]];

function createHeap() {
  const keys = [], values = [];
  return {
    get size() { return keys.length; },
    push(key, value) {
      let i = keys.length;
      keys.push(key); values.push(value);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (keys[parent] <= key) break;
        keys[i] = keys[parent]; values[i] = values[parent];
        i = parent;
      }
      keys[i] = key; values[i] = value;
    },
    pop() {
      const top = values[0], key = keys.pop(), value = values.pop(), size = keys.length;
      if (size) {
        let i = 0;
        for (;;) {
          let child = 2 * i + 1;
          if (child >= size) break;
          if (child + 1 < size && keys[child + 1] < keys[child]) child++;
          if (keys[child] >= key) break;
          keys[i] = keys[child]; values[i] = values[child];
          i = child;
        }
        keys[i] = key; values[i] = value;
      }
      return top;
    }
  };
}

// Cheapest-first search through known, passable cells. `visit` may stop it by returning true.
function search(cells, start, {hindranceCost = 2, blocked = null, heuristic = null}, visit) {
  const cost = new Float32Array(W * H).fill(Infinity), parent = new Int32Array(W * H).fill(-1), done = new Uint8Array(W * H);
  const heap = createHeap();
  const open = index => passable(cells[index]) && !(blocked && blocked.has(index));
  cost[start] = 0;
  heap.push(0, start);
  while (heap.size) {
    const index = heap.pop();
    if (done[index]) continue;
    done[index] = 1;
    if (visit(index, cost[index])) return {cost, parent, reached: index};
    const i = index % W, j = (index - i) / W;
    for (const [di, dj, length] of MOVES) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const next = nj * W + ni;
      if (done[next] || !open(next)) continue;
      // No squeezing diagonally past a corner.
      if (di && dj && (!open(index + di) || !open(index + dj * W))) continue;
      const total = cost[index] + length * (cells[next] === HINDRANCE ? hindranceCost : 1);
      if (total >= cost[next]) continue;
      cost[next] = total;
      parent[next] = index;
      heap.push(total + (heuristic ? heuristic(next) : 0), next);
    }
  }
  return {cost, parent, reached: -1};
}

function trace(parent, end) {
  const route = [];
  for (let index = end; index >= 0; index = parent[index]) route.push(index);
  return route.reverse();
}

export function findPath(cells, start, goal, options = {}) {
  if (start < 0 || goal < 0 || !passable(cells[goal])) return null;
  const target = centerOf(goal);
  const result = search(cells, start, {...options, heuristic: index => distance(centerOf(index), target)}, index => index === goal);
  return result.reached < 0 ? null : trace(result.parent, goal);
}

// A frontier is a known, passable cell next to ground not yet looked at.
export function isFrontier(cells, swept, index) {
  if (!passable(cells[index])) return false;
  const i = index % W;
  for (const next of [i > 0 ? index - 1 : -1, i < W - 1 ? index + 1 : -1, index - W, index + W]) {
    if (next >= 0 && next < cells.length && !swept[next] && cells[next] !== OBSTACLE) return true;
  }
  return false;
}

// The nearest frontier, or with `toward` the one that best leads to that point.
export function findFrontier(cells, swept, start, options = {}) {
  if (start < 0) return null;
  let best = -1, bestScore = Infinity;
  const result = search(cells, start, options, (index, cost) => {
    if (!isFrontier(cells, swept, index)) return false;
    if (!options.toward) { best = index; return true; }
    const score = cost + 1.5 * distance(centerOf(index), options.toward);
    if (score < bestScore) { bestScore = score; best = index; }
    return false;
  });
  return best < 0 ? null : trace(result.parent, best);
}

// A straight walk is clear when the remembered ground along it, at body width, is free.
export function clearLine(cells, a, b, allowHindrance = false) {
  const length = distance(a, b), steps = Math.max(1, Math.ceil(length / 0.3));
  const px = length ? -(b.z - a.z) / length * 0.35 : 0, pz = length ? (b.x - a.x) / length * 0.35 : 0;
  for (let step = 0; step <= steps; step++) {
    const x = a.x + (b.x - a.x) * step / steps, z = a.z + (b.z - a.z) * step / steps;
    for (const side of [-1, 0, 1]) {
      const index = indexOf(x + px * side, z + pz * side);
      if (index < 0) return false;
      const type = cells[index];
      if (type !== FREE && !(allowHindrance && type === HINDRANCE)) return false;
    }
  }
  return true;
}

// Turn a cell-by-cell route into a few straight legs.
export function smoothPath(cells, route) {
  const points = route.map(centerOf);
  if (points.length < 3) return points;
  const result = [points[0]];
  let anchor = 0;
  for (let i = 2; i < points.length; i++) {
    const slow = cells[route[anchor]] === HINDRANCE || cells[route[i]] === HINDRANCE;
    if (clearLine(cells, points[anchor], points[i], slow)) continue;
    result.push(points[i - 1]);
    anchor = i - 1;
  }
  result.push(points.at(-1));
  return result;
}

export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}
