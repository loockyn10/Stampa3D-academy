import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const actionSource = fs.readFileSync(
  path.join(root, "src/app/productos/actions.ts"),
  "utf8",
);
const pageSource = fs.readFileSync(
  path.join(root, "src/app/productos/page.tsx"),
  "utf8",
);

test("product deletion is authorized and constrained to the current owner", () => {
  assert.match(actionSource, /getCurrentUserAccess\(supabase\)/);
  assert.match(actionSource, /access\.capabilities\.accessPlatform/);
  assert.match(actionSource, /\.eq\("id", productId\)[\s\S]*\.eq\("user_id", access\.userId\)/);
  assert.match(actionSource, /No se encontró el producto o no te pertenece/);
});

test("safe deletion archives the product and recipe without changing stock", () => {
  assert.match(actionSource, /from\("products"\)[\s\S]*update\(\{ is_active: false \}\)/);
  assert.match(actionSource, /from\("product_components"\)[\s\S]*update\(\{ is_active: false \}\)/);
  assert.match(actionSource, /from\("product_part_requirements"\)[\s\S]*update\(\{ is_active: false \}\)/);
  assert.doesNotMatch(actionSource, /from\("filaments"\)/);
  assert.doesNotMatch(actionSource, /from\("product_stock_movements"\)/);
  assert.doesNotMatch(actionSource, /\.delete\(\)/);
});

test("products page exposes a confirmed, loading-aware mobile delete flow", () => {
  assert.match(pageSource, /deleteProductAction\(deleteTarget\.id\)/);
  assert.match(pageSource, /¿Eliminar producto\?/);
  assert.match(pageSource, /Eliminar producto/);
  assert.match(pageSource, /deleteLoading \? "Eliminando\.\.\."/);
  assert.match(pageSource, /h-11 w-11/);
  assert.match(pageSource, /Producto eliminado\./);
});

test("archived products are excluded from the visible catalog", () => {
  assert.match(
    pageSource,
    /from\("products"\)[\s\S]*\.eq\("user_id", user\.id\)\.eq\("is_active", true\)/,
  );
});
