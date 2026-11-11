// Draws the agents, one agent's spatial knowledge, and what all agents know in common.
import * as THREE from './vendor/three.module.js';
import {SIZE} from './city.js';
import {W, H, UNKNOWN, OBSTACLE, HINDRANCE} from './nav.js';

const INK = 0x141414, BLUE = 0x1f33c4;
const INK_RGB = [20, 20, 20], BLUE_RGB = [31, 51, 196], GRAY_RGB = [120, 120, 120];
const REPAINT_MS = 150, PATH_POINTS = 64;

const flatMaterial = (color, opacity = 1) => new THREE.MeshBasicMaterial({color, transparent: true, opacity, side: THREE.DoubleSide, depthTest: false});
const diamond = new THREE.CircleGeometry(.5, 4).rotateX(-Math.PI / 2);
const disc = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
const thinRing = new THREE.RingGeometry(.86, 1, 48).rotateX(-Math.PI / 2);

function figure(type) {
  const group = new THREE.Group();
  const mat = color => new THREE.MeshStandardMaterial({color, roughness: .7});
  const add = (geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  // Both face +z, so the dark nose or panel shows which way they look.
  if (type === 'visitor') {
    group.userData.body = add(new THREE.CylinderGeometry(.26, .34, 1.1, 16), mat(INK), 0, .63, 0);
    add(new THREE.SphereGeometry(.25, 16, 12), mat(0xffffff), 0, 1.45, 0);
    add(new THREE.BoxGeometry(.12, .12, .2), mat(INK), 0, 1.45, .25);
  } else {
    const body = add(new THREE.BoxGeometry(.8, .5, 1.05), mat(0xffffff), 0, .5, 0);
    body.add(new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({color: INK})));
    group.userData.body = add(new THREE.BoxGeometry(.82, .16, .5), mat(INK), 0, .83, .28);
    for (const x of [-.42, .42]) for (const z of [-.3, .3]) {
      const wheel = add(new THREE.CylinderGeometry(.17, .17, .1, 14), mat(INK), x, .17, z);
      wheel.rotation.z = Math.PI / 2;
    }
  }
  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.2, 1.5), new THREE.MeshBasicMaterial({visible: false}));
  hit.position.y = 1;
  group.add(hit);
  group.userData.normal = group.userData.body.material;
  return group;
}

// `city` lists building meshes with the cells they stand on, and place markers that can be hidden.
export function createAgentOverlay(scene, labelHost, placeLabel, city) {
  const pixels = new Uint8Array(W * H * 4);
  const texture = new THREE.DataTexture(pixels, W, H, THREE.RGBAFormat);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(SIZE.x * 2, SIZE.z * 2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({map: texture, transparent: true, depthWrite: false}));
  veil.position.y = .16;
  veil.renderOrder = 1;
  veil.visible = false;
  scene.add(veil);

  const figures = new Map(), gates = new Map(), labels = [];
  const layer = new THREE.Group();
  scene.add(layer);
  const selectedMaterial = new THREE.MeshStandardMaterial({color: BLUE, roughness: .7});
  const pinMaterial = flatMaterial(BLUE), gateMaterial = flatMaterial(INK, .5), haloMaterial = flatMaterial(BLUE, .9);
  const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({color: BLUE, depthTest: false}));
  pathLine.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PATH_POINTS * 3), 3));
  pathLine.frustumCulled = false;
  pathLine.renderOrder = 6;
  scene.add(pathLine);
  let labelCount = 0, lastPaint = 0, lastKey = '', active = false;

  function label(text, kind, position, height = .3, offset = 0) {
    let element = labels[labelCount];
    if (!element) {
      element = document.createElement('div');
      labelHost.append(element);
      labels.push(element);
    }
    labelCount++;
    if (element.textContent !== text) element.textContent = text;
    const name = `map-label ${kind}`;
    if (element.className !== name) element.className = name;
    placeLabel(element, position, height, offset);
  }
  function flat(geometry, material, position, scale, y = .3) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, y, position.z);
    mesh.scale.setScalar(scale);
    mesh.renderOrder = 5;
    layer.add(mesh);
    return mesh;
  }
  // Row 0 of the texture is the south edge of the map.
  function setPixel(index, rgb, alpha) {
    const offset = ((H - 1 - Math.floor(index / W)) * W + index % W) * 4;
    pixels[offset] = rgb[0]; pixels[offset + 1] = rgb[1]; pixels[offset + 2] = rgb[2]; pixels[offset + 3] = alpha;
  }

  function showCity(cells, landmarks, ownLabels = false) {
    for (const building of city.buildings) building.mesh.visible = !cells || building.cells.some(index => cells[index] === OBSTACLE);
    for (const zone of city.zones) zone.mesh.visible = !cells || cells[zone.cell] === HINDRANCE;
    for (const place of city.places) {
      const known = !landmarks || landmarks.some(item => item.placeId === place.id);
      for (const object of place.objects) object.visible = known;
      // The agent's own landmark labels replace the city's while its map is shown.
      place.hidden = !!landmarks || ownLabels;
    }
  }

  function paint(view) {
    pixels.fill(0);
    const {detail} = view;
    if (detail) {
      // One agent's map: unknown ground is veiled, slow ground it knows is shaded, and what it sees now is blue.
      for (let index = 0; index < W * H; index++) {
        const type = detail.cells[index];
        if (type === UNKNOWN) setPixel(index, INK_RGB, 165);
        else if (type === HINDRANCE) setPixel(index, GRAY_RGB, 120);
      }
      for (const index of detail.visible) if (detail.cells[index] !== OBSTACLE) setPixel(index, BLUE_RGB, 70);
    } else if (view.layer === 'paths') {
      let most = 1;
      for (let index = 0; index < W * H; index++) most = Math.max(most, view.visits[index]);
      for (let index = 0; index < W * H; index++) {
        if (view.visits[index]) setPixel(index, BLUE_RGB, 45 + Math.round(190 * Math.sqrt(view.visits[index] / most)));
      }
    } else if (view.layer === 'shared') {
      const counts = view.shared();
      for (let index = 0; index < W * H; index++) {
        if (!counts[index]) setPixel(index, INK_RGB, 150);
        else setPixel(index, BLUE_RGB, Math.round(150 * counts[index] / view.total));
      }
    }
    texture.needsUpdate = true;
    veil.visible = !!detail || view.layer === 'paths' || view.layer === 'shared';
    showCity(detail?.cells, detail?.landmarks, view.layer === 'landmarks');
  }

  function reset() {
    active = false;
    veil.visible = pathLine.visible = false;
    showCity(null, null);
    for (const group of [...figures.values(), ...gates.values()]) scene.remove(group);
    figures.clear();
    gates.clear();
    layer.clear();
    for (const element of labels) element.hidden = true;
    lastKey = '';
  }

  function update(view, attention = []) {
    if (!view) { if (active) reset(); return; }
    active = true;
    labelCount = 0;
    layer.clear();

    const live = new Set(view.agents.map(agent => agent.id));
    for (const [id, group] of figures) if (!live.has(id)) { scene.remove(group); scene.remove(gates.get(id)); figures.delete(id); gates.delete(id); }
    for (const agent of view.agents) {
      let group = figures.get(agent.id);
      if (!group) {
        group = figure(agent.type);
        group.userData.agentId = agent.id;
        scene.add(group);
        figures.set(agent.id, group);
        const gate = new THREE.Mesh(thinRing, gateMaterial);
        gate.position.set(agent.gate.x, .2, agent.gate.z);
        gate.scale.setScalar(.9);
        scene.add(gate);
        gates.set(agent.id, gate);
      }
      group.position.set(agent.position.x, .08, agent.position.z);
      group.rotation.y = Math.atan2(Math.cos(agent.heading), Math.sin(agent.heading));
      const chosen = agent.id === view.selectedId;
      group.userData.body.material = chosen ? selectedMaterial : group.userData.normal;
      if (chosen) flat(thinRing, haloMaterial, agent.position, 1.1, .22);
      if (chosen || attention.includes(agent.id)) label(agent.id, 'spatial-label spatial-occupant', agent.position, 2.3);
    }

    const {detail} = view;
    pathLine.visible = !!detail && detail.path.length > 1;
    if (detail) {
      const positions = pathLine.geometry.attributes.position, count = Math.min(detail.path.length, PATH_POINTS);
      for (let i = 0; i < count; i++) positions.setXYZ(i, detail.path[i].x, .34, detail.path[i].z);
      positions.needsUpdate = true;
      pathLine.geometry.setDrawRange(0, count);
      for (const landmark of detail.landmarks) {
        flat(diamond, pinMaterial, landmark.position, landmark.kind === 'hindrance' ? .9 : 1.3, .34);
        label(landmark.name, 'spatial-label', landmark.position, .34, -16);
      }
    } else if (view.layer === 'landmarks') {
      for (const entry of view.heat()) {
        const share = entry.count / view.total;
        flat(disc, flatMaterial(BLUE, .18 + .5 * share), entry.position, 1.2 + 2.6 * share, .3);
        label(`${entry.name} · ${entry.count} of ${view.total}`, 'spatial-label', entry.position, .3, -14);
      }
    }

    const key = `${view.selectedId}|${view.layer}|${view.agents.length}`, now = performance.now();
    if (key !== lastKey || now - lastPaint > REPAINT_MS) {
      lastKey = key;
      lastPaint = now;
      paint(view);
    }
    for (let i = labelCount; i < labels.length; i++) labels[i].hidden = true;
  }

  return {
    update,
    agentAt(raycaster) {
      let object = raycaster.intersectObjects([...figures.values()], true)[0]?.object;
      while (object && !object.userData.agentId) object = object.parent;
      return object?.userData.agentId || null;
    }
  };
}
