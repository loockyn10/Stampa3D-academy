/**
 * Aviso informativo para "Registrar producción" (P2-13).
 *
 * Regla comercial: cada elemento del lote es una unidad física adicional que se va a fabricar, así que un producto
 * completo y una de sus partes sueltas consumen filamento por separado. NO es un doble conteo: este módulo solo
 * detecta el caso para avisarlo y evitar confusiones. No modifica ningún cálculo ni bloquea nada.
 */

export interface ProductionCartLine {
  type: "product" | "component";
  product?: { id?: string | null; name?: string | null } | null;
  component?: { id?: string | null; name?: string | null } | null;
}

export interface ProductionOverlap {
  productName: string;
  componentNames: string[];
}

/** Productos del lote que también tienen una de sus partes cargada como línea aparte. */
export function findProductComponentOverlaps(cart: readonly ProductionCartLine[]): ProductionOverlap[] {
  const productLines = cart.filter((line) => line.type === "product" && line.product?.id);
  const overlaps: ProductionOverlap[] = [];

  for (const productLine of productLines) {
    const productId = productLine.product?.id;
    const names = new Set<string>();
    for (const line of cart) {
      if (line.type !== "component" || !line.component?.id) continue;
      if (line.product?.id !== productId) continue;
      names.add(line.component.name?.trim() || "una parte");
    }
    if (names.size > 0) {
      overlaps.push({
        productName: productLine.product?.name?.trim() || "el producto",
        componentNames: [...names],
      });
    }
  }
  return overlaps;
}

export function describeProductionOverlap(overlap: ProductionOverlap): string {
  const parts = overlap.componentNames.join(", ");
  return `Cargaste "${overlap.productName}" y también ${overlap.componentNames.length > 1 ? "sus partes" : "una de sus partes"} (${parts}). Cada línea es una unidad adicional a fabricar, por eso el filamento de esa parte se descuenta en ambas. Si querés producir solo el producto, quitá la parte suelta.`;
}
