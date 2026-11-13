import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";
import { planeCrossings } from "./helpers/lamp-slice.mjs";
import { loadLampUi } from "./helpers/lamp-editor-ui.mjs";

// Lámparas V4.1 — parte A: el difusor de las pantallas CALADAS se dimensiona por el diámetro interior LIBRE de los anillos
// (no por el diámetro decorativo máximo). Todo se mide sobre las mallas generadas. Son pruebas GEOMÉTRICAS: la holgura
// diametral es un valor inicial pendiente de validación física y nada acá es una validación térmica.

const { DEFAULT_LAMP, applyInsertStyle, normalizeLampDefinition, DEFAULT_OPENWORK } = loadMakerModule("lib/maker/lamps/defaults.ts");
const { createLamp } = loadMakerModule("lib/maker/lamps/createLamp.ts");
const { validateLamp } = loadMakerModule("lib/maker/lamps/validation/validateLamp.ts");
const { applySilhouette } = loadMakerModule("lib/maker/lamps/openwork/presets.ts");
const { indexedBounds, analyzeMesh } = loadMakerModule("lib/maker/mugs/geometry/mesh.ts");
const { lampPartEntries } = loadMakerModule("lib/maker/lamps/exporters/lampFiles.ts");

// Rosca más ancha (la base admite un difusor mayor) y pantalla con extremos de Ø 112 abajo y arriba (anillos de ≈ Ø 107 libres)
const WIDE = { ...DEFAULT_LAMP, shadeType: "openwork", base: { diameterMm: 140 }, thread: { ...DEFAULT_LAMP.thread, majorDiameterMm: 104 }, shade: { ...DEFAULT_LAMP.shade, bottomDiameterMm: 112, topDiameterMm: 112 }, openwork: { ...DEFAULT_OPENWORK, maxDiameterMm: 150, diffuserFit: "rings" } };
// Anillo superior angosto: topDiameter = 84,8 deja ≈ Ø 80 libres arriba; el inferior sigue ancho (la rosca obliga a ≥ Ø 99)
const EXAMPLE = { ...WIDE, shade: { ...WIDE.shade, topDiameterMm: 84.8 } };
const mk = (def, patch = {}, ins = {}) => ({ ...def, openwork: { ...def.openwork, ...patch }, insert: { ...def.insert, ...ins } });
const fit = (def) => validateLamp(def).layout.fit;
const build = (def) => {
  const r = createLamp(def);
  assert.equal(r.errors.length, 0, `errores: ${JSON.stringify(r.errors.map((e) => e.code + " " + e.message))}`);
  return r;
};
const floor05 = (v) => Math.floor((v + 1e-9) * 20) / 20;

function radiiInZ(mesh, z0, z1) {
  const p = mesh.positions;
  const out = [];
  for (let i = 0; i < p.length; i += 3) if (p[i + 2] >= z0 - 1e-9 && p[i + 2] <= z1 + 1e-9) out.push(Math.hypot(p[i], p[i + 1]));
  return out;
}

test("el difusor calado se dimensiona por el diámetro INTERIOR LIBRE de los anillos, no por el decorativo: ejemplo Ø≈80 libres → Ø≈79 con pantalla de Ø150", () => {
  const r = build(EXAMPLE);
  const f = r.metrics.fit.diffuser;
  assert.equal(f.source, "rings");
  assert.ok(Math.abs(f.ringTopFreeDiameterMm - 80) < 0.3, `anillo superior libre Ø${f.ringTopFreeDiameterMm}`);
  assert.equal(f.limitedBy, "topRing");
  // Ø del difusor = libre − holgura diametral (1 mm por defecto), redondeado hacia abajo a 0,05 mm
  assert.equal(f.diffuserDiameterMm, 2 * floor05(f.ringTopFreeDiameterMm / 2 - 0.5));
  assert.ok(f.diffuserDiameterMm > 78.5 && f.diffuserDiameterMm < 79.2, `difusor Ø${f.diffuserDiameterMm}`);
  // medido sobre las mallas: el difusor mide ese diámetro y la pantalla se expande hasta Ø150
  const ib = indexedBounds(r.indexed.insert);
  const mountZone = radiiInZ(r.indexed.insert, ib.minZ, ib.minZ + 8); // encastre inferior: ESTÁNDAR de diffuser.stl, no depende del cuerpo
  assert.ok(Math.abs(2 * Math.max(...mountZone) - 65.135) < 0.02, `encastre medido Ø${2 * Math.max(...mountZone)}`);
  const body = radiiInZ(r.indexed.insert, ib.minZ, ib.maxZ);
  assert.ok(Math.abs(2 * Math.max(...body) - f.diffuserDiameterMm) < 0.02, `difusor medido Ø${2 * Math.max(...body)}`);
  const sb = indexedBounds(r.indexed.shade);
  assert.ok(sb.maxX - sb.minX > 149.5, `pantalla decorativa Ø${sb.maxX - sb.minX}`);
  // independiente del diámetro decorativo máximo y del patrón
  for (const patch of [{ maxDiameterMm: 130 }, { maxDiameterMm: 170 }, { pattern: "spiral", bands: 6, turns: 0.3, stripWidthMm: 6 }]) {
    assert.equal(fit(mk(EXAMPLE, patch)).diffuser.diffuserDiameterMm, f.diffuserDiameterMm, `cambió con ${JSON.stringify(patch)}`);
  }
  // no se confunde el interior con el exterior: exterior del anillo > libre > difusor
  assert.ok(EXAMPLE.shade.topDiameterMm > f.ringTopFreeDiameterMm + 4 && f.ringTopFreeDiameterMm > f.diffuserDiameterMm);
});

test("el diámetro libre de los anillos se mide sobre la malla de la pantalla (cara interior) y coincide con el del informe", () => {
  const r = build(EXAMPLE);
  const L = validateLamp(EXAMPLE).layout;
  const f = r.metrics.fit.diffuser;
  const top = radiiInZ(r.indexed.shade, L.shadeTopZ - EXAMPLE.openwork.topRingMm, L.shadeTopZ);
  const bottom = radiiInZ(r.indexed.shade, L.decorZ0, L.decorZ0 + EXAMPLE.openwork.bottomRingMm);
  assert.ok(Math.abs(2 * Math.min(...top) - f.ringTopFreeDiameterMm) < 0.02, `malla ${2 * Math.min(...top)} vs informe ${f.ringTopFreeDiameterMm}`);
  assert.ok(Math.abs(2 * Math.min(...bottom) - f.ringBottomFreeDiameterMm) < 0.02);
  // la holgura radial real en cada anillo es libre − difusor
  assert.ok(Math.abs(f.radialClearanceTopMm - (Math.min(...top) - f.diffuserDiameterMm / 2)) < 0.02);
});

test("la holgura diametral es configurable (inicial 1 mm), se refleja 1:1 en el diámetro y no baja de 0,7 mm", () => {
  const base = fit(EXAMPLE).diffuser;
  assert.equal(base.diametralClearanceMm, 1);
  const wide = fit(mk(EXAMPLE, { diffuserClearanceMm: 3 })).diffuser;
  assert.ok(Math.abs(base.diffuserDiameterMm - wide.diffuserDiameterMm - 2) < 0.11, `Ø ${base.diffuserDiameterMm} → ${wide.diffuserDiameterMm}`);
  assert.equal(wide.radialClearanceTopMm - base.radialClearanceTopMm > 0.9, true);
  const tight = createLamp(mk(EXAMPLE, { diffuserClearanceMm: 0.3 }));
  assert.equal(tight.geometry, null);
  assert.ok(tight.errors.some((e) => e.code === "OUT_OF_RANGE" && e.field === "openwork.diffuserClearanceMm"));
  assert.equal(build(mk(EXAMPLE, { diffuserClearanceMm: 0.7 })).errors.length, 0);
});

test("pantalla sólida intacta: el inserto estándar de Ø65,135 y sin informe de difusor calado; el modo manual de la calada usa insert.diameterMm", () => {
  const solid = createLamp(DEFAULT_LAMP);
  assert.equal(solid.errors.length, 0);
  assert.equal(solid.metrics.fit.insertOuterDiameterMm, 65.135);
  assert.equal(solid.metrics.fit.diffuser, null);
  const manual = build({ ...mk(WIDE, { diffuserFit: "manual" }), insert: { ...WIDE.insert, diameterMm: 65.135 } });
  assert.equal(manual.metrics.fit.insertOuterDiameterMm, 65.135);
  assert.equal(manual.metrics.fit.diffuser.source, "manual");
  assert.equal(manual.metrics.fit.diffuser.limitedBy, "manual");
  assert.equal(createLamp({ ...mk(WIDE, { diffuserFit: "manual" }), insert: { ...WIDE.insert, diameterMm: 65.135 } }).warnings.some((w) => w.code === "DIFFUSER_LIMITED_BY_BASE"), false);
});

test("el cuerpo del difusor es cilíndrico aunque la pantalla sea abombada o de reloj de arena (sobre el encastre estándar y su transición de 45°), y ninguna zona de la estructura invade su volumen", () => {
  for (const kind of ["bulge", "hourglass", "organic"]) {
    const def = applySilhouette(EXAMPLE, kind);
    const v = validateLamp(def);
    if (v.errors.length) { assert.ok(v.errors.every((e) => e.code === "DIFFUSER_STRUCTURE_INTRUDES" || /^INSERT_|^SHADE_|^OUT_OF/.test(e.code)), `${kind}: ${v.errors.map((e) => e.code)}`); continue; }
    const r = build(def);
    const f = r.metrics.fit.diffuser;
    // cilíndrico: sobre el encastre (altura de ajuste) y la transición de 45° el radio del difusor es el mismo a toda altura (tubo liso, amplitud 0)
    const ib = indexedBounds(r.indexed.insert);
    const fz = r.metrics.fit.insertFit;
    const bodyFromZ = ib.minZ + fz.heightMm + fz.flareHeightMm + 0.5;
    const radii = [];
    for (let k = 0; k < 6; k++) radii.push(planeCrossings(r.indexed.insert, bodyFromZ + ((ib.maxZ - 3 - bodyFromZ) * k) / 5).at(-1));
    const maxR = Math.max(...radii), minOuter = Math.min(...radii);
    assert.ok(maxR - minOuter < 0.01, `${kind}: el cuerpo del difusor no es cilíndrico (${minOuter}–${maxR})`);
    assert.ok(Math.abs(2 * maxR - f.diffuserDiameterMm) < 0.02, `${kind}: el cuerpo mide Ø${2 * maxR} y el informe dice Ø${f.diffuserDiameterMm}`);
    // ningún vértice de la pantalla dentro del volumen del difusor + holgura de montaje, en todo el alto del difusor
    const L = v.layout.insert;
    const near = Math.min(...radiiInZ(r.indexed.shade, L.z0, L.z1).filter((x) => x > 0));
    assert.ok(near >= f.diffuserDiameterMm / 2 + def.insert.clearanceMm - 1e-6, `${kind}: estructura a ${near} del eje; el difusor llega a ${f.diffuserDiameterMm / 2}`);
  }
});

test("anillos con diámetros interiores distintos: el cilindro rígido se dimensiona por el más angosto, el otro anillo queda con holgura y se avisa", () => {
  const mismatch = { ...EXAMPLE }; // abajo ≈ Ø107 libres, arriba ≈ Ø80
  const f = fit(mismatch).diffuser;
  assert.ok(f.ringBottomFreeDiameterMm - f.ringTopFreeDiameterMm > 10);
  assert.equal(f.limitedBy, "topRing");
  assert.ok(f.radialClearanceBottomMm > f.radialClearanceTopMm + 10, "el anillo inferior no centra el difusor");
  const r = createLamp(mismatch);
  assert.ok(r.warnings.some((w) => w.code === "DIFFUSER_RINGS_MISMATCH" && /no lo centra/.test(w.message)));
  // con anillos iguales no hay aviso de desencuentro
  const equal = createLamp(WIDE);
  assert.equal(equal.warnings.some((w) => w.code === "DIFFUSER_RINGS_MISMATCH"), false);
  assert.ok(Math.abs(fit(WIDE).diffuser.ringBottomFreeDiameterMm - fit(WIDE).diffuser.ringTopFreeDiameterMm) <= 4, "el escalón de 45° de la rosca estrecha el libre inferior unos 2 mm: no es desencuentro");
});

test("la base y la rosca limitan antes que los anillos cuando hace falta: se informa el límite y no se modifica la base", () => {
  const def = { ...DEFAULT_LAMP, shadeType: "openwork", openwork: { ...DEFAULT_OPENWORK, diffuserFit: "rings" } };
  const f = fit(def).diffuser;
  assert.equal(f.limitedBy, "base");
  assert.equal(f.diffuserDiameterMm, 2 * floor05(f.baseLimitDiameterMm / 2));
  assert.ok(f.diffuserDiameterMm < f.ringBottomFreeDiameterMm);
  const r = createLamp(def);
  assert.equal(r.errors.length, 0);
  const w = r.warnings.find((x) => x.code === "DIFFUSER_LIMITED_BY_BASE");
  assert.ok(w && /rosca/.test(w.message) && /no se modifica/.test(w.message));
  // la torre que lo aloja deja el aire mínimo hasta el orificio del cuello (el difusor no obliga a tocar la base)
  const L = validateLamp(def).layout;
  assert.ok(L.spec.boreR - L.tower.towerR >= Math.max(3, def.adhesion.widthMm + 1) - 1e-9, `aire torre–cuello ${L.spec.boreR - L.tower.towerR}`);
  // la rosca más ancha deja pasar un difusor mayor
  assert.ok(fit(WIDE).diffuser.diffuserDiameterMm > f.diffuserDiameterMm + 4);
  // el diámetro de la rosca y el reborde de adhesión no cambian por el difusor
  assert.deepEqual(fit(def).thread, fit({ ...def, shadeType: "solid" }).thread);
});

test("la estructura calada que invade el volumen del difusor se rechaza con el motivo; nada se achica en silencio", () => {
  // cintura muy marcada: más angosta que el difusor
  const def = applySilhouette(EXAMPLE, "hourglass");
  const tight = { ...def, openwork: { ...def.openwork, waistPct: 95 } };
  const r = createLamp(tight);
  assert.equal(r.geometry, null);
  const e = r.errors.find((x) => x.code === "DIFFUSER_STRUCTURE_INTRUDES");
  assert.ok(e && /invade el volumen del difusor/.test(e.message), `errores: ${r.errors.map((x) => x.code)}`);
  assert.equal(tight.openwork.waistPct, 95);
  assert.equal(tight.openwork.diffuserClearanceMm, 1);
});

test("se puede introducir y retirar: el anillo superior deja pasar el difusor; uno manual más ancho que el anillo se rechaza", () => {
  const f = fit(EXAMPLE).diffuser;
  assert.ok(f.ringTopFreeDiameterMm / 2 - f.diffuserDiameterMm / 2 >= 0.35 - 1e-9);
  assert.equal(fit(EXAMPLE).insertRemovableFromTop, true);
  const r = createLamp({ ...mk(EXAMPLE, { diffuserFit: "manual" }), insert: { ...EXAMPLE.insert, diameterMm: 82, tabs: false } });
  assert.equal(r.geometry, null);
  assert.ok(r.errors.some((e) => e.code === "DIFFUSER_CANNOT_PASS_TOP" || e.code === "DIFFUSER_STRUCTURE_INTRUDES" || e.code === "INSERT_TOUCHES_SHADE"), r.errors.map((e) => e.code).join());
  assert.ok(r.errors.some((e) => e.code === "DIFFUSER_CANNOT_PASS_TOP"), "mensaje específico del anillo superior");
});

test("las lengüetas ya no existen: pedirlas en la definición no cambia el difusor según anillos ni genera avisos", () => {
  const withTabs = createLamp(mk(EXAMPLE, {}, { tabs: true }));
  const without = createLamp(mk(EXAMPLE, {}, { tabs: false }));
  assert.equal(withTabs.errors.length, 0);
  assert.equal(withTabs.warnings.some((w) => w.code === "DIFFUSER_TABS_NOT_APPLICABLE"), false);
  assert.deepEqual(withTabs.indexed.insert.positions, without.indexed.insert.positions);
  assert.deepEqual(withTabs.indexed.insert.tris, without.indexed.insert.tris);
});

test("el difusor sigue siendo una pieza independiente y reemplazable (plano, gota, ondulado) con la misma interfaz de montaje, y la separación a la bombilla no se reduce", () => {
  const sizes = new Set();
  // la calada solo admite el difusor cilíndrico recto (ondulado liso): plano, gota y ondulado con ondas se rechazan (DIFFUSER_NOT_COMPATIBLE)
  for (const style of ["flat", "drop", "wavy"]) assert.deepEqual(validateLamp(applyInsertStyle(EXAMPLE, style)).errors.map((e) => e.code), ["DIFFUSER_NOT_COMPATIBLE"], style);
  for (const style of ["wavy"]) {
    const def = { ...applyInsertStyle(EXAMPLE, style), insert: { ...applyInsertStyle(EXAMPLE, style).insert, amplitudeMm: 0, twistDeg: 0, verticalFrequency: 0 } };
    const r = createLamp(def);
    assert.equal(r.errors.length, 0, `${style}: ${r.errors.map((e) => e.code + " " + e.message)}`);
    assert.ok(r.geometry.parts.some((p) => p.kind === (style === "drop" ? "lampInsertDrop" : "lampInsert")), `${style}: pieza independiente`);
    assert.ok(lampPartEntries(r).some((e) => /inserto/.test(e.fileName)));
    assertClosed(r.indexed.insert, style);
    sizes.add(r.metrics.fit.insertOuterDiameterMm);
    // separación a la bombilla: ≥ la exigida y nunca menor que con el inserto de Ø65,135 de la sólida (la fija el encastre estándar, igual en ambos)
    assert.ok(r.metrics.fit.insertEnvelopeGapMm >= def.insert.minBulbGapMm);
    const solid = createLamp(applyInsertStyle({ ...DEFAULT_LAMP }, style));
    if (solid.metrics) assert.ok(r.metrics.fit.insertEnvelopeGapMm >= solid.metrics.fit.insertEnvelopeGapMm - 1e-9, `${style}: el difusor más ancho no acerca la bombilla`);
  }
  assert.equal(sizes.size, 1, "el diámetro de montaje es único");
  // un ondulado con ondas se rechaza (la calada solo lleva el cilindro recto): no se genera ni se exporta
  const waves = createLamp(applyInsertStyle(EXAMPLE, "wavy"));
  assert.equal(waves.geometry, null);
  assert.ok(waves.errors.some((e) => e.code === "DIFFUSER_NOT_COMPATIBLE"));
  // mismos números de la interfaz E27 que antes
  const f = fit(EXAMPLE);
  assert.equal(f.tower.slotDepthMm, EXAMPLE.insert.seatDepthMm);
  assert.equal(f.insertAuto, false);
});

function assertClosed(mesh, label) {
  const a = analyzeMesh(mesh);
  assert.equal(a.boundaryEdges + a.nonManifoldEdges + a.inconsistentEdges + a.degenerate + a.nonFinite, 0, `${label}: malla del difusor`);
  assert.ok(a.volume > 0);
}

test("compatibilidad: diseños viejos de la calada se leen con el difusor según anillos; la sólida no cambia", () => {
  const old = { ...WIDE };
  old.openwork = { ...old.openwork };
  delete old.openwork.diffuserFit;
  delete old.openwork.diffuserClearanceMm;
  const loaded = normalizeLampDefinition(old);
  assert.equal(loaded.openwork.diffuserFit, "rings");
  assert.equal(loaded.openwork.diffuserClearanceMm, 1);
  assert.equal(normalizeLampDefinition({ openwork: { diffuserFit: "x" } }).openwork.diffuserFit, "rings");
  assert.equal(normalizeLampDefinition({ openwork: { diffuserFit: "manual" } }).openwork.diffuserFit, "manual");
  assert.equal(DEFAULT_LAMP.shadeType, "solid");
  assert.equal(createLamp(DEFAULT_LAMP).metrics.fit.insertOuterDiameterMm, 65.135);
});

test("UI: el ajuste del difusor a los anillos lo resuelve el motor: el editor no ofrece sus modos, la holgura ni los diámetros de los anillos", () => {
  const { MakerLampControls } = loadLampUi();
  const render = (def) => {
    const r = createLamp(def);
    return renderToStaticMarkup(createElement(MakerLampControls, { def, onChange() {}, errors: r.errors, warnings: r.warnings, metrics: r.metrics }));
  };
  const open = render(EXAMPLE);
  for (const text of ["Difusor de la pantalla calada", "Según los anillos", "Manual", "Holgura diametral", "Ø libre anillo inferior / superior", "Ø máximo que pasa por el cuello roscado", "Ø interior libre anillo", "Lo limita"]) assert.ok(!open.includes(text), `no debe mostrar "${text}"`);
  // el difusor de la calada sigue siendo el cilíndrico recto, sin estilos ni controles propios
  assert.ok(open.includes("Pendiente de validación física") && !open.includes('data-diffuser="'));
  const manual = render({ ...mk(WIDE, { diffuserFit: "manual" }), insert: { ...WIDE.insert, diameterMm: 65.135 } });
  assert.ok(!manual.includes("Ø exterior del cuerpo") && !manual.includes("Holgura diametral"));
  assert.ok(!render(DEFAULT_LAMP).includes("Según los anillos"));
});
