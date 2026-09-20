import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";

// Carga módulos TypeScript de src/lib/maker/** con el compilador de TypeScript
// (mismo mecanismo que tests/maker-neon.test.mjs).
const root = process.cwd();
const srcRoot = path.join(root, "src");
const nodeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

function resolveModulePath(specifier, fromFile) {
  let base;
  if (specifier.startsWith("@/")) base = path.join(srcRoot, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`No se pudo resolver "${specifier}" desde ${fromFile}`);
}

function loadTsModule(absPath) {
  if (moduleCache.has(absPath)) return moduleCache.get(absPath).exports;
  const source = fs.readFileSync(absPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: absPath,
  });
  const mod = { exports: {} };
  moduleCache.set(absPath, mod);
  const localRequire = (specifier) => {
    const resolved = resolveModulePath(specifier, absPath);
    return resolved ? loadTsModule(resolved) : nodeRequire(specifier);
  };
  new Function("require", "module", "exports", "__filename", "__dirname", outputText)(localRequire, mod, mod.exports, absPath, path.dirname(absPath));
  return mod.exports;
}

const load = (rel) => loadTsModule(path.join(srcRoot, rel));

const { createMug } = load("lib/maker/mugs/createMug.ts");
const { analyzeMesh, newMesh, meshToSoup, signedVolume, indexedBounds } = load("lib/maker/mugs/geometry/mesh.ts");
const { revolveProfile } = load("lib/maker/mugs/geometry/revolveProfile.ts");
const { DEFAULT_MUG, normalizeMugDefinition, deriveHandleDefaults } = load("lib/maker/mugs/defaults.ts");
const { planMugBody, MUG_QUALITY } = load("lib/maker/mugs/body/createMugBody.ts");
const { planHandleAttachments } = load("lib/maker/mugs/handle/createHandle.ts");
const { bodyRadius, barrelBulge } = load("lib/maker/mugs/body/profiles.ts");
const { bandCenters, bandRelief } = load("lib/maker/mugs/modifiers/bands.ts");
const { capacityMl, frustumVolumeMm3 } = load("lib/maker/mugs/metrics/capacity.ts");
const { validateMug } = load("lib/maker/mugs/validation/validateMug.ts");
const { MUG_SYSTEM_PRESETS, applyMugRecipe } = load("lib/maker/mugs/presets.ts");
const { serializeMugProject, deserializeMugProject, mugProjectSignature } = load("lib/maker/mugs/projects/mugProjectData.ts");
const { partFileEntries } = load("lib/maker/exporters/parts.ts");
const { collectBedItems, computeBedLayout } = load("lib/maker/printBed/bedLayout.ts");
const { getPrinterProfile, DEFAULT_PRINTER_PROFILE_ID } = load("lib/maker/printBed/printerProfiles.ts");

const noHandle = { ...DEFAULT_MUG.handle, enabled: false };
const mug = (patch = {}) => ({ ...DEFAULT_MUG, ...patch });
const bare = (patch = {}) => mug({ handle: noHandle, ...patch });
const cylinder = { bodyStyle: "straight", topDiameterMm: 90, bottomDiameterMm: 90 };

function assertValid(result, label) {
  assert.ok(result.indexed, `${label}: sin malla (${JSON.stringify(result.errors)})`);
  const r = analyzeMesh(result.indexed);
  assert.equal(r.nonFinite, 0, `${label}: NaN/Infinity`);
  assert.equal(r.degenerate, 0, `${label}: triángulos degenerados`);
  assert.equal(r.boundaryEdges, 0, `${label}: hay aristas de borde (malla abierta)`);
  assert.equal(r.nonManifoldEdges, 0, `${label}: aristas no-manifold`);
  assert.equal(r.inconsistentEdges, 0, `${label}: normales incoherentes`);
  assert.ok(r.volume > 0, `${label}: volumen con signo no positivo`);
  return r;
}

// Radios (en el semiplano y = 0, x > 0) de los vértices cercanos a la altura zq.
function wallAt(indexed, zq) {
  const p = indexed.positions;
  const cx = (indexedBounds(indexed).minX + indexedBounds(indexed).maxX) / 2;
  const out = [];
  for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2] - zq) < 0.6 && Math.abs(p[i + 1] - (indexedBounds(indexed).minY + indexedBounds(indexed).maxY) / 2) < 1e-6) out.push(Math.abs(p[i] - cx));
  return out;
}

// ---------------------------------------------------------------- revolveProfile
const REVOLVE_PROFILES = {
  recto: [{ r: 0, z: 0 }, { r: 30, z: 0 }, { r: 30, z: 50 }, { r: 0, z: 50 }],
  cónico: [{ r: 0, z: 0 }, { r: 20, z: 0 }, { r: 40, z: 60 }, { r: 0, z: 60 }],
  barril: [{ r: 0, z: 0 }, ...Array.from({ length: 21 }, (_, i) => ({ r: 30 + 8 * barrelBulge(i / 20), z: i * 3 })), { r: 0, z: 60 }],
  abombado: [{ r: 0, z: 0 }, ...Array.from({ length: 21 }, (_, i) => ({ r: 30 + 10 * Math.sin((Math.PI * i) / 20) ** 0.8, z: i * 3 })), { r: 0, z: 60 }],
};

for (const [name, profile] of Object.entries(REVOLVE_PROFILES)) {
  test(`revolveProfile ${name}: malla cerrada, normales coherentes, sin degenerados`, () => {
    const m = newMesh();
    revolveProfile(m, profile, { segments: 48 });
    const r = analyzeMesh(m);
    assert.equal(r.boundaryEdges + r.nonManifoldEdges + r.inconsistentEdges + r.degenerate + r.nonFinite, 0);
    assert.ok(r.volume > 0);
    const b = indexedBounds(m);
    const rMax = Math.max(...profile.map((p) => p.r));
    assert.ok(Math.abs(b.maxX - rMax) < 1e-6);
    assert.equal(b.minZ, 0);
    assert.equal(b.maxZ, profile[profile.length - 1].z);
  });
}

test("revolveProfile: el volumen del cilindro coincide con πr²h (segmentos finos)", () => {
  const m = newMesh();
  revolveProfile(m, REVOLVE_PROFILES.recto, { segments: 360 });
  const expected = Math.PI * 30 * 30 * 50;
  assert.ok(Math.abs(signedVolume(m) - expected) / expected < 0.001);
});

test("meshToSoup: normales unitarias y finitas; mismo número de triángulos", () => {
  const m = newMesh();
  revolveProfile(m, REVOLVE_PROFILES.barril, { segments: 32 });
  const soup = meshToSoup(m);
  assert.equal(soup.triangleCount, m.tris.length / 3);
  for (let i = 0; i < soup.normals.length; i += 3) {
    assert.ok(Math.abs(Math.hypot(soup.normals[i], soup.normals[i + 1], soup.normals[i + 2]) - 1) < 1e-3);
  }
});

// ---------------------------------------------------------------- cuerpo
test("jarro recto estándar: altura, diámetro, boca abierta, base cerrada, cavidad hueca", () => {
  const r = createMug(bare(cylinder));
  assertValid(r, "recto");
  assert.equal(r.metrics.heightMm, 150);
  assert.ok(Math.abs(r.geometry.boundingBox.height - 150) < 1e-6);
  assert.ok(Math.abs(r.geometry.boundingBox.width - 90) < 1e-3);
  assert.ok(Math.abs(r.metrics.maxDiameterMm - 90) < 1e-3);
  assert.equal(indexedBounds(r.indexed).minZ, 0, "la base apoya en Z = 0");
  // Boca abierta: cerca del borde hay DOS paredes (interior 42.6 y exterior 45), no un tapón macizo.
  const top = wallAt(r.indexed, 140).sort((a, c) => a - c);
  assert.ok(Math.abs(top[0] - 42.6) < 0.05 && Math.abs(top[top.length - 1] - 45) < 0.05, `paredes en z=140: ${top}`);
  // Cavidad hueca: el volumen de material es mucho menor que el del cilindro macizo.
  const solid = Math.PI * 45 * 45 * 150 / 1000;
  assert.ok(r.metrics.materialVolumeCm3 < solid * 0.2);
  // Base cerrada de espesor 4: sin vértices interiores por debajo de z = 4 (excepto el piso y la pared exterior).
  const plan = planMugBody(bare(cylinder), "preview");
  assert.equal(plan.floorZ, 4);
  assert.ok(plan.innerPoints[plan.innerPoints.length - 1].z === 4);
});

test("espesor de pared ≈ wallThickness (recto y cónico, medido perpendicular a la pared)", () => {
  for (const style of ["straight", "conical"]) {
    const plan = planMugBody(bare({ bodyStyle: style, wallThicknessMm: 3 }), "preview");
    for (const z of [30, 75, 120]) {
      const h = 0.01;
      const slope = (plan.outerR(z + h) - plan.outerR(z - h)) / (2 * h);
      const normal = (plan.outerR(z) - plan.innerR(z)) / Math.sqrt(1 + slope * slope);
      assert.ok(Math.abs(normal - 3) < 0.02, `${style} z=${z}: ${normal}`);
    }
  }
});

test("espesor de base: el interior empieza en bottomThickness; base reforzada es más gruesa y con empalme", () => {
  const normal = planMugBody(bare(), "preview");
  const reinforced = planMugBody(bare({ base: "reinforced" }), "preview");
  assert.equal(normal.floorZ, 4);
  assert.equal(reinforced.floorZ, 6);
  assert.ok(reinforced.innerPoints[reinforced.innerPoints.length - 1].r < reinforced.innerR(6) - 3, "empalme curvo en la esquina interior");
  assertValid(createMug(bare({ base: "reinforced" })), "reforzada");
});

for (const rim of ["simple", "thick", "rounded"]) {
  test(`borde ${rim}: malla válida, altura intacta y boca abierta`, () => {
    const r = createMug(bare({ rim }));
    assertValid(r, rim);
    assert.ok(Math.abs(r.geometry.boundingBox.height - 150) < 1e-6);
    assert.ok(r.metrics.capacityMl > 500);
  });
}

test("borde grueso: cierra la cavidad solo en la boca", () => {
  const simple = planMugBody(bare(), "preview"), thick = planMugBody(bare({ rim: "thick" }), "preview");
  assert.ok(thick.innerR(150) < simple.innerR(150) - 1);
  assert.equal(thick.innerR(100), simple.innerR(100));
});

// ---------------------------------------------------------------- perfiles
test("barril: el radio máximo cae en la zona central; conserva base y boca", () => {
  const shape = { style: "barrel", bottomRadius: 45, topRadius: 45, bulge: 0.5 };
  let best = 0, at = 0;
  for (let i = 0; i <= 100; i++) {
    const r = bodyRadius(shape, i / 100);
    if (r > best) { best = r; at = i / 100; }
  }
  assert.ok(at > 0.4 && at < 0.6, `máximo en t=${at}`);
  assert.equal(bodyRadius(shape, 0), 45);
  assert.equal(bodyRadius(shape, 1), 45);
  assert.ok(best > 45);
});

test("cónico: el diámetro cambia linealmente y sin saltos", () => {
  const shape = { style: "conical", bottomRadius: 41, topRadius: 45, bulge: 0 };
  let prev = bodyRadius(shape, 0);
  for (let i = 1; i <= 50; i++) {
    const r = bodyRadius(shape, i / 50);
    assert.ok(r >= prev && Math.abs(r - prev - 4 / 50) < 1e-9);
    prev = r;
  }
});

test("abombado: sin discontinuidades y más lleno que el barril; recto constante", () => {
  const bulged = { style: "bulged", bottomRadius: 41, topRadius: 45, bulge: 0.6 };
  let prev = bodyRadius(bulged, 0), maxStep = 0;
  for (let i = 1; i <= 200; i++) {
    const r = bodyRadius(bulged, i / 200);
    maxStep = Math.max(maxStep, Math.abs(r - prev));
    prev = r;
  }
  assert.ok(maxStep < 0.5, `salto máximo ${maxStep}`);
  assert.ok(bodyRadius(bulged, 0.25) > bodyRadius({ ...bulged, style: "barrel" }, 0.25));
  const straight = { style: "straight", bottomRadius: 41, topRadius: 45, bulge: 0 };
  assert.equal(bodyRadius(straight, 0.2), bodyRadius(straight, 0.8));
  for (const style of ["barrel", "bulged"]) assertValid(createMug(bare({ bodyStyle: style })), style);
});

// ---------------------------------------------------------------- asa
for (const style of ["classic", "square", "angular"]) {
  test(`asa ${style}: uniones superior e inferior, sin componentes flotantes, malla válida`, () => {
    const def = mug({ handle: { ...DEFAULT_MUG.handle, style } });
    const r = createMug(def);
    assertValid(r, style);
    const p = r.indexed.positions, t = r.indexed.tris;
    // Una sola componente conexa: el asa comparte vértices con el cuerpo (unión topológica, no dos shells).
    const parent = Array.from({ length: p.length / 3 }, (_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let i = 0; i < t.length; i += 3) { parent[find(t[i])] = find(t[i + 1]); parent[find(t[i + 1])] = find(t[i + 2]); }
    const roots = new Set();
    for (const v of new Set(t)) roots.add(find(v)); // solo vértices referenciados
    assert.equal(roots.size, 1, "el asa quedó como componente separada");
    // Dimensiones: sobresale hacia +X; el ancho Y no cambia respecto del jarro sin asa.
    const noH = createMug(bare());
    assert.ok(r.geometry.boundingBox.width > noH.geometry.boundingBox.width + 30);
    assert.ok(Math.abs(r.geometry.boundingBox.depth - noH.geometry.boundingBox.depth) < 1e-6);
    // Uniones: vértices del asa (más allá del cuerpo) cubren de la unión inferior a la superior.
    const bodyMaxX = noH.geometry.boundingBox.width;
    const zs = [];
    for (let i = 0; i < p.length; i += 3) if (p[i] > bodyMaxX + 15) zs.push(p[i + 2]);
    assert.ok(zs.length > 0);
    const att = planHandleAttachments(def, planMugBody(def, "preview"));
    assert.ok(Math.min(...zs) < att.rowBot * 2 + 30 && Math.max(...zs) > att.rowTop * 2 - 30, "el asa se extiende entre las dos uniones");
    assert.ok(Math.max(...zs) < 150 && Math.min(...zs) > 0, "el asa queda dentro de la altura del jarro");
  });
}

test("asa: unión ancha (ventana >= 8 mm de semi-alto) en ambos extremos", () => {
  const att = planHandleAttachments(mug(), planMugBody(mug(), "preview"));
  assert.ok(att.windowHalfHeightMm >= 8 && att.windowHalfWidthMm >= 6);
  assert.ok(att.rowTop > att.rowBot);
});

test("asa: parámetros manuales y automáticos; auto deriva del tamaño del jarro", () => {
  const d = deriveHandleDefaults(150, 90);
  assert.ok(d.heightMm > 50 && d.projectionMm > 20);
  const manual = mug({ handle: { ...DEFAULT_MUG.handle, auto: false, heightMm: 70, projectionMm: 35, verticalPositionPct: 50 } });
  assertValid(createMug(manual), "asa manual");
});

test("calidad export: mucha más resolución y sigue siendo una malla válida", () => {
  const def = mug({ handle: { ...DEFAULT_MUG.handle, style: "angular" } });
  const exp = createMug(def, { quality: "export" }), prev = createMug(def, { quality: "preview" });
  assertValid(exp, "export");
  assert.ok(exp.metrics.triangleCount > prev.metrics.triangleCount * 4);
  assert.ok(MUG_QUALITY.export.segments > MUG_QUALITY.preview.segments);
});

// ---------------------------------------------------------------- bandas
for (const count of [0, 1, 3, 5]) {
  test(`bandas ×${count}: radios locales, distribución uniforme y malla válida`, () => {
    const bands = { enabled: true, count, heightMm: 6, reliefMm: 1.5 };
    const centers = bandCenters(bands, 150);
    assert.equal(centers.length, count);
    if (count >= 2) {
      const gaps = centers.slice(1).map((c, i) => c - centers[i]);
      assert.ok(gaps.every((g) => Math.abs(g - gaps[0]) < 1e-9));
    }
    for (const c of centers) {
      assert.ok(Math.abs(bandRelief(bands, centers, c) - 1.5) < 1e-9, "relieve pleno en el centro");
      assert.equal(bandRelief(bands, centers, c + 20), 0, "sin relieve lejos de la banda");
    }
    const r = createMug(bare({ ...cylinder, bands }));
    assertValid(r, `bandas ${count}`);
    assert.ok(Math.abs(r.metrics.maxDiameterMm - (count > 0 ? 93 : 90)) < 0.05, `diámetro máx ${r.metrics.maxDiameterMm}`);
  });
}

test("bandas: siguen el perfil local (barril) y conviven con asa, ranuras y facetas", () => {
  const combo = mug({ bodyStyle: "barrel", bands: { enabled: true, count: 3, heightMm: 6, reliefMm: 1.5 }, grooves: { enabled: true, count: 12, depthMm: 1.5 }, handle: { ...DEFAULT_MUG.handle, style: "angular" } });
  assertValid(createMug(combo), "barril + 3 bandas + 12 ranuras + asa angular");
  const rb = createMug(bare({ bodyStyle: "barrel", bands: { enabled: true, count: 3, heightMm: 6, reliefMm: 1.5 } }));
  const plain = createMug(bare({ bodyStyle: "barrel" }));
  assert.ok(rb.metrics.maxDiameterMm > plain.metrics.maxDiameterMm);
  assert.ok(rb.metrics.materialVolumeCm3 > plain.metrics.materialVolumeCm3);
});

// ---------------------------------------------------------------- ranuras y facetado
test("ranuras: crestas sobresalen `depth`; la pared nunca queda más fina que el espesor pedido", () => {
  const r = createMug(bare({ ...cylinder, grooves: { enabled: true, count: 12, depthMm: 2 } }));
  assertValid(r, "ranuras");
  assert.ok(Math.abs(r.metrics.maxDiameterMm - 94) < 0.05);
  const plan = planMugBody(bare({ ...cylinder, grooves: { enabled: true, count: 12, depthMm: 2 } }), "preview");
  assert.ok(Math.abs(plan.outerR(75) - plan.innerR(75) - 2.4) < 1e-9);
});

for (const sides of [6, 8, 16]) {
  test(`facetado ${sides} lados: forma poligonal, cavidad interior intacta, malla válida`, () => {
    const r = createMug(bare({ ...cylinder, surface: { style: "faceted", sides } }));
    assertValid(r, `facetado ${sides}`);
    const corner = 45 / Math.cos(Math.PI / sides);
    assert.ok(Math.abs(r.metrics.maxDiameterMm / 2 - corner) < 0.05, `${r.metrics.maxDiameterMm / 2} vs ${corner}`);
    const smooth = createMug(bare(cylinder));
    assert.ok(Math.abs(r.metrics.capacityMl - smooth.metrics.capacityMl) < 1e-9);
    assert.ok(r.metrics.materialVolumeCm3 > smooth.metrics.materialVolumeCm3, "las esquinas suman material, nunca lo quitan");
  });
}

test("facetado + ranuras con conteos coprimos (7 y 13): esquinas y valles caen en vértices", () => {
  const def = bare({ surface: { style: "faceted", sides: 7 }, grooves: { enabled: true, count: 13, depthMm: 2 } });
  const plan = planMugBody(def, "preview");
  assert.equal(plan.segments % 14, 0);
  assert.equal(plan.segments % 26, 0);
  assertValid(createMug(def), "7 + 13");
});

// ---------------------------------------------------------------- modo inserto
const INSERT = { mode: "insert-shell", bottomThicknessMm: 4, wallThicknessMm: 2.4, insert: { heightMm: 140, topDiameterMm: 80, bottomDiameterMm: 75, clearanceMm: 0.4 } };

test("carcasa para inserto: envolvente interior = inserto + holgura; el helper no se exporta", () => {
  const def = mug({ ...INSERT, handle: noHandle });
  const r = createMug(def);
  assertValid(r, "inserto");
  assert.ok(Math.abs(r.metrics.interior.bottomDiameterMm - 75.8) < 1e-6);
  assert.ok(Math.abs(r.metrics.interior.topDiameterMm - 80.8) < 1e-6);
  assert.equal(r.metrics.heightMm, 144);
  const plan = planMugBody(def, "preview");
  assert.ok(Math.abs(plan.innerR(4) - 37.9) < 1e-9 && Math.abs(plan.innerR(144) - 40.4) < 1e-9);
  assert.ok(Math.abs(plan.outerR(74) - plan.innerR(74) - 2.4 * Math.sqrt(1 + (2.5 / 140) ** 2)) < 1e-6);
  // El helper existe (visual) pero NO forma parte del STL.
  assert.ok(r.insertHelper && r.insertHelper.triangleCount > 0);
  assert.equal(r.geometry.parts.length, 1);
  const files = partFileEntries(r.geometry.parts, "jarro");
  assert.equal(files.length, 1);
  assert.equal(files[0].mesh.triangleCount, r.geometry.triangleCount);
  let helperTop = 0;
  for (let i = 0; i < r.insertHelper.positions.length; i += 3) helperTop = Math.max(helperTop, r.insertHelper.positions[i + 2]);
  assert.ok(Math.abs(helperTop - 144) < 1e-6);
  assert.equal(createMug(bare()).insertHelper, null, "el modo impreso no tiene helper");
});

test("carcasa para inserto: con asa, estilos y bordes sigue válida; el borde grueso engorda hacia afuera", () => {
  assertValid(createMug(mug({ ...INSERT, bodyStyle: "barrel", rim: "thick" })), "inserto + barril + asa");
  const thick = planMugBody(mug({ ...INSERT, handle: noHandle, rim: "thick" }), "preview");
  const simple = planMugBody(mug({ ...INSERT, handle: noHandle }), "preview");
  assert.equal(thick.innerR(144), simple.innerR(144), "la cavidad del inserto no se toca");
  assert.ok(thick.outerR(144) > simple.outerR(144));
});

// ---------------------------------------------------------------- capacidad
test("capacidad: cilindro = πr²h y cónico = tronco de cono (tolerancia 0.5 %)", () => {
  const cyl = createMug(bare({ bodyStyle: "straight", heightMm: 100, topDiameterMm: 80, bottomDiameterMm: 80 }));
  const expectedCyl = (Math.PI * (40 - 2.4) ** 2 * (100 - 4)) / 1000;
  assert.ok(Math.abs(cyl.metrics.capacityMl - expectedCyl) / expectedCyl < 0.005, `${cyl.metrics.capacityMl} vs ${expectedCyl}`);
  const def = bare({ bodyStyle: "conical", heightMm: 100, topDiameterMm: 90, bottomDiameterMm: 70 });
  const plan = planMugBody(def, "preview");
  const expectedCone = frustumVolumeMm3(plan.innerR(4), plan.innerR(100), 96) / 1000;
  const cone = createMug(def);
  assert.ok(Math.abs(cone.metrics.capacityMl - expectedCone) / expectedCone < 0.005, `${cone.metrics.capacityMl} vs ${expectedCone}`);
  assert.ok(Math.abs(frustumVolumeMm3(10, 10, 5) - Math.PI * 100 * 5) < 1e-9);
  assert.ok(Math.abs(capacityMl([{ r: 10, z: 10 }, { r: 10, z: 0 }]) * 1000 - Math.PI * 100 * 10) < 1e-6);
});

test("capacidad: el asa y las bandas no la alteran; el borde grueso la reduce", () => {
  const a = createMug(bare()).metrics.capacityMl;
  assert.equal(createMug(mug()).metrics.capacityMl, a);
  assert.equal(createMug(bare({ bands: { enabled: true, count: 3, heightMm: 6, reliefMm: 1.5 } })).metrics.capacityMl, a);
  assert.ok(createMug(bare({ rim: "thick" })).metrics.capacityMl < a);
});

// ---------------------------------------------------------------- calidad de malla, todas las combinaciones
test("combinaciones estilo × asa × borde × base generan mallas cerradas y manifold", () => {
  for (const bodyStyle of ["straight", "conical", "barrel", "bulged"])
    for (const style of ["classic", "square", "angular"])
      for (const rim of ["simple", "thick", "rounded"]) {
        const def = mug({ bodyStyle, rim, base: rim === "thick" ? "reinforced" : "normal", handle: { ...DEFAULT_MUG.handle, style } });
        assertValid(createMug(def), `${bodyStyle}/${style}/${rim}`);
      }
});

test("presets del sistema: solo producen MugDefinition y pasan por el mismo motor", () => {
  assert.deepEqual(MUG_SYSTEM_PRESETS.map((p) => p.id), ["classic", "barrel", "tavern", "geometric", "industrial"]);
  for (const preset of MUG_SYSTEM_PRESETS) {
    const def = applyMugRecipe(DEFAULT_MUG, preset.recipe);
    assert.equal(def.heightMm, DEFAULT_MUG.heightMm, "el preset no pisa dimensiones");
    assert.equal(def.mode, "printed");
    assertValid(createMug(def), preset.id);
  }
  const barrel = applyMugRecipe(DEFAULT_MUG, MUG_SYSTEM_PRESETS[1].recipe);
  assert.equal(barrel.bodyStyle, "barrel");
  assert.equal(barrel.bands.count, 3);
  assert.ok(barrel.grooves.enabled);
  const src = fs.readFileSync(path.join(srcRoot, "lib/maker/mugs/presets.ts"), "utf8");
  assert.ok(!/createMug|revolveProfile|createHandle/.test(src), "un preset no contiene código geométrico");
});

// ---------------------------------------------------------------- validación
test("validación: casos físicamente inválidos bloquean con mensaje claro", () => {
  const fields = (def) => validateMug(def).errors.map((e) => e.field);
  assert.ok(fields(mug({ wallThicknessMm: 0 })).includes("wallThicknessMm"));
  assert.ok(fields(mug({ wallThicknessMm: -1 })).includes("wallThicknessMm"));
  assert.ok(fields(mug({ bottomThicknessMm: 0 })).includes("bottomThicknessMm"));
  assert.ok(fields(mug({ wallThicknessMm: 20, topDiameterMm: 30, bottomDiameterMm: 30 })).length > 0, "radio interior inválido");
  assert.ok(fields(mug({ handle: { ...DEFAULT_MUG.handle, thicknessMm: 1 } })).includes("handle.thicknessMm"));
  assert.ok(fields(mug({ handle: { ...DEFAULT_MUG.handle, auto: false, projectionMm: 8 } })).includes("handle.projectionMm"), "la proyección entra en el cuerpo");
  assert.ok(fields(mug({ handle: { ...DEFAULT_MUG.handle, auto: false, heightMm: 140 } })).includes("handle.heightMm"));
  assert.ok(fields(mug({ mode: "insert-shell", insert: { ...DEFAULT_MUG.insert, clearanceMm: -0.2 } })).includes("insert.clearanceMm"));
  assert.ok(fields(mug({ bands: { enabled: true, count: 5, heightMm: 30, reliefMm: 1 } })).length > 0, "bandas que no entran");
  assert.ok(fields(mug({ wallThicknessMm: NaN })).includes("wallThicknessMm"));
  assert.equal(createMug(mug({ wallThicknessMm: 0 })).geometry, null, "sin geometría cuando hay errores");
  assert.equal(validateMug(DEFAULT_MUG).errors.length, 0);
});

test("validación: warnings de imprimibilidad no bloquean", () => {
  const printer = getPrinterProfile(DEFAULT_PRINTER_PROFILE_ID);
  const thin = validateMug(mug({ wallThicknessMm: 1 }), printer);
  assert.equal(thin.errors.length, 0);
  assert.ok(thin.warnings.some((w) => w.message === "Pared menor a 1.2mm."));
  const fine = validateMug(mug({ handle: { ...DEFAULT_MUG.handle, thicknessMm: 4 } }), printer);
  assert.ok(fine.warnings.some((w) => w.message === "El asa tiene una sección muy fina."));
  const wide = validateMug(mug({ topDiameterMm: 250, bottomDiameterMm: 240, heightMm: 300, handle: noHandle }), { ...printer, widthMm: 200, depthMm: 200 });
  assert.equal(wide.errors.length, 0);
  assert.ok(wide.warnings.some((w) => w.message === "El diámetro supera la cama configurada."));
  assert.ok(wide.warnings.some((w) => w.message === "El jarro supera la altura Z de la impresora."));
  assert.ok(createMug(mug({ wallThicknessMm: 1 })).geometry, "un warning no impide generar");
});

// ---------------------------------------------------------------- proyectos / definición / cama / STL
test("MugDefinition: normalización tolerante y proyecto Jarro separado de Carteles/Neon", () => {
  const n = normalizeMugDefinition({ heightMm: 120, bodyStyle: "nope", handle: { style: "angular", thicknessMm: "x" }, surface: null });
  assert.equal(n.heightMm, 120);
  assert.equal(n.bodyStyle, DEFAULT_MUG.bodyStyle);
  assert.equal(n.handle.style, "angular");
  assert.equal(n.handle.thicknessMm, DEFAULT_MUG.handle.thicknessMm);
  assert.deepEqual(normalizeMugDefinition(undefined), DEFAULT_MUG);
  const payload = serializeMugProject(DEFAULT_MUG);
  assert.equal(payload.source_type, "mug");
  assert.deepEqual(deserializeMugProject({ source_type: "mug", source_data: payload.source_data }), DEFAULT_MUG);
  assert.throws(() => deserializeMugProject({ source_type: "neon-text", source_data: {} }));
  assert.equal(mugProjectSignature(DEFAULT_MUG), mugProjectSignature(normalizeMugDefinition(JSON.parse(JSON.stringify(DEFAULT_MUG)))));
  assert.equal(JSON.stringify(payload).includes("positions"), false, "no se guardan mallas");
});

test("persistencia: los proyectos Jarro no se mezclan con Carteles ni Neon", () => {
  const repo = fs.readFileSync(path.join(srcRoot, "lib/maker/persistence/makerRepository.ts"), "utf8");
  assert.match(repo, /MUG_SOURCE_TYPES = \["mug"\]/);
  assert.match(repo, /SIGN_SOURCE_TYPES = \["text", "svg", "png"\]/);
  const migrations = fs.readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.includes("maker_mug_projects"));
  assert.equal(migrations.length, 1);
  assert.match(fs.readFileSync(path.join(root, "supabase/migrations", migrations[0]), "utf8"), /'mug'\)/);
});

test("Vista Cama: el jarro apoya sobre la base (minZ = 0), sin acostarse, y cabe en la A1", () => {
  const r = createMug(mug());
  const b = indexedBounds(r.indexed);
  assert.equal(b.minZ, 0);
  assert.ok(b.minX >= 0 && b.minY >= 0, "coordenadas positivas");
  const items = collectBedItems(r.geometry);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "body");
  assert.ok(Math.abs(items[0].heightMm - 150) < 1e-6);
  const layout = computeBedLayout(items, getPrinterProfile(DEFAULT_PRINTER_PROFILE_ID));
  assert.equal(layout.plates.length, 1);
  assert.equal(layout.oversize.length, 0);
  assert.equal(layout.tooTall.length, 0);
});

test("STL: una sola pieza jarro.stl; preview y export coinciden en dimensiones y capacidad", () => {
  const preview = createMug(mug(), { quality: "preview" }), exp = createMug(mug(), { quality: "export" });
  assert.equal(partFileEntries(exp.geometry.parts, "jarro")[0].fileName, "jarro.stl");
  assert.ok(Math.abs(preview.metrics.heightMm - exp.metrics.heightMm) < 1e-9);
  assert.ok(Math.abs(preview.metrics.boundingBox.width - exp.metrics.boundingBox.width) < 1.5);
  assert.ok(Math.abs(preview.metrics.capacityMl - exp.metrics.capacityMl) / exp.metrics.capacityMl < 0.01);
});

test("aislamiento: el motor de Jarros no importa la geometría de Carteles ni de Neon", () => {
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
  walk(path.join(srcRoot, "lib/maker/mugs"));
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    assert.ok(!/maker\/geometry\/|maker\/neon\//.test(src), `${path.relative(srcRoot, f)} importa geometría de Carteles/Neon`);
  }
});
