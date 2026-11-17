/**
 * Componentes de UN producto o cálculo (D059). Tres conceptos:
 *
 *  A. Componentes predeterminados del tipo  → `calculator_product_type_supplies` (se configuran una vez).
 *  B. Componentes específicos del producto  → ajustes guardados con el producto (`supply_adjustments`):
 *       - "override": otra cantidad/unidad para un componente predeterminado (2 focos en vez de 1);
 *       - "removed":  quita un componente predeterminado solo para este producto;
 *       - "extra":    agrega un insumo del catálogo que el tipo no trae.
 *     Nunca modifican el tipo ni otros productos.
 *  C. Gastos adicionales personalizados      → ver custom-expenses.ts.
 *
 * El costo SIEMPRE sale del catálogo actual (actualización centralizada). Cada insumo aparece una sola vez
 * (por id), así que un componente no puede contarse dos veces. Puro: sin React ni Supabase.
 */
import {
  areUnitsCompatible,
  buildProductTypeSupplyLines,
  convertQuantity,
  isSupplyCategory,
  isSupplyUnit,
  priceSupplyLines,
  readSupplySnapshotLines,
  SUPPLY_LIMITS,
  type CalculatorSupplyRecord,
  type ProductTypeSupplyRecord,
  type SupplyLineInput,
  type SupplyLinesPricing,
  type SupplyUnit,
} from "./supplies";

export const SUPPLY_ADJUSTMENTS_VERSION = 1;
export const SUPPLY_ADJUSTMENT_KINDS = ["override", "removed", "extra"] as const;
export type SupplyAdjustmentKind = (typeof SUPPLY_ADJUSTMENT_KINDS)[number];

export interface SupplyAdjustment {
  supply_id: string;
  kind: SupplyAdjustmentKind;
  /** Solo para "override" y "extra". */
  quantity?: number;
  quantity_unit?: SupplyUnit;
}

/** Forma persistida dentro de `calculation_snapshot.supply_adjustments`. */
export interface SupplyAdjustmentsSnapshot {
  version: number;
  items: SupplyAdjustment[];
}

export type SupplyLineOrigin = "type" | "product";

export interface ResolvedSupplyLine extends SupplyLineInput {
  /** "type": predeterminado del tipo; "product": agregado solo a este producto. */
  origin: SupplyLineOrigin;
  /** true si la cantidad difiere de la del tipo (override). */
  adjusted: boolean;
  /** Cantidad y unidad del tipo, para mostrar «(tipo: 1 u.)» y poder restaurar. */
  defaultQuantity?: number;
  defaultUnit?: SupplyUnit;
  /** El insumo ya no está en el catálogo: se conserva el costo guardado (nunca se pierde un costo). */
  missing?: boolean;
}

export interface RemovedDefaultSupply {
  supplyId: string;
  name: string;
}

export interface ProductSupplyResolution {
  lines: ResolvedSupplyLine[];
  /** Predeterminados del tipo quitados para este producto (para ofrecer «Restaurar»). */
  removed: RemovedDefaultSupply[];
  /** Ajustes vigentes para el tipo actual (sin overrides/quitas de insumos que el tipo ya no tiene). */
  adjustments: SupplyAdjustment[];
}

function positive(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > SUPPLY_LIMITS.maxQuantity) return null;
  return Math.round(parsed * 10_000) / 10_000;
}

/**
 * Lee defensivamente los ajustes (snapshot JSON o estado de la UI). Acepta la forma `{version, items}` o un
 * array. Un insumo aparece una sola vez: si se repite, gana el último. Descarta filas inválidas.
 */
export function normalizeSupplyAdjustments(value: unknown): SupplyAdjustment[] {
  const rawItems = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : [];
  const bySupply = new Map<string, SupplyAdjustment>();
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const supplyId = typeof row.supply_id === "string" ? row.supply_id.trim() : "";
    const kind = row.kind;
    if (!supplyId || !(SUPPLY_ADJUSTMENT_KINDS as readonly unknown[]).includes(kind)) continue;
    if (kind === "removed") {
      bySupply.delete(supplyId);
      bySupply.set(supplyId, { supply_id: supplyId, kind: "removed" });
      continue;
    }
    const quantity = positive(row.quantity);
    if (quantity === null || !isSupplyUnit(row.quantity_unit)) continue;
    bySupply.delete(supplyId);
    bySupply.set(supplyId, { supply_id: supplyId, kind: kind as "override" | "extra", quantity, quantity_unit: row.quantity_unit });
  }
  return [...bySupply.values()];
}

export function toSupplyAdjustmentsSnapshot(adjustments: SupplyAdjustment[]): SupplyAdjustmentsSnapshot {
  return { version: SUPPLY_ADJUSTMENTS_VERSION, items: normalizeSupplyAdjustments(adjustments) };
}

interface ResolveInput {
  productTypeId: string | null | undefined;
  associations: ProductTypeSupplyRecord[];
  supplies: CalculatorSupplyRecord[];
  adjustments?: unknown;
  /** Líneas congeladas del snapshot: solo se usan si un insumo agregado al producto ya no existe. */
  snapshotSupplies?: unknown;
}

/**
 * Componentes efectivos de un producto: predeterminados del tipo + ajustes del producto, costeados con el
 * catálogo actual. Reglas:
 *  - un override/quita de un insumo que el tipo ya no tiene se ignora (cambiar de tipo usa los del tipo nuevo);
 *  - un "extra" de un insumo que el tipo también trae no se suma dos veces: su cantidad reemplaza a la del tipo;
 *  - un "extra" cuyo insumo se eliminó del catálogo conserva el costo guardado en el snapshot.
 */
export function resolveProductSupplyLines({
  productTypeId,
  associations,
  supplies,
  adjustments,
  snapshotSupplies,
}: ResolveInput): ProductSupplyResolution {
  const items = normalizeSupplyAdjustments(adjustments);
  const byId = new Map(items.map((item) => [item.supply_id, item]));
  const suppliesById = new Map(supplies.map((supply) => [supply.id, supply]));
  const defaults = buildProductTypeSupplyLines(productTypeId, associations, supplies);
  const defaultIds = new Set(defaults.map((line) => line.supplyId));

  const lines: ResolvedSupplyLine[] = [];
  const removed: RemovedDefaultSupply[] = [];
  for (const line of defaults) {
    const adjustment = byId.get(line.supplyId);
    if (adjustment?.kind === "removed") {
      removed.push({ supplyId: line.supplyId, name: line.name });
      continue;
    }
    const custom = adjustment && adjustment.quantity_unit && areUnitsCompatible(adjustment.quantity_unit, line.supplyUnit)
      ? adjustment
      : null;
    const adjusted = Boolean(custom) && !sameQuantity(custom!.quantity!, custom!.quantity_unit!, line.quantity, line.quantityUnit);
    lines.push({
      ...line,
      quantity: custom?.quantity ?? line.quantity,
      quantityUnit: custom?.quantity_unit ?? line.quantityUnit,
      origin: "type",
      adjusted,
      defaultQuantity: line.quantity,
      defaultUnit: line.quantityUnit,
    });
  }

  const frozen = new Map(readSupplySnapshotLines(snapshotSupplies).map((line) => [line.supplyId, line]));
  for (const item of items) {
    if (item.kind !== "extra" || defaultIds.has(item.supply_id)) continue;
    const supply = suppliesById.get(item.supply_id);
    if (supply && isSupplyUnit(supply.unit)) {
      if (!item.quantity_unit || !areUnitsCompatible(item.quantity_unit, supply.unit)) continue;
      lines.push({
        supplyId: supply.id,
        name: supply.name,
        category: isSupplyCategory(supply.category) ? supply.category : "component",
        quantity: item.quantity!,
        quantityUnit: item.quantity_unit,
        supplyUnit: supply.unit,
        customUnitLabel: supply.custom_unit_label ?? null,
        unitCost: Math.max(0, Number(supply.unit_cost) || 0),
        archived: Boolean(supply.archived_at),
        origin: "product",
        adjusted: false,
      });
      continue;
    }
    const kept = frozen.get(item.supply_id);
    if (kept && item.quantity_unit && areUnitsCompatible(item.quantity_unit, kept.supplyUnit)) {
      lines.push({ ...kept, quantity: item.quantity!, quantityUnit: item.quantity_unit, origin: "product", adjusted: false, missing: true });
    }
  }

  // Ajustes vigentes: sin overrides/quitas de insumos que el tipo ya no trae, ni overrides iguales al tipo.
  const effective = items.filter((item) => {
    if (item.kind === "extra") return true;
    if (!defaultIds.has(item.supply_id)) return false;
    if (item.kind === "override") return lines.some((line) => line.supplyId === item.supply_id && line.adjusted);
    return true;
  });

  return { lines, removed, adjustments: effective };
}

function sameQuantity(quantityA: number, unitA: SupplyUnit, quantityB: number, unitB: SupplyUnit): boolean {
  const converted = convertQuantity(quantityA, unitA, unitB);
  return converted !== null && Math.abs(converted - quantityB) < 1e-9;
}

/** Costea las líneas resueltas (mismo costeo que el resto de la Calculadora). */
export function priceResolvedSupplyLines(lines: ResolvedSupplyLine[]): SupplyLinesPricing & { lines: Array<ResolvedSupplyLine & { quantityInSupplyUnit: number; cost: number; valid: boolean }> } {
  const pricing = priceSupplyLines(lines);
  return {
    ...pricing,
    lines: pricing.lines.map((priced, index) => ({ ...lines[index], ...priced })),
  };
}

// ---------------------------------------------------------------------------------------------
// Operaciones de la UI (inmutables): devuelven la nueva lista de ajustes.
// ---------------------------------------------------------------------------------------------

function upsert(adjustments: SupplyAdjustment[], next: SupplyAdjustment): SupplyAdjustment[] {
  return [...normalizeSupplyAdjustments(adjustments).filter((item) => item.supply_id !== next.supply_id), next];
}

function withoutSupply(adjustments: SupplyAdjustment[], supplyId: string): SupplyAdjustment[] {
  return normalizeSupplyAdjustments(adjustments).filter((item) => item.supply_id !== supplyId);
}

/** Cambia la cantidad de una línea solo para este producto. Volver a la cantidad del tipo borra el override. */
export function setSupplyLineQuantity(
  adjustments: SupplyAdjustment[],
  line: Pick<ResolvedSupplyLine, "supplyId" | "origin" | "defaultQuantity" | "defaultUnit" | "supplyUnit">,
  quantity: number,
  quantityUnit: SupplyUnit,
): SupplyAdjustment[] {
  if (positive(quantity) === null || !areUnitsCompatible(quantityUnit, line.supplyUnit)) return normalizeSupplyAdjustments(adjustments);
  if (line.origin === "type") {
    if (line.defaultQuantity !== undefined && line.defaultUnit && sameQuantity(quantity, quantityUnit, line.defaultQuantity, line.defaultUnit)) {
      return withoutSupply(adjustments, line.supplyId);
    }
    return upsert(adjustments, { supply_id: line.supplyId, kind: "override", quantity, quantity_unit: quantityUnit });
  }
  return upsert(adjustments, { supply_id: line.supplyId, kind: "extra", quantity, quantity_unit: quantityUnit });
}

/** Quita una línea de este producto: un predeterminado queda marcado como quitado; un agregado se borra. */
export function removeSupplyLine(adjustments: SupplyAdjustment[], line: Pick<ResolvedSupplyLine, "supplyId" | "origin">): SupplyAdjustment[] {
  return line.origin === "type"
    ? upsert(adjustments, { supply_id: line.supplyId, kind: "removed" })
    : withoutSupply(adjustments, line.supplyId);
}

/** Vuelve a la configuración del tipo (deshace override o quita). */
export function restoreDefaultSupply(adjustments: SupplyAdjustment[], supplyId: string): SupplyAdjustment[] {
  return withoutSupply(adjustments, supplyId);
}

/** Agrega un insumo del catálogo solo a este producto. Si el tipo ya lo trae, ajusta su cantidad (sin duplicar). */
export function addProductSupply(
  adjustments: SupplyAdjustment[],
  supplyId: string,
  quantity: number,
  quantityUnit: SupplyUnit,
  isTypeDefault = false,
): SupplyAdjustment[] {
  if (positive(quantity) === null) return normalizeSupplyAdjustments(adjustments);
  return upsert(adjustments, { supply_id: supplyId, kind: isTypeDefault ? "override" : "extra", quantity, quantity_unit: quantityUnit });
}

// ---------------------------------------------------------------------------------------------
// Comparación con lo guardado (Mi Taller: detectar productos desactualizados).
// ---------------------------------------------------------------------------------------------

/** Cantidad de cada insumo expresada en su unidad de costo (para comparar sin importar kg/g). */
function quantitiesBySupply(lines: Array<{ supplyId: string; quantity: number; quantityUnit: SupplyUnit; supplyUnit: SupplyUnit }>) {
  const result = new Map<string, number>();
  for (const line of lines) {
    const converted = convertQuantity(line.quantity, line.quantityUnit, line.supplyUnit);
    if (converted !== null) result.set(line.supplyId, converted);
  }
  return result;
}

/**
 * true si los componentes que el producto usaría hoy (tipo actual + ajustes) difieren de los guardados en su
 * snapshot: se agregaron/quitaron componentes o cambió una cantidad. Los cambios de COSTO se detectan aparte.
 */
export function supplyCompositionChanged(saved: unknown, current: ResolvedSupplyLine[]): boolean {
  const before = quantitiesBySupply(readSupplySnapshotLines(saved));
  const after = quantitiesBySupply(current);
  if (before.size !== after.size) return true;
  for (const [supplyId, quantity] of after) {
    const previous = before.get(supplyId);
    if (previous === undefined || Math.abs(previous - quantity) > 1e-6) return true;
  }
  return false;
}
