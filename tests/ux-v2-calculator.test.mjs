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

test("precio Mercado Libre: comisión sobre el precio final conserva el ingreso neto", () => {
  // (1000 + 200 + 300) / (1 - 0.15) = 1764.705… → 1764.71 (redondeo hacia arriba al centavo)
  const result = calculateMarketplacePrice({ salePrice: 1000, commissionPercent: 15, fixedFee: 200, shippingCost: 300 });
  assert.equal(result.status, "ok");
  assert.equal(result.price, 1764.71);
  assert.equal(result.commissionAmount, 264.71);
  assert.equal(result.netReceived, 1000);
  assert.equal(result.isConfigured, true);
  // Antes se sumaba la comisión sobre el sugerido (1650): el neto quedaba por debajo del sugerido.
  assert.ok(result.price > 1650);
});

test("precio Mercado Libre: el neto nunca queda por debajo del precio sugerido por redondeo", () => {
  for (const [sale, pct, fee, ship] of [[999.99, 13, 0, 0], [1234.56, 16.5, 99.9, 1500], [1, 99.9, 0, 0], [7182, 15, 0, 0]]) {
    const r = calculateMarketplacePrice({ salePrice: sale, commissionPercent: pct, fixedFee: fee, shippingCost: ship });
    const net = r.price * (1 - pct / 100) - fee - ship;
    assert.ok(net >= sale - 1e-6, `${sale}/${pct}: neto ${net}`);
    assert.equal(Math.round(r.price * 100) / 100, r.price, "redondeado al centavo");
  }
});

test("precio Mercado Libre: otros costos de venta se recuperan y los negativos se ignoran", () => {
  const r = calculateMarketplacePrice({ salePrice: 900, commissionPercent: 10, fixedFee: -50, shippingCost: 0, otherSellingCosts: 90 });
  assert.equal(r.price, 1100);
  assert.equal(r.fixedFee, 0);
  assert.equal(r.netReceived, 900);
});

test("precio Mercado Libre: sin comisión o con comisión inválida no se presenta estimación", () => {
  const none = calculateMarketplacePrice({ salePrice: 1000, commissionPercent: 0, fixedFee: 0, shippingCost: 0 });
  assert.equal(none.status, "not_configured");
  assert.equal(none.price, 0);
  assert.equal(none.isConfigured, false);
  for (const pct of [100, 150, -5, Number.NaN]) {
    const r = calculateMarketplacePrice({ salePrice: 1000, commissionPercent: pct, fixedFee: 0, shippingCost: 0 });
    assert.equal(r.status, "invalid_commission", String(pct));
    assert.equal(r.price, 0);
  }
});

test("configuración: la comisión se valida en [0, 100) antes de guardar", () => {
  const settings = read("src/components/configuracion/settings-manager.tsx");
  assert.match(settings, /export function validateCalculatorSettings/);
  assert.match(settings, /platform_commission_percent >= 100/);
  assert.match(settings, /const validationError = validateCalculatorSettings\(payload\)/);
});

test("la Calculadora usa el helper del motor y muestra la tarjeta ML en ambos modos", () => {
  assert.match(calculator, /calculateMarketplacePrice\(\{/);
  assert.doesNotMatch(calculator, /normalPrice \* numManualPlatformCommission/, "la fórmula no se duplica inline");
  assert.match(calculator, /const mlPrice = marketplace\.status === "ok" \? marketplace\.price : null/);
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
  assert.match(card, /result\.status === "not_configured"/);
  assert.match(card, /result\.status === "invalid_commission"/);
  assert.match(card, />Recibís</);
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
