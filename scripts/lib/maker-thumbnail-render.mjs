// Rasterizador de software mínimo (z-buffer + sombreado plano) para las
// miniaturas de los estilos del Creador de Carteles. Recibe las MISMAS mallas
// (`SignPart.mesh`, triangle soup en mm) que ve el visor y la exportación,
// así que la miniatura es la geometría real del motor, no una ilustración.
// No es un segundo motor de geometría: solo proyecta triángulos ya generados.

/** Mismos colores por pieza que MakerViewport (PART_COLORS). */
export const PART_RGB = {
  body: [0xd8, 0xd8, 0xdc],
  lid: [0xff, 0xb0, 0x66],
  mask: [0x6b, 0x6f, 0x76],
  diffuser: [0xff, 0xf3, 0xd6],
  channelDiffuser: [0xff, 0xf3, 0xd6],
};

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * @param parts   [{ kind, mesh: { positions, normals, triangleCount } }]
 * @param opts    { width, height, supersample, yawDeg, pitchDeg, margin }
 * @returns { width, height, rgba: Uint8Array } (alfa recto, fondo transparente)
 */
export function renderPartsToRgba(parts, opts = {}) {
  const width = opts.width ?? 400;
  const height = opts.height ?? 300;
  const ss = opts.supersample ?? 3;
  const yaw = ((opts.yawDeg ?? 28) * Math.PI) / 180;
  const pitch = ((opts.pitchDeg ?? 20) * Math.PI) / 180;
  const margin = opts.margin ?? 0.1;

  // Cámara ortográfica 3/4 (mismo lado que la cámara inicial del visor: arriba, a la derecha, al frente).
  const d = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]; // del objetivo hacia la cámara
  const right = norm(cross([0, 1, 0], d));
  const up = cross(d, right);

  // Centro y encuadre.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (const part of parts) {
    const p = part.mesh.positions;
    for (let i = 0; i < part.mesh.triangleCount * 9; i += 3) { cx += p[i]; cy += p[i + 1]; cz += p[i + 2]; n++; }
  }
  if (n === 0) return { width, height, rgba: new Uint8Array(width * height * 4) };
  cx /= n; cy /= n; cz /= n;
  const proj = (x, y, z) => {
    const v = [x - cx, y - cy, z - cz];
    return [dot(v, right), dot(v, up), dot(v, d)];
  };
  for (const part of parts) {
    const p = part.mesh.positions;
    for (let i = 0; i < part.mesh.triangleCount * 9; i += 3) {
      const [sx, sy] = proj(p[i], p[i + 1], p[i + 2]);
      if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
    }
  }
  const W = width * ss, H = height * ss;
  const scale = Math.min((W * (1 - 2 * margin)) / (maxX - minX || 1), (H * (1 - 2 * margin)) / (maxY - minY || 1));
  const offX = W / 2 - ((minX + maxX) / 2) * scale;
  const offY = H / 2 + ((minY + maxY) / 2) * scale;

  const depth = new Float32Array(W * H).fill(-Infinity);
  const color = new Uint8Array(W * H * 3);
  const covered = new Uint8Array(W * H);

  const key = norm([1, 1.6, 1.2]);
  const fill = norm([-1, -0.4, -1]);

  for (const part of parts) {
    const base = PART_RGB[part.kind] ?? PART_RGB.body;
    const p = part.mesh.positions;
    const nrm = part.mesh.normals;
    for (let t = 0; t < part.mesh.triangleCount; t++) {
      const o = t * 9;
      let nv = norm([nrm[o], nrm[o + 1], nrm[o + 2]]);
      // Material de doble cara (como el visor): la cara visible siempre se ilumina de frente.
      if (dot(nv, d) < 0) nv = [-nv[0], -nv[1], -nv[2]];
      const light = 0.42 + 0.72 * Math.max(0, dot(nv, key)) + 0.22 * Math.max(0, dot(nv, fill));
      const r = Math.min(255, base[0] * light), g = Math.min(255, base[1] * light), b = Math.min(255, base[2] * light);

      const pts = [];
      for (let k = 0; k < 3; k++) {
        const [sx, sy, sz] = proj(p[o + k * 3], p[o + k * 3 + 1], p[o + k * 3 + 2]);
        pts.push([sx * scale + offX, offY - sy * scale, sz]);
      }
      const [a, bb, c] = pts;
      const area = (bb[0] - a[0]) * (c[1] - a[1]) - (bb[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a[0], bb[0], c[0])));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], bb[0], c[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], bb[1], c[1])));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], bb[1], c[1])));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const w0 = ((bb[0] - px) * (c[1] - py) - (bb[1] - py) * (c[0] - px)) / area;
          const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const z = w0 * a[2] + w1 * bb[2] + w2 * c[2];
          const idx = y * W + x;
          if (z > depth[idx]) {
            depth[idx] = z;
            color[idx * 3] = r; color[idx * 3 + 1] = g; color[idx * 3 + 2] = b;
            covered[idx] = 1;
          }
        }
      }
    }
  }

  // Reducción ss x ss con promedio ponderado por cobertura (bordes suavizados, fondo transparente).
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const idx = (y * ss + sy) * W + (x * ss + sx);
          if (covered[idx]) { r += color[idx * 3]; g += color[idx * 3 + 1]; b += color[idx * 3 + 2]; cnt++; }
        }
      }
      const o = (y * width + x) * 4;
      if (cnt > 0) {
        rgba[o] = Math.round(r / cnt); rgba[o + 1] = Math.round(g / cnt); rgba[o + 2] = Math.round(b / cnt);
        rgba[o + 3] = Math.round((cnt / (ss * ss)) * 255);
      }
    }
  }
  return { width, height, rgba };
}
