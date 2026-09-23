// Tipos de Instalación 0.3 de Neon. Locales a Neon a propósito: no se amplía el
// `InstallationAuxPart`/`kind` compartido de Carteles (`src/lib/maker/types.ts`) — evita
// forzar a los consumidores Carteles-only (p.ej. `exportInstallKit.ts`) a lidiar con un
// valor de `kind` que no les pertenece. `LetterGeometryResult.installationParts` sigue
// vacío para Neon; el resultado Neon expone su propio `auxParts: NeonAuxPart[]`.
import type { Point2D, TriangleSoupData } from "@/lib/maker/types";

export type NeonAuxPartKind = "neonWallClip";

/** Pieza auxiliar (no forma parte del canal): se exporta UNA vez con su cantidad, nunca N archivos idénticos. */
export interface NeonAuxPart {
  kind: NeonAuxPartKind;
  filenameSuffix: string;
  fileBaseName: string;
  mesh: TriangleSoupData;
  quantity: number;
}

/** Parámetros del clip de pared (Secciones 27-34 del pedido). Función pura de esto + `NeonChannelParams`: se regenera solo, sin paso manual. */
export interface NeonWallClipSettings {
  /** Separación entre el canal y la pared (mm): deja lugar al cableado/pass-through detrás. Default 5, rango 0-20. */
  wallGapMm: number;
  /** Holgura TOTAL entre el canal y el bolsillo del clip (mm) — misma convención "total, no por lado" que el resto de Neon. */
  clipClearanceMm: number;
  /** Espesor de las paredes/rieles del clip (mm). */
  clipWallThicknessMm: number;
  /** Cuánto del largo del canal cubre este clip (mm, eje X local). */
  clipDepthMm: number;
  screwShankDiameterMm: number;
  /** 0 = sin rebaje. */
  screwHeadDiameterMm: number;
}

export const DEFAULT_NEON_WALL_CLIP_SETTINGS: NeonWallClipSettings = {
  wallGapMm: 5,
  clipClearanceMm: 0.3,
  clipWallThicknessMm: 1.6,
  clipDepthMm: 10,
  screwShankDiameterMm: 3.5,
  screwHeadDiameterMm: 6.5,
};

export type NeonBridgeMode = "independent" | "bridged";
export type NeonMountMode = "none" | "clips";

/**
 * Receta GLOBAL de instalación (Sección 60 del pedido — CABLEADO/UNIÓN/PARED). Neon
 * todavía no tiene presets (Sección 27.9 de docs/STAMPA_MAKER.md), así que viaja
 * completa en el proyecto — no hace falta el split preset-vs-proyecto de Carteles.
 */
export interface NeonInstallationRecipe {
  wiringEnabled: boolean;
  passThroughWidthMm: number;
  passThroughHeightMm: number;
  endpointInsetMm: number;
  serviceMarginMm: number;
  bridgeMode: NeonBridgeMode;
  bridgeWidthMm: number;
  bridgeLengthWarningMm: number;
  mountMode: NeonMountMode;
  wallGapMm: number;
  clipSpacingMm: number;
  clipClearanceMm: number;
  clipWallThicknessMm: number;
  clipDepthMm: number;
  screwShankDiameterMm: number;
  screwHeadDiameterMm: number;
}

export const DEFAULT_NEON_INSTALLATION_RECIPE: NeonInstallationRecipe = {
  wiringEnabled: false,
  passThroughWidthMm: 5.5,
  passThroughHeightMm: 3.5,
  endpointInsetMm: 10,
  serviceMarginMm: 30,
  bridgeMode: "independent",
  bridgeWidthMm: 6,
  bridgeLengthWarningMm: 250,
  mountMode: "none",
  wallGapMm: DEFAULT_NEON_WALL_CLIP_SETTINGS.wallGapMm,
  clipSpacingMm: 100,
  clipClearanceMm: DEFAULT_NEON_WALL_CLIP_SETTINGS.clipClearanceMm,
  clipWallThicknessMm: DEFAULT_NEON_WALL_CLIP_SETTINGS.clipWallThicknessMm,
  clipDepthMm: DEFAULT_NEON_WALL_CLIP_SETTINGS.clipDepthMm,
  screwShankDiameterMm: DEFAULT_NEON_WALL_CLIP_SETTINGS.screwShankDiameterMm,
  screwHeadDiameterMm: DEFAULT_NEON_WALL_CLIP_SETTINGS.screwHeadDiameterMm,
};

/** Override por segmento (Sección 44: "específico del proyecto", nunca en un preset). Keyed por `NeonSegment.id`. */
export interface NeonSegmentOverride {
  /** Presente = fuerza ese valor; ausente = automático. */
  invertedOrientation?: boolean;
  /** Posición manual (mm, mismas coordenadas que el canal) de cada pass-through, si se arrastró. Ausente = automático. */
  passThroughStart?: Point2D;
  passThroughEnd?: Point2D;
}

export interface NeonInstallationOverrides {
  /** Orden manual completo de ids de segmento; null = automático (nearest-neighbor + 2-opt). */
  order: string[] | null;
  segments: Record<string, NeonSegmentOverride>;
}

export const DEFAULT_NEON_INSTALLATION_OVERRIDES: NeonInstallationOverrides = { order: null, segments: {} };

// -------------------------------------------------------------- persistencia (lectura tolerante)

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function numIn(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Lectura tolerante de la receta: cualquier campo ausente/inválido cae al default correspondiente (proyectos viejos sin Instalación 0.3 cargan con todo apagado). */
export function normalizeNeonInstallationRecipe(raw: unknown): NeonInstallationRecipe {
  const r = rec(raw);
  const D = DEFAULT_NEON_INSTALLATION_RECIPE;
  return {
    wiringEnabled: boolOr(r.wiringEnabled, D.wiringEnabled),
    passThroughWidthMm: numIn(r.passThroughWidthMm, 1, 30, D.passThroughWidthMm),
    passThroughHeightMm: numIn(r.passThroughHeightMm, 1, 30, D.passThroughHeightMm),
    endpointInsetMm: numIn(r.endpointInsetMm, 0, 200, D.endpointInsetMm),
    serviceMarginMm: numIn(r.serviceMarginMm, 0, 500, D.serviceMarginMm),
    bridgeMode: r.bridgeMode === "bridged" ? "bridged" : "independent",
    bridgeWidthMm: numIn(r.bridgeWidthMm, 1, 30, D.bridgeWidthMm),
    bridgeLengthWarningMm: numIn(r.bridgeLengthWarningMm, 1, 5000, D.bridgeLengthWarningMm),
    mountMode: r.mountMode === "clips" ? "clips" : "none",
    wallGapMm: numIn(r.wallGapMm, 0, 20, D.wallGapMm),
    clipSpacingMm: numIn(r.clipSpacingMm, 10, 1000, D.clipSpacingMm),
    clipClearanceMm: numIn(r.clipClearanceMm, 0, 5, D.clipClearanceMm),
    clipWallThicknessMm: numIn(r.clipWallThicknessMm, 0.4, 10, D.clipWallThicknessMm),
    clipDepthMm: numIn(r.clipDepthMm, 1, 50, D.clipDepthMm),
    screwShankDiameterMm: numIn(r.screwShankDiameterMm, 0.5, 20, D.screwShankDiameterMm),
    screwHeadDiameterMm: numIn(r.screwHeadDiameterMm, 0, 30, D.screwHeadDiameterMm),
  };
}

function point2D(v: unknown): Point2D | undefined {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number" && Number.isFinite(v[0]) && Number.isFinite(v[1])
    ? [v[0], v[1]]
    : undefined;
}

function normalizeSegmentOverride(raw: unknown): NeonSegmentOverride {
  const r = rec(raw);
  const out: NeonSegmentOverride = {};
  if (typeof r.invertedOrientation === "boolean") out.invertedOrientation = r.invertedOrientation;
  const start = point2D(r.passThroughStart);
  if (start) out.passThroughStart = start;
  const end = point2D(r.passThroughEnd);
  if (end) out.passThroughEnd = end;
  return out;
}

/**
 * Lectura tolerante de los overrides: ids con forma inesperada o valores corruptos se
 * descartan de forma controlada — NUNCA se remapea una posición vieja a un id que no le
 * corresponde (Sección 45/59 del pedido). La reconciliación fina por forma/geometría
 * (`reconcileSegments.ts`) queda para una iteración futura del editor en vivo: hoy el
 * mismo criterio posicional ya usado por `LetterInstance.id` en Carteles alcanza para
 * persistencia (id inexistente en la corrida actual = override ignorado, sin crash).
 */
export function normalizeNeonInstallationOverrides(raw: unknown): NeonInstallationOverrides {
  const r = rec(raw);
  const order = Array.isArray(r.order) && r.order.every((id) => typeof id === "string") ? (r.order as string[]) : null;
  const segmentsRaw = rec(r.segments);
  const segments: Record<string, NeonSegmentOverride> = {};
  for (const [id, value] of Object.entries(segmentsRaw)) {
    const normalized = normalizeSegmentOverride(value);
    if (Object.keys(normalized).length > 0) segments[id] = normalized;
  }
  return { order, segments };
}
