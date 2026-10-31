// Perfil radial de un STL binario de revolución (bases de lámparas): imprime la caja y, por altura, los radios de cruce de un
// plano que pasa cerca del eje. Sirve para medir las lámparas de referencia (references/lamp-e27) y repetir las mediciones
// del documento docs/STAMPA_MAKER.md §38.14 sin inventar cifras.
//
//   node scripts/lamp-stl-profile.mjs references/lamp-e27/bottom.stl [paso_mm=1.5] [cx cy]
//
// El centro por defecto es el de la caja en XY. Los radios son del lado +X; un cruce por cada superficie.
import fs from "node:fs";

const [file, stepArg, cxArg, cyArg] = process.argv.slice(2);
if (!file) {
  console.error("Uso: node scripts/lamp-stl-profile.mjs <archivo.stl> [paso_mm] [cx cy]");
  process.exit(1);
}
const buf = fs.readFileSync(file);
const n = buf.readUInt32LE(80);
if (buf.length !== 84 + 50 * n) {
  console.error("Solo STL binario.");
  process.exit(1);
}
const T = new Float32Array(n * 9);
for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) T[t * 9 + k] = buf.readFloatLE(84 + t * 50 + 12 + k * 4);

const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < T.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], T[i + k]); max[k] = Math.max(max[k], T[i + k]); }
const cx = cxArg !== undefined ? Number(cxArg) : (min[0] + max[0]) / 2;
const cy = (cyArg !== undefined ? Number(cyArg) : (min[1] + max[1]) / 2) + 0.37; // fuera del plano de simetría exacto
console.log(`${file}: ${n} triángulos · caja ${(max[0] - min[0]).toFixed(2)} × ${(max[1] - min[1]).toFixed(2)} × ${(max[2] - min[2]).toFixed(2)} mm · centro (${cx.toFixed(2)}, ${(cy - 0.37).toFixed(2)})`);

// segmentos del plano y = cy en coordenadas (x, z)
const segs = [];
for (let t = 0; t < T.length; t += 9) {
  const pts = [];
  for (let e = 0; e < 3; e++) {
    const i = t + e * 3, j = t + ((e + 1) % 3) * 3;
    const da = T[i + 1] - cy, db = T[j + 1] - cy;
    if (da * db < 0) { const u = da / (da - db); pts.push([T[i] + u * (T[j] - T[i]), T[i + 2] + u * (T[j + 2] - T[i + 2])]); }
  }
  if (pts.length === 2) segs.push(pts);
}
const radiiAt = (z) => {
  const xs = [];
  for (const [p, q] of segs) if ((p[1] - z) * (q[1] - z) < 0) xs.push(p[0] + ((z - p[1]) / (q[1] - p[1])) * (q[0] - p[0]) - cx);
  return xs.filter((x) => x > 0).sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > 0.02);
};
const step = stepArg ? Number(stepArg) : 1.5;
const zMax = max[2] - min[2];
for (let z = 0.25; z < zMax; z += step) console.log(`z ${z.toFixed(2).padStart(6)}  R: ${radiiAt(z).map((r) => r.toFixed(2)).join("  ")}`);
