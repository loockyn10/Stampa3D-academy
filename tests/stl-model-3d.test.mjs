import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function load(relativePath, deps = {}) {
  const filename = path.join(root, relativePath);
  const { outputText } = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const m = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (r) => {
      if (r in deps) return deps[r];
      throw new Error(`Unexpected dependency: ${r}`);
    },
    m,
    m.exports,
  );
  return m.exports;
}

const lib = load("src/lib/stl/library.ts");
const parseMod = load("src/lib/stl/parse-model.ts", { "@/lib/stl/library": lib });
const payloadMod = load("src/lib/stl/model-payload.ts");

const fakeGeometry = (count) => ({ getAttribute: () => ({ count }) });
const fakeGroup = (meshCounts) => ({
  traverse(cb) {
    cb({ traverse() {} });
    meshCounts.forEach((count) => cb({ isMesh: true, geometry: fakeGeometry(count), traverse() {} }));
  },
});
function spyLoaders(stlResult, mfResult) {
  const calls = [];
  return {
    calls,
    loaders: {
      stl: () => ({ parse: () => { calls.push("stl"); return stlResult; } }),
      "3mf": () => ({ parse: () => { calls.push("3mf"); return mfResult; } }),
    },
  };
}
const unavailable = () => { throw new Error("n/a"); };

// ------------------------------------------------------------ selección de loader
test("selecciona el loader de STL para stl y el de 3MF para 3mf", () => {
  let spy = spyLoaders(fakeGeometry(3), fakeGroup([3]));
  assert.equal(parseMod.parseModel3D("stl", new ArrayBuffer(1), spy.loaders).format, "stl");
  assert.deepEqual(spy.calls, ["stl"]);

  spy = spyLoaders(fakeGeometry(3), fakeGroup([3, 6]));
  const parsed = parseMod.parseModel3D("3mf", new ArrayBuffer(1), spy.loaders);
  assert.equal(parsed.format, "3mf");
  assert.ok(parsed.group, "3MF devuelve una jerarquía/group");
  assert.deepEqual(spy.calls, ["3mf"]);
});

test("el viewer importa ambos loaders oficiales de Three.js y delega en parseModel3D", () => {
  const v = read("src/components/stl/Model3DViewer.tsx");
  assert.match(v, /loaders\/STLLoader\.js/);
  assert.match(v, /loaders\/3MFLoader\.js/);
  assert.match(v, /parseModel3D\(format,/);
  assert.match(v, /data\.format/, "el formato viene de la respuesta del servidor");
});

test("3MF sin mallas o STL vacío -> Model3DLoadError(empty)", () => {
  const spy = spyLoaders(fakeGeometry(0), fakeGroup([0]));
  for (const format of ["stl", "3mf"]) {
    assert.throws(
      () => parseMod.parseModel3D(format, new ArrayBuffer(1), spy.loaders),
      (e) => e.name === "Model3DLoadError" && e.code === "empty",
    );
  }
});

// ------------------------------------------------------------ archivos corruptos con loaders reales
test("STL corrupto (STLLoader real) no rompe: error controlado con copy de STL", async () => {
  const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
  const bad = new TextEncoder().encode("garbage garbage garbage").buffer;
  let error;
  try {
    parseMod.parseModel3D("stl", bad, { stl: () => new STLLoader(), "3mf": unavailable });
  } catch (e) {
    error = e;
  }
  assert.equal(error?.code, "corrupt");
  assert.equal(parseMod.describeModel3DLoadError(error).title, "Archivo dañado");
});

test("STL válido (STLLoader real) se parsea", async () => {
  const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
  const buf = new ArrayBuffer(84 + 50);
  const dv = new DataView(buf);
  dv.setUint32(80, 1, true);
  [0, 0, 0, 10, 0, 0, 0, 10, 5].forEach((n, i) => dv.setFloat32(96 + i * 4, n, true));
  const parsed = parseMod.parseModel3D("stl", buf, { stl: () => new STLLoader(), "3mf": unavailable });
  assert.equal(parsed.geometry.getAttribute("position").count, 3);
});

test("3MF corrupto (ThreeMFLoader real) no rompe y el copy no menciona STL", async () => {
  const { ThreeMFLoader } = await import("three/examples/jsm/loaders/3MFLoader.js");
  for (const bad of [new TextEncoder().encode("not a zip").buffer, new ArrayBuffer(0)]) {
    let error;
    try {
      parseMod.parseModel3D("3mf", bad, { stl: unavailable, "3mf": () => new ThreeMFLoader() });
    } catch (e) {
      error = e;
    }
    assert.equal(error?.code, "corrupt");
    const copy = parseMod.describeModel3DLoadError(error);
    assert.equal(copy.title, "El archivo 3D no pudo cargarse");
    assert.doesNotMatch(copy.title + copy.detail, /STL/);
  }
});

test("el límite de 60 MB aplica a STL y 3MF: una sola ruta de descarga", () => {
  assert.equal(lib.STL_VIEWER_MAX_BYTES, 60 * 1024 * 1024);
  const v = read("src/components/stl/Model3DViewer.tsx");
  assert.equal((v.match(/readWithLimit\(/g) || []).length, 2); // definición + única llamada
});

// ------------------------------------------------------------ creación de modelo (stl_models.name NOT NULL)
const formValues = (extra = {}) => ({
  title: "PIKACHU FLEXIBLE", description: "", difficulty: "beginner", estimated_print_time: "",
  material_type: "", thumbnail_url: "", is_active: true, category_id: "", ...extra,
});

test("crear modelo: el título del formulario se mapea a stl_models.name (nunca null)", () => {
  const payload = payloadMod.buildStlModelPayload(formValues({ title: "  PIKACHU FLEXIBLE " }));
  assert.equal(payload.name, "PIKACHU FLEXIBLE");
  assert.equal(payload.title, "PIKACHU FLEXIBLE");
  assert.notEqual(payload.name, null);
  assert.equal(payload.category_id, null);
  assert.equal(payloadMod.buildStlModelPayload(formValues({ category_id: "g1" })).category_id, "g1");
});

test("crear modelo: título vacío se rechaza antes de llegar a la DB", () => {
  assert.throws(() => payloadMod.buildStlModelPayload(formValues({ title: "   " })));
});

test("el formulario usa los builders en insert/update y reporta el error de la variante", () => {
  const variant = payloadMod.buildStlVariantPayload("m1", formValues(), "storage://stl-files/x.3mf");
  assert.equal(variant.name, "PIKACHU FLEXIBLE");
  assert.equal(variant.model_id, "m1");
  const form = read("src/components/admin/stl-model-form.tsx");
  assert.match(form, /buildStlModelPayload\(formData\)/);
  assert.match(form, /buildStlVariantPayload\(/);
  assert.match(form, /\.insert\(\[payload\]\)/);
  assert.match(form, /\.update\(payload\)/);
  assert.match(form, /variantResult\.error/);
});

test("nombre para mostrar: title, y si falta, name", () => {
  assert.equal(payloadMod.stlModelDisplayName({ title: "", name: "Solo name" }), "Solo name");
  assert.equal(payloadMod.stlModelDisplayName({ title: "T", name: "N" }), "T");
});

// ------------------------------------------------------------ visibilidad del grupo
test("FLEXIBLES: oculto con 0 modelos publicados, visible al publicar su primer modelo", () => {
  const groups = [{ id: "flex", name: "FLEXIBLES", slug: "flexibles", description: null, thumbnail_url: null, sort_order: 0, is_active: true }];
  const m = (extra) => ({ id: "m1", category_id: "flex", is_active: true, ...extra });
  assert.deepEqual(lib.buildGroupSummaries(groups, []), []);
  assert.deepEqual(lib.buildGroupSummaries(groups, [m({ is_active: false })]), []);
  assert.deepEqual(lib.buildGroupSummaries(groups, [m()]).map((g) => [g.name, g.modelCount]), [["FLEXIBLES", 1]]);
});

// ------------------------------------------------------------ descarga sin regresión
test("la descarga existente no cambió", () => {
  const dl = read("src/app/api/stl/download/route.ts");
  assert.match(dl, /capabilities\.downloadStl/);
  assert.match(dl, /createSignedUrl\(parsedRef\.path, 60, \{ download: true \}\)/);
  assert.match(read("src/components/stl/StlDownloadButton.tsx"), /\/api\/stl\/download/);
});
