import { sampleOpenworkField, type OpenworkField } from "@/lib/maker/lamps/openwork/field";
import type { LampOpenworkDef, LampShadeDef } from "@/lib/maker/lamps/types";

/**
 * Miniatura de una pantalla calada: una máscara RGBA (blanco con alfa = luz) leída DIRECTAMENTE del campo de aberturas que
 * después se malla y se exporta (`sampleOpenworkField`): cada píxel se proyecta de vuelta sobre la superficie de revolución
 * (cara frontal primero, cara trasera tenue si la frontal es abertura) y se consulta f(θ, z) por interpolación bilineal. Si el
 * calado cambia, la miniatura cambia; no hay imágenes decorativas.
 *
 * La escala es fija (mm -> px) para que dos diseños de igual altura se comparen a ojo.
 */
export interface OpenworkThumbnail {
  width: number;
  height: number;
  /** RGBA, `width × height × 4`: RGB blanco, alfa = intensidad (0 = fuera de la silueta o abertura sin nada detrás). */
  pixels: Uint8ClampedArray;
  /** Fracción de píxeles dentro de la silueta que son abertura pasante (nada detrás), para verificar la fidelidad. */
  openFraction: number;
}

function bilinearF(field: OpenworkField, row: number, col: number): number {
  const { nRows, nTheta, f } = field;
  const r0 = Math.max(0, Math.min(nRows - 2, Math.floor(row)));
  const tr = Math.max(0, Math.min(1, row - r0));
  const c0 = Math.floor(col);
  const tc = col - c0;
  const a = ((c0 % nTheta) + nTheta) % nTheta;
  const b = (a + 1) % nTheta;
  const f00 = f[r0 * nTheta + a], f01 = f[r0 * nTheta + b], f10 = f[(r0 + 1) * nTheta + a], f11 = f[(r0 + 1) * nTheta + b];
  return (f00 * (1 - tc) + f01 * tc) * (1 - tr) + (f10 * (1 - tc) + f11 * tc) * tr;
}

export function renderOpenworkThumbnail(shade: LampShadeDef, ow: LampOpenworkDef, heightPx = 96, field?: OpenworkField): OpenworkThumbnail {
  const fld = field ?? sampleOpenworkField(shade, ow);
  const scale = heightPx / shade.heightMm;
  const maxR = Math.max(...Array.from(fld.rowR));
  const width = Math.ceil(2 * maxR * scale + 4);
  const height = heightPx;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const cx = width / 2;
  const { nRows, nTheta } = fld;
  const STEPS = 6; // muestras a través del espesor: la pared (y los flancos de las tiras) se ven de canto cerca de la silueta
  let inside = 0, open = 0;
  for (let py = 0; py < height; py++) {
    const z = ((height - 0.5 - py) / height) * shade.heightMm; // y hacia abajo -> z hacia arriba
    const rowF = (z / shade.heightMm) * (nRows - 1);
    const i0 = Math.max(0, Math.min(nRows - 2, Math.floor(rowF)));
    const R = fld.rowR[i0] + (fld.rowR[i0 + 1] - fld.rowR[i0]) * (rowF - i0);
    const Rin = fld.rowRin[i0] + (fld.rowRin[i0 + 1] - fld.rowRin[i0]) * (rowF - i0);
    for (let px = 0; px < width; px++) {
      const dx = (px + 0.5 - cx) / scale;
      if (Math.abs(dx) >= R) continue;
      inside++;
      const o = (py * width + px) * 4;
      pixels[o] = pixels[o + 1] = pixels[o + 2] = 255;
      // Rayo de cámara (desde −y hacia +y) a través de la pared: primero la mitad frontal de afuera hacia adentro, después la trasera.
      let alpha = 0;
      for (let side = 0; side < 2 && alpha === 0; side++) {
        for (let k = 0; k < STEPS; k++) {
          const r = R - ((R - Rin) * k) / (STEPS - 1);
          if (r <= Math.abs(dx)) break;
          const sinT = Math.sqrt(1 - (dx / r) * (dx / r));
          const theta = Math.atan2(side === 0 ? -sinT * r : sinT * r, dx);
          const col = ((theta < 0 ? theta + 2 * Math.PI : theta) / (2 * Math.PI)) * nTheta;
          if (bilinearF(fld, rowF, col) > 0) {
            alpha = side === 0 ? Math.round(255 * (0.45 + 0.55 * sinT)) : 70;
            break;
          }
        }
      }
      pixels[o + 3] = alpha;
      if (alpha === 0) open++;
    }
  }
  return { width, height, pixels, openFraction: inside > 0 ? open / inside : 0 };
}
