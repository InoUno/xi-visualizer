import * as THREE from "three";

export function cleanupNode(node: THREE.Object3D) {
  if (node instanceof THREE.Mesh) {
    node.geometry.dispose();

    let materials = node.material instanceof Array ? node.material : [node.material];
    for (const material of materials) {
      material.dispose();
    }
  }
  for (const child of node.children) {
    cleanupNode(child);
  }
  node.clear();
}
