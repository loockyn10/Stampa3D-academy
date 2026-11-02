import type { LampResult } from "@/lib/maker/lamps/types";

/**
 * Qué muestra el visor: la lámpara de los valores actuales; si esos valores tienen errores y hubo una lámpara válida antes, esa última (marcada `outdated`:
 * NO corresponde a los controles) con los errores y avisos ACTUALES, de modo que nada se exporta y el panel explica por qué. Función pura (testeable).
 */
export function selectLampView(computed: LampResult, lastValid: LampResult | null): { result: LampResult; outdated: boolean; outdatedReason: string | null } {
  const outdated = !computed.geometry && !!lastValid;
  const result: LampResult = computed.geometry || !lastValid ? computed : { ...lastValid, errors: computed.errors, warnings: computed.warnings };
  return { result, outdated, outdatedReason: outdated ? (computed.errors[0]?.message ?? null) : null };
}
