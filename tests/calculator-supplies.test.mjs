// Calculadora V2 — catálogo de insumos, componentes por tipo de producto, motor y rentabilidad (lógica pura).
// La base de datos (RLS, constraints, triggers) se prueba en calculator-supplies-db.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile } from "./helpers/load-ts.mjs";

const pricing = loadTs("src/lib/calculator/pricing.ts");
const supplies = loadTs("src/lib/calculator/supplies.ts");
const { buildCostBreakdown } = loadTs("src/lib/calculator/cost-breakdown.ts");
const { calculateProductPrice } = loadTs("src/lib/products/pricing.ts");
const { getProductPricingStatus, usesLegacySuppliesSurcharge, LEGACY_SURCHARGE_REASON } = loadTs("src/lib/products/pricing-status.ts");

const {
  validateSupplyDraft,
  validateSupplyQuantity,
  convertQuantity,
  compatibleUnits,
  priceSupplyLines,
  buildProductTypeSupplyLines,
  toSupplySnapshot,
  repriceSupplySnapshot,
  changedSnapshotSupplies,
  parseDecimalInput,
} = supplies;

// Catálogo de la lámpara del ejemplo del requerimiento.
const CATALOG = [
  { id: "caja", name: "Caja para lámpara", category: "packaging", unit: "unit", unit_cost: 850 },
  { id: "burbuja", name: "Papel burbuja", category: "packaging", unit: "m", unit_cost: 300 },
  { id: "foco", name: "Foco LED", category: "component", unit: "unit", unit_cost: 1500 },
  { id: "enchufe", name: "Enchufe", category: "component", unit: "unit", unit_cost: 700 },
  { id: "cable", name: "Cable eléctrico", category: "component", unit: "m", unit_cost: 450 },
  { id: "interruptor", name: "Interruptor", category: "component", unit: "unit", unit_cost: 350 },
  { id: "resina", name: "Resina", category: "component", unit: "kg", unit_cost: 3500 },
];
const assoc = (id, productTypeId, supplyId, quantity, quantityUnit, sortOrder = 0) => ({
  id, product_type_id: productTypeId, supply_id: supplyId, quantity, quantity_unit: quantityUnit, sort_order: sortOrder,
});
const LAMP = [
  assoc("a1", "lampara", "caja", 1, "unit", 1),
  assoc("a2", "lampara", "burbuja", 1.5, "m", 2),
  assoc("a3", "lampara", "foco", 1, "unit", 3),
  assoc("a4", "lampara", "enchufe", 1, "unit", 4),
  assoc("a5", "lampara", "cable", 2, "m", 5),
  assoc("a6", "lampara", "interruptor", 1, "unit", 6),
];

// ------------------------------------------------------------------------------------------------
// Catálogo: validación y unidades
// ------------------------------------------------------------------------------------------------

test("a valid supply is normalized (name spaces, 4-decimal cost, no custom label for standard units)", () => {
  const result = validateSupplyDraft({ name: "  Foco   LED  ", category: "component", unit: "unit", customUnitLabel: "ignored", unitCost: "1500,5" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { name: "Foco LED", category: "component", unit: "unit", custom_unit_label: null, unit_cost: 1500.5 });
  assert.equal(validateSupplyDraft({ name: "Pegamento", category: "component", unit: "g", unitCost: "0.123456" }).value.unit_cost, 0.1235);
  assert.equal(validateSupplyDraft({ name: "Regalo", category: "packaging", unit: "unit", unitCost: "" }).value.unit_cost, 0, "empty cost = 0 (allowed)");
});

test("supply validation rejects empty names, unknown units/categories, negative or non-numeric costs", () => {
  const bad = (draft) => validateSupplyDraft({ name: "X", category: "component", unit: "unit", unitCost: "1", ...draft });
  assert.ok(bad({ name: "   " }).errors.name);
  assert.ok(bad({ name: "x".repeat(81) }).errors.name);
  assert.ok(bad({ unit: "pulgada" }).errors.unit);
  assert.ok(bad({ category: "otro" }).errors.category);
  assert.ok(bad({ unitCost: "-1" }).errors.unitCost);
  assert.ok(bad({ unitCost: "abc" }).errors.unitCost);
  assert.ok(bad({ unitCost: "2000000000" }).errors.unitCost);
  assert.ok(bad({ unit: "custom", customUnitLabel: "  " }).errors.customUnitLabel, "custom unit needs a label");
  assert.deepEqual(bad({ unit: "custom", customUnitLabel: " rollo " }).value.custom_unit_label, "rollo");
});

test("units convert only within the same dimension (100 g of a per-kg supply is 0.1 kg)", () => {
  assert.equal(convertQuantity(100, "g", "kg"), 0.1);
  assert.equal(convertQuantity(150, "cm", "m"), 1.5);
  assert.equal(convertQuantity(250, "ml", "l"), 0.25);
  assert.equal(convertQuantity(1.5, "m", "cm"), 150);
  assert.equal(convertQuantity(3, "unit", "unit"), 3);
  assert.equal(convertQuantity(100, "g", "m"), null);
  assert.equal(convertQuantity(1, "custom", "unit"), null);
  assert.deepEqual(compatibleUnits("kg"), ["kg", "g"]);
  assert.deepEqual(compatibleUnits("custom"), ["custom"]);
  assert.deepEqual(compatibleUnits("unit"), ["unit"]);
});

test("quantities must be > 0 and in a unit compatible with the supply", () => {
  assert.deepEqual(validateSupplyQuantity("1,5", "m", "m"), { ok: true, quantity: 1.5, unit: "m" });
  assert.deepEqual(validateSupplyQuantity("100", "g", "kg"), { ok: true, quantity: 100, unit: "g" });
  assert.equal(validateSupplyQuantity("0", "unit", "unit").ok, false);
  assert.equal(validateSupplyQuantity("-2", "unit", "unit").ok, false);
  assert.equal(validateSupplyQuantity("2", "m", "kg").ok, false);
  assert.equal(validateSupplyQuantity("0.00001", "unit", "unit").ok, false, "rounds to 0 at 4 decimals");
  assert.equal(parseDecimalInput("1.2.3"), null);
});

// ------------------------------------------------------------------------------------------------
// Costo de componentes
// ------------------------------------------------------------------------------------------------

test("product type components take their price from the personal catalog and split components vs packaging", () => {
  const lines = buildProductTypeSupplyLines("lampara", LAMP, CATALOG);
  assert.deepEqual(lines.map((line) => line.name), ["Caja para lámpara", "Papel burbuja", "Foco LED", "Enchufe", "Cable eléctrico", "Interruptor"]);
  const priced = priceSupplyLines(lines);
  assert.deepEqual(priced.lines.map((line) => line.cost), [850, 450, 1500, 700, 900, 350]);
  assert.equal(priced.packagingCost, 1300);
  assert.equal(priced.componentsCost, 3450);
  assert.equal(priced.total, 4750);
  assert.equal(buildProductTypeSupplyLines("otro-tipo", LAMP, CATALOG).length, 0);
  assert.equal(buildProductTypeSupplyLines(null, LAMP, CATALOG).length, 0);
});

test("grams of a supply priced per kilogram are converted before multiplying (no x1000 error)", () => {
  const priced = priceSupplyLines(buildProductTypeSupplyLines("t", [assoc("r", "t", "resina", 100, "g")], CATALOG));
  assert.equal(priced.lines[0].quantityInSupplyUnit, 0.1);
  assert.equal(priced.total, 350);
});

test("decimal quantities and costs are rounded per line to the cent and totals add up exactly", () => {
  const priced = priceSupplyLines([
    { supplyId: "a", name: "A", category: "component", quantity: 3, quantityUnit: "unit", supplyUnit: "unit", unitCost: 0.1 },
    { supplyId: "b", name: "B", category: "component", quantity: 0.1, quantityUnit: "kg", supplyUnit: "kg", unitCost: 3500.55 },
    { supplyId: "c", name: "C", category: "packaging", quantity: 1.005, quantityUnit: "unit", supplyUnit: "unit", unitCost: 1 },
  ]);
  assert.deepEqual(priced.lines.map((line) => line.cost), [0.3, 350.06, 1.01]);
  assert.equal(priced.componentsCost, 350.36);
  assert.equal(priced.total, 351.37);
});

test("zero-cost supplies are counted (not dropped) and flagged; invalid lines add nothing", () => {
  const priced = priceSupplyLines([
    { supplyId: "gratis", name: "Etiqueta", category: "packaging", quantity: 1, quantityUnit: "unit", supplyUnit: "unit", unitCost: 0 },
    { supplyId: "mal", name: "Cable", category: "component", quantity: 2, quantityUnit: "kg", supplyUnit: "m", unitCost: 450 },
  ]);
  assert.equal(priced.total, 0);
  assert.equal(priced.zeroCostCount, 1);
  assert.equal(priced.invalidCount, 1);
  assert.equal(priced.lines[1].valid, false);
});

// ------------------------------------------------------------------------------------------------
// Motor: compatibilidad y rentabilidad
// ------------------------------------------------------------------------------------------------

test("without catalog supplies the engine returns exactly the previous result (users not using the catalog)", () => {
  const input = { filamentCost: 500, electricityCost: 80, maintenanceCost: 120, fixedCost: 2_000, multiplier: 4, laborCost: 50, otherCost: 10 };
  const legacy = pricing.calculateCalculatorPricing(input);
  const withZero = pricing.calculateCalculatorPricing({ ...input, suppliesCost: 0 });
  for (const key of ["otherCostsRaw", "otherCostsOverheadAmount", "otherCostsAdjusted", "fixedCostAdjusted", "nonMultipliableCost", "baseCost", "salePrice", "profit"]) {
    assert.equal(withZero[key], legacy[key], key);
  }
  // D058: markup solo sobre el filamento e insumos extra a su costo real (sin el 30 % anterior).
  const historical = pricing.calculateCalculatorPricing({ filamentCost: 500, electricityCost: 80, maintenanceCost: 120, fixedCost: 2_000, multiplier: 4 });
  assert.equal(historical.baseCost, 2_700);
  assert.equal(historical.salePrice, 4_200);
  assert.equal(historical.realCost, 2_700);
  assert.equal(historical.suppliesCost, 0);
});

test("lamp example: components and packaging are added at real cost (no surcharge) and never get the markup", () => {
  const supplyPricing = priceSupplyLines(buildProductTypeSupplyLines("lampara", LAMP, CATALOG));
  const input = {
    filamentCost: 3_500, electricityCost: 450, maintenanceCost: 600, fixedCost: 0, multiplier: 2,
    suppliesCost: supplyPricing.total,
  };
  const result = pricing.calculateCalculatorPricing(input);
  assert.equal(result.suppliesCost, 4_750);
  assert.equal(result.realCost, 9_300, "costo total de fabricación del ejemplo");
  assert.equal(result.otherCostsOverheadAmount, 0);
  assert.equal(result.baseCost, 9_300);
  assert.equal(result.salePrice, 3_500 * 2 + 450 + 600 + 4_750);
  assert.equal(result.profit, 3_500, "profit only comes from the filament markup");
  assert.equal(result.marginPercent, (3_500 / 12_800) * 100);

  // Con 5 % de contingencias: solo sobre los 4.750 de insumos, una vez, sin markup.
  const withContingency = pricing.calculateCalculatorPricing({ ...input, suppliesContingencyPercent: 5 });
  assert.equal(withContingency.suppliesContingencyAmount, 237.5);
  assert.equal(withContingency.realCost, 9_300);
  assert.equal(withContingency.baseCost, 9_537.5);
  assert.equal(withContingency.salePrice, 13_037.5);
  assert.equal(withContingency.profit, 3_500);
});

test("type extras and catalog supplies share a single contingency; other costs and labor never get one (no double counting)", () => {
  const input = {
    filamentCost: 1_000, electricityCost: 0, maintenanceCost: 0, fixedCost: 100, multiplier: 3, otherCost: 200, suppliesCost: 700, laborCost: 300,
  };
  const plain = pricing.calculateCalculatorPricing(input);
  assert.equal(plain.otherCostsRaw, 1_000);
  assert.equal(plain.otherCostsOverheadAmount, 0, "no automatic 30 %");
  assert.equal(plain.realCost, 1_000 + 100 + 200 + 700 + 300);
  assert.equal(plain.baseCost, plain.realCost);
  assert.equal(plain.salePrice, 3_000 + 1_000 + 300);

  const result = pricing.calculateCalculatorPricing({ ...input, suppliesContingencyPercent: 5 });
  assert.equal(result.suppliesContingencyBase, 800, "type extras + catalog only");
  assert.equal(result.suppliesContingencyAmount, 40);
  assert.equal(result.otherCostsOverheadAmount, 40, "legacy field mirrors the single contingency");
  assert.equal(result.realCost, plain.realCost);
  assert.equal(result.baseCost, result.realCost + 40);
  assert.equal(result.salePrice, 3_000 + 1_000 + 300 + 40);
  assert.equal(result.profit, plain.profit);

  const breakdown = buildCostBreakdown({
    pricing: result,
    laborCost: 300,
    otherCost: 200,
    supplies: priceSupplyLines([{ supplyId: "x", name: "Caja", category: "packaging", quantity: 1, quantityUnit: "unit", supplyUnit: "unit", unitCost: 700 }]),
  });
  const groupsTotal = breakdown.groups.reduce((total, group) => total + group.amount, 0);
  assert.equal(groupsTotal, breakdown.realCost, "each cost appears in exactly one group");
  assert.equal(breakdown.contingencyAmount, 40, "contingency is a separate concept, outside the real-cost groups");
  assert.equal(breakdown.contingencyPercent, 5);
  assert.equal(breakdown.contingencyBase, 800);
  assert.equal(breakdown.realCost + breakdown.contingencyAmount, breakdown.baseCost);
  assert.equal(breakdown.groups.find((group) => group.id === "packaging").amount, 700);
  assert.equal(breakdown.groups.find((group) => group.id === "other").amount, 600);
  assert.ok(breakdown.warnings.some((warning) => warning.code === "legacy_extras_with_supplies"), "type extras + catalog supplies are flagged");
});

test("margin is profit over sale price (not the markup) and handles zero/negative cases", () => {
  const result = pricing.calculateCalculatorPricing({ filamentCost: 1_000, electricityCost: 0, maintenanceCost: 0, fixedCost: 0, multiplier: 2 });
  assert.equal(result.profit, 1_000);
  assert.equal(result.marginPercent, 50, "x2 markup on a filament-only product = 50 % margin, not 100 %");
  assert.equal(pricing.calculateCalculatorPricing({ filamentCost: 0, electricityCost: 0, maintenanceCost: 0, fixedCost: 0, multiplier: 2 }).marginPercent, null);
  const loss = pricing.calculateCalculatorPricing({ filamentCost: 1_000, electricityCost: 0, maintenanceCost: 0, fixedCost: 0, multiplier: 0.5 });
  assert.equal(loss.marginPercent, -100);
  assert.ok(buildCostBreakdown({ pricing: loss }).warnings.some((warning) => warning.code === "negative_profit"));
});

test("profitability breakdown: top cost item, shares and a provisional flag when supplies lack a price", () => {
  const supplyPricing = priceSupplyLines(buildProductTypeSupplyLines("lampara", LAMP, CATALOG));
  const result = pricing.calculateCalculatorPricing({ filamentCost: 3_500, electricityCost: 450, maintenanceCost: 600, fixedCost: 0, multiplier: 2, suppliesCost: supplyPricing.total });
  const breakdown = buildCostBreakdown({ pricing: result, supplies: supplyPricing });
  assert.equal(breakdown.topItem.label, "Filamento");
  assert.equal(breakdown.groups.find((group) => group.id === "printing").amount, 4_550);
  assert.equal(Math.round(breakdown.groups.find((group) => group.id === "printing").share * 1000) / 1000, Math.round((4_550 / 9_300) * 1000) / 1000);
  assert.equal(breakdown.isProvisional, false);

  const withZero = priceSupplyLines(buildProductTypeSupplyLines("lampara", LAMP, CATALOG.map((supply) => (supply.id === "foco" ? { ...supply, unit_cost: 0 } : supply))));
  const provisional = buildCostBreakdown({
    pricing: pricing.calculateCalculatorPricing({ filamentCost: 3_500, electricityCost: 0, maintenanceCost: 0, fixedCost: 0, multiplier: 2, suppliesCost: withZero.total }),
    supplies: withZero,
  });
  assert.equal(provisional.isProvisional, true);
  assert.ok(provisional.warnings.some((warning) => warning.code === "zero_cost_supplies"));
});

test("archived supplies still in a product type keep counting with their last cost and are flagged", () => {
  const catalog = CATALOG.map((supply) => (supply.id === "foco" ? { ...supply, archived_at: "2026-11-16T00:00:00Z" } : supply));
  const priced = priceSupplyLines(buildProductTypeSupplyLines("lampara", LAMP, catalog));
  assert.equal(priced.total, 4_750);
  assert.equal(priced.archivedCount, 1);
  const breakdown = buildCostBreakdown({ pricing: pricing.calculateCalculatorPricing({ filamentCost: 1, electricityCost: 0, maintenanceCost: 0, fixedCost: 0, multiplier: 1, suppliesCost: priced.total }), supplies: priced });
  assert.ok(breakdown.warnings.some((warning) => warning.code === "archived_supplies"));
});

// ------------------------------------------------------------------------------------------------
// Actualización centralizada e historial
// ------------------------------------------------------------------------------------------------

test("changing one supply price once updates every product type that uses it (centralized update)", () => {
  const associations = [
    assoc("s", "lampara-chica", "foco", 1, "unit"),
    assoc("g", "lampara-grande", "foco", 2, "unit"),
    assoc("v", "velador", "foco", 1, "unit"),
  ];
  const ledCost = (catalog, type) => priceSupplyLines(buildProductTypeSupplyLines(type, associations, catalog)).total;
  assert.deepEqual(["lampara-chica", "lampara-grande", "velador"].map((type) => ledCost(CATALOG, type)), [1_500, 3_000, 1_500]);
  const raised = CATALOG.map((supply) => (supply.id === "foco" ? { ...supply, unit_cost: 1_800 } : supply));
  assert.deepEqual(["lampara-chica", "lampara-grande", "velador"].map((type) => ledCost(raised, type)), [1_800, 3_600, 1_800]);
});

test("saved snapshots keep historical costs; recalculation reprices with the current catalog and never drops supplies", () => {
  const snapshotSupplies = toSupplySnapshot(priceSupplyLines(buildProductTypeSupplyLines("lampara", LAMP, CATALOG)));
  const frozen = JSON.parse(JSON.stringify(snapshotSupplies));
  assert.equal(frozen.total_cost, 4_750);
  assert.equal(frozen.lines.find((line) => line.supply_id === "foco").unit_cost, 1_500);

  const raised = CATALOG.map((supply) => (supply.id === "foco" ? { ...supply, unit_cost: 1_800 } : supply));
  // El snapshot guardado no cambia solo:
  assert.equal(frozen.total_cost, 4_750);
  assert.deepEqual(changedSnapshotSupplies(frozen, raised), ["Foco LED"]);
  assert.deepEqual(changedSnapshotSupplies(frozen, CATALOG), []);
  assert.equal(repriceSupplySnapshot(frozen, raised).total, 5_050);
  assert.equal(repriceSupplySnapshot(frozen, null).total, 4_750, "without the catalog the saved cost is kept");
  assert.equal(repriceSupplySnapshot(frozen, CATALOG.filter((supply) => supply.id !== "foco")).total, 4_750, "deleted supply keeps its saved cost");
  assert.equal(repriceSupplySnapshot({ lines: "garbage" }, CATALOG).total, 0);

  const product = {
    calculation_snapshot: { source: "calculator", supplies: frozen, product_type_id: "lampara", printer_id: "p1" },
  };
  const status = getProductPricingStatus(product, [], [{ id: "p1" }], [{ id: "lampara" }], raised);
  assert.equal(status.needsRecalculation, true);
  assert.deepEqual(status.reasons, ["Cambió el costo de Foco LED"]);
  assert.equal(getProductPricingStatus(product, [], [{ id: "p1" }], [{ id: "lampara" }]).needsRecalculation, false, "callers without the catalog keep the old behavior");

  const recalculated = calculateProductPrice({
    components: [{ name: "Producto completo", quantity_per_product: 1, materials: [{ filament_id: "f", grams: 100, filament: { id: "f", purchase_price: 20_000, total_grams: 1_000 } }] }],
    printTimeMinutes: 0,
    printer: { id: "p1", power_watts: 0, maintenance_cost_per_hour: 0 },
    productType: { id: "lampara", multiplier: 2, fixed_cost: 0 },
    calculatorSettings: { default_error_percent: 0, electricity_price_kwh: 0 },
    oldSnapshot: product.calculation_snapshot,
    currentSupplies: raised,
  });
  assert.equal(recalculated.baseCost, 2_000 + 5_050);
  assert.equal(recalculated.salePrice, 4_000 + 5_050);
  assert.equal(recalculated.snapshot.supplies.total_cost, 5_050);
  assert.equal(recalculated.snapshot.supplies_cost, 5_050);
  assert.equal(recalculated.snapshot.supplies_contingency_percent, 0);
  assert.equal(recalculated.snapshot.supplies_contingency_amount, 0);

  const withContingency = calculateProductPrice({
    components: [{ name: "Producto completo", quantity_per_product: 1, materials: [{ filament_id: "f", grams: 100, filament: { id: "f", purchase_price: 20_000, total_grams: 1_000 } }] }],
    printTimeMinutes: 0,
    printer: { id: "p1", power_watts: 0, maintenance_cost_per_hour: 0 },
    productType: { id: "lampara", multiplier: 2, fixed_cost: 0 },
    calculatorSettings: { default_error_percent: 0, electricity_price_kwh: 0, supplies_contingency_percent: 5 },
    oldSnapshot: product.calculation_snapshot,
    currentSupplies: raised,
  });
  assert.equal(withContingency.baseCost, 2_000 + 5_050 + 252.5);
  assert.equal(withContingency.salePrice, 4_000 + 5_050 + 252.5);
  assert.equal(withContingency.profit, 2_000);
  assert.equal(withContingency.snapshot.supplies_contingency_amount, 252.5);

  const noSupplies = calculateProductPrice({
    components: [{ name: "Producto completo", quantity_per_product: 1, materials: [{ filament_id: "f", grams: 100, filament: { id: "f", purchase_price: 20_000, total_grams: 1_000 } }] }],
    printTimeMinutes: 0,
    productType: { id: "t", multiplier: 2, fixed_cost: 0 },
    oldSnapshot: { source: "calculator" },
  });
  assert.equal(noSupplies.salePrice, 4_000, "products saved without supplies recalculate exactly as before");
  assert.equal(noSupplies.snapshot.supplies, undefined);
});

test("Mi Taller: prices saved with the old 30 % surcharge are flagged, never rewritten; budgets/sales keep their amounts", () => {
  const legacySnapshot = {
    source: "calculator", fixed_cost: 2_000, other_costs_overhead_rate: 0.3, other_costs_overhead_amount: 600,
    base_cost: 3_300, sale_price: 4_800, printer_id: "p1", product_type_id: "t",
  };
  const legacyProduct = { sale_price: 4_800, calculation_snapshot: legacySnapshot };
  const frozen = JSON.stringify(legacyProduct);
  assert.equal(usesLegacySuppliesSurcharge(legacySnapshot), true);
  assert.equal(usesLegacySuppliesSurcharge({ fixedCostOverheadAmount: 30 }), true, "older camelCase snapshots too");
  const status = getProductPricingStatus(legacyProduct, [], [{ id: "p1" }], [{ id: "t" }], []);
  assert.equal(status.needsRecalculation, true);
  assert.deepEqual(status.reasons, [LEGACY_SURCHARGE_REASON]);
  assert.equal(JSON.stringify(legacyProduct), frozen, "the saved price and snapshot are not modified by the status check");

  // Sin insumos (recargo 0) o ya calculado con la regla nueva → no se marca.
  assert.equal(usesLegacySuppliesSurcharge({ source: "calculator", other_costs_overhead_rate: 0.3, other_costs_overhead_amount: 0 }), false);
  assert.equal(usesLegacySuppliesSurcharge({ source: "calculator", supplies_contingency_percent: 5, other_costs_overhead_amount: 100 }), false);
  assert.equal(usesLegacySuppliesSurcharge(null), false);

  // Recalcular (acción explícita del usuario) aplica la regla nueva y deja de marcarlo.
  const recalculated = calculateProductPrice({
    components: [{ name: "Producto completo", quantity_per_product: 1, materials: [{ filament_id: "f", grams: 100, filament: { id: "f", purchase_price: 5_000, total_grams: 1_000 } }] }],
    printTimeMinutes: 0,
    printer: { id: "p1", power_watts: 0, maintenance_cost_per_hour: 0 },
    productType: { id: "t", multiplier: 4, fixed_cost: 2_000 },
    calculatorSettings: { default_error_percent: 0, electricity_price_kwh: 0 },
    oldSnapshot: legacySnapshot,
  });
  assert.equal(recalculated.salePrice, 500 * 4 + 2_000);
  assert.equal(recalculated.snapshot.other_costs_overhead_amount, 0);
  assert.equal(usesLegacySuppliesSurcharge(recalculated.snapshot), false);

  // Presupuestos y ventas copian importes al crearse: el motor no los lee ni los reescribe.
  const budgetCalculation = readRepoFile("src/lib/budgets/calculation.ts");
  assert.doesNotMatch(budgetCalculation, /calculateCalculatorPricing|calculateProductPrice/);
});

// ------------------------------------------------------------------------------------------------
// Integración en la página
// ------------------------------------------------------------------------------------------------

test("calculator page feeds catalog supplies to the single engine and freezes them in the saved snapshot", () => {
  const page = readRepoFile("src/app/calculadora/page.tsx");
  assert.match(page, /suppliesCost: supplyPricing\?\.total \?\? 0/);
  assert.match(page, /supplies: toSupplySnapshot\(supplyPricing\)/);
  assert.match(page, /accessMode !== "paid" \|\| !suppliesData\.available/, "Free/Anonymous never load or use supplies");
  assert.match(page, /legacyExtrasRaw: numFixedCost \+ numOtherCost/, "the old 'Insumos extra' line keeps its meaning");
  assert.doesNotMatch(page, /from\("calculator_supplies"\)\.(insert|update|delete)/, "the calculator page only reads the catalog");
});

test("no part of the calculator still applies or advertises the removed 30 % surcharge", () => {
  // Lógica: ningún factor 1.3 ni tasa 0.3 (los comentarios pueden mencionar la regla anterior).
  for (const file of ["src/lib/calculator/pricing.ts", "src/lib/calculator/cost-breakdown.ts", "src/lib/stampy/screen-analysis.ts", "src/lib/products/pricing.ts"]) {
    assert.doesNotMatch(readRepoFile(file), /\* ?1\.3\b|=\s*0\.3\b/, file);
  }
  // Pantallas: ningún texto que prometa el 30 %.
  for (const file of [
    "src/app/calculadora/page.tsx",
    "src/components/calculadora/cost-breakdown-cards.tsx",
    "src/components/calculadora/product-type-supplies-editor.tsx",
    "src/components/configuracion/product-types-manager.tsx",
  ]) {
    assert.doesNotMatch(readRepoFile(file), /\* ?1\.3\b|30 ?%/, file);
  }
  const settings = readRepoFile("src/components/configuracion/settings-manager.tsx");
  assert.match(settings, /Contingencias sobre insumos \(%\)/);
  assert.match(settings, /"supplies_contingency_percent" in data/, "the field only appears once the column exists");
});
