import type { Material, Mesh, Object3D, PerspectiveCamera, Scene, Vector3 } from "three";
import type { ParsedGeometry, ParsedModel, ParsedObject } from "@/lib/stl/parse-model";

/**
 * Presentación común del modelo 3D (material neutro, centrado, Z-up, luces, encuadre).
 * La usan el viewer interactivo del detalle y el generador de previews 360° del Admin,
 * así ambos se ven igual. `THREE` se inyecta: no se importa three acá para no inflar bundles.
 */
type ThreeNamespace = typeof import("three");

export const NEUTRAL_MATERIAL_PARAMS = { color: 0xc8ccd4, roughness: 0.55, metalness: 0.05 } as const;

/** Parsed (STL geometría | 3MF group) -> Object3D renderizable. */
export function toObject3D(THREE: ThreeNamespace, parsed: ParsedModel): Object3D {
  if (parsed.format === "stl") {
    return new THREE.Mesh(parsed.geometry as ParsedGeometry as never, new THREE.MeshBasicMaterial());
  }
  return parsed.group as ParsedObject as unknown as Object3D;
}

/** Reemplaza todos los materiales por uno neutro único (3MF trae materiales propios que se descartan). */
export function applyNeutralMaterial(THREE: ThreeNamespace, model: Object3D): Material {
  const material = new THREE.MeshStandardMaterial({ ...NEUTRAL_MATERIAL_PARAMS });
  model.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const previous = mesh.material;
    mesh.material = material;
    (Array.isArray(previous) ? previous : [previous]).forEach((item) => item?.dispose?.());
  });
  return material;
}

export function disposeModelGeometry(model: Object3D): void {
  model.traverse((object) => {
    (object as Mesh).geometry?.dispose();
  });
}

/**
 * Mide el bounding box y centra el modelo en el origen.
 * Devuelve null si no hay volumen (vacío, NaN o tamaño cero).
 */
export function measureAndCenter(THREE: ThreeNamespace, model: Object3D): { size: Vector3 } | null {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  if (box.isEmpty() || ![size.x, size.y, size.z].every(Number.isFinite) || size.lengthSq() === 0) return null;
  model.position.sub(box.getCenter(new THREE.Vector3()));
  model.updateMatrixWorld(true);
  return { size };
}

/** Pivot que rota -90° en X: STL y 3MF son Z-up; la escena es Y-up. */
export function createZUpPivot(THREE: ThreeNamespace, model: Object3D): Object3D {
  const pivot = new THREE.Group();
  pivot.rotation.x = -Math.PI / 2;
  pivot.add(model);
  return pivot;
}

/** Misma iluminación que el viewer: hemisférica + luz clave pegada a la cámara. */
export function addStandardLights(THREE: ThreeNamespace, scene: Scene, camera: PerspectiveCamera): void {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.1));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  camera.add(keyLight);
  scene.add(camera);
}

/** Radio de la esfera que contiene al modelo (la rotación libre nunca lo saca de cuadro). */
export function boundingRadius(size: { length(): number }): number {
  return Math.max(size.length() / 2, 1e-6);
}

/** Distancia de cámara para encuadrar una esfera de `radius` con un fov vertical dado. */
export function fitDistance(radius: number, fovDegrees: number, margin = 1.05): number {
  return (radius / Math.sin((fovDegrees * Math.PI) / 360)) * margin;
}
