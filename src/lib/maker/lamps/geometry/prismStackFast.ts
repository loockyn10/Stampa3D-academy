import type { ContourGroup, Point2D } from "@/lib/maker/types";
import { contourGroupsToRawPaths, differenceContourGroups } from "@/lib/maker/geometry/offsets";
import { extrudeContourGroups, type ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";
import type { PrismLayer, PrismStackOptions } from "@/lib/maker/installation/prismStack";

/**
 * Misma construcción que `buildPrismStack` de la instalación de Carteles (capas contiguas con huellas 2D de Clipper,
 * escalones horizontales entre capas, vértices soldados por coordenadas compartidas, sin CSG 3D), pero con el
 * "conformado" de vértices indexado espacialmente. El original compara cada vértice contra todos los demás (O(V²)),
 * razonable con pocas capas y inviable con la rosca hembra de la base (decenas de capas de ~150 vértices cada una).
 * Acá cada consulta mira solo las celdas vecinas. El resultado es equivalente; la rosca vive en este módulo para no
 * tocar el código compartido de Carteles.
 */

const EPS = 1e-9;
const CONFORM_TOLERANCE_MM = 3e-4;
const SNAP_MM = 1.5e-4;
const CELL_MM = 0.5;

function cellKey(ix: number, iy: number): number {
  return (ix + 4096) * 16384 + (iy + 4096);
}

/** Índice espacial de puntos con celdas de `CELL_MM`. */
class PointIndex {
  private cells = new Map<number, Point2D[]>();
  add(p: Point2D): void {
    const key = cellKey(Math.floor(p[0] / CELL_MM), Math.floor(p[1] / CELL_MM));
    const list = this.cells.get(key);
    if (list) list.push(p);
    else this.cells.set(key, [p]);
  }
  /** Puntos en las celdas que cubren el rectángulo [x0,x1] × [y0,y1]. */
  query(x0: number, y0: number, x1: number, y1: number, visit: (p: Point2D) => void): void {
    const ix0 = Math.floor(x0 / CELL_MM), ix1 = Math.floor(x1 / CELL_MM);
    const iy0 = Math.floor(y0 / CELL_MM), iy1 = Math.floor(y1 / CELL_MM);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const list = this.cells.get(cellKey(ix, iy));
        if (list) for (const p of list) visit(p);
      }
    }
  }
}

function conformLoops(groupSets: ContourGroup[][]): ContourGroup[][] {
  // 1) Canonicalizar: vértices a <= SNAP entre sí pasan a ser UNO solo.
  const index = new PointIndex();
  const canonical = (v: Point2D): Point2D => {
    const hit: { p: Point2D | null } = { p: null };
    index.query(v[0] - SNAP_MM, v[1] - SNAP_MM, v[0] + SNAP_MM, v[1] + SNAP_MM, (c) => {
      if (!hit.p && Math.abs(c[0] - v[0]) <= SNAP_MM && Math.abs(c[1] - v[1]) <= SNAP_MM) hit.p = c;
    });
    if (hit.p) return hit.p;
    index.add(v);
    return v;
  };
  const snapped = groupSets.map((groups) =>
    groups.map((g) => {
      const fix = (loop: Point2D[]): Point2D[] => {
        const out: Point2D[] = [];
        for (const v of loop) {
          const c = canonical(v);
          if (out[out.length - 1] !== c) out.push(c);
        }
        while (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
        return out;
      };
      return { outer: fix(g.outer), holes: g.holes.map(fix) };
    }),
  );
  // 2) T-junctions: insertar en cada arista los vértices canónicos que caen sobre ella.
  const conform = (loop: Point2D[]): Point2D[] => {
    const out: Point2D[] = [];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      out.push(a);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-12) continue;
      const inserts: { t: number; v: Point2D }[] = [];
      index.query(Math.min(a[0], b[0]) - CONFORM_TOLERANCE_MM, Math.min(a[1], b[1]) - CONFORM_TOLERANCE_MM, Math.max(a[0], b[0]) + CONFORM_TOLERANCE_MM, Math.max(a[1], b[1]) + CONFORM_TOLERANCE_MM, (v) => {
        if (v === a || v === b) return;
        const t = ((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / len2;
        if (t <= 0 || t >= 1) return;
        const px = a[0] + t * dx, py = a[1] + t * dy;
        if (Math.hypot(v[0] - px, v[1] - py) > CONFORM_TOLERANCE_MM) return;
        inserts.push({ t, v });
      });
      inserts.sort((p, q) => p.t - q.t);
      for (const ins of inserts) out.push(ins.v);
    }
    return out;
  };
  return snapped.map((groups) => groups.map((g) => ({ outer: conform(g.outer), holes: g.holes.map(conform) })));
}

export function buildPrismStackFast(layers: PrismLayer[], options: PrismStackOptions = {}): ExtrudedMeshData {
  const pieces: ExtrudedMeshData[] = [];
  const active = layers.filter((l) => l.z1 - l.z0 > EPS && l.groups.length > 0);

  const ledges: { z: number; below: ContourGroup[]; above: ContourGroup[] }[] = [];
  active.forEach((layer, i) => {
    const next = active[i + 1];
    if (!next) return;
    if (Math.abs(next.z0 - layer.z1) > 1e-6) throw new Error("buildPrismStackFast: las capas deben ser contiguas en Z.");
    ledges.push({
      z: layer.z1,
      below: differenceContourGroups(layer.groups, contourGroupsToRawPaths(next.groups)),
      above: differenceContourGroups(next.groups, contourGroupsToRawPaths(layer.groups)),
    });
  });
  const conformed = conformLoops([...active.map((l) => l.groups), ...ledges.flatMap((l) => [l.below, l.above])]);
  const layerGroups = conformed.slice(0, active.length);
  const ledgeGroups = conformed.slice(active.length);

  active.forEach((layer, i) => {
    pieces.push(extrudeContourGroups(layerGroups[i], layer.z0, layer.z1, { capStart: false, capEnd: false, sides: true }));
  });
  ledges.forEach((ledge, i) => {
    const below = ledgeGroups[i * 2];
    const above = ledgeGroups[i * 2 + 1];
    if (below.length > 0) pieces.push(extrudeContourGroups(below, ledge.z, ledge.z, { capStart: false, capEnd: true, sides: false }));
    if (above.length > 0) pieces.push(extrudeContourGroups(above, ledge.z, ledge.z, { capStart: true, capEnd: false, sides: false }));
  });

  if (active.length > 0) {
    const first = active[0];
    const last = active[active.length - 1];
    if (options.bottomCap) pieces.push(extrudeContourGroups(layerGroups[0], first.z0, first.z0, { capStart: true, capEnd: false, sides: false }));
    if (options.topCap) pieces.push(extrudeContourGroups(layerGroups[active.length - 1], last.z1, last.z1, { capStart: false, capEnd: true, sides: false }));
  }
  return { positions: pieces.flatMap((p) => p.positions), normals: pieces.flatMap((p) => p.normals) };
}
