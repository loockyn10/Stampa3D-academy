import type { Material, Mesh, Object3D } from "three";
import type { Model3DFormat } from "@/lib/stl/library";
import { applyNeutralMaterial, NEUTRAL_MATERIAL_PARAMS, toObject3D } from "@/lib/stl/model-display";
import { Model3DLoadError, parseModel3D, type Model3DLoaders } from "@/lib/stl/parse-model";
import {
  assertSafeThreeMfArchive,
  findPaintedModelPaths,
  inspect3mfPackage,
  ThreeMfArchiveError,
  type ThreeMfInspection,
  type UnzipSync,
} from "@/lib/stl/three-mf-package";

/**
 * Preparación ÚNICA del modelo para mostrar (viewer, miniatura y WebM): parseo, selección de cama
 * (3MF de Bambu/Orca con varias plates -> la primera), colores y material. Las tres superficies
 * consumen el mismo `PreparedModel`, así nunca muestran cosas distintas.
 * `THREE` se inyecta (no se importa three acá para no inflar bundles).
 */
type ThreeNamespace = typeof import("three");

/** Nombre que ThreeMFLoader le pone a las mallas sin material/color en el 3MF (Loader.DEFAULT_MATERIAL_NAME). */
export const THREE_MF_DEFAULT_MATERIAL_NAME = "__DEFAULT";

/**
 * neutral: ninguna malla conserva color (STL, o 3MF sin color interpretable).
 * preserved: todas las mallas usan un color real del archivo (material propio o filamento configurado).
 * mixed: algunas con color real y otras en neutro (color no interpretable en esas piezas).
 */
export type ModelColorMode = "neutral" | "preserved" | "mixed";

export interface PreparedModel {
  object3d: Object3D;
  format: Model3DFormat;
  /** Índice 0-based de la cama mostrada; null si el formato/archivo no tiene concepto de plates (STL, 3MF genérico). */
  selectedPlate: number | null;
  /** Camas con contenido detectadas por la metadata del slicer; null si no aplica. */
  plateCount: number | null;
  colorMode: ModelColorMode;
  /** Slicer reconocido por la metadata (solo 3MF con plates mapeables). */
  slicer: "bambu" | "orca" | null;
  /** Motivo por el que un 3MF con metadata de slicer no pudo usar plates (diagnóstico; null si no aplica). */
  fallbackReason: string | null;
  /** Libera geometrías y materiales del modelo preparado (no toca el renderer). */
  dispose(): void;
}

/** Motivos de "generic" que solo significan "3MF sin metadata de slicer" (no es un fallback anómalo). */
const PLAIN_3MF_REASONS = new Set(["sin-unzip", "sin-model-settings", "sin-marca-bambu"]);

export interface PrepareModelOptions {
  /** Cama a mostrar (0-based). V1 visible: 0. Fuera de rango -> build completo. */
  plateIndex?: number;
  /** Loaders/unzip inyectados (tests); por defecto se importan bajo demanda. */
  deps?: PrepareModelDeps;
}

export interface PrepareModelDeps {
  loaders: Model3DLoaders;
  unzipSync?: UnzipSync;
}

/** Importa bajo demanda los loaders oficiales de Three.js (y fflate, el mismo que usa ThreeMFLoader). */
export async function loadModelDeps(format: Model3DFormat): Promise<PrepareModelDeps> {
  const [{ STLLoader }, threeMf, fflate] = await Promise.all([
    import("three/examples/jsm/loaders/STLLoader.js"),
    format === "3mf" ? import("three/examples/jsm/loaders/3MFLoader.js") : Promise.resolve(null),
    format === "3mf" ? import("three/examples/jsm/libs/fflate.module.js") : Promise.resolve(null),
  ]);
  return {
    loaders: {
      stl: () => new STLLoader(),
      "3mf": () => {
        if (!threeMf) throw new Error("3MF loader no cargado");
        return new threeMf.ThreeMFLoader();
      },
    },
    unzipSync: fflate ? (fflate.unzipSync as unknown as UnzipSync) : undefined,
  };
}

/** Subconjunto estructural de Object3D que usa la selección de plates (permite testear sin three). */
export interface SceneNode {
  children: SceneNode[];
  remove(...objects: SceneNode[]): unknown;
  traverse(callback: (object: SceneNode) => void): void;
}

type SlicerInspection = Extract<ThreeMfInspection, { kind: "slicer" }>;

export interface PlateSelection {
  selectedPlate: number;
  plateCount: number;
  /** Índices (en el orden de build) de los items que quedan. */
  itemIndices: number[];
}

function countMeshes(node: SceneNode): number {
  let meshes = 0;
  node.traverse((object) => {
    if ((object as unknown as { isMesh?: boolean }).isMesh) meshes += 1;
  });
  return meshes;
}

/**
 * Deja en el Group raíz de ThreeMFLoader solo los build items de la cama `plateIndex`.
 * ThreeMFLoader devuelve un child por build item y en el mismo orden del <build>, por eso la
 * selección parte de la metadata real (model_instance -> build item), no de la posición.
 * Si algo no cuadra (cantidad de children, cama sin mallas, índice fuera de rango) devuelve null
 * sin tocar el árbol: el llamador conserva el build completo.
 */
export function select3mfPlate(root: SceneNode, info: SlicerInspection, plateIndex: number): PlateSelection | null {
  const plate = Number.isInteger(plateIndex) ? info.plates[plateIndex] : undefined;
  if (!plate || root.children.length !== info.buildItems.length) return null;
  const keep = new Set(plate.itemIndices);
  const originals = [...root.children];
  if (!originals.some((child, index) => keep.has(index) && countMeshes(child) > 0)) return null;
  originals.forEach((child, index) => {
    if (!keep.has(index)) root.remove(child);
  });
  return { selectedPlate: plateIndex, plateCount: info.plates.length, itemIndices: plate.itemIndices };
}

interface MeshLike {
  isMesh?: boolean;
  material?: Material | Material[];
  children?: MeshLike[];
  traverse(callback: (object: MeshLike) => void): void;
}

function isDefaultMaterial(material: Material | Material[] | undefined): boolean {
  if (!material) return true;
  const list = Array.isArray(material) ? material : [material];
  return list.every((item) => item?.name === THREE_MF_DEFAULT_MATERIAL_NAME);
}

interface ColorTally {
  /** Mallas con un color real (material propio del 3MF o filamento configurado). */
  colored: number;
  neutral: number;
}

class MaterialPalette {
  private neutral: Material | null = null;
  private readonly byColor = new Map<string, Material>();
  readonly created = new Set<Material>();

  constructor(private readonly THREE: ThreeNamespace) {}

  getNeutral(): Material {
    if (!this.neutral) {
      this.neutral = new this.THREE.MeshStandardMaterial({ ...NEUTRAL_MATERIAL_PARAMS });
      this.created.add(this.neutral);
    }
    return this.neutral;
  }

  getColor(hex: string): Material {
    let material = this.byColor.get(hex);
    if (!material) {
      material = new this.THREE.MeshStandardMaterial({
        color: parseInt(hex.slice(1), 16),
        roughness: NEUTRAL_MATERIAL_PARAMS.roughness,
        metalness: NEUTRAL_MATERIAL_PARAMS.metalness,
      });
      this.byColor.set(hex, material);
      this.created.add(material);
    }
    return material;
  }
}

/**
 * Para las mallas bajo `node`: las que ya traen material/color propio del 3MF se conservan; las
 * "por defecto" (sin color en el archivo) reciben `hex` (filamento configurado) o el neutro.
 */
function paintDefaultMeshes(node: MeshLike, hex: string | null, palette: MaterialPalette, tally: ColorTally): void {
  node.traverse((object) => {
    if (!object.isMesh) return;
    if (isDefaultMaterial(object.material)) {
      const previous = object.material;
      object.material = hex ? palette.getColor(hex) : palette.getNeutral();
      (Array.isArray(previous) ? previous : [previous]).forEach((item) => item?.dispose?.());
      if (hex) tally.colored += 1;
      else tally.neutral += 1;
    } else {
      tally.colored += 1;
    }
  });
}

/**
 * Colores de un 3MF Bambu/Orca: por pieza (componente) -> filamento (`extruder` de la parte u objeto)
 * -> `filament_colour` del proyecto. Sin dato confiable (extruder ausente, color inválido o pieza con
 * facetas pintadas, cuya codificación no se interpreta) la pieza queda en neutro.
 */
function applySlicerColors(
  root: MeshLike,
  info: SlicerInspection,
  itemIndices: readonly number[],
  painted: ReadonlySet<string | null>,
  palette: MaterialPalette,
  tally: ColorTally,
): void {
  const items = root.children ?? [];
  // Tras select3mfPlate, los children restantes siguen el orden de itemIndices (ascendente).
  const base = items.length === itemIndices.length ? itemIndices : null;
  items.forEach((itemNode, position) => {
    const item = base ? info.buildItems[base[position]] : undefined;
    const parts = item?.parts;
    const components = itemNode.children ?? [];
    if (!parts || components.length !== parts.length) {
      paintDefaultMeshes(itemNode, null, palette, tally);
      return;
    }
    parts.forEach((part, index) => {
      const colour = part.extruder !== null ? (info.filamentColors[part.extruder - 1] ?? null) : null;
      const hex = colour && !painted.has(part.path) ? colour : null;
      paintDefaultMeshes(components[index], hex, palette, tally);
    });
  });
}

function colorModeOf(tally: ColorTally): ModelColorMode {
  if (tally.colored === 0) return "neutral";
  return tally.neutral === 0 ? "preserved" : "mixed";
}

/**
 * Fuente de verdad del modelo mostrado. STL: geometría completa en material neutro. 3MF: geometría
 * de ThreeMFLoader; si la metadata de Bambu/Orca define plates mapeables se muestra solo la primera
 * (build completo si no hay metadata confiable); los colores del archivo se conservan cuando son
 * interpretables y el resto queda neutro. Lanza Model3DLoadError (corrupt/empty).
 */
export async function prepareModelForDisplay(
  THREE: ThreeNamespace,
  format: Model3DFormat,
  buffer: ArrayBuffer,
  options: PrepareModelOptions = {},
): Promise<PreparedModel> {
  const deps = options.deps ?? (await loadModelDeps(format));

  if (format === "3mf" && deps.unzipSync) {
    try {
      assertSafeThreeMfArchive(buffer, deps.unzipSync);
    } catch (error) {
      if (error instanceof ThreeMfArchiveError) throw new Model3DLoadError("corrupt", format, error.message);
      throw error;
    }
  }

  const parsed = parseModel3D(format, buffer, deps.loaders);
  const object3d = toObject3D(THREE, parsed);
  const palette = new MaterialPalette(THREE);
  const owned = palette.created;

  const finish = (extra: Partial<PreparedModel> & { colorMode: ModelColorMode }): PreparedModel => ({
    object3d,
    format,
    selectedPlate: null,
    plateCount: null,
    slicer: null,
    fallbackReason: null,
    ...extra,
    dispose() {
      const geometries = new Set<{ dispose(): void }>();
      const materials = new Set<{ dispose(): void }>(owned);
      object3d.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        if (mesh.geometry) geometries.add(mesh.geometry);
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((item) => item && materials.add(item));
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    },
  });

  if (format === "stl") {
    owned.add(applyNeutralMaterial(THREE, object3d));
    return finish({ colorMode: "neutral" });
  }

  const tally: ColorTally = { colored: 0, neutral: 0 };
  let inspection: ThreeMfInspection = { kind: "generic", reason: "sin-unzip" };
  if (deps.unzipSync) inspection = inspect3mfPackage(buffer, deps.unzipSync);

  if (inspection.kind === "slicer") {
    const slicerInfo: SlicerInspection = inspection;
    const selection = select3mfPlate(object3d as unknown as SceneNode, slicerInfo, options.plateIndex ?? 0);
    if (selection) {
      const paintedPaths = findPaintedModelPaths(
        buffer,
        deps.unzipSync as UnzipSync,
        slicerInfo.rootModelPath,
        selection.itemIndices.flatMap((index) => slicerInfo.buildItems[index].parts?.map((part) => part.path) ?? []),
      );
      applySlicerColors(object3d as unknown as MeshLike, slicerInfo, selection.itemIndices, paintedPaths, palette, tally);
      return finish({
        colorMode: colorModeOf(tally),
        selectedPlate: selection.selectedPlate,
        plateCount: selection.plateCount,
        slicer: slicerInfo.slicer,
      });
    }
    inspection = { kind: "generic", reason: "plate-no-seleccionable" };
  }

  // 3MF genérico (o metadata no utilizable): build completo, colores propios del archivo, neutro donde no hay.
  paintDefaultMeshes(object3d as unknown as MeshLike, null, palette, tally);
  return finish({
    colorMode: colorModeOf(tally),
    fallbackReason: inspection.kind === "generic" && !PLAIN_3MF_REASONS.has(inspection.reason) ? inspection.reason : null,
  });
}
