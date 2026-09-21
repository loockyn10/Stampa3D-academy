import type { ContourGroup, Point2D } from "@/lib/maker/types";
import {
  contourGroupsToRawPaths,
  differenceContourGroups,
  pointsToRawPath,
  regroupClipperSolution,
  unionRawPaths,
} from "@/lib/maker/geometry/offsets";
import { extrudeContourGroups, type ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";
import { circlePolygon } from "@/lib/maker/geometry/backCutouts";

/**
 * Sólidos apilados soldados por coordenadas compartidas (sin CSG 3D): una lista
 * de CAPAS contiguas en Z, cada una con su huella 2D. Las paredes salen de cada
 * huella; entre capas se cierra la diferencia con un escalón horizontal (mismo
 * mecanismo que `buildOffsetProfileWallPieces`). Sirve para bosses, receptores
 * (vacíos), rieles de empalme con pestañas, clips y el separador de pared.
 */
export interface PrismLayer {
  z0: number;
  z1: number;
  groups: ContourGroup[];
}

export interface PrismStackOptions {
  /**
   * false (default) = MATERIAL: las normales apuntan hacia afuera de las huellas. true = VACÍO (receptor):
   * las huellas son cavidades tallada en material ya existente, las normales miran hacia el hueco.
   */
  void?: boolean;
  /** Tapa en el extremo inferior de la primera capa (material: mirando -Z; vacío: piso, mirando +Z). */
  bottomCap?: boolean;
  /** Tapa en el extremo superior de la última capa (material: +Z; vacío: techo, mirando -Z). */
  topCap?: boolean;
}

const EPS = 1e-9;

const CONFORM_TOLERANCE_MM = 3e-4;
const SNAP_MM = 1.5e-4;

/**
 * Inserta en cada arista de cada lazo los vértices de OTROS lazos que caen sobre ella
 * (T-junctions). Sin esto, una pestaña que comparte una arista colineal con el riel
 * dejaría la pared sin su contraparte vértice a vértice (aristas de borde en la malla):
 * el escalón sale de Clipper con vértices en las intersecciones y la pared no.
 */
function conformLoops(groupSets: ContourGroup[][]): ContourGroup[][] {
  // 1) Canonicalizar: vértices a <= 1.5e-4 mm entre sí (redondeos distintos de Clipper del mismo punto físico) pasan a ser UNO solo.
  const canon: Point2D[] = [];
  const canonical = (v: Point2D): Point2D => {
    for (const c of canon) if (Math.abs(c[0] - v[0]) <= SNAP_MM && Math.abs(c[1] - v[1]) <= SNAP_MM) return c;
    canon.push(v);
    return v;
  };
  const snapped = groupSets.map((groups) =>
    groups.map((g) => {
      const fix = (loop: Point2D[]): Point2D[] => {
        const out: Point2D[] = [];
        for (const v of loop) {
          const c = canonical(v);
          const last = out[out.length - 1];
          if (!last || last !== c) out.push(c);
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
      for (const v of canon) {
        if (v === a || v === b) continue;
        const t = ((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / len2;
        if (t <= 0 || t >= 1) continue;
        const px = a[0] + t * dx, py = a[1] + t * dy;
        if (Math.hypot(v[0] - px, v[1] - py) > CONFORM_TOLERANCE_MM) continue;
        inserts.push({ t, v });
      }
      inserts.sort((p, q) => p.t - q.t);
      for (const ins of inserts) out.push(ins.v);
    }
    return out;
  };
  return snapped.map((groups) => groups.map((g) => ({ outer: conform(g.outer), holes: g.holes.map(conform) })));
}

export interface PrismStackResult {
  mesh: ExtrudedMeshData;
  /** Huellas de cada capa YA conformadas (los lazos que deben usarse para agujerear la repisa/tapa donde se apoya). */
  layerGroups: ContourGroup[][];
}

export function buildPrismStackDetailed(layers: PrismLayer[], options: PrismStackOptions = {}): PrismStackResult {
  const isVoid = options.void === true;
  const pieces: ExtrudedMeshData[] = [];
  const active = layers.filter((l) => l.z1 - l.z0 > EPS && l.groups.length > 0);

  // 1) Escalones entre capas (Clipper) y 2) conformado de vértices entre TODOS los lazos.
  const ledges: { z: number; below: ContourGroup[]; above: ContourGroup[] }[] = [];
  active.forEach((layer, i) => {
    const next = active[i + 1];
    if (!next) return;
    if (Math.abs(next.z0 - layer.z1) > 1e-6) throw new Error("buildPrismStack: las capas deben ser contiguas en Z.");
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
    pieces.push(extrudeContourGroups(layerGroups[i], layer.z0, layer.z1, { capStart: false, capEnd: false, sides: true, flipSides: isVoid }));
  });
  ledges.forEach((ledge, i) => {
    const below = ledgeGroups[i * 2];
    const above = ledgeGroups[i * 2 + 1];
    // Material: la cima del escalón mira +Z, la cara inferior de un voladizo -Z. Vacío: al revés.
    if (below.length > 0) pieces.push(extrudeContourGroups(below, ledge.z, ledge.z, isVoid ? { capStart: true, capEnd: false, sides: false } : { capStart: false, capEnd: true, sides: false }));
    if (above.length > 0) pieces.push(extrudeContourGroups(above, ledge.z, ledge.z, isVoid ? { capStart: false, capEnd: true, sides: false } : { capStart: true, capEnd: false, sides: false }));
  });

  if (active.length > 0) {
    const first = active[0];
    const last = active[active.length - 1];
    if (options.bottomCap) {
      pieces.push(extrudeContourGroups(layerGroups[0], first.z0, first.z0, isVoid ? { capStart: false, capEnd: true, sides: false } : { capStart: true, capEnd: false, sides: false }));
    }
    if (options.topCap) {
      pieces.push(extrudeContourGroups(layerGroups[active.length - 1], last.z1, last.z1, isVoid ? { capStart: true, capEnd: false, sides: false } : { capStart: false, capEnd: true, sides: false }));
    }
  }
  return { mesh: { positions: pieces.flatMap((p) => p.positions), normals: pieces.flatMap((p) => p.normals) }, layerGroups };
}

export function buildPrismStack(layers: PrismLayer[], options: PrismStackOptions = {}): ExtrudedMeshData {
  return buildPrismStackDetailed(layers, options).mesh;
}

// ------------------------------------------------------------------ formas

/** Polígonos -> grupos normalizados por Clipper (misma grilla que el resto del motor: las coordenadas coinciden exactas entre paredes, escalones y huecos). */
export function normalizePolygons(polygons: Point2D[][]): ContourGroup[] {
  if (polygons.length === 0) return [];
  return regroupClipperSolution(unionRawPaths(polygons.map(pointsToRawPath)));
}

export function discGroups(cx: number, cy: number, diameterMm: number): ContourGroup[] {
  return normalizePolygons([circlePolygon(cx, cy, diameterMm)]);
}

/** Rectángulo centrado en (cx, cy) de `w` (a lo largo del eje local X) por `h`, girado `angleDeg` antihorario. */
export function rectPolygon(cx: number, cy: number, w: number, h: number, angleDeg = 0): Point2D[] {
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const hw = w / 2, hh = h / 2;
  return ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as Point2D[]).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as Point2D);
}

/** Punto local (u a lo largo, v transversal) de un marco girado -> global. */
export function localToGlobal(cx: number, cy: number, angleDeg: number, u: number, v: number): Point2D {
  const rad = (angleDeg * Math.PI) / 180;
  return [cx + u * Math.cos(rad) - v * Math.sin(rad), cy + u * Math.sin(rad) + v * Math.cos(rad)];
}
