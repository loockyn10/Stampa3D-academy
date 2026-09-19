import type * as ClipperLib from "clipper-lib";
import type { BackCutout, ContourGroup, LetterGeometryWarning, LetterSignParams, Point2D } from "@/lib/maker/types";
import {
  clipperPathsArea,
  contourGroupsToRawPaths,
  differenceRawPaths,
  insetContourGroups,
  intersectRawPaths,
  isPointInsideContourGroups,
  pointsToRawPath,
  regroupClipperSolution,
  unionRawPaths,
} from "@/lib/maker/geometry/offsets";
import { extrudeContourGroups, type ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";
import { computeWallAndCore } from "@/lib/maker/geometry/body/shared";

/**
 * Recortes traseros (BACK CUTOUTS) — pasantes sobre la BASE trasera del
 * cuerpo. Todo se resuelve en 2D: cada `BackCutout` se convierte en un
 * polígono, se funde con Clipper (solapados = una sola abertura) y se resta
 * de las tapas de la base ANTES de extruir; no hay CSG 3D. El motor solo
 * conoce formas paramétricas (circle / capsule / keyhole), nunca "usos".
 * Ver docs/STAMPA_MAKER.md sección 23.
 */

/** Cantidad máxima de recortes (límite técnico de rendimiento, no de producto). */
export const MAX_BACK_CUTOUTS = 50;
/** Distancia mínima entre cualquier punto del recorte y la pared/borde de la cavidad (mm). Interno: no se expone en la UI. */
export const BACK_CUTOUT_EDGE_MARGIN_MM = 1;
/** Tamaño máximo razonable de cualquier dimensión (mm), para rechazar valores absurdos. */
export const MAX_BACK_CUTOUT_DIMENSION_MM = 500;

const ARC_TOLERANCE_MM = 0.02;
const MIN_ARC_SEGMENTS = 24;
const MAX_ARC_SEGMENTS = 128;
/** Área máxima (mm²) de un recorte que puede quedar fuera de la zona permitida antes de considerarlo inválido (ruido numérico de Clipper). */
const OUTSIDE_AREA_TOLERANCE_MM2 = 1e-3;

export const BACK_CUTOUT_INVALID_MESSAGE = "El recorte está demasiado cerca del borde o fuera del cuerpo.";

// ---------------------------------------------------------------- formas

function arcSegments(radius: number): number {
  const r = Math.max(radius, 1e-6);
  const step = 2 * Math.acos(Math.max(-1, 1 - ARC_TOLERANCE_MM / r));
  const n = Number.isFinite(step) && step > 0 ? Math.ceil((2 * Math.PI) / step) : MAX_ARC_SEGMENTS;
  // Múltiplo de 4: hay vértices exactamente en 0/90/180/270°, así el ancho/alto del círculo (y de los extremos de la cápsula) coincide con la medida pedida.
  return Math.min(MAX_ARC_SEGMENTS, Math.max(MIN_ARC_SEGMENTS, Math.ceil(n / 4) * 4));
}

/** Puntos de un arco (incluye ambos extremos) de `a0` a `a1` (radianes), en sentido antihorario. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number): Point2D[] {
  const total = arcSegments(r);
  const n = Math.max(2, Math.ceil((total * Math.abs(a1 - a0)) / (2 * Math.PI)));
  const pts: Point2D[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** Círculo completo (antihorario, sin repetir el primer punto). */
export function circlePolygon(cx: number, cy: number, diameterMm: number): Point2D[] {
  const r = diameterMm / 2;
  const n = arcSegments(r);
  const pts: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** Cápsula centrada en el origen, sin rotar: extremos semicirculares sobre el lado corto (horizontal si width >= height, vertical si no). */
export function capsulePolygon(widthMm: number, heightMm: number): Point2D[] {
  if (Math.abs(widthMm - heightMm) < 1e-9) return circlePolygon(0, 0, widthMm);
  if (widthMm > heightMm) {
    const r = heightMm / 2;
    const s = (widthMm - heightMm) / 2;
    return [...arc(s, 0, r, -Math.PI / 2, Math.PI / 2), ...arc(-s, 0, r, Math.PI / 2, (3 * Math.PI) / 2)];
  }
  const r = widthMm / 2;
  const s = (heightMm - widthMm) / 2;
  return [...arc(0, s, r, 0, Math.PI), ...arc(0, -s, r, Math.PI, 2 * Math.PI)];
}

/**
 * Keyhole centrado en el origen (= centro de la cabeza), sin rotar: cabeza
 * circular + cuello rectangular que baja (−Y) hasta el centro del extremo
 * inferior redondeado. Es la UNIÓN (Clipper) de las tres formas: un único
 * contorno continuo.
 */
export function keyholePolygons(headDiameterMm: number, neckWidthMm: number, neckLengthMm: number, tailDiameterMm: number): Point2D[][] {
  const halfNeck = neckWidthMm / 2;
  const neck: Point2D[] = [
    [-halfNeck, 0],
    [-halfNeck, -neckLengthMm],
    [halfNeck, -neckLengthMm],
    [halfNeck, 0],
  ];
  // Antihorario: (-,0) -> (-,-L) -> (+,-L) -> (+,0) es antihorario en ejes matemáticos.
  const parts = [circlePolygon(0, 0, headDiameterMm), neck, circlePolygon(0, -neckLengthMm, tailDiameterMm)];
  const union = unionRawPaths(parts.map(pointsToRawPath));
  return regroupClipperSolution(union).map((g) => g.outer);
}

function transform(points: Point2D[], rotationDeg: number, tx: number, ty: number): Point2D[] {
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return points.map(([x, y]) => [x * c - y * s + tx, x * s + y * c + ty] as Point2D);
}

/**
 * Polígono(s) de un recorte en el espacio global del diseño. `origin` es el
 * centro de la caja del diseño (la posición X/Y del recorte es relativa a él).
 */
export function backCutoutPolygons(cutout: BackCutout, origin: { x: number; y: number } = { x: 0, y: 0 }): Point2D[][] {
  const tx = origin.x + cutout.x;
  const ty = origin.y + cutout.y;
  switch (cutout.type) {
    case "circle":
      return [circlePolygon(tx, ty, cutout.diameterMm)];
    case "capsule":
      return [transform(capsulePolygon(cutout.widthMm, cutout.heightMm), cutout.rotationDeg, tx, ty)];
    case "keyhole":
      return keyholePolygons(cutout.headDiameterMm, cutout.neckWidthMm, cutout.neckLengthMm, cutout.tailDiameterMm).map((p) =>
        transform(p, cutout.rotationDeg, tx, ty),
      );
  }
}

/** Un keyhole NUEVO nace a 180°: círculo grande abajo, cuello hacia arriba (el tornillo entra por el círculo y al bajar el cartel el vástago queda en el cuello). No afecta a recortes ya guardados. */
export const KEYHOLE_DEFAULT_ROTATION_DEG = 180;

/** Recorte nuevo con medidas por defecto razonables (la UI lo usa al agregar o cambiar de tipo). */
export function createDefaultBackCutout(type: BackCutout["type"], id: string, x = 0, y = 0): BackCutout {
  switch (type) {
    case "circle":
      return { id, type, x, y, diameterMm: 5 };
    case "capsule":
      return { id, type, x, y, widthMm: 10, heightMm: 4, rotationDeg: 0 };
    case "keyhole":
      return { id, type, x, y, headDiameterMm: 8, neckWidthMm: 4, neckLengthMm: 10, tailDiameterMm: 4, rotationDeg: KEYHOLE_DEFAULT_ROTATION_DEG };
  }
}

// ------------------------------------------------------------ validación

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const dimOk = (v: unknown): boolean => finite(v) && v > 0 && v <= MAX_BACK_CUTOUT_DIMENSION_MM;

/** Error de PARÁMETROS de un recorte (medidas inválidas), o null. No mira la geometría del cuerpo. */
export function validateBackCutoutShape(c: BackCutout): string | null {
  if (!finite(c.x) || !finite(c.y) || Math.abs(c.x) > 5000 || Math.abs(c.y) > 5000) return "La posición X/Y no es válida.";
  switch (c.type) {
    case "circle":
      return dimOk(c.diameterMm) ? null : `El diámetro debe ser mayor a 0 y hasta ${MAX_BACK_CUTOUT_DIMENSION_MM} mm.`;
    case "capsule":
      if (!dimOk(c.widthMm) || !dimOk(c.heightMm)) return `El ancho y el alto deben ser mayores a 0 y hasta ${MAX_BACK_CUTOUT_DIMENSION_MM} mm.`;
      return finite(c.rotationDeg) ? null : "La rotación no es válida.";
    case "keyhole":
      if (!dimOk(c.headDiameterMm) || !dimOk(c.neckWidthMm) || !dimOk(c.neckLengthMm) || !dimOk(c.tailDiameterMm)) {
        return `Las medidas del colgador deben ser mayores a 0 y hasta ${MAX_BACK_CUTOUT_DIMENSION_MM} mm.`;
      }
      if (c.neckWidthMm >= c.headDiameterMm) return "El cuello debe ser más angosto que la cabeza.";
      if (c.tailDiameterMm < c.neckWidthMm - 1e-9 || c.tailDiameterMm > c.headDiameterMm) return "El extremo inferior debe medir entre el ancho del cuello y el diámetro de la cabeza.";
      return finite(c.rotationDeg) ? null : "La rotación no es válida.";
    default:
      return "Tipo de recorte desconocido.";
  }
}

/** Errores de parámetros de toda la lista: [{ index (0-based), message }]. */
export function validateBackCutouts(cutouts: BackCutout[]): { index: number; message: string }[] {
  const out: { index: number; message: string }[] = [];
  if (cutouts.length > MAX_BACK_CUTOUTS) out.push({ index: -1, message: `Podés agregar hasta ${MAX_BACK_CUTOUTS} recortes.` });
  cutouts.forEach((c, index) => {
    const message = validateBackCutoutShape(c);
    if (message) out.push({ index, message });
  });
  return out;
}

// -------------------------------------------------------- planificación

/** ¿El recorte cabe en la zona segura (núcleo de la cavidad menos el margen)? Misma prueba que usa el motor y el editor visual. */
export function isCutoutInsideSafeZone(cutout: BackCutout, origin: { x: number; y: number }, safeZone: ClipperLib.Paths): boolean {
  const raw = backCutoutPolygons(cutout, origin).map(pointsToRawPath);
  return Math.abs(clipperPathsArea(differenceRawPaths(raw, safeZone))) <= OUTSIDE_AREA_TOLERANCE_MM2;
}

export interface BackCutoutPlan {
  /** Unión de los recortes válidos (paths crudos de Clipper, espacio global). Vacío = nada que cortar. */
  region: ClipperLib.Paths;
  errors: LetterGeometryWarning[];
  /** Zona segura de la base (paths crudos de Clipper) para validar posiciones en vivo; null si no hay recortes (no se calculó). */
  safeZone: ClipperLib.Paths | null;
}

/** Centro de la caja del diseño (origen de las coordenadas X/Y de los recortes). */
export function computeDesignCenter(pieces: { contourGroups: ContourGroup[] }[]): { x: number; y: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const piece of pieces) {
    for (const g of piece.contourGroups) {
      for (const [x, y] of g.outer) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return Number.isFinite(minX) ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : { x: 0, y: 0 };
}

/**
 * Valida cada recorte contra la zona segura de la base y arma la región de
 * corte. Zona segura = cavidad interior de cada carácter (núcleo erosionado
 * por `wallMm`) achicada `BACK_CUTOUT_EDGE_MARGIN_MM` — así un recorte nunca
 * toca ni la pared, ni el borde exterior, ni un counter, ni queda fuera del
 * cuerpo. Un recorte inválido NO se corta (no se genera geometría corrupta) y
 * queda como error, que bloquea la exportación.
 */
export function planBackCutouts(pieces: { contourGroups: ContourGroup[] }[], params: LetterSignParams): BackCutoutPlan {
  const cutouts = params.backCutouts ?? [];
  const errors: LetterGeometryWarning[] = [];
  if (cutouts.length === 0) return { region: [], errors, safeZone: null };

  if (params.frontType === "light-channel") {
    errors.push({
      code: "BACK_CUTOUT_INVALID",
      message: "Los recortes traseros no están disponibles con el frente de canal luminoso (el cuerpo es macizo, sin cavidad).",
    });
    return { region: [], errors, safeZone: null };
  }

  const origin = computeDesignCenter(pieces);
  const cores: ContourGroup[] = [];
  const inks: ContourGroup[] = [];
  for (const piece of pieces) {
    for (const group of piece.contourGroups) {
      cores.push(...computeWallAndCore(group, params.wallMm).coreGroups);
      inks.push(group);
    }
  }
  let allowed = insetContourGroups(cores, BACK_CUTOUT_EDGE_MARGIN_MM);
  // El bisel posterior reduce la huella de la base en Z=0: el recorte tampoco puede salirse de ella.
  if (params.bodyType === "standard" && params.rearBevelEnabled && params.rearBevelInsetMm > 0) {
    allowed = intersectRawPaths(allowed, insetContourGroups(inks, params.rearBevelInsetMm + BACK_CUTOUT_EDGE_MARGIN_MM));
  }

  const valid: ClipperLib.Paths = [];
  cutouts.forEach((cutout, i) => {
    const shapeError = validateBackCutoutShape(cutout);
    if (shapeError) {
      errors.push({ code: "BACK_CUTOUT_INVALID", message: `Recorte ${i + 1}: ${shapeError}` });
      return;
    }
    const raw = backCutoutPolygons(cutout, origin).map(pointsToRawPath);
    if (!isCutoutInsideSafeZone(cutout, origin, allowed)) {
      errors.push({ code: "BACK_CUTOUT_INVALID", message: `Recorte ${i + 1}: ${BACK_CUTOUT_INVALID_MESSAGE}` });
      return;
    }
    valid.push(...raw);
  });

  return { region: unionRawPaths(valid), errors, safeZone: allowed };
}

// ------------------------------------------------- aplicación al cuerpo

export interface BackCutoutBaseResult {
  /** Tapa trasera (Z=0) con los recortes como huecos. */
  baseCapGroups: ContourGroup[];
  /** Repisa (Z=baseMm, mirando +Z) con los recortes como huecos. */
  shelfGroups: ContourGroup[];
  /** Paredes del recorte entre Z=0 y Z=baseMm (el material queda afuera). */
  holeWalls: ExtrudedMeshData[];
}

/** Agrega `loops` como huecos del grupo que los contiene (test exacto de punto en polígono, sin pasar por Clipper: las coordenadas quedan idénticas en tapas y paredes). */
function addHoles(groups: ContourGroup[], loops: Point2D[][]): ContourGroup[] {
  const out = groups.map((g) => ({ outer: g.outer, holes: [...g.holes] }));
  for (const loop of loops) {
    const target = out.find((g) => isPointInsideContourGroups([{ outer: g.outer, holes: g.holes }], loop[0]));
    if (target) target.holes.push(loop);
  }
  return out;
}

/**
 * Resta los recortes de la base de UN carácter (cuerpo standard o tapered:
 * misma estructura fondo Z=0 / repisa Z=baseMm). Sin recortes en este
 * carácter devuelve las entradas tal cual y sin paredes (resultado idéntico
 * byte a byte al de antes).
 */
export function applyBackCutoutsToBase(input: {
  region: ClipperLib.Paths | undefined;
  baseCapGroups: ContourGroup[];
  coreGroups: ContourGroup[];
  baseMm: number;
}): BackCutoutBaseResult {
  const unchanged: BackCutoutBaseResult = { baseCapGroups: input.baseCapGroups, shelfGroups: input.coreGroups, holeWalls: [] };
  if (!input.region || input.region.length === 0 || input.coreGroups.length === 0) return unchanged;

  // Parte del recorte que cae sobre la cavidad de ESTE carácter.
  const cut = regroupClipperSolution(intersectRawPaths(input.region, contourGroupsToRawPaths(input.coreGroups)));
  if (cut.length === 0) return unchanged;
  const loops = cut.map((g) => g.outer);

  return {
    baseCapGroups: addHoles(input.baseCapGroups, loops),
    shelfGroups: addHoles(input.coreGroups, loops),
    holeWalls: [
      extrudeContourGroups(cut.map((g) => ({ outer: g.outer, holes: [] })), 0, input.baseMm, {
        capStart: false,
        capEnd: false,
        sides: true,
        flipSides: true,
      }),
    ],
  };
}
