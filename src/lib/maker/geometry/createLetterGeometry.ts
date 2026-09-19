import type * as opentype from "opentype.js";
import type { ContourGroup, LetterGeometryResult, LetterGeometryWarning, LetterPieceResult, LetterSignParams, Point2D, PartKind, SignPart, TriangleSoupData } from "@/lib/maker/types";
import { textToPerCharacterPaths, flattenOpentypePath } from "@/lib/maker/geometry/textToPaths";
import { buildContourHierarchy } from "@/lib/maker/geometry/contourHierarchy";
import { toTriangleSoupData } from "@/lib/maker/geometry/extrudePolygon";
import { buildBody } from "@/lib/maker/geometry/body";
import { computeDesignCenter, planBackCutouts } from "@/lib/maker/geometry/backCutouts";
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
  if (!params.text || params.text.trim().length === 0) {
    return emptyResult([{ code: "EMPTY_TEXT", message: "Escribí un texto para generar el modelo." }]);
  }

  // Fuente "texto" -> ContourGroups. Es la única parte que conoce las
  // fuentes: de acá en adelante el motor solo ve `ContourPiece[]`.
  const pieces: ContourPiece[] = [];
  for (const { char, path } of textToPerCharacterPaths(font, params.text, params.heightMm)) {
    const rawContours = flattenOpentypePath(path);
    if (rawContours.length === 0) continue; // espacio u otro glifo sin tinta
    const index = pieces.length + 1;
    pieces.push({ char, label: `la letra "${char}" (posición ${index})`, contourGroups: buildContourHierarchy(rawContours), rawContours });
  }
  return createGeometryFromContourPieces(pieces, params);
}

/**
 * Una pieza física independiente del diseño ya normalizada a ContourGroups
 * (mm, Y arriba): una letra de texto, o el diseño completo importado desde
 * SVG/PNG (ver lib/maker/import). Frontera única entre "de dónde viene la
 * forma" y el motor de cuerpo/frente.
 */
export interface ContourPiece {
  /** Etiqueta corta para nombres de archivo (una letra, o "diseno"). */
  char: string;
  /** Cómo nombrar la pieza en mensajes de error, p.ej. `la letra "S" (posición 1)` o `el diseño importado`. */
  label: string;
  contourGroups: ContourGroup[];
  /** Contornos crudos (solo texto): para el bounding box exacto de siempre. Si falta, se usa `contourGroups`. */
  rawContours?: Point2D[][];
}

/** Motor compartido: ContourPiece[] + parámetros -> partes (cuerpo/frente/exportación). No sabe si la forma vino de texto, SVG o PNG. */
export function createGeometryFromContourPieces(pieces: ContourPiece[], params: LetterSignParams): LetterGeometryResult {
  const warnings: LetterGeometryWarning[] = [];
  const errors: LetterGeometryWarning[] = [];

  const letters: LetterPieceResult[] = [];
  const allRawContours: Point2D[][] = [];
  const collapseLabels = new Map<number, string>();
  let anyFullyEroded = false;
  const collapsedLetters: { char: string; index: number; code: "LIP_COLLAPSED" | "CHANNEL_COLLAPSED" | "BEVEL_PLATE_COLLAPSED" | "MASK_SKIRT_COLLAPSED" | "LID_BEVEL_COLLAPSED" }[] = [];

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

  // Misma lógica para la cobertura lateral de la máscara perforada (0.4.1
  // corrección 4B): el faldón cubre el LATERAL del cuerpo (existe en toda
  // su profundidad, z=0 a depthMm — a diferencia de insertDepth/channelDepth,
  // que se acotan contra la cavidad hueca, no contra la base maciza), así
  // que se acota contra `depthMm` completo, una sola vez acá.
  const perforated = params.frontType === "perforated";
  const maskSideDepthUsedMm = perforated
    ? Math.min(Math.max(params.maskSideDepthMm, 0), Math.max(params.depthMm, 0))
    : params.maskSideDepthMm;
  const maskSideDepthClamped = perforated && maskSideDepthUsedMm < params.maskSideDepthMm - 1e-9;

  // Bisel de tapa/difusor (0.4.2): la profundidad de banda nunca puede
  // superar el espesor real de la pieza a la que se aplica (`lidMm` para la
  // tapa, `diffuserThicknessMm` para el difusor del frente perforado — ver
  // geometry/plateBevel.ts) sin perforarla. Parámetro global (no depende de
  // la letra), se ajusta una sola vez acá, igual que insertDepthMm/
  // channelDepthMm/maskSideDepthMm — nunca en silencio (LID_BEVEL_DEPTH_CLAMPED).
  const lidBevelApplicablePieceThicknessMm =
    params.frontType === "lid" ? params.lidMm : params.frontType === "perforated" ? params.diffuserThicknessMm : 0;
  const lidBevelActive = params.lidBevelEnabled && lidBevelApplicablePieceThicknessMm > 0;
  const lidBevelDepthUsedMm = lidBevelActive
    ? Math.min(Math.max(params.lidBevelDepthMm, 0), lidBevelApplicablePieceThicknessMm)
    : params.lidBevelDepthMm;
  const lidBevelDepthClamped = lidBevelActive && lidBevelDepthUsedMm < params.lidBevelDepthMm - 1e-9;

  // Recortes traseros (0.6): se validan una sola vez contra la cavidad de TODO el
  // diseño; los inválidos no se cortan y bloquean la exportación (errors).
  const backCutoutPlan = planBackCutouts(pieces, params);
  errors.push(...backCutoutPlan.errors);

  for (const { char, label, contourGroups, rawContours } of pieces) {
    allRawContours.push(...(rawContours ?? contourGroups.flatMap((g) => [g.outer, ...g.holes])));

    const bodyResult = buildBody(contourGroups, params, { channelDepthUsedMm, backCutoutRegion: backCutoutPlan.region });
    if (bodyResult.fullyEroded) anyFullyEroded = true;

    const index = letters.length + 1;
    collapseLabels.set(index, label);
    const frontResult = buildFrontParts(contourGroups, params, insertDepthUsedMm, maskSideDepthUsedMm, lidBevelDepthUsedMm);
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
  const COLLAPSE_MESSAGES: Record<(typeof collapsedLetters)[number]["code"], (label: string) => string> = {
    LIP_COLLAPSED: (label) =>
      `El encastre no puede generarse en ${label}: el labio desaparece con estos parámetros. Reducí la holgura, reducí el espesor de pared, aumentá el tamaño o utilizá una fuente más gruesa.`,
    CHANNEL_COLLAPSED: (label) =>
      `El canal luminoso no puede generarse en ${label}: el trazo es demasiado fino para el ancho de canal pedido. Reducí el ancho del canal, reducí el margen, aumentá el tamaño o utilizá una fuente más gruesa.`,
    BEVEL_PLATE_COLLAPSED: (label) =>
      `La tapa no puede generarse en ${label}: el bisel frontal erosiona la placa por completo con estos parámetros. Reducí el desplazamiento del bisel, aumentá el tamaño o utilizá una fuente más gruesa.`,
    MASK_SKIRT_COLLAPSED: (label) =>
      `El faldón lateral de la máscara perforada no puede generarse en ${label}: la holgura/espesor pedidos erosionan el faldón por completo. Reducí la holgura, el espesor lateral, o la cobertura lateral.`,
    LID_BEVEL_COLLAPSED: (label) =>
      `El bisel de tapa/difusor no puede generarse en ${label}: erosiona la cara visible de la pieza por completo con estos parámetros. Reducí el desplazamiento del bisel, aumentá el tamaño o utilizá una fuente más gruesa.`,
  };

  for (const { char, index, code } of collapsedLetters) {
    errors.push({ code, message: COLLAPSE_MESSAGES[code](collapseLabels.get(index) ?? `la letra "${char}" (posición ${index})`) });
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

  if (maskSideDepthClamped) {
    warnings.push({
      code: "MASK_SIDE_DEPTH_CLAMPED",
      message: `Cobertura lateral de la máscara ajustada de ${formatMm(params.maskSideDepthMm)} mm a ${formatMm(maskSideDepthUsedMm)} mm porque el cuerpo no tiene más profundidad.`,
    });
  }

  if (lidBevelDepthClamped) {
    warnings.push({
      code: "LID_BEVEL_DEPTH_CLAMPED",
      message: `Profundidad del bisel de tapa/difusor ajustada de ${formatMm(params.lidBevelDepthMm)} mm a ${formatMm(lidBevelDepthUsedMm)} mm porque la pieza no tiene más espesor disponible.`,
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
    designCenter: computeDesignCenter(pieces),
    backCutoutSafeZone: backCutoutPlan.safeZone,
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
 * builds, y el orden en el que el preview/exportadores las recorren. Es
 * también el orden FÍSICO de armado (del cuerpo hacia el observador),
 * consistente con `PART_ASSEMBLY_LAYER` (ver geometry/explodeOrder.ts) — esa
 * tabla, no esta lista, es la fuente de verdad que usa MakerViewport.tsx
 * para el rank de la vista explosionada (0.4.2: depender del orden de
 * recorrido de un array, o de la posición Z real de la malla, resultó frágil
 * dos veces — ver explodeOrder.ts para el historial).
 */
const PART_ORDER: PartKind[] = ["body", "lid", "diffuser", "mask", "channelDiffuser"];

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
    designCenter: { x: 0, y: 0 },
    backCutoutSafeZone: null,
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
