import type { ContourGroup, Point2D } from "@/lib/maker/types";

/**
 * Agrupa contornos crudos (sin clasificar) en pares exterior/huecos usando
 * la regla par-impar de contención geométrica. No depende del sentido de
 * giro de la fuente, así que funciona igual para TrueType y CFF/OTF.
 *
 * Limitación conocida: soporta un nivel de anidamiento (huecos dentro de un
 * exterior), suficiente para letras y dígitos latinos. Glifos con formas
 * anidadas más profundas (p.ej. "@") no están garantizados en este MVP.
 */
export function buildContourHierarchy(contours: Point2D[][]): ContourGroup[] {
  const n = contours.length;
  if (n === 0) return [];
  if (n === 1) return [{ outer: contours[0], holes: [] }];

  const containment: number[] = contours.map(() => 0);
  const containedBy: number[][] = contours.map(() => []);

  for (let i = 0; i < n; i++) {
    const testPoint = representativePoint(contours[i]);
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (isPointInPolygon(testPoint, contours[j])) {
        containment[i]++;
        containedBy[i].push(j);
      }
    }
  }

  const groups: ContourGroup[] = [];
  const outersIndex = new Map<number, number>();

  contours.forEach((points, i) => {
    if (containment[i] % 2 === 0) {
      outersIndex.set(i, groups.length);
      groups.push({ outer: points, holes: [] });
    }
  });

  contours.forEach((points, i) => {
    if (containment[i] % 2 !== 0) {
      const parent = findImmediateParent(i, containedBy[i], containment);
      const groupIndex = parent !== null ? outersIndex.get(parent) : undefined;
      if (groupIndex !== undefined) {
        groups[groupIndex].holes.push(points);
      }
      // Si no hay exterior directo (caso patológico), el hueco se descarta:
      // no hay material del cual restarlo.
    }
  });

  return groups;
}

function findImmediateParent(_self: number, containers: number[], containment: number[]): number | null {
  let best: number | null = null;
  let bestDepth = -1;
  for (const c of containers) {
    if (containment[c] % 2 !== 0) continue; // el padre inmediato debe ser un exterior
    if (containment[c] > bestDepth) {
      bestDepth = containment[c];
      best = c;
    }
  }
  return best;
}

function representativePoint(points: Point2D[]): Point2D {
  // Punto medio de un segmento inicial: evita coincidencias exactas con
  // vértices de otros contornos, que pueden confundir el ray casting.
  const [x0, y0] = points[0];
  const [x1, y1] = points[1] ?? points[0];
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

function isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
