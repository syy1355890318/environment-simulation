// Lets a figure show through whatever stands in front of it, as a flat blue shape.
import * as THREE from './vendor/three.module.js';

// Drawn only where something nearer has already been drawn. It must not be transparent: opaque
// things are drawn in group order, so buildings come first, then silhouettes, then the figures.
const material = new THREE.MeshBasicMaterial({color: 0x1f33c4, depthFunc: THREE.GreaterDepth, depthWrite: false});

export function addSilhouette(figure) {
  const ghosts = new THREE.Group();
  ghosts.renderOrder = 1;
  figure.renderOrder = 2;
  for (const part of [...figure.children]) {
    if (!part.isMesh || part.material.visible === false) continue;
    const ghost = new THREE.Mesh(part.geometry, material);
    ghost.position.copy(part.position);
    ghost.rotation.copy(part.rotation);
    ghost.scale.copy(part.scale);
    ghosts.add(ghost);
  }
  figure.add(ghosts);
  return figure;
}
