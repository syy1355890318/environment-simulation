// Occupant figures and the visual indicators for position and movement conditions.
import * as THREE from './vendor/three.module.js';
import {snapToCell} from './spatial.js';
import {addSilhouette} from './silhouette.js';

// Black, white, and gray, with one blue. Conditions are told apart by shape and label.
const BLUE = 0x1f33c4, GRAY = 0x8a8a8a, INK = 0x141414;
export const INDICATOR_COLORS = {
  adjacent: BLUE, adjacentObstacle: BLUE, between: BLUE, among: BLUE, crowd: BLUE, warning: BLUE,
  toward: BLUE, away: GRAY, past: INK, into: BLUE, out: GRAY, zone: 0xcccccc, still: 0xbdbdbd
};
const OVERLAY_Y = 0.3, TRAIL_POINTS = 60, PIN_LIFETIME = 4000, FLASH_LIFETIME = 1500;

const basic = (color, opacity = 0.9) => new THREE.MeshBasicMaterial({color, transparent: true, opacity, side: THREE.DoubleSide, depthTest: false});
const materials = Object.fromEntries(Object.entries(INDICATOR_COLORS).map(([key, color]) => [key, basic(color)]));
const unitPlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const unitRing = new THREE.RingGeometry(0.94, 1, 72).rotateX(-Math.PI / 2);
const unitDisc = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
const arrowHead = new THREE.CircleGeometry(0.5, 3).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2);
const diamond = new THREE.CircleGeometry(0.5, 4).rotateX(-Math.PI / 2);

function flat(geometry, material, x, z, y = OVERLAY_Y) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.renderOrder = 5;
  return mesh;
}
function ribbon(a, b, width, material, y = OVERLAY_Y) {
  const mesh = flat(unitPlane, material, (a.x + b.x) / 2, (a.z + b.z) / 2, y);
  mesh.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  mesh.scale.set(width, 1, Math.hypot(b.x - a.x, b.z - a.z));
  return mesh;
}
function ring(center, radius, material, thickness = 1) {
  const mesh = flat(unitRing, material, center.x, center.z);
  mesh.scale.setScalar(radius);
  if (thickness !== 1) mesh.scale.y = thickness;
  return mesh;
}
function cellSquare(p, material) {
  const mesh = flat(unitPlane, material, p.x, p.z, 0.22);
  mesh.scale.set(1.7, 1, 1.7);
  return mesh;
}

function occupantFigure(type) {
  const group = new THREE.Group();
  const mat = (color, roughness = 0.7) => new THREE.MeshStandardMaterial({color, roughness});
  const add = (geometry, material, y) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y;
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  if (type === 'cone') {
    add(new THREE.BoxGeometry(1.1, 0.08, 1.1), mat(INK), 0.1);
    add(new THREE.ConeGeometry(0.46, 1.25, 20), mat(INK), 0.76);
    add(new THREE.CylinderGeometry(0.2, 0.3, 0.2, 20), mat(0xffffff), 0.72);
  } else {
    const body = type === 'recipient' ? BLUE : 0x4d4d4d;
    add(new THREE.CylinderGeometry(0.26, 0.36, 1.15, 16), mat(body), 0.68);
    add(new THREE.SphereGeometry(0.27, 16, 12), mat(0xffffff), 1.52);
    if (type === 'recipient') {
      const halo = add(new THREE.TorusGeometry(0.58, 0.05, 8, 32), mat(BLUE), 0.14);
      halo.rotation.x = Math.PI / 2;
    }
  }
  // An invisible, generous hit box keeps slim figures easy to grab.
  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.2, 1.5), new THREE.MeshBasicMaterial({visible: false}));
  hit.position.y = 1;
  group.add(hit);
  return addSilhouette(group);
}

export function createSpatialOverlay(scene, labelHost, placeLabel) {
  const figures = new Map(), trailPools = new Map(), labels = [];
  const staticLayer = new THREE.Group(), liveLayer = new THREE.Group();
  scene.add(staticLayer, liveLayer);
  const warningMaterial = basic(INDICATOR_COLORS.warning), crowdMaterial = basic(INDICATOR_COLORS.crowd, 0.8);
  const crowdFill = basic(INDICATOR_COLORS.crowd, 0.12), squareMaterial = basic(INDICATOR_COLORS.adjacent, 0.22);
  const squareObstacleMaterial = basic(INDICATOR_COLORS.adjacentObstacle, 0.22), amongFill = basic(INDICATOR_COLORS.among, 0.2);
  const invalidMaterial = new THREE.MeshStandardMaterial({color: 0xb5b5b5, transparent: true, opacity: .55});
  let staticKey = '', dragPreview = null, labelCount = 0;

  function label(text, kind, position, height = 0.3, offset = 0) {
    let element = labels[labelCount];
    if (!element) {
      element = document.createElement('div');
      labelHost.append(element);
      labels.push(element);
    }
    labelCount++;
    if (element.textContent !== text) element.textContent = text;
    const name = `map-label spatial-label spatial-${kind}`;
    if (element.className !== name) element.className = name;
    placeLabel(element, position, height, offset);
  }

  function rebuildStatic(snapshot) {
    const {relations, crowds, zones} = snapshot;
    const key = JSON.stringify([relations, crowds, zones.map(zone => zone.id)]);
    if (key === staticKey) return;
    staticKey = key;
    staticLayer.clear();
    for (const zone of zones) staticLayer.add(ring(zone.position, zone.radius, materials.zone));
    for (const pair of relations.adjacent) {
      const material = pair.acrossObstacle ? materials.adjacentObstacle : materials.adjacent;
      const square = pair.acrossObstacle ? squareObstacleMaterial : squareMaterial;
      staticLayer.add(cellSquare(pair.from, square), cellSquare(pair.to, square), ribbon(pair.from, pair.to, pair.acrossObstacle ? 0.3 : 0.22, material));
    }
    for (const triple of relations.between) {
      staticLayer.add(ribbon(triple.from, triple.to, 0.12, materials.between));
      const marker = flat(diamond, materials.between, triple.point.x, triple.point.z);
      marker.scale.setScalar(1.5);
      staticLayer.add(marker);
    }
    for (const group of relations.among) {
      group.hull.forEach((p, i) => staticLayer.add(ribbon(p, group.hull[(i + 1) % group.hull.length], 0.14, materials.among)));
      const disc = flat(unitDisc, amongFill, group.point.x, group.point.z);
      disc.scale.setScalar(1);
      staticLayer.add(disc, ring(group.point, 1, materials.among));
    }
    for (const crowd of crowds) {
      const disc = flat(unitDisc, crowdFill, crowd.center.x, crowd.center.z, 0.2);
      disc.scale.setScalar(crowd.radius);
      staticLayer.add(disc, ring(crowd.center, crowd.radius, crowdMaterial));
    }
  }

  function arrow(from, direction, length, material) {
    const size = Math.hypot(direction.x, direction.z);
    if (size < 1e-6) return;
    const end = {x: from.x + direction.x / size * length, z: from.z + direction.z / size * length};
    liveLayer.add(ribbon(from, end, 0.2, material, 0.34));
    const head = flat(arrowHead, material, end.x, end.z, 0.34);
    head.rotation.y = Math.atan2(direction.x, direction.z);
    liveLayer.add(head);
  }

  function updateTrails(trails) {
    const live = new Set(trails.map(trail => trail.id));
    for (const [id, points] of trailPools) if (!live.has(id)) points.visible = false;
    for (const {id, points} of trails) {
      let cloud = trailPools.get(id);
      if (!cloud) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3));
        cloud = new THREE.Points(geometry, new THREE.PointsMaterial({size: 5, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true, opacity: 0.85}));
        cloud.frustumCulled = false;
        cloud.renderOrder = 4;
        scene.add(cloud);
        trailPools.set(id, cloud);
      }
      cloud.visible = true;
      const position = cloud.geometry.attributes.position, color = cloud.geometry.attributes.color, tint = new THREE.Color();
      points.slice(-TRAIL_POINTS).forEach((point, i) => {
        position.setXYZ(i, point.x, 0.26, point.z);
        tint.setHex(INDICATOR_COLORS[point.kind]);
        color.setXYZ(i, tint.r, tint.g, tint.b);
      });
      cloud.geometry.setDrawRange(0, Math.min(points.length, TRAIL_POINTS));
      position.needsUpdate = color.needsUpdate = true;
    }
  }

  function syncFigures(occupants, attention) {
    const live = new Set(occupants.map(occupant => occupant.id));
    for (const [id, figure] of figures) if (!live.has(id)) {
      scene.remove(figure);
      figures.delete(id);
    }
    for (const occupant of occupants) {
      let figure = figures.get(occupant.id);
      if (!figure) {
        figure = occupantFigure(occupant.type);
        figure.userData.occupantId = occupant.id;
        scene.add(figure);
        figures.set(occupant.id, figure);
      }
      const held = dragPreview?.id === occupant.id;
      const position = held ? dragPreview.position : occupant.position;
      figure.position.set(position.x, 0.08, position.z);
      figure.traverseVisible(mesh => {
        if (!mesh.isMesh) return;
        if (!mesh.userData.material) mesh.userData.material = mesh.material;
        mesh.material = held && !dragPreview.valid ? invalidMaterial : mesh.userData.material;
      });
      if (held || attention.includes(occupant.id)) label(occupant.id, 'occupant', position, 2.2);
    }
  }

  function update(snapshot, occupants, attention = []) {
    labelCount = 0;
    rebuildStatic(snapshot);
    liveLayer.clear();
    syncFigures(occupants, attention);
    const positionOf = id => occupants.find(occupant => occupant.id === id)?.position;

    for (const pair of snapshot.relations.adjacent) {
      const middle = {x: (pair.from.x + pair.to.x) / 2, z: (pair.from.z + pair.to.z) / 2};
      label(pair.acrossObstacle ? 'Adjacent across building' : 'Adjacent', pair.acrossObstacle ? 'adjacent-obstacle' : 'adjacent', middle);
    }
    for (const triple of snapshot.relations.between) label('Between', 'between', triple.point, 0.3, 22);
    for (const group of snapshot.relations.among) label('Among', 'among', group.point, 0.3, 22);
    for (const crowd of snapshot.crowds) label('Crowd', 'crowd', {x: crowd.center.x, z: crowd.center.z + crowd.radius});

    if (snapshot.warnings.length && snapshot.robot) {
      warningMaterial.opacity = 0.55 + 0.4 * Math.sin(snapshot.time / 120);
      liveLayer.add(ring(snapshot.robot, 2 + 0.25 * Math.sin(snapshot.time / 120), warningMaterial));
      label('Slowing', 'warning', snapshot.robot, 2.6);
    }
    for (const trend of snapshot.trends) {
      const from = trend.moverPosition || positionOf(trend.mover);
      if (!from) continue;
      const direction = {x: trend.target.x - from.x, z: trend.target.z - from.z};
      const toward = trend.kind === 'toward';
      arrow(from, toward ? direction : {x: -direction.x, z: -direction.z}, Math.min(toward ? trend.distance : 3, 3), materials[trend.kind]);
      label(`${toward ? 'Toward' : 'Away from'} ${trend.referentName}`, trend.kind, from, 0.3, 22);
    }
    for (const event of snapshot.events) {
      if (event.kind === 'past' && event.age <= PIN_LIFETIME) {
        const pin = flat(diamond, materials.past, event.position.x, event.position.z, 0.34);
        pin.scale.setScalar(1.1);
        liveLayer.add(pin);
        label(`Past ${event.referentName}`, 'past', event.position, 0.3, -6);
      }
      if ((event.kind === 'into' || event.kind === 'out') && event.age <= FLASH_LIFETIME) {
        const zone = snapshot.zones.find(item => item.id === event.referent);
        if (zone) {
          const grow = event.kind === 'into' ? 1 - event.age / FLASH_LIFETIME : event.age / FLASH_LIFETIME;
          liveLayer.add(ring(zone.position, zone.radius * (1 + 0.15 * grow), materials[event.kind]));
          label(`${event.kind === 'into' ? 'Into' : 'Out of'} ${zone.name}`, event.kind, event.position, 0.3, -6);
        }
      }
    }
    updateTrails(snapshot.trails);
    for (let i = labelCount; i < labels.length; i++) labels[i].hidden = true;
  }

  return {
    update,
    occupantAt(raycaster) {
      const hit = raycaster.intersectObjects([...figures.values()], true)[0];
      let object = hit?.object;
      while (object && !object.userData.occupantId) object = object.parent;
      return object?.userData.occupantId || null;
    },
    preview(id, position, valid) {
      dragPreview = id ? {id, position: snapToCell(position), valid} : null;
    }
  };
}
