// The occupiable grid: 2 m cells whose centers sit on even coordinates, matching
// the visible ground grid and every route node. Relations are judged per cell.
export const CELL = 2;
export const BOUNDS = {x: 23, z: 19};
const WALL_MARGIN = 0.4;

export const BUILDINGS = [
  {x: -14, z: 0, w: 5, d: 5, h: 4.3, style: 'A'}, {x: -13, z: -9, w: 6, d: 6, h: 6.5, style: 'B'},
  {x: -20, z: -4, w: 4, d: 5, h: 3.7, style: 'A'}, {x: -18, z: 15, w: 5, d: 4, h: 3.8, style: 'C'},
  {x: 3, z: 2, w: 6, d: 6, h: 5.6, style: 'A'}, {x: 5, z: 12, w: 6, d: 5, h: 3.2, style: 'B'},
  {x: 16, z: 8, w: 5, d: 7, h: 5.6, style: 'A'}, {x: 17, z: -1, w: 4.5, d: 4.5, h: 4.2, style: 'C'},
  {x: 3, z: -13, w: 6, d: 5, h: 4.5, style: 'B'}, {x: 16, z: -13, w: 4, d: 5, h: 3.5, style: 'A'},
  {x: -6, z: -15, w: 4, d: 4, h: 3.2, style: 'C'}
];

export const toCell = p => ({col: Math.round(p.x / CELL) + 0, row: Math.round(p.z / CELL) + 0});
export const cellCenter = cell => ({x: cell.col * CELL + 0, z: cell.row * CELL + 0});
export const snapToCell = p => cellCenter(toCell(p));
export const sameCell = (a, b) => a.col === b.col && a.row === b.row;
export const cellKey = cell => `${cell.col},${cell.row}`;

export function isOccupiable(cell) {
  const {x, z} = cellCenter(cell);
  if (Math.abs(x) > BOUNDS.x || Math.abs(z) > BOUNDS.z) return false;
  return !BUILDINGS.some(b => Math.abs(x - b.x) <= b.w / 2 + WALL_MARGIN && Math.abs(z - b.z) <= b.d / 2 + WALL_MARGIN);
}

// Cells a straight line crosses strictly between two cells. Endpoints are ordered
// first so the answer does not depend on which object is named first.
export function cellsBetween(a, b) {
  const flip = a.col > b.col || (a.col === b.col && a.row > b.row);
  const [from, to] = flip ? [b, a] : [a, b];
  const steps = Math.max(to.col - from.col, Math.abs(to.row - from.row));
  const cells = [];
  for (let i = 1; i < steps; i++) cells.push({
    col: Math.round(from.col + (to.col - from.col) * i / steps) + 0,
    row: Math.round(from.row + (to.row - from.row) * i / steps) + 0
  });
  return cells;
}

export function distanceToSegment(p, start, end) {
  const dx = end.x - start.x, dz = end.z - start.z, squared = dx * dx + dz * dz;
  const t = squared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - start.x) * dx + (p.z - start.z) * dz) / squared));
  return Math.hypot(p.x - start.x - t * dx, p.z - start.z - t * dz);
}

export function advanceWalk(occupant, milliseconds) {
  const walk = occupant.walk;
  if (!walk) return;
  let remaining = walk.speed * milliseconds / 1000;
  while (remaining > 0) {
    const target = walk.path[walk.target];
    const gap = Math.hypot(target.x - occupant.position.x, target.z - occupant.position.z);
    if (gap > remaining) {
      occupant.position = {
        x: occupant.position.x + (target.x - occupant.position.x) * remaining / gap,
        z: occupant.position.z + (target.z - occupant.position.z) * remaining / gap
      };
      return;
    }
    occupant.position = {x: target.x, z: target.z};
    remaining -= gap;
    if (walk.target === walk.path.length - 1) walk.direction = -1;
    else if (walk.target === 0) walk.direction = 1;
    walk.target += walk.direction;
  }
}
