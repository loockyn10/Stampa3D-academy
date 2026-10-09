import type { Model3DFormat } from "@/lib/stl/library";

/** Subconjunto estructural de lo que usamos de Three.js (permite testear sin WebGL ni DOM). */
interface ParsedPosition {
  count: number;
}
export interface ParsedGeometry {
  getAttribute(name: string): ParsedPosition | undefined;
}
export interface ParsedObject {
  isMesh?: boolean;
  geometry?: ParsedGeometry;
  traverse(callback: (object: ParsedObject) => void): void;
}

export interface Model3DLoader {
  parse(data: ArrayBuffer): unknown;
}

/** Fábricas de loaders: el viewer inyecta STLLoader / ThreeMFLoader importados bajo demanda. */
export interface Model3DLoaders {
  stl: () => Model3DLoader;
  "3mf": () => Model3DLoader;
}

export type Model3DLoadErrorCode = "corrupt" | "empty";

export class Model3DLoadError extends Error {
  constructor(
    public readonly code: Model3DLoadErrorCode,
    public readonly format: Model3DFormat,
    message: string,
  ) {
    super(message);
    this.name = "Model3DLoadError";
  }
}

export type ParsedModel =
  | { format: "stl"; geometry: ParsedGeometry }
  | { format: "3mf"; group: ParsedObject };

function hasVertices(geometry: ParsedGeometry | undefined): boolean {
  return (geometry?.getAttribute("position")?.count ?? 0) >= 3;
}

/**
 * Selecciona el loader según el formato (decidido por el servidor) y valida el resultado.
 * STL devuelve una geometría; 3MF devuelve un Group/jerarquía de meshes.
 * Cualquier fallo del loader o resultado sin geometría se reporta como Model3DLoadError.
 */
export function parseModel3D(format: Model3DFormat, buffer: ArrayBuffer, loaders: Model3DLoaders): ParsedModel {
  let result: unknown;
  try {
    result = loaders[format]().parse(buffer);
  } catch {
    throw new Model3DLoadError("corrupt", format, `No se pudo leer el archivo ${format.toUpperCase()}.`);
  }

  if (format === "stl") {
    const geometry = result as ParsedGeometry;
    if (!hasVertices(geometry)) throw new Model3DLoadError("empty", format, "El STL no tiene geometría.");
    return { format, geometry };
  }

  const group = result as ParsedObject | null;
  let meshes = 0;
  group?.traverse?.((object) => {
    if (object.isMesh && hasVertices(object.geometry)) meshes += 1;
  });
  if (!group || meshes === 0) throw new Model3DLoadError("empty", format, "El 3MF no tiene mallas visibles.");
  return { format, group };
}

/** Copy de error por formato: para 3MF nunca se habla de "STL". */
export function describeModel3DLoadError(error: Model3DLoadError): { title: string; detail: string } {
  if (error.format === "stl") {
    return {
      title: "Archivo dañado",
      detail: error.code === "empty" ? "El STL no tiene geometría válida." : "No pude leer la geometría de este STL.",
    };
  }
  return {
    title: "El archivo 3D no pudo cargarse",
    detail: "El 3MF está dañado o no tiene una geometría que se pueda mostrar. Podés descargarlo igual.",
  };
}
