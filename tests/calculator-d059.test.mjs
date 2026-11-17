// D059 — Calculadora V2 completa: componentes predeterminados del tipo + específicos del producto, gastos
// adicionales con nombre, «Desglose de costos» por concepto, Mi Taller con los componentes del tipo y
// sincronización del catálogo. Lógica pura + render del desglose (react-dom/server) + contratos de las pantallas.
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTs, readRepoFile } from "./helpers/load-ts.mjs";

const pricing = loadTs("src/lib/calculator/pricing.ts");
const supplies = loadTs("src/lib/calculator/supplies.ts");
const productSupplies = loadTs("src/lib/calculator/product-supplies.ts");
const expensesLib = loadTs("src/lib/calculator/custom-expenses.ts");
const breakdownLib = loadTs("src/lib/calculator/cost-breakdown.ts");
const { calculateProductPrice } = loadTs("src/lib/products/pricing.ts");
const status = loadTs("src/lib/products/pricing-status.ts");
const guestDraft = loadTs("src/lib/calculator/guest-draft.ts");
const events = loadTs("src/lib/calculator/supplies-events.ts");
const { CostBreakdownTable } = loadTs("src/components/calculadora/cost-breakdown-table.tsx");

const {
  resolveProductSupplyLines,
  priceResolvedSupplyLines,
  normalizeSupplyAdjustments,
  setSupplyLineQuantity,
  removeSupplyLine,
  restoreDefaultSupply,
  addProductSupply,
  supplyCompositionChanged,
  toSupplyAdjustmentsSnapshot,
} = productSupplies;
const { buildCostBreakdown, allocateCents } = breakdownLib;

// Catálogo del ejemplo de D059 (lámpara).
const CATALOG = [
  { id: "portalamparas", name: "Portalámparas", category: "component", unit: "unit", unit_cost: 1100 },
  { id: "cable", name: "Cable", category: "component", unit: "m", unit_cost: 1100 },
  { id: "foco", name: "Foco LED", category: "component", unit: "unit", unit_cost: 1200 },
  { id: "caja", name: "Caja", category: "packaging", unit: "unit", unit_cost: 700 },
  { id: "burbuja", name: "Papel burbuja", category: "packaging", unit: "m", unit_cost: 500 },
  { id: "etiqueta", name: "Etiqueta", category: "packaging", unit: "unit", unit_cost: 80 },
  { id: "resina", name: "Resina", category: "component", unit: "kg", unit_cost: 3500 },
  { id: "tornillo", name: "Tornillo", category: "component", unit: "unit", unit_cost: 25 },
];
const assoc = (id, typeId, supplyId, quantity, unit, order) => ({ id, product_type_id: typeId, supply_id: supplyId, quantity, quantity_unit: unit, sort_order: order });
const LAMP = [
  assoc("l1", "lampara", "portalamparas", 1, "unit", 1),
  assoc("l2", "lampara", "cable", 2, "m", 2),
  assoc("l3", "lampara", "foco", 1, "unit", 3),
  assoc("l4", "lampara", "caja", 1, "unit", 4),
  assoc("l5", "lampara", "burbuja", 1, "m", 5),
];
const KEYCHAIN = [assoc("k1", "llavero", "etiqueta", 1, "unit", 1)];
const ASSOCIATIONS = [...LAMP, ...KEYCHAIN];

const deepFreeze = (value) => {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};
const resolve = (typeId, adjustments, extra = {}) =>
  resolveProductSupplyLines({ productTypeId: typeId, associations: ASSOCIATIONS, supplies: CATALOG, adjustments, ...extra });
const costOf = (resolution) => priceResolvedSupplyLines(resolution.lines).total;

// ---------------------------------------------------------------------------------------------
// A + B: componentes predeterminados y específicos del producto
// ---------------------------------------------------------------------------------------------

test("A: a product uses its type's default components with quantities, units and current costs", () => {
  const resolution = resolve("lampara", []);
  assert.deepEqual(resolution.lines.map((line) => line.supplyId), ["portalamparas", "cable", "foco", "caja", "burbuja"]);
  assert.ok(resolution.lines.every((line) => line.origin === "type" && !line.adjusted));
  assert.equal(costOf(resolution), 1100 + 2200 + 1200 + 700 + 500); // 5.700
  assert.deepEqual(resolution.removed, []);
});

test("B: two LED bulbs for one model change only that product (override), never the type", () => {
  const frozenAssociations = deepFreeze(structuredClone(ASSOCIATIONS));
  const adjustments = setSupplyLineQuantity([], resolve("lampara", []).lines.find((line) => line.supplyId === "foco"), 2, "unit");
  assert.deepEqual(adjustments, [{ supply_id: "foco", kind: "override", quantity: 2, quantity_unit: "unit" }]);
  const special = resolveProductSupplyLines({ productTypeId: "lampara", associations: frozenAssociations, supplies: CATALOG, adjustments });
  const foco = special.lines.find((line) => line.supplyId === "foco");
  assert.equal(foco.quantity, 2);
  assert.equal(foco.adjusted, true);
  assert.equal(foco.defaultQuantity, 1);
  assert.equal(costOf(special), 5_700 + 1_200);
  // Otro producto del mismo tipo sin ajustes: intacto. El tipo (associations) no se tocó (congelado).
  assert.equal(costOf(resolveProductSupplyLines({ productTypeId: "lampara", associations: frozenAssociations, supplies: CATALOG, adjustments: [] })), 5_700);
  assert.equal(frozenAssociations.find((item) => item.supply_id === "foco").quantity, 1);
});

test("B: remove a default, restore it, add a catalog extra; setting the type quantity again clears the override", () => {
  const base = resolve("lampara", []);
  let adjustments = removeSupplyLine([], base.lines.find((line) => line.supplyId === "burbuja"));
  let resolution = resolve("lampara", adjustments);
  assert.equal(resolution.lines.some((line) => line.supplyId === "burbuja"), false);
  assert.deepEqual(resolution.removed, [{ supplyId: "burbuja", name: "Papel burbuja" }]);
  assert.equal(costOf(resolution), 5_200);

  adjustments = addProductSupply(adjustments, "tornillo", 4, "unit");
  resolution = resolve("lampara", adjustments);
  const tornillo = resolution.lines.find((line) => line.supplyId === "tornillo");
  assert.equal(tornillo.origin, "product");
  assert.equal(costOf(resolution), 5_200 + 100);

  adjustments = restoreDefaultSupply(adjustments, "burbuja");
  assert.equal(costOf(resolve("lampara", adjustments)), 5_700 + 100);

  const cable = resolve("lampara", adjustments).lines.find((line) => line.supplyId === "cable");
  adjustments = setSupplyLineQuantity(adjustments, cable, 300, "cm"); // 3 m
  assert.equal(resolve("lampara", adjustments).lines.find((line) => line.supplyId === "cable").adjusted, true);
  adjustments = setSupplyLineQuantity(adjustments, cable, 200, "cm"); // = 2 m del tipo → sin override
  assert.equal(adjustments.some((item) => item.supply_id === "cable"), false);

  // Quitar un agregado lo borra del todo.
  adjustments = removeSupplyLine(adjustments, { supplyId: "tornillo", origin: "product" });
  assert.equal(adjustments.some((item) => item.supply_id === "tornillo"), false);
});

test("no duplicates: an extra of a supply the type already has replaces its quantity instead of adding a second line", () => {
  const adjustments = [{ supply_id: "foco", kind: "extra", quantity: 3, quantity_unit: "unit" }];
  const resolution = resolve("lampara", adjustments);
  assert.equal(resolution.lines.filter((line) => line.supplyId === "foco").length, 1);
  assert.equal(resolution.lines.find((line) => line.supplyId === "foco").quantity, 3);
  // Duplicados en los ajustes guardados: gana el último, una sola fila.
  assert.deepEqual(normalizeSupplyAdjustments([
    { supply_id: "foco", kind: "override", quantity: 2, quantity_unit: "unit" },
    { supply_id: "foco", kind: "override", quantity: 5, quantity_unit: "unit" },
    { supply_id: "", kind: "extra", quantity: 1, quantity_unit: "unit" },
    { supply_id: "x", kind: "extra", quantity: -1, quantity_unit: "unit" },
    { supply_id: "y", kind: "bogus" },
  ]), [{ supply_id: "foco", kind: "override", quantity: 5, quantity_unit: "unit" }]);
});

test("changing the type uses the new type's components; stale overrides/removals are dropped, product extras stay", () => {
  const adjustments = [
    { supply_id: "foco", kind: "override", quantity: 2, quantity_unit: "unit" },
    { supply_id: "caja", kind: "removed" },
    { supply_id: "tornillo", kind: "extra", quantity: 2, quantity_unit: "unit" },
  ];
  const keychain = resolve("llavero", adjustments);
  assert.deepEqual(keychain.lines.map((line) => line.supplyId), ["etiqueta", "tornillo"]);
  assert.equal(costOf(keychain), 80 + 50);
  assert.deepEqual(keychain.adjustments, [{ supply_id: "tornillo", kind: "extra", quantity: 2, quantity_unit: "unit" }]);
  assert.deepEqual(toSupplyAdjustmentsSnapshot(keychain.adjustments), { version: 1, items: keychain.adjustments });
});

test("an extra whose supply was deleted keeps its saved cost (never lose a cost); archived defaults still count", () => {
  const snapshotSupplies = { lines: [{ supply_id: "viejo", name: "Pieza descontinuada", category: "component", quantity: 1, quantity_unit: "unit", supply_unit: "unit", unit_cost: 999, cost: 999 }] };
  const resolution = resolveProductSupplyLines({
    productTypeId: "llavero",
    associations: ASSOCIATIONS,
    supplies: CATALOG.map((supply) => (supply.id === "etiqueta" ? { ...supply, archived_at: "2026-11-01T00:00:00Z" } : supply)),
    adjustments: [{ supply_id: "viejo", kind: "extra", quantity: 2, quantity_unit: "unit" }],
    snapshotSupplies,
  });
  const kept = resolution.lines.find((line) => line.supplyId === "viejo");
  assert.equal(kept.missing, true);
  assert.equal(priceResolvedSupplyLines(resolution.lines).total, 80 + 1_998);
  assert.equal(resolution.lines.find((line) => line.supplyId === "etiqueta").archived, true);
});

// ---------------------------------------------------------------------------------------------
// C: gastos adicionales personalizados
// ---------------------------------------------------------------------------------------------

test("custom expenses: validated, edited and removed; summed exactly in cents; legacy other_costs becomes one expense", () => {
  assert.equal(expensesLib.validateCustomExpense("", "10").ok, false);
  assert.equal(expensesLib.validateCustomExpense("Diseño", "-1").ok, false);
  assert.deepEqual(expensesLib.validateCustomExpense("  Diseño   personalizado ", "1200,5"), { ok: true, value: { name: "Diseño personalizado", amount: 1200.5 } });
  const expenses = expensesLib.normalizeCustomExpenses([
    { id: "a", name: "Tratamiento especial", amount: 500 },
    { id: "b", name: "Diseño personalizado", amount: "1200" },
    { id: "c", name: "Embalaje reforzado", amount: 700 },
    { id: "a", name: "Repetido", amount: 0.1 },
    { id: "d", name: "", amount: 50 },
  ]);
  assert.deepEqual(expenses.map((expense) => expense.id), ["a", "b", "c", "a-2"]);
  assert.equal(expensesLib.sumCustomExpenses(expenses), 2_400.1);
  assert.equal(expensesLib.sumCustomExpenses([{ id: "x", name: "x", amount: 0.1 }, { id: "y", name: "y", amount: 0.2 }]), 0.3);
  // Editar = otro importe; eliminar = quitarlo de la lista.
  const edited = expenses.map((expense) => (expense.id === "b" ? { ...expense, amount: 1500 } : expense)).filter((expense) => expense.id !== "a-2");
  assert.equal(expensesLib.sumCustomExpenses(edited), 2_700);
  // Snapshots anteriores: el monto genérico se conserva como «Otros costos»; con custom_expenses manda la lista.
  assert.deepEqual(expensesLib.readSnapshotCustomExpenses({ other_costs: 100 }), [{ id: "legacy-other-costs", name: "Otros costos", amount: 100 }]);
  assert.deepEqual(expensesLib.readSnapshotCustomExpenses({ other_costs: 100, custom_expenses: [] }), []);
  assert.deepEqual(expensesLib.readSnapshotCustomExpenses({}), []);
});

// ---------------------------------------------------------------------------------------------
// Desglose de costos == motor
// ---------------------------------------------------------------------------------------------

function engine({ filament = 0, electricity = 0, maintenance = 0, labor = 0, fixed = 0, expenses = [], supplyPricing = null, multiplier = 2, contingency = 0 }) {
  const otherCost = expensesLib.sumCustomExpenses(expenses);
  const result = pricing.calculateCalculatorPricing({
    filamentCost: filament,
    electricityCost: electricity,
    maintenanceCost: maintenance,
    laborCost: labor,
    fixedCost: fixed,
    otherCost,
    suppliesCost: supplyPricing?.total ?? 0,
    multiplier,
    suppliesContingencyPercent: contingency,
  });
  const breakdown = buildCostBreakdown({ pricing: result, laborCost: labor, otherCost, customExpenses: expenses, supplies: supplyPricing, formatSupplyDetail: supplies.describeSupplyLine });
  return { result, breakdown };
}

test("«Desglose de costos»: the D059 lamp example shows every concept and totals $10.450 exactly like the engine", () => {
  const supplyPricing = priceResolvedSupplyLines(resolve("lampara", []).lines);
  const { result, breakdown } = engine({ filament: 2_500, electricity: 350, maintenance: 400, labor: 1_500, supplyPricing });
  const rows = breakdown.items.map((item) => [item.label, item.displayAmount]);
  assert.deepEqual(rows, [
    ["Filamento", 2_500], ["Electricidad", 350], ["Desgaste de impresora", 400],
    ["Portalámparas", 1_100], ["Cable", 2_200], ["Foco LED", 1_200], ["Caja", 700], ["Papel burbuja", 500],
    ["Mano de obra", 1_500],
  ]);
  assert.equal(result.realCost, 10_450);
  assert.equal(breakdown.realCost, 10_450);
  assert.equal(breakdown.matchesEngine, true);
  assert.equal(breakdown.itemsTotal, result.realCost);
  // Componentes del catálogo sin markup: la ganancia es solo filamento × (markup − 1).
  assert.equal(result.salePrice, 2_500 * 2 + 350 + 400 + 1_500 + 5_700);
  assert.equal(result.profit, 2_500);
  assert.equal(result.marginPercent, (2_500 / result.salePrice) * 100);
});

test("breakdown lists each custom expense and each product-specific component; contingencies stay out of the real cost", () => {
  const adjustments = [{ supply_id: "foco", kind: "override", quantity: 2, quantity_unit: "unit" }, { supply_id: "tornillo", kind: "extra", quantity: 4, quantity_unit: "unit" }];
  const supplyPricing = priceResolvedSupplyLines(resolve("lampara", adjustments).lines);
  const expenses = [{ id: "t", name: "Tratamiento especial", amount: 500 }, { id: "d", name: "Diseño personalizado", amount: 1_200 }];
  const { result, breakdown } = engine({ filament: 1_000, fixed: 300, expenses, supplyPricing, contingency: 5 });
  const byKey = new Map(breakdown.items.map((item) => [item.key, item]));
  assert.equal(byKey.get("expense:t").amount, 500);
  assert.equal(byKey.get("expense:d").amount, 1_200);
  assert.deepEqual(byKey.get("supply:foco").notes, ["Cantidad propia"]);
  assert.deepEqual(byKey.get("supply:tornillo").notes, ["Solo este producto"]);
  assert.equal(byKey.has("other"), false, "named expenses are not repeated as a generic line");
  // Contingencias: 5 % solo sobre insumos (extra del tipo + catálogo), nunca sobre gastos ni impresión.
  const suppliesBase = 300 + supplyPricing.total;
  assert.equal(breakdown.contingencyBase, suppliesBase);
  assert.equal(breakdown.contingencyAmount, suppliesBase * 0.05);
  assert.equal(breakdown.realCost, 1_000 + 300 + 1_700 + supplyPricing.total);
  assert.equal(breakdown.baseCost, breakdown.realCost + breakdown.contingencyAmount);
  assert.equal(breakdown.matchesEngine, true);
  assert.equal(result.profit, 1_000, "profit still equals filament × (markup − 1)");
  // Contingencias opcionales: 0 % por defecto.
  assert.equal(engine({ filament: 1_000, fixed: 300, expenses, supplyPricing }).breakdown.contingencyAmount, 0);
});

test("display rows always add up to the displayed real cost (cent allocation), with awkward decimals", () => {
  const cases = [
    { filament: 1.005, electricity: 2.335, maintenance: 0.333, labor: 0.1 },
    { filament: 1234.5678, electricity: 98.7654, maintenance: 12.3456, expenses: [{ id: "a", name: "A", amount: 0.1 }, { id: "b", name: "B", amount: 0.2 }] },
    { filament: 0, electricity: 0, maintenance: 0 },
    { filament: 333.3333, electricity: 333.3333, maintenance: 333.3334, supplyPricing: priceResolvedSupplyLines(resolve("lampara", [{ supply_id: "cable", kind: "override", quantity: 1.37, quantity_unit: "m" }]).lines) },
  ];
  for (const input of cases) {
    const { result, breakdown } = engine(input);
    const shownCents = breakdown.items.reduce((total, item) => total + Math.round(item.displayAmount * 100), 0);
    assert.equal(shownCents, Math.round(result.realCost * 100), JSON.stringify(input));
    assert.equal(breakdown.matchesEngine, true);
  }
  assert.deepEqual(allocateCents([0.333, 0.333, 0.334], 1), [33, 33, 34]);
  assert.deepEqual(allocateCents([10, 20], 30), [1_000, 2_000]);
});

test("the «Desglose de costos» table renders one row per concept and the exact total (desktop and mobile share markup)", () => {
  const supplyPricing = priceResolvedSupplyLines(resolve("lampara", []).lines);
  const { breakdown } = engine({ filament: 2_500, electricity: 350, maintenance: 400, labor: 1_500, supplyPricing, contingency: 5 });
  const html = renderToStaticMarkup(React.createElement(CostBreakdownTable, { breakdown, showPricing: true }));
  assert.match(html, /Desglose de costos<\/h3>/);
  for (const label of ["Filamento", "Electricidad", "Desgaste de impresora", "Portalámparas", "Cable", "Foco LED", "Caja", "Papel burbuja", "Mano de obra"]) {
    assert.match(html, new RegExp(`>${label}<`), label);
  }
  assert.match(html, /Costo real de fabricación<\/th><td[^>]*>\$10\.450,00</);
  assert.match(html, /Contingencias sobre insumos/);
  assert.match(html, /Costo total con contingencias<\/th><td[^>]*>\$10\.735,00</);
  assert.match(html, /Precio de venta sugerido/);
  assert.match(html, /table-fixed/, "fixed two-column layout: no horizontal scroll on phones");
});

// ---------------------------------------------------------------------------------------------
// Mi Taller: calculateProductPrice con los componentes del tipo
// ---------------------------------------------------------------------------------------------

const FILAMENT = { id: "pla", name: "PLA", purchase_price: 20_000, total_grams: 1_000 };
const productInput = (overrides = {}) => ({
  components: [{ name: "Producto completo", quantity_per_product: 1, materials: [{ filament: FILAMENT, grams: 100 }] }],
  printTimeMinutes: 120,
  printer: { id: "p1", name: "P1", power_watts: 200, maintenance_cost_per_hour: 100 },
  productType: { id: "lampara", name: "Lámpara", multiplier: 2, fixed_cost: 0 },
  calculatorSettings: { default_error_percent: 0, electricity_price_kwh: 100 },
  currentSupplies: CATALOG,
  currentAssociations: ASSOCIATIONS,
  ...overrides,
});

test("Mi Taller: a product created in the editor includes its type's components (previously it got none)", () => {
  const result = calculateProductPrice(productInput({ oldSnapshot: null }));
  assert.equal(result.usesTypeComponents, true);
  assert.equal(result.suppliesCost, 5_700);
  // filamento 2.000 + electricidad 40 + desgaste 200 + insumos 5.700
  assert.equal(result.realCost, 7_940);
  assert.equal(result.salePrice, 4_000 + 40 + 200 + 5_700);
  assert.deepEqual(result.snapshot.supplies.lines.map((line) => line.supply_id), ["portalamparas", "cable", "foco", "caja", "burbuja"]);
  assert.ok(result.snapshot.supplies.lines.every((line) => line.origin === "type"));
  assert.deepEqual(result.snapshot.supply_adjustments, { version: 1, items: [] });
  assert.equal(result.breakdown.matchesEngine, true);
});

test("Mi Taller: changing the product type uses the new type's components; old type's lines are not carried over", () => {
  const lamp = calculateProductPrice(productInput({ oldSnapshot: null }));
  const asKeychain = calculateProductPrice(productInput({
    productType: { id: "llavero", name: "Llavero", multiplier: 2, fixed_cost: 0 },
    oldSnapshot: JSON.parse(JSON.stringify(lamp.snapshot)),
  }));
  assert.deepEqual(asKeychain.snapshot.supplies.lines.map((line) => line.supply_id), ["etiqueta"]);
  assert.equal(asKeychain.suppliesCost, 80);
  // Un tipo sin componentes no arrastra los del tipo anterior.
  const plain = calculateProductPrice(productInput({
    productType: { id: "sin-componentes", name: "Figura", multiplier: 2, fixed_cost: 0 },
    oldSnapshot: JSON.parse(JSON.stringify(lamp.snapshot)),
  }));
  assert.equal(plain.suppliesCost, 0);
  assert.equal("supplies" in plain.snapshot, false);
});

test("Mi Taller: editing the type's components reaches affected products on recalculation; history stays frozen", () => {
  const saved = calculateProductPrice(productInput({ oldSnapshot: null }));
  const savedSnapshot = deepFreeze(JSON.parse(JSON.stringify(saved.snapshot)));
  const savedProduct = { product_type_id: "lampara", sale_price: saved.salePrice, base_cost: saved.baseCost, calculation_snapshot: savedSnapshot };

  // El usuario agrega una etiqueta al tipo «Lámpara» y sube el foco a $1.800.
  const newAssociations = [...ASSOCIATIONS, assoc("l6", "lampara", "etiqueta", 2, "unit", 6)];
  const newCatalog = CATALOG.map((supply) => (supply.id === "foco" ? { ...supply, unit_cost: 1_800 } : supply));

  const flagged = status.getProductPricingStatus(savedProduct, [FILAMENT], [], [{ id: "lampara", multiplier: 2, fixed_cost: 0 }], newCatalog, newAssociations);
  assert.equal(flagged.needsRecalculation, true);
  assert.ok(flagged.reasons.includes(status.SUPPLY_COMPOSITION_CHANGED_REASON));
  assert.ok(flagged.reasons.includes("Cambió el costo de Foco LED"));

  const recalculated = calculateProductPrice(productInput({ oldSnapshot: savedSnapshot, currentSupplies: newCatalog, currentAssociations: newAssociations }));
  assert.equal(recalculated.suppliesCost, 5_700 + 600 + 160);
  // Lo guardado no cambió solo: el snapshot viejo y el precio guardado siguen iguales.
  assert.equal(savedSnapshot.supplies.total_cost, 5_700);
  assert.equal(savedProduct.sale_price, saved.salePrice);
});

test("Mi Taller: product-specific adjustments and expenses persist in the snapshot and survive a JSON round trip", () => {
  const adjustments = [{ supply_id: "foco", kind: "override", quantity: 2, quantity_unit: "unit" }, { supply_id: "caja", kind: "removed" }];
  const expenses = [{ id: "d", name: "Diseño personalizado", amount: 1_200 }];
  const first = calculateProductPrice(productInput({ oldSnapshot: null, supplyAdjustments: adjustments, customExpenses: expenses }));
  assert.equal(first.suppliesCost, 5_700 + 1_200 - 700);
  assert.equal(first.otherCost, 1_200);
  assert.equal(first.snapshot.other_costs, 1_200);
  assert.deepEqual(first.snapshot.custom_expenses, expenses);
  assert.deepEqual(first.snapshot.supply_adjustments.items, adjustments);
  assert.deepEqual(first.removedSupplies, [{ supplyId: "caja", name: "Caja" }]);

  // Recalcular desde lo guardado (sin pasar ajustes) da exactamente lo mismo: nada se duplica ni se pierde.
  const stored = JSON.parse(JSON.stringify(first.snapshot));
  const again = calculateProductPrice(productInput({ oldSnapshot: stored }));
  assert.equal(again.baseCost, first.baseCost);
  assert.equal(again.salePrice, first.salePrice);
  assert.equal(again.otherCost, 1_200, "expenses are not added twice to the old other_costs");
  const product = { product_type_id: "lampara", calculation_snapshot: stored };
  const printers = [{ id: "p1", power_watts: 200, maintenance_cost_per_hour: 100 }];
  assert.deepEqual(status.getProductPricingStatus(product, [FILAMENT], printers, [{ id: "lampara", multiplier: 2, fixed_cost: 0 }], CATALOG, ASSOCIATIONS).reasons, []);

  // El ajuste es de ESTE producto: otro producto del tipo sigue con 1 foco y caja.
  const other = calculateProductPrice(productInput({ oldSnapshot: null }));
  assert.equal(other.suppliesCost, 5_700);
});

test("Mi Taller: outdated detection covers type change, unsaved expense edits and products created before components existed", () => {
  const types = [{ id: "lampara", multiplier: 2, fixed_cost: 0 }, { id: "llavero", multiplier: 2, fixed_cost: 0 }];
  const fresh = calculateProductPrice(productInput({ oldSnapshot: null }));
  const snap = JSON.parse(JSON.stringify(fresh.snapshot));

  const typeChanged = status.getProductPricingStatus({ product_type_id: "llavero", calculation_snapshot: snap }, [FILAMENT], [], types, CATALOG, ASSOCIATIONS);
  assert.ok(typeChanged.reasons.includes(status.PRODUCT_TYPE_CHANGED_REASON));
  assert.ok(typeChanged.reasons.includes(status.SUPPLY_COMPOSITION_CHANGED_REASON));

  const expensesEdited = status.getProductPricingStatus(
    { product_type_id: "lampara", calculation_snapshot: { ...snap, custom_expenses: [{ id: "x", name: "Diseño", amount: 900 }] } },
    [FILAMENT], [], types, CATALOG, ASSOCIATIONS,
  );
  assert.ok(expensesEdited.reasons.includes(status.CUSTOM_EXPENSES_CHANGED_REASON));

  const beforeComponents = { product_type_id: "lampara", calculation_snapshot: { source: "product_editor", product_type_id: "lampara" } };
  assert.ok(status.getProductPricingStatus(beforeComponents, [], [], types, CATALOG, ASSOCIATIONS).reasons.includes(status.SUPPLY_COMPOSITION_CHANGED_REASON));
  // Sin catálogo disponible (migración sin aplicar): no se inventan diferencias.
  assert.equal(status.getProductPricingStatus(beforeComponents, [], [], types, [], null).reasons.includes(status.SUPPLY_COMPOSITION_CHANGED_REASON), false);
  assert.equal(supplyCompositionChanged(undefined, []), false);
});

test("Mi Taller without the catalog (migration not applied) keeps the D057 behaviour: saved lines are recosted, never lost", () => {
  const saved = calculateProductPrice(productInput({ oldSnapshot: null }));
  const legacy = calculateProductPrice(productInput({ oldSnapshot: JSON.parse(JSON.stringify(saved.snapshot)), currentAssociations: null, currentSupplies: [] }));
  assert.equal(legacy.usesTypeComponents, false);
  assert.equal(legacy.suppliesCost, 5_700);
  assert.equal(legacy.baseCost, saved.baseCost);
});

test("regression: products without components, expenses or adjustments calculate exactly as before D059", () => {
  const plainType = { id: "figura", name: "Figura", multiplier: 3, fixed_cost: 150 };
  const old = { source: "product_editor", labor_cost: 50, other_costs: 100 };
  const withCatalog = calculateProductPrice(productInput({ productType: plainType, oldSnapshot: old }));
  const withoutCatalog = calculateProductPrice(productInput({ productType: plainType, oldSnapshot: old, currentAssociations: null, currentSupplies: null }));
  const expected = pricing.calculateCalculatorPricing({ filamentCost: 2_000, electricityCost: 40, maintenanceCost: 200, fixedCost: 150, multiplier: 3, laborCost: 50, otherCost: 100 });
  for (const result of [withCatalog, withoutCatalog]) {
    assert.equal(result.baseCost, expected.baseCost);
    assert.equal(result.salePrice, expected.salePrice);
    assert.equal(result.profit, expected.profit);
    assert.equal(result.otherCost, 100);
  }
  assert.deepEqual(withCatalog.snapshot.custom_expenses, [{ id: "legacy-other-costs", name: "Otros costos", amount: 100 }]);
});

// ---------------------------------------------------------------------------------------------
// Borrador anónimo, sincronización y contratos de pantallas
// ---------------------------------------------------------------------------------------------

test("guest draft: old drafts still parse unchanged; named expenses are accepted; malformed lists are rejected", () => {
  const now = 1_800_000_000_000;
  const base = {
    version: 1, savedAt: now, advanced: true, grams: ["10"], hours: "1", minutes: "0", manualPricePerKg: "", manualErrorPercent: "",
    manualKwhPrice: "", manualPrinterConsumption: "", manualPrinterMaintenance: "", laborCost: "", otherCost: "100", fixedCost: "",
    manualMultiplier: "", manualPlatformCommission: "", manualPlatformExtra: "", shippingCost: "",
  };
  assert.deepEqual(guestDraft.parseCalculatorGuestDraft(JSON.stringify(base), now), base);
  const withExpenses = { ...base, customExpenses: [{ id: "a", name: "Diseño", amount: 100 }] };
  assert.deepEqual(guestDraft.parseCalculatorGuestDraft(JSON.stringify(withExpenses), now), withExpenses);
  assert.equal(guestDraft.parseCalculatorGuestDraft(JSON.stringify({ ...base, customExpenses: "x" }), now), null);
});

test("catalog sync: a change is announced to every other open panel, never back to its sender", () => {
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  try {
    const received = [];
    const offTypes = events.subscribeCalculatorSuppliesChanged((detail) => received.push(["types", detail.source]), "types");
    const offCalculator = events.subscribeCalculatorSuppliesChanged((detail) => received.push(["calculator", detail.source]));
    events.notifyCalculatorSuppliesChanged("supplies");
    events.notifyCalculatorSuppliesChanged("types");
    offTypes();
    offCalculator();
    events.notifyCalculatorSuppliesChanged("supplies");
    assert.deepEqual(received, [["types", "supplies"], ["calculator", "supplies"], ["calculator", "types"]]);
  } finally {
    globalThis.window = previous;
  }
});

test("screens are wired: calculator, Mi Taller, recalculation, settings and managers use the shared D059 pieces", () => {
  const calculator = readRepoFile("src/app/calculadora/page.tsx");
  assert.match(calculator, /<CostBreakdownTable breakdown=\{calc\.breakdown\} collapsible \/>/);
  assert.match(calculator, /<CustomExpensesEditor expenses=\{customExpenses\}/);
  assert.match(calculator, /<ProductSuppliesAdjuster/);
  assert.match(calculator, /customExpenses: validCustomExpenses/);
  assert.match(calculator, /supply_adjustments: toSupplyAdjustmentsSnapshot\(supplyResolution\.adjustments\)/);
  assert.match(calculator, /custom_expenses: validCustomExpenses/);
  assert.doesNotMatch(calculator, /label="Otros costos adicionales"/, "the single generic amount was replaced by named expenses");
  assert.match(calculator, /subscribeCalculatorSuppliesChanged/);
  assert.match(calculator, /onOpenCatalog=\{\(\) => setSettingsModalTab\("supplies"\)\}/);

  const workshop = readRepoFile("src/app/productos/page.tsx");
  assert.match(workshop, /currentAssociations: supplyAssociations/);
  assert.match(workshop, /<CostBreakdownTable breakdown=\{calcPreview\.breakdown\} showPricing compact \/>/);
  assert.match(workshop, /scopeLabel="este producto"/);
  assert.equal((workshop.match(/supplies, supplyAssociations\)/g) ?? []).length, 5, "every pricing status check sees the type components");

  const actions = readRepoFile("src/app/productos/actions.ts");
  assert.match(actions, /const productTypeId = product\.product_type_id \|\| snapshot\.product_type_id;/);
  assert.match(actions, /currentAssociations: context\.associations/);
  assert.match(actions, /associations: suppliesData\.available \? suppliesData\.associations : null/);

  for (const file of ["src/lib/workshop/load-summary.ts", "src/lib/stampy/product-stock-tools.ts"]) {
    assert.match(readRepoFile(file), /suppliesData\.available \? suppliesData\.associations : null/, file);
  }

  const settingsPage = readRepoFile("src/app/configuracion/page.tsx");
  assert.match(settingsPage, /<ProductTypesManager onOpenSupplies=\{scrollToSuppliesCatalog\} \/>/);
  const suppliesManager = readRepoFile("src/components/calculadora/supplies-manager.tsx");
  assert.equal((suppliesManager.match(/announceChange\(\);/g) ?? []).length, 3, "create/edit, archive/restore and delete announce the change");
  assert.match(suppliesManager, /id="catalogo-insumos"/);
  const typesManager = readRepoFile("src/components/configuracion/product-types-manager.tsx");
  assert.match(typesManager, /subscribeCalculatorSuppliesChanged/);
  assert.equal((typesManager.match(/notifyCalculatorSuppliesChanged\(syncSource\)/g) ?? []).length, 2);
  // UX-01A: el editor de componentes del tipo es un modal; «Ir a Insumos» cierra el modal y lleva al catálogo.
  const typeSuppliesDialog = readRepoFile("src/components/calculadora/product-type-supplies-editor.tsx");
  assert.match(typeSuppliesDialog, /<Dialog/);
  assert.match(typeSuppliesDialog, /Ir a Insumos →/);
  assert.match(typeSuppliesDialog, /if \(await requestClose\(\)\)/, "going to the catalog asks before discarding unsaved changes");
  assert.match(typesManager, /<ProductTypeSuppliesDialog/);
});

test("Premium UI: the components editor renders type defaults, own quantities, product extras, removed defaults and totals", () => {
  const { ProductSuppliesAdjuster } = loadTs("src/components/calculadora/product-supplies-adjuster.tsx");
  const adjustments = [
    { supply_id: "foco", kind: "override", quantity: 2, quantity_unit: "unit" },
    { supply_id: "caja", kind: "removed" },
    { supply_id: "tornillo", kind: "extra", quantity: 4, quantity_unit: "unit" },
  ];
  const resolution = resolve("lampara", adjustments);
  const html = renderToStaticMarkup(React.createElement(ProductSuppliesAdjuster, {
    productTypeName: "Lámpara",
    pricing: priceResolvedSupplyLines(resolution.lines),
    removed: resolution.removed,
    supplies: CATALOG,
    adjustments,
    onChange: () => {},
    scopeLabel: "este producto",
    contingencyPercent: 5,
    onEditType: () => {},
    onOpenCatalog: () => {},
  }));
  assert.match(html, /«Lámpara» · cambios solo para este producto/);
  assert.match(html, /aria-label="Cómo funcionan los componentes de este cálculo"/, "the long explanation lives in a contextual help");
  assert.match(html, />Ajustado</);
  assert.match(html, /Foco LED<span[^>]*>Cantidad propia<\/span>/);
  assert.match(html, /tipo: 1 u\./);
  assert.match(html, /Tornillo<span[^>]*>Solo este producto<\/span>/);
  assert.match(html, /Quitados de este producto/);
  assert.match(html, /aria-label="Restaurar Caja"/);
  assert.match(html, /aria-label="Volver a la cantidad del tipo para Foco LED"/);
  assert.match(html, /Agregar componente/);
  // 1.100 + 2.200 + 2.400 + 500 + 100 = 6.300 (componentes 5.800, embalaje 500)
  assert.match(html, /Componentes<\/dt><dd[^>]*>\$5\.800</);
  assert.match(html, /Embalaje<\/dt><dd[^>]*>\$500</);
  assert.match(html, /Total<\/dt><dd[^>]*>\$6\.300</);
});

test("UI: the custom expenses editor shows each expense editable/removable and the exact total", () => {
  const { CustomExpensesEditor } = loadTs("src/components/calculadora/custom-expenses-editor.tsx");
  const html = renderToStaticMarkup(React.createElement(CustomExpensesEditor, {
    expenses: [
      { id: "t", name: "Tratamiento especial", amount: "500" },
      { id: "d", name: "Diseño personalizado", amount: "1200" },
      { id: "e", name: "Embalaje reforzado", amount: "700" },
    ],
    onChange: () => {},
    scopeLabel: "este cálculo",
  }));
  assert.equal((html.match(/aria-label="Concepto del gasto"/g) ?? []).length, 3);
  assert.match(html, /value="Diseño personalizado"/);
  assert.match(html, /aria-label="Eliminar Embalaje reforzado"/);
  assert.match(html, /Total de gastos adicionales<\/span><strong[^>]*>\$2\.400</);
});
