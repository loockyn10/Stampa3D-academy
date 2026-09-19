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

const { createLetterGeometry } = loadMakerModule("lib/maker/geometry/createLetterGeometry.ts");
const cutouts = loadMakerModule("lib/maker/geometry/backCutouts.ts");
const editor = loadMakerModule("lib/maker/backCutoutEditor.ts");
const { DEFAULT_LETTER_SIGN_PARAMS } = loadMakerModule("lib/maker/defaults.ts");
const projects = loadMakerModule("lib/maker/projects/projectData.ts");
const THREE = nodeRequire("three");
const opentype = nodeRequire("opentype.js");

const fontBuf = fs.readFileSync(path.join(root, "public/fonts/maker", "Montserrat-Bold.woff"));
const font = opentype.parse(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));
const gen = (text, patch = {}) => createLetterGeometry(font, { ...DEFAULT_LETTER_SIGN_PARAMS, text, ...patch });
const circle = (x, y, d = 4, id = "c") => ({ id, type: "circle", x, y, diameterMm: d });
const PNG = { threshold: 128, invert: false, smoothing: "medium" };
const stateOf = (params) => ({ params, sourceMode: "text", designHeightMm: 100, pngOptions: PNG, fileMeta: null });

// ------------------------------------------------------ keyhole default

test("keyhole NUEVO nace a 180° (círculo grande abajo); circle/capsule no cambian", () => {
  assert.equal(cutouts.KEYHOLE_DEFAULT_ROTATION_DEG, 180);
  const k = cutouts.createDefaultBackCutout("keyhole", "k");
  assert.equal(k.rotationDeg, 180);
  // Con 180° la cabeza queda ABAJO: el punto más bajo del polígono está dentro del círculo grande.
  const poly = cutouts.backCutoutPolygons(k)[0];
  const ys = poly.map((p) => p[1]);
  const bottom = poly.find((p) => p[1] === Math.min(...ys));
  assert.ok(Math.abs(bottom[1] + k.headDiameterMm / 2) < 0.05, "la cabeza (radio 4) es lo más bajo");
  assert.ok(Math.max(...ys) > k.neckLengthMm, "el cuello sube por encima de la cabeza");
  assert.equal(cutouts.createDefaultBackCutout("capsule", "c").rotationDeg, 0);
});

test("proyecto existente con keyhole rotationDeg=0 conserva 0°; 180° hace round-trip", () => {
  const legacy = { id: "old", type: "keyhole", x: 1, y: 2, headDiameterMm: 8, neckWidthMm: 4, neckLengthMm: 10, tailDiameterMm: 4, rotationDeg: 0 };
  const fresh = { ...legacy, id: "new", rotationDeg: 180 };
  const params = { ...DEFAULT_LETTER_SIGN_PARAMS, backCutouts: [legacy, fresh] };
  const payload = projects.serializeProject(stateOf(params));
  const loaded = projects.deserializeProject(JSON.parse(JSON.stringify(payload)));
  assert.equal(loaded.params.backCutouts[0].rotationDeg, 0);
  assert.equal(loaded.params.backCutouts[1].rotationDeg, 180);
  // Guardado viejo con rotationDeg explícito 0 no se reinterpreta.
  const old = projects.deserializeProject({ source_type: "text", source_data: { text: "A" }, settings: { backCutouts: [legacy] } });
  assert.equal(old.params.backCutouts[0].rotationDeg, 0);
});

test("duplicar conserva medidas y rotación (y se desplaza para no quedar encima)", () => {
  const k = { ...cutouts.createDefaultBackCutout("keyhole", "k", 3, 4), rotationDeg: 180 };
  const copy = editor.duplicateBackCutout(k, "k2");
  assert.equal(copy.rotationDeg, 180);
  assert.equal(copy.headDiameterMm, k.headDiameterMm);
  assert.equal(copy.neckLengthMm, k.neckLengthMm);
  assert.deepEqual([copy.x, copy.y], [8, 9]);
  assert.notEqual(copy.id, k.id);
});

// ------------------------------------------------------ conversión de coordenadas

test("design <-> world: centro (0,0) y round-trip exacto", () => {
  const origin = { x: 120.5, y: 37.25 };
  assert.deepEqual(editor.designToWorld({ x: 0, y: 0 }, origin), origin);
  const w = editor.designToWorld({ x: -13.4, y: 8.8 }, origin);
  const d = editor.worldToDesign(w, origin);
  assert.ok(Math.abs(d.x + 13.4) < 1e-9 && Math.abs(d.y - 8.8) < 1e-9);
});

test("vista trasera: derecha en pantalla = X de diseño negativa (espejo aplicado UNA sola vez); arriba = Y positiva", () => {
  assert.deepEqual(editor.designToBackViewScreen({ x: 10, y: 5 }), { right: -10, up: 5 });
  assert.deepEqual(editor.backViewScreenToDesign({ right: 10, up: 5 }), { x: -10, y: 5 });
  const p = { x: 7.5, y: -2 };
  const back = editor.backViewScreenToDesign(editor.designToBackViewScreen(p));
  assert.ok(Math.abs(back.x - p.x) < 1e-12 && Math.abs(back.y - p.y) < 1e-12);
});

// Reproduce la cadena real del editor: cámara ortográfica trasera + rayo contra el plano Z=0 + worldToDesign.
function backCamera(center, aspect = 2, halfH = 60) {
  const cam = new THREE.OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, 0.1, 5000);
  const pose = editor.backViewCameraPose(center, 300);
  cam.position.set(...pose.position);
  cam.up.set(...pose.up);
  cam.lookAt(...pose.target);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}
function pointerToDesign(cam, ndcX, ndcY, origin) {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
  const hit = new THREE.Vector3();
  assert.ok(ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit), "el rayo corta el plano de la base");
  return editor.worldToDesign({ x: hit.x, y: hit.y }, origin);
}

test("cadena pointer -> rayo -> plano -> diseño: el centro de la pantalla es el centro del diseño", () => {
  const origin = { x: 80, y: 30 };
  const cam = backCamera({ x: origin.x, y: origin.y, z: 20 });
  const d = pointerToDesign(cam, 0, 0, origin);
  assert.ok(Math.abs(d.x) < 1e-6 && Math.abs(d.y) < 1e-6);
});

test("mover el mouse a la DERECHA en la vista trasera: el handle va a la derecha y la X guardada disminuye; arriba => Y aumenta", () => {
  const origin = { x: 80, y: 30 };
  const cam = backCamera({ x: origin.x, y: origin.y, z: 20 });
  const right = pointerToDesign(cam, 0.5, 0, origin);
  const up = pointerToDesign(cam, 0, 0.5, origin);
  assert.ok(right.x < -1, `X de diseño = ${right.x}`);
  assert.ok(Math.abs(right.y) < 1e-6);
  assert.ok(up.y > 1 && Math.abs(up.x) < 1e-6);
  // Y el mapeo documentado coincide con la cámara real: pantalla "derecha" positiva <-> designToBackViewScreen.right > 0.
  assert.ok(editor.designToBackViewScreen(right).right > 0);
  assert.ok(editor.designToBackViewScreen(up).up > 0);
});

test("round-trip completo: diseño -> mundo -> pantalla (NDC) -> rayo -> diseño", () => {
  const origin = { x: 55, y: 12 };
  const cam = backCamera({ x: origin.x, y: origin.y, z: 20 });
  for (const p of [{ x: 0, y: 0 }, { x: 25, y: -10 }, { x: -40.5, y: 22.25 }]) {
    const w = editor.designToWorld(p, origin);
    const ndc = new THREE.Vector3(w.x, w.y, 0).project(cam);
    const back = pointerToDesign(cam, ndc.x, ndc.y, origin);
    assert.ok(Math.abs(back.x - p.x) < 1e-6 && Math.abs(back.y - p.y) < 1e-6, JSON.stringify([p, back]));
    // Un punto con X de diseño positiva se dibuja en la mitad IZQUIERDA de la pantalla trasera.
    if (p.x > 0) assert.ok(ndc.x < 0);
    if (p.x < 0) assert.ok(ndc.x > 0);
  }
});

test("designCenter del resultado = centro de la caja del diseño (origen de X/Y usado por el editor)", () => {
  const r = gen("AB");
  const p = r.parts.find((x) => x.kind === "body").mesh.positions;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
  }
  assert.ok(Math.abs(r.designCenter.x - (minX + maxX) / 2) < 0.05);
  assert.ok(Math.abs(r.designCenter.y - (minY + maxY) / 2) < 0.05);
});

// ------------------------------------------------------ lógica de drag

test("updateBackCutoutPosition: solo cambia el seleccionado; forma, medidas, rotación e id intactos", () => {
  const list = [circle(0, 0, 4, "a"), { ...cutouts.createDefaultBackCutout("keyhole", "b", 5, 5) }, cutouts.createDefaultBackCutout("capsule", "c", 1, 1)];
  const next = editor.updateBackCutoutPosition(list, "b", 12.34, -7.5);
  assert.equal(next[0], list[0]);
  assert.equal(next[2], list[2]);
  assert.deepEqual({ ...next[1], x: 5, y: 5 }, list[1], "solo x/y difieren");
  assert.deepEqual([next[1].x, next[1].y], [12.34, -7.5]);
  assert.equal(next[1].rotationDeg, 180);
  assert.equal(list[1].x, 5, "no muta la entrada");
  assert.equal(editor.updateBackCutoutPosition(list, "nope", 1, 1), list);
  assert.equal(editor.updateBackCutoutPosition(list, "a", 0, 0), list, "misma posición: misma referencia");
  assert.equal(editor.roundMm(1.23456), 1.23);
  assert.ok(Object.is(editor.roundMm(-0.0001), 0));
});

test("arrastrar un recorte marca el proyecto como Modificado (y solo x/y cambian en lo persistido)", () => {
  const params = { ...DEFAULT_LETTER_SIGN_PARAMS, backCutouts: [circle(0, 0, 4, "a")] };
  const saved = projects.projectSignature(stateOf(params), null);
  assert.equal(projects.isProjectDirty(stateOf(params), null, saved), false);
  const moved = { ...params, backCutouts: editor.updateBackCutoutPosition(params.backCutouts, "a", 3.5, -2) };
  assert.equal(projects.isProjectDirty(stateOf(moved), null, saved), true);
  const round = projects.deserializeProject(JSON.parse(JSON.stringify(projects.serializeProject(stateOf(moved)))));
  assert.deepEqual([round.params.backCutouts[0].x, round.params.backCutouts[0].y], [3.5, -2]);
});

test("posición inválida: se conserva (sin clamp), el editor la marca y el motor genera el error que bloquea la exportación", () => {
  // Punto válido: barrido sobre "O".
  let good = null;
  for (let x = -60; x <= 60 && !good; x += 4) {
    for (let y = -40; y <= 40 && !good; y += 4) {
      const r = gen("O", { backCutouts: [circle(x, y, 4)] });
      if (r.errors.length === 0 && r.backCutoutSafeZone) good = [x, y];
    }
  }
  assert.ok(good);
  const base = gen("O", { backCutouts: [circle(good[0], good[1], 4, "a")] });
  const ok = editor.checkBackCutoutPlacement(base.backCutoutSafeZone ? { ...circle(good[0], good[1], 4, "a") } : null, base.designCenter, base.backCutoutSafeZone);
  assert.deepEqual(ok, { valid: true, message: null });

  const list = editor.updateBackCutoutPosition([circle(good[0], good[1], 4, "a")], "a", 400, 400);
  assert.deepEqual([list[0].x, list[0].y], [400, 400], "sin clamp silencioso");
  const check = editor.checkBackCutoutPlacement(list[0], base.designCenter, base.backCutoutSafeZone);
  assert.equal(check.valid, false);
  assert.equal(check.message, "El recorte está demasiado cerca del borde.");
  assert.deepEqual([...editor.findInvalidBackCutouts(list, base.designCenter, base.backCutoutSafeZone)], ["a"]);
  const bad = gen("O", { backCutouts: list });
  assert.ok(bad.errors.some((e) => e.code === "BACK_CUTOUT_INVALID"), "la exportación sigue bloqueada por el sistema existente");
  // Medidas inválidas también se marcan en el editor.
  assert.equal(editor.checkBackCutoutPlacement(circle(0, 0, 0), base.designCenter, base.backCutoutSafeZone).valid, false);
  // Sin zona segura conocida no se marca (la validación real la hace el motor).
  assert.equal(editor.checkBackCutoutPlacement(circle(500, 0), { x: 0, y: 0 }, null).valid, true);
});

test("el editor y el motor usan la MISMA prueba de validez (isCutoutInsideSafeZone)", () => {
  const r = gen("8", { backCutouts: [circle(0, 0, 3)] });
  const zone = r.backCutoutSafeZone;
  assert.ok(zone && zone.length > 0);
  for (const [x, y] of [[0, 0], [0, 22], [30, 0], [500, 0], [0, -35]]) {
    const c = circle(x, y, 3);
    const engine = !gen("8", { backCutouts: [c] }).errors.some((e) => e.code === "BACK_CUTOUT_INVALID");
    assert.equal(cutouts.isCutoutInsideSafeZone(c, r.designCenter, zone), engine, `(${x},${y})`);
  }
});

test("sin recortes no se calcula la zona segura (null) y la geometría no cambia", () => {
  const r = gen("O");
  assert.equal(r.backCutoutSafeZone, null);
  assert.equal(r.errors.length, 0);
});
