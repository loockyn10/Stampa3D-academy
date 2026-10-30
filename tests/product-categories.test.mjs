import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const lib = loadTs("src/lib/products/categories.ts");

test("category names are trimmed, collapsed and compared ignoring case and spacing", () => {
  assert.equal(lib.normalizeProductCategoryName("  Lámparas   de   mesa "), "Lámparas de mesa");
  assert.equal(lib.productCategoryKey("  LÁMPARAS  "), lib.productCategoryKey("lámparas"));
  assert.notEqual(lib.productCategoryKey("Lamparas"), lib.productCategoryKey("Lámparas"), "accents are not folded (matches name_key in SQL)");
  const categories = [{ id: "a", name: "Lámparas" }, { id: "b", name: "Macetas" }];
  assert.equal(lib.findDuplicateProductCategory(categories, "  lámparas ")?.id, "a");
  assert.equal(lib.findDuplicateProductCategory(categories, "Lámparas", "a"), undefined, "renaming to itself is not a duplicate");
  assert.equal(lib.findDuplicateProductCategory(categories, "Carteles"), undefined);
});

test("category name validation rejects empty and over-long names", () => {
  assert.equal(lib.validateProductCategoryName("   ").ok, false);
  assert.equal(lib.validateProductCategoryName(null).ok, false);
  assert.equal(lib.validateProductCategoryName("x".repeat(41)).ok, false);
  assert.deepEqual(lib.validateProductCategoryName(" Carteles "), { ok: true, name: "Carteles" });
  assert.equal(lib.validateProductCategoryName("x".repeat(40)).ok, true);
});

test("filter returns only the products of the selected category, uncategorized or all", () => {
  const products = [
    { id: 1, category_id: "lamp" },
    { id: 2, category_id: "lamp" },
    { id: 3, category_id: "pots" },
    { id: 4, category_id: null },
    { id: 5 },
  ];
  assert.deepEqual(lib.filterProductsByCategory(products, "lamp").map((p) => p.id), [1, 2]);
  assert.deepEqual(lib.filterProductsByCategory(products, lib.PRODUCT_CATEGORY_FILTER_NONE).map((p) => p.id), [4, 5]);
  assert.equal(lib.filterProductsByCategory(products, lib.PRODUCT_CATEGORY_FILTER_ALL).length, 5);
  assert.deepEqual(lib.filterProductsByCategory(products, "missing"), []);

  const counts = lib.countProductsByCategory(products);
  assert.equal(counts.total, 5);
  assert.equal(counts.uncategorized, 2);
  assert.equal(counts.byCategory.get("lamp"), 2);
});

test("a filter pointing at a deleted category falls back to all", () => {
  const categories = [{ id: "lamp", name: "Lámparas" }];
  assert.equal(lib.resolveProductCategoryFilter("lamp", categories), "lamp");
  assert.equal(lib.resolveProductCategoryFilter("gone", categories), lib.PRODUCT_CATEGORY_FILTER_ALL);
  assert.equal(lib.resolveProductCategoryFilter(lib.PRODUCT_CATEGORY_FILTER_NONE, categories), lib.PRODUCT_CATEGORY_FILTER_NONE);
});

test("categories are sorted alphabetically with Spanish collation", () => {
  const sorted = lib.sortProductCategories([{ id: "1", name: "Macetas" }, { id: "2", name: "Álbumes" }, { id: "3", name: "carteles" }]);
  assert.deepEqual(sorted.map((c) => c.name), ["Álbumes", "carteles", "Macetas"]);
});

const migration = read("supabase/migrations/20261101120000_product_categories.sql");

test("migration is additive and keeps existing products uncategorized", () => {
  assert.match(migration, /create table if not exists public\.product_categories/);
  assert.match(migration, /alter table public\.products add column if not exists category_id uuid;/);
  assert.doesNotMatch(migration, /\bdrop table\b|\bdrop column\b|\btruncate\b|\bdelete from\b/i);
  assert.doesNotMatch(migration, /update public\.products/i, "no automatic data changes in production");
  assert.doesNotMatch(migration, /category_id uuid not null/i);
});

test("migration enforces ownership, uniqueness and non-destructive deletion in the database", () => {
  assert.match(migration, /unique \(user_id, name_key\)/);
  assert.match(migration, /lower\(regexp_replace\(btrim\(name\), '\\s\+', ' ', 'g'\)\)/);
  assert.match(migration, /foreign key \(category_id, user_id\)\s+references public\.product_categories \(id, user_id\)\s+on delete set null \(category_id\)/);
  assert.match(migration, /enable row level security/);
  for (const op of ["select", "insert", "update", "delete"]) {
    assert.match(migration, new RegExp(`product_categories_${op}_own[\\s\\S]*?user_id = auth\\.uid\\(\\)`));
  }
  assert.match(migration, /grant update \(name\) on table public\.product_categories to authenticated/);
  assert.match(migration, /revoke all on table public\.product_categories from anon, authenticated/);
});

const actions = read("src/app/productos/category-actions.ts");

test("category server actions authorize, scope by session user and never trust the client user id", () => {
  assert.match(actions, /getCurrentUserAccess\(supabase\)/);
  assert.match(actions, /access\.capabilities\.accessPlatform/);
  assert.match(actions, /isFeatureAvailable\(supabase, "mi_taller", access\)/);
  assert.match(actions, /insert\(\{ user_id: auth\.userId, name: validation\.name \}\)/);
  assert.equal((actions.match(/\.eq\("user_id", auth\.userId\)/g) || []).length >= 3, true);
  assert.match(actions, /UNIQUE_VIOLATION/);
  assert.doesNotMatch(actions, /from\("products"\)[\s\S]{0,80}\.(update|delete)\(/, "deleting a category must not touch products directly");
});

const page = read("src/app/productos/page.tsx");

test("products page wires category filter, form field, persistence and badge without replacing the screen", () => {
  assert.match(page, /<ProductCategoryBar/);
  assert.match(page, /<ProductCategoryField/);
  assert.match(page, /payload\.category_id = formData\.category_id \|\| null/);
  assert.match(page, /category_id: p\.category_id \|\| ""/);
  assert.match(page, /filterProductsByCategory\(recalculationScoped, activeCategoryFilter\)/);
  assert.match(page, /needsRecalculationOnly/, "existing Dashboard filter is preserved");
  assert.match(page, /if \(categoriesAvailable\) payload\.category_id/, "does not write category_id before the migration is applied");
});

const ui = read("src/components/products/product-categories.tsx");

test("category UI confirms deletion, explains that products are kept and supports creating from the product form", () => {
  assert.match(ui, /confirmAction\(\{[\s\S]*¿Eliminar categoría\?[\s\S]*destructive: true/);
  assert.match(ui, /no se eliminan: quedan sin categoría/);
  assert.match(ui, /Nueva categoría/);
  assert.match(ui, /export function ProductCategoryField/);
  assert.match(ui, /if \(category\) onChange\(category\.id\)/, "a category created from the form is selected on the product");
  assert.match(ui, /findDuplicateProductCategory/);
  assert.match(ui, /overflow-x-auto/, "chips scroll on mobile");
});
