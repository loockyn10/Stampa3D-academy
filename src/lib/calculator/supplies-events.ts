/**
 * Sincronización del catálogo de insumos entre pantallas abiertas (D059): Calculadora, modal de Ajustes,
 * /configuracion (Tipos de producto + Insumos) y Mi Taller. Quien guarda un cambio (crear, editar, archivar,
 * eliminar un insumo o cambiar los componentes de un tipo) avisa; los demás recargan desde la base, así
 * nunca hace falta recargar la página y no se duplican filas (la fuente de verdad sigue siendo Supabase).
 */
export const CALCULATOR_SUPPLIES_CHANGED_EVENT = "stampa:calculator-supplies-changed";

export interface CalculatorSuppliesChangedDetail {
  /** Identifica a quien emitió el aviso, para que no se recargue a sí mismo. */
  source: string;
}

export function notifyCalculatorSuppliesChanged(source: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CalculatorSuppliesChangedDetail>(CALCULATOR_SUPPLIES_CHANGED_EVENT, { detail: { source } }));
}

/** Suscribe un handler; devuelve la función para desuscribirse (usar en el cleanup de un efecto). */
export function subscribeCalculatorSuppliesChanged(
  handler: (detail: CalculatorSuppliesChangedDetail) => void,
  ignoreSource?: string,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<CalculatorSuppliesChangedDetail>).detail ?? { source: "" };
    if (ignoreSource && detail.source === ignoreSource) return;
    handler(detail);
  };
  window.addEventListener(CALCULATOR_SUPPLIES_CHANGED_EVENT, listener);
  return () => window.removeEventListener(CALCULATOR_SUPPLIES_CHANGED_EVENT, listener);
}
