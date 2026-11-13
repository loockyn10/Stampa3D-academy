import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";
import { loadTs } from "./helpers/load-ts.mjs";
import { loadLampUi } from "./helpers/lamp-editor-ui.mjs";

// Lámparas — Sprint UX V2: capacidades por familia (UNA definición), controles por familia, difusor cilíndrico obligatorio en calada y doble pared,
// cambio entre familias sin perder lo del usuario, errores cortos y accionables, rangos dinámicos y exportación solo de modelos válidos.
// Son pruebas GEOMÉTRICAS y de la interfaz real renderizada en Node (renderToStaticMarkup): no reemplazan abrir /stampa-maker/lamparas en el navegador
// ni laminar, y ninguna medida de acá es una validación térmica.

const { DEFAULT_LAMP, DEFAULT_OPENWORK, normalizeLampDefinition, applyInsertStyle } = loadMakerModule("lib/maker/lamps/defaults.ts");
const { createLamp } = loadMakerModule("lib/maker/lamps/createLamp.ts");
const { validateLamp } = loadMakerModule("lib/maker/lamps/validation/validateLamp.ts");
const { LAMP_LIMITS } = loadMakerModule("lib/maker/lamps/types.ts");
const CAPS = loadMakerModule("lib/maker/lamps/capabilities.ts");
const C = loadMakerModule("lib/maker/lamps/constraints.ts");
const { switchFamily, applyShadeType, applyOpenworkPreset, OPENWORK_PRESETS } = loadMakerModule("lib/maker/lamps/openwork/presets.ts");
const { applyLampPreset } = loadMakerModule("lib/maker/lamps/presets.ts");
const { availableLampPresets, availableOpenworkPresets } = loadMakerModule("lib/maker/lamps/availability.ts");
const S = loadMakerModule("lib/maker/lamps/issuesSummary.ts");
const { lampPartEntries, buildLampZipBlob } = loadMakerModule("lib/maker/lamps/exporters/lampFiles.ts");
const { encodeLampDesign, decodeLampDesign } = loadMakerModule("lib/maker/lamps/designCode.ts");
const { analyzeMesh } = loadMakerModule("lib/maker/mugs/geometry/mesh.ts");
const { selectLampView } = loadMakerModule("lib/maker/lamps/view.ts");

const OPENWORK = applyShadeType(DEFAULT_LAMP, "openwork");
const DOUBLE = applyShadeType(DEFAULT_LAMP, "double");
const FAMILIES = { solid: DEFAULT_LAMP, openwork: OPENWORK, double: DOUBLE };
const codes = (def) => validateLamp(def).errors.map((e) => e.code);
const setP = (def, path, v) => C.setLampPath(def, path, v);

function assertClosed(mesh, label) {
  const r = analyzeMesh(mesh);
  assert.equal(r.nonFinite + r.degenerate + r.boundaryEdges + r.nonManifoldEdges + r.inconsistentEdges, 0, `${label}: malla no cerrada`);
  assert.ok(r.volume > 0, `${label}: volumen`);
}
function buildValid(def, label) {
  const r = createLamp(def);
  assert.equal(r.errors.length, 0, `${label}: ${JSON.stringify(r.errors.map((e) => e.code))}`);
  for (const [name, mesh] of Object.entries(r.indexed)) if (mesh) assertClosed(mesh, `${label}/${name}`);
  return r;
}

// ------------------------------------------------------------------ la interfaz real
const registry = { seg: [] };
const mocks = {
  "next/link": { __esModule: true, default: (props) => createElement("a", props) },
  "opentype.js": {},
  "@/components/maker/LampFamilyPicker": {
    LampFamilyPicker: (p) => {
      registry.seg.push({ options: [{ value: "solid", label: "Sólida" }, { value: "openwork", label: "Calada" }, { value: "double", label: "Doble pared" }], value: p.value, onChange: p.onSelect });
      return createElement("div", null, "Sólida Calada Doble pared");
    },
  },
};
const { MakerLampControls, LampExportButtons } = loadLampUi(mocks);
function renderUi(def, extra = {}) {
  registry.seg = [];
  const r = createLamp(def);
  const ranges = extra.allRanges ? C.computeLampRanges(def) : undefined;
  return renderToStaticMarkup(
    createElement(MakerLampControls, {
      def, onChange() {}, onApplyPreset() {}, onGenerateVariation() {}, onLoadDesign() {}, onError() {},
      errors: extra.errors ?? r.errors, warnings: extra.warnings ?? r.warnings, metrics: r.metrics, outdated: !!extra.outdated, ranges,
      exportButtons: createElement(LampExportButtons, { hasInsert: def.insert.enabled, insertStyle: def.insert.style, hasCollar: false, canDownload: true, canDownloadTests: true, busy: null, onDownloadPart() {}, onDownloadZip() {}, onDownloadTests() {}, holderMeasured: false }),
    }),
  );
}
/** Lo que hay ANTES de «Más ajustes» de la pantalla y lo que hay desde ahí (el HTML renderiza también lo plegado). */
function split(html) {
  const i = html.indexOf('data-section="shade-more"');
  assert.ok(i > 0, "falta «Más ajustes»");
  return { main: html.slice(0, i), advanced: html.slice(i) };
}

// ================================================================== 1 — CAPACIDADES POR FAMILIA (una sola definición)
test("capacidades: cada familia declara sus controles, su difusor y sus uniones; la definición es la única fuente", () => {
  assert.deepEqual([...CAPS.LAMP_FAMILY_ORDER], ["solid", "openwork", "double"]);
  assert.deepEqual([...CAPS.familyCaps("solid").diffuser.allowed], ["cylinder", "flat", "drop", "wavy", "mossglow", "tulip", "hourglass", "bell"]);
  assert.deepEqual([...CAPS.familyCaps("openwork").diffuser.allowed], ["cylinder"]);
  assert.deepEqual([...CAPS.familyCaps("double").diffuser.allowed], ["cylinder"]);
  assert.equal(CAPS.familyCaps("double").diffuser.defaultEnabled, false, "la pared interior ya es parte de la pantalla: sin difusor por defecto");
  assert.equal(CAPS.familyCaps("openwork").diffuser.defaultEnabled, true);
  assert.deepEqual([...CAPS.familyCaps("solid").connections], ["integrated", "collar"]);
  assert.deepEqual([...CAPS.familyCaps("openwork").connections], ["integrated"]);
  assert.deepEqual([...CAPS.familyCaps("double").connections], ["integrated"]);
  // los controles principales son pocos y de la familia
  assert.deepEqual([...CAPS.familyCaps("solid").controls.main], ["shade.heightMm", "shade.bottomDiameterMm", "shade.amplitudeMm"]);
  assert.ok(CAPS.familyCaps("openwork").controls.main.length <= 3 && CAPS.familyCaps("double").controls.main.length + CAPS.familyCaps("double").controls.general.length <= 3);
  for (const type of CAPS.LAMP_FAMILY_ORDER) {
    const c = CAPS.familyCaps(type).controls;
    const all = [...c.main, ...c.general, ...c.advanced];
    assert.equal(new Set(all).size, all.length, `${type}: un control no está en dos niveles`);
    for (const path of all) {
      const [a, b] = path.split(".");
      assert.ok(a in DEFAULT_LAMP && b in DEFAULT_LAMP[a], `${type}: ${path} no existe en la definición`);
    }
  }
});

test("capacidades ↔ restricciones: los controles de cada pantalla salen de la definición de la familia; ninguno ajeno aparece", () => {
  for (const [name, def] of Object.entries(FAMILIES)) {
    const c = CAPS.familyCaps(def.shadeType).controls;
    const scoped = C.specsFor(def).filter((s) => /^(shade|openwork|doubleWall)\./.test(s.path));
    for (const s of scoped) assert.ok(CAPS.familyHasControl(def.shadeType, s.path), `${name}: ${s.path} no es de la familia`);
    for (const s of C.specsFor(def)) assert.equal(!!s.main, CAPS.isMainControl(def.shadeType, s.path), `${name}: ${s.path}: «principal» lo decide la familia`);
    // (los controles que dependen de otra opción —p. ej. «bandas» solo con el patrón espiral— no tienen rango cuando no aplican)
    for (const path of [...c.main, ...c.general]) if (C.LAMP_CONTROL_SPECS.filter((x) => x.path === path).some((x) => !x.when || x.when(def))) assert.ok(C.specsFor(def).some((x) => x.path === path && x.main), `${name}: ${path} es principal pero no tiene rango`);
  }
  // un control de otra familia no entra en los rangos de esta
  assert.ok(!C.specsFor(DEFAULT_LAMP).some((s) => s.path.startsWith("openwork.") || s.path.startsWith("doubleWall.")));
  assert.ok(!C.specsFor(OPENWORK).some((s) => s.path.startsWith("doubleWall.") || s.path === "shade.amplitudeMm" || s.path === "shade.waves"));
  assert.ok(!C.specsFor(DOUBLE).some((s) => s.path.startsWith("openwork.") || s.path === "shade.amplitudeMm"));
  // los controles del difusor ondulado/gota solo existen en la sólida con esa forma
  const wavy = applyInsertStyle(DEFAULT_LAMP, "wavy");
  assert.ok(C.specsFor(wavy).some((s) => s.path === "insert.amplitudeMm"));
  assert.ok(C.specsFor(applyInsertStyle(DEFAULT_LAMP, "drop")).some((s) => s.path === "insert.dropClosureMm"));
  assert.ok(!C.specsFor(DEFAULT_LAMP).some((s) => s.path.startsWith("insert.") && s.path !== "insert.heightMm"));
  assert.ok(!C.specsFor({ ...OPENWORK, insert: { ...OPENWORK.insert } }).some((s) => s.path === "insert.amplitudeMm"));
});

// ================================================================== 2 — CONTROLES VISIBLES POR FAMILIA (interfaz real)
test("controles visibles: sólida muestra sus tres principales y sus difusores; lo técnico queda plegado en «Más ajustes»", () => {
  const { main, advanced } = split(renderUi(DEFAULT_LAMP));
  for (const t of ["Tipo de lámpara", "Estilo", "Altura", "Diámetro", "Intensidad del diseño"]) assert.ok(main.includes(t), `sólida: «${t}» a la vista`);
  for (const t of ["Cantidad de ondas", "Torsión", "Diámetro superior", "Familia de patrón", "Perfil", "Variación vertical"]) assert.ok(advanced.includes(t), `sólida: «${t}» avanzado`);
  assert.ok(!main.includes("Cantidad de ondas") && !main.includes("Torsión"));
  for (const t of ["Densidad del calado", "Separación entre paredes", "Forma interior", "Pared interior"]) assert.ok(!main.includes(t) && !advanced.includes(t), `sólida: no debe mostrar «${t}»`);
  const html = renderUi(DEFAULT_LAMP);
  for (const kind of ["cylinder", "flat", "drop", "wavy"]) assert.ok(html.includes(`data-diffuser="${kind}"`), `sólida ofrece el difusor ${kind}`);
  assert.ok(!/<details[^>]*open[^>]*>\s*<summary[^>]*>Más ajustes/.test(html), "lo avanzado empieza plegado");
});

test("controles visibles: calada muestra altura, forma exterior y densidad; su difusor es solo cilíndrico y no hay controles de otras familias", () => {
  const html = renderUi(OPENWORK);
  const { main, advanced } = split(html);
  for (const t of ["Estilo", "Altura", "Forma exterior", "Densidad del patrón"]) assert.ok(main.includes(t), `calada: «${t}»`);
  for (const t of ["Diámetro máximo decorativo", "Torsión", "Inclinación de las diagonales", "Grosor de la estructura"]) assert.ok(advanced.includes(t), `calada: «${t}» avanzado`);
  for (const t of ["Intensidad del diseño", "Familia de patrón", "Cantidad de ondas", "Separación entre paredes", "Forma interior"]) assert.ok(!html.includes(t), `calada: no debe mostrar «${t}»`);
  for (const kind of ["flat", "drop", "wavy"]) assert.ok(!html.includes(`data-diffuser="${kind}"`), `calada no ofrece el difusor ${kind}`);
  assert.ok(html.includes("difusor cilíndrico recto"));
  assert.ok(!html.includes("Por su diámetro") && !html.includes("Según los anillos") && !html.includes("Holgura diametral"), "el ajuste del difusor a los anillos no es un control: lo resuelve el motor");
  // sin terminación cerrada ni lengüetas: ningún control de tapa, cierre ni ondas del difusor
  for (const t of ["Espesor de la tapa", "Altura del cierre", "Número de ondas", "Lengüetas"]) assert.ok(!html.includes(t), `calada: sin «${t}»`);
  const spiral = renderUi({ ...OPENWORK, openwork: { ...OPENWORK.openwork, pattern: "spiral", bands: 6, turns: 0.4, stripWidthMm: 6 } });
  assert.ok(spiral.includes("Densidad del patrón (bandas)") && !spiral.includes("rombos alrededor"));
});

test("controles visibles: doble pared muestra sus formas y la separación; sin difusor ajeno ni controles de sólida o calada", () => {
  const html = renderUi(DOUBLE);
  const { main, advanced } = split(html);
  for (const t of ["Forma exterior", "Forma interior", "Separación entre paredes"]) assert.ok(main.includes(t), `doble: «${t}»`);
  for (const t of ["Dimensiones", "Altura", "Diámetro máximo", "Pared exterior", "Pared interior", "Profundidad de las ondulaciones", "Torsión", "Cámara de aire"]) assert.ok(advanced.includes(t), `doble: «${t}» en «Más ajustes»`);
  for (const t of ["Familia de patrón", "Intensidad del diseño", "Densidad del calado", "Inclinación de las diagonales"]) assert.ok(!html.includes(t), `doble: no debe mostrar «${t}»`);
  assert.equal(DOUBLE.insert.enabled, false);
  assert.ok(!html.includes("Forma del difusor") && !html.includes('data-diffuser="'), "sin difusor, ninguna forma de difusor");
  assert.ok(html.includes("Agregar un difusor (opcional)"));
  // el modo jarrón no se presenta como funcional
  assert.ok(!html.includes("Impresión convencional") && !html.includes("Spiral vase"), "no se ofrece elegir el modo de fabricación (el modo jarrón no existe para la doble pared)");
  // con el difusor opcional activado solo es cilíndrico (nunca gota ni tapa)
  const withDiffuser = renderUi({ ...DOUBLE, insert: { ...DOUBLE.insert, enabled: true } });
  assert.ok(!withDiffuser.includes('data-diffuser="drop"') && !withDiffuser.includes('data-diffuser="flat"'));
});

// ================================================================== 3 — COMPATIBILIDAD DEL DIFUSOR
test("difusor: calada y doble pared solo aceptan el cilíndrico recto; el motor rechaza el resto con un solo error y no genera nada", () => {
  for (const [name, def] of [["calada", OPENWORK], ["doble", { ...DOUBLE, insert: { ...DOUBLE.insert, enabled: true } }]]) {
    assert.equal(CAPS.diffuserCompatible(def), true, name);
    assert.equal(CAPS.diffuserKind(def.insert), "cylinder", name);
    for (const style of ["flat", "drop", "wavy"]) {
      const bad = applyInsertStyle(def, style);
      assert.deepEqual(codes(bad), ["DIFFUSER_NOT_COMPATIBLE"], `${name}/${style}: ${codes(bad)}`);
      assert.equal(createLamp(bad).geometry, null, `${name}/${style}: no se genera`);
      assert.throws(() => lampPartEntries(createLamp(bad)), /./, `${name}/${style}: no se exporta`);
      // la acción propuesta lo corrige de forma fiable
      const issue = validateLamp(bad).errors[0];
      const summary = S.summarizeIssues(bad, [issue], []);
      assert.equal(summary.primary.fix.id, "useCylinder");
      assert.deepEqual(codes(S.applyFix(bad, summary.primary.fix)), [], `${name}/${style}: tras «Usar difusor cilíndrico»`);
      // y el selector no deja elegir lo incompatible
      assert.equal(CAPS.applyDiffuserKind(def, style === "wavy" ? "wavy" : style), def, `${name}/${style}: applyDiffuserKind no cambia nada`);
    }
  }
  // la sólida los acepta a todos (con las medidas por defecto) y cada uno es una malla cerrada
  for (const kind of ["cylinder", "flat", "drop", "wavy"]) {
    const def = CAPS.applyDiffuserKind(DEFAULT_LAMP, kind);
    assert.equal(CAPS.diffuserKind(def.insert), kind);
    buildValid(def, `sólida/${kind}`);
  }
  // sin difusor no hay nada que rechazar
  assert.deepEqual(codes({ ...OPENWORK, insert: { ...applyInsertStyle(OPENWORK, "drop").insert, enabled: false } }), []);
});

test("difusor cilíndrico de la calada: Ø80 exterior, abertura libre Ø81 (holgura 1 mm), cambiar la silueta no lo modifica", () => {
  const { openingFreeDiameters, resolveLampDef } = loadMakerModule("lib/maker/lamps/resolve.ts");
  const base = { ...OPENWORK, thread: { ...OPENWORK.thread, majorDiameterMm: 102 }, openwork: { ...OPENWORK.openwork, diffuserDiameterMm: 80, diffuserClearanceMm: 1, maxDiameterMm: 150 } };
  const r = buildValid(base, "calada Ø80");
  const free = openingFreeDiameters(resolveLampDef(base));
  assert.ok(Math.abs(free.bottomMm - 81) < 0.005 && Math.abs(free.topMm - 81) < 0.005, `abertura ${free.bottomMm}/${free.topMm}`);
  assert.equal(r.metrics.fit.diffuser.diffuserDiameterMm, 80);
  assert.equal(CAPS.diffuserKind(base.insert), "cylinder");
  const insertBefore = r.indexed.insert.positions;
  for (const kind of ["cylinder", "bulge", "organic"]) {
    const { applySilhouette } = loadMakerModule("lib/maker/lamps/openwork/presets.ts");
    const d = applySilhouette(base, kind);
    const rr = createLamp(d);
    if (rr.errors.length) continue; // lo que no es válido con estas medidas no se ofrece
    assert.equal(rr.metrics.fit.diffuser.diffuserDiameterMm, 80, `${kind}: el difusor sigue en Ø80`);
    assert.deepEqual(rr.indexed.insert.positions, insertBefore, `${kind}: el difusor es el mismo`);
  }
});

// ================================================================== 4 — VALORES PREDETERMINADOS Y CAMBIO DE FAMILIA
test("valores predeterminados: cada familia nace válida, con su difusor y sin avisos obsoletos", () => {
  for (const [name, def] of Object.entries(FAMILIES)) {
    const r = buildValid(def, name);
    assert.equal(r.warnings.some((w) => w.code === "DIFFUSER_TABS_NOT_APPLICABLE"), false, `${name}: sin lengüetas inaplicables`);
    assert.equal(def.insert.enabled, CAPS.familyCaps(name === "solid" ? "solid" : name === "openwork" ? "openwork" : "double").diffuser.defaultEnabled, `${name}: difusor según la familia`);
  }
  assert.equal(OPENWORK.insert.tabs, false);
  assert.equal(DOUBLE.insert.tabs, false);
  assert.equal(CAPS.diffuserKind(OPENWORK.insert), "cylinder");
  // la calada parte con el difusor como dato
  assert.equal(OPENWORK.openwork.diffuserFit, "diameter");
});

test("cambio entre familias: conserva dimensiones y montaje, no pisa los parámetros de otra familia y recuerda el difusor de cada una", () => {
  // una sólida personalizada: gota roja, altura, rosca y base elegidas, parámetros propios de la calada ya tocados
  let def = applyInsertStyle(DEFAULT_LAMP, "drop");
  def = { ...def, insert: { ...def.insert, previewColor: "#3b7be5" }, shade: { ...def.shade, heightMm: 200 }, thread: { ...def.thread, majorDiameterMm: 102 }, base: { diameterMm: 140 }, openwork: { ...def.openwork, divisions: 20, twistDeg: 80 }, doubleWall: { ...def.doubleWall, flutes: 30 } };
  const a = switchFamily(def, "openwork", {});
  assert.equal(a.def.shadeType, "openwork");
  assert.equal(CAPS.diffuserKind(a.def.insert), "cylinder", "la calada recibe el difusor cilíndrico");
  assert.equal(a.def.insert.previewColor, "#3b7be5", "el color se conserva");
  assert.equal(a.def.shade.heightMm, 200);
  assert.equal(a.def.thread.majorDiameterMm, 102);
  assert.deepEqual(a.def.base, { diameterMm: 140 });
  assert.deepEqual(a.def.holder, def.holder);
  assert.deepEqual(a.def.openwork, def.openwork, "los parámetros de la calada no se tocan");
  assert.deepEqual(a.def.doubleWall, def.doubleWall);
  const b = switchFamily(a.def, "double", a.memory);
  assert.equal(b.def.insert.enabled, false, "la doble pared parte sin difusor");
  assert.equal(b.def.insert.previewColor, "#3b7be5");
  assert.deepEqual(b.def.openwork, def.openwork);
  // volver a la sólida: vuelve la gota, tal como estaba (no se perdió al pasar por las otras)
  const c = switchFamily(b.def, "solid", b.memory);
  assert.equal(CAPS.diffuserKind(c.def.insert), "drop");
  assert.deepEqual(c.def.insert, def.insert);
  assert.equal(c.def.shade.bottomDiameterMm, def.shade.bottomDiameterMm);
  assert.equal(c.def.thread.connection, def.thread.connection);
  // cada familia queda válida o con un error que se explica (nunca un estado a medias)
  for (const type of ["solid", "openwork", "double"]) {
    const sw = switchFamily(DEFAULT_LAMP, type, {});
    assert.deepEqual(codes(sw.def), [], `${type}: ${codes(sw.def)}`);
  }
  // el mismo cambio sin memoria equivale a applyShadeType
  assert.deepEqual(applyShadeType(def, "openwork"), a.def);
  assert.equal(switchFamily(def, "solid", {}).def, def, "elegir la familia activa no cambia nada");
});

test("cambio entre familias: la unión por collar es solo de la sólida; la calada y la doble pared vuelven a la rosca integrada y la sólida la recupera", () => {
  const collar = { ...DEFAULT_LAMP, thread: { ...DEFAULT_LAMP.thread, connection: "collar" } };
  const o = switchFamily(collar, "openwork", {});
  assert.equal(o.def.thread.connection, "integrated");
  assert.deepEqual(codes(o.def), []);
  assert.equal(switchFamily(o.def, "solid", o.memory).def.thread.connection, "collar");
  for (const def of [OPENWORK, DOUBLE]) assert.ok(codes({ ...def, thread: { ...def.thread, connection: "collar" } }).length > 0, "el motor rechaza el collar en esta familia");
  const html = renderUi(OPENWORK);
  // la unión es mecánica: el editor no ofrece elegirla en ninguna familia (la sólida la conserva en el motor y en los diseños anteriores)
  assert.ok(!html.includes("Collar (modo vaso)") && !html.includes("Rosca en la pantalla"));
  assert.ok(!renderUi(DEFAULT_LAMP).includes("Collar (modo vaso)"));
});

test("cambio entre familias: la interfaz cambia el estado y los errores de la familia anterior no pasan a la nueva", () => {
  const html = renderUi(DEFAULT_LAMP);
  assert.ok(html.includes('data-family-section="solid"'));
  const seg = registry.seg.find((c) => c.options.some((o) => o.label === "Calada"));
  assert.ok(seg, "el selector de tipo está registrado");
  // errores de una calada (tiras casi horizontales) se resumen con la calada activa…
  const steep = { ...OPENWORK, openwork: { ...OPENWORK.openwork, pattern: "spiral", bands: 6, turns: 1.5, stripWidthMm: 5 } };
  const issues = validateLamp(steep).errors;
  assert.ok(issues.some((e) => e.code === "OPENWORK_STRIP_TOO_FLAT"));
  assert.ok(S.summarizeIssues(steep, issues, []).blocking.length > 0);
  // …y NO se muestran si la familia activa es otra
  assert.deepEqual(S.summarizeIssues(DEFAULT_LAMP, issues.filter((e) => e.code.startsWith("OPENWORK_")), []).blocking, []);
  assert.deepEqual(S.summarizeIssues(OPENWORK, [{ code: "DW_GAP", message: "x" }, { code: "DW_LEAN", message: "y" }], []).blocking, []);
  // el visor: la última lámpara válida solo se usa dentro de la misma familia (el hook la descarta al cambiar de familia)
  const hook = fs.readFileSync("src/hooks/maker/useLampGeometry.ts", "utf8");
  assert.ok(/family === debounced\.shadeType/.test(hook), "la vista anterior es de la misma familia");
  const good = createLamp(DEFAULT_LAMP);
  const bad = createLamp({ ...DEFAULT_LAMP, shade: { ...DEFAULT_LAMP.shade, waves: 32 } });
  assert.equal(selectLampView(bad, null).outdated, false, "sin vista anterior de la familia, no hay vista desactualizada");
  assert.equal(selectLampView(bad, good).outdated, true);
});

// ================================================================== 5 — PRESETS
test("presets: cada diseño ofrecido es válido, conserva el difusor y la unión de la familia y no activa lo que no corresponde", () => {
  const solid = availableLampPresets(DEFAULT_LAMP);
  assert.ok(solid.available.length >= 6);
  for (const preset of solid.available) {
    const d = applyLampPreset(DEFAULT_LAMP, preset);
    assert.deepEqual(codes(d), [], `sólida/${preset.id}`);
    assert.deepEqual(d.insert, DEFAULT_LAMP.insert, `sólida/${preset.id}: el diseño no cambia el difusor`);
  }
  const drop = applyInsertStyle(DEFAULT_LAMP, "drop");
  assert.deepEqual(applyLampPreset(drop, solid.available[0]).insert, drop.insert, "un diseño no pisa el difusor elegido");
  const ow = availableOpenworkPresets(OPENWORK, OPENWORK_PRESETS);
  assert.ok(ow.available.length >= 4);
  for (const preset of ow.available) {
    const d = applyOpenworkPreset(OPENWORK, preset);
    assert.deepEqual(codes(d), [], `calada/${preset.id}`);
    assert.equal(CAPS.diffuserKind(d.insert), "cylinder", `calada/${preset.id}: difusor cilíndrico`);
    assert.equal(d.openwork.diffuserDiameterMm, OPENWORK.openwork.diffuserDiameterMm, `calada/${preset.id}: el difusor no cambia`);
  }
  for (const h of [...solid.hidden, ...ow.hidden]) assert.ok(h.reason && h.reason.length < 160, "lo que no se ofrece explica por qué en una frase");
  // la doble pared: aplicar un preset de otra familia no cambia el difusor desactivado
  assert.equal(applyOpenworkPreset(DOUBLE, ow.available[0]).shadeType, "openwork");
});

// ================================================================== 6 — RANGOS DINÁMICOS
test("rangos dinámicos: los controles del difusor de la sólida también ofrecen solo valores válidos para el estado actual", () => {
  for (const kind of ["drop", "wavy"]) {
    const def = applyInsertStyle(DEFAULT_LAMP, kind);
    const specs = C.specsFor(def).filter((s) => s.path.startsWith("insert.") && s.path !== "insert.heightMm");
    assert.ok(specs.length >= 3, `${kind}: controles del difusor con rango`);
    for (const spec of specs) {
      const r = C.computeControlRange(def, spec);
      assert.ok(r.min >= spec.min - 1e-9 && r.max <= spec.max + 1e-9 && r.min <= r.max, `${spec.path}: rango dentro de la envolvente`);
      for (const v of [r.min, r.max, (r.min + r.max) / 2]) {
        const next = setP(def, spec.path, Math.round(v / spec.step) * spec.step);
        assert.deepEqual(codes(next).filter((c) => !r.persistentCodes.includes(c)), [], `${kind} ${spec.path}=${v}`);
      }
    }
  }
  // un valor fuera del rango válido se informa y se puede llevar al más cercano (acción explícita: nada se cambia en silencio)
  const wavy = applyInsertStyle(DEFAULT_LAMP, "wavy");
  const amp = C.computeControlRange(wavy, C.specFor(wavy, "insert.amplitudeMm"));
  assert.equal(C.nearestInRange(amp, 999), amp.max);
  assert.equal(wavy.insert.amplitudeMm, 2.5, "la definición no se modificó");
});

test("rangos dinámicos: los controles principales de cada familia ofrecen valores válidos y sus extremos generan mallas cerradas", () => {
  for (const [name, def] of Object.entries(FAMILIES)) {
    for (const path of [...CAPS.familyCaps(def.shadeType).controls.main, ...CAPS.familyCaps(def.shadeType).controls.general]) {
      const spec = C.specFor(def, path);
      if (!spec) continue; // (p. ej. «bandas» con patrón diamante)
      const r = C.computeControlRange(def, spec);
      for (const v of [r.min, r.max]) buildValid(setP(def, path, v), `${name} ${path}=${v}`);
    }
  }
});

// ================================================================== 7 — ERRORES Y ADVERTENCIAS RESUMIDOS
const LONG = (s) => s.length > 90;
const INTERNAL_CODE = /\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/;

test("errores resumidos: cada problema se dice en una frase corta, sin códigos internos y sin repetirse", () => {
  const cases = [
    { ...DEFAULT_LAMP, shade: { ...DEFAULT_LAMP.shade, waves: 32 } },
    { ...OPENWORK, openwork: { ...OPENWORK.openwork, pattern: "spiral", bands: 6, turns: 1.5, stripWidthMm: 5 } },
    { ...OPENWORK, openwork: { ...OPENWORK.openwork, diffuserDiameterMm: 90 } },
    { ...DOUBLE, doubleWall: { ...DOUBLE.doubleWall, minGapMm: 60 } },
    { ...DEFAULT_LAMP, shade: { ...DEFAULT_LAMP.shade, wallMm: 0.1 } },
    applyInsertStyle(OPENWORK, "drop"),
  ];
  for (const def of cases) {
    const v = validateLamp(def);
    assert.ok(v.errors.length > 0, "el caso debe ser inválido");
    const sum = S.summarizeIssues(def, v.errors, v.warnings);
    assert.ok(sum.primary, "hay un problema principal");
    const all = [...sum.blocking, ...sum.advice, ...sum.safety];
    for (const item of all) {
      assert.ok(item.short.length > 3 && !LONG(item.short), `corto: «${item.short}»`);
      assert.ok(!INTERNAL_CODE.test(item.short), `sin código interno: «${item.short}»`);
      assert.ok(item.detail.length > 0);
    }
    assert.equal(new Set(all.map((i) => i.short)).size, all.length, "sin frases repetidas");
    assert.ok(sum.blocking.length <= v.errors.length);
  }
});

test("errores resumidos: lo equivalente se agrupa, lo de otra familia no se muestra, lo obsoleto o fijo no ocupa la pantalla", () => {
  const e = (code, field) => ({ code, field, message: "mensaje largo del motor. ".repeat(8) });
  // equivalentes: una sola frase
  const grouped = S.summarizeIssues(OPENWORK, [e("INSERT_DOES_NOT_FIT"), e("INSERT_TOUCHES_SHADE"), e("DIFFUSER_STRUCTURE_INTRUDES"), e("DIFFUSER_PATH_BLOCKED"), e("DIFFUSER_CANNOT_PASS_TOP")], []);
  assert.deepEqual(grouped.blocking.map((i) => i.short), ["El difusor no entra.", "El difusor no se podría colocar ni retirar."]);
  assert.deepEqual(S.summarizeIssues(DEFAULT_LAMP, [e("HOLDER_BODY_WIDER_THAN_THREAD"), e("PRESS_HOLDER_TOO_WIDE")], []).blocking.map((i) => i.short), ["Este diseño necesita otro tipo de fijación."]);
  // mensajes de otra familia
  assert.deepEqual(S.summarizeIssues(DEFAULT_LAMP, [e("OPENWORK_OPENING_CLOSED"), e("DW_GAP")], [e("OPENWORK_NEEDS_SUPPORT"), e("DW_CLOSED_CAVITY")]).blocking, []);
  assert.deepEqual(S.summarizeIssues(DEFAULT_LAMP, [], [e("OPENWORK_NEEDS_SUPPORT"), e("DW_CLOSED_CAVITY")]).advice, []);
  // lo que siempre acompaña al diseño o ya está resuelto no se muestra
  const fixed = S.summarizeIssues(OPENWORK, [], [e("PHYSICAL_VALIDATION_PENDING"), e("HOLDER_NOT_VALIDATED"), e("ADHESION_UNVERIFIED"), e("DIFFUSER_TABS_NOT_APPLICABLE")]);
  assert.deepEqual([fixed.blocking, fixed.advice, fixed.safety], [[], [], []]);
  // lo térmico es UN aviso proporcionado aunque haya varias causas, con el detalle completo al expandir
  const thermal = S.summarizeIssues(OPENWORK, [], [e("OPENWORK_NOT_THERMAL"), e("INSERT_GAP_UNVALIDATED"), e("INSERT_CLOSED_THERMAL_PENDING")]);
  assert.equal(thermal.safety.length, 1);
  assert.ok(thermal.safety[0].detail.split("\n").length === 3);
  // recomendaciones: un indicador, no un párrafo por aviso
  const advice = S.summarizeIssues(OPENWORK, [], [e("FLARE_INWARD"), e("TOWER_INNER_WALL_THIN"), e("OPENWORK_NEEDS_SUPPORT")]);
  assert.equal(advice.advice.length, 3);
  assert.deepEqual(advice.blocking, []);
  // un código que el resumen no conoce igual da una frase corta (nunca el párrafo del motor ni el código)
  const unknown = S.summarizeIssues(DEFAULT_LAMP, [e("ALGO_NUEVO_DEL_MOTOR", "shade.waves")], []);
  assert.ok(!LONG(unknown.primary.short) && !INTERNAL_CODE.test(unknown.primary.short), unknown.primary.short);
});

test("errores resumidos: la interfaz muestra la frase corta con su acción; el detalle solo al expandir; la descarga no se ofrece con errores", () => {
  const def = { ...OPENWORK, openwork: { ...OPENWORK.openwork, diffuserDiameterMm: 90 } };
  const r = createLamp(def);
  assert.equal(r.geometry, null);
  const html = renderUi(def, { outdated: true });
  const alertAt = html.indexOf('role="alert"');
  assert.ok(alertAt > 0 && html.includes("El difusor no pasa por el cuello de la rosca."), "el problema principal está a la vista");
  assert.ok(!html.includes("Agrandar la rosca"), "la corrección que cambia la rosca no se ofrece en el editor (la mecánica es fija)");
  assert.ok(html.includes("Volver al último diseño") === false, "sin último diseño válido no se ofrece volver");
  assert.ok(html.includes("Restablecer esta pantalla"));
  assert.ok(html.includes("El visor muestra el último diseño válido") && html.includes("No se puede descargar"));
  // el párrafo técnico completo existe solo DENTRO de «Ver detalle»
  const detail = r.errors.find((x) => x.code === "DIFFUSER_EXCEEDS_BASE").message;
  const at = html.indexOf(detail.slice(0, 60).replace(/&/g, "&amp;"));
  assert.ok(at > html.indexOf("Ver detalle"), "el detalle viene después de «Ver detalle»");
  // el compuesto de prueba renderiza los tres paneles del editor (en la interfaz se ve uno a la vez): una vez por panel, nunca repetido dentro de uno
  assert.equal(html.split(detail.slice(0, 60)).length - 1, 3, "el párrafo aparece una sola vez por panel");
  // ningún código interno en la interfaz
  assert.ok(!INTERNAL_CODE.test(html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, " ").replace(/\b(STL|DW)\b/g, "")), "sin códigos internos en el texto visible");
  // la acción propuesta deja una lámpara válida
  const summary = S.summarizeIssues(def, r.errors, r.warnings);
  assert.equal(summary.primary.fix.id, "raiseThread");
  assert.deepEqual(codes(S.applyFix(def, summary.primary.fix)), []);
});

test("errores resumidos: valores fuera de rango, recuperación y restablecer devuelven una lámpara válida; no se modifica nada en silencio", () => {
  const bad = setP(DOUBLE, "doubleWall.wallMm", 0.1);
  const v = validateLamp(bad);
  const sum = S.summarizeIssues(bad, v.errors, v.warnings);
  assert.equal(sum.primary.fix.id, "clampField");
  assert.equal(sum.primary.fix.value, LAMP_LIMITS["doubleWall.wallMm"].min);
  assert.equal(bad.doubleWall.wallMm, 0.1, "la definición del usuario no se tocó");
  assert.deepEqual(codes(S.applyFix(bad, sum.primary.fix)), []);
  assert.equal(S.fieldMessage(sum, "doubleWall.wallMm"), sum.primary.short, "el mensaje corto también sale junto al control");
  for (const [name, def] of Object.entries(FAMILIES)) {
    const broken = { ...def, shade: { ...def.shade, waves: 999, heightMm: 5 } };
    const reset = S.resetFamily(broken);
    assert.equal(reset.shadeType, def.shadeType, `${name}: sigue en la misma familia`);
    assert.deepEqual(codes(reset), [], `${name}: restablecer deja una lámpara válida (${codes(reset)})`);
    assert.equal(reset.thread.majorDiameterMm, def.thread.majorDiameterMm, `${name}: conserva la rosca`);
    assert.deepEqual(reset.holder, def.holder, `${name}: conserva el portalámparas`);
  }
});

// ================================================================== 8 — EXPORTACIÓN
test("exportación: cada familia exporta sus piezas desde las mismas mallas del visor; con errores no se exporta nada", async () => {
  for (const [name, def] of Object.entries(FAMILIES)) {
    const r = buildValid(def, name);
    const names = lampPartEntries(r).map((x) => x.fileName);
    assert.ok(names.some((n) => /pantalla/.test(n)) && names.some((n) => /base/.test(n)), `${name}: pantalla y base`);
    assert.equal(names.some((n) => /inserto/.test(n)), def.insert.enabled, `${name}: el difusor solo se exporta si está activado`);
    const zip = await JSZip.loadAsync(Buffer.from(await (await buildLampZipBlob(r, def)).arrayBuffer()));
    assert.ok(Object.keys(zip.files).includes("LEEME.txt"), `${name}: LEEME`);
  }
  // doble pared con difusor opcional: se exporta cilíndrico
  const withDiffuser = { ...DOUBLE, insert: { ...DOUBLE.insert, enabled: true } };
  assert.ok(lampPartEntries(buildValid(withDiffuser, "doble con difusor")).some((x) => /inserto/.test(x.fileName)));
  // modelos inválidos: no se genera geometría ni se exporta
  for (const bad of [applyInsertStyle(OPENWORK, "flat"), { ...DEFAULT_LAMP, shade: { ...DEFAULT_LAMP.shade, waves: 32 } }, setP(DOUBLE, "doubleWall.wallMm", 0.1)]) {
    const r = createLamp(bad);
    assert.equal(r.geometry, null);
    assert.throws(() => lampPartEntries(r), /./);
    await assert.rejects(() => buildLampZipBlob(r, bad));
  }
  // el editor bloquea la descarga si hay errores o el visor muestra una vista anterior
  const page = fs.readFileSync("src/components/maker/lamps/LampEditor.tsx", "utf8");
  assert.ok(/canDownload = !pending && !outdated && !!geometry && geometry\.triangleCount > 0 && result\.errors\.length === 0/.test(page));
});

// ================================================================== 9 — PROYECTOS GUARDADOS
test("compatibilidad: los diseños guardados (código SL1) siguen cargando; los de la sólida no cambian y un difusor ya incompatible se corrige con un clic", () => {
  // sólida de siempre: ida y vuelta idéntica
  for (const kind of ["cylinder", "flat", "drop", "wavy"]) {
    const d = CAPS.applyDiffuserKind(DEFAULT_LAMP, kind);
    const back = decodeLampDesign(encodeLampDesign(d));
    assert.deepEqual(back.def, d, `sólida/${kind}`);
  }
  assert.deepEqual(normalizeLampDefinition({}), DEFAULT_LAMP);
  // una calada y una doble pared guardadas antes (con difusor de otra forma) cargan; el motor las marca y se corrigen sin perder el resto
  const oldOpenwork = JSON.parse(JSON.stringify(applyInsertStyle(OPENWORK, "drop")));
  const loaded = decodeLampDesign(encodeLampDesign(oldOpenwork));
  assert.ok(!("error" in loaded), "el código se lee");
  assert.deepEqual(loaded.def.insert, oldOpenwork.insert, "la carga no modifica nada en silencio");
  assert.deepEqual(codes(loaded.def), ["DIFFUSER_NOT_COMPATIBLE"]);
  const fixed = S.applyFix(loaded.def, { id: "useCylinder", label: "" });
  assert.deepEqual(codes(fixed), []);
  assert.deepEqual(fixed.openwork, oldOpenwork.openwork, "la calada conserva todos sus parámetros");
  assert.equal(fixed.insert.previewColor, oldOpenwork.insert.previewColor);
  const oldDouble = JSON.parse(JSON.stringify({ ...DOUBLE, insert: { ...applyInsertStyle(DOUBLE, "flat").insert, enabled: true } }));
  assert.deepEqual(codes(normalizeLampDefinition(oldDouble)), ["DIFFUSER_NOT_COMPATIBLE"]);
  // una doble pared guardada con difusor cilíndrico activado sigue siendo válida (el difusor es opcional)
  assert.deepEqual(codes({ ...DOUBLE, insert: { ...DOUBLE.insert, enabled: true } }), []);
  // diseños anteriores a la V6 (sin los campos nuevos de la calada) siguen leyéndose
  const legacy = JSON.parse(JSON.stringify(OPENWORK));
  delete legacy.openwork.diffuserFit;
  delete legacy.openwork.diffuserDiameterMm;
  assert.equal(normalizeLampDefinition(legacy).openwork.diffuserFit, "rings");
  assert.ok(DEFAULT_OPENWORK.diffuserDiameterMm > 0);
});

// ================================================================== 10 — CABLEADO
test("cableado: la interfaz usa las capacidades y el resumen; no quedan avisos largos por sección ni la definición duplicada", () => {
  const controls = ["LampPropertiesPanel", "LampLibraryPanel"].map((f) => fs.readFileSync(`src/components/maker/lamps/${f}.tsx`, "utf8")).join("\n");
  assert.ok(controls.includes("editorIssueSummary") && controls.includes("familyCaps") && controls.includes("LampStatus") && controls.includes("LampFamilyPicker"));
  assert.ok(!controls.includes("issuesFor"), "los avisos ya no se vuelcan sección por sección");
  assert.ok(!/\bshownWarnings\b/.test(controls) && !controls.includes("Diseño no listo para exportar"), "no queda el bloque largo de errores");
  const constraints = fs.readFileSync("src/lib/maker/lamps/constraints.ts", "utf8");
  assert.ok(constraints.includes("capabilities") && !/main: true/.test(constraints), "«principal» lo decide la familia, no cada control");
  const validate = fs.readFileSync("src/lib/maker/lamps/validation/validateLamp.ts", "utf8");
  assert.ok(validate.includes("diffuserCompatible"), "la validación consulta las mismas capacidades");
  const page = fs.readFileSync("src/components/maker/lamps/LampEditor.tsx", "utf8");
  assert.ok(page.includes("onSelectFamily={handleFamily}") && page.includes("onRestoreLast"));
  // «principal» y «avanzado» no se contradicen entre UI y rangos: lo que la UI marca principal tiene rango eager
  const hook = fs.readFileSync("src/hooks/maker/useLampConstraints.ts", "utf8");
  assert.ok(hook.includes("s.main"));
});
