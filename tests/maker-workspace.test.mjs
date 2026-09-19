import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";

// Este test carga los módulos TypeScript del pipeline geométrico de Stampa
// Maker (src/lib/maker/**) directamente con el compilador de TypeScript,
// igual que tests/calculator-pricing.test.mjs, pero resolviendo también el
// alias "@/..." y los imports relativos entre archivos del pipeline.

const root = process.cwd();
const srcRoot = path.join(root, "src");
const nodeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

function resolveModulePath(specifier, fromFile) {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.join(srcRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }
  const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`No se pudo resolver "${specifier}" desde ${fromFile}`);
}

function loadTsModule(absPath) {
  if (moduleCache.has(absPath)) return moduleCache.get(absPath).exports;

  const source = fs.readFileSync(absPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: absPath,
  });

  const mod = { exports: {} };
  moduleCache.set(absPath, mod);

  const localRequire = (specifier) => {
    const resolved = resolveModulePath(specifier, absPath);
    return resolved ? loadTsModule(resolved) : nodeRequire(specifier);
  };

  const fn = new Function("require", "module", "exports", "__filename", "__dirname", outputText);
  fn(localRequire, mod, mod.exports, absPath, path.dirname(absPath));
  return mod.exports;
}

function loadMakerModule(relFromSrc) {
  return loadTsModule(path.join(srcRoot, relFromSrc));
}

const { packItems } = loadMakerModule("lib/maker/printBed/packing.ts");
const { computeBedLayout, placementMatrix, makeBedItem } = loadMakerModule("lib/maker/printBed/bedLayout.ts");
const { PRINTER_PROFILES, getPrinterProfile } = loadMakerModule("lib/maker/printBed/printerProfiles.ts");
const { computeExplodeStepMm, computeExplodeRanks, DEFAULT_EXPLODE_PERCENT } = loadMakerModule("lib/maker/geometry/explodeOrder.ts");
const { DEFAULT_LETTER_SIGN_PARAMS } = loadMakerModule("lib/maker/defaults.ts");
const presets = loadMakerModule("lib/maker/presets/presetSettings.ts");
const projects = loadMakerModule("lib/maker/projects/projectData.ts");
const { toUserMessage } = loadMakerModule("lib/maker/persistence/makerRepository.ts");

const A1 = getPrinterProfile("bambulab-a1");
const BED = { widthMm: 256, depthMm: 256 };

// ---------------------------------------------------------------- packing

function overlaps(a, b) {
  return a.x < b.x + b.widthMm && b.x < a.x + a.widthMm && a.y < b.y + b.depthMm && b.y < a.y + a.depthMm;
}

test("perfil Bambu Lab A1: 256x256x256", () => {
  assert.equal(PRINTER_PROFILES.length >= 1, true);
  assert.deepEqual({ w: A1.widthMm, d: A1.depthMm, h: A1.heightMm, id: A1.id }, { w: 256, d: 256, h: 256, id: "bambulab-a1" });
});

test("packing: una pieza entra en una sola placa", () => {
  const r = packItems([{ id: "a", widthMm: 100, depthMm: 50 }], BED);
  assert.equal(r.plates.length, 1);
  assert.equal(r.plates[0].placements.length, 1);
  assert.equal(r.oversize.length, 0);
});

test("packing: varias piezas entran en la misma placa", () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, widthMm: 80, depthMm: 60 }));
  const r = packItems(items, BED);
  assert.equal(r.plates.length, 1);
  assert.equal(r.plates[0].placements.length, 6);
});

test("packing: respeta el espaciado mínimo (default 5 mm) y no hay overlap", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, widthMm: 60 + (i % 3) * 7, depthMm: 40 + (i % 4) * 5 }));
  const spacing = 5;
  const r = packItems(items, BED, { spacingMm: spacing });
  for (const plate of r.plates) {
    const ps = plate.placements;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const inflated = { ...ps[i], widthMm: ps[i].widthMm + spacing - 1e-6, depthMm: ps[i].depthMm + spacing - 1e-6 };
        assert.equal(overlaps(inflated, ps[j]), false, `${ps[i].id} y ${ps[j].id} violan el espaciado`);
        assert.equal(overlaps(ps[i], ps[j]), false);
      }
    }
  }
});

test("packing: rota 90° cuando eso hace que entre", () => {
  const r = packItems([{ id: "tall", widthMm: 90, depthMm: 280 }], { widthMm: 300, depthMm: 100 });
  assert.equal(r.oversize.length, 0);
  const p = r.plates[0].placements[0];
  assert.equal(p.rotated, true);
  assert.deepEqual([p.widthMm, p.depthMm], [280, 90]);
});

test("packing: crea una segunda placa cuando no alcanza el lugar", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ id: `big${i}`, widthMm: 200, depthMm: 200 }));
  const r = packItems(items, BED);
  assert.equal(r.plates.length, 5);
  assert.deepEqual(r.plates.map((p) => p.index), [1, 2, 3, 4, 5]);
  assert.equal(r.plates.reduce((n, p) => n + p.placements.length, 0), 5);
});

test("packing: pieza oversize no se coloca y se informa (aunque se pruebe 0°/90°)", () => {
  const r = packItems([{ id: "huge", widthMm: 310, depthMm: 180 }, { id: "ok", widthMm: 50, depthMm: 50 }], BED);
  assert.deepEqual(r.oversize.map((o) => [o.id, o.widthMm, o.depthMm]), [["huge", 310, 180]]);
  assert.equal(r.plates[0].placements.some((p) => p.id === "huge"), false);
  assert.equal(r.plates[0].placements.length, 1);
});

test("packing: todas las piezas colocadas quedan dentro de 256x256 y es determinístico", () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, widthMm: 20 + ((i * 37) % 90), depthMm: 20 + ((i * 53) % 120) }));
  const r = packItems(items, BED);
  for (const plate of r.plates) {
    for (const p of plate.placements) {
      assert.equal(p.x >= 0 && p.y >= 0, true);
      assert.equal(p.x + p.widthMm <= 256 + 1e-6 && p.y + p.depthMm <= 256 + 1e-6, true, `${p.id} fuera de la cama`);
    }
  }
  assert.equal(r.plates.reduce((n, p) => n + p.placements.length, 0), 40);
  assert.deepEqual(packItems(items, BED), r);
});

function tri(x, y, z) {
  return { positions: new Float32Array([0, 0, 0, x, 0, 0, 0, y, z]), normals: new Float32Array(9), triangleCount: 1 };
}

test("bed layout: warning por altura (Z) > 256 y por huella oversize", () => {
  const tall = makeBedItem("t", "tall", "body", tri(50, 50, 300));
  const wide = makeBedItem("w", "wide", "body", tri(310, 180, 10));
  const layout = computeBedLayout([tall, wide], A1);
  assert.deepEqual(layout.tooTall.map((t) => t.id), ["t"]);
  assert.deepEqual(layout.oversize.map((o) => o.id), ["w"]);
});

test("placementMatrix: apoya el mínimo en Z=0 (también volteada y rotada) y la esquina en (x,y)", () => {
  const mesh = { positions: new Float32Array([10, 20, -5, 40, 20, -5, 10, 50, 25]), normals: new Float32Array(9), triangleCount: 1 };
  for (const kind of ["body", "lid"]) {
    for (const rotated of [false, true]) {
      const item = makeBedItem("i", "i", kind, mesh);
      const m = placementMatrix(item, { x: 7, y: 9, rotated });
      const xs = [], ys = [], zs = [];
      for (let i = 0; i < 9; i += 3) {
        const x = mesh.positions[i], y = mesh.positions[i + 1], z = mesh.positions[i + 2];
        xs.push(m[0] * x + m[4] * y + m[8] * z + m[12]);
        ys.push(m[1] * x + m[5] * y + m[9] * z + m[13]);
        zs.push(m[2] * x + m[6] * y + m[10] * z + m[14]);
      }
      assert.ok(Math.abs(Math.min(...zs)) < 1e-6, `${kind}/${rotated}: minZ`);
      assert.ok(Math.abs(Math.min(...xs) - 7) < 1e-6 && Math.abs(Math.min(...ys) - 9) < 1e-6, `${kind}/${rotated}: esquina`);
      const w = Math.max(...xs) - Math.min(...xs);
      const d = Math.max(...ys) - Math.min(...ys);
      const expW = rotated ? item.depthMm : item.widthMm;
      const expD = rotated ? item.widthMm : item.depthMm;
      assert.ok(Math.abs(w - expW) < 1e-6 && Math.abs(d - expD) < 1e-6, `${kind}/${rotated}: huella`);
    }
  }
});

// ---------------------------------------------------------------- explosión

test("explosión: paso 0 en 0%, monótono, escala con el tamaño y conserva el orden semántico", () => {
  const small = { height: 50, depth: 20 };
  const large = { height: 500, depth: 40 };
  assert.equal(computeExplodeStepMm(small, 0), 0);
  assert.ok(computeExplodeStepMm(small, 60) > computeExplodeStepMm(small, 30));
  assert.ok(computeExplodeStepMm(large, DEFAULT_EXPLODE_PERCENT) > computeExplodeStepMm(small, DEFAULT_EXPLODE_PERCENT));
  assert.equal(computeExplodeStepMm(small, 500), computeExplodeStepMm(small, 100));
  const ranks = computeExplodeRanks(["mask", "diffuser", "body"]);
  assert.ok(ranks.get("diffuser") < ranks.get("mask"));
});

// ---------------------------------------------------------------- presets

const design = { text: "BAR PEPITO", fontId: "montserrat-regular", heightMm: 250 };
const customParams = { ...DEFAULT_LETTER_SIGN_PARAMS, ...design, frontType: "perforated", depthMm: 55, holeDiameterMm: 3.5, bevelEnabled: true };

test("preset: cobertura de claves — cada campo de LetterSignParams es receta o diseño", () => {
  const all = Object.keys(DEFAULT_LETTER_SIGN_PARAMS).sort();
  const covered = [...presets.PRESET_SETTING_KEYS, ...presets.DESIGN_PARAM_KEYS].sort();
  assert.deepEqual(covered, all);
});

test("preset: extractPresetSettings excluye source, text, fuente y alto", () => {
  const s = presets.extractPresetSettings(customParams);
  assert.equal("text" in s, false);
  assert.equal("fontId" in s, false);
  assert.equal("heightMm" in s, false);
  assert.equal(JSON.stringify(s).includes("BAR PEPITO"), false);
  assert.equal(s.depthMm, 55);
});

test("preset: no contiene camera / view / modelo-explosionada / slider / file / loading / error", () => {
  const s = presets.extractPresetSettings({ ...customParams, camera: [1, 2, 3], viewMode: "exploded", explodePercent: 80, file: { type: "svg" }, loading: true, error: "x" });
  for (const k of ["camera", "viewMode", "explodePercent", "file", "loading", "error", "source"]) assert.equal(k in s, false, k);
  assert.deepEqual(Object.keys(s).sort(), [...presets.PRESET_SETTING_KEYS].sort());
});

test("preset: round-trip de settings (JSON) y apply conserva el diseño actual", () => {
  const settings = JSON.parse(JSON.stringify(presets.extractPresetSettings(customParams)));
  assert.deepEqual(presets.normalizePresetSettings(settings), settings);
  const current = { ...DEFAULT_LETTER_SIGN_PARAMS, text: "LOGO", fontId: "montserrat-bold", heightMm: 80 };
  const applied = presets.applyPresetSettings(current, settings);
  assert.equal(applied.text, "LOGO");
  assert.equal(applied.fontId, "montserrat-bold");
  assert.equal(applied.heightMm, 80);
  assert.equal(applied.frontType, "perforated");
  assert.equal(applied.holeDiameterMm, 3.5);
});

test("preset: fallback al default de Stampa cuando no hay preset predeterminado", () => {
  assert.deepEqual(presets.resolveInitialParams(null), DEFAULT_LETTER_SIGN_PARAMS);
  assert.deepEqual(presets.resolveInitialParams(undefined), DEFAULT_LETTER_SIGN_PARAMS);
  const withDefault = presets.resolveInitialParams(presets.extractPresetSettings(customParams));
  assert.equal(withDefault.frontType, "perforated");
  assert.equal(withDefault.text, DEFAULT_LETTER_SIGN_PARAMS.text);
});

test("preset: lectura tolerante — schema_version ausente, campos faltantes, inválidos y desconocidos", () => {
  const s = presets.normalizePresetSettings({ depthMm: 70, frontType: "lid", bodyType: "nope", wallMm: "x", futureField: 1 }, null);
  assert.equal(s.depthMm, 70);
  assert.equal(s.frontType, "lid");
  assert.equal(s.bodyType, DEFAULT_LETTER_SIGN_PARAMS.bodyType);
  assert.equal(s.wallMm, DEFAULT_LETTER_SIGN_PARAMS.wallMm);
  assert.equal("futureField" in s, false);
  assert.deepEqual(presets.normalizePresetSettings(null), presets.defaultPresetSettings());
  assert.equal(presets.PRESET_SCHEMA_VERSION, 1);
});

test("preset: los cambios de receta marcan Modificado; cambiar el diseño no", () => {
  const settings = presets.extractPresetSettings(customParams);
  assert.equal(presets.isPresetModified(customParams, settings), false);
  assert.equal(presets.isPresetModified({ ...customParams, text: "OTRO", heightMm: 10 }, settings), false);
  assert.equal(presets.isPresetModified({ ...customParams, wallMm: 2.4 }, settings), true);
  assert.equal(presets.isPresetModified({ ...customParams, frontType: "open" }, settings), true);
});

// ---------------------------------------------------------------- projects

const pngOptions = { threshold: 90, invert: true, smoothing: "high" };
const defaultPng = { threshold: 128, invert: false, smoothing: "medium" };

test("proyecto texto: serialize/deserialize y settings round-trip", () => {
  const state = { params: customParams, sourceMode: "text", designHeightMm: 100, pngOptions: defaultPng, fileMeta: null };
  const payload = projects.serializeProject(state, { presetId: "preset-1" });
  assert.equal(payload.source_type, "text");
  assert.deepEqual(payload.source_data, { text: "BAR PEPITO", fontId: "montserrat-regular", heightMm: 250 });
  assert.equal(payload.preset_id, "preset-1");
  assert.equal(payload.schema_version, projects.PROJECT_SCHEMA_VERSION);
  const loaded = projects.deserializeProject(JSON.parse(JSON.stringify(payload)));
  assert.deepEqual(loaded.params, customParams);
  assert.equal(loaded.sourceMode, "text");
  assert.equal(loaded.fileRef, null);
  assert.equal(loaded.presetId, "preset-1");
});

test("proyecto SVG: metadata serializable sin contenido del archivo", () => {
  const state = { params: DEFAULT_LETTER_SIGN_PARAMS, sourceMode: "file", designHeightMm: 120, pngOptions: defaultPng, fileMeta: { kind: "svg", fileName: "logo.svg", sizeBytes: 4321 } };
  const payload = projects.serializeProject(state, { storagePath: projects.projectSourcePath("user-1", "proj-1", "svg") });
  assert.equal(payload.source_type, "svg");
  assert.deepEqual(payload.source_data, { storagePath: "user-1/proj-1/source.svg", originalFilename: "logo.svg", mimeType: "image/svg+xml", heightMm: 120, sizeBytes: 4321 });
  const loaded = projects.deserializeProject(JSON.parse(JSON.stringify(payload)));
  assert.equal(loaded.sourceMode, "file");
  assert.equal(loaded.designHeightMm, 120);
  assert.equal(loaded.fileRef.storagePath, "user-1/proj-1/source.svg");
});

test("proyecto PNG: metadata + opciones de importación serializables", () => {
  const state = { params: DEFAULT_LETTER_SIGN_PARAMS, sourceMode: "file", designHeightMm: 60, pngOptions, fileMeta: { kind: "png", fileName: "escudo.png", sizeBytes: 99 } };
  const payload = projects.serializeProject(state, { storagePath: projects.projectSourcePath("u", "p", "png") });
  assert.equal(payload.source_type, "png");
  assert.equal(payload.source_data.mimeType, "image/png");
  const loaded = projects.deserializeProject(JSON.parse(JSON.stringify(payload)));
  assert.deepEqual(loaded.pngOptions, pngOptions);
  assert.equal(loaded.fileRef.originalFilename, "escudo.png");
});

test("proyecto: el storage path y source_data no contienen binario/base64", () => {
  const path = projects.projectSourcePath("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "png");
  assert.match(path, /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/source\.png$/);
  const state = { params: DEFAULT_LETTER_SIGN_PARAMS, sourceMode: "file", designHeightMm: 60, pngOptions, fileMeta: { kind: "png", fileName: "a.png", sizeBytes: 5000000 } };
  const json = JSON.stringify(projects.serializeProject(state, { storagePath: path }).source_data);
  assert.ok(json.length < 400);
  assert.equal(json.includes("base64"), false);
  assert.equal(json.includes("data:"), false);
  assert.throws(() => projects.serializeProject({ ...state, fileMeta: null }, {}), /archivo/);
});

test("proyecto: dirty state (cambios, guardado limpio, reemplazo de archivo, preset)", () => {
  const state = { params: DEFAULT_LETTER_SIGN_PARAMS, sourceMode: "text", designHeightMm: 100, pngOptions, fileMeta: null };
  const saved = projects.projectSignature(state, null);
  assert.equal(projects.isProjectDirty(state, null, saved), false);
  assert.equal(projects.isProjectDirty({ ...state, params: { ...state.params, text: "X" } }, null, saved), true);
  assert.equal(projects.isProjectDirty({ ...state, params: { ...state.params, depthMm: 41 } }, null, saved), true);
  assert.equal(projects.isProjectDirty(state, "preset-2", saved), true);
  assert.equal(projects.isProjectDirty(state, null, null), true);
  const fileState = { ...state, sourceMode: "file", fileMeta: { kind: "svg", fileName: "a.svg", sizeBytes: 10 } };
  const fileSaved = projects.projectSignature(fileState, null);
  assert.equal(projects.isProjectDirty({ ...fileState, fileMeta: { kind: "svg", fileName: "b.svg", sizeBytes: 10 } }, null, fileSaved), true);
  assert.equal(projects.isProjectDirty({ ...fileState, params: { ...fileState.params, text: "Z" } }, null, fileSaved), false);
});

test("proyecto: abrir reconstruye el estado; tolera campos faltantes y rechaza archivo inválido", () => {
  const loaded = projects.deserializeProject({ source_type: "text", source_data: { text: "HOLA" }, settings: { depthMm: 33 } });
  assert.equal(loaded.params.text, "HOLA");
  assert.equal(loaded.params.depthMm, 33);
  assert.equal(loaded.params.fontId, DEFAULT_LETTER_SIGN_PARAMS.fontId);
  assert.equal(loaded.params.heightMm, DEFAULT_LETTER_SIGN_PARAMS.heightMm);
  assert.equal(loaded.params.wallMm, DEFAULT_LETTER_SIGN_PARAMS.wallMm);
  assert.throws(() => projects.deserializeProject({ source_type: "svg", source_data: {}, settings: {} }), /archivo/);
});

test("persistencia: errores de base se traducen a mensajes comprensibles (sin SQL crudo)", () => {
  const raw = { code: "23505", message: 'duplicate key value violates unique constraint "maker_presets_one_default_per_user"' };
  assert.equal(toUserMessage(raw).includes("constraint"), false);
  assert.equal(toUserMessage({ code: "42501", message: "new row violates row-level security policy" }).includes("row-level"), false);
  assert.equal(toUserMessage({ message: "select * from maker_presets failed" }).includes("select"), false);
});
