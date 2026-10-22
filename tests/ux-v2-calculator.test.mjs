import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadPricing() {
  const { outputText } = ts.transpileModule(read("src/lib/calculator/pricing.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const m = { exports: {} };
  new Function("require", "module", "exports", outputText)(() => {
    throw new Error("pricing.ts no debe tener dependencias");
  }, m, m.exports);
  return m.exports;
}

const { calculateMarketplacePrice } = loadPricing();
const calculator = read("src/app/calculadora/page.tsx");

test("precio Mercado Libre: misma fórmula histórica (sugerido + fijo + comisión sobre sugerido + envío)", () => {
  const result = calculateMarketplacePrice({ salePrice: 1000, commissionPercent: 15, fixedFee: 200, shippingCost: 300 });
  assert.equal(result.commissionAmount, 150);
  assert.equal(result.price, 1000 + 200 + 150 + 300);
  assert.equal(result.isConfigured, true);
});

test("precio Mercado Libre: sin comisión configurada no se presenta como estimación", () => {
  const result = calculateMarketplacePrice({ salePrice: 1000, commissionPercent: 0, fixedFee: 0, shippingCost: 0 });
  assert.equal(result.isConfigured, false);
  const negative = calculateMarketplacePrice({ salePrice: -5, commissionPercent: -10, fixedFee: Number.NaN, shippingCost: -1 });
  assert.equal(negative.price, 0);
  assert.equal(negative.isConfigured, false);
});

test("la Calculadora usa el helper del motor y muestra la tarjeta ML en ambos modos", () => {
  assert.match(calculator, /calculateMarketplacePrice\(\{/);
  assert.doesNotMatch(calculator, /normalPrice \* numManualPlatformCommission/, "la fórmula no se duplica inline");
  assert.match(calculator, /<MarketplacePriceCard/);
  // La tarjeta no está dentro de un `advanced &&`.
  const cardIndex = calculator.indexOf("<MarketplacePriceCard");
  const preceding = calculator.slice(Math.max(0, cardIndex - 200), cardIndex);
  assert.doesNotMatch(preceding, /\{advanced && \(/);
  assert.match(calculator, /marketplacePrice: Number\(calc\.mlPrice \|\| 0\)/, "Stampy sigue recibiendo el precio ML");
});

test("tarjeta ML: componente amarillo propio, pide configurar si falta la comisión", () => {
  const card = read("src/components/calculadora/marketplace-price-card.tsx");
  assert.match(card, /Precio Mercado Libre/);
  assert.match(card, /border-yellow-400/);
  assert.match(card, /bg-gradient-to-br from-yellow-400/);
  assert.match(card, /!result\.isConfigured/);
  assert.match(card, /No usamos porcentajes oficiales/);
});

test("Configurar valores abre un modal (no navega) y reutiliza los managers existentes", () => {
  assert.doesNotMatch(calculator, /href="\/configuracion\?tab=calculadora"/);
  assert.match(calculator, /onClick=\{\(\) => setSettingsModalTab\("costs"\)\}/);
  assert.match(calculator, /<CalculatorSettingsModal/);
  assert.match(calculator, /isPaid && settingsModalTab &&/, "solo Paid persiste configuración física");
  const modal = read("src/components/calculadora/calculator-settings-modal.tsx");
  assert.match(modal, /<Dialog/);
  assert.match(modal, /<SettingsManager embedded onSaved=\{onSettingsSaved\}/);
  assert.match(modal, /<ProductTypesManager onChanged=\{onProductTypesChanged\}/);
  assert.match(modal, /from\("printers"\)\.update\(payload\)\.eq\("id", printerId\)/);
  assert.doesNotMatch(modal, /from\("calculator_settings"\)/, "no hay una segunda escritura de settings");
});

test("guardar en el modal conserva el cálculo en curso (no llama a fetchData)", () => {
  const handlers = calculator.slice(
    calculator.indexOf("const handleSettingsSaved"),
    calculator.indexOf("const openMarketplaceConfiguration"),
  );
  assert.ok(handlers.length > 0);
  assert.doesNotMatch(handlers, /fetchData\(|setFilamentLines|setHours|setMinutes/);
  assert.match(handlers, /setManualPlatformCommission\(/);
});

test("encabezado compacto y guía rápida de modos y precios", () => {
  assert.doesNotMatch(calculator, /p-8 sm:p-10/);
  assert.doesNotMatch(calculator, /text-3xl font-bold text-white sm:text-4xl/);
  assert.match(calculator, /¿Cómo usar la calculadora\?/);
  for (const topic of ["Modo Básico:", "Modo Avanzado:", "Precio sugerido:", "Precio Mercado Libre:", "Configuración:"]) {
    assert.ok(calculator.includes(topic), topic);
  }
});

test("los diálogos de confirmación y toasts quedan por encima del Dialog compartido", () => {
  const feedback = read("src/components/ui/app-feedback.tsx");
  const dialog = read("src/components/ui/dialog.tsx");
  const dialogZ = Number(dialog.match(/z-\[(\d+)\]/)[1]);
  for (const [, z] of feedback.matchAll(/z-\[(\d+)\]/g)) assert.ok(Number(z) > dialogZ);
});
