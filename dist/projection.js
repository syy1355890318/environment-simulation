import * as THREE from './vendor/three.module.js';

export function projectToScreen(position, camera, rect, height = 0) {
  const projected = new THREE.Vector3(position.x, height, position.z).project(camera);
  return {x: rect.left + (projected.x + 1) * rect.width / 2,
    y: rect.top + (1 - projected.y) * rect.height / 2,
    visible: Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && Math.abs(projected.z) <= 1};
}

export function groundPointFromScreen(x, y, camera, rect) {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1,
    1 - (y - rect.top) / rect.height * 2), camera);
  const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  return hit ? {x: hit.x, z: hit.z} : null;
}
