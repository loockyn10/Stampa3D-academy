import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
function loadTypeScriptModule(filename) {
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)((request) => { throw new Error(`Unexpected dependency: ${request}`); }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const storefront = loadTypeScriptModule(path.join(root, "src/lib/business/storefront.ts"));
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260907213952_business_storefront.sql"), "utf8");
const catalogMigration = fs.readFileSync(path.join(root, "supabase/migrations/20260907172205_business_catalog_foundation.sql"), "utf8");
const middleware = fs.readFileSync(path.join(root, "src/utils/supabase/middleware.ts"), "utf8");
const layout = fs.readFileSync(path.join(root, "src/app/main-layout.tsx"), "utf8");
const catalogPage = fs.readFileSync(path.join(root, "src/app/mi-negocio/catalogo/page.tsx"), "utf8");

test("storefront slugs are normalized and reserved routes fail closed", () => {
  assert.equal(storefront.normalizeStorefrontSlug("  Taller Ñandú 3D! "), "taller-nandu-3d");
  assert.equal(storefront.validateStorefrontSlug("mi-taller"), null);
  assert.match(storefront.validateStorefrontSlug("admin"), /reservado/i);
  assert.match(storefront.validateStorefrontSlug("a"), /3 caracteres/i);
});

test("public contact normalization and WhatsApp links are deterministic", () => {
  assert.equal(storefront.normalizePublicWhatsapp("+54 9 11 1234-5678"), "5491112345678");
  assert.equal(storefront.normalizePublicWhatsapp("123"), null);
  const url = storefront.buildWhatsappProductUrl("5491112345678", "Jarro Argentina", "Taller Sur");
  assert.match(url, /^https:\/\/wa\.me\/5491112345678\?text=/);
  assert.match(decodeURIComponent(url), /Jarro Argentina/);
});

test("public loaders map only the allowlisted DTO returned by RPCs", async () => {
  const client = { rpc(name) {
    if (name === "get_public_business_storefront") return Promise.resolve({ data: [{ store_slug: "taller-sur", store_name: "Taller Sur", store_description: "Objetos 3D", store_logo_url: null, store_banner_url: null, store_whatsapp: "5491112345678", store_public_email: null, user_id: "private", cost: 99 }], error: null });
    return Promise.resolve({ data: [{ product_slug: "jarro", product_name: "Jarro", product_category: "Hogar", product_description: "Argentina", product_price: 1500, product_image_url: null, product_available: true, purchase_cost: 20, supplier: "private", stock: 99 }], error: null });
  } };
  const store = await storefront.loadPublicStorefront(client, "taller-sur");
  const products = await storefront.loadPublicStorefrontProducts(client, "taller-sur");
  assert.deepEqual(Object.keys(store).sort(), ["bannerUrl", "description", "logoUrl", "name", "publicEmail", "slug", "whatsapp"]);
  assert.deepEqual(Object.keys(products[0]).sort(), ["available", "category", "description", "imageUrl", "name", "price", "slug"]);
});

test("inactive, missing and private storefront data is represented as unavailable", async () => {
  const emptyClient = { rpc() { return Promise.resolve({ data: [], error: null }); } };
  assert.equal(await storefront.loadPublicStorefront(emptyClient, "cerrada"), null);
  assert.deepEqual(await storefront.loadPublicStorefrontProducts(emptyClient, "cerrada"), []);
});

test("migration enforces one store, unique safe slugs and owner/public RLS", () => {
  assert.match(migration, /create table if not exists public\.business_storefronts/);
  assert.match(migration, /user_id uuid primary key/);
  assert.match(migration, /business_storefronts_slug_uidx/);
  assert.match(migration, /business_catalog_items_user_public_slug_uidx/);
  assert.match(migration, /business_storefronts_public_active[\s\S]*is_active = true/);
  assert.match(migration, /business_catalog_items_public_storefront[\s\S]*is_active = true and is_published = true/);
  assert.match(migration, /has_platform_access\(auth\.uid\(\)\)/);
  assert.doesNotMatch(migration, /grant select \([^)]*(?:user_id|created_at|updated_at|purchase_cost|supplier|stock_quantity)/);
  assert.doesNotMatch(migration, /\b(drop table|truncate|delete from)\b/i);
});

test("public RPC return contracts contain no costs, provider, ids or exact stock", () => {
  const publicFunctions = migration.slice(migration.indexOf("create or replace function public.get_public_business_storefront"), migration.indexOf("insert into storage.buckets"));
  const returnContracts = [...publicFunctions.matchAll(/returns table \(([\s\S]*?)\)\s+language sql/g)].map((match) => match[1]).join("\n");
  assert.match(publicFunctions, /product_available boolean/);
  assert.doesNotMatch(returnContracts, /purchase_cost|base_cost|supplier|user_id|product_id|stock_quantity|resale_stock_quantity|client|business_sales/);
  assert.match(publicFunctions, /join public\.business_catalog_items item on item\.user_id = store\.user_id/);
  assert.match(publicFunctions, /product\.user_id = store\.user_id/);
  assert.match(publicFunctions, /store\.is_active = true/);
  assert.match(publicFunctions, /item\.is_active = true and item\.is_published = true/);
  assert.match(publicFunctions, /security definer set search_path = ''/);
});

test("public storefront routing bypasses private auth chrome without broadening other routes", () => {
  for (const source of [middleware, layout]) {
    assert.match(source, /pathname === '\/tienda'/);
    assert.match(source, /pathname(?:\?)?\.startsWith\('\/tienda\/'\)/);
  }
  assert.match(layout, /if \(isPublicRoute\)[\s\S]*return <main/);
});

test("catalog publication remains opt-in and inactive products cannot be published", () => {
  assert.match(catalogPage, /setBusinessCatalogPublicationAction/);
  assert.match(catalogPage, /published: !item\.is_published/);
  assert.match(catalogPage, /disabled=\{!item\.is_active \|\| publishingId === item\.id\}/);
  assert.match(catalogMigration, /is_published boolean not null default false/);
});
