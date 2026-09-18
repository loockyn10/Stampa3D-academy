import type * as opentype from "opentype.js";
import type { ContourGroup, LetterGeometryResult, LetterGeometryWarning, LetterPieceResult, LetterSignParams, Point2D } from "@/lib/maker/types";
import { textToPerCharacterPaths, flattenOpentypePath } from "@/lib/maker/geometry/textToPaths";
import { buildContourHierarchy } from "@/lib/maker/geometry/contourHierarchy";
import { insetContourGroups, differenceContourGroups, regroupClipperSolution, clipperPathsArea } from "@/lib/maker/geometry/offsets";
import { extrudeContourGroups, type ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";

/**
 * Pipeline completo: texto + parámetros -> mesh 3D triangulado, un carácter
 * a la vez (mismo layout/kerning que un único font.getPath, ver
 * textToPerCharacterPaths). El resultado combinado (`positions`) es
 * exactamente la concatenación de `letters[]`: no hay un motor de
 * exportación paralelo, la letra individual usa la misma pieza que ya
 * forma parte del texto completo.
 *
 * Cada letra es UN SOLO sólido soldado por coordenadas compartidas (no dos
 * cuerpos que solo se tocan): fondo + "repisa" del núcleo erosionado +
 * pared. Ver la sección "Soldadura fondo/pared" más abajo y
 * docs/STAMPA_MAKER.md.
 */
export function createLetterGeometry(font: opentype.Font, params: LetterSignParams): LetterGeometryResult {
  const warnings: LetterGeometryWarning[] = [];

  if (!params.text || params.text.trim().length === 0) {
    warnings.push({ code: "EMPTY_TEXT", message: "Escribí un texto para generar el modelo." });
    return emptyResult(warnings);
  }

  const perCharacterPaths = textToPerCharacterPaths(font, params.text, params.heightMm);

  const letters: LetterPieceResult[] = [];
  const allRawContours: Point2D[][] = [];
  let anyFullyEroded = false;

  for (const { char, path } of perCharacterPaths) {
    const rawContours = flattenOpentypePath(path);
    if (rawContours.length === 0) continue; // espacio u otro glifo sin tinta

    allRawContours.push(...rawContours);
    const contourGroups = buildContourHierarchy(rawContours);
    const piece = buildWeldedLetterSolid(contourGroups, params);
    if (piece.fullyEroded) anyFullyEroded = true;

    const positions = Float32Array.from(piece.mesh.positions);
    const normals = Float32Array.from(piece.mesh.normals);
    letters.push({
      char,
      index: letters.length + 1,
      positions,
      normals,
      triangleCount: positions.length / 9,
    });
  }

  if (letters.length === 0) {
    warnings.push({ code: "NO_GLYPHS", message: "El texto no contiene glifos imprimibles (¿solo espacios?)." });
    return emptyResult(warnings);
  }

  if (anyFullyEroded) {
    warnings.push({
      code: "WALL_TOO_THICK",
      message: "El espesor de pared es demasiado grande para el tamaño del texto: algunos trazos quedaron macizos en vez de huecos.",
    });
  }

  const positions = Float32Array.from(letters.flatMap((l) => Array.from(l.positions)));
  const normals = Float32Array.from(letters.flatMap((l) => Array.from(l.normals)));

  return {
    positions,
    normals,
    triangleCount: positions.length / 9,
    boundingBox: computeBoundingBox(allRawContours, params.depthMm),
    warnings,
    letters,
  };
}

/**
 * Soldadura fondo/pared: en vez de dos sólidos independientes que solo se
 * tocan en z = baseMm (cada uno con su propia tapa completa ahí), se
 * comparte una única tapa por nivel:
 *
 *  - z = 0: tapa del fondo completo (ink shape: exterior menos huecos
 *    originales del glifo) + paredes laterales de esos mismos contornos
 *    desde z=0 hasta z=depthMm (el exterior y los huecos originales no
 *    cambian de forma en ningún punto de la pieza, así que su pared
 *    lateral es una sola franja continua, sin corte en baseMm).
 *  - z = baseMm: en vez de que el fondo tape TODO su propio contorno acá
 *    (lo que taparía el hueco, el bug de la iteración anterior) y la
 *    pared tape por separado su propia huella, se tapa únicamente el
 *    NÚCLEO erosionado (`insetContourGroups`, la misma erosión que ya se
 *    usa para calcular la huella de la pared) — es exactamente la región
 *    que queda sólida por debajo y hueca por encima. Esa única tapa hace
 *    de "repisa": visible mirando hacia el hueco desde el frente.
 *  - paredes laterales del núcleo erosionado, de baseMm a depthMm: son
 *    las mismas paredes que ya generaba la pieza de pared para sus bordes
 *    internos (huella de pared = exterior/hueco original MENOS núcleo).
 *  - z = depthMm: tapa de la huella de pared (frente, dentro del espesor
 *    de pared solamente, nunca sobre la cavidad).
 *
 * El resultado comparte vértices (mismas coordenadas, mismo jitter
 * determinístico) en cada frontera, así que la malla final es un único
 * componente conectado por letra en vez de piezas superpuestas — sin
 * ninguna operación booleana 3D. Confirmado con
 * tests/maker-letter-geometry.test.mjs (conteo de shells por letra).
 */
function buildWeldedLetterSolid(
  contourGroups: ContourGroup[],
  params: LetterSignParams,
): { mesh: ExtrudedMeshData; fullyEroded: boolean } {
  const fondoGroups: ContourGroup[] = [];
  const wallGroups: ContourGroup[] = [];
  const coreGroups: ContourGroup[] = [];
  let fullyEroded = false;

  for (const group of contourGroups) {
    fondoGroups.push({ outer: group.outer, holes: group.holes });

    const insetPaths = insetContourGroups([group], params.wallMm);
    const insetArea = Math.abs(clipperPathsArea(insetPaths));
    if (insetArea < 1e-4) fullyEroded = true;

    wallGroups.push(...differenceContourGroups([group], insetPaths));
    coreGroups.push(...regroupClipperSolution(insetPaths));
  }

  const wallHeight = params.depthMm - params.baseMm;
  const pieces: ExtrudedMeshData[] = [];

  if (wallHeight <= 0) {
    // Caso defensivo (bloqueado por validation.ts): sin lugar para pared,
    // el fondo pasa a ocupar toda la profundidad, macizo.
    pieces.push(extrudeContourGroups(fondoGroups, 0, params.depthMm, { capStart: true, capEnd: true }));
  } else {
    // 1) Fondo: tapa en z=0 + paredes laterales del exterior/huecos
    //    originales de punta a punta (0 -> depthMm). El exterior y cada
    //    hueco original no cambian de forma en ningún punto de la pieza,
    //    así que su pared lateral es una franja continua, sin corte.
    pieces.push(extrudeContourGroups(fondoGroups, 0, params.depthMm, { capStart: true, capEnd: false }));

    // 2) Repisa: tapa del núcleo erosionado en z=baseMm (mirando hacia
    //    +Z), visible desde la cavidad. Reemplaza la tapa completa que
    //    antes ponía el fondo ahí (esa tapaba el hueco). Vacía si el
    //    trazo se erosionó por completo (pared > mitad del trazo).
    pieces.push(extrudeContourGroups(coreGroups, params.baseMm, params.baseMm, { capStart: false, capEnd: true, sides: false }));

    // 3) Paredes internas nuevas: bordes del núcleo erosionado, de baseMm
    //    a depthMm (separan la pared hueca de la cavidad real). flipSides
    //    porque, como región, el material "natural" del núcleo es su
    //    propio interior — pero acá el núcleo representa la cavidad
    //    (vacía) y el material real está afuera de él (huella de pared),
    //    así que la normal debe apuntar hacia adentro del núcleo.
    pieces.push(extrudeContourGroups(coreGroups, params.baseMm, params.depthMm, { capStart: false, capEnd: false, sides: true, flipSides: true }));

    // 4) Frente: tapa de la huella de pared en z=depthMm (mirando hacia
    //    +Z). Earcut nunca triangula el interior del núcleo (llega como
    //    holeIndices), así que esta tapa nunca cubre la cavidad.
    pieces.push(extrudeContourGroups(wallGroups, params.depthMm, params.depthMm, { capStart: false, capEnd: true, sides: false }));
  }

  const mesh: ExtrudedMeshData = {
    positions: pieces.flatMap((p) => p.positions),
    normals: pieces.flatMap((p) => p.normals),
  };
  return { mesh, fullyEroded };
}

function emptyResult(warnings: LetterGeometryWarning[]): LetterGeometryResult {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    triangleCount: 0,
    boundingBox: { width: 0, height: 0, depth: 0 },
    warnings,
    letters: [],
  };
}

function computeBoundingBox(contours: Point2D[][], depthMm: number): { width: number; height: number; depth: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const contour of contours) {
    for (const [x, y] of contour) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { width: maxX - minX, height: maxY - minY, depth: depthMm };
}
