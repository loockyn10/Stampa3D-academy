import type { Artwork } from "@/lib/maker/mugs/decorations/artwork";
import { createDecorationEvaluator, resolveDecorations } from "@/lib/maker/mugs/decorations/evaluator";
import { MUG_QUALITY, planMugBody } from "@/lib/maker/mugs/body/createMugBody";
import { indexedBounds, meshToSoup, newMesh, signedVolume, translateMesh, type IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";
import { revolveProfile } from "@/lib/maker/mugs/geometry/revolveProfile";
import { buildHandle, planHandleAttachments } from "@/lib/maker/mugs/handle/createHandle";
import { capacityMl } from "@/lib/maker/mugs/metrics/capacity";
import type { MugDecoration, MugDefinition, MugIssue, MugMetrics, MugQuality } from "@/lib/maker/mugs/types";
import { validateMug } from "@/lib/maker/mugs/validation/validateMug";
import type { LetterGeometryResult, TriangleSoupData } from "@/lib/maker/types";
import type { PrinterProfile } from "@/lib/maker/printBed/printerProfiles";

export interface MugResult {
  /** Malla lista para MakerViewport / Vista Cama / exportWord (una sola pieza "body"); null si hay errores. */
  geometry: LetterGeometryResult | null;
  /** Malla indexada final (misma que `geometry`): para tests y chequeos topológicos. */
  indexed: IndexedMesh | null;
  /** Cuerpo del inserto (solo modo "insert-shell"). SOLO visual: NO forma parte de `geometry` ni del STL. */
  insertHelper: TriangleSoupData | null;
  metrics: MugMetrics | null;
  errors: MugIssue[];
  warnings: MugIssue[];
}

export interface CreateMugOptions {
  quality?: MugQuality;
  printer?: PrinterProfile;
  /**
   * Arte ya preparado de cada decoración (texto/SVG/imagen -> Artwork, ver decorations/artwork.ts). `key` identifica
   * el contenido para el cache de campos. Sin proveedor, las decoraciones habilitadas se omiten con un warning.
   */
  artwork?: { get: (d: MugDecoration) => Artwork | null; key: (d: MugDecoration) => string };
}

/** Detalle de la decoración: resolución del campo (mm/px) y paso máximo de la malla (mm). */
export const DECORATION_DETAIL = { preview: { fieldMm: 0.5, meshStepMm: 1.2 }, export: { fieldMm: 0.25, meshStepMm: 0.55 } } as const;

/**
 * Pipeline completo: MugDefinition -> validación -> perfil 2D -> revolución (con ventanas de unión) -> asa (loft
 * pegado a esas ventanas) -> malla única cerrada. Todo sale de la definición; ni la UI ni un preset arman geometría.
 * El origen se traslada para que X/Y mínimos sean 0 y la base apoye en Z = 0 (STL en coordenadas positivas).
 */
export function createMug(def: MugDefinition, opts: CreateMugOptions = {}): MugResult {
  const quality = opts.quality ?? "preview";
  const { errors, warnings } = validateMug(def, opts.printer, opts.artwork?.get);
  if (errors.length > 0) return { geometry: null, indexed: null, insertHelper: null, metrics: null, errors, warnings };

  // Decoraciones: arte (cacheado) -> campo 2D -> evaluador de desplazamiento radial, integrado al construir el cuerpo.
  const detail = DECORATION_DETAIL[quality];
  const { resolved, missing } = resolveDecorations(def.decorations, opts.artwork?.get ?? (() => null), detail.fieldMm, opts.artwork?.key ?? ((d) => d.id));
  for (const d of missing) warnings.push({ code: "DECO_ART_MISSING", message: `${d.name}: no se pudo preparar el arte (archivo, texto o fuente no disponible); se omite.`, field: `decoration:${d.id}:source` });
  const plan = planMugBody(def, quality, resolved.length > 0 ? { detailStepMm: detail.meshStepMm, decorate: (surface) => createDecorationEvaluator(resolved, surface) } : {});
  const att = def.handle.enabled ? planHandleAttachments(def, plan) : null;
  const mesh = newMesh();
  const body = revolveProfile(mesh, plan.profile, { segments: plan.segments, radiusAt: plan.radiusAt, skipQuad: att?.skipQuad });

  let maxR = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) maxR = Math.max(maxR, Math.hypot(mesh.positions[i], mesh.positions[i + 1]));
  if (att) buildHandle(mesh, body, plan, att, MUG_QUALITY[quality].pathStepMm);

  const b = indexedBounds(mesh);
  const shiftX = -b.minX, shiftY = -b.minY;
  translateMesh(mesh, shiftX, shiftY, 0);

  let insertHelper: TriangleSoupData | null = null;
  if (def.mode === "insert-shell") {
    const rb = def.insert.bottomDiameterMm / 2, rt = def.insert.topDiameterMm / 2;
    const h = newMesh();
    revolveProfile(h, [{ r: 0, z: def.bottomThicknessMm }, { r: rb, z: def.bottomThicknessMm }, { r: rt, z: def.bottomThicknessMm + def.insert.heightMm }, { r: 0, z: def.bottomThicknessMm + def.insert.heightMm }], { segments: MUG_QUALITY[quality].segments });
    translateMesh(h, shiftX, shiftY, 0);
    insertHelper = meshToSoup(h);
  }

  const soup = meshToSoup(mesh);
  const bb = { width: b.maxX - b.minX, depth: b.maxY - b.minY, height: b.maxZ - b.minZ };
  const metrics: MugMetrics = {
    heightMm: plan.heightMm,
    maxDiameterMm: 2 * maxR,
    capacityMl: capacityMl(plan.innerPoints),
    materialVolumeCm3: signedVolume(mesh) / 1000,
    interior: { bottomDiameterMm: 2 * plan.interior.bottomRadius, topDiameterMm: 2 * plan.interior.topRadius },
    triangleCount: soup.triangleCount,
    boundingBox: bb,
  };
  const geometry: LetterGeometryResult = {
    parts: [{ kind: "body", filenameSuffix: "jarro", mesh: soup }],
    triangleCount: soup.triangleCount,
    boundingBox: bb,
    errors: [],
    warnings: [],
    letters: [],
    designCenter: { x: bb.width / 2, y: bb.depth / 2 },
    backCutoutSafeZone: null,
    installation: null,
    installationParts: [],
  };
  return { geometry, indexed: mesh, insertHelper, metrics, errors, warnings };
}
