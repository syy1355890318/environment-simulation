// The delivery robot, package, and route. Only built when delivery is switched on.
import * as THREE from './vendor/three.module.js';

export function createDeliveryLayer(scene, {box, mat}, labelHost, placeLabel, initial) {
  const paving = mat(0xf5f5f5), dark = mat(0x141414), orange = mat(0x1f33c4), parcelMat = mat(0xffffff);
  const pathMeshes = [], routeLines = [], barriers = [];

  initial.segments.forEach(s => {
    const dx = s.end.x - s.start.x, dz = s.end.z - s.start.z, length = Math.hypot(dx, dz);
    const centerX = (s.start.x + s.end.x) / 2, centerZ = (s.start.z + s.end.z) / 2, horizontal = dx !== 0;
    const hit = box(horizontal ? length : 2.6, .06, horizontal ? 2.6 : length, new THREE.MeshStandardMaterial({color: 0xe6e6e6, roughness: .9}), centerX, .04, centerZ);
    hit.castShadow = false;
    hit.userData.segmentId = s.id;
    pathMeshes.push(hit);
    const curve = new THREE.LineCurve3(new THREE.Vector3(s.start.x, .18, s.start.z), new THREE.Vector3(s.end.x, .18, s.end.z));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 1, .085, 8, false), new THREE.MeshStandardMaterial({color: 0x8f99e1, roughness: .6}));
    scene.add(tube);
    routeLines.push(tube);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(.2, .46, 3), mat(0x8f99e1));
    arrow.rotation.x = Math.PI / 2;
    arrow.rotation.z = horizontal ? -Math.PI / 2 : Math.PI;
    arrow.position.set(centerX, .19, centerZ);
    scene.add(arrow);
    const barrier = new THREE.Group();
    barrier.position.set(centerX, .05, centerZ);
    if (horizontal) barrier.rotation.y = Math.PI / 2;
    for (const x of [-.8, .8]) box(.12, 1, .12, dark, x, .5, 0, barrier);
    box(2, .32, .16, orange, 0, .8, 0, barrier);
    for (const x of [-.6, 0, .6]) box(.21, .34, .18, paving, x, .8, 0, barrier);
    barrier.visible = false;
    scene.add(barrier);
    barriers.push(barrier);
  });

  const last = initial.segments.length;
  [initial.package.pickup, ...initial.segments.map(s => s.end)].forEach((p, i) => {
    const end = i === 0 || i === last, radius = end ? .65 : .32;
    const node = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, .08, 32), orange);
    node.position.set(p.x, .14, p.z);
    scene.add(node);
    if (!end) return;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, .035, 8, 64), orange);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, .19, p.z);
    scene.add(ring);
  });

  const robot = new THREE.Group();
  scene.add(robot);
  box(1.35, .85, 1.6, orange, 0, .8, 0, robot);
  box(1.2, .12, 1.45, paving, 0, 1.27, 0, robot);
  box(1.3, .16, 1.5, dark, 0, .28, 0, robot);
  box(.95, .25, .04, dark, 0, .96, .815, robot);
  for (const x of [-.29, .29]) box(.16, .065, .05, mat(0xffffff), x, .97, .85, robot);
  for (const x of [-.77, .77]) for (const z of [-.47, .47]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.23, .23, .18, 20), dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, .29, z);
    robot.add(wheel);
  }
  const packageMesh = new THREE.Group();
  scene.add(packageMesh);
  box(.65, .58, .65, parcelMat, 0, .29, 0, packageMesh);
  box(.11, .015, .67, mat(0x141414), 0, .587, 0, packageMesh);
  robot.userData.entityId = initial.robot.id;
  packageMesh.userData.entityId = initial.package.id;

  const label = (text, name = '') => {
    const element = document.createElement('div');
    element.className = `map-label ${name}`;
    element.textContent = text;
    labelHost.append(element);
    return element;
  };
  const pickupLabel = label('Pickup', 'place-label'), destinationLabel = label('Destination', 'place-label');
  const robotLabel = label(initial.robot.id), packageLabel = label(initial.package.id);

  return {
    entityAt(raycaster) {
      let object = raycaster.intersectObjects([robot, packageMesh], true)[0]?.object;
      while (object && !object.userData.entityId) object = object.parent;
      return object?.userData.entityId || null;
    },
    segmentAt: raycaster => raycaster.intersectObjects(pathMeshes)[0]?.object.userData.segmentId || null,
    update(state, selected, attention) {
      const r = state.robot, p = state.package;
      robot.position.set(r.position.x, .08, r.position.z);
      if (state.movement) robot.rotation.y = Math.atan2(state.movement.end.x - state.movement.start.x, state.movement.end.z - state.movement.start.z);
      const stacked = Math.hypot(p.position.x - r.position.x, p.position.z - r.position.z) < 1e-7;
      packageMesh.position.set(p.position.x, r.carryingId ? 1.46 : stacked ? 2.05 : .17, p.position.z);
      pathMeshes.forEach((mesh, i) => {
        const s = state.segments[i];
        mesh.material.color.setHex(s.id === selected ? 0xd9dcf3 : s.blocked ? 0xd4d4d4 : 0xe6e6e6);
        routeLines[i].material.color.setHex(i < state.nextIndex ? 0x1f33c4 : s.blocked ? 0x9a9a9a : 0x8f99e1);
        barriers[i].visible = s.blocked;
      });
      placeLabel(pickupLabel, {x: p.pickup.x, z: p.pickup.z + 3.7}, .1);
      placeLabel(destinationLabel, {x: p.destination.x, z: p.destination.z + 3.7}, .1);
      placeLabel(robotLabel, r.position, 2.35, -8);
      placeLabel(packageLabel, p.position, packageMesh.position.y + .8, -8);
      if (!attention.includes(r.id)) robotLabel.hidden = true;
      if (!attention.includes(p.id)) packageLabel.hidden = true;
    }
  };
}
