// The look of the town: a harbor town holding an open-air art walk. Purely visual; what can be
// walked on is decided by city.js. Ink lines on white, with a little blue.
import * as THREE from './vendor/three.module.js';
import {SIZE, SIDEWALK, BLOCKS, PLACES, HINDRANCES} from './city.js';
import {indexOf} from './nav.js';

const INK = 0x141414, BLUE = 0x1f33c4, INK_CSS = '#141414', BLUE_CSS = '#1f33c4', PAPER_CSS = '#ffffff';
const BAY = 3, CURB = .14;
// Lots that hold something special, found by a point inside them.
const SPECIAL_LOTS = {clock: {x: -40, z: -29}, greenhouse: {x: -37, z: 30}, depot: {x: 15, z: 30}, mural: {x: 40, z: 2}};

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function canvasTexture(width, height, draw, repeat = true) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const c = canvas.getContext('2d');
  c.lineCap = c.lineJoin = 'round';
  draw(c, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
const paper = (c, w, h, color = PAPER_CSS) => { c.fillStyle = color; c.fillRect(0, 0, w, h); };
const pen = (c, color = INK_CSS, width = 4) => { c.strokeStyle = color; c.lineWidth = width; };

// One bay of one floor.
const FACADES = {
  house: (c, s) => {
    paper(c, s, s); pen(c);
    c.strokeRect(s * .3, s * .22, s * .4, s * .46);
    c.beginPath(); c.moveTo(s * .5, s * .22); c.lineTo(s * .5, s * .68); c.moveTo(s * .3, s * .45); c.lineTo(s * .7, s * .45);
    c.moveTo(s * .25, s * .72); c.lineTo(s * .75, s * .72); c.stroke();
    pen(c, INK_CSS, 2); c.beginPath(); c.moveTo(0, s - 2); c.lineTo(s, s - 2); c.stroke();
  },
  shop: (c, s) => {
    paper(c, s, s); pen(c);
    for (const x of [.16, .58]) {
      c.strokeRect(s * x, s * .16, s * .26, s * .6);
      c.beginPath(); c.moveTo(s * (x + .13), s * .16); c.lineTo(s * (x + .13), s * .76); c.stroke();
    }
    pen(c, INK_CSS, 2); c.beginPath(); c.moveTo(0, s - 2); c.lineTo(s, s - 2); c.moveTo(0, s * .08); c.lineTo(s, s * .08); c.stroke();
  },
  warehouse: (c, s) => {
    paper(c, s, s); pen(c, INK_CSS, 2);
    for (let y = s / 8; y < s; y += s / 8) { c.beginPath(); c.moveTo(0, y); c.lineTo(s, y); c.stroke(); }
    paper(c, 0, 0); c.fillStyle = PAPER_CSS; c.fillRect(s * .34, s * .2, s * .32, s * .26);
    pen(c); c.strokeRect(s * .34, s * .2, s * .32, s * .26);
  },
  plain: (c, s) => { paper(c, s, s); pen(c, INK_CSS, 2); c.beginPath(); c.moveTo(0, s - 2); c.lineTo(s, s - 2); c.stroke(); }
};
// Roof patterns, each drawn in a foreground color on a background color.
const ROOFS = {
  scales: (c, s, fg) => {
    pen(c, fg, 4);
    const r = s / 8;
    for (let row = 0; row <= 8; row++) for (let i = -1; i <= 4; i++) {
      c.beginPath(); c.arc(i * 2 * r + (row % 2 ? r : 0) + r, row * r, r, 0, Math.PI); c.stroke();
    }
  },
  tiles: (c, s, fg) => {
    pen(c, fg, 4);
    for (let row = 0; row < 6; row++) {
      const y = row * s / 6;
      c.beginPath(); c.moveTo(0, y); c.lineTo(s, y); c.stroke();
      for (let i = 0; i < 4; i++) { const x = (i + (row % 2 ? .5 : 0)) * s / 4; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + s / 6); c.stroke(); }
    }
  },
  triangles: (c, s, fg) => {
    pen(c, fg, 4);
    const step = s / 4;
    for (let row = 0; row < 4; row++) for (let i = -1; i < 5; i++) {
      const x = i * step + (row % 2 ? step / 2 : 0), y = row * step;
      c.beginPath(); c.moveTo(x, y + step); c.lineTo(x + step / 2, y); c.lineTo(x + step, y + step); c.closePath(); c.stroke();
      if ((i + row) % 2 === 0) { c.fillStyle = fg; c.fill(); }
    }
  },
  hatch: (c, s, fg) => {
    pen(c, fg, 4);
    for (let i = -s; i < s * 2; i += s / 6) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + s, s); c.stroke(); }
  }
};

// A hip roof with its ridge along x; with no inset it is a gable. Slopes are group 0, ends group 1.
function roofGeometry(w, d, rise, inset, tile = 2) {
  const A = [-w / 2, 0, -d / 2], B = [w / 2, 0, -d / 2], C = [w / 2, 0, d / 2], D = [-w / 2, 0, d / 2];
  const R1 = [-w / 2 + inset, rise, 0], R2 = [w / 2 - inset, rise, 0], slope = Math.hypot(d / 2, rise);
  const triangles = [[A, R1, R2], [A, R2, B], [C, R2, R1], [C, R1, D], [D, R1, A], [B, R2, C]];
  const positions = [], uvs = [];
  triangles.forEach((triangle, n) => {
    for (const [x, y, z] of triangle) {
      positions.push(x, y, z);
      uvs.push((n < 4 ? x : z) / tile, y / rise * slope / tile);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.addGroup(0, 12, 0);
  geometry.addGroup(12, 6, 1);
  geometry.computeVertexNormals();
  return geometry;
}
// One tooth of a sawtooth roof: a slope (group 0), a glazed upright (group 1), and two ends (group 2).
function toothGeometry(length, width, rise, tile = 2) {
  const x0 = -length / 2, x1 = length / 2, z0 = -width / 2, z1 = width / 2;
  const quads = [[[x0, rise, z0], [x0, rise, z1], [x1, 0, z1], [x1, 0, z0]], [[x0, 0, z0], [x0, 0, z1], [x0, rise, z1], [x0, rise, z0]]];
  const positions = [], uvs = [];
  for (const [a, b, c, d] of quads) for (const [x, y, z] of [a, b, c, a, c, d]) { positions.push(x, y, z); uvs.push(z / tile, (x1 - x + y) / tile); }
  for (const z of [z0, z1]) for (const [x, y] of [[x0, 0], [x0, rise], [x1, 0]]) { positions.push(x, y, z); uvs.push(x / tile, y / tile); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.addGroup(0, 6, 0); geometry.addGroup(6, 6, 1); geometry.addGroup(12, 6, 2);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildTown(scene) {
  const random = mulberry(11);
  const pick = list => list[Math.floor(random() * list.length)];
  const standard = options => new THREE.MeshStandardMaterial({roughness: .85, ...options});
  const edge = new THREE.LineBasicMaterial({color: INK, transparent: true, opacity: .6});
  const cutEdge = new THREE.LineBasicMaterial({color: INK, transparent: true, opacity: .45});
  const outline = mesh => { mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 20), edge)); return mesh; };
  function add(parent, geometry, material, x, y, z, shadow = true) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  const box = (parent, w, h, d, material, x, y, z, shadow) => add(parent, new THREE.BoxGeometry(w, h, d), material, x, y, z, shadow);

  const white = standard({color: 0xffffff}), ink = standard({color: INK}), blue = standard({color: BLUE}), pale = standard({color: 0xededed});
  const facade = Object.fromEntries(Object.entries(FACADES).map(([name, draw]) => [name, standard({map: canvasTexture(256, 256, c => draw(c, 256))})]));
  const roofMaterial = (name, isBlue) => standard({side: THREE.DoubleSide, map: canvasTexture(256, 256, c => {
    paper(c, 256, 256, isBlue ? BLUE_CSS : PAPER_CSS);
    ROOFS[name](c, 256, isBlue ? PAPER_CSS : INK_CSS);
  })});
  const roofs = Object.keys(ROOFS).map(name => roofMaterial(name, false)), blueRoofs = ['scales', 'triangles'].map(name => roofMaterial(name, true));
  const flatRoof = standard({color: 0xf2f2f2});
  const glass = standard({side: THREE.DoubleSide, transparent: true, opacity: .6, map: canvasTexture(128, 128, (c, s) => {
    paper(c, s, s, '#f6f8ff'); pen(c, INK_CSS, 5); c.strokeRect(0, 0, s, s);
  })});
  const leaf = {
    veins: standard({map: canvasTexture(256, 256, (c, s) => {
      paper(c, s, s); pen(c, INK_CSS, 3);
      for (let i = -6; i <= 6; i++) { c.beginPath(); c.moveTo(s / 2, s); c.quadraticCurveTo(s / 2 + i * 6, s / 2, s / 2 + i * 22, 0); c.stroke(); }
    }, false)}),
    dots: standard({map: canvasTexture(256, 256, (c, s) => {
      paper(c, s, s); pen(c, INK_CSS, 3);
      for (let y = 10; y < s; y += 22) for (let x = (y / 22 % 2) * 11 + 6; x < s; x += 22) { c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.stroke(); }
    })})
  };

  // --- Ground, sea, and pier ---
  const sea = standard({roughness: 1, map: canvasTexture(256, 256, (c, s) => {
    paper(c, s, s, '#f7f7f8'); pen(c, 'rgba(31, 51, 196, .55)', 2);
    for (let row = 0; row < 2; row++) for (let i = 0; i < 1; i++) {
      const x = (row % 2 ? s / 2 : 0) + 30, y = row * s / 2 + 60;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 18, y - 14, x + 36, y); c.quadraticCurveTo(x + 54, y + 14, x + 72, y); c.stroke();
    }
  })});
  const REACH = 44;
  for (const [w, d, x, z] of [[SIZE.x * 2 + REACH * 2, REACH, 0, -SIZE.z - REACH / 2], [REACH, SIZE.z * 2 + REACH, SIZE.x + REACH / 2, REACH / 2]]) {
    const water = add(scene, new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), sea, x, -.9, z, false);
    const uv = water.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 12, uv.getY(i) * d / 12);
  }
  const pierZ = -SIZE.z - 7;
  outline(box(scene, 6, 1, 14, white, 28, -.5, pierZ));
  for (const z of [-3, 3]) for (const x of [-2.6, 2.6]) add(scene, new THREE.CylinderGeometry(.18, .18, .6, 8), ink, 28 + x, .3, pierZ - 3 + z * 1.2);
  function boat(x, z, turn) {
    const group = new THREE.Group();
    group.position.set(x, -.75, z);
    group.rotation.y = turn;
    outline(box(group, 3.2, .7, 1.2, white, 0, .2, 0));
    add(group, new THREE.CylinderGeometry(.05, .05, 3, 6), ink, 0, 1.9, 0);
    const sail = new THREE.BufferGeometry();
    sail.setAttribute('position', new THREE.Float32BufferAttribute([.1, .7, 0, 1.5, .7, 0, .1, 3.2, 0], 3));
    sail.computeVertexNormals();
    add(group, sail, standard({color: BLUE, side: THREE.DoubleSide}), 0, 0, 0);
    scene.add(group);
  }
  boat(36, -SIZE.z - 9, .4); boat(12, -SIZE.z - 14, -.3); boat(SIZE.x + 10, -8, 1.2);

  const buildings = [];
  const cellsIn = rect => {
    const cells = [];
    for (let x = rect.x0 + .5; x < rect.x1; x++) for (let z = rect.z0 + .5; z < rect.z1; z++) { const index = indexOf(x, z); if (index >= 0) cells.push(index); }
    return cells;
  };
  // A unit the agents' knowledge view can show or hide, and the cutaway can reduce to its outline.
  function unit(lot, inner, wallHeight) {
    const w = inner.x1 - inner.x0, d = inner.z1 - inner.z0, alongX = w >= d;
    const outer = new THREE.Group(), solid = new THREE.Group();
    outer.position.set((inner.x0 + inner.x1) / 2, 0, (inner.z0 + inner.z1) / 2);
    outer.rotation.y = alongX ? 0 : Math.PI / 2;
    const L = alongX ? w : d, S = alongX ? d : w;
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L, wallHeight, S)), cutEdge);
    lines.position.y = CURB + wallHeight / 2;
    lines.visible = false;
    outer.add(solid, lines);
    solid.userData.building = buildings.length;
    scene.add(outer);
    buildings.push({mesh: outer, solid, lines, cells: cellsIn(lot)});
    return {solid, L, S, alongX};
  }
  function walls(parent, w, h, d, material, floors, y = CURB) {
    const geometry = new THREE.BoxGeometry(w, h, d), uv = geometry.attributes.uv;
    for (let i = 0; i < 24; i++) {
      const face = Math.floor(i / 4);
      if (face === 2 || face === 3) continue;
      uv.setXY(i, uv.getX(i) * Math.max(1, Math.round((face < 2 ? d : w) / BAY)), uv.getY(i) * floors);
    }
    return outline(add(parent, geometry, [material, material, flatRoof, flatRoof, material, material], 0, y + h / 2, 0));
  }

  function tree(parent, x, z, kind, scale = 1) {
    const height = (1.6 + (kind % 3) * .5) * scale;
    add(parent, new THREE.CylinderGeometry(.07, .1, height, 6), ink, x, height / 2, z);
    const crown = add(parent, new THREE.IcosahedronGeometry(1, 2), [leaf.dots, leaf.veins, blue, pale][kind % 4], x, height + .6 * scale, z);
    crown.scale.set(...[[1, 1, 1], [1.1, 1.3, .4], [.8, .8, .8], [.6, 1.7, .6]][kind % 4].map(value => value * scale));
    crown.rotation.y = (x * 7 + z * 3) % 3;
    return crown;
  }

  const DISTRICTS = {
    homes: () => ({floors: pick([1, 1, 2, 2]), floorHeight: 3, facade: facade.house, roof: pick(['gable', 'gable', 'gable', 'hip']), chimney: true}),
    market: () => ({floors: pick([2, 2, 3, 3, 3, 4]), floorHeight: 3, facade: facade.shop, roof: pick(['flat', 'flat', 'flat', 'hip', 'hip']), awning: true}),
    harbor: () => ({floors: pick([1, 1, 2]), floorHeight: 4, facade: facade.warehouse, roof: pick(['sawtooth', 'sawtooth', 'gable', 'flat'])}),
    works: () => ({floors: pick([1, 1, 2]), floorHeight: 3.5, facade: pick([facade.warehouse, facade.plain]), roof: pick(['flat', 'flat', 'sawtooth'])})
  };
  function districtOf(block) {
    const x = (block.x0 + block.x1) / 2, z = (block.z0 + block.z1) / 2;
    return z < -13 ? 'harbor' : z > 21 ? 'works' : x < -17 ? 'homes' : 'market';
  }

  function building(lot, inner, style, frontage) {
    const h = style.floors * style.floorHeight;
    const {solid, L, S, alongX} = unit(lot, inner, h);
    walls(solid, L, h, S, style.facade, style.floors);
    const top = CURB + h, tiles = random() < .14 ? pick(blueRoofs) : pick(roofs);
    if (style.roof === 'gable' || style.roof === 'hip') {
      const rise = Math.max(1.2, Math.min(2.8, S * .3)), hip = style.roof === 'hip';
      outline(add(solid, roofGeometry(L + .6, S + .6, rise, hip ? Math.min(L / 2 - .2, S / 2) : 0), [tiles, hip ? tiles : white], 0, top, 0));
      if (style.chimney) outline(box(solid, .5, rise * .9, .5, white, L * .22, top + rise * .6, S * .14));
    } else if (style.roof === 'sawtooth') {
      const teeth = Math.max(2, Math.round(L / 4)), length = L / teeth;
      for (let i = 0; i < teeth; i++) outline(add(solid, toothGeometry(length, S, 1.4), [tiles, glass, white], -L / 2 + length * (i + .5), top, 0));
    } else {
      if (random() < .6) outline(box(solid, 1.6, 1, 1.6, white, (random() - .5) * (L - 2.4), top + .5, (random() - .5) * (S - 2.4)));
      if (style.floors >= 3 && random() < .6) {
        const x = (random() - .5) * (L - 2), z = (random() - .5) * (S - 2);
        add(solid, new THREE.CylinderGeometry(.7, .7, 1.1, 14), random() < .3 ? blue : white, x, top + 1.25, z);
        box(solid, 1, .7, 1, ink, x, top + .35, z);
      }
    }
    if (style.awning) {
      // Awnings hang over the faces that look onto a street. Local +z is the lot's long face.
      for (const side of [-1, 1]) {
        if (!(alongX ? (side > 0 ? frontage.south : frontage.north) : (side > 0 ? frontage.east : frontage.west))) continue;
        const awning = outline(box(solid, L - .8, .08, 1, random() < .3 ? blue : white, 0, CURB + 2.7, side * (S / 2 + .42)));
        awning.rotation.x = side * .3;
      }
    }
  }
  function garden(lot, inner) {
    const {solid, L, S} = unit(lot, inner, .9);
    box(solid, L, .04, S, standard({color: 0xededed}), 0, CURB + .02, 0, false);
    for (let i = 0; i < 2; i++) tree(solid, (random() - .5) * (L - 2), (random() - .5) * (S - 2), Math.floor(random() * 4), 1.1);
    solid.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L, .9, S)), edge)).position.y = CURB + .45;
  }

  // --- Special lots ---
  const clockFace = standard({map: canvasTexture(256, 256, (c, s) => {
    paper(c, s, s); pen(c, INK_CSS, 8);
    c.beginPath(); c.arc(s / 2, s / 2, s * .42, 0, Math.PI * 2); c.stroke();
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      c.beginPath(); c.moveTo(s / 2 + Math.cos(a) * s * .34, s / 2 + Math.sin(a) * s * .34); c.lineTo(s / 2 + Math.cos(a) * s * .4, s / 2 + Math.sin(a) * s * .4); c.stroke();
    }
    pen(c, BLUE_CSS, 10);
    c.beginPath(); c.moveTo(s / 2, s / 2); c.lineTo(s / 2, s * .2); c.moveTo(s / 2, s / 2); c.lineTo(s * .68, s * .56); c.stroke();
  }, false)});
  function clockTower(lot, inner) {
    const w = inner.x1 - inner.x0, d = inner.z1 - inner.z0, shaft = 3.2, height = 15;
    const {solid, L, S, alongX} = unit(lot, inner, 4);
    // A low hall, with the tower rising from the street end.
    walls(solid, L, 4, S, facade.house, 1);
    outline(add(solid, roofGeometry(L + .6, S + .6, 1.6, 0), [pick(roofs), white], 0, CURB + 4, 0));
    const tower = new THREE.Group();
    const offset = (alongX ? d : w) / 2 - shaft / 2 - .2;
    tower.position.set(alongX ? 0 : offset, 0, alongX ? offset : 0);
    walls(tower, shaft, height, shaft, facade.plain, 5);
    for (let side = 0; side < 4; side++) {
      const face = add(tower, new THREE.PlaneGeometry(2.4, 2.4), clockFace, 0, CURB + height - 2, 0, false);
      face.rotation.y = side * Math.PI / 2;
      face.translateZ(shaft / 2 + .03);
    }
    const cap = outline(add(tower, new THREE.ConeGeometry(shaft * .82, 3.4, 4), blue, 0, CURB + height + 1.7, 0));
    cap.rotation.y = Math.PI / 4;
    add(tower, new THREE.SphereGeometry(.22, 10, 8), ink, 0, CURB + height + 3.6, 0);
    solid.add(tower);
  }
  function greenhouse(lot, inner) {
    const {solid, L, S} = unit(lot, inner, 3);
    const geometry = new THREE.BoxGeometry(L, 3, S), uv = geometry.attributes.uv;
    for (let i = 0; i < 24; i++) { const face = Math.floor(i / 4); uv.setXY(i, uv.getX(i) * Math.round((face < 2 ? S : L) / 1.2), uv.getY(i) * 2); }
    outline(add(solid, geometry, glass, 0, CURB + 1.5, 0, false));
    outline(add(solid, roofGeometry(L, S, 1.5, 0, 1.2), [glass, glass], 0, CURB + 3, 0, false));
    for (let i = 0; i < 6; i++) {
      const x = (i % 3 - 1) * L * .28, z = (i < 3 ? -1 : 1) * S * .2, size = .5 + (i % 2) * .25;
      add(solid, new THREE.IcosahedronGeometry(size, 1), i % 3 === 1 ? blue : leaf.dots, x, CURB + .9 + size * .4, z, false);
      box(solid, .5, .5, .5, ink, x, CURB + .25, z, false);
    }
  }
  function depot(lot, inner) {
    const w = inner.x1 - inner.x0, d = inner.z1 - inner.z0;
    const {solid, L, S, alongX} = unit(lot, inner, 5);
    walls(solid, L, 5, S, facade.warehouse, 1);
    outline(box(solid, L + .3, .3, S + .3, white, 0, CURB + 5.15, 0));
    // The loading door and parcels face Willow Lane, to the west.
    const front = new THREE.Group();
    front.position.set(alongX ? -w / 2 : 0, 0, alongX ? 0 : 0);
    front.rotation.y = alongX ? 0 : -Math.PI / 2;
    box(front, .08, 3.2, Math.min(4, d - 1.5), ink, -.05, CURB + 1.6, 0, false);
    outline(box(front, .9, .08, Math.min(5, d - 1), blue, -.55, CURB + 3.5, 0)).rotation.z = .25;
    const parcels = [[-.7, .35, -1.6, white], [-.7, .35, -.8, white], [-.7, 1.05, -1.2, blue], [-.8, .3, 1.5, white], [-1.5, .3, 1.3, white]];
    for (const [x, y, z, material] of parcels) outline(box(front, .7, .6, .7, material, x, y, z));
    solid.add(front);
  }

  // --- Blocks into lots ---
  let muralWall = null;
  for (const block of BLOCKS) {
    const w = block.x1 - block.x0, d = block.z1 - block.z0, x = (block.x0 + block.x1) / 2, z = (block.z0 + block.z1) / 2;
    if (block.kind === 'park') {
      box(scene, w, .02, d, standard({color: 0xededed}), x, .005, z, false);
      for (let tx = block.x0 + 1; tx < block.x1; tx += 2) for (let tz = block.z0 + 1; tz < block.z1; tz += 2) {
        if ((tx * 7 + tz * 13) % 3 !== 0) tree(scene, tx, tz, Math.abs(tx * 3 + tz * 5) % 4, 1 + Math.abs(tx + tz) % 3 * .12).castShadow = true;
      }
      continue;
    }
    if (block.kind === 'plaza') { box(scene, w, .02, d, standard({color: 0xf6f6f6}), x, .005, z, false); continue; }
    box(scene, w, CURB, d, standard({color: 0xf5f5f5}), x, CURB / 2, z, false);
    const alongX = w >= d, long = alongX ? w : d, short = alongX ? d : w, rows = short >= 11 ? 2 : 1;
    const cuts = [0];
    while (long - cuts.at(-1) >= 12) cuts.push(cuts.at(-1) + 5 + Math.round(random() * 4) / 2);
    if (long - cuts.at(-1) > 9) cuts.push((cuts.at(-1) + long) / 2);
    cuts.push(long);
    const district = districtOf(block);
    for (let row = 0; row < rows; row++) for (let i = 0; i < cuts.length - 1; i++) {
      const a0 = cuts[i], a1 = cuts[i + 1], b0 = short * row / rows, b1 = short * (row + 1) / rows;
      const lot = alongX ? {x0: block.x0 + a0, x1: block.x0 + a1, z0: block.z0 + b0, z1: block.z0 + b1}
        : {x0: block.x0 + b0, x1: block.x0 + b1, z0: block.z0 + a0, z1: block.z0 + a1};
      const frontage = {west: lot.x0 === block.x0, east: lot.x1 === block.x1, north: lot.z0 === block.z0, south: lot.z1 === block.z1};
      const inner = {x0: lot.x0 + (frontage.west ? SIDEWALK : 0), x1: lot.x1 - (frontage.east ? SIDEWALK : 0),
        z0: lot.z0 + (frontage.north ? SIDEWALK : 0), z1: lot.z1 - (frontage.south ? SIDEWALK : 0)};
      const holds = point => point.x >= lot.x0 && point.x < lot.x1 && point.z >= lot.z0 && point.z < lot.z1;
      if (holds(SPECIAL_LOTS.clock)) clockTower(lot, inner);
      else if (holds(SPECIAL_LOTS.greenhouse)) greenhouse(lot, inner);
      else if (holds(SPECIAL_LOTS.depot)) depot(lot, inner);
      else if (holds(SPECIAL_LOTS.mural)) {
        muralWall = inner;
        building(lot, inner, {...DISTRICTS.market(), floors: 3, roof: 'flat', awning: false}, frontage);
      } else if (district === 'homes' && random() < .14) garden(lot, inner);
      else building(lot, inner, DISTRICTS[district](), frontage);
    }
  }

  // --- Places: what stands at or beside each named spot ---
  const places = {};
  const spot = (item, material = blue) => {
    const mark = add(scene, new THREE.CylinderGeometry(.8, .8, .05, 32), material, item.position.x, .04, item.position.z, false);
    return (places[item.id] = [mark]);
  };
  const byId = Object.fromEntries(PLACES.map(item => [item.id, item]));

  spot(byId['clock-tower']);
  spot(byId.greenhouse);
  spot(byId.depot, ink);

  // The mural is painted on the wall that faces Market Street.
  const mural = standard({map: canvasTexture(512, 256, (c, w, h) => {
    paper(c, w, h); c.fillStyle = BLUE_CSS; pen(c, BLUE_CSS, 6);
    c.beginPath(); c.arc(70, 64, 34, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(250, 120, 110, 52, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(350, 120); c.lineTo(430, 70); c.lineTo(430, 170); c.closePath(); c.fill();
    c.fillStyle = PAPER_CSS; c.beginPath(); c.arc(190, 106, 10, 0, Math.PI * 2); c.fill();
    for (let i = 0; i < 9; i++) { c.beginPath(); c.moveTo(20 + i * 56, 250); c.lineTo(48 + i * 56, 200); c.lineTo(76 + i * 56, 250); c.closePath(); i % 2 ? c.stroke() : (c.fillStyle = BLUE_CSS, c.fill()); }
    for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(440, 30 + i * 22); c.quadraticCurveTo(465, 14 + i * 22, 490, 30 + i * 22); c.stroke(); }
    pen(c, INK_CSS, 8); c.strokeRect(4, 4, w - 8, h - 8);
  }, false)});
  const muralSpot = spot(byId.mural);
  if (muralWall) {
    const width = Math.min(6, muralWall.x1 - muralWall.x0 - .6);
    const center = Math.max(muralWall.x0 + width / 2 + .3, Math.min(muralWall.x1 - width / 2 - .3, byId.mural.position.x));
    muralSpot.push(add(scene, new THREE.PlaneGeometry(width, width / 2), mural, center, CURB + 1 + width / 4, muralWall.z1 + .04, false));
  }

  // The lighthouse stands at the end of the pier, in line with Harbor Street.
  const stripes = standard({map: canvasTexture(32, 256, (c, w, h) => {
    paper(c, w, h); c.fillStyle = BLUE_CSS;
    for (let i = 0; i < 3; i++) c.fillRect(0, h * (i * 2 + 1) / 7, w, h / 7);
  }, false)});
  const lighthouse = new THREE.Group();
  lighthouse.position.set(28, 0, pierZ - 3);
  add(lighthouse, new THREE.CylinderGeometry(1.9, 2.1, .8, 20), white, 0, .4, 0);
  add(lighthouse, new THREE.CylinderGeometry(1, 1.7, 13, 20), stripes, 0, 7.3, 0);
  add(lighthouse, new THREE.CylinderGeometry(1.5, 1.5, .25, 20), ink, 0, 13.9, 0);
  add(lighthouse, new THREE.CylinderGeometry(.85, .85, 1.6, 12), glass, 0, 14.8, 0, false);
  add(lighthouse, new THREE.SphereGeometry(.4, 12, 8), blue, 0, 14.8, 0, false);
  add(lighthouse, new THREE.ConeGeometry(1.2, 1.4, 16), blue, 0, 16.3, 0);
  scene.add(lighthouse);
  spot(byId.lighthouse).push(lighthouse);

  const fountain = new THREE.Group();
  fountain.position.set(byId.fountain.position.x, 0, byId.fountain.position.z);
  outline(add(fountain, new THREE.CylinderGeometry(1.05, 1.15, .45, 24), white, 0, .22, 0));
  add(fountain, new THREE.CylinderGeometry(.9, .9, .04, 24), blue, 0, .46, 0, false);
  add(fountain, new THREE.CylinderGeometry(.12, .16, 1.2, 10), white, 0, .9, 0);
  outline(add(fountain, new THREE.CylinderGeometry(.5, .2, .22, 16), white, 0, 1.5, 0));
  add(fountain, new THREE.SphereGeometry(.17, 10, 8), blue, 0, 1.75, 0);
  scene.add(fountain);
  spot(byId.fountain).push(fountain);

  const bolt = standard({map: canvasTexture(64, 96, (c, w, h) => {
    paper(c, w, h, BLUE_CSS); c.fillStyle = PAPER_CSS;
    c.beginPath(); c.moveTo(38, 8); c.lineTo(14, 52); c.lineTo(30, 52); c.lineTo(24, 88); c.lineTo(50, 40); c.lineTo(34, 40); c.closePath(); c.fill();
  }, false)});
  for (const item of PLACES.filter(place => place.kind === 'charger')) {
    const post = new THREE.Group();
    post.position.set(item.position.x, 0, item.position.z - .75);
    outline(box(post, .5, 1.5, .3, white, 0, .75, 0));
    add(post, new THREE.PlaneGeometry(.36, .54), bolt, 0, 1.05, .16, false);
    box(post, .56, .1, .36, ink, 0, 1.55, 0);
    scene.add(post);
    spot(item, ink).push(post);
  }

  // --- Roadworks: a marked patch with cones and a heap of rubble ---
  const zones = [];
  const marked = standard({map: canvasTexture(128, 128, (c, s) => {
    paper(c, s, s, '#dcdcdc'); pen(c, '#9a9a9a', 3);
    for (let i = -s; i < s * 2; i += 16) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + s, s); c.stroke(); }
  })});
  for (const zone of HINDRANCES) {
    const group = new THREE.Group(), w = zone.x1 - zone.x0, d = zone.z1 - zone.z0;
    group.position.set((zone.x0 + zone.x1) / 2, 0, (zone.z0 + zone.z1) / 2);
    outline(box(group, w, .02, d, marked, 0, .012, 0, false));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      add(group, new THREE.ConeGeometry(.28, .8, 14), ink, sx * (w / 2 - .4), .4, sz * (d / 2 - .4));
      add(group, new THREE.CylinderGeometry(.15, .2, .16, 14), white, sx * (w / 2 - .4), .42, sz * (d / 2 - .4), false);
    }
    add(group, new THREE.ConeGeometry(.9, .6, 7), pale, .6, .3, -.4);
    scene.add(group);
    zones.push({mesh: group, cell: indexOf(zone.x0 + .5, zone.z0 + .5)});
  }

  return {buildings, places, zones};
}
