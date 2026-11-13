// Medición de las INTERFACES MECÁNICAS de una lámpara (portalámparas, canal del difusor, encastre inferior del difusor, rosca de la pantalla y rosca
// de la base) sobre las mallas y los STL que genera el motor real. La usan el generador de la línea base (scripts/lamp-mechanical-baseline.mjs) y la
// prueba de regresión (tests/maker-lamps-editor-mechanics.test.mjs): MISMA función en los dos lados, así que lo que se compara es el motor, no el medidor.
//
// Qué mide:
//  - `layout`: cotas del layout resuelto (radios de agujero, rebaje, ranura, rosca, tope, cuello, encastre).
//  - `base` / `shade` / `insert`: lista de radios de cruce de un semiplano que pasa por el eje (dos azimuts) a muchas alturas de cada zona de interfaz.
//    Los radios son los de la malla (poliedro inscrito), no los de diseño: se comparan contra la línea base con tolerancia 0,001 mm.
//  - `stl`: por pieza exportada (STL binario real, mismas mallas del visor): triángulos, caja, volumen y hash SHA-1 de los vértices redondeados a 0,001 mm.
import crypto from "node:crypto";
import { loadMakerModule } from "../../scripts/lib/maker-engine-node.mjs";
import { planeCrossings } from "./lamp-slice.mjs";

const { createLamp } = loadMakerModule("lib/maker/lamps/createLamp.ts");
const { validateLamp } = loadMakerModule("lib/maker/lamps/validation/validateLamp.ts");
const { lampPartEntries, lampTestPieceEntries } = loadMakerModule("lib/maker/lamps/exporters/lampFiles.ts");
const { buildSTLBlob } = loadMakerModule("lib/maker/exporters/exportSTL.ts");

const r3 = (n) => Math.round(n * 1000) / 1000;
const levels = (from, to, step) => {
  const out = [];
  for (let z = from; z <= to + 1e-9; z += step) out.push(r3(z));
  return out;
};
const AZIMUTHS = [0.37, 5.1]; // dos semiplanos y = cy (lado +X): una rosca helicoidal cambia con el azimut

/** Radios de cruce (redondeados) del `mesh` a cada altura de `zs`, en cada azimut. */
function profile(mesh, zs) {
  return Object.fromEntries(zs.map((z) => [String(z), AZIMUTHS.map((cy) => planeCrossings(mesh, z, cy).map(r3))]));
}

/** STL binario → { triangles, bbox, volume, hash } (hash de los vértices redondeados a 0,001 mm, en el orden del archivo). */
export function stlSummary(buffer) {
  const view = new DataView(buffer);
  const n = view.getUint32(80, true);
  const hash = crypto.createHash("sha1");
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let volume = 0;
  const f = (o) => view.getFloat32(o, true);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    const v = [0, 1, 2].map((i) => [f(o + i * 12), f(o + i * 12 + 4), f(o + i * 12 + 8)]);
    for (const p of v) {
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
      hash.update(`${r3(p[0])},${r3(p[1])},${r3(p[2])};`);
    }
    volume += (v[0][0] * (v[1][1] * v[2][2] - v[2][1] * v[1][2]) - v[1][0] * (v[0][1] * v[2][2] - v[2][1] * v[0][2]) + v[2][0] * (v[0][1] * v[1][2] - v[1][1] * v[0][2])) / 6;
  }
  return { triangles: n, bbox: [0, 1, 2].map((k) => r3(max[k] - min[k])), volumeMm3: Math.round(volume * 10) / 10, hash: hash.digest("hex").slice(0, 16) };
}

async function exportedStl(entries) {
  const out = {};
  for (const e of entries) out[e.fileName.replace(/^lampara_?/, "").replace(/\.stl$/, "") || "lampara"] = stlSummary(await buildSTLBlob(e.mesh).arrayBuffer());
  return out;
}

/** Mide las interfaces mecánicas de la definición `def` (debe ser válida). */
export async function measureMechanics(def) {
  const v = validateLamp(def);
  if (v.errors.length > 0 || !v.layout) throw new Error(`Diseño inválido para medir: ${v.errors.map((e) => e.code).join(", ")}`);
  const L = v.layout;
  const res = createLamp(def);
  if (res.errors.length > 0 || !res.indexed) throw new Error(`createLamp falló: ${res.errors.map((e) => e.code).join(", ")}`);
  const T = L.tower;

  const layout = {
    thread: { majorR: r3(L.spec.majorR), rootR: r3(L.spec.rootR), boreR: r3(L.spec.boreR), pitch: L.spec.pitch, starts: L.spec.starts, length: r3(L.spec.length), clearance: L.spec.clearance },
    mount: T.mount,
    hasFloor: T.hasFloor,
    tower: { boreR: r3(T.boreR), recessR: r3(T.recessR), seatZ: r3(T.seatZ), topZ: r3(T.topZ), towerR: r3(T.towerR), holderSeatZ: r3(T.holderSeatZ), slot: T.slot ? { innerR: r3(T.slot.innerR), outerR: r3(T.slot.outerR), bottomZ: r3(T.slot.bottomZ) } : null },
    ledgeZ: r3(L.ledgeZ),
    baseTopZ: r3(L.baseTopZ),
    neckTopZ: r3(L.neckTopZ),
    insertFit: L.insert ? { fitOuterR: r3(L.insert.fitOuterR), mountInnerR: r3(L.insert.mountInnerR), z0: r3(L.insert.z0) } : null,
  };

  // Alturas de cada zona de interfaz (sobre el layout resuelto).
  const baseZs = [...new Set([0.5, 5, 10, 15, r3(T.seatZ - 1), r3(T.seatZ + 1), ...(T.slot ? [r3(T.slot.bottomZ + 1), r3(T.slot.bottomZ + 5)] : []), r3(L.ledgeZ - 2), ...levels(L.ledgeZ + 0.3, L.baseTopZ - 0.2, 0.7)])].filter((z) => z > 0 && z < L.baseTopZ).sort((a, b) => a - b);
  const shadeZs = levels(L.ledgeZ + 0.3, L.neckTopZ, 0.7);
  const insertZs = L.insert ? levels(L.insert.z0 + 0.5, L.insert.z0 + 14, 0.7) : [];

  const stl = await exportedStl(lampPartEntries(res));
  let tests = null;
  try {
    tests = await exportedStl(lampTestPieceEntries(def));
  } catch {
    tests = null;
  }
  return {
    layout,
    base: profile(res.indexed.base, baseZs),
    shade: profile(res.indexed.shade, shadeZs),
    insert: res.indexed.insert ? profile(res.indexed.insert, insertZs) : null,
    stl,
    testPieces: tests,
  };
}

// ============================================================================================== matriz de diseños de referencia
const D = loadMakerModule("lib/maker/lamps/defaults.ts");
const { applyShadeType } = loadMakerModule("lib/maker/lamps/openwork/presets.ts");
const { applyHolderMount } = loadMakerModule("lib/maker/lamps/holder/applyMount.ts");

/** Bombilla LED pequeña tipo gota: con el marcador Ø60 × 85 los difusores Mossglow y Reloj de arena se rechazan por separación (comportamiento de la validación). */
const SMALL_BULB = { diameterMm: 30, heightAboveHolderMm: 45 };
const withStyle = (def, style) => D.applyInsertStyle(def, style);

/** Los diseños de la línea base (id → definición). Se guardan COMPLETOS en el fixture: la prueba no depende de cómo cambien los valores iniciales. */
export function referenceDesigns() {
  const base = D.DEFAULT_LAMP;
  const small = { ...base, bulb: SMALL_BULB };
  const openwork = applyShadeType(base, "openwork");
  const double = applyShadeType(base, "double");
  const designs = {
    "solid-default-cylinder": base,
    "solid-flat": withStyle(base, "flat"),
    "solid-drop": withStyle(base, "drop"),
    "solid-wavy": withStyle(base, "wavy"),
    "solid-mossglow": withStyle(small, "mossglow"),
    "solid-tulip": withStyle(small, "tulip"),
    "solid-hourglass": withStyle(small, "hourglass"),
    "solid-bell": withStyle(small, "bell"),
    "solid-collar": { ...base, thread: { ...base.thread, connection: "collar" } },
    "openwork-default": openwork,
    "double-default": double,
    "double-with-diffuser": { ...double, insert: { ...double.insert, enabled: true } },
    // Variantes mecánicas alternativas del motor (siguen existiendo y se leen igual; no son el estándar de los diseños nuevos).
    "alt-mount-press": applyHolderMount(base, "press").def,
    "alt-mount-threadBase2": applyHolderMount(base, "threadBase2").def,
    "alt-mount-threadV6": applyHolderMount(base, "threadV6").def,
  };
  return designs;
}
