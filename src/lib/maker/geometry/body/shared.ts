import type { ContourGroup } from "@/lib/maker/types";
import {
  insetContourGroups,
  outsetContourGroups,
  differenceContourGroups,
  contourGroupsToRawPaths,
  regroupClipperSolution,
  clipperPathsArea,
} from "@/lib/maker/geometry/offsets";
import { extrudeContourGroups, type ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";

export interface WallAndCore {
  /** Huella de la pared visible (ink menos núcleo): la usa el "frente" del cuerpo, ver body/standard.ts y body/tapered.ts. */
  wallGroups: ContourGroup[];
  /** Huella de la cavidad interior oculta (núcleo erosionado por wallMm): la usa la "repisa" y las paredes internas. */
  coreGroups: ContourGroup[];
  fullyEroded: boolean;
}

/**
 * Cavidad interior (hueca) de UN contorno: erosiona por `wallMm`, misma
 * lógica sin importar el tipo de cuerpo — la cavidad oculta nunca depende
 * de si el cuerpo es standard o tapered (ver body/tapered.ts: el tapered
 * solo cambia la silueta VISIBLE, nunca la cavidad interna ni la interfaz
 * con frente/tapa). Extraído de createLetterGeometry.ts (0.4 Etapa 1) para
 * que ambos tipos de cuerpo reusen el mismo cálculo sin duplicar las
 * llamadas a Clipper.
 */
export function computeWallAndCore(group: ContourGroup, wallMm: number): WallAndCore {
  const insetPaths = insetContourGroups([group], wallMm);
  const insetArea = Math.abs(clipperPathsArea(insetPaths));
  const fullyEroded = insetArea < 1e-4;
  const wallGroups = differenceContourGroups([group], insetPaths);
  const coreGroups = regroupClipperSolution(insetPaths);
  return { wallGroups, coreGroups, fullyEroded };
}

/**
 * Divide `[z0, z1]` en sub-bandas de altura objetivo `resolutionMm`, con un
 * piso y techo de cantidad de pasos (`minSteps`/`maxSteps`) — mismo
 * mecanismo que ya usaban tapered/bevel por separado (0.4), centralizado acá
 * (0.4.1) porque ahora lo comparten costillas/tapered-suave/bisel-suave/
 * doble-bisel: todos aproximan una curva con tramos rectos + escalones.
 * `maxSteps` evita "explosiones de polígonos" en rangos grandes con una
 * resolución fina (p.ej. un cuerpo con depthMm de varios cm).
 */
export function subdivideRange(z0: number, z1: number, resolutionMm: number, minSteps: number, maxSteps: number): number[] {
  const height = z1 - z0;
  if (height <= 1e-9) return [z0, z1];
  const steps = Math.min(maxSteps, Math.max(minSteps, Math.ceil(height / resolutionMm)));
  const points: number[] = [];
  for (let i = 0; i <= steps; i++) points.push(z0 + (height * i) / steps);
  return points;
}

/**
 * Footprint de `group` desplazado `offsetMm` (con signo): positivo dilata
 * (`outsetContourGroups`, como las costillas o la base del tapered),
 * negativo erosiona (`insetContourGroups`, como el bisel). Unifica ambos
 * signos detrás de una sola función para que un perfil de Z arbitrario
 * (costilla, bisel, doble bisel) no necesite saber cuál de las dos usar.
 */
export function footprintAtOffset(group: ContourGroup, offsetMm: number): ContourGroup[] {
  if (Math.abs(offsetMm) < 1e-6) return [{ outer: group.outer, holes: group.holes }];
  const paths = offsetMm > 0 ? outsetContourGroups([group], offsetMm) : insetContourGroups([group], -offsetMm);
  return regroupClipperSolution(paths);
}

/**
 * Aproxima una pared cuyo footprint sigue un perfil de offset arbitrario en
 * Z (`offsetAt`, con signo: positivo = más ancho, negativo = más angosto que
 * el contorno original) evaluado en `zPoints` (ver `subdivideRange`) —
 * generaliza el patrón de sub-bandas + escalón que ya usaban tapered.ts y
 * bevel.ts por separado, ahora también para el montículo de las costillas y
 * el doble bisel (perfiles NO monótonos en todo el rango, pero sí dentro de
 * cada sub-banda con resolución suficientemente fina).
 *
 * Cada sub-banda `[za, zb]` se extruye con sección CONSTANTE = el footprint
 * del extremo MÁS ANCHO del par (mayor offset con signo); el extremo más
 * angosto se resuelve con un escalón horizontal que cierra la diferencia
 * (ancho menos angosto), mirando hacia el lado donde efectivamente queda el
 * material angosto — +Z si es hacia arriba, -Z si es hacia abajo. Mismo
 * mecanismo de soldadura por coordenadas compartidas que el resto del
 * pipeline (sin CSG): no depende de qué tan fina sea la resolución.
 */
// Cuantización del offset antes de pedir su footprint (0.4.1: encontrado al
// implementar el tapered suave). En los tramos CHATOS de un perfil suave
// (p.ej. los extremos de un smoothstep, donde la pendiente es ~0), muchos
// z-samples consecutivos piden un offset CASI, pero no exactamente, igual —
// diferencias de centésimas de mm. Sin cuantizar, cada uno dispara su propio
// cálculo de Clipper y el escalón entre ambos (`differenceContourGroups`)
// puede terminar siendo un anillo válido pero extremadamente fino, que
// earcut no siempre triangula de forma manifold en letras con trazos
// próximos entre sí (p.ej. "B", con dos counters separados por un travesaño
// angosto). Cuantizar a 0.01mm (bien por debajo de cualquier tolerancia de
// impresión) hace que esos z-samples casi-iguales pidan EXACTAMENTE el
// mismo offset -> el mismo footprint cacheado -> un escalón EXACTAMENTE
// vacío (`differenceContourGroups(X, X)`), en vez de un anillo casi-nulo.
const OFFSET_QUANTUM_MM = 0.01;

function quantizeOffset(offsetMm: number): number {
  return Math.round(offsetMm / OFFSET_QUANTUM_MM) * OFFSET_QUANTUM_MM;
}

export function buildOffsetProfileWallPieces(group: ContourGroup, zPoints: number[], offsetAt: (z: number) => number): ExtrudedMeshData[] {
  const offsets = zPoints.map((z) => quantizeOffset(offsetAt(z)));
  const footprintCache = new Map<number, ContourGroup[]>();
  const footprintFor = (offsetMm: number): ContourGroup[] => {
    let cached = footprintCache.get(offsetMm);
    if (!cached) {
      cached = footprintAtOffset(group, offsetMm);
      footprintCache.set(offsetMm, cached);
    }
    return cached;
  };
  const footprints = offsets.map((offsetMm) => footprintFor(offsetMm));

  const pieces: ExtrudedMeshData[] = [];
  for (let i = 0; i < zPoints.length - 1; i++) {
    const za = zPoints[i];
    const zb = zPoints[i + 1];
    if (zb - za < 1e-9) continue;

    const wideIsStart = offsets[i] >= offsets[i + 1];
    const wideFootprint = wideIsStart ? footprints[i] : footprints[i + 1];
    const narrowFootprint = wideIsStart ? footprints[i + 1] : footprints[i];

    pieces.push(extrudeContourGroups(wideFootprint, za, zb, { capStart: false, capEnd: false, sides: true }));

    const shelfGroups = differenceContourGroups(wideFootprint, contourGroupsToRawPaths(narrowFootprint));
    if (wideIsStart) {
      // El extremo angosto queda arriba (zb): el escalón cierra ahí, mirando +Z.
      pieces.push(extrudeContourGroups(shelfGroups, zb, zb, { capStart: false, capEnd: true, sides: false }));
    } else {
      // El extremo angosto queda abajo (za): el escalón cierra ahí, mirando -Z.
      pieces.push(extrudeContourGroups(shelfGroups, za, za, { capStart: true, capEnd: false, sides: false }));
    }
  }
  return pieces;
}

/** Una banda de Z con un perfil de offset propio (con signo, ver `footprintAtOffset`), para `buildBandedOuterWallPieces`. */
export interface ZBand {
  z0: number;
  z1: number;
  offsetAt: (z: number) => number;
}

const MODIFIER_RESOLUTION_MM = 0.2;
const MODIFIER_MIN_STEPS = 8;
const MODIFIER_MAX_STEPS = 150;

/**
 * Pared exterior/hueco de UN contorno con CUALQUIER combinación de bandas de
 * modificador (costillas, bisel frontal, doble bisel/canal luminoso lateral
 * — 0.4.1) — generaliza el patrón "plano fuera de las bandas, perfil de
 * offset adentro" que antes repetía cada modificador por separado (ribs.ts/
 * bevel.ts en 0.4). Asume `bands` sin superposición entre sí (cada
 * modificador es responsable de no pisar el rango de otro — ver
 * body/standard.ts, que filtra costillas contra bisel/doble bisel antes de
 * llamar acá); con `bands` vacío es exactamente la franja continua de
 * siempre (sin cambios de comportamiento, mismo resultado byte a byte que
 * sin ningún modificador activo).
 */
export function buildBandedOuterWallPieces(group: ContourGroup, z0: number, z1: number, bands: ZBand[]): ExtrudedMeshData[] {
  const plainGroups: ContourGroup[] = [{ outer: group.outer, holes: group.holes }];

  if (bands.length === 0) {
    return [extrudeContourGroups(plainGroups, z0, z1, { capStart: false, capEnd: false, sides: true })];
  }

  const sortedBands = [...bands].sort((a, b) => a.z0 - b.z0);
  const breakpoints = [z0, ...sortedBands.flatMap((b) => [b.z0, b.z1]), z1].sort((a, b) => a - b);

  const pieces: ExtrudedMeshData[] = [];
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const za = breakpoints[i];
    const zb = breakpoints[i + 1];
    if (zb - za < 1e-9) continue;
    const midZ = (za + zb) / 2;
    const band = sortedBands.find((b) => midZ > b.z0 && midZ < b.z1);

    if (!band) {
      pieces.push(extrudeContourGroups(plainGroups, za, zb, { capStart: false, capEnd: false, sides: true }));
      continue;
    }

    // za === band.z0 y zb === band.z1 acá (los breakpoints incluyen los
    // bordes exactos de cada banda): subdividir toda la banda en pasos
    // finos siguiendo su propio perfil de offset.
    const zPoints = subdivideRange(band.z0, band.z1, MODIFIER_RESOLUTION_MM, MODIFIER_MIN_STEPS, MODIFIER_MAX_STEPS);
    pieces.push(...buildOffsetProfileWallPieces(group, zPoints, band.offsetAt));
  }
  return pieces;
}

/**
 * Perfil "montículo": 0 en `t=0`, máximo (`peakMm`) en `t=0.5`, 0 en `t=1` —
 * media onda coseno (Hann), sin salto vertical en ningún extremo (arranca y
 * termina con pendiente 0, no con un escalón). Usado por el perfil de
 * costilla (0.4.1 corrección 1) y, con `peakMm` negativo, por el doble bisel
 * (entra y vuelve a salir, 0.4.1 corrección 3B).
 */
export function raisedCosineProfile(t: number, peakMm: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return peakMm * (0.5 - 0.5 * Math.cos(2 * Math.PI * clamped));
}

/**
 * Perfil "rampa suave": 0 en `t=0`, `endMm` en `t=1`, con smoothstep
 * (3t²-2t³) en vez de una interpolación lineal — mismo destino final que una
 * rampa recta (el frente sigue empalmando en `endMm`), pero con pendiente 0
 * en ambos extremos, así no hay un quiebre anguloso donde la banda empalma
 * con la pared normal ni con el frente. Usado por tapered suave y el bisel
 * frontal suave (0.4.1 correcciones 2 y 3A).
 */
export function smoothstepRampProfile(t: number, endMm: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const eased = clamped * clamped * (3 - 2 * clamped);
  return endMm * eased;
}
