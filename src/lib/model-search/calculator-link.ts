import type { ModelSearchResult } from "./types";
import { CONTROL_CHARS } from "./sanitize";

/**
 * Enlace "Calcular en Stampa": abre el ÚNICO motor de la Calculadora con el nombre del modelo prellenado.
 * No se asumen peso, tiempo ni material: la fuente no los informa de forma confiable.
 * Mejora futura: conservar `source` + `originalUrl` cuando el modelo de producto tenga un lugar para metadata externa.
 */
export const CALCULATOR_PREFILL_NAME_MAX = 120;

export function buildCalculatorLink(result: Pick<ModelSearchResult, "title">): string {
  const params = new URLSearchParams({
    action: "calculate",
    name: result.title.slice(0, CALCULATOR_PREFILL_NAME_MAX),
  });
  return `/calculadora?${params.toString()}`;
}

export function parseCalculatorPrefillName(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, CALCULATOR_PREFILL_NAME_MAX) : null;
}
