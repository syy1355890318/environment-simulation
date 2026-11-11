// The city plan. Blocks are laid out on a column-by-row grid and streets are the gaps
// between them. Meters on the ground plane; +x is east and +z is south.
export const SIZE = {x: 48, z: 36};
// Buildings stand this far inside their block, leaving a sidewalk.
export const SIDEWALK = 0.5;

const COLUMNS = [[-46, -33], [-27, -17], [-15, -5], [1, 7], [13, 25], [31, 46]];
const ROWS = [[-34, -25], [-19, -7], [-1, 5], [11, 21], [27, 34]];
const block = (x0, x1, z0, z1, kind = 'building') => ({x0, x1, z0, z1, kind});

function layOut() {
  const blocks = [];
  COLUMNS.forEach(([x0, x1], column) => ROWS.forEach(([z0, z1], row) => {
    const key = `${column},${row}`;
    if (key === '4,2') blocks.push(block(x0, x1, z0, z1, 'plaza'));
    else if (key === '1,3') blocks.push(block(x0, x1, z0, z1, 'park'));
    else if (row === 1 && column <= 2) blocks.push(block(x0, x1, z0, -13), block(x0, x1, -11, z1)); // Mill Lane
    else if (key === '5,1') blocks.push(block(x0, 37, z0, z1), block(39, x1, z0, z1)); // Tanner Alley
    else if (key === '5,3') blocks.push(block(x0, x1, z0, 15), block(x0, x1, 17, z1)); // Baker Yard
    else if (key === '1,4') blocks.push(block(x0, COLUMNS[2][1], z0, z1)); // closes Lantern Alley at South Row
    else if (key !== '2,4') blocks.push(block(x0, x1, z0, z1));
  }));
  return blocks;
}

export const BLOCKS = layOut();

export const BUILDINGS = BLOCKS.filter(item => item.kind === 'building').map(item => ({
  x: (item.x0 + item.x1) / 2, z: (item.z0 + item.z1) / 2,
  w: item.x1 - item.x0 - 2 * SIDEWALK, d: item.z1 - item.z0 - 2 * SIDEWALK
}));

const way = (name, x0, z0, x1, z1, width) => ({
  id: name.toLowerCase().replace(/\s+/g, '-'), name, width, start: {x: x0, z: z0}, end: {x: x1, z: z1}
});

export const STREETS = [
  way('North Row', -44, -22, 44, -22, 6), way('Canal Walk', -44, -4, 44, -4, 6),
  way('Market Street', -44, 8, 44, 8, 6), way('South Row', -44, 24, 44, 24, 6),
  way('Orchard Street', -30, -32, -30, 32, 6), way('Garden Passage', -2, -32, -2, 32, 6),
  way('Willow Lane', 10, -32, 10, 32, 6), way('Harbor Street', 28, -32, 28, 32, 6),
  way('Lantern Alley', -16, -32, -16, 24, 2), way('Mill Lane', -44, -12, -2, -12, 2),
  way('Tanner Alley', 38, -22, 38, -4, 2), way('Baker Yard', 28, 16, 44, 16, 2)
];

const place = (name, kind, x, z) => ({id: name.toLowerCase().replace(/\s+/g, '-'), name, kind, position: {x, z}});

export const PLACES = [
  place('Clock Tower', 'exhibit', -40, -22), place('Lighthouse', 'exhibit', 28, -30),
  place('Mural', 'exhibit', 40, 8), place('Greenhouse', 'exhibit', -30, 30), place('Fountain', 'exhibit', 24, 4),
  place('Charger A', 'charger', -40, -12), place('Charger B', 'charger', 40, 16),
  place('Plaza', 'plaza', 18, 2), place('Park', 'park', -22, 16)
];
