import type { InstallationPlan } from "@/lib/maker/installation/types";
import type { LetterSignParams, TriangleSoupData } from "@/lib/maker/types";
import { getInstallationSettings } from "@/lib/maker/installation/defaults";
import { CLIP_PLATE_MM, spliceClipSizes } from "@/lib/maker/installation/spliceClip";

/**
 * Helpers VISUALES de instalación (nunca exportables): cableado (+ / - / flechas) y pared de
 * referencia. Se devuelven como una malla auxiliar (`TriangleSoupData`) que el viewport dibuja
 * semitransparente y que NO forma parte de ningún SignPart, STL, ZIP ni de la Vista Cama.
 *
 * El "+" y el "-" no dependen del color: el bus + es una barra continua y el - una barra
 * discontinua (segmentos), más gruesa/fina y a ambos lados de la línea de recorrido.
 */

type V3 = [number, number, number];

class SoupBuilder {
  positions: number[] = [];
  normals: number[] = [];

  private tri(a: V3, b: V3, c: V3): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    this.positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.normals.push(nx, ny, nz);
  }

  private quad(a: V3, b: V3, c: V3, d: V3): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** Barra (prisma) entre dos puntos del plano XY, de ancho `w` (en el plano) y alto `h` (en Z) centrada en `z`. */
  bar(x0: number, y0: number, x1: number, y1: number, w: number, h: number, z: number): void {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const nx = (-dy / len) * (w / 2), ny = (dx / len) * (w / 2);
    const zl = z - h / 2, zh = z + h / 2;
    const p = (x: number, y: number, zz: number): V3 => [x, y, zz];
    const a0 = p(x0 + nx, y0 + ny, zl), b0 = p(x1 + nx, y1 + ny, zl), c0 = p(x1 - nx, y1 - ny, zl), d0 = p(x0 - nx, y0 - ny, zl);
    const a1 = p(x0 + nx, y0 + ny, zh), b1 = p(x1 + nx, y1 + ny, zh), c1 = p(x1 - nx, y1 - ny, zh), d1 = p(x0 - nx, y0 - ny, zh);
    this.quad(a1, b1, c1, d1);
    this.quad(d0, c0, b0, a0);
    this.quad(a0, b0, b1, a1);
    this.quad(b0, c0, c1, b1);
    this.quad(c0, d0, d1, c1);
    this.quad(d0, a0, a1, d1);
  }

  /** Punta de flecha plana (triángulo) en el plano XY, apuntando en `angle`. */
  arrow(x: number, y: number, angle: number, size: number, z: number): void {
    const tip: V3 = [x + Math.cos(angle) * size, y + Math.sin(angle) * size, z];
    const l: V3 = [x + Math.cos(angle + 2.4) * size * 0.8, y + Math.sin(angle + 2.4) * size * 0.8, z];
    const r: V3 = [x + Math.cos(angle - 2.4) * size * 0.8, y + Math.sin(angle - 2.4) * size * 0.8, z];
    this.tri(tip, l, r);
    this.tri(tip, r, l);
  }

  /** Recorte de línea: continuo o discontinuo (`dashMm` > 0). */
  segments(x0: number, y0: number, x1: number, y1: number, w: number, h: number, z: number, dashMm: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (dashMm <= 0 || len <= dashMm * 1.5) {
      this.bar(x0, y0, x1, y1, w, h, z);
      return;
    }
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    for (let d = 0; d < len; d += dashMm * 1.7) {
      const e = Math.min(d + dashMm, len);
      this.bar(x0 + ux * d, y0 + uy * d, x0 + ux * e, y0 + uy * e, w, h, z, );
    }
  }

  toSoup(): TriangleSoupData {
    return { positions: Float32Array.from(this.positions), normals: Float32Array.from(this.normals), triangleCount: this.positions.length / 9 };
  }
}

export interface InstallationHelperOptions {
  showWiring: boolean;
  showWall: boolean;
}

/** Malla auxiliar de instalación, o null si no hay nada que mostrar. */
export function buildInstallationHelperMesh(plan: InstallationPlan | null, params: LetterSignParams, opts: InstallationHelperOptions): TriangleSoupData | null {
  if (!plan || !plan.active) return null;
  const settings = getInstallationSettings(params);
  const b = new SoupBuilder();
  const wire = settings.wiring.wireDiameterMm;
  const zBehind = -Math.max(wire, 1.5);

  if (opts.showWiring && plan.wiring) {
    const o = plan.origin;
    // Cada conexión son DOS conductores paralelos entre los agujeros OUT de la letra N e IN de la N+1:
    // el + como barra continua y el - como barra discontinua (no dependen del color), con sus marcas + / -.
    for (const c of plan.connections) {
      const [p0, p1] = c.positivePath;
      const [m0, m1] = c.negativePath;
      b.segments(o.x + p0.x, o.y + p0.y, o.x + p1.x, o.y + p1.y, wire * 0.9, wire * 0.9, zBehind, 0);
      b.segments(o.x + m0.x, o.y + m0.y, o.x + m1.x, o.y + m1.y, wire * 0.9, wire * 0.9, zBehind, 5);
      // Extremos (los cuatro agujeros) como pequeños tacos.
      for (const q of [p0, p1, m0, m1]) b.bar(o.x + q.x - 1.2, o.y + q.y, o.x + q.x + 1.2, o.y + q.y, 2.4, wire * 1.4, zBehind);
      // Marcas de polaridad: "+" (cruz) sobre el conductor +, "-" (barra) bajo el conductor -.
      const mx = o.x + (p0.x + p1.x) / 2, py = o.y + (p0.y + p1.y) / 2 + 3.2, ny = o.y + (m0.y + m1.y) / 2 - 3.2;
      b.bar(mx - 1.8, py, mx + 1.8, py, 0.8, 0.8, zBehind);
      b.bar(mx, py - 1.8, mx, py + 1.8, 0.8, 0.8, zBehind);
      b.bar(mx - 1.8, ny, mx + 1.8, ny, 0.8, 0.8, zBehind);
      // Dirección OUT -> IN.
      b.arrow(o.x + p0.x + (p1.x - p0.x) * 0.3, o.y + (p0.y + m0.y) / 2 + (p1.y - p0.y) * 0.3, Math.atan2(p1.y - p0.y, p1.x - p0.x), 4, zBehind);
      // Soporte de empalmes externo (solo visual, aprox. al centro del recorrido; la pieza real es un STL aparte).
      const sc = settings.wiring.spliceClip;
      if (sc.enabled) {
        const z = spliceClipSizes(sc);
        const ang = (c.clipPosition.angleDeg * Math.PI) / 180;
        const ux = Math.cos(ang), uy = Math.sin(ang);
        // Eje transversal con Y positivo: el canal + queda arriba.
        const nxv = uy >= 0 ? -uy : uy, nyv = uy >= 0 ? ux : -ux;
        const cx = o.x + c.clipPosition.x, cy = o.y + c.clipPosition.y;
        b.bar(cx - (ux * z.plateLengthMm) / 2, cy - (uy * z.plateLengthMm) / 2, cx + (ux * z.plateLengthMm) / 2, cy + (uy * z.plateLengthMm) / 2, z.plateWidthMm, CLIP_PLATE_MM, zBehind);
        for (const side of [1, -1]) {
          const ox = cx + nxv * side * (sc.spacingMm / 2), oy = cy + nyv * side * (sc.spacingMm / 2);
          for (const edge of [1, -1]) {
            const rx = ox + nxv * edge * (z.innerWidthMm / 2 + 0.6), ry = oy + nyv * edge * (z.innerWidthMm / 2 + 0.6);
            b.bar(rx - (ux * z.innerLengthMm) / 2, ry - (uy * z.innerLengthMm) / 2, rx + (ux * z.innerLengthMm) / 2, ry + (uy * z.innerLengthMm) / 2, 1.2, z.railHeightMm, zBehind + z.railHeightMm / 2);
          }
        }
      }
    }
  }

  if (opts.showWall && settings.mounting.type === "standoff") {
    // Pared de referencia a la distancia de separación (la letra apoya en Z=0; la pared queda `wallSpacingMm` detrás).
    const boxes = plan.instances.map((i) => i.boundsMm);
    const minX = Math.min(...boxes.map((x) => x.minX)) - 25, maxX = Math.max(...boxes.map((x) => x.maxX)) + 25;
    const minY = Math.min(...boxes.map((x) => x.minY)) - 25, maxY = Math.max(...boxes.map((x) => x.maxY)) + 25;
    const zWall = -settings.mounting.standoff.wallSpacingMm;
    b.bar(minX, (minY + maxY) / 2, maxX, (minY + maxY) / 2, maxY - minY, 1, zWall - 0.5);
  }

  const soup = b.toSoup();
  return soup.triangleCount > 0 ? soup : null;
}
