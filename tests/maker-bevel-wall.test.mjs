import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { loadMakerModule, loadMakerFontFile } from "../scripts/lib/maker-engine-node.mjs";
import { loadTs } from "./helpers/load-ts.mjs";

// Bisel superior + resistencia de pared (material PLA/PETG x Ligero/Normal/Reforzado) del Creador de Carteles.
//
// Estos tests miden la MALLA GENERADA (la misma que ve el visor y exporta el STL): cortan el sólido con planos
// horizontales a distintas alturas y miden el espesor horizontal de la pared. Son tests de geometría; NO sustituyen
// una validación real de laminado (cantidad de perímetros depende del ancho de línea del slicer, ver informe).

const { createLetterGeometry } = loadMakerModule("lib/maker/geometry/createLetterGeometry.ts");
const { DEFAULT_LETTER_SIGN_PARAMS } = loadMakerModule("lib/maker/defaults.ts");
const { buildSTLBlob } = loadMakerModule("lib/maker/exporters/exportSTL.ts");
const { partFileEntries } = loadMakerModule("lib/maker/exporters/parts.ts");
const { firstTopologyEventMm, minStrokeHalfWidthMm } = loadMakerModule("lib/maker/geometry/strokeLimits.ts");
const { resolveInwardModifiers, computeInwardBands } = loadMakerModule("lib/maker/geometry/body/cavity.ts");
const { textToPerCharacterPaths, flattenOpentypePath } = loadMakerModule("lib/maker/geometry/textToPaths.ts");
const { buildContourHierarchy } = loadMakerModule("lib/maker/geometry/contourHierarchy.ts");
const { applyWallStrength, detectWallStrength, WALL_PROFILES, DEFAULT_WALL_MM } = loadMakerModule("lib/maker/wallStrength.ts");

// Los seis perfiles (material, resistencia, espesor) y los cuatro espesores distintos que generan (PETG Normal y PLA Ligero comparten 1,35 mm).
const PROFILES = Object.entries(WALL_PROFILES).flatMap(([material, byStrength]) => Object.entries(byStrength).map(([strength, wallMm]) => ({ material, strength, wallMm })));
const WALLS = [...new Set(PROFILES.map((p) => p.wallMm))].sort((a, b) => a - b);
const styles = loadMakerModule("lib/maker/presets/stylePresets.ts");
const presetSettings = loadMakerModule("lib/maker/presets/presetSettings.ts");
const { validateLetterSignParams } = loadMakerModule("lib/maker/validation.ts");

const bold = loadMakerFontFile("Montserrat-Bold.woff");
const regular = loadMakerFontFile("Montserrat-Regular.woff");

const BASE = { ...DEFAULT_LETTER_SIGN_PARAMS, fontId: "montserrat-bold", heightMm: 100, depthMm: 40, baseMm: 1.2 };
const STEP_MM = 0.2; // resolución del escalonado del perfil (MODIFIER_RESOLUTION_MM)

function generate(overrides, font = bold) {
  return createLetterGeometry(font, { ...BASE, ...overrides });
}
const bodyOf = (result) => result.parts.find((p) => p.kind === "body").mesh.positions;

// ---------------------------------------------------------------- instrumentos de medición

/** Intervalos de material [xIni, xFin] de la sección z=zc recorrida a lo largo de la recta y=y0 (par/impar sobre los segmentos del corte). */
function sectionIntervals(positions, zc, y0) {
  const xs = [];
  for (let o = 0; o < positions.length; o += 9) {
    const pts = [];
    for (let e = 0; e < 3; e++) {
      const a = o + e * 3, b = o + ((e + 1) % 3) * 3;
      const da = positions[a + 2] - zc, db = positions[b + 2] - zc;
      if ((da < 0) !== (db < 0)) {
        const k = da / (da - db);
        pts.push([positions[a] + (positions[b] - positions[a]) * k, positions[a + 1] + (positions[b + 1] - positions[a + 1]) * k]);
      }
    }
    if (pts.length !== 2) continue;
    const [p, q] = pts;
    if ((p[1] <= y0) === (q[1] <= y0)) continue;
    xs.push(p[0] + ((y0 - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
  }
  xs.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

function bounds(positions) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < positions.length; i += 3) {
    b.minX = Math.min(b.minX, positions[i]); b.maxX = Math.max(b.maxX, positions[i]);
    b.minY = Math.min(b.minY, positions[i + 1]); b.maxY = Math.max(b.maxY, positions[i + 1]);
    b.minZ = Math.min(b.minZ, positions[i + 2]); b.maxZ = Math.max(b.maxZ, positions[i + 2]);
  }
  return b;
}

/** Malla cerrada y manifold: toda arista tiene su contraparte opuesta; sin triángulos degenerados. */
function topology(positions) {
  const key = (i) => `${positions[i].toFixed(4)},${positions[i + 1].toFixed(4)},${positions[i + 2].toFixed(4)}`;
  const directed = new Map();
  let degenerate = 0;
  for (let o = 0; o < positions.length; o += 9) {
    const a = key(o), b = key(o + 3), c = key(o + 6);
    if (a === b || b === c || a === c) { degenerate++; continue; }
    const ux = positions[o + 3] - positions[o], uy = positions[o + 4] - positions[o + 1], uz = positions[o + 5] - positions[o + 2];
    const vx = positions[o + 6] - positions[o], vy = positions[o + 7] - positions[o + 1], vz = positions[o + 8] - positions[o + 2];
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2 < 1e-9) degenerate++;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) directed.set(`${u}|${v}`, (directed.get(`${u}|${v}`) ?? 0) + 1);
  }
  let open = 0, nonManifold = 0;
  const seen = new Set();
  for (const [k, n] of directed) {
    const [u, v] = k.split("|");
    const undirected = u < v ? k : `${v}|${u}`;
    if (seen.has(undirected)) continue;
    seen.add(undirected);
    const back = directed.get(`${v}|${u}`) ?? 0;
    if (n !== back) {
      if (n + back === 1) open++;
      else nonManifold++;
    }
  }
  return { degenerate, open, nonManifold };
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

/** Cantidad de contornos exteriores de un carácter (una "i" son dos sólidos: punto y tronco). */
function solidsOf(char, font = bold) {
  const { path } = textToPerCharacterPaths(font, char, 100)[0];
  return buildContourHierarchy(flattenOpentypePath(path)).length;
}

/** Alturas de muestreo a mitad de cada escalón (nunca justo sobre un plano horizontal de la malla). */
function sampleHeights(z0, z1, n = 14) {
  return Array.from({ length: n }, (_, i) => z0 + ((i + 0.37) / n) * (z1 - z0));
}

function assertClosed(mesh, label, { allowOpen = 0, allowDegenerate = 0 } = {}) {
  const t = topology(mesh);
  assert.ok(t.degenerate <= allowDegenerate, `${label}: triángulos degenerados (${t.degenerate})`);
  assert.equal(t.nonManifold, 0, `${label}: aristas no-manifold`);
  assert.ok(t.open <= allowOpen, `${label}: aristas abiertas (${t.open}), la malla no está cerrada`);
}

// ---------------------------------------------------------------- perfiles: espesor real de la pared

for (const wallMm of WALLS) {
  test(`pared de ${wallMm} mm (perfiles ${PROFILES.filter((p) => p.wallMm === wallMm).map((p) => `${p.material} ${p.strength}`).join(" / ")}): la pared mide ${wallMm} mm a todas las alturas del cuerpo, sin bisel`, () => {
    for (const text of ["I", "O", "H"]) {
      const result = generate({ text, wallMm });
      assert.equal(result.errors.length, 0);
      const body = bodyOf(result);
      const b = bounds(body);
      // "I" y "H" a media altura del tronco; "O" por el centro: la recta cruza las paredes en perpendicular.
      const y0 = text === "H" ? b.minY + (b.maxY - b.minY) * 0.15 : (b.minY + b.maxY) / 2;
      for (const z of sampleHeights(BASE.baseMm + 0.3, BASE.depthMm - 0.3)) {
        const intervals = sectionIntervals(body, z, y0);
        assert.ok(intervals.length >= 2, `${text} z=${z.toFixed(2)}: se esperaban al menos dos paredes`);
        for (const [x0, x1] of intervals) assert.ok(Math.abs(x1 - x0 - wallMm) < 2e-3, `${text} z=${z.toFixed(2)}: pared ${(x1 - x0).toFixed(3)} mm, se esperaba ${wallMm}`);
      }
      // La base (fondo) es maciza: en z < baseMm la sección es un único bloque que cruza todo el trazo.
      const baseSection = sectionIntervals(body, BASE.baseMm / 2, y0);
      assert.ok(baseSection.every(([x0, x1]) => x1 - x0 > wallMm * 2), `${text}: el fondo debería ser macizo`);
    }
  });
}

test("el selector es sólo wallMm: la tabla de perfiles es exactamente la pedida y el espesor deducido nunca contradice al campo Pared", () => {
  assert.deepEqual(WALL_PROFILES, { petg: { light: 0.9, normal: 1.35, reinforced: 1.8 }, pla: { light: 1.35, normal: 1.8, reinforced: 2.25 } });
  assert.equal(DEFAULT_LETTER_SIGN_PARAMS.wallMm, DEFAULT_WALL_MM);
  assert.equal(DEFAULT_LETTER_SIGN_PARAMS.wallMm, 1.35, "proyectos nuevos: PETG + Normal");
  assert.equal(DEFAULT_LETTER_SIGN_PARAMS.material, "petg");
  assert.equal(detectWallStrength("petg", 1.35), "normal");
  assert.equal(detectWallStrength("pla", 1.35), "light", "el mismo espesor es otra resistencia según el material");
  assert.equal(detectWallStrength("petg", 1.6), null, "un proyecto anterior con 1,6 mm es 'personalizado', no se reinterpreta");
  assert.equal(detectWallStrength("petg", 1.2), null, "el 1,2 mm de la versión anterior es 'personalizado'");
  assert.equal(detectWallStrength("pla", 1.8 + 1e-12), "normal");
  // Editar el campo Pared a mano y elegir una opción convergen en el mismo estado: no hay una segunda copia que pueda contradecirse.
  const edited = { ...BASE, text: "Hola", wallMm: 1.8 };
  assert.equal(detectWallStrength(edited.material, edited.wallMm), "reinforced");
  assert.deepEqual(applyWallStrength({ ...edited, wallMm: 1.7 }, "reinforced"), edited);
});

test("cambiar de resistencia conserva texto, estilo, material y demás ajustes, y regenera la geometría con el espesor nuevo", () => {
  for (const style of styles.STYLE_PRESETS) {
    const start = { ...styles.applyStylePreset({ ...DEFAULT_LETTER_SIGN_PARAMS, text: "Mi cartel", heightMm: 61 }, style) };
    const reinforced = applyWallStrength(start, "reinforced");
    const back = applyWallStrength(reinforced, "normal");
    assert.equal(reinforced.wallMm, 1.8);
    assert.equal(reinforced.material, "petg");
    assert.equal(reinforced.text, "Mi cartel");
    assert.equal(reinforced.heightMm, 61);
    assert.equal(styles.matchesStylePreset(reinforced, style), true, `${style.id}: sigue siendo el mismo estilo`);
    assert.equal(styles.detectStylePreset(reinforced)?.id, styles.detectStylePreset(start)?.id);
    assert.deepEqual(back, start);
    // Round-trip por presets guardados: el espesor y el material viajan con la receta.
    const restored = presetSettings.applyPresetSettings(start, JSON.parse(JSON.stringify(presetSettings.extractPresetSettings(reinforced))));
    assert.equal(restored.wallMm, 1.8);
    assert.equal(restored.material, "petg");
    assert.deepEqual(validateLetterSignParams(reinforced), []);
  }
  // La geometría cambia de verdad con la opción: más material con más pared.
  const normal = generate({ text: "I", wallMm: 1.35 });
  const reinf = generate({ text: "I", wallMm: 2.25 });
  assert.ok(reinf.triangleCount > 0 && normal.triangleCount > 0);
  const area = (positions, z, y) => sectionIntervals(positions, z, y).reduce((s, [a, c]) => s + (c - a), 0);
  const y0 = (bounds(bodyOf(normal)).minY + bounds(bodyOf(normal)).maxY) / 2;
  assert.ok(area(bodyOf(reinf), 20, y0) > area(bodyOf(normal), 20, y0) + 1.5);
});

// ---------------------------------------------------------------- bisel superior: paredes verticales + chaflán + espesor

const BEVELS = [
  { name: "corto 2/1", bevelDepthMm: 2, bevelInsetMm: 1 },
  { name: "medio 6/2.4", bevelDepthMm: 6, bevelInsetMm: 2.4 },
  { name: "largo 10/2.8", bevelDepthMm: 10, bevelInsetMm: 2.8 },
  { name: "45° 4/4", bevelDepthMm: 4, bevelInsetMm: 4 },
];

for (const wallMm of WALLS) {
  const strength = `pared ${wallMm}`;
  for (const bevel of BEVELS) {
    test(`bisel superior ${bevel.name} + ${strength}: pared vertical y de espesor constante hasta el bisel; dentro del bisel conserva ${wallMm} mm y el exterior sigue el chaflán`, () => {
      const result = generate({ text: "I", wallMm, bevelEnabled: true, bevelDepthMm: bevel.bevelDepthMm, bevelInsetMm: bevel.bevelInsetMm });
      assert.equal(result.errors.length, 0);
      assert.ok(!result.warnings.some((w) => w.code === "BEVEL_CLAMPED"), "estos bisels entran sin ajuste");
      const body = bodyOf(result);
      const b = bounds(body);
      const y0 = (b.minY + b.maxY) / 2;
      const bandZ0 = BASE.depthMm - bevel.bevelDepthMm;
      const slope = bevel.bevelInsetMm / bevel.bevelDepthMm;
      const nominalLeft = sectionIntervals(body, BASE.baseMm + 1, y0)[0][0];

      // 1) Hasta el comienzo del bisel: exterior en su lugar (vertical) y pared exacta.
      for (const z of sampleHeights(BASE.baseMm + 0.3, bandZ0 - 0.05)) {
        const [first] = sectionIntervals(body, z, y0);
        assert.ok(Math.abs(first[0] - nominalLeft) < 2e-3, `z=${z.toFixed(2)}: la pared exterior no es vertical (${first[0].toFixed(3)} vs ${nominalLeft.toFixed(3)})`);
        assert.ok(Math.abs(first[1] - first[0] - wallMm) < 2e-3, `z=${z.toFixed(2)}: pared ${(first[1] - first[0]).toFixed(3)} mm`);
      }

      // 2) Dentro del bisel: la pared NUNCA baja de wallMm (sube a lo sumo un escalón, por la aproximación) y el exterior avanza hacia adentro.
      const maxOvershoot = slope * STEP_MM + 0.02;
      for (const z of sampleHeights(bandZ0 + 0.05, BASE.depthMm - 0.05, 20)) {
        const intervals = sectionIntervals(body, z, y0);
        assert.equal(intervals.length, 2, `z=${z.toFixed(2)}: se esperaban dos paredes`);
        for (const [x0, x1] of intervals) {
          const width = x1 - x0;
          assert.ok(width >= wallMm - 2e-3, `z=${z.toFixed(2)}: pared ${width.toFixed(3)} mm < ${wallMm} mm (el bisel se comió la pared)`);
          assert.ok(width <= wallMm + maxOvershoot, `z=${z.toFixed(2)}: pared ${width.toFixed(3)} mm engrosada de más`);
        }
        const expectedInset = (slope * (z - bandZ0));
        const inset = intervals[0][0] - nominalLeft;
        assert.ok(inset >= expectedInset - maxOvershoot && inset <= expectedInset + maxOvershoot, `z=${z.toFixed(2)}: desplazamiento ${inset.toFixed(3)} mm, el chaflán recto da ${expectedInset.toFixed(3)} mm`);
      }

      // 3) El borde del frente queda desplazado exactamente bevelInsetMm; la altura total no cambia.
      const top = sectionIntervals(body, BASE.depthMm - 0.01, y0);
      assert.ok(Math.abs(top[0][0] - nominalLeft - bevel.bevelInsetMm) < 0.02 + maxOvershoot);
      assert.ok(Math.abs(b.maxZ - BASE.depthMm) < 1e-6);
      assertClosed(body, `I ${bevel.name} ${strength}`);
      assert.equal(countComponents(body), 1);
    });
  }
}

test("bisel independiente del espesor de pared: un bisel mayor que la pared (antes: malla abierta/pared negativa) ahora conserva la pared", () => {
  for (const wallMm of [0.9, 2.25]) {
    const result = generate({ text: "O", wallMm, bevelEnabled: true, bevelDepthMm: 8, bevelInsetMm: 5 });
    assert.equal(result.errors.length, 0);
    const body = bodyOf(result);
    assertClosed(body, `O wall ${wallMm} bisel 5 mm`);
    const b = bounds(body);
    for (const z of sampleHeights(BASE.depthMm - 8 + 0.1, BASE.depthMm - 0.1, 16)) {
      for (const [x0, x1] of sectionIntervals(body, z, (b.minY + b.maxY) / 2)) assert.ok(x1 - x0 >= wallMm - 2e-3, `z=${z.toFixed(2)}: pared ${(x1 - x0).toFixed(3)}`);
    }
  }
});

// ---------------------------------------------------------------- validez de malla: letras anchas/estrechas, esquinas, contornos internos, textos completos

const MESH_CASES = [
  ["ancha", "O"], ["ancha", "M"], ["estrecha", "I"], ["estrecha", "l"], ["estrecha", "i"], ["estrecha", "1"],
  ["esquina", "A"], ["esquina", "V"], ["esquina", "W"], ["esquina", "K"], ["esquina", "Z"], ["esquina", "4"],
  ["contorno interno", "B"], ["contorno interno", "8"], ["contorno interno", "R"], ["contorno interno", "@"],
  ["texto", "STAMPA"], ["texto", "Hola 3D"],
];

for (const wallMm of [0.9, 2.25]) {
  for (const [kind, text] of MESH_CASES) {
    for (const bevel of [BEVELS[0], BEVELS[2]]) {
      test(`malla válida: ${kind} "${text}" · pared ${wallMm} · bisel ${bevel.name} (cerrada, manifold, 1 componente por letra)`, () => {
        const result = generate({ text, wallMm, bevelEnabled: true, bevelDepthMm: bevel.bevelDepthMm, bevelInsetMm: bevel.bevelInsetMm });
        assert.equal(result.errors.length, 0, result.errors.map((e) => e.message).join("; "));
        // Limitación PREEXISTENTE del glifo "R" (también sin bisel y en el motor anterior): un lazo de área cero en el frente.
        const allowOpen = text.includes("R") ? 6 : 0;
        for (const letter of result.letters) {
          const mesh = letter.parts.find((p) => p.kind === "body").mesh.positions;
          assert.ok(mesh.every(Number.isFinite));
          assertClosed(mesh, `${text}/${letter.char}`, { allowOpen: letter.char === "R" ? 6 : 0 });
          assert.equal(countComponents(mesh), solidsOf(letter.char), `${text}/${letter.char}: cantidad de sólidos distinta de la esperada`);
        }
        assertClosed(bodyOf(result), `${text} combinado`, { allowOpen });
      });
    }
  }
}

test("malla válida con fuente Regular (trazos más finos), bisel y pared reforzada", () => {
  for (const text of ["Sol", "Hola"]) {
    const result = generate({ text, fontId: "montserrat-regular", wallMm: 2.4, bevelEnabled: true, bevelDepthMm: 6, bevelInsetMm: 2.4 }, regular);
    assert.equal(result.errors.length, 0);
    assertClosed(bodyOf(result), `${text} regular`);
  }
});

// ---------------------------------------------------------------- protecciones: bisel excesivo, ángulo, trazos finos

test("protección: la zona biselada no supera la mitad de la pared (el resto queda vertical) y se avisa", () => {
  const result = generate({ text: "I", depthMm: 20, bevelEnabled: true, bevelDepthMm: 15, bevelInsetMm: 2 });
  const warning = result.warnings.find((w) => w.code === "BEVEL_CLAMPED");
  assert.ok(warning, "se esperaba BEVEL_CLAMPED");
  assert.match(warning.message, /mitad de la pared/);
  const wallHeight = 20 - BASE.baseMm;
  const body = bodyOf(result);
  const b = bounds(body);
  const y0 = (b.minY + b.maxY) / 2;
  const nominalLeft = sectionIntervals(body, BASE.baseMm + 1, y0)[0][0];
  // Vertical hasta la mitad de la pared.
  for (const z of sampleHeights(BASE.baseMm + 0.3, 20 - wallHeight / 2 - 0.1)) {
    assert.ok(Math.abs(sectionIntervals(body, z, y0)[0][0] - nominalLeft) < 2e-3, `z=${z.toFixed(2)} debería ser vertical`);
  }
  assertClosed(body, "bisel acotado");
});

test("protección: el chaflán no pasa de 45° respecto de la vertical (desplazamiento <= altura de la banda) y se avisa", () => {
  const result = generate({ text: "I", bevelEnabled: true, bevelDepthMm: 2, bevelInsetMm: 6 });
  const warning = result.warnings.find((w) => w.code === "BEVEL_CLAMPED");
  assert.ok(warning);
  assert.match(warning.message, /45°/);
  const body = bodyOf(result);
  const y0 = (bounds(body).minY + bounds(body).maxY) / 2;
  const nominalLeft = sectionIntervals(body, BASE.baseMm + 1, y0)[0][0];
  const topLeft = sectionIntervals(body, BASE.depthMm - 0.01, y0)[0][0];
  // 2 mm de desplazamiento en el borde del frente; a 0.01 mm del frente la pared escalonada está a lo sumo un escalón (0.2 mm a 45°) antes.
  assert.ok(topLeft - nominalLeft > 2 - STEP_MM - 0.02 && topLeft - nominalLeft < 2 + 0.02, `el desplazamiento efectivo debería ser ~2 mm, fue ${(topLeft - nominalLeft).toFixed(3)}`);
});

test("protección: un texto chico con bisel grande no parte los trazos finos — se acota el desplazamiento y queda avisado", () => {
  const result = generate({ text: "Sol", heightMm: 24, depthMm: 20, bevelEnabled: true, bevelDepthMm: 8, bevelInsetMm: 4 }, bold);
  assert.equal(result.errors.length, 0);
  const warning = result.warnings.find((w) => w.code === "BEVEL_CLAMPED");
  assert.ok(warning, "se esperaba BEVEL_CLAMPED");
  assert.match(warning.message, /trazos más finos/);
  for (const letter of result.letters) {
    const mesh = letter.parts.find((p) => p.kind === "body").mesh.positions;
    assertClosed(mesh, `Sol/${letter.char}`);
    // La cara frontal conserva al menos 1,2 mm de ancho en el trazo más fino: siempre queda material en el frente.
    const top = sectionIntervals(mesh, 20 - 0.01, (bounds(mesh).minY + bounds(mesh).maxY) / 2);
    assert.ok(top.length > 0 && top.every(([a, c]) => c - a > 0.5), `${letter.char}: la cara frontal se redujo a un filo`);
  }
});

test("protección: sin margen para un bisel útil (trazo finísimo) el bisel se desactiva con aviso, sin romper la malla", () => {
  const result = generate({ text: "I", heightMm: 4, depthMm: 12, bevelEnabled: true, bevelDepthMm: 4, bevelInsetMm: 1.5 }, bold);
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.some((w) => w.code === "BEVEL_CLAMPED" && /desactiv/.test(w.message)));
  assertClosed(bodyOf(result), "I chica");
});

test("el ajuste de bisel se aplica al modelo y a la exportación por igual (los params efectivos alimentan todo)", () => {
  const params = { ...BASE, text: "Sol", heightMm: 24, depthMm: 20, bevelEnabled: true, bevelDepthMm: 8, bevelInsetMm: 4 };
  const requested = resolveInwardModifiers([], params).params;
  assert.equal(requested.bevelInsetMm, 4, "sin contornos no hay nada que acotar por trazo fino");
  assert.ok(computeInwardBands({ ...params, bodyType: "tapered" }).length === 0, "el cuerpo tapered no usa el bisel");
  assert.ok(computeInwardBands({ ...params, frontType: "light-channel" }).length === 0, "el canal luminoso es macizo: no hay cavidad que acompañar");
});

test("topología: el primer evento es la mitad del trazo más fino (I = mitad del ancho del tronco, O = mitad del grosor del anillo)", () => {
  const groupsOf = (text, font = bold) => {
    const { path } = textToPerCharacterPaths(font, text, 100)[0];
    return buildContourHierarchy(flattenOpentypePath(path));
  };
  const iStem = bounds(bodyOf(generate({ text: "I" })));
  const stemWidth = iStem.maxX - iStem.minX;
  const eventI = minStrokeHalfWidthMm(groupsOf("I"), 30);
  assert.ok(Math.abs(eventI - stemWidth / 2) < 0.1, `I: evento ${eventI.toFixed(2)} vs mitad del tronco ${(stemWidth / 2).toFixed(2)}`);
  assert.equal(firstTopologyEventMm(groupsOf("I")[0], stemWidth / 2 - 0.5), Infinity, "por debajo del evento no hay cambio topológico");
  const ring = minStrokeHalfWidthMm(groupsOf("O"), 40);
  assert.ok(ring > 5 && ring < 15);
});

// ---------------------------------------------------------------- pared que no cabe: advertencia controlada

test("pared que no entra en trazos finos: el trazo queda macizo (modelo válido) y se advierte con el espesor elegido", () => {
  // Elegimos la altura para que el tronco de la "I" mida entre 2,4 mm (Normal ya lo ahueca justo) y 4,8 mm (Reforzado no lo puede ahuecar).
  const probe = bounds(bodyOf(generate({ text: "I", heightMm: 20 })));
  const stem = probe.maxX - probe.minX;
  assert.ok(stem > 2.4 && stem < 4.8, `tronco de ${stem.toFixed(2)} mm fuera del rango del test`);

  const normal = generate({ text: "I", heightMm: 20, wallMm: 1.2 });
  assert.ok(!normal.warnings.some((w) => w.code === "WALL_TOO_THICK"), "la pared Normal entra en este trazo");
  assert.ok(sectionIntervals(bodyOf(normal), 20, (probe.minY + probe.maxY) / 2).length === 2, "Normal: hueca (dos paredes)");

  const reinforced = generate({ text: "I", heightMm: 20, wallMm: 2.4 });
  assert.equal(reinforced.errors.length, 0);
  const warning = reinforced.warnings.find((w) => w.code === "WALL_TOO_THICK");
  assert.ok(warning, "Reforzado en un trazo fino debe advertir");
  assert.match(warning.message, /2.4 mm/);
  assert.equal(sectionIntervals(bodyOf(reinforced), 20, (probe.minY + probe.maxY) / 2).length, 1, "Reforzado: el trazo queda macizo, sin hueco artificial");
  assertClosed(bodyOf(reinforced), "I maciza");
});

test("sin huecos artificiales: una letra maciza por su tamaño (tronco < 2 x pared) sigue maciza con la pared mínima y la máxima", () => {
  for (const wallMm of [0.9, 2.25]) {
    // 6 mm de alto => tronco ~1,4 mm, menor que 2 x 0,9 mm: no admite cavidad con ninguno de los perfiles.
    const result = generate({ text: "I", heightMm: 6, depthMm: 10, wallMm });
    const body = bodyOf(result);
    const b = bounds(body);
    for (const z of sampleHeights(BASE.baseMm + 0.3, 10 - 0.3, 6)) assert.equal(sectionIntervals(body, z, (b.minY + b.maxY) / 2).length, 1, `z=${z.toFixed(2)}: debería ser un único bloque macizo`);
  }
});

// ---------------------------------------------------------------- cintura lateral (Retro): misma causa, mismo arreglo

for (const wallMm of [0.9, 2.25]) {
  test(`cintura lateral (estilo Retro) + pared ${wallMm}: ya no se autointersecta — la pared conserva ${wallMm} mm en la cintura`, () => {
    const retro = styles.getStylePreset("retro");
    const params = { ...styles.applyStylePreset({ ...DEFAULT_LETTER_SIGN_PARAMS, text: "I", fontId: "montserrat-bold" }, retro), wallMm };
    const result = createLetterGeometry(bold, params);
    assert.equal(result.errors.length, 0);
    const body = bodyOf(result);
    assertClosed(body, "retro");
    const b = bounds(body);
    const y0 = (b.minY + b.maxY) / 2;
    for (const z of sampleHeights(params.baseMm + 0.3, params.depthMm - 0.3, 30)) {
      const intervals = sectionIntervals(body, z, y0);
      assert.equal(intervals.length, 2, `z=${z.toFixed(2)}`);
      for (const [x0, x1] of intervals) assert.ok(x1 - x0 >= wallMm - 2e-3, `z=${z.toFixed(2)}: pared ${(x1 - x0).toFixed(3)} < ${wallMm}`);
    }
    // La cintura se nota afuera: el exterior entra ~grooveInsetMm en el centro de la banda.
    const centerZ = params.depthMm - params.groovePositionMm;
    const nominalLeft = sectionIntervals(body, params.baseMm + 1, y0)[0][0];
    const waist = sectionIntervals(body, centerZ + 0.01, y0)[0][0] - nominalLeft;
    assert.ok(Math.abs(waist - params.grooveInsetMm) < 0.15, `cintura ${waist.toFixed(2)} mm vs ${params.grooveInsetMm}`);
  });
}

// ---------------------------------------------------------------- tapa encastrable sobre cuerpo biselado

test("bisel + tapa encastrable: el labio entra en la cavidad (ya angostada) con la holgura pedida, sin interferir con la pared del cuerpo", () => {
  for (const wallMm of [0.9, 2.25]) {
    const params = { text: "O", wallMm, depthMm: 40, bevelEnabled: true, bevelDepthMm: 6, bevelInsetMm: 2.4, frontType: "lid", lidJoint: "interior-lip", insertDepthMm: 3, clearanceMm: 0.2, lipWallMm: 0.8, lidMm: 1.2 };
    const result = generate(params);
    assert.equal(result.errors.length, 0, result.errors.map((e) => e.message).join("; "));
    const lid = result.parts.find((p) => p.kind === "lid").mesh.positions;
    const body = bodyOf(result);
    assertClosed(lid, `tapa O ${wallMm}`);
    assert.equal(countComponents(lid), 1);
    const y0 = (bounds(body).minY + bounds(body).maxY) / 2;
    // La tapa vive en z > depthMm; su labio se mide dentro de [depth - insert, depth].
    for (const z of [38.05, 38.5, 39.0, 39.5, 39.95]) {
      const bodyIv = sectionIntervals(body, z, y0);
      const lipIv = sectionIntervals(lid, z, y0);
      assert.ok(lipIv.length >= 2, `z=${z}: el labio debería existir`);
      for (const [l0, l1] of lipIv) {
        for (const [b0, b1] of bodyIv) {
          const overlap = Math.min(l1, b1) - Math.max(l0, b0);
          assert.ok(overlap <= 1e-3, `z=${z}: el labio [${l0.toFixed(2)},${l1.toFixed(2)}] pisa la pared [${b0.toFixed(2)},${b1.toFixed(2)}]`);
        }
        const gap = Math.min(...bodyIv.map(([b0, b1]) => (l1 <= b0 ? b0 - l1 : l0 >= b1 ? l0 - b1 : -1)));
        assert.ok(gap >= 0.2 - 2e-3, `z=${z}: holgura ${gap.toFixed(3)} mm < 0,2 mm`);
      }
    }
  }
});

test("bisel + tapa plana: la tapa continúa el borde desplazado del cuerpo (sin voladizo)", () => {
  const withBevel = generate({ text: "I", bevelEnabled: true, bevelDepthMm: 6, bevelInsetMm: 2.4, frontType: "lid", lidJoint: "glue" });
  const body = bounds(bodyOf(withBevel));
  const lid = bounds(withBevel.parts.find((p) => p.kind === "lid").mesh.positions);
  const nominal = sectionIntervals(bodyOf(withBevel), BASE.baseMm + 1, (body.minY + body.maxY) / 2);
  assert.ok(Math.abs(lid.minX - (nominal[0][0] + 2.4)) < 0.02, "borde izquierdo de la tapa = borde del cuerpo + desplazamiento del bisel");
  assert.ok(Math.abs(lid.maxX - (nominal[nominal.length - 1][1] - 2.4)) < 0.02, "borde derecho");
});

// ---------------------------------------------------------------- compatibilidad

test("sin bisel/cintura la geometría no cambió: la pared vertical clásica es la misma con y sin los campos nuevos", () => {
  const a = generate({ text: "O", wallMm: 1.6 });
  const b = generate({ text: "O", wallMm: 1.6, bevelEnabled: false, grooveEnabled: false, bevelInsetMm: 9, grooveInsetMm: 9 });
  assert.deepEqual(Array.from(bodyOf(a)), Array.from(bodyOf(b)));
  assert.equal(a.warnings.length, 0);
});

test("bisel con costillas, bisel posterior y frentes distintos sigue generando mallas cerradas", () => {
  const combos = [
    { ribsCount: 2, bevelEnabled: true, bevelDepthMm: 4, bevelInsetMm: 1.5 },
    { rearBevelEnabled: true, rearBevelDepthMm: 2, rearBevelInsetMm: 1, bevelEnabled: true, bevelDepthMm: 4, bevelInsetMm: 1.5 },
    { frontType: "perforated", bevelEnabled: true, bevelDepthMm: 4, bevelInsetMm: 1.5 },
    { grooveEnabled: true, grooveInsetMm: 2, grooveWidthMm: 6, groovePositionMm: 20, bevelEnabled: true, bevelDepthMm: 4, bevelInsetMm: 2 },
  ];
  for (const combo of combos) {
    const result = generate({ text: "O", wallMm: 1.2, ...combo });
    assert.equal(result.errors.length, 0, JSON.stringify(combo));
    // La máscara perforada tiene 8 triángulos degenerados PREEXISTENTES (también sin bisel, en el motor anterior).
    for (const part of result.parts) assertClosed(part.mesh.positions, `${JSON.stringify(combo)}/${part.kind}`, { allowDegenerate: part.kind === "mask" ? 8 : 0 });
  }
});

// ---------------------------------------------------------------- exportación = visor

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

test("exportación: el STL de cada pieza contiene exactamente la malla del visor (bisel + pared reforzada, con tapa)", async () => {
  const result = generate({ text: "Hi", wallMm: 2.4, bevelEnabled: true, bevelDepthMm: 6, bevelInsetMm: 2.4, frontType: "lid", lidJoint: "interior-lip" });
  assert.equal(result.errors.length, 0);
  for (const part of result.parts) {
    const stl = await readStl(buildSTLBlob(part.mesh));
    assert.equal(stl.count, part.mesh.triangleCount, `${part.kind}: cantidad de triángulos`);
    for (let i = 0; i < part.mesh.positions.length; i++) assert.ok(Math.abs(stl.positions[i] - part.mesh.positions[i]) < 1e-5, `${part.kind}: vértice ${i}`);
  }
  // El archivo exportado de cada letra sale de las mismas piezas del visor (sólo reorientadas para imprimir).
  const entries = partFileEntries(result.parts, "hi");
  assert.equal(entries.length, result.parts.length);
  for (const [i, entry] of entries.entries()) assert.equal(entry.mesh.triangleCount, result.parts[i].mesh.triangleCount);
});

test("cambiar la resistencia regenera el modelo Y el archivo: el STL refleja la pared nueva", async () => {
  const sectionOfStl = async (wallMm) => {
    const result = generate({ text: "I", wallMm, bevelEnabled: true, bevelDepthMm: 6, bevelInsetMm: 2.4 });
    const stl = await readStl(buildSTLBlob(result.parts[0].mesh));
    const b = bounds(stl.positions);
    return sectionIntervals(stl.positions, 12, (b.minY + b.maxY) / 2);
  };
  for (const wallMm of [0.9, 2.25]) {
    const intervals = await sectionOfStl(wallMm);
    assert.equal(intervals.length, 2);
    assert.ok(Math.abs(intervals[0][1] - intervals[0][0] - wallMm) < 2e-3);
  }
});

// ---------------------------------------------------------------- UI

test("UI: material (PLA/PETG) y resistencia (Ligero/Normal/Reforzado) son dos radiogroups; marcan lo elegido y deducen la resistencia del espesor", () => {
  const { MakerStrengthSelector } = loadTs("src/components/maker/MakerStrengthSelector.tsx", {});
  const render = (material, wallMm) => renderToStaticMarkup(createElement(MakerStrengthSelector, { material, wallMm, onMaterialChange() {}, onStrengthChange() {} }));

  const petgNormal = render("petg", 1.35);
  assert.equal((petgNormal.match(/role="radiogroup"/g) ?? []).length, 2);
  assert.equal((petgNormal.match(/role="radio"/g) ?? []).length, 5);
  assert.equal((petgNormal.match(/aria-checked="true"/g) ?? []).length, 2, "una opción de material y una de resistencia");
  for (const label of ["PLA", "PETG", "Ligero", "Normal", "Reforzado"]) assert.match(petgNormal, new RegExp(label));
  assert.match(petgNormal, /PETG · Normal/);
  assert.match(petgNormal, /Espesor de pared: 1,35 mm\./);
  assert.match(petgNormal, /Aproximadamente 3 líneas de extrusión de 0,45 mm, sujeto a la configuración del laminador/);
  assert.match(petgNormal, /0,9 mm/);
  assert.match(petgNormal, /1,8 mm/);
  assert.doesNotMatch(petgNormal, /Personalizado/);

  // El mismo espesor con otro material es otra resistencia: el material nunca se deduce de wallMm.
  const plaLight = render("pla", 1.35);
  assert.match(plaLight, /PLA · Ligero/);
  assert.match(plaLight, /2,25 mm/);
  assert.match(plaLight, /Espesor de pared: 1,35 mm\./);

  assert.match(render("pla", 2.25), /PLA · Reforzado/);
  assert.match(render("petg", 0.9), /PETG · Ligero/);
  assert.match(render("petg", 0.9), /Aproximadamente 2 líneas/);

  const custom = render("petg", 1.5);
  assert.equal((custom.match(/aria-checked="true"/g) ?? []).length, 1, "sólo el material: ninguna resistencia marcada");
  assert.match(custom, /Personalizado/);
  assert.match(custom, /PETG · Personalizado/);
  assert.match(custom, /Espesor de pared: 1,5 mm\./);
  assert.match(petgNormal, /no una garantía de resistencia/);
});
