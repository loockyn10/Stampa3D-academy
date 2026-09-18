import type * as opentype from "opentype.js";
import type { LetterGeometryResult, LetterGeometryWarning, LetterPieceResult, LetterSignParams, Point2D, PartKind, SignPart, TriangleSoupData } from "@/lib/maker/types";
import { textToPerCharacterPaths, flattenOpentypePath } from "@/lib/maker/geometry/textToPaths";
import { buildContourHierarchy } from "@/lib/maker/geometry/contourHierarchy";
import { toTriangleSoupData } from "@/lib/maker/geometry/extrudePolygon";
import { buildBody } from "@/lib/maker/geometry/body";
import { buildFrontParts } from "@/lib/maker/geometry/front";

/**
 * Pipeline completo: texto + parámetros -> mesh 3D triangulado, un carácter
 * a la vez (mismo layout/kerning que un único font.getPath, ver
 * textToPerCharacterPaths). El resultado combinado (`parts`) es exactamente
 * la concatenación por kind de `letters[]`: no hay un motor de exportación
 * paralelo, la letra individual usa las mismas piezas que ya forman parte
 * del texto completo.
 *
 * Cada letra tiene una lista de piezas físicas (`SignPart[]`), siempre con
 * una de kind "body" (ver geometry/body/, único sólido soldado por
 * coordenadas compartidas, sin CSG) y opcionalmente otras según
 * `frontType` (ver geometry/front/ — tapa, y en 0.4 máscara/difusor/canal).
 * Body y front nunca se sueldan entre sí a propósito: son piezas separadas
 * para imprimir independientemente.
 */
export function createLetterGeometry(font: opentype.Font, params: LetterSignParams): LetterGeometryResult {
  const warnings: LetterGeometryWarning[] = [];
  const errors: LetterGeometryWarning[] = [];

  if (!params.text || params.text.trim().length === 0) {
    warnings.push({ code: "EMPTY_TEXT", message: "Escribí un texto para generar el modelo." });
    return emptyResult(warnings);
  }

  const perCharacterPaths = textToPerCharacterPaths(font, params.text, params.heightMm);

  const letters: LetterPieceResult[] = [];
  const allRawContours: Point2D[][] = [];
  let anyFullyEroded = false;
  const collapsedLetters: { char: string; index: number; code: "LIP_COLLAPSED" | "CHANNEL_COLLAPSED" }[] = [];

  // La profundidad de encastre no puede exceder la cavidad real disponible
  // (depthMm - baseMm: por debajo de baseMm el cuerpo es la base maciza,
  // ver geometry/body/standard.ts) sin chocar contra ella. Es un parámetro
  // global (no depende de la letra), así que se ajusta una sola vez acá —
  // sección 12 del spec: no generar geometría corrupta, avisar.
  const interiorLip = params.frontType === "lid" && params.lidJoint === "interior-lip";
  const insertDepthUsedMm = interiorLip
    ? Math.min(Math.max(params.insertDepthMm, 0), Math.max(params.depthMm - params.baseMm, 0))
    : params.insertDepthMm;
  const insertDepthClamped = interiorLip && insertDepthUsedMm < params.insertDepthMm - 1e-9;

  // Misma lógica para la profundidad del canal luminoso (0.4 Etapa 6): el
  // canal nunca puede atravesar el cuerpo, así que se acota a la cavidad
  // disponible una sola vez acá.
  const lightChannel = params.frontType === "light-channel";
  const channelDepthUsedMm = lightChannel
    ? Math.min(Math.max(params.channelDepthMm, 0), Math.max(params.depthMm - params.baseMm, 0))
    : params.channelDepthMm;
  const channelDepthClamped = lightChannel && channelDepthUsedMm < params.channelDepthMm - 1e-9;

  for (const { char, path } of perCharacterPaths) {
    const rawContours = flattenOpentypePath(path);
    if (rawContours.length === 0) continue; // espacio u otro glifo sin tinta

    allRawContours.push(...rawContours);
    const contourGroups = buildContourHierarchy(rawContours);

    const bodyResult = buildBody(contourGroups, params, { channelDepthUsedMm });
    if (bodyResult.fullyEroded) anyFullyEroded = true;

    const index = letters.length + 1;
    const frontResult = buildFrontParts(contourGroups, params, insertDepthUsedMm);
    if (frontResult.collapseErrorCode) collapsedLetters.push({ char, index, code: frontResult.collapseErrorCode });

    const parts: SignPart[] = [
      { kind: "body", filenameSuffix: "cuerpo", mesh: toTriangleSoupData(bodyResult.body) },
      ...frontResult.parts,
    ];

    letters.push({ char, index, parts });
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

  // LIP_COLLAPSED/CHANNEL_COLLAPSED son ERRORES, no warnings: una tapa
  // pedida como "encastrable" o un frente pedido como "canal luminoso" no
  // pueden exportarse en silencio sin encastre/canal funcional (ver
  // LetterGeometryResult.errors). El preview sigue mostrando la
  // degradación (placa plana / sin canal) en esa letra para que el usuario
  // entienda qué ocurre, pero el resultado queda marcado como inválido
  // para exportar. Un mensaje por letra afectada: alcanza con una lista
  // simple, no hace falta un selector de errores.
  for (const { char, index, code } of collapsedLetters) {
    const message = code === "LIP_COLLAPSED"
      ? `El encastre no puede generarse en la letra "${char}" (posición ${index}): el labio desaparece con estos parámetros. Reducí la holgura, reducí el espesor de pared, aumentá el tamaño o utilizá una fuente más gruesa.`
      : `El canal luminoso no puede generarse en la letra "${char}" (posición ${index}): el trazo es demasiado fino para el ancho de canal pedido. Reducí el ancho del canal, reducí el margen, aumentá el tamaño o utilizá una fuente más gruesa.`;
    errors.push({ code, message });
  }

  if (insertDepthClamped) {
    warnings.push({
      code: "INSERT_DEPTH_CLAMPED",
      message: `Profundidad de encastre ajustada de ${formatMm(params.insertDepthMm)} mm a ${formatMm(insertDepthUsedMm)} mm porque el cuerpo no dispone de más espacio útil.`,
    });
  }

  if (channelDepthClamped) {
    warnings.push({
      code: "CHANNEL_DEPTH_CLAMPED",
      message: `Profundidad de canal ajustada de ${formatMm(params.channelDepthMm)} mm a ${formatMm(channelDepthUsedMm)} mm porque el cuerpo no dispone de más espacio útil.`,
    });
  }

  const parts = combinePartsByKind(letters);

  return {
    parts,
    triangleCount: parts.reduce((sum, p) => sum + p.mesh.triangleCount, 0),
    boundingBox: computeBoundingBox(allRawContours, params.depthMm + frontExtraDepthMm(params)),
    errors,
    warnings,
    letters,
  };
}

function formatMm(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

/** Profundidad extra que suma el sistema de frente activo, solo para el bounding box aproximado (no afecta la geometría real, cada front/* ya coloca sus piezas en su propio rango Z). */
function frontExtraDepthMm(params: LetterSignParams): number {
  switch (params.frontType) {
    case "open":
      return 0;
    case "lid":
      return params.lidMm;
    case "perforated":
      return params.diffuserThicknessMm + params.maskThicknessMm;
    case "light-channel":
      // El canal y su difusor viven DENTRO de [0, depthMm] (el canal es
      // una cavidad, nunca atraviesa el frente): no suman profundidad.
      return 0;
  }
}

/**
 * Orden canónico de piezas en el resultado combinado: estable entre
 * builds, y el orden en el que el preview/exportadores las recorren.
 */
const PART_ORDER: PartKind[] = ["body", "lid", "mask", "diffuser", "channelDiffuser"];

/** Concatena, por kind, la pieza de todas las letras que la tengan (mismo kind = mismo sufijo de archivo). */
function combinePartsByKind(letters: LetterPieceResult[]): SignPart[] {
  const combined: SignPart[] = [];
  for (const kind of PART_ORDER) {
    const meshes: TriangleSoupData[] = [];
    let filenameSuffix: string | null = null;
    for (const letter of letters) {
      const part = letter.parts.find((p) => p.kind === kind);
      if (!part) continue;
      meshes.push(part.mesh);
      filenameSuffix = part.filenameSuffix;
    }
    if (meshes.length === 0 || filenameSuffix === null) continue;
    combined.push({ kind, filenameSuffix, mesh: concatTriangleSoups(meshes) });
  }
  return combined;
}

function concatTriangleSoups(pieces: TriangleSoupData[]): TriangleSoupData {
  const positions = Float32Array.from(pieces.flatMap((p) => Array.from(p.positions)));
  const normals = Float32Array.from(pieces.flatMap((p) => Array.from(p.normals)));
  return { positions, normals, triangleCount: positions.length / 9 };
}

function emptyResult(warnings: LetterGeometryWarning[]): LetterGeometryResult {
  return {
    parts: [],
    triangleCount: 0,
    boundingBox: { width: 0, height: 0, depth: 0 },
    errors: [],
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
