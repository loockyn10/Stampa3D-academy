import type { ContourGroup, LetterSignParams } from "@/lib/maker/types";
import { applyBackCutoutsToBase } from "@/lib/maker/geometry/backCutouts";
import { applyInstallationToBase } from "@/lib/maker/installation/bodyFeatures";
import type { BuildStandardBodyContext } from "@/lib/maker/geometry/body/standard";
import { extrudeContourGroups, type ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";
import { computeWallAndCore, subdivideRange, footprintAtOffset, buildOffsetProfileWallPieces, smoothstepRampProfile } from "@/lib/maker/geometry/body/shared";

// "stepped" (0.4, sin cambios de comportamiento): bandas grandes a
// propósito, el escalonado es visible — un estilo, no una aproximación que
// haya que disimular. `extrudeContourGroups` solo genera paredes rectas
// (footprint constante) por llamada, así que el offset progresivo se
// aproxima con varios tramos rectos apilados en vez de una superficie curva.
const TAPER_STEPPED_BAND_HEIGHT_MM = 2;
const TAPER_STEPPED_MIN_BANDS = 8;

// "smooth" (0.4.1 corrección 2): misma aproximación por tramos rectos, pero
// con resolución fina (~0.2mm, referencia del pedido) para que se perciba
// como una pendiente continua. `TAPER_SMOOTH_MAX_STEPS` evita una
// "explosión de polígonos" en cuerpos muy profundos: prioriza no pasarse de
// ~100-120 pasos (la referencia del pedido, "cuerpo de 20mm: ~100 pasos")
// por sobre mantener 0.2mm exactos cuando depthMm es grande.
const TAPER_SMOOTH_RESOLUTION_MM = 0.2;
const TAPER_SMOOTH_MIN_STEPS = 10;
const TAPER_SMOOTH_MAX_STEPS = 120;

function taperSteppedBreakpoints(depthMm: number): number[] {
  const bandCount = Math.max(TAPER_STEPPED_MIN_BANDS, Math.ceil(depthMm / TAPER_STEPPED_BAND_HEIGHT_MM));
  const points: number[] = [];
  for (let i = 0; i <= bandCount; i++) points.push((depthMm * i) / bandCount);
  return points;
}

/** Offset (mm) del contorno exterior/hueco en una coordenada Z, perfil LINEAL: 0 en el frente (z=depthMm, silueta nominal), rearExpansionMm en la base (z=0), progresivo entre medio. Usado por el estilo "stepped" (0.4, sin cambios). */
function taperOffsetLinearAt(z: number, depthMm: number, rearExpansionMm: number): number {
  const t = depthMm > 0 ? z / depthMm : 1; // 0 en la base, 1 en el frente
  return rearExpansionMm * (1 - t);
}

/** Offset (mm) del contorno exterior/hueco en una coordenada Z, perfil SMOOTHSTEP: mismo destino (0 en el frente, rearExpansionMm en la base) que el lineal, pero con pendiente 0 en ambos extremos — sin quiebre anguloso donde la banda empalma con el frente. Usado por el estilo "smooth" (0.4.1 corrección 2). */
function taperOffsetSmoothAt(z: number, depthMm: number, rearExpansionMm: number): number {
  const t = depthMm > 0 ? z / depthMm : 1; // 0 en la base, 1 en el frente
  return smoothstepRampProfile(1 - t, rearExpansionMm);
}

/**
 * Cuerpo "tapered" (0.4 Etapa 3, estilos 0.4.1 corrección 2): la silueta
 * EXTERIOR (y el borde de cada counter — mismo mecanismo dilatado que las
 * costillas, `footprintAtOffset`/`outsetContourGroups` afecta exterior y
 * huecos a la vez) crece progresivamente desde el frente (z=depthMm, offset
 * 0 — silueta nominal, compatible con frente/tapa sin cambios) hacia la base
 * (z=0, offset `rearExpansionMm`), en cualquiera de los dos estilos
 * (`params.taperStyle`, ver types.ts):
 *
 *  - "stepped": bandas grandes (~2mm), perfil LINEAL — el aspecto original
 *    de 0.4, sin cambios de comportamiento.
 *  - "smooth": sub-bandas finas (~0.2mm) + perfil SMOOTHSTEP (pendiente 0 en
 *    ambos extremos) — se percibe como una pendiente continua.
 *
 * Construcción (ambos estilos, vía `buildOffsetProfileWallPieces`): N bandas
 * ancladas por su extremo INFERIOR (bottom-anchored, siempre más ancho para
 * este perfil monótono decreciente en Z) con un escalón horizontal hacia la
 * banda siguiente, más angosta. El último escalón (al llegar a z=depthMm)
 * cierra contra el contorno ORIGINAL exacto (offset 0), asegurando que el
 * frente quede con dimensiones nominales — necesario para que `front/` (que
 * sigue recibiendo `contourGroups` sin modificar) suelde igual que en el
 * cuerpo standard.
 *
 * El resto del cuerpo (repisa, paredes de la cavidad oculta, frente) usa el
 * contorno ORIGINAL sin cambios — igual filosofía que las costillas: el
 * tapered solo cambia la silueta VISIBLE, nunca la cavidad interna oculta.
 *
 * Limitación conocida de 0.4 (sin cambios en 0.4.1): no soporta combinarse
 * con costillas (ribsCount se ignora si bodyType es "tapered") — ver
 * docs/STAMPA_MAKER.md.
 */
export function buildTaperedBodyPieces(
  contourGroups: ContourGroup[],
  params: LetterSignParams,
  ctx?: Pick<BuildStandardBodyContext, "backCutoutRegion" | "installationFeatures">,
): { body: ExtrudedMeshData; fullyEroded: boolean } {
  const fondoGroups: ContourGroup[] = [];
  const wallGroups: ContourGroup[] = [];
  const coreGroups: ContourGroup[] = [];
  const taperedWallPieces: ExtrudedMeshData[] = [];
  let fullyEroded = false;

  const wallHeight = params.depthMm - params.baseMm;
  const smooth = params.taperStyle === "smooth";
  const zPoints = smooth
    ? subdivideRange(0, params.depthMm, TAPER_SMOOTH_RESOLUTION_MM, TAPER_SMOOTH_MIN_STEPS, TAPER_SMOOTH_MAX_STEPS)
    : taperSteppedBreakpoints(params.depthMm);
  const offsetAt = (z: number) =>
    smooth
      ? taperOffsetSmoothAt(z, params.depthMm, params.rearExpansionMm)
      : taperOffsetLinearAt(z, params.depthMm, params.rearExpansionMm);

  for (const group of contourGroups) {
    fondoGroups.push({ outer: group.outer, holes: group.holes });

    const wac = computeWallAndCore(group, params.wallMm);
    if (wac.fullyEroded) fullyEroded = true;
    wallGroups.push(...wac.wallGroups);
    coreGroups.push(...wac.coreGroups);

    if (wallHeight > 0 && params.rearExpansionMm > 1e-6) {
      taperedWallPieces.push(...buildOffsetProfileWallPieces(group, zPoints, offsetAt));
    } else if (wallHeight > 0) {
      // Sin expansión trasera (rearExpansionMm ~0): mismo resultado que el
      // cuerpo standard, franja continua sin escalones.
      taperedWallPieces.push(extrudeContourGroups([{ outer: group.outer, holes: group.holes }], 0, params.depthMm, { capStart: false, capEnd: false, sides: true }));
    }
  }

  const pieces: ExtrudedMeshData[] = [];

  if (wallHeight <= 0) {
    pieces.push(extrudeContourGroups(fondoGroups, 0, params.depthMm, { capStart: true, capEnd: true }));
  } else {
    // 1) Fondo: tapa en z=0, usando el footprint MÁS ANCHO (rearExpansionMm
    //    completo) — igual al que usa la primera banda, sin escalón.
    const baseGroups = params.rearExpansionMm > 1e-6
      ? fondoGroups.flatMap((g) => footprintAtOffset({ outer: g.outer, holes: g.holes }, params.rearExpansionMm))
      : fondoGroups;
    // Recortes traseros (2D), igual que en el cuerpo standard.
    const cutouts = applyInstallationToBase(
      applyBackCutoutsToBase({ region: ctx?.backCutoutRegion, baseCapGroups: baseGroups, coreGroups, baseMm: params.baseMm }),
      ctx?.installationFeatures,
      params.baseMm,
    );
    pieces.push(...(cutouts.extraPieces ?? []));
    pieces.push(extrudeContourGroups(cutouts.baseCapGroups, 0, 0, { capStart: true, capEnd: false, sides: false }));
    pieces.push(...taperedWallPieces);
    pieces.push(...cutouts.holeWalls);

    // 2) Repisa, 3) paredes internas, 4) frente: igual que el cuerpo
    //    standard, sin cambios (la cavidad oculta y la interfaz de
    //    frente/tapa no dependen del tipo de cuerpo ni del estilo tapered).
    pieces.push(extrudeContourGroups(cutouts.shelfGroups, params.baseMm, params.baseMm, { capStart: false, capEnd: true, sides: false }));
    pieces.push(extrudeContourGroups(coreGroups, params.baseMm, params.depthMm, { capStart: false, capEnd: false, sides: true, flipSides: true }));
    pieces.push(extrudeContourGroups(wallGroups, params.depthMm, params.depthMm, { capStart: false, capEnd: true, sides: false }));
  }

  const body: ExtrudedMeshData = {
    positions: pieces.flatMap((p) => p.positions),
    normals: pieces.flatMap((p) => p.normals),
  };

  return { body, fullyEroded };
}
