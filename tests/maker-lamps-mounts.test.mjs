import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";
import { bbox, fitAxis, loadStlBinary, measureThread, trianglesFromIndexed, vertexRadii } from "../scripts/lib/stl-measure.mjs";
import { loadTs } from "./helpers/load-ts.mjs";
import { planeCrossings } from "./helpers/lamp-slice.mjs";

// Lámparas — sistemas de fijación del portalámparas E27 (A presión, rosca hembra A, rosca hembra B con patas) y encastre inferior
// ESTÁNDAR del difusor. Las cotas vienen de las mallas de references/lamp-e27 (BASE v2, BASE2, patas V6, diffuser) y acá se comprueba
// (1) que las constantes de references.ts siguen siendo las de esos STL (si están en el equipo) y (2) que la MALLA GENERADA por el motor real
// —la misma que ve el visor y exporta el STL— se mide igual. Son pruebas GEOMÉTRICAS: no reemplazan probar los ajustes impresos.

const { DEFAULT_LAMP, applyInsertStyle, normalizeLampDefinition } = loadMakerModule("lib/maker/lamps/defaults.ts");
const { createLamp } = loadMakerModule("lib/maker/lamps/createLamp.ts");
const { validateLamp } = loadMakerModule("lib/maker/lamps/validation/validateLamp.ts");
const { applyShadeType } = loadMakerModule("lib/maker/lamps/openwork/presets.ts");
const { REFERENCE_DIFFUSER, REFERENCE_PRESS, REFERENCE_THREAD_BASE2, REFERENCE_THREAD_V6, REFERENCE_V6_PLATE } = loadMakerModule("lib/maker/lamps/holder/references.ts");
const { MOUNT_LABELS } = loadMakerModule("lib/maker/lamps/holder/mounts.ts");
const { applyHolderMount } = loadMakerModule("lib/maker/lamps/holder/applyMount.ts");
const { createLampTestPieces } = loadMakerModule("lib/maker/lamps/parts/createTestPieces.ts");
const { lampPartEntries, buildLampZipBlob } = loadMakerModule("lib/maker/lamps/exporters/lampFiles.ts");
const { analyzeMesh, indexedBounds } = loadMakerModule("lib/maker/mugs/geometry/mesh.ts");
const { encodeLampDesign, decodeLampDesign } = loadMakerModule("lib/maker/lamps/designCode.ts");
const { lampReadmeText, lampTestReadmeText } = loadMakerModule("lib/maker/lamps/safety.ts");

const MOUNTS = ["rings", "press", "threadBase2", "threadV6"];
const REF_DIR = path.join(process.cwd(), "references", "lamp-e27");
const hasRefs = ["BASE v2.stl", "BASE2.stl", "patas V6.stl", "diffuser.stl"].every((n) => fs.existsSync(path.join(REF_DIR, n)));
const skipNoRefs = !hasRefs && "references/lamp-e27 no tiene los cuatro STL en este equipo";

/** El plato Ø78,82 del sistema con patas deja 3,0 mm libres: el reborde de adhesión por defecto (3 mm) se lleva a lo que cabe (applyHolderMount, informado). */
const withMount = (mount, base = DEFAULT_LAMP) => applyHolderMount(base, mount).def;
const build = (def) => {
  const r = createLamp(def);
  assert.equal(r.errors.length, 0, `errores: ${JSON.stringify(r.errors.map((e) => e.code + " " + e.message))}`);
  return r;
};
const clean = (mesh, label) => {
  const a = analyzeMesh(mesh);
  assert.equal(a.boundaryEdges + a.nonManifoldEdges + a.inconsistentEdges + a.degenerate + a.nonFinite, 0, `${label}: malla cerrada y manifold`);
  assert.ok(a.volume > 0, `${label}: volumen positivo`);
};
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b} (tolerancia ${tol})`);

// ================================================================================================ 1. LAS CONSTANTES SALEN DE LOS STL
test("references.ts coincide con las mallas de references/lamp-e27 (diffuser, BASE v2, BASE2, patas V6)", { skip: skipNoRefs }, () => {
  // diffuser.stl: tubo recto, Ø exterior de diseño = radio de los vértices
  {
    const T = loadStlBinary(path.join(REF_DIR, "diffuser.stl"));
    const b = bbox(T);
    const ax = fitAxis(T, b.min[2] + b.size[2] / 2, 1);
    const vo = vertexRadii(T, ax.cx, ax.cy, { rLo: 32, rHi: 33, zLo: 0, zHi: 131 });
    const vi = vertexRadii(T, ax.cx, ax.cy, { rLo: 31, rHi: 32.2, zLo: 0, zHi: 131 });
    near(2 * vo.max, REFERENCE_DIFFUSER.outerDiameterMm, 0.005, "Ø exterior del difusor");
    near(2 * vi.max, REFERENCE_DIFFUSER.innerDiameterMm, 0.005, "Ø interior del difusor");
    near(b.size[2], REFERENCE_DIFFUSER.heightMm, 0.005, "alto del difusor");
  }
  // BASE v2.stl: agujero liso Ø40 y orificio del cable Ø7
  {
    const T = loadStlBinary(path.join(REF_DIR, "BASE v2.stl"));
    const ax = fitAxis(T, 30, 0);
    const vb = vertexRadii(T, ax.cx, ax.cy, { rLo: 19.5, rHi: 20.5, zLo: 20, zHi: 60 });
    const vc = vertexRadii(T, ax.cx, ax.cy, { rLo: 3, rHi: 4, zLo: 11, zHi: 15 });
    near(2 * vb.min, REFERENCE_PRESS.boreDiameterMm, 0.005, "Ø del agujero a presión");
    near(2 * vc.median, REFERENCE_PRESS.cableHoleDiameterMm, 0.005, "Ø del orificio del cable");
  }
  // BASE2.stl y patas V6.stl: raíz y cresta por vértices; paso, vueltas y sentido por ajuste de ápices
  for (const [file, ref, fit, win] of [
    ["BASE2.stl", REFERENCE_THREAD_BASE2, { z: 40, start: null }, null],
    ["patas V6.stl", REFERENCE_THREAD_V6, { z: 10, start: [905.9, 115.9] }, null],
  ]) {
    void win;
    const T = loadStlBinary(path.join(REF_DIR, file));
    const b = bbox(T);
    const ax = fitAxis(T, fit.z, 0, fit.start ?? undefined);
    const base2 = file === "BASE2.stl";
    const m = measureThread(T, { cx: ax.cx, cy: ax.cy, zLo: base2 ? 29 : 0.05, zHi: base2 ? 39.5 : 9, rootR: ax.R });
    const vr = base2 ? vertexRadii(T, ax.cx, ax.cy, { rLo: 20, rHi: 20.6, zLo: b.max[2] - 0.1, zHi: b.max[2] }) : vertexRadii(T, ax.cx, ax.cy, { rLo: 20, rHi: 20.6, zLo: 14.9, zHi: 15.1 });
    near(2 * vr.median, ref.rootDiameterMm, 0.005, `${file}: raíz`);
    near(m.pitch, ref.pitchMm, 0.05, `${file}: paso`);
    assert.equal(m.rightHanded, true, `${file}: rosca a derechas`);
    near(m.turns, ref.turns, 0.1, `${file}: vueltas`);
  }
});

// ================================================================================================ 2. LA MALLA GENERADA SE MIDE IGUAL
test("A PRESIÓN: el agujero de la base generada mide Ø40,000, el orificio del cable Ø7,000 y hay piso (la base conserva su canal)", () => {
  const def = withMount("press");
  const r = build(def);
  const L = validateLamp(def).layout;
  const tw = L.tower;
  assert.equal(tw.mount, "press");
  assert.equal(tw.hasFloor, true);
  clean(r.indexed.base, "base a presión");
  const T = trianglesFromIndexed(r.indexed.base);
  const bore = vertexRadii(T, 0, 0, { rLo: 19, rHi: 21, zLo: tw.press.seatZ + 1, zHi: tw.topZ - 3 });
  near(2 * bore.min, REFERENCE_PRESS.boreDiameterMm, 0.01, "agujero liso");
  near(2 * bore.max, REFERENCE_PRESS.boreDiameterMm, 0.01, "agujero liso (máx.)");
  const cable = vertexRadii(T, 0, 0, { rLo: 3, rHi: 4, zLo: 3, zHi: tw.press.seatZ - 0.5 });
  near(2 * cable.median, REFERENCE_PRESS.cableHoleDiameterMm, 0.01, "orificio del cable");
  near(tw.press.seatZ, REFERENCE_PRESS.floorTopMm, 0.001, "cara superior del piso");
  // el piso existe: un cruce del semiplano a media altura del piso muestra material entre el orificio del cable y la pared exterior
  const x = planeCrossings(r.indexed.base, tw.press.seatZ - 1.5);
  assert.ok(x.some((v) => v > 3 && v < 4) && x.some((v) => v > 19), `cruces ${JSON.stringify(x.map((v) => +v.toFixed(2)))}`);
  // el borde de entrada redondeado: el radio crece hacia la cara superior (lead-in medido en BASE v2.stl)
  const rIn = (z) => planeCrossings(r.indexed.base, z)[0];
  near(rIn(30), 20, 0.02, "radio a z=30");
  assert.ok(rIn(tw.topZ - 0.1) > rIn(tw.topZ - 3) + REFERENCE_PRESS.leadInRadialMm * 0.5, "entrada redondeada");
});

for (const [mount, ref] of [["threadBase2", REFERENCE_THREAD_BASE2], ["threadV6", REFERENCE_THREAD_V6]]) {
  test(`${MOUNT_LABELS[mount]}: la rosca hembra de la base generada tiene raíz, cresta, paso, sentido, vueltas y ápices de la referencia`, () => {
    const def = withMount(mount);
    const r = build(def);
    const L = validateLamp(def).layout;
    const th = L.tower.thread;
    assert.equal(L.tower.mount, mount);
    clean(r.indexed.base, MOUNT_LABELS[mount]);
    const T = trianglesFromIndexed(r.indexed.base);
    const m = measureThread(T, { cx: 0, cy: 0, zLo: th.ribLoZ - 0.8, zHi: th.faceZ, rootR: th.rootR });
    near(2 * m.rootR, ref.rootDiameterMm, 0.01, "raíz");
    near(2 * m.crestR, ref.crestDiameterMm, 0.03, "cresta");
    near(m.pitch, ref.pitchMm, 0.03, "paso");
    assert.equal(m.rightHanded, true, "a derechas");
    near(m.turns, ref.turns, 0.1, "vueltas");
    near(th.faceZ - m.maxApexZ, ref.nearApexDepthMm, 0.15, "ápice más cercano a la cara");
    near(th.faceZ - m.minApexZ, ref.deepApexDepthMm, 0.2, "ápice más profundo");
    // pendiente de flanco de diseño (la medida sobre la malla escalonada es aproximada)
    near(m.flankSlope, ref.flankSlope, 0.2, "pendiente de flanco");
  });
}

test("ROSCA B CON PATAS: base sin piso ni torre, plato Ø78,82 con tres patas, malla cerrada y manifold", () => {
  const { def, notice } = applyHolderMount(DEFAULT_LAMP, "threadV6");
  assert.ok(notice && /reborde de adhesión/.test(notice), "se informa el ajuste del reborde");
  assert.ok(def.adhesion.widthMm < DEFAULT_LAMP.adhesion.widthMm);
  const r = build(def);
  const L = validateLamp(def).layout;
  const tw = L.tower;
  assert.equal(tw.hasFloor, false);
  assert.ok(tw.tripod && tw.tripod.legs === REFERENCE_V6_PLATE.legs);
  near(2 * tw.tripod.plateR, REFERENCE_V6_PLATE.outerDiameterMm, 0.02, "Ø del plato");
  near(tw.tripod.legWidth, REFERENCE_V6_PLATE.legWidthMm, 0.01, "ancho de pata");
  clean(r.indexed.base, "base con patas");
  // sin piso: bajo el plato, a +X (entre patas) solo está la pared exterior
  const cross = planeCrossings(r.indexed.base, tw.tripod.plateBottomZ - 6);
  assert.ok(cross.every((v) => v > L.fit.thread.boreDiameterMm / 2 - 1), `hay material cerca del eje bajo el plato: ${JSON.stringify(cross.map((v) => +v.toFixed(2)))}`);
  // el plato sí existe sobre las patas
  const plate = planeCrossings(r.indexed.base, tw.tripod.topZ - 1);
  assert.ok(plate.some((v) => Math.abs(v - tw.tripod.plateR) < 0.05), `cruces ${JSON.stringify(plate.map((v) => +v.toFixed(2)))}`);
});

// ================================================================================================ 3. ENCASTRE ESTÁNDAR DEL DIFUSOR
test("difusor: el encastre inferior es el de diffuser.stl (Ø65,135, pared 0,8) en los tres estilos y con cualquier mount; el cuerpo se ensancha a 45° sobre él", () => {
  const styles = ["flat", "drop", "wavy"];
  for (const mount of MOUNTS) {
    for (const s of styles) {
      const def = withMount(mount, applyInsertStyle({ ...DEFAULT_LAMP, insert: { ...DEFAULT_LAMP.insert, diameterMm: 80 } }, s));
      const r = build(def);
      const fit = r.metrics.fit;
      const ins = r.indexed.insert;
      const b = indexedBounds(ins);
      assert.equal(fit.insertFit.outerDiameterMm, 65.14, `${mount}/${s}: encastre informado`);
      const zFit = b.minZ + fit.insertFit.heightMm / 2;
      const x = planeCrossings(ins, zFit);
      near(2 * x.at(-1), REFERENCE_DIFFUSER.outerDiameterMm, 0.02, `${mount}/${s}: Ø exterior del encastre`);
      near(2 * x[0], REFERENCE_DIFFUSER.innerDiameterMm, 0.02, `${mount}/${s}: Ø interior del encastre`);
      // transición de 45°: el radio crece 1 mm por cada mm de altura hasta el cuerpo de Ø80
      const flare = fit.insertFit.flareHeightMm;
      near(flare, (80 - REFERENCE_DIFFUSER.outerDiameterMm) / 2, 0.02, `${mount}/${s}: alto de la transición`);
      const zMid = b.minZ + fit.insertFit.heightMm + flare / 2;
      near(planeCrossings(ins, zMid).at(-1), REFERENCE_DIFFUSER.outerDiameterMm / 2 + flare / 2, 0.05, `${mount}/${s}: pendiente de 45°`);
      if (s !== "wavy") near(planeCrossings(ins, zMid + flare + 10).at(-1), 40, 0.03, `${mount}/${s}: cuerpo`);
      clean(ins, `${mount}/${s}`);
    }
  }
});

test("difusor calado Ø80 con anillos de Ø81 libres: encastre Ø65,135 sin error con la rosca por defecto; la torre no crece con el cuerpo", () => {
  const open = applyShadeType(DEFAULT_LAMP, "openwork");
  const def = { ...open, openwork: { ...open.openwork, diffuserFit: "diameter", diffuserDiameterMm: 80, maxDiameterMm: 150 } };
  const v = validateLamp(def);
  assert.equal(v.errors.length, 0, JSON.stringify(v.errors.map((e) => e.code)));
  const narrow = validateLamp(DEFAULT_LAMP).layout.tower;
  assert.equal(v.layout.tower.towerR, narrow.towerR, "la torre es la misma con un cuerpo de Ø80 que con el estándar");
  assert.equal(v.layout.tower.slot.outerR, narrow.slot.outerR);
  // un cuerpo que no pasa por el cuello roscado se rechaza explícitamente (nada se achica en silencio)
  const tooWide = validateLamp({ ...def, openwork: { ...def.openwork, diffuserDiameterMm: 130 } });
  assert.ok(tooWide.errors.some((e) => e.code === "DIFFUSER_EXCEEDS_BASE"));
  // un difusor más angosto que el encastre estándar se rechaza
  const thin = validateLamp({ ...DEFAULT_LAMP, insert: { ...DEFAULT_LAMP.insert, diameterMm: 60 } });
  assert.ok(thin.errors.some((e) => e.code === "INSERT_NARROWER_THAN_FIT"));
});

test("diseños viejos con Ø65 se leen con el encastre estándar de Ø65,135", () => {
  assert.equal(normalizeLampDefinition({ insert: { diameterMm: 65 } }).insert.diameterMm, 65.135);
  assert.equal(normalizeLampDefinition({ insert: { diameterMm: 70 } }).insert.diameterMm, 70);
  assert.equal(normalizeLampDefinition({}).holder.mount, "rings", "sin dato, el sistema de siempre");
});

// ================================================================================================ 4. MATRIZ, CÓDIGO DEL DISEÑO, PIEZAS DE PRUEBA, ZIP, README
test("matriz: las cuatro fijaciones generan base e inserto válidos con pantalla sólida, calada y de doble pared", () => {
  for (const shadeType of ["solid", "openwork", "double"]) {
    for (const mount of MOUNTS) {
      const def = withMount(mount, shadeType === "solid" ? DEFAULT_LAMP : applyShadeType(DEFAULT_LAMP, shadeType));
      const r = build(def);
      assert.equal(r.metrics.fit.tower.mount, mount, `${shadeType}/${mount}`);
      clean(r.indexed.base, `${shadeType}/${mount}: base`);
      if (r.indexed.insert) clean(r.indexed.insert, `${shadeType}/${mount}: inserto`);
    }
  }
});

test("el sistema de fijación viaja en el código del diseño y la validación rechaza un valor desconocido", () => {
  for (const mount of MOUNTS) {
    const def = { ...DEFAULT_LAMP, holder: { ...DEFAULT_LAMP.holder, mount } };
    const back = decodeLampDesign(encodeLampDesign(def)).def;
    assert.equal(back.holder.mount, mount);
    assert.equal(back.holder.pressDepthMm, def.holder.pressDepthMm);
  }
  const bogus = validateLamp({ ...DEFAULT_LAMP, holder: { ...DEFAULT_LAMP.holder, mount: "pegamento" } });
  assert.ok(bogus.errors.some((e) => e.field === "holder.mount"));
  // la profundidad del alojamiento a presión es una cota editable con límites
  const deep = validateLamp({ ...DEFAULT_LAMP, holder: { ...DEFAULT_LAMP.holder, mount: "press", pressDepthMm: 200 } });
  assert.ok(deep.errors.some((e) => e.field === "holder.pressDepthMm"));
});

test("piezas de prueba y LÉEME acompañan al sistema elegido", async () => {
  for (const mount of MOUNTS) {
    const def = withMount(mount);
    const L = validateLamp(def).layout;
    const tp = createLampTestPieces(L);
    assert.ok(tp.holderFit && tp.holderFit.positions.length > 0, `${mount}: pieza de prueba del portalámparas`);
    const readme = lampReadmeText({ holderMeasured: false, partNames: ["base"], mount });
    const test = lampTestReadmeText({ threadDiameterMm: 96, pitchMm: 4, starts: 1, clearanceMm: 0.3, holderMeasured: false, mount });
    const key = { rings: /bottom\.stl/, press: /BASE v2\.stl/, threadBase2: /BASE2\.stl/, threadV6: /patas V6\.stl/ }[mount];
    const testKey = { rings: /rebaje de los anillos/, press: /Ø40,00/, threadBase2: /BASE2\.stl/, threadV6: /patas V6\.stl/ }[mount];
    assert.match(readme, key, `${mount}: LÉEME de la lámpara`);
    assert.match(test, testKey, `${mount}: LÉEME de las pruebas`);
  }
  const press = build(withMount("press"));
  const zip = await buildLampZipBlob(press, withMount("press"));
  assert.ok(zip.size > 1000);
  assert.ok(lampPartEntries(press).some((e) => /base/.test(e.fileName)));
});

// ================================================================================================ 5. LA INTERFAZ REAL
test("UI: el selector de fijación ofrece los cuatro sistemas, marca el elegido y muestra los datos de cada uno", () => {
  const { MakerLampControls, LampExportButtons } = loadTs("src/components/maker/MakerLampControls.tsx", { "next/link": { __esModule: true, default: (props) => createElement("a", props) }, "opentype.js": {} });
  const render = (def) => {
    const r = createLamp(def);
    return renderToStaticMarkup(
      createElement(MakerLampControls, {
        def, onChange() {}, onApplyPreset() {}, onGenerateVariation() {}, onLoadDesign() {}, onError() {},
        errors: r.errors, warnings: r.warnings, metrics: r.metrics,
        exportButtons: createElement(LampExportButtons, { hasInsert: true, insertStyle: def.insert.style, hasCollar: false, canDownload: true, canDownloadTests: true, busy: null, onDownloadPart() {}, onDownloadZip() {}, onDownloadTests() {}, holderMeasured: false }),
      }),
    );
  };
  for (const mount of MOUNTS) {
    const html = render(withMount(mount));
    assert.ok(html.includes("Fijación del portalámparas E27"), `${mount}: falta el selector`);
    for (const m of MOUNTS) assert.ok(html.includes(`data-mount="${m}"`) && html.includes(MOUNT_LABELS[m]), `${mount}: tarjeta ${m}`);
    const checked = html.match(/aria-checked="true"[^>]*data-mount="(\w+)"/g) ?? [];
    assert.equal(checked.length, 1, `${mount}: exactamente una tarjeta marcada`);
    assert.ok(checked[0].includes(`data-mount="${mount}"`), `${mount}: la marcada es la elegida`);
    assert.ok(html.includes("Encastre inferior estándar"), `${mount}: informe del encastre estándar`);
  }
  assert.ok(render(withMount("press")).includes("Prof. del agujero a presión"));
  assert.ok(render(withMount("threadV6")).includes("SIN piso"));
});

test("applyHolderMount: cambia solo el sistema (y el reborde cuando el plato no lo aloja) y devuelve una definición nueva", () => {
  for (const mount of ["rings", "press", "threadBase2"]) {
    const { def, notice } = applyHolderMount(DEFAULT_LAMP, mount);
    assert.equal(notice, null);
    assert.deepEqual({ ...def, holder: DEFAULT_LAMP.holder }, DEFAULT_LAMP);
    assert.equal(def.holder.mount, mount);
  }
  assert.equal(DEFAULT_LAMP.holder.mount, "rings", "la definición original no se muta");
});
