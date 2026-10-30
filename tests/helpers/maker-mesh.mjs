// Instrumentos de medición sobre la malla generada (la misma que ve el visor y exporta el STL): cortes horizontales y topología.

/** Intervalos de material [xIni, xFin] de la sección z=zc recorrida a lo largo de la recta y=y0. */
export function sectionIntervals(positions, zc, y0) {
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

export function bounds(positions) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < positions.length; i += 3) {
    b.minX = Math.min(b.minX, positions[i]); b.maxX = Math.max(b.maxX, positions[i]);
    b.minY = Math.min(b.minY, positions[i + 1]); b.maxY = Math.max(b.maxY, positions[i + 1]);
    b.minZ = Math.min(b.minZ, positions[i + 2]); b.maxZ = Math.max(b.maxZ, positions[i + 2]);
  }
  return b;
}

/** Malla cerrada y manifold: toda arista tiene su contraparte opuesta; sin triángulos degenerados. */
export function topology(positions) {
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

/** Alturas de muestreo a mitad de cada escalón (nunca justo sobre un plano horizontal de la malla). */
export function sampleHeights(z0, z1, n = 10) {
  return Array.from({ length: n }, (_, i) => z0 + ((i + 0.37) / n) * (z1 - z0));
}
