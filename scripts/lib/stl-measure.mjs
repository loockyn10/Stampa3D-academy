// Medición de mallas de REVOLUCIÓN (STL de referencia y mallas que genera la app) por semiplanos que pasan por el eje. Sin dependencias.
// La usan scripts/lamp-stl-reference.mjs (mide los STL de references/lamp-e27) y tests/maker-lamps-mounts.test.mjs (compara las mallas
// generadas contra esos mismos STL): una sola definición de cada medida.
import fs from "node:fs";

const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;

/** STL binario -> Float32Array de triángulos (9 floats cada uno). */
export function loadStlBinary(file) {
  const buf = fs.readFileSync(file);
  const n = buf.readUInt32LE(80);
  if (buf.length !== 84 + 50 * n) throw new Error(`${file}: no es un STL binario`);
  const T = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) T[t * 9 + k] = buf.readFloatLE(84 + t * 50 + 12 + k * 4);
  return T;
}

/** Malla indexada de la app ({ positions, tris }) -> Float32Array de triángulos. */
export function trianglesFromIndexed(mesh) {
  const T = new Float32Array((mesh.tris.length / 3) * 9);
  for (let t = 0; t < mesh.tris.length; t++) {
    const v = mesh.tris[t] * 3;
    T[t * 3] = mesh.positions[v];
    T[t * 3 + 1] = mesh.positions[v + 1];
    T[t * 3 + 2] = mesh.positions[v + 2];
  }
  return T;
}

export function bbox(T) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < T.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], T[i + k]); max[k] = Math.max(max[k], T[i + k]); }
  return { min, max, size: [0, 1, 2].map((k) => max[k] - min[k]) };
}

/** Segmentos (r, z) de la intersección con el semiplano vertical de azimut `deg` por (cx, cy). */
export function halfPlaneSegments(T, cx, cy, deg, eps = 0.003) {
  const th = deg * DEG, dx = Math.cos(th), dy = Math.sin(th), nx = -dy, ny = dx;
  const S = [];
  for (let t = 0; t < T.length; t += 9) {
    const d0 = (T[t] - cx) * nx + (T[t + 1] - cy) * ny + eps;
    const d1 = (T[t + 3] - cx) * nx + (T[t + 4] - cy) * ny + eps;
    const d2 = (T[t + 6] - cx) * nx + (T[t + 7] - cy) * ny + eps;
    if ((d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0)) continue;
    const d = [d0, d1, d2];
    const p = [];
    for (let e = 0; e < 3; e++) {
      const a = e, b = (e + 1) % 3;
      if (d[a] * d[b] < 0) {
        const u = d[a] / (d[a] - d[b]);
        const x = T[t + a * 3] + u * (T[t + b * 3] - T[t + a * 3]) - cx;
        const y = T[t + a * 3 + 1] + u * (T[t + b * 3 + 1] - T[t + a * 3 + 1]) - cy;
        const z = T[t + a * 3 + 2] + u * (T[t + b * 3 + 2] - T[t + a * 3 + 2]);
        p.push([x * dx + y * dy, z]);
      }
    }
    if (p.length === 2 && (p[0][0] > -1e-6 || p[1][0] > -1e-6)) S.push(p);
  }
  return S;
}

/** Radios (>0) donde el contorno cruza la altura z, de menor a mayor. */
export function radiiAtZ(S, z) {
  const r = [];
  for (const [p, q] of S) if ((p[1] - z) * (q[1] - z) < 0) r.push(p[0] + ((z - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
  return r.filter((x) => x > 0).sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > 0.01);
}

/**
 * Centro del eje y radio de una superficie LISA de revolución a la altura z: ajusta r(θ) = R + a·cosθ + b·sinθ por mínimos cuadrados sobre
 * 36 azimuts (rama `index` de los cruces) y corrige el centro dos veces. Devuelve también el residuo máximo (circularidad).
 */
export function fitAxis(T, z, index = 0, start = null) {
  const bb = bbox(T);
  let cx = start?.[0] ?? (bb.min[0] + bb.max[0]) / 2;
  let cy = start?.[1] ?? (bb.min[1] + bb.max[1]) / 2;
  let out = null;
  for (let pass = 0; pass < 3; pass++) {
    const A = [], B = [];
    for (let a = 0; a < 360; a += 10) {
      const r = radiiAtZ(halfPlaneSegments(T, cx, cy, a), z)[index];
      if (r === undefined) continue;
      A.push([1, Math.cos(a * DEG), Math.sin(a * DEG)]);
      B.push(r);
    }
    const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], atb = [0, 0, 0];
    A.forEach((row, i) => { for (let p = 0; p < 3; p++) { atb[p] += row[p] * B[i]; for (let q = 0; q < 3; q++) ata[p][q] += row[p] * row[q]; } });
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(ata);
    const sol = [0, 1, 2].map((c) => det(ata.map((row, i) => row.map((v, j) => (j === c ? atb[i] : v)))) / D);
    const residual = Math.max(...A.map((row, i) => Math.abs(row[0] * sol[0] + row[1] * sol[1] + row[2] * sol[2] - B[i])));
    out = { cx: cx + sol[1], cy: cy + sol[2], R: sol[0], residual };
    cx += sol[1];
    cy += sol[2];
  }
  return out;
}

/** Alturas de los ápices (mínimos locales del radio interior por debajo de root − 0,4 mm) en un azimut, entre zLo y zHi. */
export function threadApexesAt(T, cx, cy, deg, zLo, zHi, rootR, dz = 0.02) {
  const S = halfPlaneSegments(T, cx, cy, deg);
  const pts = [];
  for (let z = zLo; z <= zHi + 1e-9; z += dz) pts.push([z, radiiAtZ(S, z)[0] ?? rootR]);
  // Ápices = centro de cada tramo continuo con radio < raíz − 0,4 mm (en una malla en capas el ápice es una meseta, no un punto).
  const apex = [];
  let run = [];
  const flush = () => {
    if (run.length === 0) return;
    const minR = Math.min(...run.map((p) => p[1]));
    const at = run.filter((p) => p[1] <= minR + 0.012);
    apex.push({ z: at.reduce((sum, p) => sum + p[0], 0) / at.length, r: minR });
    run = [];
  };
  for (const p of pts) {
    if (p[1] < rootR - 0.4) run.push(p);
    else flush();
  }
  flush();
  return apex;
}

/**
 * Mide una rosca hembra (nervio en V que entra desde la pared lisa) de una malla de revolución:
 *   - `rootR`: radio de la pared lisa; `crestR`: radio del ápice (media de los ápices);
 *   - `pitch`: separación de los ápices en un mismo azimut; `rightHanded`: el ápice sube al aumentar el azimut;
 *   - `turns`: (altura del último ápice − altura del primero) / paso; `minApexZ` / `maxApexZ`: extremos de la hélice;
 *   - `flankSlope`: Δradio/Δaltura del flanco (regresión sobre el 20–80 % de la profundidad).
 */
export function measureThread(T, { cx, cy, zLo, zHi, rootR, azimuths = [0, 90, 180, 270] }) {
  const all = [];
  const pitches = [];
  const byAz = new Map();
  for (const deg of azimuths) {
    const ap = threadApexesAt(T, cx, cy, deg, zLo, zHi, rootR);
    byAz.set(deg, ap);
    all.push(...ap);
    for (let i = 1; i < ap.length; i++) pitches.push(ap[i].z - ap[i - 1].z);
  }
  // hélice completa: todos los azimuts cada 15°
  const helix = [];
  for (let deg = 0; deg < 360; deg += 15) for (const a of threadApexesAt(T, cx, cy, deg, zLo, zHi, rootR)) helix.push({ deg, z: a.z, r: a.r });
  const zs = helix.map((h) => h.z);
  const pitch = pitches.reduce((s, v) => s + v, 0) / Math.max(pitches.length, 1);
  // sentido: a 0° y a 90° el ápice más bajo; si el de 90° está más arriba (menos de medio paso) es a derechas
  const z0 = byAz.get(0)?.[0]?.z, z90 = byAz.get(90)?.[0]?.z;
  let shift = z90 - z0;
  shift = ((shift % pitch) + pitch) % pitch;
  const crestR = all.reduce((s, a) => s + a.r, 0) / Math.max(all.length, 1);
  // flanco: regresión lineal de r(z) en la ladera descendente del primer ápice de 0°
  const S0 = halfPlaneSegments(T, cx, cy, 0);
  const a0 = byAz.get(0)?.[0];
  let flankSlope = null;
  if (a0) {
    const depth = rootR - a0.r;
    const xs = [], ys = [];
    for (let z = a0.z - depth * 1.4; z < a0.z; z += 0.01) {
      const r = radiiAtZ(S0, z)[0];
      if (r !== undefined && r < rootR - 0.2 * depth && r > a0.r + 0.2 * depth) { xs.push(z); ys.push(r); }
    }
    if (xs.length > 5) {
      const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
      flankSlope = Math.abs(xs.reduce((s, v, i) => s + (v - mx) * (ys[i] - my), 0) / xs.reduce((s, v) => s + (v - mx) ** 2, 0));
    }
  }
  return {
    rootR,
    crestR,
    depth: rootR - crestR,
    pitch,
    rightHanded: shift > 0 && shift < pitch / 2,
    minApexZ: Math.min(...zs),
    maxApexZ: Math.max(...zs),
    turns: (Math.max(...zs) - Math.min(...zs)) / pitch,
    flankSlope,
  };
}

/** Radios de los VÉRTICES (diámetro de diseño de un poliedro inscripto) dentro de una ventana de radio y altura. */
export function vertexRadii(T, cx, cy, { rLo, rHi, zLo, zHi }) {
  const rs = [];
  for (let i = 0; i < T.length; i += 3) {
    const r = Math.hypot(T[i] - cx, T[i + 1] - cy), z = T[i + 2];
    if (r >= rLo && r <= rHi && z >= zLo && z <= zHi) rs.push(r);
  }
  rs.sort((a, b) => a - b);
  return { count: rs.length, min: rs[0] ?? NaN, median: rs[rs.length >> 1] ?? NaN, max: rs[rs.length - 1] ?? NaN };
}

export { TAU };
