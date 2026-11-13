import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";
import { planeCrossings } from "./helpers/lamp-slice.mjs";

// LOS DIFUSORES NUNCA LLEVAN LENGÜETAS SUPERIORES. No alcanza con ocultar el control: la generación está desactivada en el motor (layout.ts y insert/surface.ts), el campo
// `insert.tabs` solo se conserva para leer códigos SL1 anteriores y no tiene efecto, ningún estilo/preset/familia/variación lo activa y un diseño anterior que lo traía se
// abre sin lengüetas. Se verifica sobre las mallas del visor y sobre los STL EXPORTADOS, y que el encastre INFERIOR (tubo Ø65,135, transición y ranura) no cambia.

const D = loadMakerModule("lib/maker/lamps/defaults.ts");
const E = loadMakerModule("lib/maker/lamps/editor.ts");
const CAPS = loadMakerModule("lib/maker/lamps/capabilities.ts");
const S = loadMakerModule("lib/maker/lamps/standard.ts");
const { createLamp } = loadMakerModule("lib/maker/lamps/createLamp.ts");
const { validateLamp } = loadMakerModule("lib/maker/lamps/validation/validateLamp.ts");
const { lampPartEntries } = loadMakerModule("lib/maker/lamps/exporters/lampFiles.ts");
const { buildSTLBlob } = loadMakerModule("lib/maker/exporters/exportSTL.ts");
const { encodeLampDesign, decodeLampDesign } = loadMakerModule("lib/maker/lamps/designCode.ts");
const { LAMP_PRESETS, applyLampPreset } = loadMakerModule("lib/maker/lamps/presets.ts");
const { switchFamily } = loadMakerModule("lib/maker/lamps/openwork/presets.ts");
const { generateLampVariation } = loadMakerModule("lib/maker/lamps/variation.ts");
const { indexedBounds } = loadMakerModule("lib/maker/mugs/geometry/mesh.ts");

const KINDS = ["cylinder", "flat", "drop", "wavy", "mossglow", "tulip", "hourglass", "bell"];
const SOLID = E.newLampDesign();
const withTabs = (def) => ({ ...def, insert: { ...def.insert, tabs: true } });
const withoutTabs = (def) => ({ ...def, insert: { ...def.insert, tabs: false } });
const build = (def, label) => {
  const r = createLamp(def);
  assert.equal(r.errors.length, 0, `${label}: ${JSON.stringify(r.errors.map((e) => e.code))}`);
  return r;
};
/** Radio máximo de los vértices del inserto en la banda superior (los últimos `band` mm) y en todo el cuerpo. */
function topRadius(mesh, band = 3) {
  const zMax = indexedBounds(mesh).maxZ;
  let top = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) if (mesh.positions[i + 2] > zMax - band) top = Math.max(top, Math.hypot(mesh.positions[i], mesh.positions[i + 1]));
  return top;
}
async function stlOf(entry) {
  const buf = Buffer.from(await buildSTLBlob(entry.mesh).arrayBuffer());
  const n = buf.readUInt32LE(80);
  let maxR = 0, maxXY = [0, 0], zMax = -Infinity;
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
    const o = 84 + t * 50 + 12 + k * 12;
    const x = buf.readFloatLE(o), y = buf.readFloatLE(o + 4), z = buf.readFloatLE(o + 8);
    maxR = Math.max(maxR, Math.hypot(x, y));
    maxXY = [Math.max(maxXY[0], Math.abs(x)), Math.max(maxXY[1], Math.abs(y))];
    zMax = Math.max(zMax, z);
  }
  return { triangles: n, maxR, maxXY };
}

// ================================================================================================ 1. EL MOTOR NO LAS GENERA
test("ningún estilo de difusor genera lengüetas, aunque la definición las pida: la malla es idéntica a la de tabs=false y no sobresale nada arriba", () => {
  for (const kind of KINDS) {
    const base = CAPS.applyDiffuserKind(SOLID, kind);
    for (const top of kind === "wavy" ? ["open", "flat"] : [null]) {
      const def = top ? { ...base, insert: { ...base.insert, wavyTop: top } } : base;
      const a = build(withTabs(def), `${kind}/${top} (tabs=true)`);
      const b = build(withoutTabs(def), `${kind}/${top} (tabs=false)`);
      assert.deepEqual(a.indexed.insert.positions, b.indexed.insert.positions, `${kind}/${top}: mismas posiciones`);
      assert.deepEqual(a.indexed.insert.tris, b.indexed.insert.tris, `${kind}/${top}: mismos triángulos`);
      const maxR = a.metrics.fit.insertMaxDiameterMm / 2;
      assert.ok(topRadius(a.indexed.insert) <= maxR + 0.01, `${kind}/${top}: saliente en el borde superior ${topRadius(a.indexed.insert)} > ${maxR}`);
      assert.equal(a.metrics.fit.insertRemovableFromTop === null || typeof a.metrics.fit.insertRemovableFromTop === "boolean", true);
    }
  }
  // calada y doble pared (difusor cilíndrico): tampoco
  for (const type of ["openwork", "double"]) {
    const def = { ...switchFamily(SOLID, type).def };
    const d = { ...def, insert: { ...def.insert, enabled: true } };
    const a = build(withTabs(d), type), b = build(withoutTabs(d), type);
    assert.deepEqual(a.indexed.insert.positions, b.indexed.insert.positions, type);
    assert.ok(topRadius(a.indexed.insert) <= a.metrics.fit.insertMaxDiameterMm / 2 + 0.01, type);
  }
});

test("el motor ya no avisa de lengüetas y el diseño con tabs=true valida igual que sin ellas", () => {
  for (const kind of KINDS) {
    const base = CAPS.applyDiffuserKind(SOLID, kind);
    const codes = (d) => validateLamp(d).errors.map((e) => e.code).concat(validateLamp(d).warnings.map((w) => w.code));
    assert.deepEqual(codes(withTabs(base)), codes(withoutTabs(base)), kind);
    assert.ok(!codes(withTabs(base)).includes("DIFFUSER_TABS_NOT_APPLICABLE"), kind);
  }
  const layout = validateLamp(withTabs(SOLID)).layout;
  assert.equal(layout.insert.tabLengthMm, 0);
});

// ================================================================================================ 2. STL EXPORTADOS = VISOR, SIN LENGÜETAS
test("STL exportados: el difusor no tiene salientes superiores en ningún estilo y el STL es la misma malla que ve el visor", async () => {
  for (const kind of KINDS) {
    const def = withTabs(CAPS.applyDiffuserKind(SOLID, kind));
    const r = build(def, kind);
    const entries = lampPartEntries(r);
    const idx = r.geometry.parts.findIndex((p) => p.kind === "lampInsert" || p.kind === "lampInsertDrop");
    const entry = entries[idx];
    assert.ok(entry && /inserto|difusor/.test(entry.fileName), `${kind}: hay archivo del difusor`);
    const stl = await stlOf(entry);
    const maxR = r.metrics.fit.insertMaxDiameterMm / 2;
    assert.ok(stl.maxR <= maxR + 0.01, `${kind}: STL con radio ${stl.maxR} > cuerpo ${maxR}`);
    // los dos ejes miden lo mismo (antes las lengüetas hacían crecer solo uno: Ø65 × Ø79)
    assert.ok(Math.abs(stl.maxXY[0] - stl.maxXY[1]) < maxR * 0.03 + 0.2, `${kind}: ${stl.maxXY}`);
    // visor = STL: los triángulos del archivo son los de la pieza del visor
    const part = r.geometry.parts[idx];
    assert.equal(stl.triangles, part.mesh.triangleCount, `${kind}: triángulos visor = STL`);
  }
});

// ================================================================================================ 3. EL ENCASTRE INFERIOR NO CAMBIA
test("el encastre inferior del difusor, la base y la rosca de la pantalla son idénticos con y sin la orden de lengüetas", () => {
  for (const kind of ["cylinder", "wavy", "flat", "drop", "mossglow"]) {
    const def = CAPS.applyDiffuserKind(SOLID, kind);
    const a = build(withTabs(def), kind), b = build(withoutTabs(def), kind);
    assert.deepEqual(a.indexed.base.positions, b.indexed.base.positions, `${kind}: base`);
    assert.deepEqual(a.indexed.shade.positions, b.indexed.shade.positions, `${kind}: pantalla (rosca)`);
    const z0 = validateLamp(def).layout.insert.z0;
    for (let dz = 0.5; dz <= 12.5; dz += 1) for (const cy of [0.37, 5.1]) {
      assert.deepEqual(planeCrossings(a.indexed.insert, z0 + dz, cy), planeCrossings(b.indexed.insert, z0 + dz, cy), `${kind}: encastre a z0+${dz}`);
    }
    // el tubo de la zona de encastre sigue siendo el de diffuser.stl: Ø65,135 exterior, pared 0,8
    const x = planeCrossings(a.indexed.insert, z0 + 6, 0.37);
    assert.ok(Math.abs(x[x.length - 1] - 32.5675) < 0.02 && Math.abs(x[x.length - 1] - x[0] - 0.8) < 0.02, `${kind}: tubo del encastre ${x}`);
  }
});

// ================================================================================================ 4. NO REAPARECEN
test("ni los diseños anteriores, ni los presets, ni las familias, ni las variaciones, ni los valores iniciales las reactivan", () => {
  // valores iniciales
  assert.equal(D.DEFAULT_INSERT.tabs, false);
  for (const [style, initial] of Object.entries(D.INSERT_STYLE_INITIAL)) assert.equal(initial.tabs, false, style);
  assert.equal(D.DEFAULT_LAMP.insert.tabs, false);
  assert.equal(SOLID.insert.tabs, false);
  // lectura: un código SL1 anterior con lengüetas se abre sin ellas (y el resto del diseño no cambia)
  const legacy = { ...D.DEFAULT_LAMP, insert: { ...D.DEFAULT_LAMP.insert, tabs: true } };
  const decoded = decodeLampDesign(encodeLampDesign(legacy)).def;
  assert.equal(decoded.insert.tabs, false);
  assert.deepEqual(decoded, D.normalizeLampDefinition({ ...legacy, insert: { ...legacy.insert, tabs: true } }));
  assert.equal(D.normalizeLampDefinition({ insert: { tabs: true } }).insert.tabs, false);
  assert.equal(D.normalizeLampDefinition({ insert: { tabs: "true" } }).insert.tabs, false);
  assert.deepEqual(S.mechanicalSnapshot(decoded), S.mechanicalSnapshot(legacy), "la mecánica del diseño anterior no cambia");
  // acciones: estilos, presets, familias, variaciones, restablecer, correcciones
  const all = [];
  for (const kind of KINDS) all.push(CAPS.applyDiffuserKind(SOLID, kind));
  for (const p of LAMP_PRESETS) all.push(applyLampPreset(SOLID, p));
  for (const t of ["solid", "openwork", "double"]) for (const f of ["solid", "openwork", "double"]) all.push(switchFamily(switchFamily(SOLID, f).def, t).def);
  for (const seed of [1, 7, 99]) all.push(generateLampVariation(SOLID, seed).def);
  all.push(E.resetShade(SOLID), E.resetShade(switchFamily(SOLID, "openwork").def), E.resetShade(switchFamily(SOLID, "double").def));
  for (const def of all) assert.equal(def.insert.tabs, false);
  // aunque alguien pida tabs=true en una acción que reescribe el difusor, el motor no las genera (ver el primer test)
  assert.equal(CAPS.applyDiffuserKind(withTabs(SOLID), "cylinder").insert.tabs, false);
  assert.equal(CAPS.applyDiffuserKind(withTabs(SOLID), "wavy").insert.tabs, false);
});

test("guardas de código: la generación está desactivada en el motor y la interfaz no ofrece ningún control de lengüetas", () => {
  const read = (p) => fs.readFileSync(p, "utf8");
  assert.match(read("src/lib/maker/lamps/layout.ts"), /tabs: false,/);
  assert.doesNotMatch(read("src/lib/maker/lamps/layout.ts"), /tabs: insert\.tabs/);
  assert.match(read("src/lib/maker/lamps/insert/surface.ts"), /const tabsOn = false as boolean;/);
  assert.doesNotMatch(read("src/lib/maker/lamps/validation/validateLamp.ts"), /DIFFUSER_TABS_NOT_APPLICABLE/);
  assert.match(read("src/lib/maker/lamps/defaults.ts"), /tabs: false,\n/);
  for (const f of fs.readdirSync("src/components/maker/lamps")) assert.doesNotMatch(read(`src/components/maker/lamps/${f}`), /\btabs\b|[Ll]engüeta/, f);
});
