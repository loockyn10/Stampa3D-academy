import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";
import { loadTs } from "./helpers/load-ts.mjs";
import { loadLampUi } from "./helpers/lamp-editor-ui.mjs";

// EDITOR VISUAL DE LÁMPARAS: composición (barra superior, biblioteca, visor, propiedades, barra inferior), controles por familia, compatibilidad de
// estilos y difusores, mensajes breves, diseños guardados y móvil. Los componentes son los REALES, renderizados a HTML estático; la geometría, la del motor.

const D = loadMakerModule("lib/maker/lamps/defaults.ts");
const E = loadMakerModule("lib/maker/lamps/editor.ts");
const S = loadMakerModule("lib/maker/lamps/standard.ts");
const CAPS = loadMakerModule("lib/maker/lamps/capabilities.ts");
const SAVED = loadMakerModule("lib/maker/lamps/savedDesigns.ts");
const { createLamp } = loadMakerModule("lib/maker/lamps/createLamp.ts");
const { validateLamp } = loadMakerModule("lib/maker/lamps/validation/validateLamp.ts");
const { switchFamily } = loadMakerModule("lib/maker/lamps/openwork/presets.ts");
const { availableLampPresets, availableOpenworkPresets } = loadMakerModule("lib/maker/lamps/availability.ts");
const { OPENWORK_PRESETS } = loadMakerModule("lib/maker/lamps/openwork/presets.ts");
const { doubleWallSilhouette } = loadMakerModule("lib/maker/lamps/doublewall/silhouette.ts");
const { encodeLampDesign, decodeLampDesign } = loadMakerModule("lib/maker/lamps/designCode.ts");
const { applyHolderMount } = loadMakerModule("lib/maker/lamps/holder/applyMount.ts");
const { LAMP_SAFETY_NOTICES } = loadMakerModule("lib/maker/lamps/safety.ts");

const SOLID = E.newLampDesign();
const OPENWORK = switchFamily(SOLID, "openwork").def;
const DOUBLE = switchFamily(SOLID, "double").def;
const { LampPropertiesPanel, LampLibraryPanel, MakerLampControls } = loadLampUi();
const noop = () => {};

const resultCache = new Map();
const lampResult = (def) => {
  const key = JSON.stringify(def);
  if (!resultCache.has(key)) resultCache.set(key, createLamp(def));
  return resultCache.get(key);
};
/** Panel de propiedades de UN componente (lo que el panel derecho muestra al seleccionarlo). */
const props = (def, component, extra = {}) => {
  const r = lampResult(def);
  return renderToStaticMarkup(createElement(LampPropertiesPanel, { component, def, onChange: noop, errors: extra.errors ?? r.errors, warnings: extra.warnings ?? r.warnings, metrics: r.metrics, onApplyStandardMechanics: noop, ...extra }));
};
const library = (def) => renderToStaticMarkup(createElement(LampLibraryPanel, { def, onChange: noop, onSelectFamily: noop, onApplyPreset: noop, onGenerateVariation: noop }));
/** Lo que hay antes de «Más ajustes» (siempre visible) y dentro de ese plegable. */
const split = (html) => {
  const i = html.indexOf('data-section="shade-more"');
  assert.ok(i > 0, "falta «Más ajustes»");
  return { main: html.slice(0, i), more: html.slice(i) };
};
const ranges = (html) => (html.match(/type="range"/g) ?? []).length;
const controls = (html) => [...html.matchAll(/data-control="([^"]+)"/g)].map((m) => m[1]);

// ================================================================================================ CONTROLES POR FAMILIA
test("controles principales: como máximo tres por familia, los que pide el sprint, y lo demás plegado en «Más ajustes»", () => {
  for (const type of ["solid", "openwork", "double"]) assert.ok(E.EDITOR_MAIN_CONTROLS[type].length <= 3, `${type}: máximo tres`);
  assert.deepEqual([...E.EDITOR_MAIN_CONTROLS.solid], ["shade.heightMm", "shade.bottomDiameterMm", "shade.amplitudeMm"]); // altura, diámetro, intensidad
  assert.deepEqual([...E.EDITOR_MAIN_CONTROLS.openwork], ["shade.heightMm", "picker:silhouette", "openwork.density"]); // altura, forma exterior, densidad
  assert.deepEqual([...E.EDITOR_MAIN_CONTROLS.double], ["picker:outerShape", "picker:innerShape", "doubleWall.minGapMm"]); // forma exterior, interior, separación

  const solid = split(props(SOLID, "shade"));
  assert.deepEqual(controls(solid.main), ["shade.heightMm", "shade.bottomDiameterMm", "shade.amplitudeMm"]);
  assert.equal(ranges(solid.main), 3);
  assert.ok(solid.more.includes("Cantidad de ondas") && solid.more.includes("Torsión") && solid.more.includes("Perfil"));

  const ow = split(props(OPENWORK, "shade"));
  assert.deepEqual(controls(ow.main), ["shade.heightMm", "openwork.divisions"]); // + la forma exterior (selector)
  assert.ok(ow.main.includes("Forma exterior") && ow.main.includes("Cilíndrica") && ow.main.includes("Abombada"));
  assert.ok(ow.main.includes("Densidad del patrón"));
  assert.ok(ow.more.includes("Inclinación de las diagonales") && ow.more.includes("Profundidad de las tiras"));
  const spiral = split(props({ ...OPENWORK, openwork: { ...OPENWORK.openwork, pattern: "spiral", bands: 6, turns: 0.4, stripWidthMm: 6 } }, "shade"));
  assert.deepEqual(controls(spiral.main), ["shade.heightMm", "openwork.bands"]);

  const dw = split(props(DOUBLE, "shade"));
  assert.deepEqual(controls(dw.main), ["doubleWall.minGapMm"]); // + forma exterior y forma interior (selectores)
  assert.ok(dw.main.includes("Forma exterior") && dw.main.includes("Forma interior") && dw.main.includes("Separación entre paredes"));
  assert.ok(!dw.main.includes("Altura") && !dw.main.includes("Diámetro máximo"), "la altura y el diámetro máximo pasan a «Más ajustes»");
  assert.ok(dw.more.includes("Altura") && dw.more.includes("Diámetro máximo") && dw.more.includes("Cámara de aire"));
});

test("controles incompatibles ocultos: cada familia solo muestra los suyos", () => {
  const all = (def) => ["shade", "diffuser", "base"].map((c) => props(def, c)).join("") + library(def);
  const solid = all(SOLID), ow = all(OPENWORK), dw = all(DOUBLE);
  assert.ok(!/openwork\.|doubleWall\./.test(controls(solid).join(" ")) && !solid.includes("rombos alrededor") && !solid.includes("Separación entre paredes"));
  assert.ok(!/doubleWall\./.test(controls(ow).join(" ")) && !ow.includes("Familia de patrón") && !ow.includes("Cantidad de ondas") && !ow.includes("Separación entre paredes"));
  assert.ok(!/openwork\./.test(controls(dw).join(" ")) && !dw.includes("Familia de patrón") && !dw.includes("rombos alrededor") && !dw.includes("Forma del difusor"));
  // el difusor de la calada es solo el cilíndrico (sin galería ni controles decorativos); el de la doble pared es opcional y también cilíndrico
  for (const [name, html] of [["calada", props(OPENWORK, "diffuser")], ["doble pared", props(DOUBLE, "diffuser")]]) {
    assert.ok(!html.includes("data-diffuser") && !html.includes("Estilo del difusor"), `${name}: sin galería de estilos`);
    for (const t of ["Mossglow", "Gota", "Ondulado", "Tulipán", "Campana", "Reloj de arena", "Altura del cierre", "Amplitud"]) assert.ok(!html.includes(t), `${name}: no ofrece «${t}»`);
  }
  assert.ok(props(OPENWORK, "diffuser").includes("Usar difusor") && props(OPENWORK, "diffuser").includes("se ajusta") === false);
  // la única medida del difusor de la calada es su diámetro (el motor resuelve la abertura libre de los anillos: Ø difusor + holgura)
  const owDiffuser = props(OPENWORK, "diffuser");
  assert.deepEqual(controls(owDiffuser).filter((p) => p.startsWith("openwork.") || p.startsWith("insert.")), ["openwork.diffuserDiameterMm"]);
  assert.ok(owDiffuser.includes("Diámetro del difusor") && owDiffuser.includes("abertura libre de Ø71"));
  assert.ok(props(DOUBLE, "diffuser").includes("Agregar un difusor (opcional)"));
  assert.ok(!props(DOUBLE, "diffuser").includes("Color de la vista previa"), "doble pared sin difusor: sin color");
  assert.ok(props({ ...DOUBLE, insert: { ...DOUBLE.insert, enabled: true } }, "diffuser").includes("Color de la vista previa"));
});

test("la mecánica no es editable: ningún control ni etiqueta de portalámparas, rosca, tolerancias, encastre o canal del difusor", () => {
  const forbiddenPaths = /^(thread|holder|cable|adhesion|base)\.|insert\.(thicknessMm|clearanceMm|seatDepthMm|minBulbGapMm|diameterMm|heightPct|capThicknessMm)|openwork\.diffuser(Clearance|TopGap|Fit)|bulb\./;
  const forbiddenLabels = ["Fijación del portalámparas", "Doble anillo", "A presión", "Rosca hembra", "Ø agujero central", "Ø anillos", "Holgura del rebaje", "Prof. del rebaje", "Altura del apoyo", "Ø cuerpo s/ base", "Alto portalámparas", "Ø bombilla", "Ø cable", "Ø rosca", "Paso", "Entradas", "Longitud roscada", "Holgura radial", "Espesor del cuello", "Diámetro de montaje", "Profundidad de la ranura", "Holgura en la ranura", "Separación mínima a la bombilla", "Ancho del reborde", "Adhesión interna", "Ranuras para precinto", "Diámetro de la base", "Ø exterior del cuerpo", "Diámetro automático", "Lengüetas", "Collar (modo vaso)", "Rosca en la pantalla", "Estas medidas son de mi portalámparas"];
  const designs = [SOLID, ...["mossglow", "tulip", "hourglass", "bell", "drop", "flat", "wavy"].map((k) => CAPS.applyDiffuserKind(SOLID, k)), OPENWORK, DOUBLE, { ...DOUBLE, insert: { ...DOUBLE.insert, enabled: true } }];
  for (const def of designs) {
    const html = ["shade", "diffuser", "base"].map((c) => props(def, c)).join("") + library(def);
    for (const p of controls(html)) assert.ok(!forbiddenPaths.test(p), `${def.shadeType}/${def.insert.style}: control mecánico visible ${p}`);
    // se abren todos los plegables: nada mecánico dentro de «Más ajustes» ni de la biblioteca
    const editable = html.replace(/<details[^>]*data-section="technical"[\s\S]*?<\/details>\s*<\/div>/, "");
    // lo que el usuario ve como etiqueta, botón o encabezado (los párrafos de aviso del motor no son controles)
    const labelTexts = [...editable.matchAll(/<(label|summary|button|h3)[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => m[2].replace(/<[^>]+>/g, " ")).join(" | ");
    for (const t of forbiddenLabels) assert.ok(!labelTexts.includes(t), `${def.shadeType}/${def.insert.style}: aparece «${t}»`);
  }
  // los campos escritos (NumberField) tampoco son mecánicos
  assert.ok(!/<input[^>]*(thread|holder)/.test(props(SOLID, "base")));
});

test("la base muestra el estándar bloqueado; un diseño anterior se avisa y solo pasa al estándar a pedido", () => {
  const std = props(SOLID, "base");
  assert.ok(std.includes("data-base-locked") && std.includes("Base E27 estándar") && std.includes("Cilíndrica"));
  assert.ok(!std.includes("data-legacy-mechanics"), "el estándar no avisa nada");
  assert.ok(!/type="range"|type="number"|type="text"/.test(std.slice(0, std.indexOf("Detalles técnicos"))), "la base no tiene controles editables");
  const legacy = props(applyHolderMount(SOLID, "press").def, "base");
  assert.ok(legacy.includes("data-legacy-mechanics") && legacy.includes("Usar las medidas estándar") && legacy.includes("fijación del portalámparas"));
  assert.ok(legacy.includes("no se cambian sin tu permiso"));
});

// ================================================================================================ BIBLIOTECA
test("biblioteca: familias y estilos de la familia activa, con miniaturas; sin controles numéricos ni mecánicos", () => {
  for (const [def, count] of [[SOLID, 9], [OPENWORK, 5], [DOUBLE, 4]]) {
    const html = library(def);
    for (const l of ["Sólida", "Calada", "Doble pared", "Tipo de lámpara", "Estilos"]) assert.ok(html.includes(l), `${def.shadeType}: falta «${l}»`);
    assert.equal((html.match(/data-style="/g) ?? []).length >= count - 1, true, `${def.shadeType}: estilos ofrecidos`);
    assert.equal((html.match(/data-family="/g) ?? []).length, 3);
    assert.ok(!/<input/.test(html), "la biblioteca no tiene campos");
    assert.ok(!/<(svg|canvas)/.test(html) === false, "miniaturas");
  }
  assert.ok(library(SOLID).includes("Generar variación") && !library(OPENWORK).includes("Generar variación"));
  assert.ok(library(SOLID).includes("Ondas suaves") && library(OPENWORK).includes("Diamante clásico") && library(DOUBLE).includes("Clásica"));
  // los de la doble pared se dibujan con las superficies reales de ambas paredes
  const sil = doubleWallSilhouette(DOUBLE, 64);
  assert.match(sil.outer, /^M[\d.,L-]+Z$/);
  assert.match(sil.inner, /^M[\d.,L-]+Z$/);
  assert.notEqual(sil.outer, sil.inner);
});

test("presets: cada estilo ofrecido parte de una geometría válida (nada roto) y no cambia la mecánica", () => {
  const solid = availableLampPresets(SOLID);
  assert.equal(solid.hidden.length, 0, JSON.stringify(solid.hidden));
  for (const p of solid.available) assert.deepEqual(validateLamp(loadMakerModule("lib/maker/lamps/presets.ts").applyLampPreset(SOLID, p)).errors, [], p.id);
  const ow = availableOpenworkPresets(OPENWORK, OPENWORK_PRESETS);
  assert.ok(ow.available.length >= 4);
  for (const p of ow.available) {
    const next = loadMakerModule("lib/maker/lamps/openwork/presets.ts").applyOpenworkPreset(OPENWORK, p);
    assert.deepEqual(validateLamp(next).errors, [], p.id);
    assert.deepEqual(S.mechanicalSnapshot(next), S.mechanicalSnapshot(SOLID), p.id);
  }
  const dw = E.availableDoubleStyles(DOUBLE);
  assert.ok(dw.available.length >= 3);
  for (const s of dw.available) assert.deepEqual(validateLamp(E.applyDoubleStyle(DOUBLE, s), undefined, { fast: true }).errors, [], s.id);
  assert.ok(E.doubleStyleMatches(DOUBLE, E.DOUBLE_STYLES.find((s) => s.id === "estriada")), "el estilo inicial queda marcado");
});

// ================================================================================================ DIFUSORES
test("difusores de la sólida: ocho estilos, 1–3 controles por estilo y todos conservan el encastre inferior estándar", () => {
  const html = props(SOLID, "diffuser");
  for (const label of ["Cilíndrico", "Plano", "Gota", "Ondulado", "Mossglow", "Tulipán", "Reloj de arena", "Campana"]) assert.ok(html.includes(label), label);
  assert.equal((html.match(/data-diffuser="/g) ?? []).length, 8);
  for (const kind of CAPS.familyCaps("solid").diffuser.allowed) {
    const def = CAPS.applyDiffuserKind(SOLID, kind);
    const c = E.DIFFUSER_CONTROLS[kind];
    assert.ok(c.main.length <= 3, `${kind}: como mucho tres controles principales`);
    const h = props(def, "diffuser");
    const main = h.slice(0, h.indexOf('data-section="diffuser-more"') > 0 ? h.indexOf('data-section="diffuser-more"') : h.length);
    const shown = controls(main).filter((p) => p.startsWith("insert."));
    for (const path of c.main.filter((p) => p.startsWith("insert."))) assert.ok(shown.includes(path) || path === "insert.heightMm", `${kind}: falta ${path}`);
    assert.ok(shown.length <= 3, `${kind}: ${shown.length} controles visibles`);
    // el encastre no se ofrece: nada de espesor, holgura ni diámetro del encastre
    assert.ok(!controls(h).some((p) => /thicknessMm|clearanceMm|seatDepthMm|minBulbGapMm|insert\.diameterMm/.test(p)), kind);
    // cada estilo es una definición válida con la bombilla estándar y el mismo encastre (Ø65,135)
    const r = lampResult(def);
    assert.deepEqual(r.errors, [], `${kind}: errores ${JSON.stringify(r.errors.map((e) => e.code))}`);
    assert.ok(Math.abs(r.metrics.fit.insertFit.outerDiameterMm - 65.135) < 0.01, `${kind}: encastre`);
  }
  // sin lengüetas ni selector de collar
  assert.ok(!html.includes("Lengüetas") && !html.includes("Collar"));
});

test("estilos de difusor que no entran con la bombilla del diseño no se ofrecen y se dice cuántos", () => {
  const placeholderBulb = { ...SOLID, bulb: D.DEFAULT_BULB }; // Ø60 × 85: el marcador de posición anterior
  const { available, hidden } = E.availableDiffuserKinds(placeholderBulb);
  assert.ok(hidden.length >= 2 && hidden.every((h) => typeof h.reason === "string" && h.reason.length > 0));
  assert.ok(!available.includes("mossglow") && available.includes("cylinder"));
  const html = props(placeholderBulb, "diffuser");
  assert.ok(/no disponibles? con estas medidas/.test(html));
  assert.equal((html.match(/data-diffuser="/g) ?? []).length, available.length);
});

// ================================================================================================ MENSAJES BREVES
test("errores: una frase corta, sin códigos ni párrafos; el detalle queda plegado; las correcciones mecánicas no se ofrecen", () => {
  const bad = { ...SOLID, shade: { ...SOLID.shade, wallMm: 0.1 } }; // fuera de rango
  const r = validateLamp(bad);
  assert.ok(r.errors.length > 0);
  const summary = E.editorIssueSummary(bad, r.errors, r.warnings);
  assert.ok(summary.primary);
  assert.ok(summary.primary.short.length <= 80 && /\.$/.test(summary.primary.short), summary.primary.short);
  assert.ok(summary.primary.detail.length > summary.primary.short.length, "el detalle técnico existe, aparte");
  const html = props(bad, "shade", { errors: r.errors, warnings: r.warnings });
  assert.equal((html.match(/role="alert"/g) ?? []).length, 1, "un solo bloque de problemas visible");
  assert.ok(html.includes("Ver detalle") && html.includes("No se puede descargar hasta resolverlo"));
  assert.ok(!/[A-Z]{2,}_[A-Z_]{3,}/.test(html.replace(/data-[a-z-]+="[^"]*"/g, "").replace(/<(svg|path)[\s\S]*?>/g, "")), "ningún código interno de error en pantalla");
  // la frase es la del motor resumida: «El difusor no entra.» para un difusor que no pasa
  const wide = { ...SOLID, insert: { ...SOLID.insert, style: "mossglow", profileWidthMm: 110 } };
  const wr = validateLamp(wide);
  assert.ok(wr.errors.length > 0);
  assert.ok(E.editorIssueSummary(wide, wr.errors, wr.warnings).primary.short.length <= 80);
});

test("avisos térmicos y eléctricos siguen disponibles y el diseño no se presenta como seguro por defecto", () => {
  const html = props(SOLID, "shade");
  assert.ok(html.includes("Detalles técnicos y seguridad") && html.includes("Pendiente de validación física"));
  for (const notice of LAMP_SAFETY_NOTICES) assert.ok(html.includes(notice.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")) || html.includes(notice.slice(0, 40)), `aviso: ${notice.slice(0, 40)}`);
  assert.ok(/temperatura/i.test(html));
  assert.ok(!/seguro para usar|es segur[oa]|eléctricamente segur/i.test(html.replace(/no (es|son|está|están)[^.]*segur[^.]*\./gi, "")));
});

// ================================================================================================ DISEÑOS GUARDADOS
test("diseños guardados: se guardan por nombre en el navegador, se leen tolerando datos dañados y no pasan de 30", () => {
  assert.equal(SAVED.cleanLampName("   "), SAVED.DEFAULT_LAMP_NAME);
  assert.equal(SAVED.cleanLampName("  Mi   lámpara  linda "), "Mi lámpara linda");
  assert.equal(SAVED.cleanLampName("x".repeat(200)).length, 60);
  let list = [];
  const code = encodeLampDesign(SOLID);
  list = SAVED.upsertSavedLampDesign(list, { id: "a", name: "Uno", code, now: 1 });
  list = SAVED.upsertSavedLampDesign(list, { id: "b", name: "Dos", code, now: 2 });
  list = SAVED.upsertSavedLampDesign(list, { id: "a", name: "Uno (v2)", code, now: 3 });
  assert.deepEqual(list.map((x) => x.name), ["Uno (v2)", "Dos"], "reemplaza por id y el más reciente primero");
  assert.deepEqual(SAVED.removeSavedLampDesign(list, "a").map((x) => x.id), ["b"]);
  assert.deepEqual(SAVED.parseSavedLampDesigns(JSON.stringify(list)), list);
  for (const bad of [null, "", "no es json", "{}", "[1,2]", JSON.stringify([{ id: 1 }])]) assert.deepEqual(SAVED.parseSavedLampDesigns(bad), []);
  for (let i = 0; i < 50; i++) list = SAVED.upsertSavedLampDesign(list, { id: `x${i}`, name: `N${i}`, code, now: 10 + i });
  assert.equal(list.length, SAVED.MAX_SAVED_LAMPS);
  // lo guardado es el código del diseño: reabrir devuelve exactamente la misma definición, mecánica incluida
  const decoded = decodeLampDesign(list[0].code);
  assert.deepEqual(decoded.def, SOLID);
  const legacy = applyHolderMount(SOLID, "threadV6").def;
  assert.deepEqual(decodeLampDesign(encodeLampDesign(legacy)).def.holder, legacy.holder);
});

// ================================================================================================ EL EDITOR COMPLETO
const registry = {};
/** Lo que el editor importa del motor y del navegador: el motor real (cargado con el cargador de Node) y ganchos que no dependen del DOM. */
const engine = (rel) => loadMakerModule(rel);
const editorMocks = {
  "@/hooks/maker/useLampGeometry": { useLampGeometry: (def) => ({ result: lampResult(def), pending: false, outdated: false, outdatedReason: null }) },
  "@/hooks/maker/useLampConstraints": { useLampConstraints: () => ({ ranges: {}, stale: new Set(), computing: false }) },
  "@/hooks/maker/useSavedLampDesigns": { useSavedLampDesigns: () => ({ items: [], save: () => "id", remove: noop }) },
  "@/lib/maker/lamps/createLamp": engine("lib/maker/lamps/createLamp.ts"),
  "@/lib/maker/lamps/exporters/lampFiles": engine("lib/maker/lamps/exporters/lampFiles.ts"),
  "@/lib/maker/printBed/bedLayout": engine("lib/maker/printBed/bedLayout.ts"),
  "@/lib/maker/printBed/printerProfiles": engine("lib/maker/printBed/printerProfiles.ts"),
  "next/link": { __esModule: true, default: (p) => createElement("a", p) },
  "opentype.js": {},
  "@/components/maker/MakerViewport": { MakerViewport: (p) => createElement("div", { "data-viewport": "", "data-hidden": (p.hiddenKinds ?? []).join(","), "data-mode": p.displayMode }) },
  "@/components/maker/MakerViewportOverlays": { BedLabel: () => null, BedWarnings: () => null },
  "@/components/ui/app-feedback": { useAppFeedback: () => ({ toast: { success: noop, error: noop, info: noop }, confirmAction: async () => true, promptForValue: async () => null }) },
};
function renderEditor() {
  const { LampEditor } = loadTs("src/components/maker/lamps/LampEditor.tsx", editorMocks);
  return renderToStaticMarkup(createElement(LampEditor));
}

test("editor: barra superior, biblioteca, visor, propiedades y barra inferior; sin el sidebar interminable de antes", () => {
  const html = renderEditor();
  registry.html = html;
  assert.ok(html.includes("data-lamp-editor") && html.includes("data-topbar"));
  for (const l of ["Nombre del diseño", "Nuevo diseño", "Guardar", "Mis diseños", "Exportar"]) assert.ok(html.includes(l), `barra superior: ${l}`);
  assert.ok(html.includes('aria-label="Biblioteca de diseños"') && html.includes('aria-label="Visor 3D"') && html.includes('aria-label="Propiedades"') && html.includes('aria-label="Componentes y vistas"'));
  assert.ok(html.includes("data-viewport"), "visor real");
  // barra inferior: componentes y vistas existentes
  for (const l of ["Pantalla", "Difusor", "Base", "Aislar", "Ensamblada", "Piezas", "Corte", "Cama"]) assert.ok(html.includes(l), `barra inferior: ${l}`);
  // propiedades: solo la pantalla seleccionada y con sus tres controles
  assert.equal((html.match(/data-panel="properties"/g) ?? []).length, 1);
  assert.ok(html.includes('data-component="shade"') && html.includes('data-family="solid"'));
  assert.deepEqual(controls(html.slice(html.indexOf('data-panel="properties"'))).slice(0, 3), ["shade.heightMm", "shade.bottomDiameterMm", "shade.amplitudeMm"]);
  // el panel de la izquierda es compacto y el de la derecha no se extiende: anchos fijos; el visor ocupa el resto
  assert.ok(html.includes("lg:w-[248px]") && html.includes("lg:w-[320px]") && html.includes("lg:flex-1"));
  assert.ok(!html.includes("lg:w-[380px]"), "ya no hay un sidebar de 380 px con todo adentro");
  // las secciones plegables del viejo sidebar no están
  for (const old of ["Base y fijación E27", "Difusor y color", "Seguridad y pruebas", "Medidas y código del diseño", "Personalización avanzada", "1 · Tipo de lámpara"]) assert.ok(!html.includes(old), `sidebar anterior: ${old}`);
});

test("editor móvil: visor fijo arriba, selector de familia compacto y un solo panel bajo demanda; sin scroll horizontal", () => {
  const html = registry.html ?? renderEditor();
  assert.match(html, /order-1[^"]*max-lg:sticky|max-lg:sticky[^"]*order-1/, "el visor queda arriba y fijo");
  assert.ok(html.includes('role="tablist"') && html.includes('role="tab"') && html.includes("Estilos") && html.includes("Ajustes") && html.includes("Exportar"));
  const tabs = html.slice(html.indexOf('role="tablist" aria-label="Paneles"'));
  const tablist = tabs.slice(0, tabs.indexOf("</div>"));
  assert.equal((tablist.match(/role="tab"/g) ?? []).length, 3, "tres pestañas: estilos, ajustes, exportar");
  assert.equal((tablist.match(/aria-selected="true"/g) ?? []).length, 1, "un solo panel abierto");
  assert.ok(html.includes("max-lg:hidden"), "la biblioteca (y lo que no está activo) se oculta en móvil");
  assert.equal((html.match(/role="radiogroup" aria-label="Tipo de lámpara"/g) ?? []).length, 2, "selector compacto (móvil) + tarjetas (escritorio)");
  assert.ok(!/overflow-x-(auto|scroll)/.test(html), "sin scroll horizontal");
});

test("editor: el código del editor usa el motor y la mecánica estándar, no vuelve a exponer la mecánica y la página es delgada", () => {
  const page = fs.readFileSync("src/app/stampa-maker/lamparas/page.tsx", "utf8");
  assert.match(page, /<LampEditor \/>/);
  assert.ok(page.split("\n").length < 20);
  assert.ok(!fs.existsSync("src/components/maker/MakerLampControls.tsx"), "el panel anterior ya no existe");
  const editor = fs.readFileSync("src/components/maker/lamps/LampEditor.tsx", "utf8");
  for (const t of ["useLampGeometry", "useLampConstraints", "newLampDesign", "preserveMechanics", "applyStandardMechanics", "confirmAction", "zUp"]) assert.ok(editor.includes(t), t);
  const panel = fs.readFileSync("src/components/maker/lamps/LampPropertiesPanel.tsx", "utf8");
  for (const mech of ["thread.", "holder.", "adhesion.", "cable.", "bulb.", "minBulbGapMm", "seatDepthMm"]) assert.ok(!new RegExp(`path="${mech.replace(".", "\\.")}`).test(panel) && !panel.includes(`setHolder`) && !panel.includes(`setThread`), `el panel no edita ${mech}`);
  // la mecánica no entra en los rangos dinámicos del editor
  const hook = fs.readFileSync("src/hooks/maker/useLampConstraints.ts", "utf8");
  assert.ok(hook.includes("MECHANICAL_PATHS"));
});

test("barra inferior: elegir componente, ocultar, aislar y vistas (ensamblada, piezas, corte, cama) sin parámetros del diseño", () => {
  const { LampBottomBar } = loadTs("src/components/maker/lamps/LampBottomBar.tsx", editorMocks);
  const items = [{ kind: "lampShade", component: "shade", label: "Pantalla" }, { kind: "lampInsert", component: "diffuser", label: "Difusor" }, { kind: "body", component: "base", label: "Base", attention: true }];
  const html = renderToStaticMarkup(createElement(LampBottomBar, { items, selected: "diffuser", onSelect: noop, hidden: ["body"], onToggleVisible: noop, bed: false, onBedChange: noop, exploded: false, onToggleExploded: noop, section: false, onToggleSection: noop, assembled: false, onAssembled: noop, isolated: false, onToggleIsolate: noop, plateCount: 2, plateIndex: 1, onPlateChange: noop }));
  assert.match(html, /aria-pressed="true"[^>]*data-component="diffuser"/);
  assert.ok(html.includes("Mostrar base") && html.includes("Ocultar pantalla") && html.includes("Tiene un aviso"));
  assert.ok(!/type="range"|<input/.test(html), "ningún parámetro del diseño en la barra");
});

test("la vista previa anterior se marca y la exportación está en el menú (no en el visor)", () => {
  const html = registry.html ?? renderEditor();
  assert.ok(!html.includes("Descargar</span>"), "la tarjeta flotante «Descargar» ya no está en el visor");
  const top = fs.readFileSync("src/components/maker/lamps/LampTopBar.tsx", "utf8");
  assert.ok(top.includes("LampExportList") && top.includes("exportBlocker"));
  const editor = fs.readFileSync("src/components/maker/lamps/LampEditor.tsx", "utf8");
  assert.ok(editor.includes("Vista anterior") && editor.includes("canDownload"));
});

test("compatibilidad del compuesto de pruebas: lo que antes era un panel único se renderiza completo para un diseño anterior sin romper", () => {
  const legacy = applyHolderMount(SOLID, "threadBase2").def;
  const r = lampResult(legacy);
  const html = renderToStaticMarkup(createElement(MakerLampControls, { def: legacy, errors: r.errors, warnings: r.warnings, metrics: r.metrics }));
  assert.ok(html.includes("data-legacy-mechanics"));
});
