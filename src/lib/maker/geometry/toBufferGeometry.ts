import * as THREE from "three";
import type { LetterGeometryResult } from "@/lib/maker/types";

/** Convierte el resultado del pipeline (triangle soup) a una BufferGeometry de three.js. */
export function letterGeometryToBufferGeometry(result: LetterGeometryResult): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(result.normals, 3));
  return geometry;
}
