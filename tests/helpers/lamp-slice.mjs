/** Radios de cruce de un sólido de revolución con el semiplano y = cy (lado +X) a la altura z, de menor a mayor (ordenados y sin repetidos). */
export function planeCrossings(mesh, z, cy = 0.37) {
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
