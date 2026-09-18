import type { ContourGroup, LetterSignParams } from "@/lib/maker/types";
import type { ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";
import { buildStandardBodyPieces, type BuildStandardBodyContext } from "@/lib/maker/geometry/body/standard";
import { buildTaperedBodyPieces } from "@/lib/maker/geometry/body/tapered";

export interface BuildBodyResult {
  body: ExtrudedMeshData;
  fullyEroded: boolean;
}

export type BuildBodyContext = BuildStandardBodyContext;

/**
 * Concepto BODY: arma el sólido de cuerpo de UN carácter a partir de sus
 * contornos crudos (mismos `contourGroups` que también usa `front/`, ver
 * createLetterGeometry.ts). Único `switch (params.bodyType)` de todo el
 * proyecto — agregar un futuro tipo de cuerpo (p.ej. "tapered", 0.4 Etapa
 * 3) es sumar un caso acá, nunca un `if (bodyType === ...)` en otro
 * archivo. Los modificadores de cuerpo (costillas, bisel — 0.4 Etapas 2/4)
 * se aplican después, también desde acá, cada uno en su propio módulo bajo
 * `body/modifiers/`.
 */
export function buildBody(contourGroups: ContourGroup[], params: LetterSignParams, ctx: BuildBodyContext): BuildBodyResult {
  switch (params.bodyType) {
    case "standard":
      return buildStandardBodyPieces(contourGroups, params, ctx);
    case "tapered":
      // Limitación conocida de 0.4: el canal luminoso no se tapa/talla en
      // un cuerpo tapered (combinación fuera de alcance de este sprint,
      // ver docs/STAMPA_MAKER.md) — el cuerpo se genera igual, sin canal.
      return buildTaperedBodyPieces(contourGroups, params);
  }
}
