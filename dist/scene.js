import * as THREE from './vendor/three.module.js';
import {projectToScreen, groundPointFromScreen} from './projection.js';
import {SIZE, SIDEWALK, BLOCKS, PLACES} from './city.js';
import {createSpatialOverlay} from './spatial-overlay.js';
import {createDeliveryLayer} from './delivery-layer.js';

const HOME = {azimuth: .72, elevation: .85, zoom: 1};
const ZOOM = {min: .8, max: 6};
const CAMERA_DISTANCE = 160;
const CLICK_SLOP = 4;
const INK = 0x141414, BLUE = 0x1f33c4;

export function createWorld(host, stateProvider, onSelect, onLocate = () => {}, spatial = null) {
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.append(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-30, 30, 25, -25, .1, 600);
  let {azimuth, elevation, zoom} = HOME, overhead = false, selected = null, focusId = null, hoverId = null;
  const target = {x: 0, z: 0};

  scene.add(new THREE.HemisphereLight(0xffffff, 0xe6e6e6, 2.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(-40, 90, 36);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(innerWidth > 800 ? 4096 : 2048);
  Object.assign(sun.shadow.camera, {left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 260});
  sun.shadow.normalBias = .08;
  scene.add(sun);

  const mat = (color, roughness = .8) => new THREE.MeshStandardMaterial({color, roughness});
  function box(w, h, d, material, x, y, z, parent = scene) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  // Streets are the bare ground; the cell grid shows only where something can stand.
  const street = mat(0xe6e6e6), sidewalk = mat(0xf5f5f5), lawn = mat(0xededed), plaza = mat(0xf0f0f0);
  const walls = [mat(0xffffff), mat(0xfafafa), mat(0xf4f4f4)];
  const ink = new THREE.LineBasicMaterial({color: INK, transparent: true, opacity: .55});
  // Thin ink edges give the massing a drawn look.
  const outline = mesh => mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), ink));
  box(SIZE.x * 2, .4, SIZE.z * 2, street, 0, -.2, 0).castShadow = false;
  const gridPoints = [];
  for (let x = -SIZE.x + 1; x < SIZE.x; x += 2) gridPoints.push(x, .03, -SIZE.z, x, .03, SIZE.z);
  for (let z = -SIZE.z + 1; z < SIZE.z; z += 2) gridPoints.push(-SIZE.x, .03, z, SIZE.x, .03, z);
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
  scene.add(new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({color: 0xc8c8c8, transparent: true, opacity: .6})));

  BLOCKS.forEach((block, index) => {
    const w = block.x1 - block.x0, d = block.z1 - block.z0, x = (block.x0 + block.x1) / 2, z = (block.z0 + block.z1) / 2;
    if (block.kind !== 'building') {
      box(w, .02, d, block.kind === 'park' ? lawn : plaza, x, .005, z).castShadow = false;
      return;
    }
    box(w, .14, d, sidewalk, x, .07, z).castShadow = false;
    // One footprint, drawn as a few low volumes so people in the street behind stay in view.
    const alongX = w >= d, long = (alongX ? w : d) - 2 * SIDEWALK, short = (alongX ? d : w) - 2 * SIDEWALK;
    const parts = Math.max(1, Math.min(3, Math.round(long / 8)));
    for (let part = 0; part < parts; part++) {
      const height = .8 + ((index * 5 + part * 3) % 6) * .25, offset = -long / 2 + long * (part + .5) / parts;
      outline(box(alongX ? long / parts : short, height, alongX ? short : long / parts, walls[(index + part) % 3],
        x + (alongX ? offset : 0), .14 + height / 2, z + (alongX ? 0 : offset)));
    }
  });

  const trunk = mat(INK), crowns = [mat(0xffffff), mat(BLUE), mat(0xd9d9d9)];
  const park = BLOCKS.find(block => block.kind === 'park');
  for (let x = park.x0 + 2; x < park.x1; x += 2) for (let z = park.z0 + 2; z < park.z1; z += 2) {
    if ((x * 7 + z * 13) % 3 === 0) continue;
    const scale = .8 + ((x + z) % 3) * .12;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(.08, .12, 1.1, 6), trunk);
    stem.position.set(x, .55, z);
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(.7 * scale, 1), crowns[Math.abs(x * 3 + z) % 3]);
    leaves.position.set(x, 1.4 * scale, z);
    leaves.castShadow = true;
    scene.add(stem, leaves);
  }

  const labelHost = document.getElementById('scene-labels');
  function placeLabel(element, position, height = 0, offset = 0) {
    const screen = projectToScreen(position, camera, canvas.getBoundingClientRect(), height);
    element.style.left = screen.x + 'px';
    element.style.top = (screen.y + offset) + 'px';
    element.hidden = !screen.visible;
  }
  function addLabel(text, name = '') {
    const element = document.createElement('div');
    element.className = `map-label ${name}`;
    element.textContent = text;
    labelHost.append(element);
    return element;
  }

  const exhibit = mat(BLUE), charger = mat(INK), stone = mat(0xffffff);
  const placeLabels = [];
  for (const item of PLACES) {
    const {x, z} = item.position;
    if (item.kind === 'exhibit') {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(.8, .8, .06, 32), exhibit);
      disc.position.set(x, .05, z);
      scene.add(disc);
      box(.45, 1.5, .45, stone, x, .8, z);
      box(.55, .14, .55, exhibit, x, 1.62, z);
      placeLabels.push({element: addLabel(item.name, 'place-label'), position: {x, z: z + 1.6}});
    } else if (item.kind === 'charger') {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(.8, .8, .06, 32), charger);
      disc.position.set(x, .05, z);
      scene.add(disc);
      box(.5, .8, .3, stone, x, .45, z - .5);
      box(.52, .12, .32, charger, x, .91, z - .5);
    }
  }
  const compass = new THREE.Vector3(SIZE.x - 3, .3, SIZE.z - 2);
  scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), compass, 3, 0x8a8a8a, .6, .36));
  const compassLabel = addLabel('N', 'place-label');

  const initial = stateProvider();
  const delivery = initial.delivery === false ? null : createDeliveryLayer(scene, {box, mat}, labelHost, placeLabel, initial);

  const queryMaterial = new THREE.MeshBasicMaterial({color: INK, side: THREE.DoubleSide, transparent: true, opacity: .85, depthTest: false});
  const queryRing = new THREE.Mesh(new THREE.RingGeometry(.97, 1, 64), queryMaterial);
  queryRing.rotation.x = -Math.PI / 2;
  const queryPin = new THREE.Mesh(new THREE.SphereGeometry(.13, 12, 8), queryMaterial);
  const queryLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({color: INK, depthTest: false}));
  queryRing.visible = queryPin.visible = queryLine.visible = false;
  scene.add(queryRing, queryPin, queryLine);
  const queryLabel = addLabel('');
  let locationSelection = null, highlightKey = '';
  function highlightLocation(selection) {
    locationSelection = selection;
    const key = JSON.stringify(selection);
    if (key === highlightKey) return;
    highlightKey = key;
    queryPin.visible = !!selection;
    queryRing.visible = !!selection && selection.kind !== 'segment' && selection.radius > 0;
    queryLine.visible = selection?.kind === 'segment';
    if (!selection) return;
    const p = selection.position;
    queryPin.position.set(p.x, .28, p.z);
    queryRing.position.set(p.x, .24, p.z);
    queryRing.scale.setScalar(selection.radius);
    if (selection.kind === 'segment') {
      const positions = queryLine.geometry.attributes.position;
      positions.setXYZ(0, selection.start.x, .27, selection.start.z);
      positions.setXYZ(1, selection.end.x, .27, selection.end.z);
      positions.needsUpdate = true;
      queryLine.geometry.computeBoundingSphere();
    }
    queryLabel.textContent = selection.name;
  }

  const overlay = createSpatialOverlay(scene, labelHost, placeLabel);

  function updateCamera() {
    // At zoom 1 the whole city fits the window.
    const aspect = innerWidth / innerHeight, span = Math.max(98, 128 / aspect);
    Object.assign(camera, {left: -span * aspect / 2, right: span * aspect / 2, top: span / 2, bottom: -span / 2, zoom});
    camera.updateProjectionMatrix();
    const tilt = overhead ? 1.54 : elevation;
    camera.position.set(
      target.x + CAMERA_DISTANCE * Math.sin(azimuth) * Math.cos(tilt), CAMERA_DISTANCE * Math.sin(tilt),
      target.z + CAMERA_DISTANCE * Math.cos(azimuth) * Math.cos(tilt));
    camera.lookAt(target.x, 0, target.z);
    camera.updateMatrixWorld();
  }
  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    updateCamera();
  }
  window.addEventListener('resize', resize);
  resize();

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const setZoom = value => { zoom = clamp(value, ZOOM.min, ZOOM.max); };
  const groundAt = (x, y) => groundPointFromScreen(x, y, camera, canvas.getBoundingClientRect());
  // Slide the map so the ground under the pointer stays under it.
  function panBetween(fromX, fromY, toX, toY) {
    updateCamera();
    const from = groundAt(fromX, fromY), to = groundAt(toX, toY);
    if (!from || !to) return;
    target.x = clamp(target.x + from.x - to.x, -SIZE.x, SIZE.x);
    target.z = clamp(target.z + from.z - to.z, -SIZE.z, SIZE.z);
  }

  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  function aim(event) {
    updateCamera();
    scene.updateMatrixWorld(true);
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }
  const occupantAt = event => { aim(event); return spatial ? overlay.occupantAt(raycaster) : null; };

  // One pointer pans (or orbits with the right button or Shift); two pointers pinch, twist, and pan.
  const pointers = new Map();
  let gesture = null, moved = false, start = null, occupantDrag = null, pinch = null;
  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    return {distance: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
  };

  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId);
    if (!pointers.size && event.button === 0 && !event.shiftKey) {
      const held = occupantAt(event);
      if (held) {
        occupantDrag = {id: held, moved: false};
        start = {x: event.clientX, y: event.clientY};
        canvas.style.cursor = 'grabbing';
        return;
      }
    }
    if (occupantDrag) return;
    pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    if (pointers.size === 1) {
      gesture = event.button === 2 || event.shiftKey ? 'orbit' : 'pan';
      moved = false;
      start = {x: event.clientX, y: event.clientY};
    } else if (pointers.size === 2) {
      gesture = 'pinch';
      moved = true;
      pinch = pinchState();
    }
  });
  canvas.addEventListener('pointermove', event => {
    if (occupantDrag) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) occupantDrag.moved = true;
      const position = occupantDrag.moved && groundAt(event.clientX, event.clientY);
      if (position) overlay.preview(occupantDrag.id, position, !spatial.placementProblem(occupantDrag.id, position));
      return;
    }
    const last = pointers.get(event.pointerId);
    if (!last) {
      if (event.pointerType !== 'mouse') return;
      const occupant = occupantAt(event), entity = occupant ? null : delivery?.entityAt(raycaster);
      hoverId = occupant || entity || null;
      canvas.style.cursor = occupant ? 'grab' : entity ? 'pointer' : '';
      return;
    }
    const next = {x: event.clientX, y: event.clientY};
    if (gesture === 'pinch' && pointers.size === 2) {
      pointers.set(event.pointerId, next);
      const now = pinchState();
      setZoom(zoom * now.distance / Math.max(pinch.distance, 1));
      azimuth += now.angle - pinch.angle;
      panBetween(pinch.x, pinch.y, now.x, now.y);
      pinch = now;
      return;
    }
    if (Math.hypot(next.x - start.x, next.y - start.y) > CLICK_SLOP) moved = true;
    if (moved && gesture === 'pan') panBetween(last.x, last.y, next.x, next.y);
    if (moved && gesture === 'orbit') {
      azimuth -= (next.x - last.x) * .006;
      elevation = clamp(elevation + (next.y - last.y) * .005, .35, 1.35);
    }
    pointers.set(event.pointerId, next);
    if (moved) canvas.style.cursor = 'grabbing';
  });
  function release(event) {
    if (occupantDrag) {
      const {id, moved: dragged} = occupantDrag;
      occupantDrag = null;
      canvas.style.cursor = '';
      overlay.preview(null);
      if (event.type !== 'pointerup') return;
      const position = dragged && groundAt(event.clientX, event.clientY);
      if (position) spatial.drop(id, position);
      else if (!dragged) spatial.click(id);
      return;
    }
    if (!pointers.delete(event.pointerId)) return;
    canvas.style.cursor = '';
    if (pointers.size) {
      // A finger lifted mid-pinch: carry on panning with the one that is left.
      gesture = 'pan';
      return;
    }
    if (moved || event.type !== 'pointerup') return;
    aim(event);
    const picked = delivery?.entityAt(raycaster) || delivery?.segmentAt(raycaster);
    if (picked) { onSelect(picked); return; }
    const position = groundAt(event.clientX, event.clientY);
    if (position && Math.abs(position.x) <= SIZE.x && Math.abs(position.z) <= SIZE.z) onLocate({kind: 'point', position});
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    setZoom(zoom * Math.exp(-event.deltaY * .0015));
  }, {passive: false});

  function render() {
    updateCamera();
    const attention = [focusId, hoverId];
    delivery?.update(stateProvider(), selected, attention);
    for (const {element, position} of placeLabels) placeLabel(element, position, .1);
    placeLabel(compassLabel, {x: compass.x, z: compass.z - 4.2}, .2);
    if (locationSelection?.showLabel) placeLabel(queryLabel, locationSelection.position, .32, -16);
    else queryLabel.hidden = true;
    if (spatial) overlay.update(spatial.snapshot(), spatial.occupants(), attention);
    renderer.render(scene, camera);
  }

  return {
    render, highlightLocation,
    select: id => { selected = id; },
    setFocus: id => { focusId = id; },
    projectPosition: position => projectToScreen(position, camera, canvas.getBoundingClientRect()),
    zoomBy: factor => setZoom(zoom * factor),
    centerOn(position) { target.x = clamp(position.x, -SIZE.x, SIZE.x); target.z = clamp(position.z, -SIZE.z, SIZE.z); },
    resetView() { ({azimuth, elevation, zoom} = HOME); overhead = false; target.x = target.z = 0; },
    toggleTop() { overhead = !overhead; }
  };
}
