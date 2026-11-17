/**
 * Catálogo personal de insumos de la Calculadora (componentes y embalaje).
 *
 * Módulo puro (sin dependencias en runtime): unidades, conversión, validación y costo de cada línea.
 * La base de datos replica las mismas reglas (`calculator_unit_dimension`, checks y triggers de
 * 20261117120000_calculator_supplies.sql), así que un dato inválido no entra aunque no venga de la app.
 */

export const SUPPLY_UNITS = ["unit", "m", "cm", "kg", "g", "l", "ml", "custom"] as const;
export type SupplyUnit = (typeof SUPPLY_UNITS)[number];

export type SupplyDimension = "count" | "length" | "mass" | "volume" | "custom";

export const SUPPLY_CATEGORIES = ["component", "packaging"] as const;
export type SupplyCategory = (typeof SUPPLY_CATEGORIES)[number];

export const SUPPLY_CATEGORY_LABELS: Record<SupplyCategory, string> = {
  component: "Componente",
  packaging: "Embalaje",
};

interface SupplyUnitInfo {
  label: string;
  /** Abreviatura para cantidades ("1,5 m"). */
  short: string;
  dimension: SupplyDimension;
  /**
   * Factor entero hacia la unidad más chica de su dimensión (cm, g, ml). Enteros para que
   * 100 g → kg sea 100 × 1 / 1000 = 0,1 exacto y no arrastre errores de 0,001 en binario.
   */
  factor: number;
}

export const SUPPLY_UNIT_INFO: Record<SupplyUnit, SupplyUnitInfo> = {
  unit: { label: "Unidad", short: "u.", dimension: "count", factor: 1 },
  m: { label: "Metro", short: "m", dimension: "length", factor: 100 },
  cm: { label: "Centímetro", short: "cm", dimension: "length", factor: 1 },
  kg: { label: "Kilogramo", short: "kg", dimension: "mass", factor: 1000 },
  g: { label: "Gramo", short: "g", dimension: "mass", factor: 1 },
  l: { label: "Litro", short: "l", dimension: "volume", factor: 1000 },
  ml: { label: "Mililitro", short: "ml", dimension: "volume", factor: 1 },
  custom: { label: "Personalizada", short: "", dimension: "custom", factor: 1 },
};

/** Límites alineados con los CHECK de la base. */
export const SUPPLY_LIMITS = {
  nameMaxLength: 80,
  customUnitMaxLength: 20,
  maxUnitCost: 1_000_000_000,
  maxQuantity: 1_000_000,
} as const;

export function isSupplyUnit(value: unknown): value is SupplyUnit {
  return typeof value === "string" && (SUPPLY_UNITS as readonly string[]).includes(value);
}

export function isSupplyCategory(value: unknown): value is SupplyCategory {
  return typeof value === "string" && (SUPPLY_CATEGORIES as readonly string[]).includes(value);
}

export function getUnitDimension(unit: unknown): SupplyDimension | null {
  return isSupplyUnit(unit) ? SUPPLY_UNIT_INFO[unit].dimension : null;
}

/** Unidades en las que se puede expresar una cantidad de un insumo cargado en `unit`. */
export function compatibleUnits(unit: SupplyUnit): SupplyUnit[] {
  const dimension = SUPPLY_UNIT_INFO[unit].dimension;
  return SUPPLY_UNITS.filter((candidate) => SUPPLY_UNIT_INFO[candidate].dimension === dimension);
}

export function areUnitsCompatible(a: unknown, b: unknown): boolean {
  const dimensionA = getUnitDimension(a);
  return dimensionA !== null && dimensionA === getUnitDimension(b);
}

/** Convierte una cantidad entre unidades de la misma dimensión. `null` si no son compatibles. */
export function convertQuantity(quantity: number, from: SupplyUnit, to: SupplyUnit): number | null {
  if (!areUnitsCompatible(from, to) || !Number.isFinite(quantity)) return null;
  if (from === to) return quantity;
  return (quantity * SUPPLY_UNIT_INFO[from].factor) / SUPPLY_UNIT_INFO[to].factor;
}

/** Nombre corto de la unidad para mostrar ("u.", "kg", o la etiqueta personalizada). */
export function unitShortLabel(unit: SupplyUnit, customUnitLabel?: string | null): string {
  if (unit === "custom") return (customUnitLabel || "unidad").trim();
  return SUPPLY_UNIT_INFO[unit].short;
}

/** "$1.500" / "$0,35" (es-AR; hasta 4 decimales para costos por gramo o centímetro). */
export function formatSupplyMoney(value: number, maximumFractionDigits = 2): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `$${safe.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits })}`;
}

export function formatSupplyQuantity(value: number): string {
  return (Number.isFinite(value) ? value : 0).toLocaleString("es-AR", { maximumFractionDigits: 4 });
}

/** "$1.500 / u." · "$450 / m" · "$12 / rollo". */
export function formatUnitCost(unitCost: number, unit: SupplyUnit, customUnitLabel?: string | null): string {
  return `${formatSupplyMoney(unitCost, 4)} / ${unitShortLabel(unit, customUnitLabel)}`;
}

/** "1,5 m × $300 / m" para el detalle de una línea. */
export function describeSupplyLine(line: {
  quantity: number;
  quantityUnit: SupplyUnit;
  supplyUnit: SupplyUnit;
  customUnitLabel?: string | null;
  unitCost: number;
}): string {
  return `${formatSupplyQuantity(line.quantity)} ${unitShortLabel(line.quantityUnit, line.customUnitLabel)} × ${formatUnitCost(line.unitCost, line.supplyUnit, line.customUnitLabel)}`;
}

/** Redondeo al centavo a prueba de 1.005 → 1.00. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Acepta "1,5", "1.5" o " 2 "; devuelve null si no es un número finito. */
export function parseDecimalInput(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(",", ".");
  if (trimmed === "" || !/^-?\d*\.?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeSupplyName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export interface SupplyDraft {
  name: string;
  category: string;
  unit: string;
  customUnitLabel?: string | null;
  unitCost: string | number;
}

export interface ValidSupply {
  name: string;
  category: SupplyCategory;
  unit: SupplyUnit;
  custom_unit_label: string | null;
  unit_cost: number;
}

export type SupplyValidation =
  | { ok: true; value: ValidSupply }
  | { ok: false; errors: Partial<Record<"name" | "category" | "unit" | "customUnitLabel" | "unitCost", string>> };

/** Valida y normaliza un insumo antes de guardarlo (mismas reglas que la base). */
export function validateSupplyDraft(draft: SupplyDraft): SupplyValidation {
  const errors: Partial<Record<"name" | "category" | "unit" | "customUnitLabel" | "unitCost", string>> = {};
  const name = normalizeSupplyName(draft.name ?? "");
  if (!name) errors.name = "Ingresá un nombre.";
  else if (name.length > SUPPLY_LIMITS.nameMaxLength) errors.name = `Máximo ${SUPPLY_LIMITS.nameMaxLength} caracteres.`;

  if (!isSupplyCategory(draft.category)) errors.category = "Elegí si es un componente o un embalaje.";
  if (!isSupplyUnit(draft.unit)) errors.unit = "Elegí una unidad de medida.";

  let customUnitLabel: string | null = null;
  if (draft.unit === "custom") {
    customUnitLabel = normalizeSupplyName(draft.customUnitLabel ?? "");
    if (!customUnitLabel) errors.customUnitLabel = "Escribí el nombre de la unidad (p. ej. «rollo»).";
    else if (customUnitLabel.length > SUPPLY_LIMITS.customUnitMaxLength) {
      errors.customUnitLabel = `Máximo ${SUPPLY_LIMITS.customUnitMaxLength} caracteres.`;
    }
  }

  const unitCost = parseDecimalInput(draft.unitCost === "" ? "0" : draft.unitCost);
  if (unitCost === null) errors.unitCost = "Ingresá un costo válido.";
  else if (unitCost < 0) errors.unitCost = "El costo no puede ser negativo.";
  else if (unitCost > SUPPLY_LIMITS.maxUnitCost) errors.unitCost = "El costo es demasiado alto.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      category: draft.category as SupplyCategory,
      unit: draft.unit as SupplyUnit,
      custom_unit_label: draft.unit === "custom" ? customUnitLabel : null,
      // numeric(14,4) en la base: se guarda con 4 decimales como máximo.
      unit_cost: Math.round((unitCost as number) * 10_000) / 10_000,
    },
  };
}

export type QuantityValidation =
  | { ok: true; quantity: number; unit: SupplyUnit }
  | { ok: false; error: string };

/** Valida la cantidad de un insumo dentro de un tipo de producto (> 0 y en una unidad compatible). */
export function validateSupplyQuantity(
  quantity: string | number,
  quantityUnit: string,
  supplyUnit: SupplyUnit,
): QuantityValidation {
  const parsed = parseDecimalInput(quantity);
  if (parsed === null) return { ok: false, error: "Ingresá una cantidad válida." };
  if (parsed <= 0) return { ok: false, error: "La cantidad tiene que ser mayor a 0." };
  if (parsed > SUPPLY_LIMITS.maxQuantity) return { ok: false, error: "La cantidad es demasiado alta." };
  if (!isSupplyUnit(quantityUnit) || !areUnitsCompatible(quantityUnit, supplyUnit)) {
    return { ok: false, error: "La unidad no es compatible con la del insumo." };
  }
  const rounded = Math.round(parsed * 10_000) / 10_000;
  if (rounded <= 0) return { ok: false, error: "La cantidad es demasiado chica." };
  return { ok: true, quantity: rounded, unit: quantityUnit };
}

// ---------------------------------------------------------------------------------------------
// Costo de las líneas
// ---------------------------------------------------------------------------------------------

/** Fila del catálogo tal como llega de la base. */
export interface CalculatorSupplyRecord {
  id: string;
  name: string;
  category: string;
  unit: string;
  custom_unit_label?: string | null;
  unit_cost: number | string;
  archived_at?: string | null;
}

/** Asociación tipo de producto ↔ insumo tal como llega de la base. */
export interface ProductTypeSupplyRecord {
  id: string;
  product_type_id: string;
  supply_id: string;
  quantity: number | string;
  quantity_unit: string;
  sort_order?: number | null;
}

export interface SupplyLineInput {
  supplyId: string;
  name: string;
  category: SupplyCategory;
  quantity: number;
  quantityUnit: SupplyUnit;
  supplyUnit: SupplyUnit;
  customUnitLabel?: string | null;
  unitCost: number;
  archived?: boolean;
}

export interface PricedSupplyLine extends SupplyLineInput {
  /** Cantidad expresada en la unidad en la que está cargado el costo. */
  quantityInSupplyUnit: number;
  /** Costo de la línea redondeado al centavo (0 si la línea es inválida). */
  cost: number;
  valid: boolean;
}

export interface SupplyLinesPricing {
  lines: PricedSupplyLine[];
  componentsCost: number;
  packagingCost: number;
  total: number;
  /** Líneas válidas con costo 0: puede faltar cargar el precio. */
  zeroCostCount: number;
  archivedCount: number;
  invalidCount: number;
}

function nonNegative(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function priceSupplyLine(line: SupplyLineInput): PricedSupplyLine {
  const quantity = nonNegative(line.quantity);
  const unitCost = nonNegative(line.unitCost);
  const converted = convertQuantity(quantity, line.quantityUnit, line.supplyUnit);
  const valid = converted !== null && quantity > 0;
  return {
    ...line,
    quantity,
    unitCost,
    quantityInSupplyUnit: converted ?? 0,
    cost: valid ? roundMoney((converted as number) * unitCost) : 0,
    valid,
  };
}

/**
 * Costea las líneas y suma por categoría. Cada línea se redondea al centavo y los totales se
 * acumulan en centavos enteros, así el total coincide siempre con la suma de lo que se muestra.
 */
export function priceSupplyLines(lines: SupplyLineInput[]): SupplyLinesPricing {
  const priced = lines.map(priceSupplyLine);
  let componentsCents = 0;
  let packagingCents = 0;
  let zeroCostCount = 0;
  let archivedCount = 0;
  let invalidCount = 0;
  for (const line of priced) {
    if (line.archived) archivedCount += 1;
    if (!line.valid) {
      invalidCount += 1;
      continue;
    }
    if (line.unitCost === 0) zeroCostCount += 1;
    const cents = Math.round(line.cost * 100);
    if (line.category === "packaging") packagingCents += cents;
    else componentsCents += cents;
  }
  return {
    lines: priced,
    componentsCost: componentsCents / 100,
    packagingCost: packagingCents / 100,
    total: (componentsCents + packagingCents) / 100,
    zeroCostCount,
    archivedCount,
    invalidCount,
  };
}

/**
 * Arma las líneas de un tipo de producto leyendo SIEMPRE el costo actual del catálogo
 * (actualización centralizada). Una asociación cuyo insumo no se encuentra se descarta.
 */
export function buildProductTypeSupplyLines(
  productTypeId: string | null | undefined,
  associations: ProductTypeSupplyRecord[],
  supplies: CalculatorSupplyRecord[],
): SupplyLineInput[] {
  if (!productTypeId) return [];
  const suppliesById = new Map(supplies.map((supply) => [supply.id, supply]));
  return associations
    .filter((association) => association.product_type_id === productTypeId)
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
    .flatMap((association) => {
      const supply = suppliesById.get(association.supply_id);
      if (!supply || !isSupplyUnit(supply.unit) || !isSupplyUnit(association.quantity_unit)) return [];
      return [{
        supplyId: supply.id,
        name: supply.name,
        category: isSupplyCategory(supply.category) ? supply.category : "component",
        quantity: nonNegative(association.quantity),
        quantityUnit: association.quantity_unit,
        supplyUnit: supply.unit,
        customUnitLabel: supply.custom_unit_label ?? null,
        unitCost: nonNegative(supply.unit_cost),
        archived: Boolean(supply.archived_at),
      }];
    });
}

// ---------------------------------------------------------------------------------------------
// Snapshot (productos guardados)
// ---------------------------------------------------------------------------------------------

export const SUPPLY_SNAPSHOT_VERSION = 1;

export interface SupplySnapshotLine {
  supply_id: string;
  name: string;
  category: SupplyCategory;
  quantity: number;
  quantity_unit: SupplyUnit;
  supply_unit: SupplyUnit;
  custom_unit_label: string | null;
  unit_cost: number;
  cost: number;
  /** D059: "type" (predeterminado del tipo) o "product" (agregado solo a este producto). Ausente en snapshots D057. */
  origin?: "type" | "product";
}

export interface SupplySnapshot {
  version: number;
  lines: SupplySnapshotLine[];
  components_cost: number;
  packaging_cost: number;
  total_cost: number;
}

function isSupplyLineOrigin(value: unknown): value is "type" | "product" {
  return value === "type" || value === "product";
}

/** Origen de una línea resuelta (D059), si lo tiene; las líneas D057 no lo llevan. */
function originOf(line: PricedSupplyLine): { origin?: "type" | "product" } {
  const origin: unknown = (line as PricedSupplyLine & { origin?: unknown }).origin;
  return isSupplyLineOrigin(origin) ? { origin } : {};
}

/** Copia congelada de las líneas usadas en un cálculo guardado (costos al momento de guardar). */
export function toSupplySnapshot(pricing: SupplyLinesPricing): SupplySnapshot {
  return {
    version: SUPPLY_SNAPSHOT_VERSION,
    lines: pricing.lines.filter((line) => line.valid).map((line) => ({
      supply_id: line.supplyId,
      name: line.name,
      category: line.category,
      quantity: line.quantity,
      quantity_unit: line.quantityUnit,
      supply_unit: line.supplyUnit,
      custom_unit_label: line.customUnitLabel ?? null,
      unit_cost: line.unitCost,
      cost: line.cost,
      ...originOf(line),
    })),
    components_cost: pricing.componentsCost,
    packaging_cost: pricing.packagingCost,
    total_cost: pricing.total,
  };
}

/** Lee defensivamente las líneas de un snapshot guardado (JSON de la base). */
export function readSupplySnapshotLines(value: unknown): SupplyLineInput[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const lines = (value as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return [];
  return lines.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const line = raw as Record<string, unknown>;
    if (typeof line.supply_id !== "string" || !isSupplyUnit(line.quantity_unit) || !isSupplyUnit(line.supply_unit)) return [];
    return [{
      supplyId: line.supply_id,
      name: typeof line.name === "string" ? line.name : "Insumo",
      category: isSupplyCategory(line.category) ? line.category : "component",
      quantity: nonNegative(line.quantity),
      quantityUnit: line.quantity_unit,
      supplyUnit: line.supply_unit,
      customUnitLabel: typeof line.custom_unit_label === "string" ? line.custom_unit_label : null,
      unitCost: nonNegative(line.unit_cost),
    }];
  });
}

/**
 * Recalcula las líneas de un producto guardado con los costos ACTUALES del catálogo.
 * Si el insumo ya no existe o cambió a una unidad incompatible, conserva el costo del snapshot
 * (nunca se pierde un costo en silencio).
 */
export function repriceSupplySnapshot(
  snapshotSupplies: unknown,
  currentSupplies?: CalculatorSupplyRecord[] | null,
): SupplyLinesPricing {
  const lines = readSupplySnapshotLines(snapshotSupplies);
  if (!currentSupplies || currentSupplies.length === 0) return priceSupplyLines(lines);
  const byId = new Map(currentSupplies.map((supply) => [supply.id, supply]));
  return priceSupplyLines(lines.map((line) => {
    const current = byId.get(line.supplyId);
    if (!current || !isSupplyUnit(current.unit) || !areUnitsCompatible(current.unit, line.quantityUnit)) return line;
    return {
      ...line,
      name: current.name,
      category: isSupplyCategory(current.category) ? current.category : line.category,
      supplyUnit: current.unit,
      customUnitLabel: current.custom_unit_label ?? null,
      unitCost: nonNegative(current.unit_cost),
      archived: Boolean(current.archived_at),
    };
  }));
}

/** Nombres de los insumos de un snapshot cuyo costo o unidad cambió desde que se guardó. */
export function changedSnapshotSupplies(
  snapshotSupplies: unknown,
  currentSupplies?: CalculatorSupplyRecord[] | null,
): string[] {
  if (!currentSupplies || currentSupplies.length === 0) return [];
  const byId = new Map(currentSupplies.map((supply) => [supply.id, supply]));
  const changed: string[] = [];
  for (const line of readSupplySnapshotLines(snapshotSupplies)) {
    const current = byId.get(line.supplyId);
    if (!current) continue;
    const costChanged = Math.abs(nonNegative(current.unit_cost) - line.unitCost) > 0.00005;
    if (costChanged || current.unit !== line.supplyUnit) changed.push(current.name);
  }
  return changed;
}
