import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";

// Este test carga los módulos TypeScript del pipeline geométrico de Stampa
// Maker (src/lib/maker/**) directamente con el compilador de TypeScript,
// igual que tests/calculator-pricing.test.mjs, pero resolviendo también el
// alias "@/..." y los imports relativos entre archivos del pipeline.

const root = process.cwd();
const srcRoot = path.join(root, "src");
const nodeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

function resolveModulePath(specifier, fromFile) {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.join(srcRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }
  const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`No se pudo resolver "${specifier}" desde ${fromFile}`);
}

function loadTsModule(absPath) {
  if (moduleCache.has(absPath)) return moduleCache.get(absPath).exports;

  const source = fs.readFileSync(absPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: absPath,
  });

  const mod = { exports: {} };
  moduleCache.set(absPath, mod);

  const localRequire = (specifier) => {
    const resolved = resolveModulePath(specifier, absPath);
    return resolved ? loadTsModule(resolved) : nodeRequire(specifier);
  };

  const fn = new Function("require", "module", "exports", "__filename", "__dirname", outputText);
  fn(localRequire, mod, mod.exports, absPath, path.dirname(absPath));
  return mod.exports;
}

function loadMakerModule(relFromSrc) {
  return loadTsModule(path.join(srcRoot, relFromSrc));
}

function topology(positions) {
  const key = (x, y, z) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
  const directed = new Map();
  let degenerate = 0;
  for (let t = 0; t < positions.length / 9; t++) {
    const o = t * 9;
    const v = [0, 1, 2].map((i) => [positions[o + i * 3], positions[o + i * 3 + 1], positions[o + i * 3 + 2]]);
    const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2];
    const wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
    if (Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2 < 1e-9) degenerate++;
    for (let e = 0; e < 3; e++) {
      const k = `${key(...v[e])}|${key(...v[(e + 1) % 3])}`;
      directed.set(k, (directed.get(k) || 0) + 1);
    }
  }
  let boundary = 0, nonManifold = 0;
  const seen = new Set();
  for (const k of directed.keys()) {
    const [a, b] = k.split("|");
    const u = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(u)) continue;
    seen.add(u);
    const f = directed.get(`${a}|${b}`) || 0, r = directed.get(`${b}|${a}`) || 0;
    if (f !== r) (f + r === 1 ? boundary++ : nonManifold++);
  }
  return { degenerate, boundary, nonManifold };
}
function components(positions) {
  const key = (x, y, z) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  for (let t = 0; t < positions.length / 9; t++) {
    const ks = [0, 1, 2].map((i) => key(positions[t * 9 + i * 3], positions[t * 9 + i * 3 + 1], positions[t * 9 + i * 3 + 2]));
    ks.forEach((k) => { if (!parent.has(k)) parent.set(k, k); });
    parent.set(find(ks[0]), find(ks[1]));
    parent.set(find(ks[1]), find(ks[2]));
  }
  return new Set([...parent.keys()].map(find)).size;
}


const { createLetterGeometry } = loadMakerModule("lib/maker/geometry/createLetterGeometry.ts");
const { DEFAULT_LETTER_SIGN_PARAMS } = loadMakerModule("lib/maker/defaults.ts");
const opentype = nodeRequire("opentype.js");
function loadFont(fileName) {
  const buf = fs.readFileSync(path.join(root, "public/fonts/maker", fileName));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
const font = loadFont("Montserrat-Bold.woff");
const inst = (patch) => ({ ...DEFAULT_LETTER_SIGN_PARAMS.installation, ...patch });
const gen = (text, installation, patch = {}, overrides = {}) =>
  createLetterGeometry(font, { ...DEFAULT_LETTER_SIGN_PARAMS, text, installation: inst(installation), installationOverrides: overrides, ...patch });
const standoff = { mounting: { ...DEFAULT_LETTER_SIGN_PARAMS.installation.mounting, type: "standoff" } };
const keyhole = { mounting: { ...DEFAULT_LETTER_SIGN_PARAMS.installation.mounting, type: "keyhole" } };
const chained = (extra = {}) => ({ wiring: { ...DEFAULT_LETTER_SIGN_PARAMS.installation.wiring, mode: "chained", ...extra } });


const layout = loadMakerModule("lib/maker/installation/layout.ts");
const spliceClip = loadMakerModule("lib/maker/installation/spliceClip.ts");
const wiring = loadMakerModule("lib/maker/installation/wiring.ts");
const offsets = loadMakerModule("lib/maker/geometry/offsets.ts");
const spacer = loadMakerModule("lib/maker/installation/wallSpacer.ts");
const instances = loadMakerModule("lib/maker/installation/letterInstances.ts");
const presets = loadMakerModule("lib/maker/presets/presetSettings.ts");
const projects = loadMakerModule("lib/maker/projects/projectData.ts");
const orient = loadMakerModule("lib/maker/printOrientation.ts");
const { backCutoutPolygons } = loadMakerModule("lib/maker/geometry/backCutouts.ts");
const { getInstallationSettings } = loadMakerModule("lib/maker/installation/defaults.ts");
const DEF = DEFAULT_LETTER_SIGN_PARAMS;

const meshBounds3 = (positions) => orient.meshBounds(positions);
// Área total de triángulos horizontales en el plano z cuya normal mira a nzSign.
function planarCapArea(mesh, z, nzSign) {
  let area = 0;
  const p = mesh.positions;
  for (let t = 0; t < mesh.triangleCount; t++) {
    const o = t * 9;
    if (Math.abs(p[o + 2] - z) > 1e-4 || Math.abs(p[o + 5] - z) > 1e-4 || Math.abs(p[o + 8] - z) > 1e-4) continue;
    const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1];
    const cross = ux * vy - uy * vx;
    if (Math.sign(cross) !== nzSign) continue;
    area += Math.abs(cross) / 2;
  }
  return area;
}

const watertight = (mesh) => {
  const t = topology(mesh.positions);
  return t.boundary === 0 && t.nonManifold === 0 && t.degenerate === 0 && components(mesh.positions) === 1;
};
const bodyOf = (r, i) => r.letters[i].parts.find((p) => p.kind === "body").mesh;
const abs = (r, p) => [r.installation.origin.x + p.x, r.installation.origin.y + p.y];
const paramsOf = (text, installation, patch = {}, overrides = {}) => ({ ...DEF, text, installation: inst(installation), installationOverrides: overrides, ...patch });
const coreOf = (r, i, params) => layout.letterSafeRegion(r.letters[i].instance, params);

// ---------------------------------------------------------- identidad y cableado

test("63 identidad: STAMPA => 6 unidades físicas independientes S,T,A1,M,P,A2", () => {
  const r = gen("STAMPA", {});
  assert.equal(r.letters.length, 6);
  assert.deepEqual(r.letters.map((l) => l.instance.label), ["S", "T", "A1", "M", "P", "A2"]);
  assert.equal(new Set(r.letters.map((l) => l.instance.id)).size, 6);
  assert.deepEqual(r.letters.map((l) => l.instance.char), ["S", "T", "A", "M", "P", "A"]);
  for (const l of r.letters) {
    assert.ok(l.instance.boundsMm.width > 0 && l.instance.contourGroups.length > 0);
    assert.equal(l.instance.positionInWord.index, l.index - 1);
    assert.equal(l.instance.positionInWord.count, 6);
  }
  assert.ok(r.letters[0].instance.positionInWord.isFirst && r.letters[5].instance.positionInWord.isLast);
  for (let i = 1; i < 6; i++) assert.ok(r.letters[i].instance.boundsMm.minX > r.letters[i - 1].instance.boundsMm.minX);
});

test("64 topología de cable L→R: primera power+out, intermedias in+out, última solo in", () => {
  const r = gen("STAMPA", chained());
  const roles = r.installation.wiring.letters.map((l) => [l.label, l.role.hasPowerIn, l.role.hasIn, l.role.hasOut]);
  assert.deepEqual(roles, [["S", true, false, true], ["T", false, true, true], ["A1", false, true, true], ["M", false, true, true], ["P", false, true, true], ["A2", false, true, false]]);
  const ports = r.installation.letters.map((l) => l.ports.map((p) => p.role).sort().join("+"));
  assert.deepEqual(ports, ["out+power-in", "in+out", "in+out", "in+out", "in+out", "in"]);
  assert.deepEqual(r.installation.wiring.physicalOrder, ["L1", "L2", "L3", "L4", "L5", "L6"]);
  for (const l of r.installation.letters) for (const p of l.ports) assert.equal(p.side, p.role === "out" ? "right" : "left");
});

test("65 paralelo: IN+ = LED+ = OUT+ (nunca LED -> LED en serie)", () => {
  const ins = instances.buildLetterInstances("STAMPA".split("").map((c) => ({ char: c, contourGroups: [] })));
  const model = wiring.buildWiringModel(ins, "ltr");
  assert.equal(model.topology, "parallel");
  for (const l of model.letters) {
    const plus = l.nets.find((n) => n.polarity === "+").terminals;
    const minus = l.nets.find((n) => n.polarity === "-").terminals;
    assert.ok(plus.includes("IN+") && plus.includes("LED+"));
    assert.ok(minus.includes("IN-") && minus.includes("LED-"));
    assert.equal(plus.includes("OUT+"), l.role.hasOut);
    assert.equal(minus.includes("OUT-"), l.role.hasOut);
    assert.ok(!plus.includes("LED-") && !minus.includes("LED+"));
  }
  for (const link of model.links) assert.deepEqual(link.joins, [["OUT+", "IN+"], ["OUT-", "IN-"]]);
  assert.equal(model.links.length, 5);
  const buses = wiring.computeElectricalBuses(model);
  assert.equal(buses.plus.length, 1);
  assert.equal(buses.minus.length, 1);
  assert.equal(buses.shorted, false);
  assert.ok(wiring.isParallelWiring(model));
  // Un cruce de polaridad entre letras (no paralelo) es rechazado por el detector.
  const crossed = { ...model, links: model.links.map((k) => ({ ...k, joins: [["OUT+", "IN-"], ["OUT-", "IN+"]] })) };
  assert.ok(!wiring.isParallelWiring(crossed));
});

test("66 reverse: R→L, A2 pasa a ser la primera y S la última; los ids no cambian", () => {
  const ltr = gen("STAMPA", chained());
  const rtl = gen("STAMPA", chained({ direction: "rtl" }));
  assert.deepEqual(rtl.letters.map((l) => l.instance.id), ltr.letters.map((l) => l.instance.id));
  assert.deepEqual(rtl.installation.wiring.physicalOrder, ["L6", "L5", "L4", "L3", "L2", "L1"]);
  const role = (r, label) => r.installation.wiring.letters.find((l) => l.label === label).role;
  assert.ok(role(rtl, "A2").isFirst && role(rtl, "A2").hasPowerIn && role(rtl, "A2").hasOut);
  assert.ok(role(rtl, "S").isLast && !role(rtl, "S").hasOut && role(rtl, "S").hasIn);
  const portsOf = (r, id) => r.installation.letters.find((l) => l.instanceId === id).ports;
  for (const p of portsOf(rtl, "L2")) assert.equal(p.side, p.role === "out" ? "left" : "right");
  assert.deepEqual(rtl.installation.cableLengths.map((c) => c.fromLabel), ["A2", "P", "M", "A1", "T"]);
});

// ------------------------------------------------------------------ montaje

test("67 keyhole: I,O,M,S con posiciones válidas sobre material, sin counters, cuerpo watertight", () => {
  for (const text of ["I", "O", "M", "S"]) {
    const params = paramsOf(text, keyhole);
    const r = createLetterGeometry(font, params);
    assert.deepEqual(r.errors, [], `${text}: sin errores`);
    const mounts = r.installation.letters[0].mounts;
    assert.ok(mounts.length >= 1, `${text}: al menos un keyhole`);
    const core = coreOf(r, 0, params);
    for (const m of mounts) {
      assert.ok(m.valid && m.kind === "keyhole");
      assert.ok(offsets.isPointInsideContourGroups(core, abs(r, m)), `${text}: cabeza sobre la cavidad real (no en un counter ni fuera)`);
      const polys = layout.keyholeMountPolygons(...abs(r, m), getInstallationSettings(params).mounting.keyhole);
      const outside = offsets.differenceRawPaths(polys.map(offsets.pointsToRawPath), offsets.contourGroupsToRawPaths(core));
      assert.ok(Math.abs(offsets.clipperPathsArea(outside)) < 1e-3, `${text}: keyhole completo dentro del material`);
    }
    assert.ok(watertight(bodyOf(r, 0)), `${text}: watertight`);
    const plain = gen(text, {});
    assert.ok(planarCapArea(bodyOf(r, 0), 0, -1) < planarCapArea(bodyOf(plain, 0), 0, -1) - 30, `${text}: keyholes recortados en la base`);
  }
});

test("67b keyhole: default de cabeza 7 mm, cuello 4 mm y cuello hacia arriba (para colgar)", () => {
  const k = DEF.installation.mounting.keyhole;
  assert.equal(k.headDiameterMm, 7);
  assert.equal(k.neckWidthMm, 4);
  const r = gen("M", keyhole);
  const m = r.installation.letters[0].mounts[0];
  const polys = layout.keyholeMountPolygons(...abs(r, m), k);
  const ys = polys.flat().map((p) => p[1]);
  assert.ok(Math.max(...ys) > abs(r, m)[1] + k.neckLengthMm - 0.1, "el cuello sube (círculo grande abajo)");
});

test("68 standoff: receptor con socket + boss (manifold), holgura, profundidad y refuerzo", () => {
  const r = gen("M", standoff);
  assert.deepEqual(r.errors, []);
  const s = DEF.installation.mounting.standoff;
  const body = bodyOf(r, 0);
  assert.ok(watertight(body));
  const mounts = r.installation.letters[0].mounts;
  assert.ok(mounts.length >= 2);
  const socketR = s.pegDiameterMm / 2 + s.clearanceMm;
  const bossR = Math.max(socketR + s.bossWallMm, s.bodyDiameterMm / 2);
  for (const m of mounts) {
    const [cx, cy] = abs(r, m);
    const ring = (z, radius, tol = 0.02) => {
      let n = 0;
      const p = body.positions;
      for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2] - z) < 1e-4 && Math.abs(Math.hypot(p[i] - cx, p[i + 1] - cy) - radius) < tol) n++;
      return n;
    };
    assert.ok(ring(s.insertDepthMm, socketR) >= 24, "pared del socket llega a la profundidad de encastre");
    assert.ok(ring(s.insertDepthMm + 1.2, bossR) >= 24, "refuerzo (boss) con techo sobre el socket");
    assert.ok(ring(0, socketR + 0.6, 0.03) >= 24, "boca con chaflán de entrada");
    assert.ok(ring(DEF.baseMm, bossR) >= 24, "el refuerzo nace en la repisa");
  }
  assert.ok(s.insertDepthMm + 1.2 - DEF.baseMm > 4 * DEF.baseMm, "refuerzo local mucho más alto que la base sola");
  assert.ok(meshBounds3(body.positions).minZ > -1e-6, "nada sobresale por detrás de la cara trasera");
});

test("68b separador de pared: manifold, agujero de tornillo, espiga con holgura y profundidad de encastre", () => {
  const s = DEF.installation.mounting.standoff;
  const mesh = spacer.buildWallSpacerMesh(s);
  assert.ok(watertight(mesh));
  const b = meshBounds3(mesh.positions);
  assert.ok(Math.abs(b.maxX - b.minX - s.bodyDiameterMm) < 0.02, "cuerpo de 12 mm");
  assert.ok(Math.abs(b.maxZ - b.minZ - (s.wallSpacingMm + spacer.pegLengthMm(s))) < 1e-3, "20 mm de separación + espiga");
  assert.ok(Math.abs(b.minZ) < 1e-6, "apoyado en Z=0");
  const radii = new Set();
  for (let i = 0; i < mesh.positions.length; i += 3) radii.add(Math.round(Math.hypot(mesh.positions[i], mesh.positions[i + 1]) * 10) / 10);
  for (const r of [6, 1.8, 2.9]) assert.ok([...radii].some((x) => Math.abs(x - r) < 0.11), `radio ${r} presente`);
  assert.ok(spacer.pegLengthMm(s) <= s.insertDepthMm, "la espiga no toca el techo del receptor");
  assert.deepEqual(spacer.validateWallSpacer(s), []);
  assert.ok(spacer.validateWallSpacer({ ...s, screwHoleDiameterMm: 7 }).length > 0);
  assert.ok(spacer.validateWallSpacer({ ...s, pegDiameterMm: 12 }).length > 0);
  // Holgura por lado: el receptor es 0.2 mm más ancho que la espiga.
  const r = gen("M", standoff);
  const m = r.installation.letters[0].mounts[0];
  const [cx, cy] = abs(r, m);
  const p = bodyOf(r, 0).positions;
  const socketRadii = new Set();
  for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2] - s.insertDepthMm) < 1e-4 && Math.hypot(p[i] - cx, p[i + 1] - cy) < 5) socketRadii.add(Math.round(Math.hypot(p[i] - cx, p[i + 1] - cy) * 100) / 100);
  assert.ok([...socketRadii].some((x) => Math.abs(x - (s.pegDiameterMm / 2 + s.clearanceMm)) < 0.03), "radio del socket = espiga/2 + holgura");
});

test("68c separadores exportables: una sola pieza + cantidad (no N archivos idénticos)", () => {
  const r = gen("STAMPA", standoff);
  assert.equal(r.installationParts.length, 1);
  const part = r.installationParts[0];
  assert.equal(part.fileBaseName, "wall-spacer-12x20");
  const mounts = r.installation.letters.flatMap((l) => l.mounts).filter((m) => m.valid);
  assert.equal(part.quantity, mounts.length);
  assert.ok(part.quantity >= 6);
  const custom = gen("STAMPA", { mounting: { ...DEF.installation.mounting, type: "standoff", standoff: { ...DEF.installation.mounting.standoff, wallSpacingMm: 30 } } });
  assert.equal(custom.installationParts[0].fileBaseName, "wall-spacer-12x30");
  assert.equal(gen("STAMPA", keyhole).installationParts.length, 0);
  assert.equal(gen("STAMPA", {}).installationParts.length, 0);
});

test("69 multi-mount: letra ancha con 2+ soportes separados; estrecha vertical; muy grande 3+; determinístico", () => {
  const wide = gen("M", standoff);
  const [a, b] = wide.installation.letters[0].mounts;
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > wide.letters[0].instance.boundsMm.width * 0.4, "separados horizontalmente");
  const narrow = gen("I", standoff);
  const nm = narrow.installation.letters[0].mounts;
  assert.ok(nm.length >= 1);
  if (nm.length >= 2) assert.ok(Math.abs(nm[0].y - nm[1].y) > Math.abs(nm[0].x - nm[1].x), "estrecha: vertical");
  const big = createLetterGeometry(font, paramsOf("M", standoff, { heightMm: 500 }));
  assert.ok(big.installation.letters[0].mounts.length >= 3, "letra muy grande: 3+ soportes");
  const three = createLetterGeometry(font, paramsOf("M", standoff, {}, { L1: { mountCount: 3 } }));
  assert.equal(three.installation.letters[0].mounts.length, 3);
  const again = gen("M", standoff);
  assert.deepEqual(again.installation.letters[0].mounts, wide.installation.letters[0].mounts);
  const s1 = gen("STAMPA", { ...standoff, ...chained() });
  const s2 = gen("STAMPA", { ...standoff, ...chained() });
  assert.deepEqual(s1.installation.letters, s2.installation.letters);
});

test("69b posiciones manuales: válidas se respetan; inválidas => error controlado, sin geometría corrupta", () => {
  const auto = gen("M", standoff);
  const pos = auto.installation.letters[0].mounts.map((m) => ({ x: m.x, y: m.y }));
  const manual = createLetterGeometry(font, paramsOf("M", standoff, {}, { L1: { mountPoints: pos } }));
  assert.deepEqual(manual.installation.letters[0].mounts.map((m) => [m.x, m.y]), pos.map((p) => [p.x, p.y]));
  assert.ok(manual.installation.letters[0].mounts.every((m) => m.source === "manual" && m.valid));
  const bad = createLetterGeometry(font, paramsOf("M", standoff, {}, { L1: { mountPoints: [{ x: 500, y: 500 }] } }));
  assert.ok(bad.errors.some((e) => e.code === "INSTALLATION_INVALID"));
  assert.ok(bad.installation.letters[0].mounts.some((m) => !m.valid));
  assert.ok(watertight(bodyOf(bad, 0)), "el punto inválido no genera geometría");
  assert.equal(bad.installationParts.length, 0, "sin puntos válidos no hay separadores");
});

// ------------------------------------------------------------------- puertos

test("70 puerto bipolar: cada IN/OUT = exactamente 2 agujeros (+ y -), diámetro y separación correctos, safe-zone cubre ambos", () => {
  const two = createLetterGeometry(font, paramsOf("TT", chained()));
  assert.deepEqual(two.errors, []);
  const w = DEF.installation.wiring;
  assert.equal(w.wireHoleDiameterMm, 2.8);
  assert.equal(w.holeCenterSpacingMm, 4.5);
  const [first, second] = two.installation.letters;
  const out = first.ports.find((p) => p.role === "out");
  const inn = second.ports.find((p) => p.role === "in");
  const power = first.ports.find((p) => p.role === "power-in");
  assert.ok(out && inn && power);
  const mid = (i) => two.letters[i].instance.boundsMm.minX + two.letters[i].instance.boundsMm.width / 2;
  assert.ok(abs(two, out)[0] > mid(0), "salida a la derecha");
  assert.ok(abs(two, inn)[0] < mid(1), "entrada a la izquierda");
  const core = coreOf(two, 0, paramsOf("TT", chained()));
  for (const p of [out, inn, power]) {
    assert.equal(p.holes.length, 2, "exactamente 2 agujeros");
    assert.deepEqual(p.holes.map((h) => h.polarity), ["+", "-"]);
    assert.equal(p.wireHoleDiameterMm, 2.8);
    assert.ok(Math.abs(Math.hypot(p.holes[0].x - p.holes[1].x, p.holes[0].y - p.holes[1].y) - 4.5) < 1e-6, "separación entre centros 4.5 mm");
    assert.ok(Math.abs(p.holes[0].x - p.holes[1].x) < 1e-9 && p.holes[0].y > p.holes[1].y, "par vertical: + arriba, - abajo");
    assert.ok(Math.abs((p.holes[0].y + p.holes[1].y) / 2 - p.y) < 1e-6 && Math.abs(p.holes[0].x - p.x) < 1e-9, "el par está centrado en x/y del puerto");
    assert.equal(p.placement.kind, "rear-edge");
    assert.equal(p.placement.preferred, "side-wall");
    assert.equal(p.placement.fallback, true);
  }
  // La zona segura cubre AMBOS agujeros de cada puerto de la primera letra (cavidad real, con margen de 1 mm).
  const safe = offsets.insetContourGroups(core, 1);
  for (const p of first.ports) {
    for (const h of p.holes) {
      const poly = backCutoutPolygons({ id: "h", type: "circle", x: 0, y: 0, diameterMm: 2.8 }, { x: abs(two, h)[0], y: abs(two, h)[1] }).map(offsets.pointsToRawPath);
      assert.ok(Math.abs(offsets.clipperPathsArea(offsets.differenceRawPaths(poly, safe))) < 1e-3, `${p.id} ${h.polarity} dentro de la zona segura`);
    }
  }
  // Geometría: DOS perforaciones circulares en la base por puerto (no una ranura ni un agujero único).
  for (let i = 0; i < 2; i++) assert.ok(watertight(bodyOf(two, i)));
  const plain = gen("TT", {});
  const holeArea = Math.PI * 1.4 * 1.4;
  const removed = planarCapArea(bodyOf(plain, 0), 0, -1) - planarCapArea(bodyOf(two, 0), 0, -1);
  assert.ok(Math.abs(removed - first.ports.length * 2 * holeArea) < 0.6, `área quitada = ${first.ports.length * 2} círculos de Ø2.8 (${removed.toFixed(2)})`);
  // Un puerto = UNA zona reservada que cubre ambos agujeros.
  const zone = first.zones.find((z) => z.id === out.id);
  assert.equal(first.zones.filter((z) => z.kind === "cable-port").length, first.ports.length);
  const zonePaths = zone.footprint.map(offsets.pointsToRawPath);
  for (const h of out.holes) {
    const hp = backCutoutPolygons({ id: "h", type: "circle", x: 0, y: 0, diameterMm: 2.8 }, { x: abs(two, h)[0], y: abs(two, h)[1] }).map(offsets.pointsToRawPath);
    assert.ok(Math.abs(offsets.clipperPathsArea(offsets.differenceRawPaths(hp, zonePaths))) < 0.05, "la zona cubre el agujero");
  }
  // Configurable.
  const custom = createLetterGeometry(font, paramsOf("TT", chained({ wireHoleDiameterMm: 3.2, holeCenterSpacingMm: 5.5 })));
  const cp = custom.installation.letters[0].ports[0];
  assert.equal(cp.wireHoleDiameterMm, 3.2);
  assert.ok(Math.abs(cp.holes[0].y - cp.holes[1].y - 5.5) < 1e-6);
  // Parámetros inválidos: agujero menor al conductor / separación sin pared entre agujeros => error controlado.
  assert.ok(gen("TT", chained({ wireHoleDiameterMm: 1.5 })).errors.some((e) => e.code === "INSTALLATION_INVALID"));
  assert.ok(gen("TT", chained({ holeCenterSpacingMm: 3.5 })).errors.some((e) => e.code === "INSTALLATION_INVALID"));
});

test("70b letra estrecha (I): no bloquea el cartel; falta de espacio => warning, no error", () => {
  const r = gen("IIII", { ...standoff, ...chained() });
  assert.deepEqual(r.errors, []);
  for (const l of r.letters) assert.ok(watertight(l.parts[0].mesh));
});

test("70c no quedan splice bays internos: sin bahías en el plan, sin geometría de bahía en el cuerpo, sin ajustes de empalme por letra", () => {
  const r = gen("STAMPA", chained());
  for (const l of r.installation.letters) {
    assert.equal(l.bays, undefined);
    assert.equal(l.route, undefined);
    assert.ok(l.zones.every((z) => ["mount", "cable-port", "cable-clip", "label"].includes(z.kind)));
    assert.ok(l.clips.length <= l.ports.length, "a lo sumo una retención local por puerto");
  }
  assert.equal(DEF.installation.wiring.splice, undefined);
  assert.equal(DEF.installation.wiring.portClearanceMm, undefined);
  // Cuerpo: solo puertos + clips locales + etiquetas (mucho menos que con bahías internas) y un solo shell.
  for (let i = 0; i < 6; i++) assert.ok(watertight(bodyOf(r, i)));
  assert.equal(r.installationParts.filter((p) => p.kind === "wallSpacer").length, 0);
});

test("71 clip externo: dos alojamientos paralelos, spacing, holgura, manifold, acceso abierto y sin piezas flotantes", () => {
  const s = DEF.installation.wiring.spliceClip;
  assert.deepEqual({ ...s }, { enabled: true, diameterMm: 5, lengthMm: 25, spacingMm: 12, clearanceMm: 0.4 });
  const sizes = spliceClip.spliceClipSizes(s);
  assert.ok(Math.abs(sizes.innerWidthMm - 5.8) < 1e-9 && Math.abs(sizes.innerLengthMm - 25.8) < 1e-9, "Ø + 2 x holgura; largo + 2 x holgura");
  const mesh = spliceClip.buildSpliceClipMesh(s);
  assert.ok(watertight(mesh), "manifold, watertight, un solo componente (sin piezas flotantes)");
  const b = meshBounds3(mesh.positions);
  assert.ok(Math.abs(b.minZ) < 1e-6, "apoya plano en Z=0");
  assert.ok(Math.abs(b.maxX - b.minX - sizes.plateLengthMm) < 1e-3 && Math.abs(b.maxY - b.minY - sizes.plateWidthMm) < 1e-3);
  // Superficies horizontales: el piso de cada canal está a Z = placa, en DOS bandas paralelas de ancho = interior.
  const floorZ = spliceClip.CLIP_PLATE_MM;
  const p = mesh.positions;
  const upFloor = [];
  for (let t = 0; t < mesh.triangleCount; t++) {
    const o = t * 9;
    if ([2, 5, 8].every((k) => Math.abs(p[o + k] - floorZ) < 1e-4) && mesh.normals[o + 2] > 0.9) upFloor.push([p[o], p[o + 1], p[o + 3], p[o + 4], p[o + 6], p[o + 7]]);
  }
  const ys = upFloor.flatMap((t) => [t[1], t[3], t[5]]);
  const centers = [s.spacingMm / 2, -s.spacingMm / 2];
  for (const cy of centers) {
    const inChannel = ys.filter((y) => Math.abs(y - cy) <= sizes.innerWidthMm / 2 + 1e-3);
    assert.ok(inChannel.length > 0, "hay piso en cada alojamiento");
    assert.ok(Math.max(...inChannel) - Math.min(...inChannel) >= sizes.innerWidthMm - 1e-3, "el alojamiento mide el interior configurado");
  }
  // Separación entre alojamientos (centro a centro) = spacing y pared entre canales >= 1.2 mm.
  assert.ok(Math.abs(centers[0] - centers[1] - 12) < 1e-9);
  assert.ok(12 - sizes.outerWidthMm >= 1.2 - 1e-9);
  // Acceso abierto: por arriba del canal, entre pestañas, no hay material (la abertura >= 80 % del Ø del empalme).
  const opening = sizes.innerWidthMm - 2 * spliceClip.CLIP_TAB_OVERHANG_MM;
  assert.ok(opening >= s.diameterMm * 0.8, "abertura de inserción");
  for (let t = 0; t < mesh.triangleCount; t++) {
    const o = t * 9;
    const zAll = [p[o + 2], p[o + 5], p[o + 8]];
    if (zAll.every((z) => z > floorZ + 1e-3)) {
      for (const cy of centers) for (const k of [1, 4, 7]) assert.ok(Math.abs(p[o + k] - cy) >= opening / 2 - 1e-3, "nada cubre el centro del canal (inserción abierta por arriba)");
    }
  }
  // Extremos abiertos: los rieles no tienen pared en los extremos del canal (los cables salen).
  const railMaxX = Math.max(...[...Array(mesh.triangleCount * 3).keys()].filter((k) => p[k * 3 + 2] > floorZ + 0.5).map((k) => p[k * 3]));
  assert.ok(Math.abs(railMaxX - sizes.innerLengthMm / 2) < 1e-3);
  // Configurable y validado.
  const big = spliceClip.buildSpliceClipMesh({ ...s, diameterMm: 6, lengthMm: 30, spacingMm: 14 });
  assert.ok(watertight(big));
  assert.ok(spliceClip.validateSpliceClip({ ...s, spacingMm: 8 }).length > 0, "alojamientos demasiado juntos");
  assert.deepEqual(spliceClip.validateSpliceClip(s), []);
  // Sin componentes eléctricos: es una pieza de solo plástico sin geometría de contacto (única forma cerrada, sin agujeros pasantes).
  assert.equal(components(mesh.positions), 1);
});

test("71b cantidad de clips: 1 letra => 0, 2 letras => 1, 6 letras => 5; una sola pieza exportable", () => {
  assert.equal(gen("M", chained()).installation.spliceClipCount, 0);
  assert.equal(gen("M", chained()).installationParts.length, 0);
  const two = gen("MM", chained());
  assert.equal(two.installation.spliceClipCount, 1);
  const six = gen("STAMPA", chained());
  assert.equal(six.installation.spliceClipCount, 5);
  const clips = six.installationParts.filter((p) => p.kind === "bipolarSpliceClip");
  assert.equal(clips.length, 1, "UN solo STL");
  assert.equal(clips[0].fileBaseName, "bipolar-splice-clip");
  assert.equal(clips[0].quantity, 5);
  assert.equal(gen("STAMPA", chained({ spliceClip: { ...DEF.installation.wiring.spliceClip, enabled: false } })).installationParts.length, 0);
  assert.equal(gen("STAMPA", {}).installation, null);
  assert.equal(gen("STAMPA", keyhole).installationParts.length, 0);
  // Con separadores + cableado: ambas piezas, cada una una sola vez.
  const both = gen("STAMPA", { ...standoff, ...chained() });
  assert.deepEqual(both.installationParts.map((p) => [p.kind, p.quantity]).sort(), [["bipolarSpliceClip", 5], ["wallSpacer", both.installationParts.find((p) => p.kind === "wallSpacer").quantity]].sort());
});

test("72 retención local: un clip por puerto, junto al par y hacia el interior; sin rutas internas ni solapes", () => {
  const r = gen("STAMPA", chained());
  let checked = 0;
  for (const l of r.installation.letters) {
    for (const port of l.ports) {
      const clips = l.clips.filter((c) => c.portId === port.id);
      assert.ok(clips.length <= 1);
      for (const c of clips) {
        checked++;
        assert.ok(c.distanceFromPortMm >= 5, "el clip está a distancia del puerto");
        assert.ok(c.gapMm >= port.holeCenterSpacingMm + 2, "el clip abraza los dos conductores del par");
        const interior = port.side === "left" ? c.x > port.x : c.x < port.x;
        assert.ok(interior, "el clip queda del lado interior de la letra");
        assert.ok(Math.abs(c.y - port.y) < 1e-6, "alineado con el par");
      }
    }
    for (let i = 0; i < l.zones.length; i++) for (let j = i + 1; j < l.zones.length; j++) assert.ok(!layout.zonesConflict(l.zones[i], l.zones[j]), `${l.zones[i].id} / ${l.zones[j].id}`);
  }
  assert.ok(checked >= 6);
  for (let i = 0; i < r.letters.length; i++) assert.ok(watertight(bodyOf(r, i)), `letra ${i} watertight`);
});

test("72b conexiones bipolares: datos de ruta visual completos por tramo (+ y - separados, posición del clip)", () => {
  const r = gen("STAMPA", chained());
  const cons = r.installation.connections;
  assert.equal(cons.length, 5);
  assert.deepEqual(cons.map((c) => `${c.fromLabel}>${c.toLabel}`), ["S>T", "T>A1", "A1>M", "M>P", "P>A2"]);
  cons.forEach((c, i) => {
    assert.equal(c.fromLetter, `L${i + 1}`);
    assert.equal(c.toLetter, `L${i + 2}`);
    const from = r.installation.letters[i].ports.find((p) => p.id === c.fromPort);
    const to = r.installation.letters[i + 1].ports.find((p) => p.id === c.toPort);
    assert.equal(from.role, "out");
    assert.equal(to.role, "in");
    assert.equal(c.positivePath.length, 2);
    assert.equal(c.negativePath.length, 2);
    assert.deepEqual(c.positivePath[0], { x: from.holes[0].x, y: from.holes[0].y });
    assert.deepEqual(c.positivePath[1], { x: to.holes[0].x, y: to.holes[0].y });
    assert.deepEqual(c.negativePath[0], { x: from.holes[1].x, y: from.holes[1].y });
    assert.deepEqual(c.negativePath[1], { x: to.holes[1].x, y: to.holes[1].y });
    assert.notDeepEqual(c.positivePath, c.negativePath, "no es una única línea genérica");
    assert.ok(Math.abs(c.clipPosition.x - (from.x + to.x) / 2) < 1e-9 && Math.abs(c.clipPosition.y - (from.y + to.y) / 2) < 1e-9, "clip en el punto medio");
    assert.ok(Math.abs(c.distanceMm - Math.hypot(to.x - from.x, to.y - from.y)) < 1e-9);
  });
  // R→L invierte el sentido, no los ids.
  const rtl = gen("STAMPA", chained({ direction: "rtl" }));
  assert.deepEqual(rtl.installation.connections.map((c) => `${c.fromLabel}>${c.toLabel}`), ["A2>P", "P>M", "M>A1", "A1>T", "T>S"]);
});

test("73 features traseras combinadas: 2 standoffs + IN + OUT (pares) + recorte manual, sin solapes", () => {
  const probe = gen("MM", {});
  const b0 = probe.letters[0].instance.boundsMm;
  const cut = { id: "usb", type: "capsule", x: b0.minX + 11 - probe.designCenter.x, y: (b0.minY + b0.maxY) / 2 - probe.designCenter.y, widthMm: 12, heightMm: 6, rotationDeg: 90 };
  const r = createLetterGeometry(font, paramsOf("MM", { ...standoff, ...chained() }, { backCutouts: [cut] }));
  assert.deepEqual(r.errors, []);
  for (const l of r.installation.letters) {
    assert.ok(l.mounts.length >= 2);
    assert.ok(l.ports.length >= 1 && l.ports.every((p) => p.holes.length === 2));
    for (let i = 0; i < l.zones.length; i++) for (let j = i + 1; j < l.zones.length; j++) assert.ok(!layout.zonesConflict(l.zones[i], l.zones[j]));
  }
  const cutRaw = backCutoutPolygons(cut, r.designCenter).map(offsets.pointsToRawPath);
  for (const l of r.installation.letters) for (const z of l.zones) {
    const overlap = offsets.intersectRawPaths(z.footprint.map(offsets.pointsToRawPath), cutRaw);
    assert.ok(Math.abs(offsets.clipperPathsArea(overlap)) < 1e-3, `${z.id} no invade el recorte`);
  }
  for (let i = 0; i < 2; i++) assert.ok(watertight(bodyOf(r, i)));
  const clash = createLetterGeometry(font, paramsOf("M", { ...standoff, ...chained() }, { backCutouts: [{ id: "c", type: "circle", x: 0, y: 0, diameterMm: 6 }] }, { L1: { mountPoints: [{ x: 0, y: 0 }] } }));
  assert.ok(clash.errors.length > 0, "mount manual sobre un recorte es un error (no se permite en silencio)");
});

test("longitudes de cable entre letras: distancia entre puertos + margen de servicio", () => {
  const r = gen("STAMPA", chained());
  const lens = r.installation.cableLengths;
  assert.deepEqual(lens.map((c) => `${c.fromLabel}>${c.toLabel}`), ["S>T", "T>A1", "A1>M", "M>P", "P>A2"]);
  for (const c of lens) {
    assert.ok(c.distanceMm > 0);
    assert.ok(Math.abs(c.lengthMm - (c.distanceMm + 30)) < 1e-9, "margen de servicio 30 mm");
  }
  const noMargin = gen("STAMPA", chained({ serviceMarginMm: 0 }));
  assert.ok(Math.abs(noMargin.installation.cableLengths[0].lengthMm - lens[0].distanceMm) < 1e-6);
});

// ------------------------------------------------------------------ validaciones

test("validaciones: frente de canal luminoso, alturas y avisos no bloqueantes", () => {
  const lc = gen("O", standoff, { frontType: "light-channel" });
  assert.ok(lc.errors.some((e) => e.code === "INSTALLATION_INVALID"));
  const shallow = gen("M", standoff, { depthMm: 5 });
  assert.ok(shallow.errors.some((e) => e.message.includes("no cabe en la cavidad")), "boss más alto que la cavidad");
  const keyholeWiring = gen("MM", { ...keyhole, ...chained() });
  assert.ok(keyholeWiring.warnings.some((w) => w.message.includes("Keyhole")), "aviso: salida trasera con montaje pegado a la pared");
  assert.deepEqual(keyholeWiring.errors, []);
  const badSpacer = gen("M", { mounting: { ...DEF.installation.mounting, type: "standoff", standoff: { ...DEF.installation.mounting.standoff, pegDiameterMm: 14 } } });
  assert.ok(badSpacer.errors.length > 0);
});

test("cuerpo tapered y bisel posterior conviven con la instalación (watertight)", () => {
  const tapered = gen("M", { ...standoff, ...chained() }, { bodyType: "tapered", rearExpansionMm: 2 });
  assert.deepEqual(tapered.errors, []);
  assert.ok(watertight(bodyOf(tapered, 0)));
  const bevel = gen("M", { ...standoff, ...chained() }, { rearBevelEnabled: true, rearBevelInsetMm: 1 });
  assert.deepEqual(bevel.errors, []);
  assert.ok(watertight(bodyOf(bevel, 0)));
});

test("sin instalación el resultado es idéntico (cuerpo byte a byte)", () => {
  const plain = createLetterGeometry(font, { ...DEF, text: "MA" });
  const none = createLetterGeometry(font, { ...DEF, text: "MA", installation: inst({}) });
  assert.equal(none.installation, null);
  assert.equal(none.installationParts.length, 0);
  assert.deepEqual(Array.from(bodyOf(none, 0).positions), Array.from(bodyOf(plain, 0).positions));
});

test("los cables NO son geometría: solo hay piezas imprimibles, un componente por letra", () => {
  const r = gen("STAMPA", chained());
  for (const l of r.letters) {
    assert.equal(l.parts.length, 1);
    assert.equal(components(l.parts[0].mesh.positions), 1);
  }
});

// ------------------------------------------------------------- presets / proyecto

test("presets: la receta de instalación viaja; posiciones/overrides NUNCA", () => {
  const params = paramsOf("STAMPA", { ...standoff, ...chained({ direction: "rtl" }) }, {}, { L1: { mountPoints: [{ x: 1, y: 2 }] } });
  const settings = presets.extractPresetSettings(params);
  assert.equal(settings.installation.mounting.type, "standoff");
  assert.equal(settings.installation.wiring.direction, "rtl");
  assert.ok(!("installationOverrides" in settings));
  assert.ok(!JSON.stringify(settings).includes("mountPoints"));
  const applied = presets.applyPresetSettings({ ...DEF, text: "OTRO", installationOverrides: { L9: { mountCount: 4 } } }, settings);
  assert.equal(applied.installation.wiring.direction, "rtl");
  assert.equal(applied.text, "OTRO");
  assert.deepEqual(applied.installationOverrides, { L9: { mountCount: 4 } }, "el preset no pisa los overrides del proyecto");
  assert.ok(presets.isPresetModified({ ...params, installation: inst({}) }, settings));
  assert.ok(!presets.isPresetModified(params, settings));
  const tolerant = presets.normalizePresetSettings({ installation: { mounting: { type: "raro" }, wiring: { mode: "chained", wireDiameterMm: "x" } } });
  assert.equal(tolerant.installation.mounting.type, "none");
  assert.equal(tolerant.installation.wiring.mode, "chained");
  assert.equal(tolerant.installation.wiring.wireDiameterMm, 2);
});

test("proyecto: persiste instalación + overrides (round-trip), proyectos viejos cargan con defaults, cambios marcan dirty", () => {
  const params = paramsOf("STAMPA", { ...keyhole, ...chained() }, {}, { L3: { mountPoints: [{ x: 4.5, y: -2 }], mountCount: 3 } });
  const state = { params, sourceMode: "text", designHeightMm: 100, pngOptions: {}, fileMeta: null };
  const payload = projects.serializeProject(state);
  const loaded = projects.deserializeProject({ ...payload });
  assert.deepEqual(loaded.params.installation, params.installation);
  assert.deepEqual(loaded.params.installationOverrides, params.installationOverrides);
  const old = projects.deserializeProject({ source_type: "text", source_data: { text: "AB", fontId: "montserrat-bold", heightMm: 80 }, settings: { depthMm: 30 }, schema_version: 1 });
  assert.deepEqual(old.params.installation, DEF.installation);
  assert.deepEqual(old.params.installationOverrides, {});
  const sig = projects.projectSignature(state, null);
  const dirty = (patch) => projects.projectSignature({ ...state, params: { ...params, ...patch } }, null) !== sig;
  assert.ok(!dirty({}));
  assert.ok(dirty({ installation: inst({ mounting: { ...params.installation.mounting, type: "standoff" } }) }), "montaje");
  assert.ok(dirty({ installation: inst({ mounting: { ...params.installation.mounting, standoff: { ...params.installation.mounting.standoff, wallSpacingMm: 25 } } }) }), "separación");
  assert.ok(dirty({ installation: inst({ wiring: { ...params.installation.wiring, direction: "rtl" } }) }), "dirección");
  assert.ok(dirty({ installation: inst({ wiring: { ...params.installation.wiring, wireDiameterMm: 3 } }) }), "cable");
  assert.ok(dirty({ installation: inst({ wiring: { ...params.installation.wiring, spliceClip: { ...params.installation.wiring.spliceClip, diameterMm: 6 } } }) }), "soporte de empalmes");
  assert.ok(dirty({ installation: inst({ wiring: { ...params.installation.wiring, wireHoleDiameterMm: 3 } }) }), "agujero del puerto");
  assert.ok(dirty({ installation: inst({ wiring: { ...params.installation.wiring, holeCenterSpacingMm: 5 } }) }), "separación de agujeros");
  assert.ok(dirty({ installationOverrides: { L3: { mountPoints: [{ x: 9, y: 9 }] } } }), "posiciones manuales");
});

// ------------------------------------------------------------ PDF: plantilla y guía

const pdfw = loadMakerModule("lib/maker/installation/pdf/pdfWriter.ts");
const tpl = loadMakerModule("lib/maker/installation/pdf/template.ts");
const guide = loadMakerModule("lib/maker/installation/pdf/wiringGuide.ts");
const kit = loadMakerModule("lib/maker/exporters/exportInstallKit.ts");
const JSZipLib = nodeRequire("jszip");

const latin1 = (bytes) => Buffer.from(bytes).toString("latin1");
// Mismo redondeo que el escritor (4 decimales, sin ceros a la derecha).
const fmt = (n) => (Math.round(n * 10000) / 10000).toFixed(4).replace(/\.?0+$/, "") || "0";
const pages = (text) => text.split(/\d+ 0 obj\n<< \/Length \d+ >>\nstream\n/).slice(1).map((c) => c.split("\nendstream")[0]);
const pdfTexts = (content) => [...content.matchAll(/\((.*?)\) Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, "$1"));
const pdfScale = (content) => Number(content.split("\n")[0].split(" ")[0]);

test("74 escala: 1 unidad = 1 mm (mm -> puntos PDF) con tolerancia mínima", () => {
  assert.ok(Math.abs(pdfw.mmToPt(100) - 283.4645669) < 1e-6);
  assert.ok(Math.abs(pdfw.ptToMm(pdfw.mmToPt(123.4)) - 123.4) < 1e-9);
  const doc = new pdfw.PdfDocument();
  const page = doc.addPage(210, 297);
  page.line(20, 50, 120, 50);
  const text = latin1(doc.toBytes());
  assert.ok(text.startsWith("%PDF-1.4"));
  const box = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  assert.ok(Math.abs(Number(box[1]) - 595.2756) < 0.01 && Math.abs(Number(box[2]) - 841.8898) < 0.01, "A4 real en puntos");
  const [content] = pages(text);
  const s = pdfScale(content);
  assert.ok(Math.abs(s - 72 / 25.4) < 1e-4, "matriz fija mm -> pt");
  const m = content.match(/(\S+) (\S+) m\n(\S+) (\S+) l\nS/);
  const lengthPt = (Number(m[3]) - Number(m[1])) * s;
  assert.ok(Math.abs(lengthPt - pdfw.mmToPt(100)) < 0.01, "100 mm miden 283.46 pt");
  // xref válido: cada offset apunta a "N 0 obj".
  const xref = text.indexOf("xref\n");
  assert.equal(Number(text.match(/startxref\n(\d+)/)[1]), xref);
  const entries = [...text.slice(xref).matchAll(/(\d{10}) 00000 n /g)].map((e) => Number(e[1]));
  entries.forEach((off, i) => assert.ok(text.slice(off).startsWith(`${i + 1} 0 obj`)));
});

test("74b plantilla: contornos = los ContourGroup reales, control de 100 mm y texto de calibración", () => {
  const params = paramsOf("STAMPA", standoff);
  const r = createLetterGeometry(font, params);
  const model = tpl.buildTemplateModel(r, params, "STAMPA");
  const text = latin1(tpl.buildInstallTemplatePdf(model));
  const cs = pages(text);
  assert.ok(cs.length >= 1);
  // Mismos vértices del diseño real (no se recalcula el texto).
  const first = r.letters[0].instance.contourGroups[0].outer[0];
  assert.ok(cs[0].includes(`${fmt(first[0])} ${fmt(first[1])} m`), "el primer vértice de la S está en el PDF");
  for (const c of cs) {
    assert.ok(Math.abs(pdfScale(c) - 72 / 25.4) < 1e-4, "sin escalado");
    const texts = pdfTexts(c);
    assert.ok(texts.some((t) => t.includes("Imprimir al 100% / Tamaño real.")));
    assert.ok(texts.some((t) => t.includes("Verificar que esta referencia mida 100 mm.")));
    // Línea de control de exactamente 100 mm (mismo Y, ΔX = 100).
    const lines = [...c.matchAll(/(\S+) (\S+) m\n(\S+) (\S+) l\nS/g)].filter((m) => Math.abs(Number(m[1]) - Number(m[3]) + 100) < 1e-6 && m[2] === m[4]);
    assert.ok(lines.length >= 1, "línea de control de 100 mm");
  }
  // Textos: cotas, nivel, IDs de letra.
  const all = cs.flatMap(pdfTexts).join("|");
  for (const t of ["Línea de nivel", "Ancho total:", "Alto máx.:", "A1", "A2"]) assert.ok(all.includes(t), t);
  assert.ok(Math.abs(model.widthMm - (r.letters[5].instance.boundsMm.maxX - r.letters[0].instance.boundsMm.minX)) < 1e-6);
});

test("75 tiling: 1000 mm en A4 => varias hojas con 10 mm de superposición, cobertura completa y sin escalar", () => {
  const layout = tpl.computeTemplateLayout(1000, 100, "A4", 10);
  assert.ok(layout.tiles.length > 1);
  assert.equal(layout.cols * layout.rows, layout.tiles.length);
  assert.equal(layout.overlapMm, 10);
  assert.ok(layout.pageWidthMm === 297 || layout.pageWidthMm === 210);
  const row0 = layout.tiles.filter((t) => t.row === 0).sort((a, b) => a.col - b.col);
  for (let i = 1; i < row0.length; i++) assert.ok(Math.abs(row0[i - 1].x1 - row0[i].x0 - 10) < 1e-9, "superposición de 10 mm");
  assert.ok(row0[0].x0 <= layout.content.x0 + 1e-9 && row0[row0.length - 1].x1 >= layout.content.x1 - 1e-9, "cobertura horizontal completa");
  const col0 = layout.tiles.filter((t) => t.col === 0).sort((a, b) => a.row - b.row);
  assert.ok(col0[0].y1 >= layout.content.y1 - 1e-9 && col0[col0.length - 1].y0 <= layout.content.y0 + 1e-9, "cobertura vertical completa");
  for (const t of layout.tiles) assert.ok(Math.abs(t.x1 - t.x0 - layout.usableWidthMm) < 1e-9 && Math.abs(t.y1 - t.y0 - layout.usableHeightMm) < 1e-9, "cada hoja cubre su área útil 1:1");
  // Un cartel pequeño entra en una sola hoja; A3 y Carta cambian el papel.
  assert.equal(tpl.computeTemplateLayout(100, 60, "A4", 10).tiles.length, 1);
  assert.ok(tpl.computeTemplateLayout(1000, 100, "A3", 10).tiles.length < layout.tiles.length);
  const letter = tpl.computeTemplateLayout(100, 60, "Letter", 10);
  assert.ok(Math.abs(Math.min(letter.pageWidthMm, letter.pageHeightMm) - 215.9) < 1e-9);
  // Documento real: N páginas, cada una con MediaBox del papel y marcas de corte/alineación.
  const params = paramsOf("STAMPA", standoff, {}, {});
  const r = createLetterGeometry(font, { ...params, heightMm: 300 });
  const model = tpl.buildTemplateModel(r, { ...params, heightMm: 300 }, "STAMPA");
  const l2 = tpl.computeTemplateLayout(model.widthMm, model.heightMm, "A4", 10);
  assert.ok(l2.tiles.length >= 4);
  const text = latin1(tpl.buildInstallTemplatePdf(model));
  assert.equal((text.match(/\/Type \/Page /g) || []).length, l2.tiles.length);
  const cs = pages(text);
  cs.forEach((c, i) => {
    assert.ok(pdfTexts(c).some((t) => t.includes(`Página ${i + 1} / ${l2.tiles.length}`)), "Página X / Y");
    assert.ok(Math.abs(pdfScale(c) - 72 / 25.4) < 1e-4);
  });
  assert.ok(cs.some((c) => c.includes("[2 2] 0 d")), "líneas de alineación punteadas entre hojas");
});

test("76 posiciones de la plantilla = posiciones 3D (una sola fuente de verdad)", () => {
  // Separadores: cada marca coincide con el receptor real del cuerpo.
  const params = paramsOf("STAMPA", { ...standoff, ...chained() });
  const r = createLetterGeometry(font, params);
  const model = tpl.buildTemplateModel(r, params, "STAMPA");
  const stand = model.marks.filter((m) => m.kind === "standoff");
  const mounts = r.installation.letters.flatMap((l) => l.mounts.filter((m) => m.valid));
  assert.equal(stand.length, mounts.length);
  assert.deepEqual(stand.map((m) => m.label.split("-")[0]), r.installation.letters.flatMap((l, i) => l.mounts.filter((m) => m.valid).map(() => r.letters[i].instance.label)));
  assert.ok(stand.some((m) => m.label === "S-S1") && stand.some((m) => m.label === "M-S2"), "IDs M-S1, M-S2...");
  const s = DEF.installation.mounting.standoff;
  stand.forEach((mark, i) => {
    const [ax, ay] = abs(r, mounts[i]);
    assert.ok(Math.abs(mark.x - ax) < 1e-9 && Math.abs(mark.y - ay) < 1e-9);
    // ...y esa posición es el centro real del socket del cuerpo.
    const li = r.installation.letters.findIndex((l) => l.mounts.includes(mounts[i]));
    const p = bodyOf(r, li).positions;
    let ring = 0;
    for (let k = 0; k < p.length; k += 3) if (Math.abs(p[k + 2] - s.insertDepthMm) < 1e-4 && Math.abs(Math.hypot(p[k] - mark.x, p[k + 1] - mark.y) - (s.pegDiameterMm / 2 + s.clearanceMm)) < 0.02) ring++;
    assert.ok(ring >= 24, `socket de ${mark.label} centrado en la marca`);
    assert.equal(mark.diameterMm, s.screwHoleDiameterMm);
  });
  // Puertos: mismas posiciones que los agujeros del plan.
  const ports = model.marks.filter((m) => m.kind === "cable-port");
  const planPorts = r.installation.letters.flatMap((l) => l.ports);
  assert.equal(ports.length, planPorts.length * 2, "DOS pasos de cable por puerto bipolar");
  for (const pp of planPorts) {
    const holes = ports.filter((m) => m.id.startsWith(`${pp.id}:`));
    assert.deepEqual(holes.map((m) => m.label.slice(-1)), ["+", "-"]);
    holes.forEach((mark, i) => {
      // Misma posición que cada uno de los dos agujeros del 3D.
      assert.ok(Math.abs(mark.x - abs(r, pp.holes[i])[0]) < 1e-9 && Math.abs(mark.y - abs(r, pp.holes[i])[1]) < 1e-9);
      assert.equal(mark.diameterMm, pp.wireHoleDiameterMm);
    });
  }
  // ...y esas posiciones son agujeros reales de la base: círculos de Ø2.8 en el cuerpo.
  const portLetter = r.installation.letters[1];
  const pl = portLetter.ports[0];
  const pb = bodyOf(r, 1).positions;
  for (const h of pl.holes) {
    const [hx, hy] = abs(r, h);
    let ring = 0;
    for (let k = 0; k < pb.length; k += 3) if (Math.abs(pb[k + 2]) < 1e-4 && Math.abs(Math.hypot(pb[k] - hx, pb[k + 1] - hy) - 1.4) < 0.02) ring++;
    assert.ok(ring >= 24, `agujero ${h.polarity} del 3D en la posición de la plantilla`);
  }
  // Leyenda y dos círculos por puerto en el PDF.
  const pdfText = latin1(tpl.buildInstallTemplatePdf(model));
  assert.ok(pdfTexts(pages(pdfText)[0]).some((t) => t.includes("Paso de cable bipolar (+ / -)")));
  assert.ok(pdfTexts(pages(pdfText).join("\n")).some((t) => t === "IN+") && pdfTexts(pages(pdfText).join("\n")).some((t) => t === "IN-"));
  // Las marcas están en el PDF (coordenadas relativas al diseño).
  const text = latin1(tpl.buildInstallTemplatePdf(model));
  const mark = stand[0];
  assert.ok(pages(text)[0].includes(`${fmt(mark.x - model.bounds.minX + s.screwHoleDiameterMm / 2)} ${fmt(mark.y - model.bounds.minY)} m`), "el círculo de la marca está en el PDF");
  // Keyhole: el punto de perforación es el extremo del cuello del keyhole 3D.
  const kp = paramsOf("MM", keyhole);
  const kr = createLetterGeometry(font, kp);
  const km = tpl.buildTemplateModel(kr, kp, "MM").marks.filter((m) => m.kind === "keyhole-drill");
  assert.ok(km.length >= 2);
  const kmounts = kr.installation.letters.flatMap((l) => l.mounts);
  km.forEach((mark2, i) => {
    const polys = layout.keyholeMountPolygons(...abs(kr, kmounts[i]), DEF.installation.mounting.keyhole);
    const top = Math.max(...polys.flat().map((pt) => pt[1]));
    assert.ok(Math.abs(mark2.y - (top - DEF.installation.mounting.keyhole.neckWidthMm / 2)) < 0.05, "perforación = centro del extremo del cuello");
    assert.ok(Math.abs(mark2.x - abs(kr, kmounts[i])[0]) < 1e-9);
    assert.equal(mark2.diameterMm, 4);
    assert.match(mark2.label, /^M[12]?-K\d$/);
  });
  // Sin perforaciones inventadas: el cableado no agrega marcas de pared, solo pasos de la letra y rutas de referencia.
  const cr = createLetterGeometry(font, paramsOf("STAMPA", chained()));
  const cm = tpl.buildTemplateModel(cr, paramsOf("STAMPA", chained()), "STAMPA");
  assert.ok(cm.marks.every((m) => m.kind === "cable-port"));
  assert.equal(cm.routes.length, 10, "dos líneas (+ y -) por tramo");
  assert.deepEqual([...new Set(cm.routes.map((x) => x.polarity))].sort(), ["+", "-"]);
  assert.equal(cm.clips.length, 5, "soporte de empalmes de referencia por tramo (sin perforar la pared)");
});

test("77 guía de conexión: orden, roles, etiquetas y polaridad de STAMPA (paralelo)", () => {
  const params = paramsOf("STAMPA", { ...standoff, ...chained({ voltage: "12V" }) });
  const r = createLetterGeometry(font, params);
  const model = r.installation.wiring;
  assert.equal(guide.wiringOrderText(model), "S → T → A1 → M → P → A2");
  assert.deepEqual(guide.wiringOrderLabels(model), ["S", "T", "A1", "M", "P", "A2"]);
  assert.deepEqual(model.letters.map((l) => guide.roleDescription(l)), [
    "Alimentación + salida al siguiente",
    "Entrada del anterior + salida al siguiente",
    "Entrada del anterior + salida al siguiente",
    "Entrada del anterior + salida al siguiente",
    "Entrada del anterior + salida al siguiente",
    "Entrada del anterior (última)",
  ]);
  const text = latin1(guide.buildWiringGuidePdf(r, params, "STAMPA"));
  const cs = pages(text);
  assert.ok(cs.length >= 2);
  const t1 = pdfTexts(cs[0]);
  assert.ok(t1.some((t) => /PARALELO/i.test(t)), "aclara la conexión en paralelo");
  assert.ok(t1.some((t) => t.includes("12V")), "voltaje solo como referencia");
  // El orden de las etiquetas en la línea de orden físico (entre FUENTE y el esquema).
  const start = t1.indexOf("FUENTE");
  const seq = t1.slice(start + 1).filter((t) => ["S", "T", "A1", "M", "P", "A2"].includes(t)).slice(0, 6);
  assert.deepEqual(seq, ["S", "T", "A1", "M", "P", "A2"]);
  assert.ok(t1.includes("®"), "flechas reales (fuente Symbol)");
  for (const label of ["IN+", "IN-", "OUT+", "OUT-", "LED+", "LED-"]) assert.ok(t1.includes(label), label);
  assert.ok(t1.includes("+") && t1.includes("-"), "buses + y -");
  assert.ok(t1.some((t) => t.includes("LED S")) && t1.some((t) => t.includes("LED A2")));
  assert.ok(t1.some((t) => t.startsWith("S a T:")) && t1.some((t) => t.startsWith("P a A2:")), "longitudes por tramo");
  const t2 = pdfTexts(cs[1]).join(" ");
  assert.ok(t2.includes("Preparar los cables") && t2.includes("Verificar la polaridad") && t2.includes("Probar la iluminación"));
  assert.ok(/baja tensión/i.test(pdfTexts(cs[0]).join(" ") + t2));
  // Sin cableado no hay guía de conexión utilizable.
  const off = createLetterGeometry(font, paramsOf("AB", standoff));
  assert.throws(() => kit.buildWiringGuidePdfBytes(off, paramsOf("AB", standoff), "AB"), /Cableado/);
  // R→L invierte el orden físico, no las etiquetas.
  const rtl = createLetterGeometry(font, paramsOf("STAMPA", chained({ direction: "rtl" })));
  assert.equal(guide.wiringOrderText(rtl.installation.wiring), "A2 → P → M → A1 → T → S");
});

test("kit completo: ZIP con /STL e /INSTALL, un solo separador + cantidad, A1/A2 y PDFs válidos", async () => {
  const params = paramsOf("STAMPA", { ...standoff, ...chained() });
  const r = createLetterGeometry(font, params);
  const blob = await kit.buildInstallKitZipBlob(r, params, "stampa", "STAMPA");
  const zip = await JSZipLib.loadAsync(Buffer.from(await blob.arrayBuffer()));
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
  assert.deepEqual(names.filter((n) => n.startsWith("STL/")), [
    "STL/01_S.stl", "STL/02_T.stl", "STL/03_A1.stl", "STL/04_M.stl", "STL/05_P.stl", "STL/06_A2.stl", "STL/bipolar-splice-clip.stl", "STL/wall-spacer-12x20.stl",
  ]);
  assert.deepEqual(names.filter((n) => n.startsWith("INSTALL/")), ["INSTALL/guia-conexion.pdf", "INSTALL/plantilla-instalacion.pdf"]);
  assert.ok(names.includes("LEEME.txt"));
  const readme = await zip.file("LEEME.txt").async("string");
  assert.ok(readme.includes(`Imprimir ${r.installationParts[0].quantity} unidades`));
  assert.ok(readme.includes("S → T → A1 → M → P → A2"));
  assert.ok(readme.includes("Cantidad de soportes de empalme: 5"), "letras - 1");
  assert.ok(readme.includes("bipolar-splice-clip.stl") && readme.includes("Imprimir 5 unidades"));
  for (const n of ["INSTALL/guia-conexion.pdf", "INSTALL/plantilla-instalacion.pdf"]) {
    const bytes = await zip.file(n).async("uint8array");
    assert.equal(Buffer.from(bytes).toString("latin1", 0, 8), "%PDF-1.4");
    assert.ok(Buffer.from(bytes).toString("latin1").trimEnd().endsWith("%%EOF"));
  }
  const stl = await zip.file("STL/wall-spacer-12x20.stl").async("uint8array");
  assert.ok(stl.length > 84);
  // Sin errores exportables: un resultado inválido no exporta nada.
  const bad = createLetterGeometry(font, paramsOf("M", standoff, {}, { L1: { mountPoints: [{ x: 500, y: 500 }] } }));
  await assert.rejects(() => kit.buildInstallKitZipBlob(bad, paramsOf("M", standoff, {}, { L1: { mountPoints: [{ x: 500, y: 500 }] } }), "m", "M"));
  // Keyhole sin cableado: sin guía ni separadores, pero sí plantilla.
  const kp = paramsOf("MM", keyhole);
  const kz = await JSZipLib.loadAsync(Buffer.from(await (await kit.buildInstallKitZipBlob(createLetterGeometry(font, kp), kp, "mm", "MM")).arrayBuffer()));
  const kn = Object.keys(kz.files);
  assert.ok(kn.includes("INSTALL/plantilla-instalacion.pdf") && !kn.includes("INSTALL/guia-conexion.pdf") && !kn.some((n) => n.includes("wall-spacer")));
});

test("(opcional) volcado de PDFs de ejemplo para inspección visual: DUMP_PDF=<carpeta>", { skip: !process.env.DUMP_PDF }, () => {
  const params = paramsOf("STAMPA", { ...standoff, ...chained({ voltage: "12V" }) });
  const r = createLetterGeometry(font, params);
  fs.mkdirSync(process.env.DUMP_PDF, { recursive: true });
  fs.writeFileSync(path.join(process.env.DUMP_PDF, "plantilla.pdf"), tpl.buildInstallTemplatePdf(tpl.buildTemplateModel(r, params, "STAMPA")));
  fs.writeFileSync(path.join(process.env.DUMP_PDF, "guia.pdf"), guide.buildWiringGuidePdf(r, params, "STAMPA"));
  const kp = paramsOf("MM", keyhole);
  fs.writeFileSync(path.join(process.env.DUMP_PDF, "plantilla-keyhole.pdf"), tpl.buildInstallTemplatePdf(tpl.buildTemplateModel(createLetterGeometry(font, kp), kp, "MM")));
});

// ------------------------------------------------------- edición y helpers visuales

const editing = loadMakerModule("lib/maker/installation/editing.ts");
const helper = loadMakerModule("lib/maker/installation/helper.ts");

test("editor de montaje: mover un punto pasa la letra a manual; inválido queda marcado; restablecer vuelve al automático", () => {
  const params = paramsOf("MM", standoff);
  const r = createLetterGeometry(font, params);
  const plan = r.installation;
  const cuts = editing.mountEditorCutouts(plan, params);
  assert.equal(cuts.length, plan.letters.flatMap((l) => l.mounts).length);
  assert.ok(cuts.every((c) => c.id.startsWith("mount:") && c.type === "circle"));
  // Zona segura: los puntos válidos están dentro (misma condición que el plan).
  const zone = editing.mountSafeZone(r, params);
  const inside = (c) => Math.abs(offsets.clipperPathsArea(offsets.differenceRawPaths(backCutoutPolygons(c, r.designCenter).map(offsets.pointsToRawPath), zone))) < 1e-3;
  assert.ok(cuts.every(inside));
  // Mover un punto de la 1ª letra: solo esa letra pasa a manual y las demás posiciones se conservan.
  const first = cuts[0];
  const moved = editing.moveMountPoint({}, plan, first.id, first.x + 1.5, first.y);
  assert.deepEqual(Object.keys(moved), ["L1"]);
  assert.equal(moved.L1.mountPoints.length, plan.letters[0].mounts.length);
  assert.equal(moved.L1.mountPoints[0].x, first.x + 1.5);
  assert.equal(moved.L1.mountPoints[1].x, plan.letters[0].mounts[1].x);
  const r2 = createLetterGeometry(font, paramsOf("MM", standoff, {}, moved));
  assert.equal(r2.installation.letters[0].mounts[0].source, "manual");
  assert.equal(r2.installation.letters[1].mounts[0].source, "auto");
  assert.ok(Math.abs(r2.installation.letters[0].mounts[0].x - (first.x + 1.5)) < 1e-9);
  // Arrastrar fuera del material: se marca inválido (rojo) y NO genera geometría.
  const bad = editing.moveMountPoint(moved, plan, first.id, 900, 900);
  const r3 = createLetterGeometry(font, paramsOf("MM", standoff, {}, bad));
  assert.ok(editing.invalidMountEditorIds(r3.installation).has(first.id));
  assert.ok(r3.errors.length > 0);
  assert.ok(watertight(bodyOf(r3, 0)));
  // Restablecer / cantidad / empalmes por letra.
  assert.deepEqual(editing.resetMountOverrides(moved), {});
  assert.deepEqual(editing.resetMountOverrides({ L1: { mountPoints: [{ x: 1, y: 1 }] }, L2: { mountCount: 3 } }, "L1"), { L2: { mountCount: 3 } });
  assert.deepEqual(editing.setLetterMountCount({}, "L2", 3), { L2: { mountCount: 3 } });
  assert.deepEqual(editing.setLetterMountCount({ L2: { mountCount: 3, mountPoints: [{ x: 0, y: 0 }] } }, "L2", 4), { L2: { mountCount: 4 } });
  assert.deepEqual(editing.setLetterMountCount({ L2: { mountCount: 3 } }, "L2", null), {});
  assert.equal(editing.setLetterSplice, undefined, "ya no hay empalmes por letra");
  // Keyhole: el handle tiene la forma del keyhole a 180°.
  const kp = paramsOf("M", keyhole);
  const kc = editing.mountEditorCutouts(createLetterGeometry(font, kp).installation, kp);
  assert.ok(kc.every((c) => c.type === "keyhole" && c.rotationDeg === 180 && c.headDiameterMm === 7));
});

test("helpers visuales: cableado (+ continuo / - discontinuo, flechas) y pared; NO forman parte de las piezas exportables", () => {
  const params = paramsOf("STAMPA", { ...standoff, ...chained() });
  const r = createLetterGeometry(font, params);
  const off = helper.buildInstallationHelperMesh(r.installation, params, { showWiring: false, showWall: false });
  assert.equal(off, null);
  const wiringMesh = helper.buildInstallationHelperMesh(r.installation, params, { showWiring: true, showWall: false });
  assert.ok(wiringMesh && wiringMesh.triangleCount > 100);
  const wall = helper.buildInstallationHelperMesh(r.installation, params, { showWiring: false, showWall: true });
  assert.ok(wall && wall.triangleCount === 12, "la pared es una losa");
  const wb = meshBounds3(wall.positions);
  assert.ok(Math.abs(wb.maxZ - -DEF.installation.mounting.standoff.wallSpacingMm) < 1e-6 || wb.maxZ < 0, "pared detrás de la letra, a la separación configurada");
  assert.ok(wb.minZ < -20 && wb.maxZ <= -19.9);
  // Los helpers no están en las partes ni en los STL: las letras siguen siendo el único contenido exportable.
  const soupTriangles = r.parts.reduce((n, p) => n + p.mesh.triangleCount, 0);
  assert.equal(r.triangleCount, soupTriangles);
  const noWiring = createLetterGeometry(font, paramsOf("STAMPA", standoff));
  assert.equal(helper.buildInstallationHelperMesh(noWiring.installation, paramsOf("STAMPA", standoff), { showWiring: true, showWall: false }), null, "sin cableado no hay helper de cableado");
  // Determinístico.
  const again = helper.buildInstallationHelperMesh(r.installation, params, { showWiring: true, showWall: false });
  assert.equal(again.triangleCount, wiringMesh.triangleCount);
});

test("etiquetas impresas: relieve simple (+, -, IN, OUT) sobre la repisa, desactivables", () => {
  const withLabels = gen("STAMPA", chained());
  const texts = withLabels.installation.letters.flatMap((l) => l.labels.map((x) => x.text));
  assert.ok(texts.length > 0);
  assert.ok(texts.every((t) => ["+", "-", "IN", "OUT"].includes(t)));
  assert.ok(texts.includes("IN") || texts.includes("OUT") || texts.includes("+"));
  const noLabels = gen("STAMPA", chained({ printLabels: false }));
  assert.equal(noLabels.installation.letters.flatMap((l) => l.labels).length, 0);
  for (let i = 0; i < 6; i++) assert.ok(watertight(bodyOf(noLabels, i)));
  for (let i = 0; i < 6; i++) assert.ok(watertight(bodyOf(withLabels, i)));
});

test("regresión: front lid / perforado / canal siguen generando con instalación desactivada y con recortes manuales", () => {
  for (const patch of [{ frontType: "lid" }, { frontType: "lid", lidJoint: "interior-lip" }, { frontType: "perforated" }, { frontType: "light-channel" }]) {
    const r = createLetterGeometry(font, { ...DEF, text: "OA", ...patch });
    assert.deepEqual(r.errors, [], JSON.stringify(patch));
    assert.equal(r.installation, null);
  }
  const lid = createLetterGeometry(font, paramsOf("MM", { ...standoff, ...chained() }, { frontType: "lid", lidJoint: "interior-lip" }));
  assert.deepEqual(lid.errors, []);
  assert.ok(lid.letters.every((l) => l.parts.length === 2 && watertight(l.parts[0].mesh)));
});
test("invariantes del plan de STAMPA: puertos siempre en pares, cada etiqueta pertenece a un puerto existente", () => {
  const w = gen("STAMPA", chained());
  for (const l of w.installation.letters) {
    for (const p of l.ports) assert.equal(p.holes.length, 2, p.id);
    for (const label of l.labels) assert.ok(l.ports.some((f) => label.id.startsWith(f.id)), label.id);
  }
});
