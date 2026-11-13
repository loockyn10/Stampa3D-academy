import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";
import { measureMechanics, referenceDesigns } from "./helpers/lamp-mechanics.mjs";

// SPRINT «editor visual»: las interfaces mecánicas de las lámparas (alojamiento del portalámparas, canal del difusor, encastre inferior del difusor, rosca de la
// pantalla y rosca de la base) NO pueden cambiar con la interfaz nueva. Estas pruebas comparan lo que genera el motor HOY (mallas y STL exportados) con las
// mediciones tomadas ANTES del sprint (tests/fixtures/lamp-mechanical-baseline.json, scripts/lamp-mechanical-baseline.mjs) y verifican que ninguna acción del
// editor (estilos, presets, familias, difusores, variaciones, correcciones) modifica un campo mecánico. Son pruebas GEOMÉTRICAS: no reemplazan probar el ajuste impreso.

const D = loadMakerModule("lib/maker/lamps/defaults.ts");
const S = loadMakerModule("lib/maker/lamps/standard.ts");
const E = loadMakerModule("lib/maker/lamps/editor.ts");
const CAPS = loadMakerModule("lib/maker/lamps/capabilities.ts");
const { switchFamily, applySilhouette, OPENWORK_PRESETS, applyOpenworkPreset } = loadMakerModule("lib/maker/lamps/openwork/presets.ts");
const { LAMP_PRESETS, applyLampPreset } = loadMakerModule("lib/maker/lamps/presets.ts");
const { generateLampVariation } = loadMakerModule("lib/maker/lamps/variation.ts");
const { applyHolderMount } = loadMakerModule("lib/maker/lamps/holder/applyMount.ts");
const { encodeLampDesign, decodeLampDesign } = loadMakerModule("lib/maker/lamps/designCode.ts");
const { summarizeIssues } = loadMakerModule("lib/maker/lamps/issuesSummary.ts");
const { validateLamp } = loadMakerModule("lib/maker/lamps/validation/validateLamp.ts");
const { REFERENCE_DIFFUSER } = loadMakerModule("lib/maker/lamps/holder/references.ts");

const FIXTURE = JSON.parse(fs.readFileSync(new URL("./fixtures/lamp-mechanical-baseline.json", import.meta.url), "utf8"));
const TOL = 0.0015; // los radios están redondeados a 0,001 mm

// ================================================================================================ 1. EL ESTÁNDAR ES LO QUE SIEMPRE FUE
test("estándar mecánico: las constantes internas son los valores que el motor ya usaba (y de los que sale DEFAULT_LAMP)", () => {
  assert.deepEqual(D.DEFAULT_LAMP.holder, { mount: "rings", pressDepthMm: D.DEFAULT_LAMP.holder.pressDepthMm, measured: false, boreDiameterMm: 42, ringsDiameterMm: 58, ringsClearanceMm: 0.9, ringsRecessDepthMm: 5.15, seatHeightMm: 31.4, bodyDiameterMm: 40, heightMm: 55 });
  assert.deepEqual(D.DEFAULT_LAMP.thread, { connection: "integrated", majorDiameterMm: 96, pitchMm: 5, starts: 2, engagementMm: 15, clearanceMm: 0.4, coreWallMm: 3 });
  assert.deepEqual(D.DEFAULT_LAMP.adhesion, { enabled: true, widthMm: 3, heightMm: 0.4 });
  assert.deepEqual(D.DEFAULT_LAMP.cable, { diameterMm: 7, tieAnchor: true });
  assert.equal(D.DEFAULT_LAMP.base.diameterMm, null);
  for (const k of ["thicknessMm", "clearanceMm", "seatDepthMm", "minBulbGapMm"]) assert.equal(D.DEFAULT_LAMP.insert[k], S.STANDARD_INSERT_FIT[k], `insert.${k}`);
  assert.equal(S.STANDARD_INSERT_FIT.thicknessMm, 0.8);
  assert.equal(S.STANDARD_INSERT_FIT.seatDepthMm, 10);
  assert.equal(S.STANDARD_INSERT_FIT.clearanceMm, 0.35);
  assert.equal(S.STANDARD_DIFFUSER_FIT.outerDiameterMm, REFERENCE_DIFFUSER.outerDiameterMm);
  assert.equal(REFERENCE_DIFFUSER.outerDiameterMm, 65.135);
  // las constantes están congeladas: no se pueden modificar en caliente
  for (const c of [S.STANDARD_HOLDER, S.STANDARD_THREAD, S.STANDARD_ADHESION, S.STANDARD_CABLE, S.STANDARD_DIFFUSER_FIT, S.STANDARD_BULB]) assert.ok(Object.isFrozen(c));
});

test("estándar mecánico: los valores coinciden con el layout medido en la línea base (rosca, torre, ranura y encastre)", () => {
  const base = FIXTURE.cases["solid-default-cylinder"].measures.layout;
  assert.equal(base.mount, "rings");
  assert.equal(base.thread.majorR * 2, S.STANDARD_THREAD.majorDiameterMm);
  assert.equal(base.thread.pitch, S.STANDARD_THREAD.pitchMm);
  assert.equal(base.thread.starts, S.STANDARD_THREAD.starts);
  assert.equal(base.thread.length, S.STANDARD_THREAD.engagementMm);
  assert.equal(base.thread.clearance, S.STANDARD_THREAD.clearanceMm);
  assert.equal(base.tower.boreR * 2, S.STANDARD_HOLDER.boreDiameterMm);
  assert.equal(base.tower.seatZ, S.STANDARD_HOLDER.seatHeightMm);
  assert.ok(Math.abs(base.tower.recessR * 2 - (S.STANDARD_HOLDER.ringsDiameterMm + 2 * S.STANDARD_HOLDER.ringsClearanceMm)) < 1e-9);
  assert.ok(Math.abs(base.insertFit.fitOuterR * 2 - 65.135) < 0.002, "encastre inferior Ø65,135");
  assert.ok(Math.abs((base.insertFit.fitOuterR - base.insertFit.mountInnerR) - 0.8) < 0.002, "pared del encastre 0,8 mm");
  assert.ok(Math.abs(base.tower.slot.bottomZ - (base.tower.topZ - S.STANDARD_INSERT_FIT.seatDepthMm)) < 1e-6, "canal del difusor: 10 mm de profundidad");
});

test("diseño nuevo: usa el estándar (sin desvíos) y la bombilla estándar; todos los estilos de difusor parten válidos", () => {
  const def = E.newLampDesign();
  assert.equal(S.mechanicalDeviations(def).length, 0);
  assert.deepEqual(def.bulb, S.STANDARD_BULB);
  assert.deepEqual(validateLamp(def).errors, []);
  const { available, hidden } = E.availableDiffuserKinds(def);
  assert.equal(hidden.length, 0, `estilos descartados: ${JSON.stringify(hidden)}`);
  assert.deepEqual([...available].sort(), ["bell", "cylinder", "drop", "flat", "hourglass", "mossglow", "tulip", "wavy"]);
});

// ================================================================================================ 2. REGRESIÓN CONTRA LAS MEDICIONES DE ANTES
function compareProfiles(actual, expected, label) {
  assert.deepEqual(Object.keys(actual), Object.keys(expected), `${label}: mismas alturas medidas`);
  for (const z of Object.keys(expected)) {
    expected[z].forEach((list, az) => {
      assert.equal(actual[z][az].length, list.length, `${label} z=${z} azimut ${az}: cantidad de cruces ${JSON.stringify(actual[z][az])} vs ${JSON.stringify(list)}`);
      list.forEach((r, i) => assert.ok(Math.abs(actual[z][az][i] - r) <= TOL, `${label} z=${z} azimut ${az} cruce ${i}: ${actual[z][az][i]} vs ${r}`));
    });
  }
}

const designs = referenceDesigns();
for (const [id, entry] of Object.entries(FIXTURE.cases)) {
  test(`mecánica sin cambios (STL y mallas) — ${id}`, async () => {
    // el diseño de referencia es el guardado en la línea base (no el que genere hoy el código): comparar contra lo MEDIDO antes
    const def = entry.def;
    // (la línea base se tomó cuando los difusores todavía podían llevar lengüetas: la receta guardada trae \`tabs\` en algunos diseños y hoy ese campo no tiene efecto)
    const noTabs = (d) => JSON.parse(JSON.stringify({ ...d, insert: { ...d.insert, tabs: false } }));
    // ÚNICA silueta rediseñada a propósito (2026-11-13, corrección de Mossglow): su receta y la forma de su cuerpo cambian; el encastre inferior (primeros 12,5 mm) NO.
    const REDESIGNED = id === "solid-mossglow";
    if (!REDESIGNED) assert.deepEqual(noTabs(designs[id]), noTabs(def), `${id}: la receta del diseño de referencia no cambió`);
    const now = await measureMechanics(def);
    const was = entry.measures;
    assert.deepEqual(now.layout, was.layout, `${id}: cotas del layout (rosca, torre, ranura, encastre)`);
    compareProfiles(now.base, was.base, `${id}/base (portalámparas, ranura, rosca hembra)`);
    compareProfiles(now.shade, was.shade, `${id}/pantalla (rosca macho)`);
    const fitOnly = (prof) => Object.fromEntries(Object.entries(prof).filter(([z]) => Number(z) <= was.layout.insertFit.z0 + 12.5));
    if (was.insert) compareProfiles(REDESIGNED ? fitOnly(now.insert) : now.insert, REDESIGNED ? fitOnly(was.insert) : was.insert, `${id}/difusor (encastre inferior)`);
    else assert.equal(now.insert, null);
    // STL exportados: mismas piezas, triángulos, cajas y volúmenes; la base es idéntica vértice a vértice
    assert.deepEqual(Object.keys(now.stl), Object.keys(was.stl), `${id}: mismas piezas exportadas`);
    for (const part of Object.keys(was.stl)) {
      // ÚNICA diferencia admitida respecto de antes del sprint: un difusor que antes llevaba lengüetas superiores (def.insert.tabs) ya no las lleva. Se verifica que
      // la pieza NO crece (sin salientes, menos material) y que su encastre inferior es idéntico (perfil de la zona de encastre comparado arriba). Todo lo demás: idéntico.
      if (/inserto|difusor/.test(part) && REDESIGNED) continue; // silueta nueva: ver tests/maker-lamps-mossglow-silhouette.test.mjs
      if (/inserto|difusor/.test(part) && def.insert.tabs) {
        assert.ok(was.stl[part].bbox[1] > was.stl[part].bbox[0] + 5, `${id}/${part}: antes las lengüetas sobresalían en Y`);
        assert.ok(Math.abs(now.stl[part].bbox[1] - now.stl[part].bbox[0]) < 1e-6, `${id}/${part}: ahora no sobresale nada en Y`);
        assert.ok(now.stl[part].volumeMm3 < was.stl[part].volumeMm3, `${id}/${part}: sin lengüetas hay menos material`);
        assert.ok(now.stl[part].bbox.every((v, k) => v <= was.stl[part].bbox[k] + 1e-6), `${id}/${part}: la caja no crece`);
        continue;
      }
      assert.equal(now.stl[part].triangles, was.stl[part].triangles, `${id}/${part}: triángulos`);
      assert.deepEqual(now.stl[part].bbox, was.stl[part].bbox, `${id}/${part}: caja`);
      assert.ok(Math.abs(now.stl[part].volumeMm3 - was.stl[part].volumeMm3) <= 0.2, `${id}/${part}: volumen ${now.stl[part].volumeMm3} vs ${was.stl[part].volumeMm3}`);
      assert.equal(now.stl[part].hash, was.stl[part].hash, `${id}/${part}: vértices del STL`);
    }
    assert.deepEqual(now.testPieces, was.testPieces, `${id}: piezas de prueba (rosca macho, rosca hembra, portalámparas)`);
  });
}

// ================================================================================================ 3. NINGUNA ACCIÓN DEL EDITOR TOCA LA MECÁNICA
const snap = S.mechanicalSnapshot;
const base = E.newLampDesign();
const OPENWORK = switchFamily(base, "openwork").def;
const DOUBLE = switchFamily(base, "double").def;
const SOLID_FAMILIES = { solid: base, openwork: OPENWORK, double: DOUBLE };

function assertSame(def, next, label) {
  assert.deepEqual(snap(next), snap(def), `${label}: cambió un campo mecánico`);
}

test("acciones del editor: cambiar de familia, estilo, preset, silueta, difusor, forma de la doble pared o variación no modifica ningún campo mecánico", () => {
  for (const from of Object.keys(SOLID_FAMILIES)) {
    for (const to of ["solid", "openwork", "double"]) assertSame(base, S.preserveMechanics(base, switchFamily(SOLID_FAMILIES[from], to).def), `${from}→${to}`);
  }
  for (const p of LAMP_PRESETS) assertSame(base, applyLampPreset(base, p), `preset ${p.id}`);
  for (const p of OPENWORK_PRESETS) assertSame(base, applyOpenworkPreset(OPENWORK, p), `calada ${p.id}`);
  for (const k of ["cylinder", "bulge", "hourglass", "organic"]) assertSame(base, applySilhouette(OPENWORK, k), `silueta ${k}`);
  for (const s of E.DOUBLE_STYLES) assertSame(base, E.applyDoubleStyle(DOUBLE, s), `doble pared ${s.id}`);
  for (const k of CAPS.familyCaps("solid").diffuser.allowed) assertSame(base, CAPS.applyDiffuserKind(base, k), `difusor ${k}`);
  for (const seed of [1, 7, 99, 12345]) assertSame(base, generateLampVariation(base, seed).def, `variación ${seed}`);
  // la red de seguridad del editor: preserveMechanics devuelve la mecánica de origen aunque la acción la hubiera tocado
  const tampered = { ...base, thread: { ...base.thread, majorDiameterMm: 110 }, holder: { ...base.holder, boreDiameterMm: 44 }, insert: { ...base.insert, clearanceMm: 0.6 } };
  assertSame(base, S.preserveMechanics(base, tampered), "preserveMechanics");
});

test("correcciones del editor: ninguna cambia la mecánica (rosca, adhesión, unión) y «Restablecer esta pantalla» la conserva", () => {
  for (const fix of [{ id: "raiseThread", label: "" }, { id: "disableAdhesion", label: "" }, { id: "useIntegrated", label: "" }, { id: "useCylinder", label: "" }, { id: "resetFamily", label: "" }]) {
    for (const def of [base, OPENWORK, DOUBLE]) assertSame(def, E.applyEditorFix(def, fix), `corrección ${fix.id}`);
  }
  for (const def of [base, OPENWORK, DOUBLE]) assertSame(def, E.resetShade(def), "resetShade");
  // un diseño anterior con medidas distintas conserva las suyas al restablecer la pantalla
  const legacy = applyHolderMount(base, "threadBase2").def;
  assertSame(legacy, E.resetShade(legacy), "resetShade (diseño anterior)");
  // y las correcciones mecánicas no se ofrecen en el resumen del editor
  const collar = { ...base, shadeType: "openwork", thread: { ...base.thread, connection: "collar" } };
  const v = validateLamp(collar);
  const raw = summarizeIssues(collar, v.errors, v.warnings);
  const editor = E.editorIssueSummary(collar, v.errors, v.warnings);
  assert.ok(raw.blocking.some((b) => b.fix && ["useIntegrated", "raiseThread", "disableAdhesion"].includes(b.fix.id)), "el motor ofrece una corrección mecánica");
  assert.ok(editor.blocking.every((b) => !b.fix || !["useIntegrated", "raiseThread", "disableAdhesion"].includes(b.fix.id)), "el editor no la ofrece");
});

// ================================================================================================ 4. DISEÑOS GUARDADOS (COMPATIBILIDAD)
test("diseños anteriores: se leen sin cambiar su mecánica; solo pasan al estándar con una acción explícita", () => {
  const variants = {
    press: applyHolderMount(base, "press").def,
    threadBase2: applyHolderMount(base, "threadBase2").def,
    threadV6: applyHolderMount(base, "threadV6").def,
    thread110: { ...base, thread: { ...base.thread, majorDiameterMm: 110 } },
    collar: { ...base, thread: { ...base.thread, connection: "collar" } },
    boreAndRings: { ...base, holder: { ...base.holder, boreDiameterMm: 44, ringsDiameterMm: 60 } },
  };
  for (const [name, def] of Object.entries(variants)) {
    const decoded = decodeLampDesign(encodeLampDesign(def));
    assert.ok(!("error" in decoded), name);
    assert.deepEqual(snap(decoded.def), snap(def), `${name}: la lectura conserva la mecánica`);
    const dev = S.mechanicalDeviations(decoded.def);
    assert.ok(dev.length > 0, `${name}: se detecta como medidas anteriores`);
    assert.ok(S.describeDeviations(dev).length > 0);
    // ninguna acción del editor la sobrescribe
    assertSame(def, S.preserveMechanics(def, switchFamily(def, "openwork").def), `${name} → calada`);
    assertSame(def, applyLampPreset(def, LAMP_PRESETS[2]), `${name} + preset`);
    // con permiso explícito sí pasa al estándar
    const std = S.applyStandardMechanics(def);
    assert.equal(S.mechanicalDeviations(std).length, 0, `${name}: estándar aplicado`);
    assert.deepEqual(snap(std), snap(base));
  }
  // los códigos anteriores sin los campos nuevos se completan con el estándar, no con otra cosa
  const minimal = decodeLampDesign(encodeLampDesign({ ...base, holder: undefined, thread: undefined, cable: undefined, adhesion: undefined }));
  assert.equal(S.mechanicalDeviations(minimal.def).length, 0);
  // la bombilla de un diseño anterior se conserva (Ø60 × 85 era el marcador de posición): no se «actualiza» sola
  const oldBulb = decodeLampDesign(encodeLampDesign({ ...base, bulb: D.DEFAULT_BULB }));
  assert.deepEqual(oldBulb.def.bulb, D.DEFAULT_BULB);
});
