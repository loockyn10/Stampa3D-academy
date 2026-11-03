import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";
import { loadTs } from "./helpers/load-ts.mjs";

// Lámparas V5 — INTEGRACIÓN: Selector → Estado → Motor → Visor → Exportación.
// El selector y los campos son los del componente REAL (MakerLampControls): se renderiza con un registro que captura los controles
// (SegmentedControl / NumberField) y se "hace clic" llamando a sus onChange; el estado es la LampDefinition que devuelve el componente;
// el motor es createLamp; el visor, la conversión a BufferGeometry que usa MakerViewport; la exportación, el STL de los botones.
// Son pruebas GEOMÉTRICAS y de flujo en Node: no reemplazan abrir la ruta real en el navegador (admin) ni laminar en Bambu Studio.

const { DEFAULT_LAMP } = loadMakerModule("lib/maker/lamps/defaults.ts");
const { createLamp, lampGeometryKey } = loadMakerModule("lib/maker/lamps/createLamp.ts");
const { validateLamp } = loadMakerModule("lib/maker/lamps/validation/validateLamp.ts");
const { suggestThreadMajorForDiffuser } = loadMakerModule("lib/maker/lamps/diffuserFit.ts");
const { lampPartEntries, buildLampZipBlob } = loadMakerModule("lib/maker/lamps/exporters/lampFiles.ts");
const { buildSTLBlob } = loadMakerModule("lib/maker/exporters/exportSTL.ts");
const { letterGeometryToBufferGeometry } = loadMakerModule("lib/maker/geometry/toBufferGeometry.ts");
const { analyzeMesh } = loadMakerModule("lib/maker/mugs/geometry/mesh.ts");
const slicing = loadMakerModule("lib/maker/lamps/doublewall/sliceAnalysis.ts");
const { OPENWORK_PRESETS, applyOpenworkPreset } = loadMakerModule("lib/maker/lamps/openwork/presets.ts");
const { applyLampPreset, LAMP_PRESETS } = loadMakerModule("lib/maker/lamps/presets.ts");

// ------------------------------------------------------------------ el componente real, con los controles registrados
const registry = { seg: [], num: [] };
const mocks = {
  "next/link": { __esModule: true, default: (props) => createElement("a", props) },
  "opentype.js": {},
  "@/components/maker/LampFamilyPicker": {
    LampFamilyPicker: (p) => {
      // el selector de tipo (tarjetas) se registra como un selector más para que las pruebas lo accionen por su rótulo
      registry.seg.push({ options: [{ value: "solid", label: "Sólida" }, { value: "openwork", label: "Calada" }, { value: "double", label: "Doble pared" }], value: p.value, onChange: p.onSelect });
      return createElement("div", { "data-seg": "" }, "Sólida Calada Doble pared");
    },
  },
  "@/components/maker/MakerTextControls": {
    SegmentedControl: (p) => {
      registry.seg.push(p);
      return createElement("div", { "data-seg": "" }, p.options.map((o) => createElement("button", { key: o.value, type: "button", "aria-pressed": o.value === p.value }, o.label)));
    },
    NumberField: (p) => {
      registry.num.push(p);
      return createElement("label", null, p.label, createElement("input", { defaultValue: p.value }));
    },
  },
};
const { MakerLampControls, LampExportButtons } = loadTs("src/components/maker/MakerLampControls.tsx", mocks);

/** Una "sesión" de la herramienta: estado = LampDefinition; cada acción pasa por los controles del componente real. */
function session(start = DEFAULT_LAMP) {
  const s = { def: start, html: "", result: null };
  const render = () => {
    registry.seg = [];
    registry.num = [];
    s.result = createLamp(s.def);
    s.html = renderToStaticMarkup(
      createElement(MakerLampControls, {
        def: s.def,
        onChange: (next) => (s.captured = next),
        onApplyPreset() {}, onGenerateVariation() {}, onLoadDesign() {}, onError() {},
        errors: s.result.errors, warnings: s.result.warnings, metrics: s.result.metrics,
        exportButtons: createElement(LampExportButtons, { hasInsert: s.def.insert.enabled, insertStyle: s.def.insert.style, hasCollar: false, canDownload: true, canDownloadTests: true, busy: null, onDownloadPart() {}, onDownloadZip() {}, onDownloadTests() {}, holderMeasured: false }),
      }),
    );
    return s;
  };
  s.render = render;
  /** Clic en una opción de un selector segmentado (por su rótulo). */
  s.click = (label) => {
    const seg = registry.seg.find((c) => c.options.some((o) => o.label === label));
    assert.ok(seg, `no hay un selector con la opción «${label}»`);
    s.captured = null;
    seg.onChange(seg.options.find((o) => o.label === label).value);
    assert.ok(s.captured, `el selector «${label}» no cambió el estado`);
    s.def = s.captured;
    return render();
  };
  /** Escribir un número en un campo (por su rótulo). */
  s.type = (label, value) => {
    const field = registry.num.find((c) => c.label === label);
    assert.ok(field, `no hay un campo «${label}»`);
    s.captured = null;
    field.onChange(value);
    assert.ok(s.captured, `el campo «${label}» no cambió el estado`);
    s.def = s.captured;
    return render();
  };
  /** Mover un deslizador: sus handlers hacen exactamente `onChange({...def, grupo: {...grupo, campo: valor}})`. */
  s.set = (group, patch) => {
    s.def = { ...s.def, [group]: { ...s.def[group], ...patch } };
    return render();
  };
  return render();
}

// ------------------------------------------------------------------ STL exportado -> malla -> mediciones
function exportStl(result, kind) {
  const entries = lampPartEntries(result);
  const entry = entries.find((e) => (kind === "shade" ? /pantalla/ : kind === "insert" ? /inserto/ : /base/).test(e.fileName));
  assert.ok(entry, `no hay archivo de ${kind}`);
  return entry;
}
async function stlBytes(entry) {
  return Buffer.from(await buildSTLBlob(entry.mesh).arrayBuffer());
}
function parseStl(buf) {
  const n = buf.readUInt32LE(80);
  assert.equal(buf.length, 84 + 50 * n, "STL binario válido");
  const index = new Map();
  const positions = [];
  const tris = [];
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const o = 84 + t * 50 + 12 + k * 12;
      const x = buf.readFloatLE(o), y = buf.readFloatLE(o + 4), z = buf.readFloatLE(o + 8);
      const key = `${x},${y},${z}`;
      let id = index.get(key);
      if (id === undefined) {
        id = positions.length / 3;
        index.set(key, id);
        positions.push(x, y, z);
      }
      tris.push(id);
    }
  }
  return { positions, tris };
}
function bounds(mesh) {
  const p = mesh.positions;
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < p.length; i += 3) {
    b.minX = Math.min(b.minX, p[i]); b.maxX = Math.max(b.maxX, p[i]);
    b.minY = Math.min(b.minY, p[i + 1]); b.maxY = Math.max(b.maxY, p[i + 1]);
    b.minZ = Math.min(b.minZ, p[i + 2]); b.maxZ = Math.max(b.maxZ, p[i + 2]);
  }
  return b;
}
/** Diámetro del tubo liso de montaje de un difusor: radio máximo en los primeros 8 mm sobre su borde inferior. */
function mountDiameter(mesh) {
  const b = bounds(mesh);
  let r = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) if (mesh.positions[i + 2] <= b.minZ + 8) r = Math.max(r, Math.hypot(mesh.positions[i], mesh.positions[i + 1]));
  return 2 * r;
}
function castRay(mesh, z, theta) {
  const p = mesh.positions, dx = Math.cos(theta), dy = Math.sin(theta);
  const hits = [];
  for (let i = 0; i < mesh.tris.length; i += 3) {
    const a = mesh.tris[i] * 3, b = mesh.tris[i + 1] * 3, c = mesh.tris[i + 2] * 3;
    if (z < Math.min(p[a + 2], p[b + 2], p[c + 2]) || z > Math.max(p[a + 2], p[b + 2], p[c + 2])) continue;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const hx = dy * e2z, hy = -dx * e2z, hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < 1e-12) continue;
    const f = 1 / det;
    const sx = -p[a], sy = -p[a + 1], sz = z - p[a + 2];
    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = f * (dx * qx + dy * qy);
    if (v < 0 || u + v > 1) continue;
    const t = f * (e2x * qx + e2y * qy + e2z * qz);
    if (t > 1e-9) hits.push(t);
  }
  hits.sort((m, n) => m - n);
  const merged = hits.filter((t, k) => k === 0 || t - hits[k - 1] > 1e-6);
  const out = [];
  for (let k = 0; k < merged.length; k++) {
    if (k + 1 < merged.length && merged[k + 1] - merged[k] < 0.1) { k++; continue; }
    out.push(merged[k]);
  }
  return out;
}
function minRadiusInBands(mesh, z0, z1, step = 2) {
  const p = mesh.positions;
  const bands = new Map();
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 2] < z0 || p[i + 2] > z1) continue;
    const k = Math.floor((p[i + 2] - z0) / step);
    bands.set(k, Math.min(bands.get(k) ?? Infinity, Math.hypot(p[i], p[i + 1])));
  }
  return bands;
}

// ================================================================== CASO 1 — pantalla calada
test("Caso 1 (calada): selector → anillos Ø80 → holgura 1 mm → difusor Ø79 → silueta Ø150 → el difusor sigue en Ø79 → STL exportado medido", async () => {
  const s = session(DEFAULT_LAMP);
  // el selector existe y ofrece los tres tipos
  assert.ok(["Sólida", "Calada", "Doble pared"].every((t) => s.html.includes(t)), "selector Sólida | Calada | Doble pared");
  s.click("Calada");
  assert.equal(s.def.shadeType, "openwork");
  assert.equal(s.def.openwork.diffuserFit, "diameter", "la calada parte del modo recomendado (el difusor es el dato)");
  // este caso ejercita el modo «Según los anillos» (V5); el modo por diámetro (V6) tiene su propio caso en maker-lamps-v6-stability.test.mjs
  s.click("Según los anillos");
  assert.equal(s.def.openwork.diffuserFit, "rings");
  assert.ok(s.html.includes("Ø interior libre anillo inferior"), "controles de anillos");
  // 2-3) anillos con Ø80 libres (campos reales) y holgura diametral 1 mm (valor inicial)
  s.type("Ø interior libre anillo inferior", 80);
  s.type("Ø interior libre anillo superior", 80);
  s.type("Ø interior libre anillo inferior", 80);
  assert.equal(s.def.openwork.diffuserClearanceMm, 1);
  let fit = s.result.metrics.fit.diffuser;
  assert.ok(Math.abs(fit.ringBottomFreeDiameterMm - 80) < 0.02 && Math.abs(fit.ringTopFreeDiameterMm - 80) < 0.02, `anillos libres ${fit.ringBottomFreeDiameterMm} / ${fit.ringTopFreeDiameterMm}`);
  // con el encastre inferior estándar (Ø65,135) la torre no crece con el cuerpo: la rosca por defecto ya deja pasar un difusor de Ø79 y lo limita el anillo, no la base
  assert.notEqual(fit.limitedBy, "base");
  assert.ok(Math.abs(fit.diffuserDiameterMm - 79) < 0.011, `limitado por el anillo: Ø${fit.diffuserDiameterMm}`);
  assert.ok(!s.result.warnings.some((w) => w.code === "DIFFUSER_LIMITED_BY_BASE"));
  assert.ok(!s.html.includes("Subir la rosca hasta que el difusor use los anillos"));
  assert.equal(s.def.thread.majorDiameterMm, DEFAULT_LAMP.thread.majorDiameterMm, "no se tocó la rosca");
  assert.equal(s.result.errors.length, 0, JSON.stringify(s.result.errors.map((e) => e.code + e.message)));
  // 5) el difusor mide Ø79 (anillos Ø80 − holgura 1)
  assert.ok(Math.abs(fit.diffuserDiameterMm - 79) < 0.011, `difusor Ø${fit.diffuserDiameterMm}`);
  assert.ok(s.html.includes("Ø exterior del difusor"));
  const before = await stlBytes(exportStl(s.result, "insert"));
  assert.ok(Math.abs(mountDiameter(parseStl(before)) - 79) < 0.03, "STL del difusor medido (antes de expandir)");
  // 6-7) silueta exterior hasta Ø150: el difusor NO cambia
  s.set("openwork", { maxDiameterMm: 150 });
  fit = s.result.metrics.fit.diffuser;
  assert.ok(Math.abs(fit.diffuserDiameterMm - 79) < 0.011);
  // 8-9) exportar y medir los STL
  const shadeEntry = exportStl(s.result, "shade"), insertEntry = exportStl(s.result, "insert");
  const shade = parseStl(await stlBytes(shadeEntry)), insert = parseStl(await stlBytes(insertEntry));
  let maxR = 0;
  for (let i = 0; i < shade.positions.length; i += 3) maxR = Math.max(maxR, Math.hypot(shade.positions[i], shade.positions[i + 1]));
  assert.ok(Math.abs(2 * maxR - 150) < 0.3, `pantalla exportada: Ø máximo ${2 * maxR}`);
  assert.ok(Math.abs(mountDiameter(insert) - 79) < 0.03, `difusor exportado Ø${mountDiameter(insert)}`);
  assert.ok((await stlBytes(insertEntry)).equals(before), "el STL del difusor es idéntico antes y después de expandir la silueta");
  // el visor usa las mismas mallas: BufferGeometry de la pieza = triángulos del STL
  const part = s.result.geometry.parts.find((p) => p.kind === "lampInsert");
  const g = letterGeometryToBufferGeometry(part.mesh);
  assert.equal(g.getAttribute("position").count, insert.tris.length, "visor y exportación: misma cantidad de vértices");
  // 4) solo la forma decorativa (patrón, torsión, densidad): el difusor se mantiene y se verifica el paso
  for (const patch of [{ pattern: "spiral", bands: 6, turns: 0.4, stripWidthMm: 6 }, { divisions: 16, stripWidthMm: 3 }, { twistDeg: 60 }]) {
    const t = session(s.def).set("openwork", patch);
    assert.equal(t.result.metrics.fit.diffuser.diffuserDiameterMm, fit.diffuserDiameterMm, JSON.stringify(patch));
  }
  // modificar el diámetro de montaje recalcula el difusor y el STL
  const thin = session(s.def).set("thread", { majorDiameterMm: 88 });
  // con una rosca más angosta la base ya no es la que limita al difusor (el encastre es estándar): lo que pasa a ser inválido es la transición de 45° de la pantalla, y se informa sin achicar nada
  assert.ok(thin.result.errors.some((e) => e.code === "SHADE_NARROWER_THAN_THREAD"), "una rosca más ancha que la pantalla se rechaza");
  const wide = session(s.def).set("thread", { majorDiameterMm: s.def.thread.majorDiameterMm + 8 });
  assert.equal(wide.result.metrics.fit.diffuser.diffuserDiameterMm, fit.diffuserDiameterMm, "con más rosca lo siguen limitando los anillos");
  assert.notEqual(lampGeometryKey(thin.def), lampGeometryKey(s.def));
  // se introduce y se retira físicamente: en todo el recorrido (del anillo superior a la ranura) el libre de la pantalla supera al difusor
  const L = validateLamp(s.def).layout;
  const need = fit.diffuserDiameterMm / 2 + s.def.insert.clearanceMm - 1e-6;
  for (const [band, r] of minRadiusInBands(shade, L.insert.z0, L.shadeTopZ)) assert.ok(r >= need, `banda ${band}: libre ${r.toFixed(2)} < ${need.toFixed(2)}`);
  assert.equal(s.result.metrics.fit.insertRemovableFromTop, true);
  // la pantalla calada sigue teniendo huecos reales
  let open = 0, total = 0;
  for (let a = 0; a < 20; a++) for (let b = 0; b < 60; b++) { total++; if (castRay(shade, L.decorZ0 + 25 + a * 4.3, (2 * Math.PI * (b + 0.3)) / 60).length === 0) open++; }
  assert.ok(open / total > 0.2, `aberturas reales: ${open}/${total}`);
});

// ================================================================== CASO 2 — doble pared
test("Caso 2 (doble pared): selector → exterior abombado y estriado → interior reloj de arena → separación 20 mm → ambas paredes unidas arriba y abajo → STL inspeccionado", async () => {
  const s = session(DEFAULT_LAMP);
  s.click("Doble pared");
  assert.equal(s.def.shadeType, "double");
  assert.ok(["Pared exterior", "Pared interior", "Cámara y fabricación", "Impresión convencional", "Separación entre paredes", "Forma exterior", "Forma interior"].every((t) => s.html.includes(t)), "controles de la doble pared");
  assert.ok(s.html.includes("El modo jarrón todavía no está disponible"), "el modo jarrón no se ofrece como terminado");
  // la pared interior es parte de la pantalla: no se ofrece un difusor adicional (ni sus formas) por defecto
  assert.equal(s.def.insert.enabled, false);
  assert.ok(!s.html.includes("Forma del difusor"), "sin difusor no hay formas de difusor");
  assert.ok(!s.html.includes("Familia de patrón") && !s.html.includes("Patrón</span>"), "no mezcla los controles de la sólida ni de la calada");
  s.click("Abombada");
  s.click("Estriada");
  s.click("Reloj de arena");
  s.set("doubleWall", { minGapMm: 20 });
  assert.equal(s.def.doubleWall.minGapMm, 20);
  assert.equal(s.result.errors.length, 0, JSON.stringify(s.result.errors.map((e) => e.code + ": " + e.message)));
  const m = s.result.metrics;
  assert.ok(m.doubleWall.minGapMm >= 20, `separación medida ${m.doubleWall.minGapMm}`);
  assert.deepEqual([m.doubleWall.solidBodies, m.doubleWall.cavities], [1, 1]);
  assert.ok(s.html.includes("Separación medida entre paredes"));
  // visor: la pieza "pantalla" tiene la geometría exportada
  const shadeEntry = exportStl(s.result, "shade");
  const buf = await stlBytes(shadeEntry);
  const stl = parseStl(buf);
  const part = s.result.geometry.parts.find((p) => p.kind === "lampShade");
  assert.equal(letterGeometryToBufferGeometry(part.mesh).getAttribute("position").count, stl.tris.length, "visor y exportación: misma malla");
  // inspección de la malla EXPORTADA (leída del STL): cerrada, orientada, 1 cuerpo + 1 cavidad
  const rep = analyzeMesh(stl);
  assert.deepEqual([rep.boundaryEdges, rep.nonManifoldEdges, rep.inconsistentEdges, rep.degenerate], [0, 0, 0, 0], "malla del STL válida");
  assert.ok(rep.volume > 0);
  const sh = slicing.shellReport(stl);
  assert.deepEqual([sh.solidBodies, sh.cavities], [1, 1]);
  // uniones: cortes horizontales del STL
  const L = validateLamp(s.def).layout;
  const z0 = L.decorZ0;
  const H = s.def.shade.heightMm;
  const islands = (z) => {
    const loops = slicing.sliceMesh(stl, z);
    return { outer: loops.filter((l) => l.area > 0), holes: loops.filter((l) => l.area < 0) };
  };
  const floor = islands(z0 + 1.2);
  assert.equal(floor.outer.length, 1, "unión inferior: UN solo anillo macizo que une ambas paredes");
  assert.equal(floor.holes.length, 1, "…con la abertura central libre");
  const walls = islands(z0 + H / 2);
  assert.equal(walls.outer.length, 2, "a media altura: dos paredes");
  assert.equal(walls.holes.length, 2);
  const rim = islands(z0 + H - 1.0);
  assert.equal(rim.outer.length, 1, "unión superior: UN solo rim que une ambas paredes");
  assert.equal(rim.holes.length, 1, "…con la abertura central libre");
  // separación entre las dos paredes en la malla exportada (corte a media altura): hueco de la pared exterior vs contorno de la interior
  const bigHole = walls.holes.sort((a, b) => a.area - b.area)[0];
  const innerWall = walls.outer.sort((a, b) => a.area - b.area)[0];
  let sep = Infinity;
  for (const [x, y] of bigHole.points) for (const [u, v] of innerWall.points) sep = Math.min(sep, Math.hypot(x - u, y - v));
  assert.ok(sep >= 19.9, `separación en el corte de media altura (STL): ${sep.toFixed(2)}`);
  // la abertura central: ningún material entre el eje y la cara de la pared interior en toda la altura
  for (const dz of [3, 30, 70, 110, 150, 175]) {
    const hits = castRay(stl, z0 + dz, 0.7);
    // sin difusor (la pared interior es parte de la pantalla) la abertura debe dejar la separación de diseño al portalámparas y a la bombilla; con difusor, su holgura de montaje
    const freeR = L.insert ? L.insert.outerR + s.def.insert.clearanceMm : Math.max(L.bulbR, L.bodyR) + s.def.insert.minBulbGapMm;
    assert.ok(hits.length >= 2 && hits[0] >= freeR - 1e-6, `abertura libre a +${dz} mm: primer material a ${hits[0]?.toFixed(2)} mm del eje`);
  }
  // dimensiones reales
  const b = bounds(stl);
  assert.ok(Math.abs(b.minZ - L.ledgeZ) < 1e-3 && Math.abs(b.maxZ - (z0 + H)) < 1e-3, `alto ${b.maxZ - b.minZ}`);
  assert.ok(b.maxX - b.minX > s.def.shade.bottomDiameterMm, "Ø máximo de la pared exterior");
  // exportaciones existentes: mismas piezas y nombres que con las otras pantallas; ZIP con LÉEME
  const solidNames = lampPartEntries(createLamp(DEFAULT_LAMP)).map((e) => e.fileName);
  assert.deepEqual(lampPartEntries(s.result).map((e) => e.fileName), solidNames.filter((n) => !/inserto/.test(n)), "mismas piezas que la sólida salvo el difusor (la doble pared no lo lleva por defecto)");
  const zip = await JSZip.loadAsync(Buffer.from(await (await buildLampZipBlob(s.result, s.def)).arrayBuffer()));
  assert.ok(Object.keys(zip.files).some((f) => /pantalla/.test(f)));
  // el difusor (opcional: por defecto la doble pared no lo lleva) se dimensiona por la abertura central y es independiente de la forma exterior
  const withDiffuser = { ...s.def, insert: { ...s.def.insert, enabled: true } };
  const dif = createLamp(withDiffuser).metrics.fit.diffuser;
  assert.equal(dif.limitedBy, "opening");
  const t = session(withDiffuser).click("Cilíndrica"); // (primer selector con esa opción: el de la pared exterior)
  assert.equal(t.result.metrics.fit.diffuser.diffuserDiameterMm, dif.diffuserDiameterMm, "otra forma exterior: mismo difusor");
});

test("Doble pared: las dos siluetas se editan por separado (cilíndrica/cónica/reloj de arena/orgánica × cilíndrica/abombada/ondulada/estriada/torsión), la separación se comprueba y se rechaza lo incompatible", () => {
  const base = session(DEFAULT_LAMP).click("Doble pared");
  const inners = ["Cilíndrica", "Reloj de arena", "Orgánica"];
  let built = 0;
  const shapes = loadMakerModule("lib/maker/lamps/doublewall/shapes.ts");
  const offered = (label) => registry.seg.some((c) => c.options.some((o) => o.label === label));
  // V6: las formas que con las medidas actuales rompen la separación entre paredes NO se ofrecen (el motor las rechaza igual)
  assert.equal(offered("Ondulada"), false, "«Ondulada» rompe la separación con las medidas iniciales: no se ofrece");
  assert.equal(offered("Cónica"), false, "«Cónica» rompe la separación con las medidas iniciales: no se ofrece");
  assert.ok(base.html.includes("2 formas no disponibles con estas medidas"), "la interfaz dice cuántas formas no se ofrecen y por qué");
  assert.ok(createLamp(shapes.applyDoubleOuterShape(base.def, "wavy")).errors.some((e) => e.code === "DW_GAP"));
  for (const outer of ["Cilíndrica", "Abombada", "Estriada", "Con torsión"]) {
    for (const inner of inners) {
      const s = session(base.def);
      s.click(outer); // (el selector exterior es el primero con esa opción)
      // el selector interior comparte rótulos ("Cilíndrica"): se usa el segundo registrado
      const segs = registry.seg.filter((c) => c.options.some((o) => o.label === inner));
      if (segs.length === 0) {
        // V6: con esa forma exterior, la interior no se ofrece porque rompería la separación: el motor la rechaza igual
        const kind = { "Reloj de arena": "hourglass", "Orgánica": "organic" }[inner];
        assert.ok(createLamp(shapes.applyDoubleInnerShape(s.def, kind)).errors.some((e) => e.code === "DW_GAP"), `${outer}/${inner}: no se ofrece pero sería válida`);
        continue;
      }
      s.captured = null;
      segs[segs.length - 1].onChange(segs[segs.length - 1].options.find((o) => o.label === inner).value);
      s.def = s.captured;
      s.render();
      assert.ok(s.result.errors.every((e) => /^DW_|^DIFFUSER_|^INSERT_|^TOWER_/.test(e.code)), `${outer}/${inner}: ${s.result.errors.map((e) => e.code)}`);
      if (s.result.errors.length === 0) {
        built++;
        assert.ok(s.result.metrics.doubleWall.minGapMm >= s.def.doubleWall.minGapMm, `${outer}/${inner}`);
        assert.deepEqual([s.result.metrics.doubleWall.solidBodies, s.result.metrics.doubleWall.cavities], [1, 1]);
      }
    }
  }
  assert.ok(built >= 8, `combinaciones válidas: ${built}`);
  // cónica con el diámetro superior mayor: separación insuficiente -> error con el motivo
  const cone = { def: shapes.applyDoubleInnerShape(base.def, "cone") };
  cone.result = createLamp(cone.def);
  assert.ok(cone.result.errors.some((e) => e.code === "DW_GAP" && /mínima medida/.test(e.message)), cone.result.errors.map((e) => e.code).join());
  assert.equal(cone.result.geometry, null);
  // abierta arriba: sin cavidad cerrada
  const open = session(base.def).click("Abierta arriba");
  assert.deepEqual([open.result.metrics.doubleWall.solidBodies, open.result.metrics.doubleWall.cavities], [1, 0]);
  assert.ok(!open.result.warnings.some((w) => w.code === "DW_CLOSED_CAVITY"));
  assert.ok(base.result.warnings.some((w) => w.code === "DW_CLOSED_CAVITY"), "la cámara cerrada se avisa");
});

// ================================================================== CASO 3 — regresión
test("Caso 3 (regresión): sólida, calada con huecos reales, base y rosca sin cambios, insertos sólidos en el estándar Ø65,135, presets y exportaciones", async () => {
  const BASE140 = { diameterMm: 140 }; // misma base en los tres: así se compara la MALLA de la base
  const solid = createLamp({ ...DEFAULT_LAMP, base: BASE140 });
  assert.equal(solid.errors.length, 0);
  assert.equal(solid.metrics.fit.insertOuterDiameterMm, 65.135, "el inserto de la sólida es el encastre estándar de diffuser.stl");
  assert.equal(solid.metrics.fit.diffuser, null);
  assert.equal(solid.metrics.doubleWall, null);
  // presets de la sólida y de la calada
  for (const preset of LAMP_PRESETS.slice(0, 3)) assert.equal(createLamp(applyLampPreset(DEFAULT_LAMP, preset)).errors.length, 0, preset.id);
  const p = applyOpenworkPreset(DEFAULT_LAMP, OPENWORK_PRESETS[0]);
  assert.equal(createLamp({ ...p, openwork: { ...p.openwork, diffuserFit: "manual" } }).errors.length, 0);
  // la base y la rosca no cambian por la pantalla (con el mismo difusor manual de Ø65)
  const manual = { diffuserFit: "manual", diffuserClearanceMm: 1 };
  const open = createLamp({ ...DEFAULT_LAMP, base: BASE140, shadeType: "openwork", openwork: { ...DEFAULT_LAMP.openwork, ...manual } });
  const dbl = createLamp({ ...DEFAULT_LAMP, base: BASE140, shadeType: "double", shade: { ...DEFAULT_LAMP.shade, bottomDiameterMm: 140, topDiameterMm: 140 }, doubleWall: { ...DEFAULT_LAMP.doubleWall, ...manual } });
  for (const r of [open, dbl]) {
    assert.equal(r.errors.length, 0, JSON.stringify(r.errors.map((e) => e.code + e.message)));
    // (la altura de la transición de 45° depende del diámetro inferior de cada pantalla; el resto de la interfaz roscada es idéntica)
    assert.deepEqual({ ...r.metrics.fit.thread, flareHeightMm: 0 }, { ...solid.metrics.fit.thread, flareHeightMm: 0 }, "roscas conservadas");
    assert.equal(r.indexed.base, solid.indexed.base, "base E27 sin cambios con el mismo difusor");
    assert.equal(r.metrics.fit.insertOuterDiameterMm, 65.135);
  }
  assert.equal(lampPartEntries(dbl).length, lampPartEntries(solid).length);
  // calada: huecos reales y una sola pieza; sólida: pared continua
  assert.equal(open.metrics.openwork.components, 1);
  assert.ok(open.metrics.openwork.aperturePct > 40);
  // transición hacia adentro de la calada (anillos más angostos que la rosca): malla válida y avisada
  const narrow = createLamp({ ...DEFAULT_LAMP, shadeType: "openwork", shade: { ...DEFAULT_LAMP.shade, bottomDiameterMm: 84.8, topDiameterMm: 100 }, openwork: { ...DEFAULT_LAMP.openwork, ...manual } });
  assert.equal(narrow.errors.length, 0, JSON.stringify(narrow.errors.map((e) => e.code + e.message)));
  assert.ok(narrow.warnings.some((w) => w.code === "FLARE_INWARD"));
  assert.ok(narrow.metrics.shade.watertight && narrow.metrics.openwork.components === 1);
  // sin la transición hacia afuera obligatoria: un diámetro entre ambas sigue rechazado
  const between = createLamp({ ...DEFAULT_LAMP, shadeType: "openwork", shade: { ...DEFAULT_LAMP.shade, bottomDiameterMm: 94, topDiameterMm: 100 }, openwork: { ...DEFAULT_LAMP.openwork, ...manual } });
  assert.ok(between.errors.some((e) => e.code === "SHADE_NARROWER_THAN_THREAD"));
  // la sólida con un diámetro inferior más angosto que la rosca sigue rechazada (no se tocó su regla)
  assert.ok(createLamp({ ...DEFAULT_LAMP, shade: { ...DEFAULT_LAMP.shade, bottomDiameterMm: 84 } }).errors.some((e) => e.code === "SHADE_NARROWER_THAN_THREAD" || e.code === "OUT_OF_RANGE"));
  // el doble pared con collar no está soportado y se dice
  assert.ok(createLamp({ ...dbl && { ...DEFAULT_LAMP, shadeType: "double", shade: { ...DEFAULT_LAMP.shade, bottomDiameterMm: 140, topDiameterMm: 140 } }, thread: { ...DEFAULT_LAMP.thread, connection: "collar" } }).errors.some((e) => e.code === "DW_COLLAR_UNSUPPORTED"));
});

// ================================================================== cableado real
test("cableado: la página real pasa el estado del selector al motor, al visor y a la exportación (sin geometría simulada)", () => {
  const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");
  const page = read("src/app/stampa-maker/lamparas/page.tsx");
  assert.match(page, /<MakerLampControls[\s\S]*onChange=\{setDef\}/, "el selector escribe en el estado de la página");
  assert.match(page, /useLampGeometry\(def\)/, "el estado entra al motor");
  assert.match(page, /geometry=\{viewGeometry\}/, "el visor recibe la geometría del motor");
  assert.match(page, /downloadLampPart\(result, kind\)/, "la descarga usa el resultado del motor");
  assert.match(page, /downloadLampZip\(result, def\)/);
  const hook = read("src/hooks/maker/useLampGeometry.ts");
  assert.match(hook, /createLamp\(debounced/, "el hook llama al motor real");
  const controls = read("src/components/maker/MakerLampControls.tsx");
  const caps = read("src/lib/maker/lamps/capabilities.ts");
  for (const label of ["Sólida", "Calada", "Doble pared"]) assert.ok(caps.includes(`label: "${label}"`), `familia ${label}`);
  assert.match(controls, /LampFamilyPicker/);
  assert.match(controls, /applyShadeType\(def, type\)/);
  assert.match(page, /switchFamily\(def, type, familyMemory\.current\)/, "la página recuerda lo que el usuario dejó en cada familia");
  // el motor no importa nada de la carpeta experimental, y la carpeta experimental sí importa el motor real
  const create = read("src/lib/maker/lamps/createLamp.ts");
  assert.ok(!/experiments\//.test(create) && !/experiments\//.test(read("src/lib/maker/lamps/parts/createShade.ts")));
  assert.ok(fs.existsSync(path.resolve("src/lib/maker/lamps/doublewall/buildShade.ts")));
  // el visor dibuja la doble pared translúcida (se ven las dos paredes) y la calada casi opaca
  assert.match(page, /shadeOpacity=\{def\.shadeType === "openwork" \? 0\.95 : null\}/);
});
