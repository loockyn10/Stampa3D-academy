import type { MugDecorationMode, MugDecorationSource, MugDefinition, MugMedallionShape, MugTextAlign } from "@/lib/maker/mugs/types";
import type { MakerFontId } from "@/lib/maker/types";

/** Versión del contrato de la propuesta IA. Subir al cambiar el schema (propuestas viejas siguen siendo legibles). */
export const MUG_AI_SCHEMA_VERSION = 1;

/** "full": diseño desde cero (parte de los defaults). "patch": cambia solo lo pedido sobre la definición actual. */
export type MugAiMode = "full" | "patch";

type Part<T> = { [K in keyof T]?: T[K] };

/** Subconjunto de `MugDefinition` que la IA puede tocar (sin decoraciones: esas van por operaciones). */
export interface MugPatch extends Part<Omit<MugDefinition, "decorations" | "surface" | "grooves" | "bands" | "handle" | "insert">> {
  surface?: Part<MugDefinition["surface"]>;
  grooves?: Part<MugDefinition["grooves"]>;
  bands?: Part<MugDefinition["bands"]>;
  handle?: Part<MugDefinition["handle"]>;
  insert?: Part<MugDefinition["insert"]>;
}

/** Campos de una decoración propuesta (ya saneados). `source: null` = falta elegir el archivo (ver `needsAssetChoice`). */
export interface ProposedDecoration {
  name?: string;
  enabled?: boolean;
  source?: MugDecorationSource | null;
  mode?: MugDecorationMode;
  angleDeg?: number;
  centerZMm?: number;
  widthMm?: number;
  heightMm?: number;
  rotationDeg?: number;
  depthMm?: number;
  medallionShape?: MugMedallionShape;
  medallionBaseDepthMm?: number;
  medallionPaddingMm?: number;
  fontId?: MakerFontId;
  align?: MugTextAlign;
}

export type MugDecorationOp =
  | { op: "add"; decoration: ProposedDecoration; /** true: hay varios archivos y el modelo no supo cuál: el usuario debe elegir. */ needsAssetChoice?: boolean }
  | { op: "update"; targetId: string; changes: ProposedDecoration; needsAssetChoice?: boolean }
  | { op: "remove"; targetId: string };

/**
 * Propuesta de diseño YA SANEADA (única forma en que la salida de la IA llega al resto de la app). No contiene
 * geometría: solo parámetros del motor determinístico. `applyMugDesignProposal` la convierte en `MugDefinition`.
 */
export interface MugDesignProposal {
  aiDesignSchemaVersion: number;
  mode: MugAiMode;
  name: string;
  description: string;
  mugPatch: MugPatch;
  /** Full design conserva las decoraciones actuales salvo que esto sea true (el usuario pidió reemplazarlas). */
  replaceDecorations: boolean;
  decorationOps: MugDecorationOp[];
  warnings: string[];
  unsupportedRequests: string[];
}

/** Archivo ya cargado en el proyecto (nunca se envía su contenido al modelo: solo id, tipo y nombre). */
export interface MugAiAssetInfo {
  id: string;
  kind: "svg" | "png" | "jpg";
  fileName: string;
}

export interface MugDesignRequest {
  mode: MugAiMode;
  prompt: string;
  current: MugDefinition;
  assets: MugAiAssetInfo[];
}

export type MugAiErrorCode = "auth" | "membership" | "rate_limit" | "prompt" | "unavailable" | "timeout" | "invalid" | "unknown";

export type MugDesignResult =
  | { ok: true; proposal: MugDesignProposal; aiDesignSchemaVersion: number }
  | { ok: false; code: MugAiErrorCode; message: string };
