import type { InstallationPlan, LetterInstallationPlan } from "@/lib/maker/installation/types";
import type { LetterSignParams, TriangleSoupData } from "@/lib/maker/types";
import { getInstallationSettings } from "@/lib/maker/installation/defaults";

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

function routeOf(letter: LetterInstallationPlan, origin: { x: number; y: number }): { x: number; y: number }[] {
  return letter.route.map((n) => ({ x: origin.x + n.x, y: origin.y + n.y }));
}

/** Malla auxiliar de instalación, o null si no hay nada que mostrar. */
export function buildInstallationHelperMesh(plan: InstallationPlan | null, params: LetterSignParams, opts: InstallationHelperOptions): TriangleSoupData | null {
  if (!plan || !plan.active) return null;
  const settings = getInstallationSettings(params);
  const b = new SoupBuilder();
  const wire = settings.wiring.wireDiameterMm;
  const zBehind = -Math.max(wire, 1.5);

  if (opts.showWiring && plan.wiring) {
    // Tramos entre letras: dos hilos (+ continuo, - discontinuo) a ambos lados de la recta OUT -> IN, con flecha de dirección.
    const portOf = (id: string, out: boolean) => plan.letters.find((l) => l.instanceId === id)?.ports.find((p) => (out ? p.role === "out" : p.role !== "out"));
    for (const link of plan.wiring.links) {
      const a = portOf(link.fromId, true), c = portOf(link.toId, false);
      if (!a || !c) continue;
      const x0 = plan.origin.x + a.x, y0 = plan.origin.y + a.y, x1 = plan.origin.x + c.x, y1 = plan.origin.y + c.y;
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const nx = (-(y1 - y0) / len) * (wire * 0.9), ny = ((x1 - x0) / len) * (wire * 0.9);
      b.segments(x0 + nx, y0 + ny, x1 + nx, y1 + ny, wire * 0.9, wire * 0.9, zBehind, 0);
      b.segments(x0 - nx, y0 - ny, x1 - nx, y1 - ny, wire * 0.9, wire * 0.9, zBehind, 5);
      b.arrow((x0 + x1) / 2, (y0 + y1) / 2, Math.atan2(y1 - y0, x1 - x0), 5, zBehind);
    }
    // Recorrido interno de cada letra (puerto -> clips -> bahías -> clips -> puerto).
    for (const letter of plan.letters) {
      const pts = routeOf(letter, plan.origin);
      for (let i = 0; i < pts.length - 1; i++) b.segments(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, wire * 0.6, wire * 0.6, params.baseMm + wire * 0.5, 0);
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
