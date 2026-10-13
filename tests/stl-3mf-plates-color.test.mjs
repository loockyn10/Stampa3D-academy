import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { unzipSync, zipSync, strToU8 } from "three/examples/jsm/libs/fflate.module.js";
import { buildSlicer3mf, buildStandard3mf } from "./helpers/bambu-3mf-fixture.mjs";

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
const display = load("src/lib/stl/model-display.ts", {});
const pkg = load("src/lib/stl/three-mf-package.ts", {});
const prep = load("src/lib/stl/prepare-model.ts", {
  "@/lib/stl/library": lib,
  "@/lib/stl/model-display": display,
  "@/lib/stl/parse-model": parseMod,
  "@/lib/stl/three-mf-package": pkg,
});

// ------------------------------------------------------------------------------------ helpers
const DEFAULT_NAME = "__DEFAULT";
const unzip = unzipSync;
const bufferOf = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

/**
 * Imita la FORMA que devuelve ThreeMFLoader (verificada con el loader real en Chromium, ver docs):
 * Group raíz -> un Group por build item (en orden del <build>) -> un Group por componente -> Meshes
 * con material "__DEFAULT" (sin color en el archivo). Node no tiene DOMParser, por eso el loader es un doble.
 */
function fakeSlicerLoader(spec) {
  return {
    parse() {
      const group = new THREE.Group();
      let slot = 0;
      for (const id of spec.buildOrder) {
        const object = spec.objects.find((o) => o.id === id);
        const parts = object.parts ?? [{ partId: 65536 + id, size: object.size ?? 10 }];
        const item = new THREE.Group();
        for (const part of parts) {
          const component = new THREE.Group();
          const size = part.size ?? object.size ?? 10;
          component.add(new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshPhongMaterial({ name: DEFAULT_NAME, color: 0xffffff })));
          item.add(component);
        }
        const plateIndex = spec.plates.findIndex((ids) => ids.includes(id));
        slot += 1;
        item.position.set(plateIndex * 300 + slot, slot * 15, 0);
        item.name = `obj${id}`;
        group.add(item);
      }
      return group;
    },
  };
}
const loadersFor = (threeMfLoader) => ({ stl: () => new STLLoader(), "3mf": () => threeMfLoader });
const meshesOf = (object) => {
  const meshes = [];
  object.traverse((o) => o.isMesh && meshes.push(o));
  return meshes;
};
const colorsOf = (object) => meshesOf(object).map((m) => m.material.color.getHexString());

const SPEC = {
  objects: [
    { id: 1, extruder: 1, size: 20 },
    { id: 2, extruder: 2, size: 20 },
    { id: 3, extruder: 2, parts: [{ partId: 70001, extruder: 1, size: 12 }, { partId: 70002, size: 8 }] },
    { id: 4, extruder: 1, size: 20 },
  ],
  buildOrder: [1, 2, 3, 4], // el orden del build NO coincide con el de las camas
  plates: [[1, 3], [2], [4]],
};

async function prepare3mf(spec, extra = {}) {
  const bytes = buildSlicer3mf({ ...spec, ...extra });
  return prep.prepareModelForDisplay(THREE, "3mf", bufferOf(bytes), {
    deps: { loaders: loadersFor(fakeSlicerLoader(spec)), unzipSync: unzip },
  });
}

const CUBE_STL = `solid cube
facet normal 0 0 -1
 outer loop
  vertex 0 0 0
  vertex 10 0 0
  vertex 10 10 0
 endloop
endfacet
endsolid cube`;

// ===================================================================== PLATES (1-8)
test("1. STL no usa plates: geometría completa, material neutro, sin selectedPlate", async () => {
  const buf = new TextEncoder().encode(CUBE_STL).buffer;
  const prepared = await prep.prepareModelForDisplay(THREE, "stl", buf, { deps: { loaders: loadersFor(null), unzipSync: unzip } });
  assert.equal(prepared.format, "stl");
  assert.equal(prepared.selectedPlate, null);
  assert.equal(prepared.plateCount, null);
  assert.equal(prepared.colorMode, "neutral");
  assert.equal(prepared.object3d.material.color.getHex(), 0xc8ccd4);
  prepared.dispose();
});

test("2. 3MF genérico (sin metadata de slicer): build completo, sin plates", async () => {
  const prepared = await prep.prepareModelForDisplay(THREE, "3mf", bufferOf(buildStandard3mf()), {
    deps: { loaders: loadersFor({ parse: () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), new THREE.MeshPhongMaterial({ name: DEFAULT_NAME }))); g.add(new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), new THREE.MeshPhongMaterial({ name: DEFAULT_NAME }))); return g; } }), unzipSync: unzip },
  });
  assert.equal(prepared.selectedPlate, null);
  assert.equal(prepared.plateCount, null);
  assert.equal(prepared.slicer, null);
  assert.equal(prepared.fallbackReason, null);
  assert.equal(prepared.object3d.children.length, 2, "ningún child descartado");
});

test("3. Bambu multiplate: detecta la cantidad de camas", async () => {
  const prepared = await prepare3mf(SPEC);
  assert.equal(prepared.slicer, "bambu");
  assert.equal(prepared.plateCount, 3);
  const info = pkg.inspect3mfPackage(bufferOf(buildSlicer3mf(SPEC)), unzip);
  assert.equal(info.kind, "slicer");
  assert.deepEqual(info.plates.map((p) => p.plateId), [1, 2, 3]);
});

test("4. selecciona la Plate 1 real por metadata (model_instance), no por posición", async () => {
  const prepared = await prepare3mf(SPEC);
  assert.equal(prepared.selectedPlate, 0);
  // Plate 1 = objetos 1 y 3 (items 0 y 2 del build); el objeto 2 está en el medio del build y queda fuera.
  assert.deepEqual(prepared.object3d.children.map((c) => c.name), ["obj1", "obj3"]);
});

test("5. la geometría de las otras camas no aparece (bounding box = solo Plate 1)", async () => {
  const prepared = await prepare3mf(SPEC);
  const box = new THREE.Box3().setFromObject(prepared.object3d);
  assert.ok(box.max.x < 100, `x máx ${box.max.x}: nada de camas 2/3 (offset 300+)`);
  assert.equal(meshesOf(prepared.object3d).length, 3);
});

test("6. una sola cama (Bambu y Orca) conserva todo el contenido", async () => {
  const single = { objects: SPEC.objects.slice(0, 2), buildOrder: [1, 2], plates: [[1, 2]] };
  for (const slicer of ["bambu", "orca"]) {
    const prepared = await prepare3mf(single, { slicer });
    assert.equal(prepared.slicer, slicer);
    assert.equal(prepared.plateCount, 1);
    assert.equal(prepared.selectedPlate, 0);
    assert.equal(prepared.object3d.children.length, 2);
  }
});

test("7. metadata incompleta o inconsistente -> fallback seguro al build completo", async () => {
  const cases = {
    "sin <plate>": { omitPlates: true },
    "sin model_settings": { omitSettings: true },
  };
  for (const [label, extra] of Object.entries(cases)) {
    const prepared = await prepare3mf(SPEC, extra);
    assert.equal(prepared.selectedPlate, null, label);
    assert.equal(prepared.object3d.children.length, 4, `${label}: build completo`);
  }
  // instancia que apunta a un objeto inexistente
  const bad = unzipSync(buildSlicer3mf(SPEC));
  bad["Metadata/model_settings.config"] = strToU8(new TextDecoder().decode(bad["Metadata/model_settings.config"]).replace('value="3"/>\n      <metadata key="instance_id"', 'value="99"/>\n      <metadata key="instance_id"'));
  const info = pkg.inspect3mfPackage(bufferOf(zipSync(bad)), unzip);
  assert.equal(info.kind, "generic");
  assert.equal(info.reason, "instancia-sin-build-item");
  // children del loader no coinciden con el build -> no se toca nada
  const prepared = await prep.prepareModelForDisplay(THREE, "3mf", bufferOf(buildSlicer3mf(SPEC)), {
    deps: { loaders: loadersFor({ parse: () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ name: DEFAULT_NAME }))); return g; } }), unzipSync: unzip },
  });
  assert.equal(prepared.selectedPlate, null);
  assert.equal(prepared.fallbackReason, "plate-no-seleccionable");
  assert.equal(prepared.object3d.children.length, 1);
});

test("8. la selección interna acepta un plateIndex futuro (select3mfPlate)", async () => {
  const info = pkg.inspect3mfPackage(bufferOf(buildSlicer3mf(SPEC)), unzip);
  const group = fakeSlicerLoader(SPEC).parse();
  const second = prep.select3mfPlate(group, info, 1);
  assert.deepEqual(second, { selectedPlate: 1, plateCount: 3, itemIndices: [1] });
  assert.deepEqual(group.children.map((c) => c.name), ["obj2"]);
  assert.equal(prep.select3mfPlate(fakeSlicerLoader(SPEC).parse(), info, 7), null, "índice fuera de rango -> sin cambios");
  const future = await prepare3mf(SPEC).then(() => prep.prepareModelForDisplay(THREE, "3mf", bufferOf(buildSlicer3mf(SPEC)), {
    plateIndex: 2,
    deps: { loaders: loadersFor(fakeSlicerLoader(SPEC)), unzipSync: unzip },
  }));
  assert.equal(future.selectedPlate, 2);
  assert.deepEqual(future.object3d.children.map((c) => c.name), ["obj4"]);
});

test("Orca se distingue por su metadata (OrcaSlicer) y usa la misma estructura", async () => {
  const prepared = await prepare3mf(SPEC, { slicer: "orca" });
  assert.equal(prepared.slicer, "orca");
  assert.equal(prepared.plateCount, 3);
});

// ===================================================================== COLOR (9-15)
test("9. STL usa material neutral", async () => {
  const buf = new TextEncoder().encode(CUBE_STL).buffer;
  const prepared = await prep.prepareModelForDisplay(THREE, "stl", buf, { deps: { loaders: loadersFor(null) } });
  assert.equal(prepared.colorMode, "neutral");
  assert.equal(prepared.object3d.material.color.getHex(), 0xc8ccd4);
});

test("10. 3MF con materiales estándar conserva el color del archivo", async () => {
  const redMaterial = new THREE.MeshPhongMaterial({ name: "Rojo", color: 0xff0000 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), redMaterial));
  const prepared = await prep.prepareModelForDisplay(THREE, "3mf", bufferOf(buildStandard3mf()), {
    deps: { loaders: loadersFor({ parse: () => group }), unzipSync: unzip },
  });
  assert.equal(prepared.colorMode, "preserved");
  assert.equal(meshesOf(prepared.object3d)[0].material, redMaterial, "el material del loader no se reemplaza");
  assert.equal(redMaterial.color.getHexString(), "ff0000");
});

test("11. 3MF sin color usa neutral", async () => {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ name: DEFAULT_NAME, color: 0xffffff })));
  const prepared = await prep.prepareModelForDisplay(THREE, "3mf", bufferOf(buildStandard3mf({ colored: false })), {
    deps: { loaders: loadersFor({ parse: () => group }), unzipSync: unzip },
  });
  assert.equal(prepared.colorMode, "neutral");
  assert.deepEqual(colorsOf(prepared.object3d), ["c8ccd4"]);
});

test("12. Bambu/Orca: color solo cuando el mapeo extruder -> filament_colour es confiable", async () => {
  // objeto 1 -> filamento 1 (#ffd800); objeto 3: parte 70001 ext. 1, parte 70002 hereda ext. 2 (#c12e1e)
  const prepared = await prepare3mf(SPEC);
  assert.deepEqual(colorsOf(prepared.object3d), ["ffd800", "ffd800", "c12e1e"]);
  // sin project_settings -> nada que mapear -> neutro (no se inventa)
  const none = await prepare3mf(SPEC, { filamentColours: null });
  assert.equal(none.colorMode, "neutral");
  assert.deepEqual(new Set(colorsOf(none.object3d)), new Set(["c8ccd4"]));
  // extruder ausente en objeto y parte -> neutro para esa pieza
  const missing = await prepare3mf({ ...SPEC, objects: SPEC.objects.map((o) => (o.id === 1 ? { ...o, extruder: null } : o)) });
  assert.equal(missing.colorMode, "mixed");
  assert.deepEqual(colorsOf(missing.object3d), ["c8ccd4", "ffd800", "c12e1e"]);
  // extruder fuera de la lista de filamentos -> neutro
  const oob = await prepare3mf({ ...SPEC, objects: SPEC.objects.map((o) => (o.id === 1 ? { ...o, extruder: 9 } : o)) });
  assert.equal(colorsOf(oob.object3d)[0], "c8ccd4");
});

test("13. multicolor: partes de un mismo objeto conservan colores distintos", async () => {
  const prepared = await prepare3mf(SPEC);
  const colors = new Set(colorsOf(prepared.object3d));
  assert.ok(colors.size >= 2, "más de un color");
  assert.equal(prepared.colorMode, "preserved");
  const object3 = prepared.object3d.children.find((c) => c.name === "obj3");
  assert.deepEqual(colorsOf(object3), ["ffd800", "c12e1e"]);
});

test("14. color inválido usa el fallback neutro", async () => {
  const prepared = await prepare3mf(SPEC, { filamentColours: ["not-a-color", "#c12e1e"] });
  assert.deepEqual(colorsOf(prepared.object3d), ["c8ccd4", "c8ccd4", "c12e1e"]);
  assert.equal(prepared.colorMode, "mixed");
  assert.deepEqual(pkg.parseFilamentColors(JSON.stringify({ filament_colour: ["#FFD800", "#12345", 7, "#aabbccdd", "javascript:1"] })), ["#ffd800", null, null, "#aabbcc", null]);
  assert.deepEqual(pkg.parseFilamentColors("{no json"), []);
});

test("facetas pintadas (paint_color): esa pieza queda en neutro, no se inventa segmentación", async () => {
  const spec = { objects: [{ id: 1, extruder: 1, parts: [{ partId: 65537, extruder: 1, size: 20, paint: true }] }, { id: 2, extruder: 2, size: 15 }], buildOrder: [1, 2], plates: [[1, 2]] };
  const prepared = await prepare3mf(spec);
  assert.equal(prepared.colorMode, "mixed");
  assert.deepEqual(colorsOf(prepared.object3d), ["c8ccd4", "c12e1e"]);
});

test("15. no muta ni destruye datos del original (buffer y geometría intactos)", async () => {
  const bytes = buildSlicer3mf(SPEC);
  const buffer = bufferOf(bytes);
  const before = Buffer.from(buffer).toString("base64");
  const group = fakeSlicerLoader(SPEC).parse();
  const positions = meshesOf(group).map((m) => m.geometry.getAttribute("position").count);
  const prepared = await prep.prepareModelForDisplay(THREE, "3mf", buffer, { deps: { loaders: loadersFor({ parse: () => group }), unzipSync: unzip } });
  assert.equal(Buffer.from(buffer).toString("base64"), before, "el ArrayBuffer de entrada no se modifica");
  const kept = meshesOf(prepared.object3d);
  assert.equal(kept.length, 3);
  assert.ok(kept.every((m) => m.geometry.getAttribute("position").count === positions[0]));
  prepared.dispose();
});

// ===================================================================== SUPERFICIES (16-25)
const viewerSrc = read("src/components/stl/Model3DViewer.tsx");
const generatorSrc = read("src/lib/stl/generate-preview.ts");

test("16-19. viewer, thumbnail y WebM usan la MISMA preparación (prepareModelForDisplay)", () => {
  assert.match(viewerSrc, /prepareModelForDisplay\(THREE, format, buffer\)/);
  assert.match(generatorSrc, /prepareModelForDisplay\(THREE, format, buffer\)/);
  for (const src of [viewerSrc, generatorSrc]) {
    assert.doesNotMatch(src, /parseModel3D\(|applyNeutralMaterial|toObject3D|new ThreeMFLoader|new STLLoader/, "sin pipelines paralelos");
  }
  // una sola preparación por generación: thumbnail y WebM comparten `model` (mismo pivot, escena y renderer)
  assert.equal(generatorSrc.match(/prepareModelForDisplay\(/g).length, 1);
  assert.equal(generatorSrc.match(/createZUpPivot\(/g).length, 1);
  assert.ok(generatorSrc.indexOf("canvasToBlob(canvas") < generatorSrc.indexOf("recordTurntable({"), "miniatura y WebM salen de la misma escena");
  assert.equal(viewerSrc.match(/prepareModelForDisplay\(/g).length, 1);
});

test("20-22. los materiales con color de la preparación llegan al render (sin reemplazo posterior)", () => {
  for (const src of [viewerSrc, generatorSrc]) {
    assert.doesNotMatch(src, /MeshStandardMaterial|\.material\s*=/, "ninguna superficie pisa los colores");
  }
  assert.match(read("src/lib/stl/prepare-model.ts"), /colorMode/);
});

test("el viewer muestra 'cama X de N' solo con varias camas y no agrega selector", () => {
  assert.match(viewerSrc, /Mostrando cama \$\{plateInfo\.shown\} de \$\{plateInfo\.total\}/);
  assert.match(viewerSrc, /prepared\.plateCount > 1/);
  assert.doesNotMatch(viewerSrc, /plateIndex|<select/);
});

test("23. regresión STL: mismo material neutro, mismo parser, sin lógica de plates", () => {
  const prepSrc = read("src/lib/stl/prepare-model.ts");
  const stlBranch = prepSrc.slice(prepSrc.indexOf('if (format === "stl")'), prepSrc.indexOf("const tally"));
  assert.match(stlBranch, /applyNeutralMaterial/);
  assert.doesNotMatch(stlBranch, /plate|inspect3mfPackage/i);
});

test("24. regresión download: la descarga no cambió", () => {
  const dl = read("src/app/api/stl/download/route.ts");
  assert.match(dl, /capabilities\.downloadStl/);
  assert.match(dl, /createSignedUrl\(parsedRef\.path, 60, \{ download: true \}\)/);
});

test("25. cleanup Three.js: dispose libera geometrías y materiales propios; viewer sigue limpiando", async () => {
  const prepared = await prepare3mf(SPEC);
  const geometries = meshesOf(prepared.object3d).map((m) => m.geometry);
  const materials = new Set(meshesOf(prepared.object3d).map((m) => m.material));
  let disposedGeo = 0;
  let disposedMat = 0;
  geometries.forEach((g) => g.addEventListener("dispose", () => (disposedGeo += 1)));
  materials.forEach((m) => m.addEventListener("dispose", () => (disposedMat += 1)));
  prepared.dispose();
  assert.equal(disposedGeo, geometries.length);
  assert.equal(disposedMat, materials.size);
  for (const call of ["disposeModel()", "renderer.dispose()", "controls.dispose()", "forceContextLoss()", "abort.abort()"]) {
    assert.ok(viewerSrc.includes(call), `cleanup ${call}`);
  }
  assert.match(viewerSrc, /prepared\.dispose\(\)/);
  assert.match(generatorSrc, /prepared\.dispose\(\)/);
});

// ===================================================================== SEGURIDAD DE PARSING
test("seguridad: paths de entries (zip-slip) y DOCTYPE/ENTITY se rechazan", () => {
  for (const bad of ["../evil.model", "/../x", "3D/../../x", "a\\b.model", "C:/x.model", "3D//x.model", "", null]) {
    assert.equal(pkg.normalizeEntryPath(bad), null, String(bad));
  }
  assert.equal(pkg.normalizeEntryPath("/3D/Objects/object_1.model"), "3D/Objects/object_1.model");
  assert.throws(() => pkg.parseRootModel('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><model/>'));
  assert.throws(() => pkg.parseModelSettings("<!DOCTYPE config [<!ENTITY a 'b'>]><config/>"));
  assert.equal(pkg.decodeXmlText("a&amp;b&lt;&#65;&#x42;&bogus;"), "a&b<AB&bogus;");
});

test("seguridad: zip-bomb declarada (tamaños) se rechaza antes de parsear; archivo no-zip lo reporta el loader", () => {
  const fakeUnzip = (sizes) => (_data, options) => {
    sizes.forEach((originalSize, i) => options.filter({ name: `f${i}`, originalSize }));
    return {};
  };
  const buf = new ArrayBuffer(8);
  assert.doesNotThrow(() => pkg.assertSafeThreeMfArchive(buf, fakeUnzip([1000, 2000])));
  assert.throws(() => pkg.assertSafeThreeMfArchive(buf, fakeUnzip([pkg.THREE_MF_LIMITS.maxEntryUncompressedBytes + 1])), /demasiado grande/);
  assert.throws(() => pkg.assertSafeThreeMfArchive(buf, fakeUnzip(Array(5).fill(300 * 1024 * 1024))), /descomprimido/);
  assert.throws(() => pkg.assertSafeThreeMfArchive(buf, fakeUnzip(Array(pkg.THREE_MF_LIMITS.maxEntries + 1).fill(1))), /demasiados/);
  assert.doesNotThrow(() => pkg.assertSafeThreeMfArchive(new TextEncoder().encode("not a zip").buffer, unzip));
  assert.equal(pkg.inspect3mfPackage(new TextEncoder().encode("not a zip").buffer, unzip).kind, "generic");
});

test("seguridad: la preparación convierte una zip-bomb en Model3DLoadError(corrupt), sin llamar al loader", async () => {
  let parsed = false;
  const bombUnzip = (_d, o) => { o.filter({ name: "x", originalSize: 2 * 1024 * 1024 * 1024 }); return {}; };
  await assert.rejects(
    prep.prepareModelForDisplay(THREE, "3mf", new ArrayBuffer(8), { deps: { loaders: loadersFor({ parse: () => { parsed = true; return new THREE.Group(); } }), unzipSync: bombUnzip } }),
    (e) => e.name === "Model3DLoadError" && e.code === "corrupt",
  );
  assert.equal(parsed, false);
});

test("seguridad: el módulo de inspección no toca el filesystem ni ejecuta contenido", () => {
  const src = read("src/lib/stl/three-mf-package.ts");
  assert.doesNotMatch(src, /from "node:|require\(|eval\(|new Function|fs\./);
});

// ===================================================================== LECTURA DE METADATA
test("model_settings: extruder por parte/objeto, plates y model_instance", () => {
  const settings = pkg.parseModelSettings(`<config>
    <object id="5"><metadata key="extruder" value="2"/><metadata face_count="10"/>
      <part id="65541"><metadata key="extruder" value="3"/></part><part id="65542"/></object>
    <plate><metadata key="plater_id" value="2"/>
      <model_instance><metadata key="object_id" value="5"/><metadata key="instance_id" value="0"/></model_instance></plate>
    <assemble><assemble_item object_id="5" instance_id="0"/></assemble></config>`);
  assert.equal(settings.objectExtruder.get("5"), 2);
  assert.equal(settings.partExtruder.get("65541"), 3);
  assert.equal(settings.partExtruder.has("65542"), false);
  assert.deepEqual(settings.plates, [{ plateId: 2, instances: [{ objectId: "5", instanceId: 0 }] }]);
});

test("plates con varias instancias del mismo objeto se mapean por instance_id (n-ésimo build item)", () => {
  const spec = { objects: [{ id: 1, extruder: 1, size: 5 }], buildOrder: [1, 1], plates: [[1]] };
  const bytes = unzipSync(buildSlicer3mf(spec));
  bytes["Metadata/model_settings.config"] = strToU8(
    new TextDecoder().decode(bytes["Metadata/model_settings.config"]).replace(
      /<plate>[\s\S]*<\/plate>/,
      `<plate><metadata key="plater_id" value="1"/><model_instance><metadata key="object_id" value="1"/><metadata key="instance_id" value="0"/></model_instance></plate>
       <plate><metadata key="plater_id" value="2"/><model_instance><metadata key="object_id" value="1"/><metadata key="instance_id" value="1"/></model_instance></plate>`,
    ),
  );
  const info = pkg.inspect3mfPackage(bufferOf(zipSync(bytes)), unzip);
  assert.equal(info.kind, "slicer");
  assert.deepEqual(info.plates.map((p) => p.itemIndices), [[0], [1]]);
});
