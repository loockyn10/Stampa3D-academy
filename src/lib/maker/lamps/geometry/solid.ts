import type { ContourGroup, Point2D } from "@/lib/maker/types";
import type { ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";
import { contourGroupsToRawPaths, differenceContourGroups } from "@/lib/maker/geometry/offsets";
import { normalizePolygons, type PrismLayer } from "@/lib/maker/installation/prismStack";
import { buildPrismStackFast } from "@/lib/maker/lamps/geometry/prismStackFast";
import { repairCollinearIndexed } from "@/lib/maker/lamps/geometry/repairIndexed";
import { addTri, addVertex, newMesh, type IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

/**
 * Base, inserto y piezas de prueba son sólidos de capas apiladas (huellas 2D de Clipper extruidas y soldadas por
 * coordenadas compartidas, SIN CSG 3D): el mismo mecanismo que usan los soportes de instalación de Carteles, con el
 * conformado de vértices indexado (`prismStackFast`). Acá se arma la lista de capas a partir de "características"
 * (material que se suma y vacíos que se restan en un rango de Z).
 */

export function circlePoly(radius: number, segments: number, cx = 0, cy = 0): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return pts;
}

/** Sector anular entre dos radios y dos ángulos (grados, antihorario). */
export function sectorPoly(rIn: number, rOut: number, a0Deg: number, a1Deg: number, stepDeg = 2.5): Point2D[] {
  const span = a1Deg - a0Deg;
  const steps = Math.max(2, Math.ceil(Math.abs(span) / stepDeg));
  const pts: Point2D[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((a0Deg + (span * i) / steps) * Math.PI) / 180;
    pts.push([rOut * Math.cos(a), rOut * Math.sin(a)]);
  }
  for (let i = steps; i >= 0; i--) {
    const a = ((a0Deg + (span * i) / steps) * Math.PI) / 180;
    pts.push([rIn * Math.cos(a), rIn * Math.sin(a)]);
  }
  return pts;
}

export function rectPoly(x0: number, y0: number, x1: number, y1: number): Point2D[] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** Anillo (círculo exterior menos círculo interior) como grupos de contornos. */
export function ringGroups(rIn: number, rOut: number, segments: number): ContourGroup[] {
  return differenceContourGroups(normalizePolygons([circlePoly(rOut, segments)]), contourGroupsToRawPaths(normalizePolygons([circlePoly(rIn, segments)])));
}

export interface SolidFeature {
  z0: number;
  z1: number;
  /** Material que se SUMA a la huella en este rango. */
  add?: Point2D[][];
  /** Vacío que se RESTA en este rango. */
  cut?: Point2D[][];
}

const EPS = 1e-6;

/**
 * Capas contiguas de un sólido: una huella `body` entre `bodyZ0` y `bodyZ1` más características aditivas/sustractivas.
 * Los cortes de Z son todos los z0/z1 de las características; cada intervalo toma la huella que corresponde a su punto medio.
 */
export function buildFeatureLayers(body: { z0: number; z1: number; polygons: Point2D[][] }, features: SolidFeature[]): PrismLayer[] {
  const cuts = new Set<number>([body.z0, body.z1]);
  for (const f of features) { cuts.add(f.z0); cuts.add(f.z1); }
  const zs = [...cuts].sort((a, b) => a - b).filter((z, i, arr) => i === 0 || z - arr[i - 1] > EPS);
  const layers: PrismLayer[] = [];
  for (let k = 0; k < zs.length - 1; k++) {
    const z0 = zs[k], z1 = zs[k + 1], mid = (z0 + z1) / 2;
    const material: Point2D[][] = [];
    if (mid > body.z0 && mid < body.z1) material.push(...body.polygons);
    for (const f of features) if (f.add && mid > f.z0 && mid < f.z1) material.push(...f.add);
    if (material.length === 0) continue;
    let groups = normalizePolygons(material);
    const voids: Point2D[][] = [];
    for (const f of features) if (f.cut && mid > f.z0 && mid < f.z1) voids.push(...f.cut);
    if (voids.length > 0) groups = differenceContourGroups(groups, contourGroupsToRawPaths(normalizePolygons(voids)));
    if (groups.length > 0) layers.push({ z0, z1, groups });
  }
  return layers;
}

/** Soup sin índices -> malla indexada soldando vértices coincidentes (resolución 1e-4 mm, la grilla de Clipper). */
export function weldToIndexed(positions: number[]): IndexedMesh {
  const mesh = newMesh();
  const ids = new Map<string, number>();
  const idOf = (x: number, y: number, z: number) => {
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = addVertex(mesh, x, y, z);
      ids.set(key, id);
    }
    return id;
  };
  for (let t = 0; t < positions.length; t += 9) {
    addTri(
      mesh,
      idOf(positions[t], positions[t + 1], positions[t + 2]),
      idOf(positions[t + 3], positions[t + 4], positions[t + 5]),
      idOf(positions[t + 6], positions[t + 7], positions[t + 8]),
    );
  }
  return mesh;
}

/** Capas -> malla indexada cerrada (soldadura por capas + soldado de vértices + reparación de colineales sobre la malla indexada). */
export function layersToIndexed(layers: PrismLayer[]): IndexedMesh {
  const extruded: ExtrudedMeshData = buildPrismStackFast(layers, { bottomCap: true, topCap: true });
  return repairCollinearIndexed(weldToIndexed(extruded.positions));
}
