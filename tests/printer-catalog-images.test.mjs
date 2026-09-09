import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const migration = read("supabase/migrations/20260909163023_printer_catalog_images.sql");
const admin = read("src/app/admin/impresoras/page.tsx");
const manager = read("src/components/configuracion/printers-manager.tsx");
const calculatorCatalog = read("src/components/calculadora/printer-catalog-modal.tsx");
const imageComponent = read("src/components/printers/PrinterCatalogImage.tsx");

function loadCatalogImageModule() {
  const filename = path.join(root, "src/lib/printers/catalog-image.ts");
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("module", "exports", outputText)(loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

test("catalog image schema is optional and belongs to printer_templates", () => {
  assert.match(migration, /alter table public\.printer_templates[\s\S]*add column if not exists image_path text/i);
  assert.match(migration, /image_path is null/i);
  assert.doesNotMatch(migration, /alter table public\.printers[\s\S]*add column/i);
});

test("public catalog bucket allows reads while every mutation requires admin", () => {
  assert.match(migration, /'printer-catalog-images',[\s\S]*true,[\s\S]*5242880/i);
  assert.match(migration, /array\['image\/jpeg', 'image\/png', 'image\/webp'\]/i);
  assert.match(migration, /for select to public[\s\S]*bucket_id = 'printer-catalog-images'/i);
  for (const operation of ["insert", "update", "delete"]) {
    assert.match(migration, new RegExp(`for ${operation} to authenticated[\\s\\S]*?public\\.is_admin\\(auth\\.uid\\(\\)\\)`, "i"));
  }
});

test("admin create and edit reuse the shared crop uploader and support removal", () => {
  assert.match(admin, /<FileUploadDropzone/);
  assert.match(admin, /getPrinterCatalogImageEditorConfig/);
  assert.match(admin, /pathPrefix=\{`printer-templates\/\$\{uploadPathId\}`\}/);
  assert.match(admin, /image_path: formData\.image_path/);
  assert.match(admin, /handleRemoveImage/);
  assert.match(admin, /removeStoredImage\(persistedImagePath\)/);
});

test("linked workshop printers and both catalog selectors render the shared image", () => {
  assert.match(manager, /\.select\("id, name, brand, model, printer_type, bed_size_x_mm, bed_size_y_mm, bed_size_z_mm, image_path"\)/);
  assert.match(manager, /imagePath=\{template\?\.image_path\}/);
  assert.match(manager, /imagePath=\{t\.image_path\}/);
  assert.match(calculatorCatalog, /imagePath=\{t\.image_path\}/);

  const managerImportPayload = manager.match(/const payload = \{[\s\S]*?source_template_id: template\.id,[\s\S]*?\n\s*\};/)?.[0] ?? "";
  const calculatorImportPayload = calculatorCatalog.match(/const payload = \{[\s\S]*?source_template_id: template\.id,[\s\S]*?\n\s*\};/)?.[0] ?? "";
  assert.ok(managerImportPayload);
  assert.ok(calculatorImportPayload);
  assert.doesNotMatch(managerImportPayload, /image_path|image_url/);
  assert.doesNotMatch(calculatorImportPayload, /image_path|image_url/);
});

test("missing and broken catalog images fall back without exposing a URL", () => {
  assert.match(imageComponent, /onError=\{\(\) => setFailedUrl\(imageUrl\)\}/);
  assert.match(imageComponent, /Sin imagen/);
  assert.match(imageComponent, /object-contain/);
  assert.match(imageComponent, /loading="lazy"/);
  assert.doesNotMatch(imageComponent, />\{imageUrl\}</);
});

test("catalog paths are normalized and the bucket is centralized", () => {
  const catalogImages = loadCatalogImageModule();
  assert.equal(catalogImages.PRINTER_CATALOG_IMAGES_BUCKET, "printer-catalog-images");
  assert.equal(catalogImages.normalizePrinterCatalogImagePath(" /printer-templates/id/photo.webp "), "printer-templates/id/photo.webp");
  assert.equal(catalogImages.normalizePrinterCatalogImagePath("  "), null);
  assert.equal(catalogImages.normalizePrinterCatalogImagePath(null), null);
});
