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
const deleteActionSource = actionSource.slice(
  actionSource.indexOf("export async function deleteProductAction"),
);

test("product deletion is authorized and constrained to the current owner", () => {
  assert.match(deleteActionSource, /getCurrentUserAccess\(supabase\)/);
  assert.match(deleteActionSource, /access\.capabilities\.accessPlatform/);
  assert.match(deleteActionSource, /\.eq\("id", productId\)[\s\S]*\.eq\("user_id", access\.userId\)/);
  assert.match(deleteActionSource, /No se encontró el producto o no te pertenece/);
});

test("safe deletion archives the product and recipe without changing stock", () => {
  assert.match(deleteActionSource, /from\("products"\)[\s\S]*update\(\{ is_active: false \}\)/);
  assert.match(deleteActionSource, /from\("product_components"\)[\s\S]*update\(\{ is_active: false \}\)/);
  assert.match(deleteActionSource, /from\("product_part_requirements"\)[\s\S]*update\(\{ is_active: false \}\)/);
  assert.doesNotMatch(deleteActionSource, /from\("filaments"\)/);
  assert.doesNotMatch(deleteActionSource, /from\("product_stock_movements"\)/);
  assert.doesNotMatch(deleteActionSource, /\.delete\(\)/);
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
