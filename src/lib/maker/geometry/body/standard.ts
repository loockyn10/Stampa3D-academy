import type * as ClipperLib from "clipper-lib";
import type { ContourGroup, LetterSignParams } from "@/lib/maker/types";
import { insetContourGroups, differenceContourGroups, contourGroupsToRawPaths } from "@/lib/maker/geometry/offsets";
import { extrudeContourGroups, type ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";
import { computeRibBands, ribBandsToZBands } from "@/lib/maker/geometry/body/modifiers/ribs";
import { computeBevelBand, bevelBandToZBand, beveledFrontFootprint } from "@/lib/maker/geometry/body/modifiers/bevel";
import { computeGrooveBand, grooveBandToZBand } from "@/lib/maker/geometry/body/modifiers/groove";
import { computeRearBevelBand, rearBevelBandToZBand, beveledRearFootprint } from "@/lib/maker/geometry/body/modifiers/rearBevel";
import { computeWallAndCore, buildBandedOuterWallPieces, type ZBand } from "@/lib/maker/geometry/body/shared";
// El canal luminoso (0.4 Etapa 6) es, conceptualmente, un FRONT SYSTEM —
// pero a diferencia de la tapa/máscara/difusor (piezas separadas que se
// apoyan encima), el canal está tallado DENTRO del propio "frente" del
// cuerpo (pieza 4 más abajo): no hay forma de generarlo sin tocar esa
// pieza. Se importa acá a propósito (única excepción documentada a "body
// no conoce frontType") en vez de duplicar el cálculo de la huella del
// canal.
import { applyBackCutoutsToBase } from "@/lib/maker/geometry/backCutouts";
import { computeChannelFootprint } from "@/lib/maker/geometry/front/lightChannel";

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
 *
 * Cuerpo "standard" (0.4 Etapa 1: extraído tal cual de
 * createLetterGeometry.ts, mismo comportamiento). Es el mismo sólido sin
 * importar el modo de frente (abierto, tapa plana o tapa encastrable) —
 * ver geometry/front/ para la tapa/máscara/difusor, piezas SEPARADAS a
 * propósito.
 */
export interface BuildStandardBodyContext {
  /** channelDepthMm ya acotado a la cavidad disponible (depthMm - baseMm), calculado una sola vez en createLetterGeometry.ts. Solo se usa si frontType === "light-channel". */
  channelDepthUsedMm: number;
  /** Región global de recortes traseros ya validada (ver geometry/backCutouts.ts). Vacía/ausente = sin recortes. */
  backCutoutRegion?: ClipperLib.Paths;
}

export function buildStandardBodyPieces(
  contourGroups: ContourGroup[],
  params: LetterSignParams,
  ctx: BuildStandardBodyContext,
): { body: ExtrudedMeshData; fullyEroded: boolean } {
  const fondoGroups: ContourGroup[] = [];
  const wallGroups: ContourGroup[] = [];
  const coreGroups: ContourGroup[] = [];
  const bandedWallPieces: ExtrudedMeshData[] = [];
  const channelFrontPieces: ExtrudedMeshData[] = [];
  const isLightChannel = params.frontType === "light-channel";
  let fullyEroded = false;

  const wallHeight = params.depthMm - params.baseMm;
  // Bisel frontal (0.4 Etapa 4, suavizado 0.4.1): banda pegada al frente.
  // `null` si está desactivado, sin cambio de comportamiento.
  const bevelBand = wallHeight > 0 ? computeBevelBand(params.baseMm, params.depthMm, params.bevelEnabled, params.bevelDepthMm) : null;
  // Doble bisel / cintura luminosa (0.4.1 corrección 3B): banda
  // INDEPENDIENTE del bisel frontal, en cualquier posición de la pared
  // (`groovePositionMm`, medida desde el frente). `validateLetterSignParams`
  // bloquea la combinación si se superpone con la banda de bisel (ver
  // validation.ts) — acá solo se calcula, sin volver a chequear el choque.
  const grooveBand = wallHeight > 0
    ? computeGrooveBand(params.baseMm, params.depthMm, params.grooveEnabled, params.groovePositionMm, params.grooveWidthMm)
    : null;
  // Bisel posterior (0.4.2): banda pegada a la BASE (Z=0), equivalente
  // trasero del bisel frontal — ver body/modifiers/rearBevel.ts. A
  // diferencia del bisel frontal, no se acota contra `baseMm` (reshapea
  // justamente el extremo trasero, incluida la base maciza).
  const rearBevelBand = wallHeight > 0 ? computeRearBevelBand(params.depthMm, params.rearBevelEnabled, params.rearBevelDepthMm) : null;
  // Costillas (0.4 Etapa 2): bandas dentro de la pared, nunca de la base
  // maciza NI de la banda del bisel (si está activo, las costillas quedan
  // acotadas a lo que sobra antes de esa banda — evita que ambos
  // modificadores compitan por el mismo tramo de Z). Vacío (sin cambio de
  // comportamiento) cuando ribsCount es 0 o el campo no existe (fixtures
  // más viejos). Además (0.4.1), cualquier costilla que caiga dentro de la
  // banda del doble bisel se descarta — mismo criterio de "ceder lugar" que
  // ya existía para el bisel frontal, ahora también contra el doble bisel.
  // 0.4.2: el piso de las costillas cede lugar también a la banda del bisel
  // posterior, mismo criterio.
  const ribsFloorMm = rearBevelBand ? rearBevelBand.z1 : params.baseMm;
  const ribsCeilingMm = bevelBand ? bevelBand.z0 : params.depthMm;
  const ribBandsRaw = wallHeight > 0 && ribsFloorMm < ribsCeilingMm
    ? computeRibBands(ribsFloorMm, ribsCeilingMm, params.ribsCount, params.ribWidthMm)
    : [];
  const ribBands = grooveBand ? ribBandsRaw.filter((rb) => rb.z1 <= grooveBand.z0 || rb.z0 >= grooveBand.z1) : ribBandsRaw;

  // Todas las bandas de modificador de ESTA letra, combinadas en una sola
  // pasada por `buildBandedOuterWallPieces` (0.4.1: antes costillas y bisel
  // se generaban con dos llamadas separadas; el doble bisel se suma acá sin
  // agregar una tercera; 0.4.2 agrega el bisel posterior de la misma forma).
  // `validateLetterSignParams` bloquea la combinación si el bisel frontal y
  // el posterior se superponen (ver validation.ts) — acá solo se combinan,
  // sin volver a chequear el choque.
  const zBands: ZBand[] = [
    ...ribBandsToZBands(ribBands, params.ribProtrusionMm),
    ...(bevelBand ? [bevelBandToZBand(bevelBand, params.bevelInsetMm)] : []),
    ...(grooveBand ? [grooveBandToZBand(grooveBand, params.grooveInsetMm)] : []),
    ...(rearBevelBand ? [rearBevelBandToZBand(rearBevelBand, params.rearBevelInsetMm)] : []),
  ];

  for (const group of contourGroups) {
    // 0.4.2: el fondo usa el footprint erosionado por el bisel posterior en
    // su extremo (Z=0) en vez del contorno original, cuando está activo —
    // mismo mecanismo que el "frente" ya usa para el bisel frontal
    // (`beveledFrontFootprint`), en el extremo opuesto.
    fondoGroups.push(...beveledRearFootprint(group, rearBevelBand, params.rearBevelInsetMm));

    let groupWallGroups: ContourGroup[];
    if (isLightChannel) {
      // El canal luminoso asume un cuerpo MACIZO (sin la cavidad interior
      // hueca del resto de los frentes) con un frente OPACO salvo por el
      // propio canal — "el resto del frente permanece opaco/negro" (ver
      // sección transversal del spec: material sólido rodeando el canal
      // en TODA la profundidad, no un anillo fino de wallMm). Por eso acá
      // no se erosiona ningún núcleo: el footprint de partida es la
      // silueta COMPLETA de la letra. El bisel (que sí asume el
      // frente-anillo delgado del cuerpo hueco) no aplica junto con el
      // canal en este sprint (combinación fuera de alcance, ver
      // docs/STAMPA_MAKER.md).
      groupWallGroups = [{ outer: group.outer, holes: group.holes }];
    } else {
      const wac = computeWallAndCore(group, params.wallMm);
      if (wac.fullyEroded) fullyEroded = true;
      coreGroups.push(...wac.coreGroups);
      if (bevelBand) {
        // El frente ya no usa la silueta original: el bisel es visible
        // justo en el borde, así que el frente empalma con el inset
        // completo que deja la pared biselada ahí (ver bevel.ts).
        const coreRawPaths = insetContourGroups([group], params.wallMm);
        groupWallGroups = differenceContourGroups(beveledFrontFootprint(group, bevelBand, params.bevelInsetMm), coreRawPaths);
      } else {
        groupWallGroups = wac.wallGroups;
      }
    }

    if (isLightChannel) {
      // El canal es una cavidad tallada DESDE el frente hacia adentro,
      // nunca atraviesa el cuerpo (queda un piso a channelDepthUsedMm del
      // frente). Colapsado (trazo demasiado fino): no se talla nada para
      // este contorno, el frente queda macizo ahí — el error
      // CHANNEL_COLLAPSED (ver createLetterGeometry.ts) bloquea la
      // exportación en vez de degradarse en silencio.
      const channel = computeChannelFootprint(group, params.channelOffsetMm, params.channelWidthMm);
      if (!channel.collapsed) {
        const channelRawPaths = contourGroupsToRawPaths(channel.channelGroups);
        groupWallGroups = differenceContourGroups(groupWallGroups, channelRawPaths);
        const channelZ0 = params.depthMm - ctx.channelDepthUsedMm;
        // Piso del canal: tapa mirando +Z (visible entrando por la boca del canal).
        channelFrontPieces.push(extrudeContourGroups(channel.channelGroups, channelZ0, channelZ0, { capStart: false, capEnd: true, sides: false }));
        // Paredes internas del canal: mismo truco que las paredes del
        // núcleo erosionado (flipSides, el material real queda afuera del
        // footprint del canal).
        channelFrontPieces.push(extrudeContourGroups(channel.channelGroups, channelZ0, params.depthMm, { capStart: false, capEnd: false, sides: true, flipSides: true }));
      }
    }

    wallGroups.push(...groupWallGroups);

    if (wallHeight > 0) {
      bandedWallPieces.push(...buildBandedOuterWallPieces(group, 0, params.depthMm, zBands));
    }
  }

  const pieces: ExtrudedMeshData[] = [];

  if (wallHeight <= 0) {
    // Caso defensivo (bloqueado por validation.ts): sin lugar para pared,
    // el fondo pasa a ocupar toda la profundidad, macizo.
    pieces.push(extrudeContourGroups(fondoGroups, 0, params.depthMm, { capStart: true, capEnd: true }));
  } else {
    // 1) Fondo: tapa en z=0 (sin costillas: la base siempre es plana) +
    //    paredes laterales del exterior/huecos originales de punta a
    //    punta (0 -> depthMm), con costillas si corresponde (ver
    //    body/modifiers/ribs.ts — sin costillas, es la misma franja
    //    continua de siempre, mismo resultado byte a byte).
    // Recortes traseros (2D): huecos en la tapa de la base y en la repisa, más las paredes del recorte entre Z=0 y baseMm.
    const cutouts = applyBackCutoutsToBase({ region: ctx.backCutoutRegion, baseCapGroups: fondoGroups, coreGroups, baseMm: params.baseMm });
    pieces.push(extrudeContourGroups(cutouts.baseCapGroups, 0, 0, { capStart: true, capEnd: false, sides: false }));
    pieces.push(...bandedWallPieces);
    pieces.push(...cutouts.holeWalls);

    if (!isLightChannel) {
      // 2) Repisa: tapa del núcleo erosionado en z=baseMm (mirando hacia
      //    +Z), visible desde la cavidad. Reemplaza la tapa completa que
      //    antes ponía el fondo ahí (esa tapaba el hueco). Vacía si el
      //    trazo se erosionó por completo (pared > mitad del trazo). No
      //    aplica con canal luminoso: el cuerpo es macizo, sin cavidad
      //    interior (ver arriba).
      pieces.push(extrudeContourGroups(cutouts.shelfGroups, params.baseMm, params.baseMm, { capStart: false, capEnd: true, sides: false }));

      // 3) Paredes internas nuevas: bordes del núcleo erosionado, de baseMm
      //    a depthMm (separan la pared hueca de la cavidad real). flipSides
      //    porque, como región, el material "natural" del núcleo es su
      //    propio interior — pero acá el núcleo representa la cavidad
      //    (vacía) y el material real está afuera de él (huella de pared),
      //    así que la normal debe apuntar hacia adentro del núcleo.
      pieces.push(extrudeContourGroups(coreGroups, params.baseMm, params.depthMm, { capStart: false, capEnd: false, sides: true, flipSides: true }));
    }

    // 4) Frente: tapa de la huella de pared en z=depthMm (mirando hacia
    //    +Z). Earcut nunca triangula el interior del núcleo (llega como
    //    holeIndices), así que esta tapa nunca cubre la cavidad. Con
    //    frontType "lid" este frente sigue existiendo (el cuerpo no
    //    cambia): la tapa es una pieza aparte que se apoya encima, no un
    //    reemplazo del frente de la pared.
    pieces.push(extrudeContourGroups(wallGroups, params.depthMm, params.depthMm, { capStart: false, capEnd: true, sides: false }));
    pieces.push(...channelFrontPieces);
  }

  const body: ExtrudedMeshData = {
    positions: pieces.flatMap((p) => p.positions),
    normals: pieces.flatMap((p) => p.normals),
  };

  return { body, fullyEroded };
}
