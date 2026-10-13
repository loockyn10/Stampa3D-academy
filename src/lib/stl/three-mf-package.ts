/**
 * Inspección del contenedor 3MF (ZIP + XML) para Librería STL: detecta metadata de slicer
 * (Bambu Studio / OrcaSlicer) con plates, y filamentos/colores. Lógica pura (sin three ni DOM):
 * se testea en Node. ThreeMFLoader sigue siendo quien construye la geometría; esto solo describe
 * cómo se agrupan los build items en camas y qué filamento tiene cada pieza.
 *
 * Estructura que se apoya en archivos reales de Bambu Studio 02.07 y OrcaSlicer 2.4 (ver docs):
 *   _rels/.rels                      -> relación al modelo raíz (3D/3dmodel.model)
 *   3D/3dmodel.model                 -> <object id><components><component p:path objectid/> + <build><item objectid/>
 *   Metadata/model_settings.config   -> <object id>(metadata extruder) <part id>(extruder opcional) <plate>(plater_id, model_instance object_id/instance_id)
 *   Metadata/project_settings.config -> JSON con `filament_colour` (colores configurados, "#RRGGBB")
 *
 * El 3MF es input no confiable: todo en memoria, sin extraer a disco, con límites de tamaño,
 * paths validados contra el diccionario del ZIP (sin zip-slip) y XML leído con un scanner de tags
 * que ignora DOCTYPE/entidades externas (nunca se resuelven).
 */

export const THREE_MF_LIMITS = {
  /** Suma de tamaños descomprimidos declarados por el ZIP (anti zip-bomb, se valida antes de parsear). */
  maxTotalUncompressedBytes: 1024 * 1024 * 1024,
  maxEntryUncompressedBytes: 512 * 1024 * 1024,
  maxEntries: 20_000,
  /** model_settings.config / project_settings.config / rels. */
  maxConfigBytes: 8 * 1024 * 1024,
  /** Modelo raíz (las mallas inline se descartan antes de escanear). */
  maxRootModelBytes: 64 * 1024 * 1024,
  /** Tope por sub-modelo al buscar facetas pintadas. */
  maxScanBytes: 256 * 1024 * 1024,
} as const;

/** Subconjunto de `unzipSync` de fflate que usamos (inyectable para tests). */
export interface ZipEntryInfo {
  name: string;
  originalSize: number;
}
export type UnzipSync = (
  data: Uint8Array,
  options?: { filter?: (file: ZipEntryInfo) => boolean },
) => Record<string, Uint8Array>;

export class ThreeMfArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThreeMfArchiveError";
  }
}

// --------------------------------------------------------------------------------------- XML mínimo

export interface XmlTag {
  name: string;
  attrs: Record<string, string>;
  kind: "open" | "close" | "self";
}

const TAG_RE = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>"']+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTR_RE = /([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function decodeXmlText(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|quot|apos|lt|gt|amp);/g, (_match, entity: string) => {
    switch (entity) {
      case "quot":
        return '"';
      case "apos":
        return "'";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      default: {
        const code = entity[1] === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
    }
  });
}

/** Recorre los tags de apertura/cierre en orden. No expande entidades ni DOCTYPE; comentarios ignorados. */
export function forEachXmlTag(xml: string, callback: (tag: XmlTag) => void): void {
  const text = xml.replace(/<!--[\s\S]*?-->/g, "");
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(text))) {
    const [, closing, name, rawAttrs, selfClosing] = match;
    if (closing) {
      callback({ name, attrs: {}, kind: "close" });
      continue;
    }
    const attrs: Record<string, string> = {};
    if (rawAttrs) {
      ATTR_RE.lastIndex = 0;
      let attr: RegExpExecArray | null;
      while ((attr = ATTR_RE.exec(rawAttrs))) attrs[attr[1]] = decodeXmlText(attr[2] ?? attr[3] ?? "");
    }
    callback({ name, attrs, kind: selfClosing ? "self" : "open" });
  }
}

const textDecoder = typeof TextDecoder === "undefined" ? null : new TextDecoder("utf-8");

function bytesToText(bytes: Uint8Array): string {
  if (!textDecoder) throw new ThreeMfArchiveError("TextDecoder no disponible.");
  return textDecoder.decode(bytes);
}

// ------------------------------------------------------------------------------------------ ZIP

/** Normaliza el target de una relación / p:path a un nombre de entry ("/3D/x.model" -> "3D/x.model"). */
export function normalizeEntryPath(target: string | null | undefined): string | null {
  if (!target || target.length > 512) return null;
  const path = target.replace(/^\/+/, "");
  if (!path || /[\\\0:]/.test(path) || path.split("/").some((part) => part === ".." || part === "." || part === "")) {
    return null;
  }
  return path;
}

function readEntries(
  buffer: ArrayBuffer,
  unzip: UnzipSync,
  names: readonly string[],
  maxBytes: number,
): Record<string, Uint8Array> {
  const wanted = new Set(names);
  return unzip(new Uint8Array(buffer), {
    filter: (file) => wanted.has(file.name) && file.originalSize <= maxBytes,
  });
}

/** Lista los entries del ZIP sin descomprimir nada (el filtro devuelve false). */
export function listZipEntries(buffer: ArrayBuffer, unzip: UnzipSync): ZipEntryInfo[] {
  const entries: ZipEntryInfo[] = [];
  unzip(new Uint8Array(buffer), {
    filter: (file) => {
      entries.push({ name: file.name, originalSize: file.originalSize });
      return false;
    },
  });
  return entries;
}

/**
 * Valida el ZIP antes de entregárselo a ThreeMFLoader (que descomprime todo): cantidad y tamaño
 * declarados dentro de límites. Un archivo que no es ZIP no se rechaza acá (lo reporta el loader).
 */
export function assertSafeThreeMfArchive(buffer: ArrayBuffer, unzip: UnzipSync): void {
  let entries: ZipEntryInfo[];
  try {
    entries = listZipEntries(buffer, unzip);
  } catch {
    return;
  }
  if (entries.length > THREE_MF_LIMITS.maxEntries) throw new ThreeMfArchiveError("El 3MF tiene demasiados archivos internos.");
  let total = 0;
  for (const entry of entries) {
    if (!(entry.originalSize <= THREE_MF_LIMITS.maxEntryUncompressedBytes)) {
      throw new ThreeMfArchiveError("El 3MF contiene un archivo interno demasiado grande.");
    }
    total += entry.originalSize;
    if (total > THREE_MF_LIMITS.maxTotalUncompressedBytes) throw new ThreeMfArchiveError("El 3MF descomprimido es demasiado grande.");
  }
}

// ------------------------------------------------------------------------------- modelo raíz

export interface ThreeMfObject {
  id: string;
  /** Componentes en orden (ThreeMFLoader los agrega como children en el mismo orden). null = malla directa. */
  components: { objectId: string; path: string | null }[] | null;
}

export interface ThreeMfRootModel {
  application: string | null;
  metadata: Record<string, string>;
  objects: Map<string, ThreeMfObject>;
  /** Build items en orden de aparición: ThreeMFLoader devuelve un child por item, en este orden. */
  buildItems: { objectId: string }[];
}

export function parseRootModel(xml: string): ThreeMfRootModel {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ThreeMfArchiveError("El 3MF declara DOCTYPE/ENTITY (no soportado).");

  const metadata: Record<string, string> = {};
  const metaRe = /<metadata\s+name\s*=\s*"([^"]*)"[^>]*>([^<]*)<\/metadata>/g;
  let meta: RegExpExecArray | null;
  while ((meta = metaRe.exec(xml))) {
    if (!(meta[1] in metadata)) metadata[decodeXmlText(meta[1])] = decodeXmlText(meta[2]).slice(0, 256);
  }

  const stripped = xml.replace(/<mesh[\s>][\s\S]*?<\/mesh>/g, "<mesh/>");
  const objects = new Map<string, ThreeMfObject>();
  const buildItems: { objectId: string }[] = [];
  let current: ThreeMfObject | null = null;
  let inBuild = false;
  forEachXmlTag(stripped, (tag) => {
    if (tag.name === "object" && tag.kind !== "close") {
      const id = tag.attrs.id;
      current = id ? { id, components: null } : null;
      if (current) objects.set(id, current);
      if (tag.kind === "self") current = null;
    } else if (tag.name === "object" && tag.kind === "close") {
      current = null;
    } else if (tag.name === "component" && tag.kind !== "close" && current) {
      const objectId = tag.attrs.objectid;
      if (objectId) {
        (current as ThreeMfObject).components ??= [];
        (current as ThreeMfObject).components!.push({ objectId, path: normalizeEntryPath(tag.attrs["p:path"]) });
      }
    } else if (tag.name === "build") {
      inBuild = tag.kind === "open";
    } else if (tag.name === "item" && tag.kind !== "close" && inBuild) {
      if (tag.attrs.objectid) buildItems.push({ objectId: tag.attrs.objectid });
    }
  });

  return { application: metadata.Application ?? null, metadata, objects, buildItems };
}

// ----------------------------------------------------------------------------- model_settings

export interface SlicerPlate {
  plateId: number;
  instances: { objectId: string; instanceId: number }[];
}

export interface SlicerModelSettings {
  objectExtruder: Map<string, number>;
  partExtruder: Map<string, number>;
  plates: SlicerPlate[];
}

function positiveInt(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,9}$/.test(value.trim())) return null;
  const parsed = parseInt(value, 10);
  return parsed > 0 ? parsed : null;
}

export function parseModelSettings(xml: string): SlicerModelSettings {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ThreeMfArchiveError("model_settings declara DOCTYPE/ENTITY (no soportado).");
  const objectExtruder = new Map<string, number>();
  const partExtruder = new Map<string, number>();
  const plates: SlicerPlate[] = [];
  let objectId: string | null = null;
  let partId: string | null = null;
  let plate: { plateId: number | null; instances: { objectId: string; instanceId: number }[] } | null = null;
  let instance: { objectId?: string; instanceId?: number } | null = null;
  let invalidPlate = false;

  forEachXmlTag(xml, (tag) => {
    if (tag.kind === "close") {
      if (tag.name === "part") partId = null;
      else if (tag.name === "object") objectId = null;
      else if (tag.name === "model_instance") {
        if (plate && instance) {
          if (instance.objectId !== undefined && instance.instanceId !== undefined) {
            plate.instances.push({ objectId: instance.objectId, instanceId: instance.instanceId });
          } else invalidPlate = true;
        }
        instance = null;
      } else if (tag.name === "plate") {
        if (plate) {
          if (plate.plateId === null) invalidPlate = true;
          else plates.push({ plateId: plate.plateId, instances: plate.instances });
        }
        plate = null;
      }
      return;
    }
    if (tag.name === "plate" && tag.kind === "open") {
      plate = { plateId: null, instances: [] };
    } else if (tag.name === "model_instance" && plate) {
      instance = {};
      if (tag.kind === "self") {
        invalidPlate = true;
        instance = null;
      }
    } else if (tag.name === "object" && !plate && tag.kind === "open") {
      objectId = tag.attrs.id ?? null;
      partId = null;
    } else if (tag.name === "part" && objectId && !plate) {
      partId = tag.kind === "open" ? (tag.attrs.id ?? null) : null;
    } else if (tag.name === "metadata" && tag.attrs.key !== undefined) {
      const { key, value } = tag.attrs;
      if (plate) {
        if (instance) {
          if (key === "object_id") instance.objectId = value;
          else if (key === "instance_id" && /^\d{1,9}$/.test(value ?? "")) instance.instanceId = parseInt(value, 10);
        } else if (key === "plater_id") {
          plate.plateId = positiveInt(value);
        }
      } else if (key === "extruder") {
        const extruder = positiveInt(value);
        if (extruder === null) return;
        if (partId) partExtruder.set(partId, extruder);
        else if (objectId) objectExtruder.set(objectId, extruder);
      }
    }
  });
  if (invalidPlate) throw new ThreeMfArchiveError("model_settings tiene plates incompletas.");
  return { objectExtruder, partExtruder, plates };
}

/** `filament_colour` de project_settings.config: "#RRGGBB" (o "#RRGGBBAA", alpha ignorado). Inválido -> null. */
export function parseFilamentColors(json: string): (string | null)[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const list = (parsed as { filament_colour?: unknown } | null)?.filament_colour;
  if (!Array.isArray(list) || list.length > 64) return [];
  return list.map((entry) => {
    if (typeof entry !== "string") return null;
    const match = /^#([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$/.exec(entry.trim());
    return match ? `#${match[1].toLowerCase()}` : null;
  });
}

// --------------------------------------------------------------------------------- inspección

export interface InspectedPart {
  /** Id del componente (= <part id> de model_settings). */
  partId: string;
  /** Sub-modelo que contiene la malla (null = inline en el modelo raíz). */
  path: string | null;
  /** Filamento 1-based (parte u objeto); null si el archivo no lo declara. */
  extruder: number | null;
}

export interface InspectedBuildItem {
  objectId: string;
  /** null = el objeto es una malla directa (sin componentes). */
  parts: InspectedPart[] | null;
}

export type ThreeMfInspection =
  | { kind: "generic"; reason: string }
  | {
      kind: "slicer";
      slicer: "bambu" | "orca";
      application: string | null;
      rootModelPath: string;
      /** Un item por child que devuelve ThreeMFLoader, en el mismo orden. */
      buildItems: InspectedBuildItem[];
      /** Camas con al menos un item, ordenadas por plater_id; itemIndices apunta a buildItems. */
      plates: { plateId: number; itemIndices: number[] }[];
      filamentColors: (string | null)[];
    };

function generic(reason: string): ThreeMfInspection {
  return { kind: "generic", reason };
}

/**
 * Detecta metadata de Bambu Studio / OrcaSlicer y valida que las plates se puedan mapear a build items.
 * Cualquier inconsistencia devuelve `generic` (el llamador renderiza el build completo): nunca lanza.
 */
export function inspect3mfPackage(buffer: ArrayBuffer, unzip: UnzipSync): ThreeMfInspection {
  try {
    const entries = listZipEntries(buffer, unzip);
    const names = new Set(entries.map((entry) => entry.name));
    const settingsPath = "Metadata/model_settings.config";
    if (!names.has(settingsPath)) return generic("sin-model-settings");

    // Modelo raíz según _rels/.rels (igual que ThreeMFLoader), con 3D/3dmodel.model como respaldo.
    let rootModelPath = "3D/3dmodel.model";
    if (names.has("_rels/.rels")) {
      const rels = readEntries(buffer, unzip, ["_rels/.rels"], THREE_MF_LIMITS.maxConfigBytes)["_rels/.rels"];
      if (rels) {
        let found: string | null = null;
        forEachXmlTag(bytesToText(rels), (tag) => {
          if (found || tag.name !== "Relationship" || tag.kind === "close") return;
          if ((tag.attrs.Target ?? "").toLowerCase().endsWith(".model")) found = normalizeEntryPath(tag.attrs.Target);
        });
        if (found) rootModelPath = found;
      }
    }
    if (!names.has(rootModelPath)) return generic("sin-modelo-raiz");

    const wanted = [rootModelPath, settingsPath];
    const projectPath = "Metadata/project_settings.config";
    if (names.has(projectPath)) wanted.push(projectPath);
    const files = readEntries(buffer, unzip, wanted, THREE_MF_LIMITS.maxRootModelBytes);
    const rootBytes = files[rootModelPath];
    const settingsBytes = files[settingsPath];
    if (!rootBytes || !settingsBytes || settingsBytes.length > THREE_MF_LIMITS.maxConfigBytes) return generic("entries-no-legibles");

    const root = parseRootModel(bytesToText(rootBytes));
    if (!("BambuStudio:3mfVersion" in root.metadata)) return generic("sin-marca-bambu");
    if (root.buildItems.length === 0) return generic("sin-build-items");
    const slicer: "bambu" | "orca" =
      "OrcaSlicer" in root.metadata || /^OrcaSlicer/i.test(root.application ?? "") ? "orca" : "bambu";

    const settings = parseModelSettings(bytesToText(settingsBytes));
    if (settings.plates.length === 0) return generic("sin-plates");

    const buildItems: InspectedBuildItem[] = root.buildItems.map((item) => {
      const object = root.objects.get(item.objectId);
      if (!object) throw new ThreeMfArchiveError("build item sin objeto");
      if (!object.components) return { objectId: item.objectId, parts: null };
      const objectExtruder = settings.objectExtruder.get(item.objectId) ?? null;
      return {
        objectId: item.objectId,
        parts: object.components.map((component) => ({
          partId: component.objectId,
          path: component.path,
          extruder: settings.partExtruder.get(component.objectId) ?? objectExtruder,
        })),
      };
    });

    // instancia (object_id, instance_id) -> n-ésimo build item con ese objectid.
    const itemsByObject = new Map<string, number[]>();
    buildItems.forEach((item, index) => {
      const list = itemsByObject.get(item.objectId) ?? [];
      list.push(index);
      itemsByObject.set(item.objectId, list);
    });

    const assigned = new Set<number>();
    const seenPlateIds = new Set<number>();
    const plates: { plateId: number; itemIndices: number[] }[] = [];
    for (const plate of settings.plates) {
      if (seenPlateIds.has(plate.plateId)) return generic("plater-id-duplicado");
      seenPlateIds.add(plate.plateId);
      const itemIndices: number[] = [];
      for (const instance of plate.instances) {
        const index = itemsByObject.get(instance.objectId)?.[instance.instanceId];
        if (index === undefined) return generic("instancia-sin-build-item");
        if (assigned.has(index)) return generic("item-en-dos-plates");
        assigned.add(index);
        itemIndices.push(index);
      }
      if (itemIndices.length > 0) plates.push({ plateId: plate.plateId, itemIndices: itemIndices.sort((a, b) => a - b) });
    }
    if (plates.length === 0) return generic("plates-vacias");
    if (assigned.size !== buildItems.length) return generic("items-fuera-de-plates");
    plates.sort((a, b) => a.plateId - b.plateId);

    const filamentColors = files[projectPath] && files[projectPath].length <= THREE_MF_LIMITS.maxConfigBytes
      ? parseFilamentColors(bytesToText(files[projectPath]))
      : [];

    return { kind: "slicer", slicer, application: root.application, rootModelPath, buildItems, plates, filamentColors };
  } catch (error) {
    return generic(error instanceof Error ? error.message : "error-inspeccion");
  }
}

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const first = needle.charCodeAt(0);
  const last = bytes.length - needle.length;
  let index = bytes.indexOf(first);
  while (index !== -1 && index <= last) {
    let ok = true;
    for (let k = 1; k < needle.length; k += 1) {
      if (bytes[index + k] !== needle.charCodeAt(k)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
    index = bytes.indexOf(first, index + 1);
  }
  return false;
}

/**
 * Paths de sub-modelo (o del modelo raíz para mallas inline) cuyas triángulos traen `paint_color`
 * (pintura multicolor por facetas de Bambu/Orca). Esa codificación NO se interpreta: las piezas
 * afectadas se muestran en neutro. Un sub-modelo ilegible o demasiado grande cuenta como pintado
 * (el fallback correcto es neutro, no un color inventado).
 */
export function findPaintedModelPaths(
  buffer: ArrayBuffer,
  unzip: UnzipSync,
  rootModelPath: string,
  paths: readonly (string | null)[],
): Set<string | null> {
  const painted = new Set<string | null>();
  for (const path of new Set(paths)) {
    const entry = path ?? rootModelPath;
    try {
      const bytes = readEntries(buffer, unzip, [entry], THREE_MF_LIMITS.maxScanBytes)[entry];
      if (!bytes || containsAscii(bytes, "paint_color=")) painted.add(path);
    } catch {
      painted.add(path);
    }
  }
  return painted;
}
