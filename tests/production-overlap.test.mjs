// P2-13: aviso (no bloqueante) cuando el lote incluye un producto y una de sus partes. No cambia cálculos ni RPC.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const overlap = loadTs("src/lib/workshop/production-overlap.ts");
const P1 = { id: "p1", name: "Maceta" };
const P2 = { id: "p2", name: "Lámpara" };
const comp = (id, product, name) => ({ type: "component", product, component: { id, name } });

test("producto + una de sus partes → un aviso", () => {
  const found = overlap.findProductComponentOverlaps([{ type: "product", product: P1 }, comp("c1", P1, "Base")]);
  assert.deepEqual(found, [{ productName: "Maceta", componentNames: ["Base"] }]);
});

test("sin solapamiento no hay aviso: producto solo, parte sola o parte de OTRO producto", () => {
  assert.deepEqual(overlap.findProductComponentOverlaps([{ type: "product", product: P1 }]), []);
  assert.deepEqual(overlap.findProductComponentOverlaps([comp("c1", P1, "Base")]), []);
  assert.deepEqual(overlap.findProductComponentOverlaps([{ type: "product", product: P1 }, comp("c9", P2, "Pantalla")]), []);
});

test("varias partes del mismo producto se agrupan en un solo aviso", () => {
  const found = overlap.findProductComponentOverlaps([
    { type: "product", product: P1 },
    comp("c1", P1, "Base"),
    comp("c2", P1, "Tapa"),
    comp("c1", P1, "Base"),
  ]);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].componentNames, ["Base", "Tapa"]);
});

test("el texto explica que cada línea es una unidad adicional y que ambas descuentan", () => {
  const text = overlap.describeProductionOverlap({ productName: "Maceta", componentNames: ["Base"] });
  assert.match(text, /unidad adicional/);
  assert.match(text, /se descuenta en ambas/);
});

test("la pantalla solo agrega el aviso: cálculo del consumo y RPC intactos", () => {
  const page = read("src/app/stock/page.tsx");
  assert.match(page, /findProductComponentOverlaps\(consumeCart\)/);
  assert.match(page, /p_component_items = compItems\.map/);
  // el aviso no participa de la validez ni bloquea el botón de confirmar
  const guard = page.match(/isValid: insufficient\.length === 0[^\n]*/)[0];
  assert.doesNotMatch(guard, /overlap/i);
  assert.doesNotMatch(page, /disabled=\{[^}]*Overlap/);
});
