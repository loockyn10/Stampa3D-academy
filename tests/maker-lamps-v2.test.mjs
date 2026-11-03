import assert from "node:assert/strict";
import test from "node:test";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";

// Lámparas V2: base de doble anillo (torre central), cilindro de color Ø65 en su ranura y estandarización de la interfaz.
// Todo se mide sobre las MALLAS generadas (las mismas que ve el visor y exporta el STL), no sobre los valores de configuración.
// No reemplaza imprimir, montar el portalámparas real, ni las pruebas térmicas y eléctricas.

const { DEFAULT_LAMP } = loadMakerModule("lib/maker/lamps/defaults.ts");
const { createLamp } = loadMakerModule("lib/maker/lamps/createLamp.ts");
const { validateLamp } = loadMakerModule("lib/maker/lamps/validation/validateLamp.ts");
const { LAMP_GEOMETRY } = loadMakerModule("lib/maker/lamps/types.ts");

const lamp = (shade = {}, rest = {}) => ({ ...DEFAULT_LAMP, ...rest, shade: { ...DEFAULT_LAMP.shade, ...shade } });
const build = (def) => {
  const r = createLamp(def);
  assert.equal(r.errors.length, 0, `errores: ${JSON.stringify(r.errors.map((e) => e.code + " " + e.message))}`);
  return r;
};

/** Radios de cruce del plano y = cy + 0,37 (lado +X) a la altura z. */
function planeCrossings(mesh, z, cy = 0.37) {
  const xs = [];
  const p = mesh.positions;
  for (let t = 0; t < mesh.tris.length; t += 3) {
    const pts = [];
    for (let e = 0; e < 3; e++) {
      const a = mesh.tris[t + e] * 3, b = mesh.tris[t + ((e + 1) % 3)] * 3;
      const da = p[a + 1] - cy, db = p[b + 1] - cy;
      if (da * db < 0) { const u = da / (da - db); pts.push([p[a] + u * (p[b] - p[a]), p[a + 2] + u * (p[b + 2] - p[a + 2])]); }
    }
    if (pts.length === 2 && (pts[0][1] - z) * (pts[1][1] - z) < 0) { const u = (z - pts[0][1]) / (pts[1][1] - pts[0][1]); xs.push(pts[0][0] + u * (pts[1][0] - pts[0][0])); }
  }
  return xs.filter((x) => x > 0).sort((a, b) => a - b).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 0.02);
}

test("cilindro Ø65,135 (encastre estándar de diffuser.stl) en su ranura (medido sobre las mallas): holguras exterior e interior, apoyo en el fondo y pared de la torre", () => {
  const def = lamp();
  const r = build(def);
  const fit = r.metrics.fit;
  const t = fit.tower;
  assert.equal(fit.insertOuterDiameterMm, 65.135);
  const zIn = fit.insertBottomZ + def.insert.seatDepthMm / 2; // a media profundidad de la ranura
  const base = planeCrossings(r.indexed.base, zIn);
  const cyl = planeCrossings(r.indexed.insert, zIn);
  assert.equal(cyl.length, 2, "dos paredes del cilindro");
  // base a esa altura: [agujero, ...rebaje no (bajo el apoyo), torre...]: el agujero, la ranura interior, la exterior y la torre
  const slotInner = base.find((x) => Math.abs(x - t.slotInnerDiameterMm / 2) < 0.05);
  const slotOuter = base.find((x) => Math.abs(x - t.slotOuterDiameterMm / 2) < 0.05);
  assert.ok(slotInner !== undefined && slotOuter !== undefined, `ranura en ${JSON.stringify(base.map((x) => +x.toFixed(2)))}`);
  const outerClear = slotOuter - cyl[1];
  const innerClear = cyl[0] - slotInner;
  assert.ok(Math.abs(outerClear - def.insert.clearanceMm) < 0.03 && Math.abs(innerClear - def.insert.clearanceMm) < 0.03, `holguras ${outerClear.toFixed(3)} / ${innerClear.toFixed(3)}`);
  // diámetros del encastre estándar: exterior Ø65,135, interior = exterior − 2 × espesor
  assert.ok(Math.abs(2 * cyl[1] - 65.135) < 0.02 && Math.abs(2 * cyl[0] - (65.135 - 2 * def.insert.thicknessMm)) < 0.02);
  // el cilindro apoya en el fondo de la ranura (no queda flotando ni entra más)
  assert.ok(Math.abs(r.indexed.insert.positions.filter((_, i) => i % 3 === 2).reduce((m, z) => Math.min(m, z), Infinity) - fit.insertBottomZ) < 1e-6);
  const bottomWallZ = fit.insertBottomZ - 0.2;
  assert.ok(planeCrossings(r.indexed.base, bottomWallZ).filter((x) => x > cyl[0] - 1 && x < cyl[1] + 1).length === 0, "bajo el fondo de la ranura la torre es maciza");
  // pared de la torre entre el rebaje de los anillos y la ranura, medida (ref. impresa: 1,69 mm)
  const aboveSeat = planeCrossings(r.indexed.base, t.seatZ + 1);
  const recess = aboveSeat[0], inner = aboveSeat[1];
  assert.ok(Math.abs(inner - recess - t.innerWallMm) < 0.03);
  assert.ok(t.innerWallMm >= LAMP_GEOMETRY.towerMinWallMm && t.innerWallMm < LAMP_GEOMETRY.towerWarnWallMm, "delgada pero válida: se advierte");
  // separación a los anillos (dentro del rebaje) y a la bombilla
  assert.ok(Math.abs(cyl[0] - def.holder.ringsDiameterMm / 2 - t.ringsToInsertGapMm) < 0.06);
  assert.ok(Math.abs(cyl[0] - def.bulb.diameterMm / 2 - fit.insertBulbGapMm) < 0.06);
});

test("la separación radial a la bombilla (1,8 mm con Ø65,135 y una bombilla de Ø60) se informa como PENDIENTE de validación física y no se presenta como segura", () => {
  const warn = (r, code) => r.warnings.filter((w) => w.code === code);
  const base = build(lamp());
  assert.equal(base.metrics.fit.insertBulbGapMm, 1.8);
  assert.equal(warn(base, "INSERT_GAP_UNVALIDATED").length, 1);
  assert.match(warn(base, "INSERT_GAP_UNVALIDATED")[0].message, /PENDIENTE DE VALIDACIÓN FÍSICA/);
  assert.match(warn(base, "INSERT_GAP_UNVALIDATED")[0].message, /no hay datos para afirmar/);
  // aunque el usuario marque sus medidas como verificadas, no hay datos térmicos: el aviso sigue
  const measured = build(lamp({}, { holder: { ...DEFAULT_LAMP.holder, measured: true } }));
  assert.equal(warn(measured, "INSERT_GAP_UNVALIDATED").length, 1);
  assert.equal(warn(measured, "HOLDER_NOT_VALIDATED").length, 0);
  assert.equal(warn(measured, "PHYSICAL_VALIDATION_PENDING").length, 1);
  // con una bombilla más angosta (más aire) el aviso desaparece; con una que casi toca, se bloquea
  assert.equal(warn(build(lamp({}, { bulb: { ...DEFAULT_LAMP.bulb, diameterMm: 50 } })), "INSERT_GAP_UNVALIDATED").length, 0);
  const touching = createLamp(lamp({}, { bulb: { ...DEFAULT_LAMP.bulb, diameterMm: 63 } }));
  assert.ok(touching.geometry === null && touching.errors.some((e) => e.code === "INSERT_TOO_CLOSE_TO_BULB"));
  // la separación mínima exigida es configurable (0,5–40 mm) y no se inventa una distancia térmica
  assert.ok(createLamp(lamp({}, { insert: { ...DEFAULT_LAMP.insert, minBulbGapMm: 3 } })).errors.some((e) => e.code === "INSERT_TOO_CLOSE_TO_BULB"));
  assert.ok(createLamp(lamp({}, { insert: { ...DEFAULT_LAMP.insert, minBulbGapMm: 0.2 } })).errors.some((e) => e.field === "insert.minBulbGapMm"));
});

test("estandarización: distintos patrones, alturas y diámetros de pantalla comparten la MISMA base y la misma rosca; solo cambia la parte decorativa", () => {
  const fixed = { ...DEFAULT_LAMP.base, diameterMm: 130 };
  const shades = [
    { family: "wavy", waves: 6, amplitudeMm: 7, twistDeg: 0, heightMm: 120, bottomDiameterMm: 110, topDiameterMm: 140 },
    { family: "spiral", waves: 14, amplitudeMm: 5, twistDeg: 500, heightMm: 240, bottomDiameterMm: 150, topDiameterMm: 150 },
    { family: "organic", organicPct: 80, waves: 7, amplitudeMm: 6, seed: 3, profile: "bell", profileAmountPct: 50, heightMm: 300, bottomDiameterMm: 130, topDiameterMm: 210 },
  ];
  const results = shades.map((shade) => build(lamp(shade, { base: fixed })));
  const bases = new Set(results.map((r) => r.geometry.parts[0].mesh));
  assert.equal(bases.size, 1, "una sola base para todos los diseños");
  // el cilindro tiene el mismo diámetro, espesor y ranura para todos (solo su altura sigue a la pantalla)
  assert.deepEqual([...new Set(results.map((r) => `${r.metrics.fit.insertOuterDiameterMm}/${r.metrics.fit.insertInnerDiameterMm}/${Math.round(r.metrics.fit.insertBottomZ * 100) / 100}`))], ["65.135/63.535/26.55"]);
  for (const r of results) assert.deepEqual(r.metrics.fit.thread, { ...results[0].metrics.fit.thread, flareHeightMm: r.metrics.fit.thread.flareHeightMm });
  const shadeMeshes = new Set(results.map((r) => r.geometry.parts[2].mesh));
  assert.equal(shadeMeshes.size, 3, "lo único que cambia es la pantalla");
  // un diámetro de pantalla menor que la apertura estándar NO ajusta la rosca: se informa la incompatibilidad
  const small = createLamp(lamp({ bottomDiameterMm: 94, topDiameterMm: 94, amplitudeMm: 0 }));
  assert.ok(small.errors.some((e) => e.code === "SHADE_NARROWER_THAN_THREAD" && /Ø 92,8 mm/.test(e.message)));
  assert.equal(small.geometry, null);
  assert.equal(DEFAULT_LAMP.thread.majorDiameterMm, 96, "la rosca no depende del diámetro decorativo");
  // la base automática tampoco cambia con diseños de tamaño habitual
  const auto = [lamp(), lamp({ family: "wavy", waves: 8, twistDeg: 0, heightMm: 150 }), lamp({ family: "organic", organicPct: 60, seed: 9, heightMm: 200, bottomDiameterMm: 140, topDiameterMm: 160 })].map(build);
  assert.equal(new Set(auto.map((r) => r.geometry.parts[0].mesh)).size, 1);
});

test("el portalámparas se sujeta con sus anillos en la torre, sin depender de la unión decorativa: cambiar la rosca no cambia el alojamiento (y viceversa)", () => {
  const a = build(lamp());
  const b = build(lamp({}, { thread: { ...DEFAULT_LAMP.thread, majorDiameterMm: 110, pitchMm: 6, starts: 3 } }));
  const towerOf = (r) => JSON.stringify(r.metrics.fit.tower);
  assert.notEqual(towerOf(a), "");
  assert.equal(towerOf(a).replace(/"towerToNeckGapMm":[\d.]+/, ""), towerOf(b).replace(/"towerToNeckGapMm":[\d.]+/, ""), "la torre es la misma");
  // medido en las mallas: agujero y rebaje idénticos con otra rosca
  const seatZ = a.metrics.fit.tower.seatZ;
  assert.deepEqual(planeCrossings(a.indexed.base, seatZ + 1).slice(0, 2), planeCrossings(b.indexed.base, seatZ + 1).slice(0, 2));
  assert.deepEqual(planeCrossings(a.indexed.base, seatZ - 1).slice(0, 1), planeCrossings(b.indexed.base, seatZ - 1).slice(0, 1));
  // y la torre no entra en el vacío de la rosca: queda macizo alrededor del agujero a la altura de la rosca
  const mid = validateLamp(lamp()).layout.ledgeZ + 1; // sobre el tope de la rosca y bajo la ranura del cilindro
  const crossings = planeCrossings(a.indexed.base, mid);
  assert.ok(Math.abs(crossings[0] - a.metrics.fit.tower.boreDiameterMm / 2) < 0.05, "agujero pasante también a la altura de la rosca");
  assert.ok(Math.abs(crossings[1] - a.metrics.fit.tower.towerDiameterMm / 2) < 0.1, "la torre sigue ahí, rodeada de aire");
});

test("la interfaz mecánica de la pantalla (cuello roscado o collar) no depende del portalámparas ni del cilindro", () => {
  const key = (r) => JSON.stringify(r.metrics.fit.thread);
  const ref = build(lamp());
  for (const patch of [
    { holder: { ...DEFAULT_LAMP.holder, boreDiameterMm: 44, ringsDiameterMm: 56, seatHeightMm: 30 } },
    { insert: { ...DEFAULT_LAMP.insert, diameterMm: 70, thicknessMm: 0.6 } },
    { insert: { ...DEFAULT_LAMP.insert, enabled: false } },
    { bulb: { ...DEFAULT_LAMP.bulb, diameterMm: 55 } },
  ]) assert.equal(key(build(lamp({}, patch))), key(ref), JSON.stringify(Object.keys(patch)));
});
