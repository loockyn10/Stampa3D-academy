import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadCropModule() {
  const filename = path.join(root, "src/lib/images/crop.ts");
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    () => { throw new Error("The crop geometry module must stay dependency-free"); },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const crop = loadCropModule();

test("cover geometry never exposes empty space and clamps both axes", () => {
  const image = { width: 2000, height: 1000 };
  const frame = { width: 400, height: 400 };

  assert.equal(crop.getCoverScale(image, frame), 0.4);
  assert.deepEqual(
    crop.clampCropOffset({ image, frame, zoom: 1, offset: { x: 999, y: 999 } }),
    { x: 200, y: 0 },
  );
  assert.deepEqual(
    crop.clampCropOffset({ image, frame, zoom: 1, offset: { x: -999, y: -999 } }),
    { x: -200, y: 0 },
  );
});

test("source rectangle matches the centered square visible in the editor", () => {
  const source = crop.getCropSourceRect({
    image: { width: 2000, height: 1000 },
    frame: { width: 400, height: 400 },
    zoom: 1,
    offset: { x: 0, y: 0 },
  });

  assert.deepEqual(source, {
    x: 500,
    y: 0,
    width: 1000,
    height: 1000,
    scale: 0.4,
  });
});

test("dragging and zooming change the physical source crop deterministically", () => {
  const leftEdge = crop.getCropSourceRect({
    image: { width: 2000, height: 1000 },
    frame: { width: 400, height: 400 },
    zoom: 1,
    offset: { x: 200, y: 0 },
  });
  assert.equal(leftEdge.x, 0);

  const zoomed = crop.getCropSourceRect({
    image: { width: 2000, height: 1000 },
    frame: { width: 400, height: 400 },
    zoom: 2,
    offset: { x: 0, y: 0 },
  });
  assert.deepEqual(zoomed, {
    x: 750,
    y: 250,
    width: 500,
    height: 500,
    scale: 0.8,
  });
});

test("preview reproduces the exact physical crop without applying a second crop", () => {
  const image = { width: 2400, height: 1600 };
  const source = crop.getCropSourceRect({
    image,
    frame: { width: 480, height: 270 },
    zoom: 1.25,
    offset: { x: 75, y: -20 },
  });
  const preview = { width: 320, height: 180 };
  const layout = crop.getCropPreviewLayout({ image, source, preview });

  assert.equal(layout.left, -source.x * (preview.width / source.width));
  assert.equal(layout.top, -source.y * (preview.height / source.height));
  assert.equal(layout.width, image.width * (preview.width / source.width));
  assert.equal(layout.height, image.height * (preview.height / source.height));
});

test("course and workshop covers share one 16:9 preset and one public card frame", () => {
  const preset = fs.readFileSync(path.join(root, "src/lib/images/presets.ts"), "utf8");
  const card = fs.readFileSync(path.join(root, "src/components/cards/course-card.tsx"), "utf8");
  const form = fs.readFileSync(path.join(root, "src/components/admin/course-form.tsx"), "utf8");

  assert.match(preset, /COURSE_COVER_ASPECT_RATIO = 16 \/ 9/);
  assert.match(preset, /COURSE_COVER_OUTPUT_WIDTH = 1280/);
  assert.match(preset, /COURSE_COVER_OUTPUT_HEIGHT = 720/);
  assert.match(preset, /showGrid: true/);
  assert.match(card, /aspect-video/);
  assert.doesNotMatch(card, /flex-\[7\]|group-hover:scale-105/);
  assert.match(form, /getCourseCoverImageEditorConfig/);
  assert.match(form, /course_kind === "workshop"/);
});

test("all real raster uploaders use the shared editor and non-image uploads do not", () => {
  const files = {
    raffle: fs.readFileSync(path.join(root, "src/app/admin/sorteos/[id]/page.tsx"), "utf8"),
    products: fs.readFileSync(path.join(root, "src/app/productos/page.tsx"), "utf8"),
    calculator: fs.readFileSync(path.join(root, "src/app/calculadora/page.tsx"), "utf8"),
    business: fs.readFileSync(path.join(root, "src/components/configuracion/business-manager.tsx"), "utf8"),
    variants: fs.readFileSync(path.join(root, "src/components/admin/stl-variants-manager.tsx"), "utf8"),
    course: fs.readFileSync(path.join(root, "src/components/admin/course-form.tsx"), "utf8"),
  };

  assert.equal((files.raffle.match(/imageEditor=/g) ?? []).length, 2);
  for (const name of ["products", "calculator", "business", "variants"]) {
    assert.equal((files[name].match(/imageEditor=/g) ?? []).length, 1, `${name} must use the shared editor`);
  }
  assert.match(files.course, /<ImageCropEditor/);
  assert.doesNotMatch(files.variants, /accept="\.stl[^\n]+imageEditor=/);
  assert.doesNotMatch(files.business, /accept="[^"]*\.svg/);
  assert.doesNotMatch(files.products, /accept="[^"]*\.svg/);
});
