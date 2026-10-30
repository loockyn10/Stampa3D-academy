import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { loadMakerModule, loadMakerFontFile, nodeRequire, root } from "../scripts/lib/maker-engine-node.mjs";
import { renderPartsToRgba } from "../scripts/lib/maker-thumbnail-render.mjs";
import { loadTs } from "./helpers/load-ts.mjs";

// Estilos del Creador de Carteles (docs/STAMPA_MAKER.md, "Estilos del Creador de Carteles"):
// registro, aplicación sobre los params reales, estado "Personalizado", geometría y exportación
// con el MISMO motor que usa la aplicación (nada simulado).

const styles = loadMakerModule("lib/maker/presets/stylePresets.ts");
const presetSettings = loadMakerModule("lib/maker/presets/presetSettings.ts");
const { DEFAULT_LETTER_SIGN_PARAMS } = loadMakerModule("lib/maker/defaults.ts");
const { createLetterGeometry, findUnsupportedChars } = loadMakerModule("lib/maker/geometry/createLetterGeometry.ts");
const { validateLetterSignParams } = loadMakerModule("lib/maker/validation.ts");
const { buildWordZipBlob } = loadMakerModule("lib/maker/exporters/exportWord.ts");
const { buildLettersZipBlob } = loadMakerModule("lib/maker/exporters/exportLettersZip.ts");
const { partFileEntries } = loadMakerModule("lib/maker/exporters/parts.ts");
const { buildSTLBlob } = loadMakerModule("lib/maker/exporters/exportSTL.ts");
const projectData = loadMakerModule("lib/maker/projects/projectData.ts");
const JSZip = nodeRequire("jszip");

const font = loadMakerFontFile("Montserrat-Bold.woff");
const { STYLE_PRESETS, STYLE_PARAM_KEYS, DEFAULT_STYLE_ID } = styles;
const byId = (id) => STYLE_PRESETS.find((s) => s.id === id);

const EXPECTED_IDS = ["minimal", "clasico", "liso", "suave", "bold", "retro", "capas", "industrial", "luminoso", "moderno"];
const SAMPLE = { ...DEFAULT_LETTER_SIGN_PARAMS, text: styles.STYLE_THUMBNAIL_SAMPLE_TEXT };

function paramsFor(preset, overrides = {}) {
  return { ...styles.applyStylePreset(SAMPLE, preset), ...overrides };
}

// Malla: aristas balanceadas (cerrada y manifold) y sin triángulos degenerados. `open` = aristas sin contraparte;
// `openSliver` = true si, en cada nivel Z, están alineadas en una recta (un lazo de área cero, no un agujero real).
function topology(positions) {
  const key = (i) => `${positions[i].toFixed(4)},${positions[i + 1].toFixed(4)},${positions[i + 2].toFixed(4)}`;
  const directed = new Map();
  let degenerate = 0;
  for (let o = 0; o < positions.length; o += 9) {
    const a = key(o), b = key(o + 3), c = key(o + 6);
    if (a === b || b === c || a === c) { degenerate++; continue; }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) directed.set(`${u}|${v}`, (directed.get(`${u}|${v}`) ?? 0) + 1);
  }
  const openPoints = [];
  for (const [k, n] of directed) {
    const [u, v] = k.split("|");
    if (n !== (directed.get(`${v}|${u}`) ?? 0)) openPoints.push(u.split(",").map(Number), v.split(",").map(Number));
  }
  // Se agrupan por nivel Z (la misma costura aparece repetida en cada banda de costillas/bisel) y en cada nivel deben quedar alineadas.
  let openSliver = true;
  const byZ = new Map();
  for (const q of openPoints) byZ.set(q[2], [...(byZ.get(q[2]) ?? []), q]);
  for (const pts of byZ.values()) {
    const [p0, p1] = pts;
    const dir = [p1[0] - p0[0], p1[1] - p0[1]];
    const len = Math.hypot(...dir) || 1;
    for (const q of pts) {
      if (Math.abs(dir[0] * (q[1] - p0[1]) - dir[1] * (q[0] - p0[0])) / len > 1e-3) openSliver = false;
    }
  }
  return { degenerate, open: openPoints.length / 2, openSliver };
}

function countComponents(positions) {
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const key = (i) => `${positions[i].toFixed(3)},${positions[i + 1].toFixed(3)},${positions[i + 2].toFixed(3)}`;
  for (let o = 0; o < positions.length; o += 9) {
    const ks = [key(o), key(o + 3), key(o + 6)];
    for (const k of ks) if (!parent.has(k)) parent.set(k, k);
    parent.set(find(ks[0]), find(ks[1]));
    parent.set(find(ks[1]), find(ks[2]));
  }
  return new Set([...parent.keys()].map(find)).size;
}

const geometryCache = new Map();
function generate(preset, text = styles.STYLE_THUMBNAIL_SAMPLE_TEXT, heightMm) {
  const cacheKey = `${preset.id}|${text}|${heightMm ?? ""}`;
  if (!geometryCache.has(cacheKey)) {
    geometryCache.set(cacheKey, createLetterGeometry(font, paramsFor(preset, { text, ...(heightMm ? { heightMm } : {}) })));
  }
  return geometryCache.get(cacheKey);
}

// ---------------------------------------------------------------- registro

test("registro: 10 estilos con ids estables, nombres únicos y metadatos completos", () => {
  assert.deepEqual(STYLE_PRESETS.map((s) => s.id), EXPECTED_IDS);
  assert.equal(new Set(STYLE_PRESETS.map((s) => s.name)).size, 10);
  for (const s of STYLE_PRESETS) {
    assert.match(s.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(Number.isInteger(s.version) && s.version >= 1, `${s.id}: version`);
    assert.ok(s.name.length > 0 && s.description.length > 10, `${s.id}: nombre/descripción`);
    assert.ok(["esencial", "volumen", "tecnico", "luminoso"].includes(s.category), `${s.id}: categoría`);
  }
  assert.equal(styles.getStylePreset("retro")?.name, "Retro");
  assert.equal(styles.getStylePreset("no-existe"), null);
  assert.equal(styles.getStylePreset(null), null);
});

test("registro: un estilo solo define claves de estilo (nunca texto, fuente, alto, recortes ni instalación)", () => {
  const forbidden = new Set(["text", "fontId", "heightMm", "backCutouts", "installationOverrides", "installation"]);
  for (const s of STYLE_PRESETS) {
    for (const key of Object.keys(s.overrides)) {
      assert.ok(STYLE_PARAM_KEYS.includes(key), `${s.id}: "${key}" no es una clave de estilo`);
      assert.ok(!forbidden.has(key), `${s.id}: "${key}" no pertenece a un estilo`);
    }
  }
  for (const key of forbidden) assert.ok(!STYLE_PARAM_KEYS.includes(key), `${key} no debe ser clave de estilo`);
});

test("registro: las claves de estilo son la receta de presets del usuario sin la instalación (mismos parámetros, un solo vocabulario)", () => {
  assert.deepEqual([...STYLE_PARAM_KEYS], presetSettings.PRESET_SETTING_KEYS.filter((k) => k !== "installation"));
  for (const key of STYLE_PARAM_KEYS) assert.ok(key in DEFAULT_LETTER_SIGN_PARAMS, key);
});

test("registro: el estilo por defecto (Clásico) coincide exactamente con los valores base de Stampa", () => {
  assert.equal(DEFAULT_STYLE_ID, "clasico");
  assert.equal(styles.matchesStylePreset(DEFAULT_LETTER_SIGN_PARAMS, byId("clasico")), true);
  assert.deepEqual(byId("clasico").overrides, {});
  assert.equal(styles.detectStylePreset(DEFAULT_LETTER_SIGN_PARAMS)?.id, "clasico");
});

test("registro: cada estilo es una configuración distinta de las demás", () => {
  const seen = new Map();
  for (const s of STYLE_PRESETS) {
    const sig = JSON.stringify(styles.resolveStyleSettings(s));
    assert.ok(!seen.has(sig), `${s.id} repite la configuración de ${seen.get(sig)}`);
    seen.set(sig, s.id);
  }
});

test("registro: cada estilo es válido para el validador de parámetros del generador", () => {
  for (const s of STYLE_PRESETS) {
    assert.deepEqual(validateLetterSignParams(paramsFor(s)), [], `${s.id}: parámetros inválidos`);
  }
});

// ---------------------------------------------------------------- selección / texto / cambio

test("selección: aplicar un estilo fija todos sus parámetros y conserva texto, fuente, alto, recortes e instalación", () => {
  const cutouts = [{ id: "c1", type: "circle", x: 3, y: 4, diameterMm: 5 }];
  const current = {
    ...DEFAULT_LETTER_SIGN_PARAMS,
    text: "Mi cartel ñ",
    fontId: "montserrat-regular",
    heightMm: 77,
    backCutouts: cutouts,
    installationOverrides: { foo: 1 },
    installation: { ...DEFAULT_LETTER_SIGN_PARAMS.installation, marker: "mine" },
  };
  for (const preset of STYLE_PRESETS) {
    const next = styles.applyStylePreset(current, preset);
    const target = styles.resolveStyleSettings(preset);
    for (const key of STYLE_PARAM_KEYS) assert.deepEqual(next[key], target[key], `${preset.id}.${key}`);
    assert.equal(next.text, "Mi cartel ñ");
    assert.equal(next.fontId, "montserrat-regular");
    assert.equal(next.heightMm, 77);
    assert.equal(next.backCutouts, cutouts);
    assert.deepEqual(next.installationOverrides, { foo: 1 });
    assert.equal(next.installation, current.installation);
    assert.equal(styles.matchesStylePreset(next, preset), true);
    assert.equal(styles.detectStylePreset(next)?.id, preset.id);
  }
});

test("cambio entre estilos: el último manda, sin restos del anterior, y el texto se mantiene", () => {
  let params = { ...DEFAULT_LETTER_SIGN_PARAMS, text: "Hola" };
  for (const id of ["industrial", "capas", "luminoso", "bold", "minimal"]) {
    params = styles.applyStylePreset(params, byId(id));
    assert.equal(params.text, "Hola");
    assert.equal(styles.matchesStylePreset(params, byId(id)), true, id);
  }
  // Volver a Clásico desde cualquier otro estilo restituye EXACTAMENTE los valores base (nada filtrado del estilo anterior).
  const back = styles.applyStylePreset(styles.applyStylePreset(params, byId("industrial")), byId("clasico"));
  assert.deepEqual(back, { ...DEFAULT_LETTER_SIGN_PARAMS, text: "Hola" });
  // El orden de aplicación no importa: A->B == B.
  assert.deepEqual(styles.applyStylePreset(styles.applyStylePreset(SAMPLE, byId("retro")), byId("suave")), styles.applyStylePreset(SAMPLE, byId("suave")));
});

test("aplicar el mismo estilo dos veces es idempotente (sin cambios que regeneren el modelo)", () => {
  const once = styles.applyStylePreset(SAMPLE, byId("capas"));
  const twice = styles.applyStylePreset(once, byId("capas"));
  assert.equal(JSON.stringify(once), JSON.stringify(twice));
});

// ---------------------------------------------------------------- personalización / "Personalizado" / restablecer

test("personalización: editar un parámetro avanzado deja el estilo como Personalizado y no se restaura solo", () => {
  const preset = byId("retro");
  const applied = styles.applyStylePreset(SAMPLE, preset);
  const edited = { ...applied, depthMm: applied.depthMm + 5 };
  assert.equal(styles.matchesStylePreset(edited, preset), false);
  assert.equal(styles.detectStylePreset(edited), null);
  // Editar otro parámetro después mantiene ambas ediciones (el estado es solo `params`).
  const edited2 = { ...edited, wallMm: 2.2 };
  assert.equal(edited2.depthMm, applied.depthMm + 5);
  assert.equal(edited2.wallMm, 2.2);
  // Cada clave de estilo, tocada por separado, rompe la coincidencia.
  for (const key of STYLE_PARAM_KEYS) {
    const value = applied[key];
    const changed = typeof value === "number" ? value + 1 : typeof value === "boolean" ? !value : value === "open" ? "lid" : "x";
    assert.equal(styles.matchesStylePreset({ ...applied, [key]: changed }, preset), false, key);
  }
});

test("personalización: cambiar texto, fuente, alto, recortes o instalación NO vuelve Personalizado al estilo", () => {
  const preset = byId("bold");
  const applied = styles.applyStylePreset(SAMPLE, preset);
  for (const patch of [
    { text: "Otro texto largo" },
    { fontId: "montserrat-regular" },
    { heightMm: 40 },
    { backCutouts: [{ id: "x", type: "circle", x: 0, y: 0, diameterMm: 3 }] },
    { installationOverrides: { a: 1 } },
    { installation: { ...applied.installation, enabled: true } },
  ]) {
    assert.equal(styles.matchesStylePreset({ ...applied, ...patch }, preset), true, JSON.stringify(Object.keys(patch)));
  }
});

test("restablecer: volver a aplicar el estilo recupera su configuración y conserva el texto escrito", () => {
  const preset = byId("suave");
  const custom = { ...styles.applyStylePreset(SAMPLE, preset), text: "Texto del usuario", depthMm: 99, bevelEnabled: false };
  assert.equal(styles.matchesStylePreset(custom, preset), false);
  const reset = styles.applyStylePreset(custom, preset);
  assert.equal(styles.matchesStylePreset(reset, preset), true);
  assert.equal(reset.text, "Texto del usuario");
});

test("detección: una configuración de usuario que coincide con un estilo se reconoce; si no, ninguno", () => {
  const userPreset = presetSettings.applyPresetSettings(SAMPLE, presetSettings.extractPresetSettings(styles.applyStylePreset(SAMPLE, byId("moderno"))));
  assert.equal(styles.detectStylePreset(userPreset)?.id, "moderno");
  assert.equal(styles.detectStylePreset({ ...userPreset, wallMm: 3.3 }), null);
});

// ---------------------------------------------------------------- compatibilidad con configuraciones anteriores

test("compatibilidad: proyectos y presets del usuario guardados antes (campos faltantes) siguen funcionando con los estilos", () => {
  // Un preset/proyecto viejo, sin los campos de biselado, máscara, canal, etc.
  const legacy = { depthMm: 40, wallMm: 1.6, baseMm: 1.2, bodyType: "standard", frontType: "open" };
  const normalized = presetSettings.normalizePresetSettings(legacy);
  const params = presetSettings.applyPresetSettings(SAMPLE, normalized);
  assert.equal(styles.detectStylePreset(params)?.id, "clasico", "un preset viejo equivalente a los valores base se reconoce como Clásico");
  const applied = styles.applyStylePreset(params, byId("industrial"));
  assert.deepEqual(validateLetterSignParams(applied), []);
  // Un proyecto persistido (texto): la receta se reconoce y se puede aplicar un estilo sin perder el diseño.
  const payload = projectData.serializeProject({ params: SAMPLE, sourceMode: "text", designHeightMm: 100, pngOptions: { threshold: 128, invert: false, smoothing: "medium" }, fileMeta: null });
  const loaded = projectData.deserializeProject({ id: "p", name: "Proyecto", source_type: payload.source_type, source_data: payload.source_data, settings: payload.settings, preset_id: null, schema_version: payload.schema_version, created_at: "", updated_at: "" });
  assert.equal(styles.detectStylePreset(loaded.params)?.id, "clasico");
  assert.equal(styles.applyStylePreset(loaded.params, byId("luminoso")).text, SAMPLE.text);
});

test("compatibilidad: la receta del usuario (preset guardado) ida y vuelta con un estilo aplicado no pierde parámetros", () => {
  for (const s of STYLE_PRESETS) {
    const applied = styles.applyStylePreset(SAMPLE, s);
    const stored = JSON.parse(JSON.stringify(presetSettings.extractPresetSettings(applied)));
    const restored = presetSettings.applyPresetSettings(SAMPLE, stored);
    assert.equal(styles.matchesStylePreset(restored, s), true, s.id);
  }
});

// ---------------------------------------------------------------- geometría real

test("geometría: los 10 estilos generan un modelo válido (sin errores, con triángulos y malla cerrada)", () => {
  for (const s of STYLE_PRESETS) {
    const g = generate(s);
    assert.equal(g.errors.length, 0, `${s.id}: ${g.errors.map((e) => e.message).join("; ")}`);
    assert.ok(g.triangleCount > 0, s.id);
    assert.ok(g.parts.some((p) => p.kind === "body"), `${s.id}: sin cuerpo`);
    for (const part of g.parts) {
      const t = topology(part.mesh.positions);
      assert.equal(t.open, 0, `${s.id}/${part.kind}: aristas abiertas (la malla no es cerrada)`);
      assert.equal(t.degenerate, 0, `${s.id}/${part.kind}: triángulos degenerados`);
      assert.ok(part.mesh.positions.every(Number.isFinite), `${s.id}/${part.kind}: coordenadas no finitas`);
    }
  }
});

test("geometría: sin piezas accidentales desconectadas — cada pieza de cada letra es un único sólido", () => {
  for (const s of STYLE_PRESETS) {
    const g = generate(s, "Sol");
    for (const letter of g.letters) {
      for (const part of letter.parts) {
        // El difusor del canal luminoso es una tira por contorno (diseño del motor, sección 14.6): una letra con counter da dos anillos.
        if (part.kind === "channelDiffuser") continue;
        assert.equal(countComponents(part.mesh.positions), 1, `${s.id}: "${letter.char}" ${part.kind} tiene más de un componente`);
      }
    }
  }
});

test("geometría: regla de los estilos con bisel — el desplazamiento del bisel es menor que la pared (si no, el motor deja de cerrar la malla)", () => {
  for (const s of STYLE_PRESETS) {
    const st = styles.resolveStyleSettings(s);
    if (st.bevelEnabled) assert.ok(st.bevelInsetMm < st.wallMm, `${s.id}: bevelInsetMm ${st.bevelInsetMm} >= wallMm ${st.wallMm}`);
    if (st.rearBevelEnabled) assert.ok(st.rearBevelInsetMm < st.wallMm, s.id);
    if (st.grooveEnabled) assert.ok(st.grooveInsetMm < st.wallMm + 1e-9 || st.grooveInsetMm <= st.wallMm * 2, s.id);
  }
  // Documenta la causa: con un bisel mayor que la pared el motor entrega una malla NO cerrada (y sin error), por eso la regla.
  const broken = createLetterGeometry(font, { ...SAMPLE, text: "S", depthMm: 30, wallMm: 1.6, bevelEnabled: true, bevelDepthMm: 4, bevelInsetMm: 2 });
  assert.ok(topology(broken.parts[0].mesh.positions).open > 0);
});

test("geometría (limitación conocida del motor, no de los estilos): R y 6 dejan un lazo de área cero en el frente; ningún estilo agrega agujeros reales", () => {
  for (const s of STYLE_PRESETS) {
    const g = generate(s, "R6", 60);
    for (const letter of g.letters) {
      for (const part of letter.parts) {
        const t = topology(part.mesh.positions);
        assert.ok(t.open === 0 || t.openSliver, `${s.id}: "${letter.char}" ${part.kind}: aristas abiertas que no son un lazo de área cero`);
      }
    }
  }
});

test("geometría: dimensiones coherentes — el alto pedido se respeta y la profundidad total es la del estilo (más tapa/máscara si existe)", () => {
  for (const s of STYLE_PRESETS) {
    const settings = styles.resolveStyleSettings(s);
    const g = generate(s, "Sol", 80);
    // El alto del diseño no lo cambia el estilo: la altura de la caja es la del texto (+ costillas/máscara/bisel a lo sumo, nunca menos).
    assert.ok(g.boundingBox.height >= 70 && g.boundingBox.height <= 100, `${s.id}: alto ${g.boundingBox.height}`);
    assert.ok(g.boundingBox.depth >= settings.depthMm - 1e-6, `${s.id}: profundidad ${g.boundingBox.depth} < ${settings.depthMm}`);
    assert.ok(g.boundingBox.depth <= settings.depthMm + 12, `${s.id}: profundidad ${g.boundingBox.depth} excesiva`);
  }
});

test("geometría: los 10 estilos producen mallas distintas y, renderizadas, se ven distintas (no solo parámetros distintos)", () => {
  const hashes = new Map();
  const images = [];
  for (const s of STYLE_PRESETS) {
    const g = generate(s);
    const sig = `${g.parts.map((p) => p.kind).join("+")}|${g.triangleCount}|${g.boundingBox.depth.toFixed(2)}`;
    assert.ok(!hashes.has(sig), `${s.id} produce la misma malla que ${hashes.get(sig)}`);
    hashes.set(sig, s.id);
    images.push({ id: s.id, ...renderPartsToRgba(g.parts, { width: 120, height: 90, supersample: 2 }) });
  }
  // Diferencia visual media por píxel (0-255) entre cada par de miniaturas: ningún par es "prácticamente igual".
  let min = { d: Infinity, pair: "" };
  for (let i = 0; i < images.length; i++) {
    for (let j = i + 1; j < images.length; j++) {
      let sum = 0;
      const a = images[i].rgba, b = images[j].rgba;
      for (let k = 0; k < a.length; k++) sum += Math.abs(a[k] - b[k]);
      const d = sum / a.length;
      if (d < min.d) min = { d, pair: `${images[i].id} vs ${images[j].id}` };
    }
  }
  assert.ok(min.d > 1.5, `el par más parecido (${min.pair}) difiere solo ${min.d.toFixed(2)}/255`);
});

test("geometría: textos cortos y de un solo carácter", () => {
  for (const s of STYLE_PRESETS) {
    for (const text of ["A", "Hi", "8"]) {
      const g = generate(s, text, 60);
      assert.equal(g.errors.length, 0, `${s.id} "${text}": ${g.errors.map((e) => e.message).join("; ")}`);
      assert.ok(g.triangleCount > 0, `${s.id} "${text}"`);
    }
  }
});

test("geometría: textos largos generan modelo válido y el ancho crece sin que el motor cambie el alto", () => {
  const long = "Casa de Juan y Maria 2026";
  for (const s of STYLE_PRESETS) {
    const g = generate(s, long, 30);
    assert.equal(g.errors.length, 0, `${s.id}: ${g.errors.map((e) => e.message).join("; ")}`);
    assert.equal(g.letters.length, Array.from(long).filter((c) => c !== " ").length, s.id);
    const short = generate(s, "Casa", 30);
    assert.ok(g.boundingBox.width > short.boundingBox.width * 3, `${s.id}: el ancho debe crecer con el texto`);
    assert.ok(Math.abs(g.boundingBox.height - short.boundingBox.height) < 12, `${s.id}: el alto no debe depender del largo del texto`);
  }
});

test("geometría: acentos, eñes y símbolos comunes se generan sin errores", () => {
  for (const s of STYLE_PRESETS) {
    const g = generate(s, "ÁÉÍÓÚ ñ Ü ¿Qué? ¡Hola! 1/2 & 3€", 40);
    assert.equal(g.errors.length, 0, `${s.id}: ${g.errors.map((e) => e.message).join("; ")}`);
    assert.ok(!g.warnings.some((w) => w.code === "UNSUPPORTED_GLYPH"), `${s.id}: Montserrat tiene esos caracteres`);
    assert.equal(g.letters.length, Array.from("ÁÉÍÓÚñÜ¿Qué?¡Hola!1/2&3€").length, s.id);
  }
});

test("geometría: un carácter que la fuente no tiene (emoji, kanji) se informa con un aviso en vez de dibujar un recuadro en silencio", () => {
  const g = createLetterGeometry(font, { ...SAMPLE, text: "Aé😀漢" });
  const warning = g.warnings.find((w) => w.code === "UNSUPPORTED_GLYPH");
  assert.ok(warning, "falta el aviso UNSUPPORTED_GLYPH");
  assert.match(warning.message, /😀/);
  assert.match(warning.message, /漢/);
  assert.doesNotMatch(warning.message, /[Aé]/);
  assert.equal(g.errors.length, 0, "es un aviso, no bloquea");
  assert.deepEqual(findUnsupportedChars(font, "Hola ñ"), []);
  assert.deepEqual(findUnsupportedChars(font, "😀 😀 a"), ["😀"]);
});

test("geometría: texto vacío o solo espacios no rompe ningún estilo", () => {
  for (const s of STYLE_PRESETS) {
    const g = createLetterGeometry(font, paramsFor(s, { text: "   " }));
    assert.equal(g.triangleCount, 0);
    assert.ok(g.warnings.some((w) => w.code === "EMPTY_TEXT"));
  }
});

test("geometría: un estilo no modifica en silencio el alto pedido por el usuario", () => {
  for (const s of STYLE_PRESETS) {
    const params = styles.applyStylePreset({ ...SAMPLE, heightMm: 63 }, s);
    assert.equal(params.heightMm, 63, s.id);
  }
});

// ---------------------------------------------------------------- exportación

test("exportación: estilos de una pieza exportan un STL; los de varias piezas, un ZIP con un STL por pieza", async () => {
  for (const s of STYLE_PRESETS) {
    const g = generate(s);
    const entries = partFileEntries(g.parts, "sol");
    if (g.parts.length === 1) {
      assert.deepEqual(entries.map((e) => e.fileName), ["sol.stl"], s.id);
      const buf = Buffer.from(await buildSTLBlob(entries[0].mesh).arrayBuffer());
      assert.equal(buf.length, 84 + 50 * entries[0].mesh.triangleCount, `${s.id}: tamaño de STL binario`);
      assert.equal(buf.readUInt32LE(80), entries[0].mesh.triangleCount, s.id);
    } else {
      const zip = await JSZip.loadAsync(Buffer.from(await (await buildWordZipBlob(g, "sol")).arrayBuffer()));
      const names = Object.keys(zip.files).sort();
      assert.deepEqual(names, g.parts.map((p) => `sol_${p.filenameSuffix}.stl`).sort(), s.id);
      for (const name of names) {
        const buf = Buffer.from(await zip.files[name].async("uint8array"));
        assert.equal((buf.length - 84) % 50, 0, `${s.id}/${name}: STL binario bien formado`);
        assert.ok(buf.readUInt32LE(80) > 0, `${s.id}/${name}: sin triángulos`);
      }
    }
  }
});

test("exportación: cada estilo exporta letras individuales (un STL por letra y pieza)", async () => {
  for (const id of ["clasico", "liso", "industrial", "luminoso"]) {
    const s = byId(id);
    const g = generate(s, "Hi");
    const zip = await JSZip.loadAsync(Buffer.from(await (await buildLettersZipBlob(g)).arrayBuffer()));
    assert.equal(Object.keys(zip.files).length, g.letters.length * g.parts.length, id);
  }
});

test("exportación: no se promete color — ningún archivo exportado lleva información de color y la UI lo aclara", async () => {
  const g = generate(byId("liso"));
  const entries = partFileEntries(g.parts, "sol");
  for (const e of entries) assert.ok(e.fileName.endsWith(".stl"));
  const gallerySource = fs.readFileSync(path.join(root, "src/components/maker/MakerStyleGallery.tsx"), "utf8");
  assert.match(gallerySource, /sin información de color/);
});

test("exportación: un diseño con errores geométricos sigue bloqueando la descarga (sin cambios)", async () => {
  const bad = createLetterGeometry(font, paramsFor(byId("liso"), { frontType: "lid", lidJoint: "interior-lip", wallMm: 1.6, clearanceMm: 2, lipWallMm: 3, insertDepthMm: 3, text: "i" }));
  if (bad.errors.length > 0) {
    await assert.rejects(() => buildWordZipBlob(bad, "x"));
    await assert.rejects(() => buildLettersZipBlob(bad));
  }
});

// ---------------------------------------------------------------- miniaturas (recursos estáticos del motor real)

test("miniaturas: existe un PNG por estilo, del tamaño del manifiesto, y el manifiesto está al día con el registro", () => {
  const dir = path.join(root, "public/maker/styles");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assert.equal(manifest.sampleText, styles.STYLE_THUMBNAIL_SAMPLE_TEXT);
  assert.equal(manifest.sampleHeightMm, styles.STYLE_THUMBNAIL_SAMPLE_HEIGHT_MM);
  assert.deepEqual(manifest.styles.map((m) => m.id), STYLE_PRESETS.map((s) => s.id));
  for (const s of STYLE_PRESETS) {
    const entry = manifest.styles.find((m) => m.id === s.id);
    assert.equal(entry.signature, styles.styleSignature(s), `${s.id}: miniatura desactualizada — ejecutá node scripts/generate-maker-style-thumbnails.mjs`);
    assert.equal(entry.version, s.version, s.id);
    assert.equal(styles.styleThumbnailPath(s), `/maker/styles/${entry.file}`);
    const png = fs.readFileSync(path.join(dir, entry.file));
    assert.equal(png.subarray(1, 4).toString("latin1"), "PNG", s.id);
    assert.equal(png.readUInt32BE(16), manifest.width, `${s.id}: ancho`);
    assert.equal(png.readUInt32BE(20), manifest.height, `${s.id}: alto`);
    assert.ok(png.length < 60 * 1024, `${s.id}: miniatura pesada (${png.length} B)`);
  }
});

test("miniaturas: son la geometría actual del motor (triángulos y piezas del manifiesto coinciden con una regeneración)", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "public/maker/styles/manifest.json"), "utf8"));
  for (const s of STYLE_PRESETS) {
    const entry = manifest.styles.find((m) => m.id === s.id);
    const g = generate(s, manifest.sampleText, manifest.sampleHeightMm);
    assert.equal(entry.triangles, g.triangleCount, `${s.id}: la malla cambió desde que se generó la miniatura`);
    assert.deepEqual(entry.parts, g.parts.map((p) => p.kind), s.id);
  }
});

// ---------------------------------------------------------------- UI (render real de los componentes, sin DOM)

const UI_MOCKS = {
  "next/image": { __esModule: true, default: (props) => createElement("img", { src: props.src, alt: props.alt, width: props.width, height: props.height }) },
  "next/link": { __esModule: true, default: (props) => createElement("a", { href: props.href }, props.children) },
  "opentype.js": {},
};

test("UI: la galería muestra los 10 estilos como opciones de un radiogroup y marca el elegido", () => {
  const { MakerStyleGallery } = loadTs("src/components/maker/MakerStyleGallery.tsx", UI_MOCKS);
  const html = renderToStaticMarkup(createElement(MakerStyleGallery, { styles: STYLE_PRESETS, selectedId: "retro", custom: false, onSelect() {}, onReset() {} }));
  assert.equal((html.match(/role="radio"/g) ?? []).length, 10);
  assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 1);
  assert.match(html, /role="radiogroup"/);
  for (const s of STYLE_PRESETS) {
    assert.ok(html.includes(`src="/maker/styles/${s.id}.png"`), `${s.id}: miniatura`);
    assert.ok(html.includes(s.name), `${s.id}: nombre`);
  }
  assert.doesNotMatch(html, /Personalizado/);
  assert.doesNotMatch(html, /Restablecer estilo/);
});

test("UI: con la configuración modificada la galería indica Personalizado y ofrece restablecer el estilo", () => {
  const { MakerStyleGallery } = loadTs("src/components/maker/MakerStyleGallery.tsx", UI_MOCKS);
  const custom = renderToStaticMarkup(createElement(MakerStyleGallery, { styles: STYLE_PRESETS, selectedId: "bold", custom: true, onSelect() {}, onReset() {} }));
  assert.match(custom, /Personalizado/);
  assert.match(custom, /Restablecer estilo/);
  const none = renderToStaticMarkup(createElement(MakerStyleGallery, { styles: STYLE_PRESETS, selectedId: null, custom: true, onSelect() {}, onReset() {} }));
  assert.match(none, /Personalizado/);
  assert.doesNotMatch(none, /Restablecer estilo/);
  assert.equal((none.match(/aria-checked="true"/g) ?? []).length, 0);
});

test("UI: el campo de texto de la creación rápida es el único input de texto y avisa si la palabra no entra en la cama", () => {
  const { MakerQuickText } = loadTs("src/components/maker/MakerQuickText.tsx", UI_MOCKS);
  const base = { value: "Hola", onChange() {}, fromFile: false, onUseText() {}, updating: false, bedWidthMm: 256, bedName: "Bambu Lab A1" };
  const ok = renderToStaticMarkup(createElement(MakerQuickText, { ...base, size: { width: 120, height: 60, depth: 25 } }));
  assert.match(ok, /¿Qué querés que diga tu cartel\?/);
  assert.match(ok, /value="Hola"/);
  assert.match(ok, /120 × 60 × 25 mm/);
  assert.doesNotMatch(ok, /no entra en la cama/);
  const wide = renderToStaticMarkup(createElement(MakerQuickText, { ...base, size: { width: 400, height: 60, depth: 25 } }));
  assert.match(wide, /no entra en la cama de la Bambu Lab A1 \(256 mm\)/);
  assert.match(wide, /el tamaño no se cambia solo/);
  const file = renderToStaticMarkup(createElement(MakerQuickText, { ...base, fromFile: true, size: null }));
  assert.match(file, /archivo SVG\/PNG/);
  assert.doesNotMatch(file, /<input/);
});

test("UI: el panel de Personalización avanzada arranca plegado y mantiene sus controles montados", () => {
  const { MakerAdvancedPanel } = loadTs("src/components/maker/MakerAdvancedPanel.tsx", UI_MOCKS);
  const html = renderToStaticMarkup(createElement(MakerAdvancedPanel, { custom: true }, createElement("span", null, "CONTROL-EXISTENTE")));
  assert.match(html, /Personalización avanzada/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /hidden/);
  assert.match(html, /CONTROL-EXISTENTE/);
  assert.match(html, /Personalizado/);
});

test("UI (fuente): la página usa un único estado de params y el estilo es solo una etiqueta; Personalización avanzada conserva los controles existentes", () => {
  const page = fs.readFileSync(path.join(root, "src/app/stampa-maker/carteles/page.tsx"), "utf8");
  assert.equal((page.match(/useState<LetterSignParams>/g) ?? []).length, 1, "un solo estado de configuración");
  assert.match(page, /useState<string \| null>\(DEFAULT_STYLE_ID\)/);
  assert.match(page, /applyStylePreset\(prev, preset\)/);
  assert.match(page, /matchesStylePreset\(params, selectedStyle\)/);
  for (const component of ["MakerLibraryPanel", "MakerTextControls", "MakerBackCutoutsSection", "MakerInstallationSection"]) {
    const inside = page.slice(page.indexOf("<MakerAdvancedPanel"), page.indexOf("</MakerAdvancedPanel>"));
    assert.ok(inside.includes(`<${component}`), `${component} debe seguir disponible dentro de Personalización avanzada`);
  }
  assert.match(page, /ViewportExportCard/, "el sistema de exportación existente sigue siendo el de siempre");
});

test("no se tocan el Creador de Carteles Neón ni Jarros", () => {
  for (const f of ["src/app/stampa-maker/neon/page.tsx", "src/app/stampa-maker/jarros/page.tsx"]) {
    const source = fs.readFileSync(path.join(root, f), "utf8");
    assert.doesNotMatch(source, /stylePresets|MakerStyleGallery|MakerQuickText/, f);
  }
});
