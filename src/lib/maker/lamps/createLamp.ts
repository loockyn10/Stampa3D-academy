import type { LetterGeometryResult, SignPart, TriangleSoupData } from "@/lib/maker/types";
import type { LampLayout } from "@/lib/maker/lamps/layout";
import { createBaseMesh } from "@/lib/maker/lamps/parts/createBase";
import { createCollarMesh } from "@/lib/maker/lamps/parts/createCollar";
import { createInsertMesh } from "@/lib/maker/lamps/parts/createInsert";
import { createShadeMesh } from "@/lib/maker/lamps/parts/createShade";
import type { ShadeField } from "@/lib/maker/lamps/shade/surface";
import { LAMP_GEOMETRY } from "@/lib/maker/lamps/types";
import type { LampDefinition, LampMetrics, LampPartMetrics, LampResult } from "@/lib/maker/lamps/types";
import { validateLamp } from "@/lib/maker/lamps/validation/validateLamp";
import { analyzeMesh, indexedBounds, meshToSoup, type IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";
import type { PrinterProfile } from "@/lib/maker/printBed/printerProfiles";

export interface CreateLampOptions {
  printer?: PrinterProfile;
}

interface BuiltPart {
  indexed: IndexedMesh;
  soup: TriangleSoupData;
  metrics: LampPartMetrics;
}

/**
 * Cache por pieza (LRU chico): cambiar el espesor del inserto no regenera la pantalla; cambiar el color no regenera
 * nada (el color no es geometría). Las claves incluyen todo lo que la pieza realmente usa, y nada más.
 */
const MAX_CACHED_PARTS = 8;
const partCache = new Map<string, BuiltPart>();

function cached(key: string, build: () => BuiltPart): BuiltPart {
  const hit = partCache.get(key);
  if (hit) {
    partCache.delete(key);
    partCache.set(key, hit);
    return hit;
  }
  const built = build();
  partCache.set(key, built);
  while (partCache.size > MAX_CACHED_PARTS) partCache.delete(partCache.keys().next().value as string);
  return built;
}

/** Vacía el cache de piezas (tests de rendimiento y cambios de motor). */
export function clearLampCaches(): void {
  partCache.clear();
}

function finishPart(indexed: IndexedMesh): BuiltPart {
  const report = analyzeMesh(indexed);
  const b = indexedBounds(indexed);
  const soup = meshToSoup(indexed, 45);
  return {
    indexed,
    soup,
    metrics: {
      triangleCount: report.triangleCount,
      volumeCm3: report.volume / 1000,
      watertight: report.boundaryEdges === 0 && report.nonManifoldEdges === 0 && report.inconsistentEdges === 0 && report.degenerate === 0 && report.nonFinite === 0 && report.volume > 0,
      boundingBox: { width: b.maxX - b.minX, depth: b.maxY - b.minY, height: b.maxZ - b.minZ },
    },
  };
}

/** La pantalla depende de su superficie, de la interfaz roscada y de su posición de ensamblado (la fase de la rosca sale de la z). */
function shadePart(def: LampDefinition, field: ShadeField, layout: LampLayout): BuiltPart {
  return cached(`shade|${JSON.stringify([def.shade, def.thread, layout.ledgeZ, layout.decorZ0])}`, () => finishPart(createShadeMesh(def, field, layout)));
}

function collarPart(def: LampDefinition, layout: LampLayout): BuiltPart {
  return cached(`collar|${JSON.stringify([def.thread, def.shade.bottomDiameterMm, layout.ledgeZ])}`, () => finishPart(createCollarMesh(layout, LAMP_GEOMETRY.femaleSegments)));
}

function insertPart(def: LampDefinition, layout: LampLayout): BuiltPart {
  const { previewColor: _color, enabled: _enabled, ...geometryFields } = def.insert;
  void _color;
  void _enabled;
  return cached(`insert|${JSON.stringify([geometryFields, layout.insert])}`, () => finishPart(createInsertMesh(def, layout)));
}

function basePart(def: LampDefinition, layout: LampLayout): BuiltPart {
  const key = JSON.stringify([
    def.base,
    { ...def.thread, connection: "" }, // la base es la misma para la rosca integrada y para el collar
    def.holder,
    def.cable,
    layout.baseDiameterMm,
    layout.floorTopZ,
    layout.tie,
    layout.insert && { i: layout.insert.innerR, o: layout.insert.outerR },
    def.insert.clearanceMm,
  ]);
  return cached(`base|${key}`, () => finishPart(createBaseMesh(def, layout)));
}

/**
 * Pipeline completo: LampDefinition -> validación (rangos, superficie, encaje, seguridad) -> tres piezas independientes
 * en coordenadas de ENSAMBLADO (base apoyada en Z = 0, eje en X = Y = 0). El visor, la Vista Cama y el STL leen
 * exactamente estas mallas: lo que se ve es lo que se descarga (no hay un segundo nivel de calidad).
 */
export function createLamp(def: LampDefinition, opts: CreateLampOptions = {}): LampResult {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { errors, warnings, field, layout, vase } = validateLamp(def, opts.printer);
  if (errors.length > 0 || !field || !layout || !vase) return { geometry: null, indexed: null, metrics: null, errors, warnings };

  const shade = shadePart(def, field, layout);
  const insert = layout.insert ? insertPart(def, layout) : null;
  const collar = layout.collar ? collarPart(def, layout) : null;
  const base = basePart(def, layout);

  for (const [name, part] of [["la pantalla", shade], ["el inserto", insert], ["el collar", collar], ["la base", base]] as const) {
    if (part && !part.metrics.watertight) errors.push({ code: "MESH_NOT_WATERTIGHT", message: `La malla de ${name} no quedó cerrada: no se exporta. Cambiá levemente los parámetros.` });
  }
  if (errors.length > 0) return { geometry: null, indexed: null, metrics: null, errors, warnings };

  const baseKind = "body" as const; // la base es la pieza ancla del ensamblado (capa 0), igual que el cuerpo de un cartel
  const parts: SignPart[] = [{ kind: baseKind, filenameSuffix: def.holder.measured ? "base" : "base_PRELIMINAR", mesh: base.soup }];
  if (insert) parts.push({ kind: "lampInsert", filenameSuffix: "inserto", mesh: insert.soup });
  if (collar) parts.push({ kind: "lampCollar", filenameSuffix: "collar", mesh: collar.soup });
  parts.push({ kind: "lampShade", filenameSuffix: "pantalla", mesh: shade.soup });

  const all = [base, insert, collar, shade].filter((p): p is BuiltPart => p !== null);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of all) {
    const b = indexedBounds(p.indexed);
    minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
    minZ = Math.min(minZ, b.minZ); maxZ = Math.max(maxZ, b.maxZ);
  }
  const bb = { width: maxX - minX, depth: maxY - minY, height: maxZ - minZ };
  const totalTriangles = all.reduce((s, p) => s + p.metrics.triangleCount, 0);

  const geometry: LetterGeometryResult = {
    parts,
    triangleCount: totalTriangles,
    boundingBox: bb,
    errors: [],
    warnings: [],
    letters: [],
    designCenter: { x: 0, y: 0 },
    backCutoutSafeZone: null,
    installation: null,
    installationParts: [],
  };

  const metrics: LampMetrics = {
    totalHeightMm: bb.height,
    maxDiameterMm: Math.max(bb.width, bb.depth),
    shade: { ...shade.metrics, vase, maxTiltDeg: field.maxTiltDeg, minRidgeRadiusMm: field.minRidgeRadiusMm },
    insert: insert ? { ...insert.metrics, vaseCapable: !def.insert.tabs && Math.round(def.insert.ventNotches) === 0 } : null,
    collar: collar ? collar.metrics : null,
    base: base.metrics,
    totalTriangles,
    generationMs: (typeof performance !== "undefined" ? performance.now() : Date.now()) - started,
    fit: layout.fit,
  };
  return { geometry, indexed: { base: base.indexed, insert: insert?.indexed ?? null, collar: collar?.indexed ?? null, shade: shade.indexed }, metrics, errors, warnings };
}

/** Clave de la GEOMETRÍA de un diseño: el color de la vista previa no es geometría, así que no regenera mallas. */
export function lampGeometryKey(def: LampDefinition): string {
  return JSON.stringify({ ...def, insert: { ...def.insert, previewColor: "" } });
}
