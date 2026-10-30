import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadMakerModule, loadMakerFontFile } from "../scripts/lib/maker-engine-node.mjs";
import { bounds, sampleHeights, sectionIntervals, topology } from "./helpers/maker-mesh.mjs";

// Material (PLA / PETG) + resistencia (Ligero / Normal / Reforzado) del Creador de Carteles.
//
// Lógica pura (tabla, selección, "Personalizado", presets, proyectos anteriores) + geometría real: se corta la MALLA
// generada (la del visor y el STL) con planos horizontales y se mide el espesor de la pared. Son tests de geometría;
// NO sustituyen una validación de laminado en Bambu Studio (la cantidad de perímetros la decide el laminador).

const { createLetterGeometry } = loadMakerModule("lib/maker/geometry/createLetterGeometry.ts");
const { DEFAULT_LETTER_SIGN_PARAMS } = loadMakerModule("lib/maker/defaults.ts");
const ws = loadMakerModule("lib/maker/wallStrength.ts");
const styles = loadMakerModule("lib/maker/presets/stylePresets.ts");
const presetSettings = loadMakerModule("lib/maker/presets/presetSettings.ts");
const projects = loadMakerModule("lib/maker/projects/projectData.ts");
const { buildSTLBlob } = loadMakerModule("lib/maker/exporters/exportSTL.ts");
const { validateLetterSignParams } = loadMakerModule("lib/maker/validation.ts");

const bold = loadMakerFontFile("Montserrat-Bold.woff");
const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const BASE = { ...DEFAULT_LETTER_SIGN_PARAMS, fontId: "montserrat-bold", heightMm: 100, depthMm: 40, baseMm: 1.2 };
const generate = (overrides) => createLetterGeometry(bold, { ...BASE, ...overrides });
const bodyOf = (result) => result.parts.find((p) => p.kind === "body").mesh.positions;

/** Los seis perfiles pedidos, en el orden de la tabla. */
const TABLE = [
  { material: "petg", strength: "light", wallMm: 0.9 },
  { material: "petg", strength: "normal", wallMm: 1.35 },
  { material: "petg", strength: "reinforced", wallMm: 1.8 },
  { material: "pla", strength: "light", wallMm: 1.35 },
  { material: "pla", strength: "normal", wallMm: 1.8 },
  { material: "pla", strength: "reinforced", wallMm: 2.25 },
];
const WALLS = [0.9, 1.35, 1.8, 2.25];

/**
 * Malla cerrada y manifold. `allowDegenerate`: el motor deja a veces un triángulo de área cero (colapsado a 4 decimales) que no
 * participa de ninguna arista —la malla sigue cerrada sin él y los laminadores lo descartan—; hoy aparece con "OB" a 0,9 mm.
 */
function assertClosed(positions, label, { allowDegenerate = 0 } = {}) {
  const t = topology(positions);
  assert.equal(t.open, 0, `${label}: aristas abiertas`);
  assert.equal(t.nonManifold, 0, `${label}: aristas no-manifold`);
  assert.ok(t.degenerate <= allowDegenerate, `${label}: triángulos degenerados (${t.degenerate})`);
}

/** Lo que hace la interfaz: elegir material y después resistencia sobre los params actuales. */
const pick = (params, material, strength) => ws.applyWallStrength(ws.applyMaterial(params, material), strength);

// ---------------------------------------------------------------- tabla, defaults y selección

test("tabla: los seis perfiles producen exactamente el espesor pedido", () => {
  for (const { material, strength, wallMm } of TABLE) {
    assert.equal(ws.wallMmFor(material, strength), wallMm, `${material}/${strength}`);
    const params = pick(DEFAULT_LETTER_SIGN_PARAMS, material, strength);
    assert.equal(params.material, material);
    assert.equal(params.wallMm, wallMm);
    assert.equal(ws.detectWallStrength(params.material, params.wallMm), strength, "la resistencia deducida coincide con la elegida");
    assert.deepEqual(validateLetterSignParams(params), []);
  }
  assert.deepEqual(ws.WALL_PROFILES, { petg: { light: 0.9, normal: 1.35, reinforced: 1.8 }, pla: { light: 1.35, normal: 1.8, reinforced: 2.25 } });
  assert.deepEqual(ws.MATERIAL_OPTIONS.map((o) => o.label), ["PLA", "PETG"]);
  assert.deepEqual(ws.WALL_STRENGTH_OPTIONS.map((o) => o.label), ["Ligero", "Normal", "Reforzado"]);
});

test("defaults: proyectos nuevos arrancan en PETG + Normal = 1,35 mm", () => {
  assert.equal(DEFAULT_LETTER_SIGN_PARAMS.material, "petg");
  assert.equal(DEFAULT_LETTER_SIGN_PARAMS.wallMm, 1.35);
  assert.equal(ws.DEFAULT_WALL_MM, 1.35);
  assert.equal(ws.detectWallStrength(DEFAULT_LETTER_SIGN_PARAMS.material, DEFAULT_LETTER_SIGN_PARAMS.wallMm), "normal");
  assert.equal(presetSettings.resolveInitialParams(null).wallMm, 1.35);
  assert.equal(presetSettings.resolveInitialParams(null).material, "petg");
});

test("cambio de material: conserva el nivel de resistencia y cambia el espesor", () => {
  const petgNormal = DEFAULT_LETTER_SIGN_PARAMS;
  const plaNormal = ws.applyMaterial(petgNormal, "pla");
  assert.equal(plaNormal.material, "pla");
  assert.equal(plaNormal.wallMm, 1.8, "PETG Normal -> PLA Normal");
  assert.equal(ws.applyMaterial(plaNormal, "petg").wallMm, 1.35, "ida y vuelta");
  assert.deepEqual(ws.applyMaterial(plaNormal, "petg"), petgNormal);
  for (const { strength } of TABLE.slice(0, 3)) {
    const petg = pick(DEFAULT_LETTER_SIGN_PARAMS, "petg", strength);
    const pla = ws.applyMaterial(petg, "pla");
    assert.equal(ws.detectWallStrength("pla", pla.wallMm), strength, `${strength}: el nivel se conserva al pasar a PLA`);
    assert.equal(ws.detectWallStrength("petg", ws.applyMaterial(pla, "petg").wallMm), strength);
  }
  assert.equal(ws.applyMaterial(petgNormal, "petg"), petgNormal, "elegir el material ya activo no cambia nada (sin regenerar)");
});

test("cambio de resistencia: respeta el material y no toca nada más", () => {
  const start = { ...DEFAULT_LETTER_SIGN_PARAMS, text: "Mi cartel", heightMm: 61, depthMm: 33, bevelEnabled: true };
  for (const material of ["pla", "petg"]) {
    for (const strength of ["light", "normal", "reinforced"]) {
      const next = ws.applyWallStrength({ ...start, material }, strength);
      assert.equal(next.material, material);
      assert.equal(next.wallMm, ws.WALL_PROFILES[material][strength]);
      const { wallMm: _w, ...rest } = next;
      const { wallMm: _s, ...expected } = { ...start, material };
      assert.deepEqual(rest, expected);
    }
  }
});

test("valores compartidos: el material es una selección explícita y nunca se deduce del espesor", () => {
  // PETG Normal y PLA Ligero son ambos 1,35 mm, pero son estados distintos y no se pisan.
  const petgNormal = pick(DEFAULT_LETTER_SIGN_PARAMS, "petg", "normal");
  const plaLight = pick(DEFAULT_LETTER_SIGN_PARAMS, "pla", "light");
  assert.equal(petgNormal.wallMm, plaLight.wallMm);
  assert.equal(petgNormal.material, "petg");
  assert.equal(plaLight.material, "pla");
  assert.equal(ws.detectWallStrength(petgNormal.material, petgNormal.wallMm), "normal");
  assert.equal(ws.detectWallStrength(plaLight.material, plaLight.wallMm), "light");
  // Elegir PLA Ligero desde PETG Normal no devuelve el material a PETG (sólo hay un wallMm igual).
  assert.equal(ws.applyWallStrength(ws.applyMaterial(petgNormal, "pla"), "light").material, "pla");
  // Lo mismo con 1,8 mm (PETG Reforzado = PLA Normal) y 1,35 desde PLA.
  assert.equal(ws.detectWallStrength("petg", 1.8), "reinforced");
  assert.equal(ws.detectWallStrength("pla", 1.8), "normal");
  assert.equal(ws.applyMaterial(plaLight, "petg").wallMm, 0.9, "PLA Ligero -> PETG Ligero, no PETG Normal");
});

test("Personalizado: un espesor manual no se fuerza de nuevo, se respeta al cambiar de material y se reemplaza al elegir otra resistencia", () => {
  const manual = { ...DEFAULT_LETTER_SIGN_PARAMS, wallMm: 1.5 };
  assert.equal(ws.detectWallStrength(manual.material, manual.wallMm), null);
  assert.equal(ws.strengthLabel(null), "Personalizado");
  const pla = ws.applyMaterial(manual, "pla");
  assert.equal(pla.material, "pla");
  assert.equal(pla.wallMm, 1.5, "el material cambia pero el espesor propio se conserva");
  assert.equal(ws.detectWallStrength(pla.material, pla.wallMm), null);
  assert.equal(ws.applyWallStrength(pla, "reinforced").wallMm, 2.25, "elegir un nivel aplica el valor del perfil");
  // Un espesor manual que coincide con un perfil pasa a ser ese perfil (estado derivado, sin contradicciones).
  assert.equal(ws.detectWallStrength("petg", 1.8), "reinforced");
  // Aproximación de líneas de extrusión: sólo orientativa.
  assert.deepEqual([0.9, 1.35, 1.8, 2.25, 1.5].map(ws.approxExtrusionLines), [2, 3, 4, 5, 3]);
});

// ---------------------------------------------------------------- presets visuales

test("presets visuales: material y resistencia no son claves de estilo y ningún estilo puede definirlos", () => {
  for (const key of ["material", "wallMm"]) {
    assert.ok(!styles.STYLE_PARAM_KEYS.includes(key), `${key} no es clave de estilo`);
    assert.ok(presetSettings.PRESET_SETTING_KEYS.includes(key), `${key} sí es receta de fabricación`);
  }
  for (const s of styles.STYLE_PRESETS) {
    assert.ok(!("wallMm" in s.overrides) && !("material" in s.overrides), `${s.id}: no debe definir material ni pared`);
    assert.ok(!("wallMm" in styles.resolveStyleSettings(s)) && !("material" in styles.resolveStyleSettings(s)));
  }
});

test("presets visuales: elegir un estilo conserva texto, material, resistencia y espesor (incluidos los estilos que antes forzaban la pared)", () => {
  for (const { material, strength, wallMm } of TABLE) {
    const current = { ...pick(DEFAULT_LETTER_SIGN_PARAMS, material, strength), text: "Mi cartel", heightMm: 77 };
    for (const style of styles.STYLE_PRESETS) {
      const next = styles.applyStylePreset(current, style);
      assert.equal(next.material, material, `${style.id}: material`);
      assert.equal(next.wallMm, wallMm, `${style.id}: espesor`);
      assert.equal(ws.detectWallStrength(next.material, next.wallMm), strength, `${style.id}: resistencia`);
      assert.equal(next.text, "Mi cartel");
      assert.equal(styles.matchesStylePreset(next, style), true);
    }
  }
  // Un espesor propio tampoco se pierde.
  const custom = { ...DEFAULT_LETTER_SIGN_PARAMS, material: "pla", wallMm: 1.5 };
  for (const id of ["bold", "industrial", "clasico"]) {
    const next = styles.applyStylePreset(custom, styles.getStylePreset(id));
    assert.equal(next.wallMm, 1.5, id);
    assert.equal(next.material, "pla", id);
  }
});

test("presets visuales: cambiar material o resistencia no saca al cartel de su estilo", () => {
  for (const style of styles.STYLE_PRESETS) {
    const applied = styles.applyStylePreset(DEFAULT_LETTER_SIGN_PARAMS, style);
    for (const { material, strength } of TABLE) assert.equal(styles.matchesStylePreset(pick(applied, material, strength), style), true, `${style.id}/${material}/${strength}`);
  }
});

// ---------------------------------------------------------------- compatibilidad: proyectos y presets guardados

const row = (settings, extra = {}) => ({ id: "p", name: "Proyecto", source_type: "text", source_data: { text: "HOLA" }, settings, preset_id: null, schema_version: 1, created_at: "", updated_at: "", ...extra });

test("proyectos anteriores (sin material): conservan su espesor original, usan PETG como valor de compatibilidad y se muestran Personalizado si no coinciden con un perfil", () => {
  for (const wallMm of [1.2, 1.6, 2.4, 3.1]) {
    const loaded = projects.deserializeProject(row({ depthMm: 33, wallMm }));
    assert.equal(loaded.params.wallMm, wallMm, `${wallMm}: el espesor no se migra`);
    assert.equal(loaded.params.material, "petg", "valor de compatibilidad documentado");
    assert.equal(ws.detectWallStrength(loaded.params.material, loaded.params.wallMm), null, `${wallMm}: Personalizado`);
    assert.equal(loaded.params.depthMm, 33);
  }
  // Un proyecto anterior cuyo espesor casualmente coincide con un perfil de PETG se ve como ese perfil, sin cambiarlo.
  const match = projects.deserializeProject(row({ wallMm: 1.8 }));
  assert.equal(match.params.wallMm, 1.8);
  assert.equal(ws.detectWallStrength(match.params.material, match.params.wallMm), "reinforced");
});

test("proyectos anteriores: ida y vuelta (guardar y reabrir) no altera el espesor ni agrega migraciones", () => {
  const legacy = projects.deserializeProject(row({ wallMm: 1.2 })).params;
  const payload = projects.serializeProject({ params: legacy, sourceMode: "text", designHeightMm: 100, pngOptions: { threshold: 128, invert: false, smoothing: "medium" }, fileMeta: null });
  assert.equal(payload.settings.wallMm, 1.2);
  const again = projects.deserializeProject(row(payload.settings, { source_data: payload.source_data }));
  assert.equal(again.params.wallMm, 1.2);
  assert.equal(payload.schema_version, projects.PROJECT_SCHEMA_VERSION, "sin migración de esquema SQL ni de JSON");
});

test("proyectos nuevos: el material viaja en la receta y se restaura; un material inválido cae al valor de compatibilidad", () => {
  const params = pick({ ...DEFAULT_LETTER_SIGN_PARAMS, text: "Nuevo" }, "pla", "reinforced");
  const payload = projects.serializeProject({ params, sourceMode: "text", designHeightMm: 100, pngOptions: { threshold: 128, invert: false, smoothing: "medium" }, fileMeta: null });
  assert.equal(payload.settings.material, "pla");
  assert.equal(payload.settings.wallMm, 2.25);
  const back = projects.deserializeProject(row(JSON.parse(JSON.stringify(payload.settings)), { source_data: payload.source_data })).params;
  assert.equal(back.material, "pla");
  assert.equal(back.wallMm, 2.25);
  assert.equal(projects.deserializeProject(row({ wallMm: 1.35, material: "abs" })).params.material, "petg");
  assert.equal(projects.deserializeProject(row({ wallMm: 1.35, material: 7 })).params.material, "petg");
});

test("presets guardados del usuario: sin material se leen como PETG sin tocar el espesor; con material lo conservan", () => {
  const legacy = presetSettings.normalizePresetSettings({ depthMm: 40, wallMm: 1.6, frontType: "open" });
  assert.equal(legacy.wallMm, 1.6);
  assert.equal(legacy.material, "petg");
  const stored = JSON.parse(JSON.stringify(presetSettings.extractPresetSettings(pick(DEFAULT_LETTER_SIGN_PARAMS, "pla", "light"))));
  const restored = presetSettings.applyPresetSettings(DEFAULT_LETTER_SIGN_PARAMS, stored);
  assert.equal(restored.material, "pla");
  assert.equal(restored.wallMm, 1.35);
  assert.equal(presetSettings.isPresetModified(pick(DEFAULT_LETTER_SIGN_PARAMS, "pla", "light"), stored), false);
  assert.equal(presetSettings.isPresetModified(ws.applyMaterial(pick(DEFAULT_LETTER_SIGN_PARAMS, "pla", "light"), "petg"), stored), true);
});

// ---------------------------------------------------------------- geometría real: espesores medidos sobre la malla

test("los seis perfiles (material + resistencia armados como lo hace la interfaz) miden su espesor real en paredes verticales", () => {
  for (const { material, strength, wallMm } of TABLE) {
    const params = pick({ ...BASE }, material, strength);
    const result = createLetterGeometry(bold, { ...params, text: "O" });
    assert.equal(result.errors.length, 0, `${material}/${strength}`);
    const body = bodyOf(result);
    const b = bounds(body);
    const y0 = (b.minY + b.maxY) / 2;
    for (const z of sampleHeights(BASE.baseMm + 0.3, BASE.depthMm - 0.3, 8)) {
      const intervals = sectionIntervals(body, z, y0);
      assert.ok(intervals.length >= 2, `${material}/${strength} z=${z.toFixed(2)}: se esperaban al menos dos paredes`);
      for (const [x0, x1] of intervals) assert.ok(Math.abs(x1 - x0 - wallMm) < 2e-3, `${material}/${strength} z=${z.toFixed(2)}: pared ${(x1 - x0).toFixed(3)} mm`);
    }
    assertClosed(body, `${material}/${strength}`);
  }
});

test("zona del bisel: con cada espesor la pared conserva su valor y sube a lo sumo un escalón de la aproximación", () => {
  const bevel = { bevelEnabled: true, bevelDepthMm: 6, bevelInsetMm: 2.4 };
  const maxOvershoot = (2.4 / 6) * 0.2 + 0.02;
  for (const wallMm of WALLS) {
    const result = generate({ text: "I", wallMm, ...bevel });
    assert.equal(result.errors.length, 0);
    assert.ok(!result.warnings.some((w) => w.code === "BEVEL_CLAMPED"), `${wallMm}: el bisel entra sin ajuste`);
    const body = bodyOf(result);
    const b = bounds(body);
    const y0 = (b.minY + b.maxY) / 2;
    for (const z of sampleHeights(BASE.depthMm - bevel.bevelDepthMm + 0.05, BASE.depthMm - 0.05, 12)) {
      const intervals = sectionIntervals(body, z, y0);
      assert.equal(intervals.length, 2, `${wallMm} z=${z.toFixed(2)}`);
      for (const [x0, x1] of intervals) {
        const width = x1 - x0;
        assert.ok(width >= wallMm - 2e-3 && width <= wallMm + maxOvershoot, `${wallMm} z=${z.toFixed(2)}: pared ${width.toFixed(3)} mm en el bisel`);
      }
    }
    assert.deepEqual(topology(body), { degenerate: 0, open: 0, nonManifold: 0 }, `${wallMm}: malla cerrada con bisel`);
  }
});

test("tapas encastrables y planas: sin errores, mallas cerradas y holgura del labio respetada con cada espesor", () => {
  for (const wallMm of WALLS) {
    for (const bevel of [{}, { bevelEnabled: true, bevelDepthMm: 6, bevelInsetMm: 2.4 }]) {
      const joint = generate({ text: "O", wallMm, frontType: "lid", lidJoint: "interior-lip", insertDepthMm: 3, clearanceMm: 0.2, lipWallMm: 0.8, lidMm: 1.2, ...bevel });
      assert.equal(joint.errors.length, 0, `${wallMm}: ${joint.errors.map((e) => e.message).join("; ")}`);
      const lid = joint.parts.find((p) => p.kind === "lid").mesh.positions;
      const body = bodyOf(joint);
      for (const part of joint.parts) assert.deepEqual(topology(part.mesh.positions), { degenerate: 0, open: 0, nonManifold: 0 }, `${wallMm}/${part.kind}`);
      const y0 = (bounds(body).minY + bounds(body).maxY) / 2;
      for (const z of [38.1, 38.8, 39.9]) {
        const lipIv = sectionIntervals(lid, z, y0);
        assert.ok(lipIv.length >= 2, `${wallMm} z=${z}: el labio existe`);
        const bodyIv = sectionIntervals(body, z, y0);
        for (const [l0, l1] of lipIv) {
          for (const [b0, b1] of bodyIv) assert.ok(Math.min(l1, b1) - Math.max(l0, b0) <= 1e-3, `${wallMm} z=${z}: el labio pisa la pared`);
          const gap = Math.min(...bodyIv.map(([b0, b1]) => (l1 <= b0 ? b0 - l1 : l0 >= b1 ? l0 - b1 : -1)));
          assert.ok(gap >= 0.2 - 2e-3, `${wallMm} z=${z}: holgura ${gap.toFixed(3)} mm`);
        }
      }
      const flat = generate({ text: "OB", wallMm, frontType: "lid", lidJoint: "glue", ...bevel });
      assert.equal(flat.errors.length, 0);
      for (const part of flat.parts) assertClosed(part.mesh.positions, `${wallMm}/plana/${part.kind}`, { allowDegenerate: 2 });
    }
  }
});

test("letras con agujeros internos, estrechas y textos largos: modelo válido con el espesor mínimo y el máximo", () => {
  for (const wallMm of [0.9, 2.25]) {
    for (const text of ["B", "8", "A", "i", "MI CASA LINDA 3D"]) {
      const result = generate({ text, wallMm, heightMm: text.length > 4 ? 40 : 100 });
      assert.equal(result.errors.length, 0, `${text}/${wallMm}`);
      assert.ok(result.triangleCount > 0);
      assert.ok(!result.warnings.some((w) => w.code === "WALL_TOO_THICK"), `${text}/${wallMm}: la pared entra en los trazos`);
      assertClosed(bodyOf(result), `${text}/${wallMm}`, { allowDegenerate: 2 });
    }
  }
});

test("trazo que no admite el espesor: se conserva el comportamiento seguro (trazo macizo) y la advertencia con el espesor elegido", () => {
  const probe = bounds(bodyOf(generate({ text: "I", heightMm: 18 })));
  const stem = probe.maxX - probe.minX;
  const y0 = (probe.minY + probe.maxY) / 2;
  assert.ok(stem > 1.8 && stem < 4.5, `tronco de ${stem.toFixed(2)} mm fuera del rango del test`);
  for (const wallMm of WALLS) {
    const result = generate({ text: "I", heightMm: 18, wallMm });
    assert.equal(result.errors.length, 0);
    const warning = result.warnings.find((w) => w.code === "WALL_TOO_THICK");
    const hollow = sectionIntervals(bodyOf(result), 20, y0).length === 2;
    if (stem >= 2 * wallMm) {
      assert.ok(!warning && hollow, `${wallMm}: entra, queda hueca y sin aviso`);
    } else {
      assert.ok(warning, `${wallMm}: debe advertir`);
      assert.match(warning.message, new RegExp(String(wallMm).replace(".", "\\.") + " mm"));
      assert.ok(!hollow, `${wallMm}: el trazo queda macizo, sin hueco artificial`);
    }
    assertClosed(bodyOf(result), `I ${wallMm}`);
  }
});

// ---------------------------------------------------------------- exportación y rendimiento

async function readStl(blob) {
  const buf = Buffer.from(await blob.arrayBuffer());
  const count = buf.readUInt32LE(80);
  const positions = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    const o = 84 + t * 50;
    for (let v = 0; v < 3; v++) for (let c = 0; c < 3; c++) positions[t * 9 + v * 3 + c] = buf.readFloatLE(o + 12 + v * 12 + c * 4);
  }
  return { count, positions };
}

test("exportación STL: cada pieza exportada es exactamente la malla del visor, con cada perfil", async () => {
  for (const { material, strength } of TABLE) {
    const params = pick({ ...BASE }, material, strength);
    const result = createLetterGeometry(bold, { ...params, text: "Hi", bevelEnabled: true, bevelDepthMm: 6, bevelInsetMm: 2.4, frontType: "lid", lidJoint: "interior-lip" });
    assert.equal(result.errors.length, 0, `${material}/${strength}`);
    for (const part of result.parts) {
      const stl = await readStl(buildSTLBlob(part.mesh));
      assert.equal(stl.count, part.mesh.triangleCount, `${material}/${strength}/${part.kind}`);
      for (let i = 0; i < part.mesh.positions.length; i++) assert.ok(Math.abs(stl.positions[i] - part.mesh.positions[i]) < 1e-5);
    }
  }
});

test("el material no cambia la geometría: mismo espesor, misma malla (y el hook no regenera por cambiar sólo el material)", () => {
  const a = createLetterGeometry(bold, { ...BASE, text: "Hi", wallMm: 1.35, material: "petg" });
  const b = createLetterGeometry(bold, { ...BASE, text: "Hi", wallMm: 1.35, material: "pla" });
  assert.equal(a.triangleCount, b.triangleCount);
  for (const [i, part] of a.parts.entries()) assert.deepEqual(Array.from(part.mesh.positions), Array.from(b.parts[i].mesh.positions));
  assert.match(read("src/hooks/maker/useLetterGeometry.ts"), /JSON\.stringify\(\{ \.\.\.params, material: undefined \}\)/);
  // El espesor no multiplica los triángulos: un perfil más grueso no explota la malla.
  const thin = generate({ text: "STAMPA", wallMm: 0.9 });
  const thick = generate({ text: "STAMPA", wallMm: 2.25 });
  assert.ok(thick.triangleCount < thin.triangleCount * 1.5, `${thin.triangleCount} vs ${thick.triangleCount}`);
});

// ---------------------------------------------------------------- integración en la página

test("página: los selectores controlan params.material y params.wallMm (no hay otro estado de espesor)", () => {
  const page = read("src/app/stampa-maker/carteles/page.tsx");
  assert.match(page, /applyMaterial\(prev, material\)/);
  assert.match(page, /applyWallStrength\(prev, strength\)/);
  assert.match(page, /<MakerStrengthSelector material=\{params\.material\} wallMm=\{params\.wallMm\}/);
  assert.doesNotMatch(page, /useState<[^>]*(Material|Strength|Resistance)/, "material y resistencia no tienen un estado paralelo a params");
  assert.match(read("src/components/maker/MakerTextControls.tsx"), /value=\{params\.wallMm\}[\s\S]*onChange=\{\(v\) => onChange\(\{ wallMm: v \}\)\}/, "el campo Pared avanzado se conserva");
});
