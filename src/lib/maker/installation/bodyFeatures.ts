import type { ContourGroup, LetterSignParams, Point2D } from "@/lib/maker/types";
import { addHoles, type BackCutoutBaseResult } from "@/lib/maker/geometry/backCutouts";
import type { ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";
import { getInstallationSettings } from "@/lib/maker/installation/defaults";
import {
  CLIP_LIP_OVERHANG_MM,
  CLIP_LIP_THICKNESS_MM,
  CLIP_POST_MM,
  SOCKET_CHAMFER_MM,
  SOCKET_ROOF_MM,
  clipHeightMm,
  keyholeMountPolygons,
  portHolePolygons,
  standoffRadii,
} from "@/lib/maker/installation/layout";
import { glyphPolygons, LABEL_HEIGHT_MM } from "@/lib/maker/installation/labelFont";
import { buildPrismStackDetailed, discGroups, localToGlobal, normalizePolygons, rectPolygon, type PrismLayer } from "@/lib/maker/installation/prismStack";
import type { InstallationPlan, LetterInstallationPlan } from "@/lib/maker/installation/types";

/**
 * Geometría 3D de los features de instalación de UNA letra. Todo se resuelve con
 * huellas 2D extruidas y soldadas por coordenadas compartidas (mismo mecanismo
 * que los recortes traseros y el tapered) — sin CSG 3D:
 *
 *  - PUERTOS BIPOLARES (dos agujeros por puerto) y KEYHOLES: agujeros pasantes en la base (se suman a la región de
 *    recortes traseros, ver `installationThroughPolygons`).
 *  - RECEPTOR (standoff): boca en la cara trasera (Z=0) con chaflán escalonado de
 *    entrada, pared del socket hasta `insertDepth` y techo; alrededor, un BOSS
 *    (cilindro macizo) que crece desde la repisa dentro de la cavidad para que el
 *    encastre no dependa de los 1.2 mm de base.
 *  - CLIPS de retención local (dos postes con labio, junto a cada puerto) y
 *    ETIQUETAS: prismas sobre la repisa (Z=baseMm), cada uno con su hueco en la
 *    repisa y su tapa superior.
 *
 * Nada de esto sobresale por detrás de la cara trasera (Z<0): el cartel apoya
 * plano sobre la cama y la separación de pared la dan los separadores impresos.
 */

export interface SocketSpec {
  x: number;
  y: number;
  socketRadiusMm: number;
  bossRadiusMm: number;
  /** Profundidad del socket medida desde la cara trasera (Z=0). */
  depthMm: number;
  chamferMm: number;
}

export interface RaisedSpec {
  kind: "clip" | "label";
  id: string;
  /** Capas relativas a la repisa: z0/z1 medidos desde Z=baseMm. */
  layers: { dz0: number; dz1: number; polygons: Point2D[][] }[];
}

export interface BodyInstallationFeatures {
  sockets: SocketSpec[];
  raised: RaisedSpec[];
}

/** Polígonos de agujeros pasantes de la base (ports + keyholes válidos) de TODAS las letras, en coordenadas globales. */
export function installationThroughPolygons(plan: InstallationPlan, params: LetterSignParams): Point2D[][] {
  const settings = getInstallationSettings(params);
  const out: Point2D[][] = [];
  for (const letter of plan.letters) {
    for (const m of letter.mounts) {
      if (m.valid && m.kind === "keyhole") out.push(...keyholeMountPolygons(plan.origin.x + m.x, plan.origin.y + m.y, settings.mounting.keyhole));
    }
    for (const p of letter.ports) {
      // Un puerto bipolar = DOS perforaciones circulares paralelas (+ y -), nunca una ranura ni un agujero único.
      if (p.valid) out.push(...portHolePolygons(plan.origin.x + p.x, plan.origin.y + p.y, p.wireHoleDiameterMm, p.holeCenterSpacingMm));
    }
  }
  return out;
}

export function buildBodyFeatures(letter: LetterInstallationPlan | undefined, plan: InstallationPlan, params: LetterSignParams): BodyInstallationFeatures | undefined {
  if (!letter) return undefined;
  const settings = getInstallationSettings(params);
  const g = (x: number, y: number): Point2D => [plan.origin.x + x, plan.origin.y + y];
  const sockets: SocketSpec[] = [];
  const raised: RaisedSpec[] = [];

  if (settings.mounting.type === "standoff") {
    const s = settings.mounting.standoff;
    const { socketR, bossR } = standoffRadii(s);
    for (const m of letter.mounts) {
      if (!m.valid) continue;
      const [x, y] = g(m.x, m.y);
      sockets.push({ x, y, socketRadiusMm: socketR, bossRadiusMm: bossR, depthMm: s.insertDepthMm, chamferMm: Math.min(SOCKET_CHAMFER_MM, Math.max(0, params.baseMm - 0.4)) });
    }
  }

  for (const clip of letter.clips) {
    const [cx, cy] = g(clip.x, clip.y);
    const post = (side: 1 | -1, o: number): Point2D[] => {
      const lip = o > 0;
      const v0 = side * (clip.gapMm / 2 - o);
      const v1 = side * (clip.gapMm / 2 + CLIP_POST_MM - (lip ? 0.3 : 0));
      return rectPolygon(...localToGlobal(cx, cy, clip.angleDeg, 0, (v0 + v1) / 2), clip.lengthMm - (lip ? 0.8 : 0), Math.abs(v1 - v0), clip.angleDeg);
    };
    const h1 = clip.heightMm - CLIP_LIP_THICKNESS_MM;
    raised.push({
      kind: "clip",
      id: clip.id,
      layers: [
        { dz0: 0, dz1: h1, polygons: [post(1, 0), post(-1, 0)] },
        { dz0: h1, dz1: clip.heightMm, polygons: [post(1, CLIP_LIP_OVERHANG_MM), post(-1, CLIP_LIP_OVERHANG_MM)] },
      ],
    });
  }

  for (const label of letter.labels) {
    const [cx, cy] = g(label.x, label.y);
    const polys = glyphPolygons(label.text, cx, cy);
    if (polys.length > 0) raised.push({ kind: "label", id: label.id, layers: [{ dz0: 0, dz1: LABEL_HEIGHT_MM, polygons: polys }] });
  }

  void clipHeightMm;
  return sockets.length === 0 && raised.length === 0 ? undefined : { sockets, raised };
}

/** Altura Z (desde la cara trasera) del techo del boss. */
export function bossTopZ(socket: SocketSpec): number {
  return socket.depthMm + SOCKET_ROOF_MM;
}

/**
 * Suma los features de instalación a la base ya resuelta (con recortes): más
 * huecos en la tapa trasera y la repisa, y las piezas nuevas (socket, boss,
 * prismas). Sin features devuelve la entrada intacta (mismo resultado byte a byte).
 */
export function applyInstallationToBase(base: BackCutoutBaseResult, features: BodyInstallationFeatures | undefined, baseMm: number): BackCutoutBaseResult {
  if (!features) return base;
  const capLoops: Point2D[][] = [];
  const shelfLoops: Point2D[][] = [];
  const shelfIslands: ContourGroup[] = [];
  const pieces: ExtrudedMeshData[] = [];

  for (const s of features.sockets) {
    // Socket: capas de vacío contiguas desde Z=0. Chaflán de entrada en escalones finos (cono aproximado) y luego el fuste.
    const layers: PrismLayer[] = [];
    const steps = s.chamferMm > 0.05 ? 3 : 0;
    for (let j = 0; j < steps; j++) {
      const dz = s.chamferMm / steps;
      layers.push({ z0: j * dz, z1: (j + 1) * dz, groups: discGroups(s.x, s.y, 2 * (s.socketRadiusMm + (s.chamferMm * (steps - j)) / steps)) });
    }
    layers.push({ z0: steps > 0 ? s.chamferMm : 0, z1: s.depthMm, groups: discGroups(s.x, s.y, 2 * s.socketRadiusMm) });
    const socket = buildPrismStackDetailed(layers, { void: true, topCap: true });
    capLoops.push(socket.layerGroups[0][0].outer);
    pieces.push(socket.mesh);

    // Boss: cilindro macizo sobre la repisa hasta el techo del socket + techo de refuerzo.
    const bossGroups = discGroups(s.x, s.y, 2 * s.bossRadiusMm);
    const boss = buildPrismStackDetailed([{ z0: baseMm, z1: bossTopZ(s), groups: bossGroups }], { topCap: true });
    shelfLoops.push(boss.layerGroups[0][0].outer);
    pieces.push(boss.mesh);
  }

  for (const r of features.raised) {
    const layers: PrismLayer[] = r.layers.map((l) => ({ z0: baseMm + l.dz0, z1: baseMm + l.dz1, groups: normalizePolygons(l.polygons) }));
    if (layers.length === 0 || layers[0].groups.length === 0) continue;
    const stack = buildPrismStackDetailed(layers, { topCap: true });
    for (const group of stack.layerGroups[0]) {
      shelfLoops.push(group.outer);
      // Un contorno con hueco (p.ej. la "O" de OUT) deja el piso de la repisa DENTRO del hueco: una isla de repisa que cierra las paredes del hueco.
      for (const hole of group.holes) shelfIslands.push({ outer: hole, holes: [] });
    }
    pieces.push(stack.mesh);
  }

  return {
    baseCapGroups: capLoops.length > 0 ? addHoles(base.baseCapGroups, capLoops) : base.baseCapGroups,
    shelfGroups: shelfLoops.length > 0 ? [...addHoles(base.shelfGroups, shelfLoops), ...shelfIslands] : base.shelfGroups,
    holeWalls: base.holeWalls,
    extraPieces: [...(base.extraPieces ?? []), ...pieces],
  };
}
