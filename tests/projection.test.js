import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import {projectToScreen, groundPointFromScreen} from '../dist/projection.js';

const camera = () => {
  const result = new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 200);
  result.position.set(30, 40, 35); result.lookAt(0, 0, 0); result.updateMatrixWorld();
  return result;
};
test('world-to-screen projection respects the canvas CSS rectangle', () => {
  const view = camera(), rect = {left: 100, top: 50, width: 800, height: 600};
  const screen = projectToScreen({x: 0, z: 0}, view, rect);
  assert.ok(Math.abs(screen.x - 500) < 1e-8);
  assert.ok(Math.abs(screen.y - 350) < 1e-8);
  assert.equal(screen.visible, true);
  assert.equal(projectToScreen({x: 999, z: 999}, view, rect).visible, false);
});
test('ground picking round trips through orbit, zoom, overhead, and viewport resize', () => {
  const view = camera(), position = {x: -2, z: 2};
  for (const [eye, zoom, rect] of [
    [[30, 40, 35], 1, {left: 0, top: 0, width: 1440, height: 900}],
    [[-30, 35, 25], 1.7, {left: 80, top: 45, width: 740, height: 600}],
    [[0, 55, 0.5], 0.8, {left: 0, top: 0, width: 390, height: 844}]
  ]) {
    view.position.set(...eye); view.lookAt(0, 0, 0); view.zoom = zoom;
    view.updateProjectionMatrix(); view.updateMatrixWorld();
    const screen = projectToScreen(position, view, rect);
    const ground = groundPointFromScreen(screen.x, screen.y, view, rect);
    assert.ok(Math.abs(ground.x - position.x) < 1e-8);
    assert.ok(Math.abs(ground.z - position.z) < 1e-8);
  }
});
