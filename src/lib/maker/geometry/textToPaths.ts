import type * as opentype from "opentype.js";
import type { Point2D } from "@/lib/maker/types";

/**
 * Convierte texto a un path vectorial 2D escalado a milímetros.
 * El alto objetivo se calcula sobre la altura de mayúscula (capHeight) de la
 * fuente cuando está disponible; si no, se usa un heurístico razonable.
 * Nota: opentype.js devuelve coordenadas con Y creciendo hacia abajo (como
 * canvas 2D); ese ajuste se resuelve en flattenPaths.
 */
export function textToOpentypePath(
  font: opentype.Font,
  text: string,
  heightMm: number,
): opentype.Path {
  const scale = fontSizeForHeight(font, heightMm);
  return font.getPath(text, 0, 0, scale);
}

function fontSizeForHeight(font: opentype.Font, heightMm: number): number {
  const os2 = font.tables?.os2 as { sCapHeight?: number; sTypoAscender?: number } | undefined;
  const referenceHeight = os2?.sCapHeight || os2?.sTypoAscender || font.ascender || font.unitsPerEm * 0.7;
  return (heightMm * font.unitsPerEm) / referenceHeight;
}

export interface PerCharacterPath {
  char: string;
  /** Índice del carácter dentro del string original (incluye espacios). */
  sourceIndex: number;
  path: opentype.Path;
}

/**
 * Igual que textToOpentypePath, pero devuelve un path posicionado por
 * separado para cada carácter (misma escala/kerning que el string
 * completo: opentype.Font#getPaths usa el mismo layout que #getPath,
 * solo que sin fusionar los comandos en un único Path). Permite exportar
 * cada letra sin recalcular ni divergir del layout que ve el preview.
 */
export function textToPerCharacterPaths(
  font: opentype.Font,
  text: string,
  heightMm: number,
): PerCharacterPath[] {
  const scale = fontSizeForHeight(font, heightMm);
  const paths = font.getPaths(text, 0, 0, scale);
  return Array.from(text).map((char, i) => ({ char, sourceIndex: i, path: paths[i] }));
}

export interface FlattenOptions {
  /** Longitud de cuerda objetivo por segmento de curva, en mm. */
  curveSegmentLengthMm?: number;
  minSegmentsPerCurve?: number;
  maxSegmentsPerCurve?: number;
}

/**
 * Divide un opentype.Path en sub-contornos cerrados, aplanando curvas
 * cuadráticas/cúbicas a segmentos y corrigiendo el eje Y (arriba = positivo).
 */
export function flattenOpentypePath(
  path: opentype.Path,
  options: FlattenOptions = {},
): Point2D[][] {
  const { curveSegmentLengthMm = 1.2, minSegmentsPerCurve = 4, maxSegmentsPerCurve = 28 } = options;

  const contours: Point2D[][] = [];
  let current: [number, number][] = [];
  let cursor: [number, number] = [0, 0];
  let start: [number, number] = [0, 0];

  const pushPoint = (x: number, y: number) => {
    current.push([x, -y]);
  };

  for (const cmd of path.commands) {
    switch (cmd.type) {
      case "M": {
        if (current.length > 2) contours.push(closeContour(current));
        current = [];
        cursor = [cmd.x, cmd.y];
        start = cursor;
        pushPoint(cmd.x, cmd.y);
        break;
      }
      case "L": {
        cursor = [cmd.x, cmd.y];
        pushPoint(cmd.x, cmd.y);
        break;
      }
      case "Q": {
        const p0 = cursor;
        const p1: [number, number] = [cmd.x1, cmd.y1];
        const p2: [number, number] = [cmd.x, cmd.y];
        const segments = segmentCountForCurve(p0, p1, p2, curveSegmentLengthMm, minSegmentsPerCurve, maxSegmentsPerCurve);
        for (let i = 1; i <= segments; i++) {
          const t = i / segments;
          const pt = quadraticPoint(p0, p1, p2, t);
          pushPoint(pt[0], pt[1]);
        }
        cursor = p2;
        break;
      }
      case "C": {
        const p0 = cursor;
        const p1: [number, number] = [cmd.x1, cmd.y1];
        const p2: [number, number] = [cmd.x2, cmd.y2];
        const p3: [number, number] = [cmd.x, cmd.y];
        const segments = segmentCountForCurve(p0, p1, p3, curveSegmentLengthMm, minSegmentsPerCurve, maxSegmentsPerCurve);
        for (let i = 1; i <= segments; i++) {
          const t = i / segments;
          const pt = cubicPoint(p0, p1, p2, p3, t);
          pushPoint(pt[0], pt[1]);
        }
        cursor = p3;
        break;
      }
      case "Z": {
        cursor = start;
        if (current.length > 2) contours.push(closeContour(current));
        current = [];
        break;
      }
    }
  }
  if (current.length > 2) contours.push(closeContour(current));

  return contours;
}

function closeContour(points: [number, number][]): Point2D[] {
  // Algunas fuentes emiten puntos redundantes (curvas de largo ~0 al
  // empalmar segmentos, p.ej. en los 4 cuadrantes de una "O"). Sin
  // deduplicar, esos puntos coincidentes generan aristas de largo cero y
  // triángulos degenerados en las paredes laterales.
  const deduped: [number, number][] = [];
  for (const pt of points) {
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.abs(prev[0] - pt[0]) > 1e-6 || Math.abs(prev[1] - pt[1]) > 1e-6) {
      deduped.push(pt);
    }
  }

  const first = deduped[0];
  const last = deduped[deduped.length - 1];
  if (deduped.length > 1 && Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6) {
    deduped.pop();
  }
  return deduped as Point2D[];
}

function segmentCountForCurve(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  targetLengthMm: number,
  min: number,
  max: number,
): number {
  const chord = dist(p0, p1) + dist(p1, p2);
  const count = Math.round(chord / targetLengthMm);
  return Math.min(max, Math.max(min, count));
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function quadraticPoint(p0: [number, number], p1: [number, number], p2: [number, number], t: number): [number, number] {
  const mt = 1 - t;
  const x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0];
  const y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1];
  return [x, y];
}

function cubicPoint(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  const mt = 1 - t;
  const x = mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0];
  const y = mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1];
  return [x, y];
}
