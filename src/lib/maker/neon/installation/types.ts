// Tipos de Instalación 0.3 de Neon. Locales a Neon a propósito: no se amplía el
// `InstallationAuxPart`/`kind` compartido de Carteles (`src/lib/maker/types.ts`) — evita
// forzar a los consumidores Carteles-only (p.ej. `exportInstallKit.ts`) a lidiar con un
// valor de `kind` que no les pertenece. `LetterGeometryResult.installationParts` sigue
// vacío para Neon; el resultado Neon expone su propio `auxParts: NeonAuxPart[]`.
import type { TriangleSoupData } from "@/lib/maker/types";

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
