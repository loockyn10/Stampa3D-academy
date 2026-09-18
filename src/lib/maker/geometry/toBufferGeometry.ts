import * as THREE from "three";

export interface TriangleSoup {
  positions: Float32Array;
  normals: Float32Array;
}

/** Convierte un triangle soup del pipeline (LetterGeometryResult o LetterPieceResult) a una BufferGeometry de three.js. */
export function letterGeometryToBufferGeometry(result: TriangleSoup): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(result.normals, 3));
  return geometry;
}
