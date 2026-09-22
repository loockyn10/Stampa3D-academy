import type * as ClipperLib from "clipper-lib";
import type { BackCutout, ContourGroup, LetterSignParams, Point2D } from "@/lib/maker/types";
import {
  clipperPathsArea,
  contourGroupsToRawPaths,
  differenceRawPaths,
  insetContourGroups,
  intersectRawPaths,
  isPointInsideContourGroups,
  outsetContourGroups,
  pointsToRawPath,
  regroupClipperSolution,
  unionRawPaths,
} from "@/lib/maker/geometry/offsets";
import { backCutoutPolygons, circlePolygon, keyholePolygons } from "@/lib/maker/geometry/backCutouts";
import { computeWallAndCore } from "@/lib/maker/geometry/body/shared";
import { getInstallationSettings } from "@/lib/maker/installation/defaults";
import { buildWiringModel, buildWiringRoles, computeCableLengths } from "@/lib/maker/installation/wiring";
import { normalizePolygons, rectPolygon } from "@/lib/maker/installation/prismStack";
import { validateSpliceClip } from "@/lib/maker/installation/spliceClip";
import { glyphPolygons, textWidthMm, LABEL_PIXEL_MM } from "@/lib/maker/installation/labelFont";
import type {
  BackFeatureZone,
  BipolarCablePort,
  CableClip,
  InstallationIssue,
  InstallationPlan,
  LetterInstance,
  LetterInstallationPlan,
  LetterLabelMark,
  MountPoint,
  PortRole,
  RelPoint,
  SignInstallationSettings,
  WireConnection,
} from "@/lib/maker/installation/types";

/**
 * Planificador de instalación (determinístico): dada la geometría de cada letra
 * y los ajustes, decide POSICIONES de montaje, puertos, bahías de empalme, clips
 * y etiquetas sobre la cara trasera (dentro de la cavidad, sobre la repisa de la
 * base, o como agujeros pasantes en la base). Una única fuente de verdad: el
 * motor 3D, la plantilla PDF, la guía y los helpers leen este mismo plan.
 *
 * Mismo diseño + mismos ajustes => mismas posiciones (grillas fijas, desempates
 * por (x, y), sin aleatoriedad).
 */

// ----------------------------------------------------------- constantes

/** Margen mínimo entre un feature de repisa (bahía/clip/etiqueta) y el borde de la cavidad. */
export const FEATURE_EDGE_MARGIN_MM = 0.8;
/** Margen de seguridad alrededor de cada feature reservado (keepout). */
export const ZONE_MARGIN_MM = 1;
/** Un agujero pasante en la base respeta el mismo margen que los recortes traseros (1 mm). */
export const THROUGH_HOLE_EDGE_MARGIN_MM = 1;
/** Techo/boss: material sobre el receptor por encima del fondo del socket. */
export const SOCKET_ROOF_MM = 1.2;
export const SOCKET_CHAMFER_MM = 0.6;
export const CLIP_POST_MM = 1.4;
export const CLIP_LENGTH_MM = 3;
export const CLIP_LIP_OVERHANG_MM = 0.4;
export const CLIP_LIP_THICKNESS_MM = 0.8;
/** Distancia (desde el centro del puerto) a la que se busca la retención local. */
export const CLIP_FIRST_DISTANCE_MM = 6;
/** Espacio libre entre los conductores y el clip a cada lado. */
export const CLIP_WIRE_SLACK_MM = 0.3;
const OVERLAP_EPS_MM2 = 1e-3;
const KEYHOLE_ROTATION_DEG = 180;
/** Fracción de la altura (desde abajo) a la que corre el cable entre letras. */
const CABLE_LEVEL_FRACTION = 0.3;

// ------------------------------------------------------------- utilidades

interface ZoneRec {
  zone: BackFeatureZone;
  footprintPaths: ClipperLib.Paths;
  keepout: ClipperLib.Paths;
}

function makeZone(id: string, kind: BackFeatureZone["kind"], letterId: string | null, polygons: Point2D[][], marginMm = ZONE_MARGIN_MM): ZoneRec {
  const groups = normalizePolygons(polygons);
  return {
    zone: { id, kind, letterId, footprint: groups.flatMap((g) => [g.outer, ...g.holes]), marginMm },
    footprintPaths: contourGroupsToRawPaths(groups),
    keepout: marginMm > 0 ? outsetContourGroups(groups, marginMm) : contourGroupsToRawPaths(groups),
  };
}

function areaOf(paths: ClipperLib.Paths): number {
  return Math.abs(clipperPathsArea(paths));
}

export function zonesConflict(a: BackFeatureZone, b: BackFeatureZone): boolean {
  const ra = makeZone(a.id, a.kind, a.letterId, a.footprint, a.marginMm);
  const rb = makeZone(b.id, b.kind, b.letterId, b.footprint, b.marginMm);
  return recsConflict(ra, rb);
}

function recsConflict(a: ZoneRec, b: ZoneRec): boolean {
  return areaOf(intersectRawPaths(a.keepout, b.footprintPaths)) > OVERLAP_EPS_MM2 || areaOf(intersectRawPaths(b.keepout, a.footprintPaths)) > OVERLAP_EPS_MM2;
}

/** Región de repisa/base donde puede ir un feature de ESTA letra: núcleo de la cavidad (hueca) limitado por el bisel posterior. */
export function letterSafeRegion(instance: LetterInstance, params: LetterSignParams): ContourGroup[] {
  const cores: ContourGroup[] = [];
  for (const group of instance.contourGroups) cores.push(...computeWallAndCore(group, params.wallMm).coreGroups);
  if (params.bodyType === "standard" && params.rearBevelEnabled && params.rearBevelInsetMm > 0) {
    const limit = insetContourGroups(instance.contourGroups, params.rearBevelInsetMm + THROUGH_HOLE_EDGE_MARGIN_MM);
    return regroupClipperSolution(intersectRawPaths(contourGroupsToRawPaths(cores), limit));
  }
  return cores;
}

/** Polígonos de un mount keyhole en coordenadas globales (cabeza en x,y). */
export function keyholeMountPolygons(cx: number, cy: number, s: SignInstallationSettings["mounting"]["keyhole"]): Point2D[][] {
  const base = keyholePolygons(s.headDiameterMm, s.neckWidthMm, s.neckLengthMm, s.neckWidthMm);
  const rad = (KEYHOLE_ROTATION_DEG * Math.PI) / 180;
  const c = Math.cos(rad), sn = Math.sin(rad);
  return base.map((poly) => poly.map(([x, y]) => [cx + x * c - y * sn, cy + x * sn + y * c] as Point2D));
}

export function standoffRadii(s: SignInstallationSettings["mounting"]["standoff"]): { socketR: number; bossR: number } {
  const socketR = s.pegDiameterMm / 2 + s.clearanceMm;
  return { socketR, bossR: Math.max(socketR + s.bossWallMm, s.bodyDiameterMm / 2) };
}

/** Altura sobre la repisa del boss del receptor (desde Z=baseMm hasta el techo). */
export function bossHeightAboveShelfMm(s: SignInstallationSettings["mounting"]["standoff"], baseMm: number): number {
  return s.insertDepthMm + SOCKET_ROOF_MM - baseMm;
}

export function clipHeightMm(wireDiameterMm: number): number {
  return Math.max(1, 0.65 * wireDiameterMm) + CLIP_LIP_THICKNESS_MM;
}

/** Centros de los dos agujeros de un puerto bipolar: + arriba, - abajo (eje vertical, visto de frente). */
export function portHoleCenters(cx: number, cy: number, spacingMm: number): { plus: Point2D; minus: Point2D } {
  return { plus: [cx, cy + spacingMm / 2], minus: [cx, cy - spacingMm / 2] };
}

/** Los DOS agujeros circulares del puerto (polígonos en coordenadas globales). */
export function portHolePolygons(cx: number, cy: number, holeDiameterMm: number, spacingMm: number): Point2D[][] {
  const c = portHoleCenters(cx, cy, spacingMm);
  return [circlePolygon(c.plus[0], c.plus[1], holeDiameterMm), circlePolygon(c.minus[0], c.minus[1], holeDiameterMm)];
}

/** Huella ÚNICA del par (para la zona reservada): rectángulo que cubre ambos agujeros. */
export function portPairFootprint(cx: number, cy: number, holeDiameterMm: number, spacingMm: number): Point2D[] {
  return rectPolygon(cx, cy, holeDiameterMm, spacingMm + holeDiameterMm, 0);
}

/** Cantidad AUTOMÁTICA de puntos de montaje, derivada del tamaño de la letra (no de su carácter). */
export function autoMountCount(instance: LetterInstance): number {
  const maxDim = Math.max(instance.boundsMm.width, instance.boundsMm.height);
  return Math.min(6, 2 + Math.floor(maxDim / 300));
}

// -------------------------------------------------------------- por letra

interface Ctx {
  params: LetterSignParams;
  settings: SignInstallationSettings;
  origin: { x: number; y: number };
  cutoutKeepouts: ClipperLib.Paths;
  cableLevelY: number;
}

interface LetterState {
  instance: LetterInstance;
  safe: ContourGroup[];
  safePaths: ClipperLib.Paths;
  recs: ZoneRec[];
  issues: InstallationIssue[];
  cache: Map<string, { paths: ClipperLib.Paths; groups: ContourGroup[] }>;
}

function gridStep(instance: LetterInstance): number {
  const b = instance.boundsMm;
  return Math.max(2, Math.sqrt((b.width * b.height) / 3000));
}

/** Región disponible (núcleo - keepouts ya reservados) erosionada por `insetMm`. Cacheada por (n° de zonas, inset). */
function available(state: LetterState, ctx: Ctx, insetMm: number): { paths: ClipperLib.Paths; groups: ContourGroup[] } {
  const key = `${state.recs.length}:${insetMm.toFixed(3)}`;
  const hit = state.cache.get(key);
  if (hit) return hit;
  const forbidden = unionRawPaths([...ctx.cutoutKeepouts, ...state.recs.flatMap((r) => r.keepout)]);
  const free = forbidden.length > 0 ? differenceRawPaths(state.safePaths, forbidden) : state.safePaths;
  const freeGroups = regroupClipperSolution(free);
  const inset = insetMm > 0 ? insetContourGroups(freeGroups, insetMm) : free;
  const value = { paths: inset, groups: regroupClipperSolution(inset) };
  state.cache.set(key, value);
  return value;
}

function candidateGrid(instance: LetterInstance): Point2D[] {
  const b = instance.boundsMm;
  const step = gridStep(instance);
  const points: Point2D[] = [];
  for (let y = b.minY + step / 2; y <= b.maxY; y += step) {
    for (let x = b.minX + step / 2; x <= b.maxX; x += step) points.push([Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
  }
  return points;
}

function insideAll(polygons: Point2D[][], paths: ClipperLib.Paths): boolean {
  return areaOf(differenceRawPaths(polygons.map(pointsToRawPath), paths)) < OVERLAP_EPS_MM2;
}

const rel = (ctx: Ctx, p: Point2D): RelPoint => ({ x: Math.round((p[0] - ctx.origin.x) * 1000) / 1000, y: Math.round((p[1] - ctx.origin.y) * 1000) / 1000 });
const glob = (ctx: Ctx, p: RelPoint): Point2D => [ctx.origin.x + p.x, ctx.origin.y + p.y];

function byXY(a: Point2D, b: Point2D): number {
  return a[0] - b[0] || a[1] - b[1];
}

// ---------------------------------------------------------------- montaje

function mountFootprint(ctx: Ctx, cx: number, cy: number): { polygons: Point2D[][]; radius: number; edgeMargin: number; kind: MountPoint["kind"] } {
  const m = ctx.settings.mounting;
  if (m.type === "keyhole") {
    return { polygons: keyholeMountPolygons(cx, cy, m.keyhole), radius: m.keyhole.headDiameterMm / 2, edgeMargin: Math.max(m.keyhole.edgeMarginMm, THROUGH_HOLE_EDGE_MARGIN_MM), kind: "keyhole" };
  }
  const { bossR } = standoffRadii(m.standoff);
  return { polygons: [circlePolygon(cx, cy, bossR * 2)], radius: bossR, edgeMargin: Math.max(m.standoff.edgeMarginMm, 0.6), kind: "standoff" };
}

function placeMounts(state: LetterState, ctx: Ctx, out: LetterInstallationPlan): void {
  const { instance } = state;
  const m = ctx.settings.mounting;
  if (m.type === "none") return;
  const override = ctx.settings.overrides[instance.id];
  const shape = mountFootprint(ctx, 0, 0);
  const minSep = shape.radius * 2 + 2;

  const pushMount = (p: Point2D, source: MountPoint["source"], n: number, valid: boolean, message: string | null) => {
    const fp = mountFootprint(ctx, p[0], p[1]);
    out.mounts.push({ id: `${instance.id}:m${n}`, letterId: instance.id, kind: fp.kind, ...rel(ctx, p), source, valid, message, footprintRadiusMm: fp.radius });
    if (valid) state.recs.push(makeZone(`${instance.id}:m${n}`, "mount", instance.id, fp.polygons));
  };

  if (override?.mountPoints && override.mountPoints.length > 0) {
    override.mountPoints.forEach((rp, i) => {
      const p = glob(ctx, rp);
      const fp = mountFootprint(ctx, p[0], p[1]);
      const okRegion = insideAll(fp.polygons, available(state, ctx, fp.edgeMargin).paths);
      const rec = makeZone(`${instance.id}:m${i + 1}`, "mount", instance.id, fp.polygons);
      const clashes = state.recs.some((r) => recsConflict(r, rec));
      const valid = okRegion && !clashes;
      pushMount(p, "manual", i + 1, valid, valid ? null : clashes ? "El punto de montaje se superpone con otra feature trasera." : "El punto de montaje está fuera del material o demasiado cerca del borde.");
    });
    return;
  }

  const wanted = override?.mountCount ?? autoMountCount(instance);
  const b = instance.boundsMm;
  const horizontal = b.width >= 0.8 * b.height;
  const avail = available(state, ctx, shape.radius + shape.edgeMargin);
  const cands = candidateGrid(instance).filter((c) => isPointInsideContourGroups(avail.groups, c));
  const exact = new Map<string, boolean>();
  const fits = (c: Point2D): boolean => {
    const key = `${c[0]},${c[1]}`;
    let v = exact.get(key);
    if (v === undefined) {
      v = insideAll(mountFootprint(ctx, c[0], c[1]).polygons, available(state, ctx, shape.edgeMargin).paths);
      exact.set(key, v);
    }
    return v;
  };
  const chosen: Point2D[] = [];
  for (let i = 0; i < wanted; i++) {
    // Repartidos hacia los extremos (12 %..88 %) para maximizar la palanca contra el giro; uno solo va al centro.
    const f = wanted === 1 ? 0.5 : 0.12 + (0.76 * i) / (wanted - 1);
    const yBias = m.type === "keyhole" ? 0.6 : 0.5;
    const target: Point2D = horizontal ? [b.minX + f * b.width, b.minY + yBias * b.height] : [b.minX + 0.5 * b.width, b.minY + (m.type === "keyhole" ? 0.15 + 0.7 * f : f) * b.height];
    const pool = cands
      .filter((c) => chosen.every((o) => Math.hypot(o[0] - c[0], o[1] - c[1]) >= minSep))
      .sort((p, q) => Math.hypot(p[0] - target[0], p[1] - target[1]) - Math.hypot(q[0] - target[0], q[1] - target[1]) || byXY(p, q));
    const pick = pool.find(fits);
    if (pick) chosen.push(pick);
  }
  chosen.forEach((p, i) => pushMount(p, "auto", i + 1, true, null));
  if (chosen.length === 0) {
    state.issues.push({ code: "MOUNT_NONE", letterId: instance.id, message: `No hay una posición segura de montaje en ${instance.label}. Editá el montaje manualmente o usá otro sistema.` });
  } else if (chosen.length < Math.min(2, wanted)) {
    state.issues.push({ code: "MOUNT_FEWER_THAN_TWO", letterId: instance.id, message: `No hay espacio para dos soportes en ${instance.label}: solo se pudo colocar uno (la letra podría girar).` });
  }
}

// ----------------------------------------------------------------- puertos

/**
 * Puertos BIPOLARES: cada IN/OUT/ALIM son DOS agujeros paralelos (+ y -) que se ubican, validan y reservan
 * como UNA unidad. La preferencia de producto sigue siendo la salida lateral (side-wall), pero en V1 se usa el
 * fallback trasero cerca del borde (ver docs); ambos generan los DOS agujeros y el footprint del par completo.
 */
function placePorts(state: LetterState, ctx: Ctx, out: LetterInstallationPlan, roles: ReturnType<typeof buildWiringRoles>): void {
  const w = ctx.settings.wiring;
  if (w.mode !== "chained") return;
  const role = roles.get(state.instance.id);
  if (!role) return;
  const { instance } = state;
  const holeD = w.wireHoleDiameterMm;
  const spacing = w.holeCenterSpacingMm;
  const wanted: { role: PortRole; side: "left" | "right" }[] = [];
  if (role.hasPowerIn) wanted.push({ role: "power-in", side: role.inSide });
  if (role.hasIn) wanted.push({ role: "in", side: role.inSide });
  if (role.hasOut) wanted.push({ role: "out", side: role.outSide });

  for (const want of wanted) {
    const availM = available(state, ctx, THROUGH_HOLE_EDGE_MARGIN_MM);
    const b = instance.boundsMm;
    const sorted = candidateGrid(instance)
      .filter((c) => isPointInsideContourGroups(availM.groups, c))
      .map((c) => ({ c, score: (want.side === "left" ? c[0] - b.minX : b.maxX - c[0]) + 1.5 * Math.abs(c[1] - ctx.cableLevelY) }))
      .sort((p, q) => p.score - q.score || byXY(p.c, q.c));
    const id = `${instance.id}:${want.role}`;
    // Ambos agujeros deben caber juntos (misma prueba exacta que el resto de las aberturas de la base).
    const pick = sorted.slice(0, 600).find((cand) => insideAll(portHolePolygons(cand.c[0], cand.c[1], holeD, spacing), availM.paths))?.c;
    if (!pick) {
      state.issues.push({ code: "PORT_NO_SPACE", letterId: instance.id, message: `No hay espacio para el puerto bipolar de cable (${want.role === "out" ? "salida" : "entrada"}) en ${instance.label}.` });
      continue;
    }
    const centers = portHoleCenters(pick[0], pick[1], spacing);
    const port: BipolarCablePort = {
      id,
      letterId: instance.id,
      role: want.role,
      side: want.side,
      ...rel(ctx, pick),
      wireHoleDiameterMm: holeD,
      holeCenterSpacingMm: spacing,
      holes: [{ polarity: "+", ...rel(ctx, centers.plus) }, { polarity: "-", ...rel(ctx, centers.minus) }],
      placement: { kind: "rear-edge", preferred: "side-wall", fallback: true, reason: "Salida lateral (side-wall) diferida en V1: exigiría perforar la pared en dirección horizontal (geometría frágil); se usa un puerto bipolar trasero cerca del borde." },
      valid: true,
    };
    out.ports.push(port);
    state.recs.push(makeZone(id, "cable-port", instance.id, [portPairFootprint(pick[0], pick[1], holeD, spacing)]));
  }
}

// ------------------------------------------------------------------- clips

/**
 * Retención local sencilla (strain relief) junto a cada puerto: UN clip que abraza los dos conductores del par
 * y evita que un tirón exterior llegue a la conexión interna. No hay rutas internas ni destinos intermedios.
 */
function placeClips(state: LetterState, ctx: Ctx, out: LetterInstallationPlan): void {
  const w = ctx.settings.wiring;
  if (w.mode !== "chained") return;
  const gap = w.holeCenterSpacingMm + w.wireDiameterMm + 2 * CLIP_WIRE_SLACK_MM;
  const outerW = gap + 2 * CLIP_POST_MM;
  for (const port of out.ports) {
    const start = glob(ctx, port);
    // El cable entra al interior de la letra: hacia la derecha si el puerto está a la izquierda y viceversa.
    const angleDeg = port.side === "left" ? 0 : 180;
    const rad = (angleDeg * Math.PI) / 180;
    const availM = available(state, ctx, FEATURE_EDGE_MARGIN_MM);
    let found: CableClip | null = null;
    for (let d = CLIP_FIRST_DISTANCE_MM; d <= CLIP_FIRST_DISTANCE_MM + 24 && !found; d += 1) {
      const cx = start[0] + Math.cos(rad) * d;
      const cy = start[1];
      const fp = rectPolygon(cx, cy, CLIP_LENGTH_MM, outerW, angleDeg);
      if (isPointInsideContourGroups(availM.groups, [cx, cy]) && insideAll([fp], availM.paths)) {
        found = { id: `${port.id}:c1`, letterId: state.instance.id, portId: port.id, ...rel(ctx, [cx, cy]), angleDeg, gapMm: gap, outerWidthMm: outerW, lengthMm: CLIP_LENGTH_MM, heightMm: clipHeightMm(w.wireDiameterMm), distanceFromPortMm: d };
      }
    }
    if (!found) {
      state.issues.push({ code: "CLIP_NO_SPACE", letterId: state.instance.id, message: `No hay espacio para la retención local del cable del puerto ${port.role} de ${state.instance.label}.` });
      continue;
    }
    const fp = rectPolygon(ctx.origin.x + found.x, ctx.origin.y + found.y, CLIP_LENGTH_MM, outerW, found.angleDeg);
    state.recs.push(makeZone(found.id, "cable-clip", state.instance.id, [fp], 0.6));
    out.clips.push(found);
  }
}

// ---------------------------------------------------------------- etiquetas

function placeLabels(state: LetterState, ctx: Ctx, out: LetterInstallationPlan): void {
  if (ctx.settings.wiring.mode !== "chained" || !ctx.settings.wiring.printLabels) return;
  const tryLabel = (id: string, text: string, anchor: Point2D, candidates: { angleDeg: number; distance: number; shiftX?: number }[]) => {
    const wMm = textWidthMm(text);
    const hMm = 5 * LABEL_PIXEL_MM;
    for (const { angleDeg, distance, shiftX = 0 } of candidates) {
      const rad = (angleDeg * Math.PI) / 180;
      const cx = anchor[0] + shiftX + Math.cos(rad) * (distance + (Math.abs(Math.cos(rad)) * wMm) / 2);
      const cy = anchor[1] + Math.sin(rad) * (distance + (Math.abs(Math.sin(rad)) * hMm) / 2);
      const polys = glyphPolygons(text, cx, cy);
      const availM = available(state, ctx, FEATURE_EDGE_MARGIN_MM);
      if (polys.length > 0 && insideAll(polys, availM.paths)) {
        const mark: LetterLabelMark = { id, letterId: state.instance.id, text, ...rel(ctx, [cx, cy]), angleDeg: 0 };
        out.labels.push(mark);
        state.recs.push(makeZone(id, "label", state.instance.id, polys, 0.4));
        return;
      }
    }
  };
  for (const port of out.ports) {
    const spacing = port.holeCenterSpacingMm;
    const half = (spacing + port.wireHoleDiameterMm) / 2;
    const inward = port.side === "left" ? 0 : 180;
    // IN/OUT sobre o bajo el par; luego, polaridad (+ / -) junto a cada agujero, del lado interior.
    // El rótulo se alinea con el borde exterior del par y crece hacia el interior de la letra (no se sale del material).
    const text = port.role === "out" ? "OUT" : "IN";
    const shiftX = (port.side === "left" ? 1 : -1) * (textWidthMm(text) / 2 - port.wireHoleDiameterMm / 2);
    tryLabel(`${port.id}:label`, text, glob(ctx, port), [90, 270].map((angleDeg) => ({ angleDeg, distance: half + 2.6, shiftX })));
    for (const hole of port.holes) {
      tryLabel(`${port.id}:${hole.polarity}`, hole.polarity, glob(ctx, hole), [inward, inward + 180].map((angleDeg) => ({ angleDeg, distance: port.wireHoleDiameterMm / 2 + 2.9 })));
    }
  }
}

// --------------------------------------------------------------- conexiones

/** Conexiones bipolares entre letras consecutivas: dos recorridos (+ y -), punto medio para el soporte de empalmes y distancia. */
function buildConnections(plan: InstallationPlan): WireConnection[] {
  if (!plan.wiring) return [];
  const out: WireConnection[] = [];
  for (const link of plan.wiring.links) {
    const from = plan.letters.find((l) => l.instanceId === link.fromId)?.ports.find((p) => p.role === "out");
    const to = plan.letters.find((l) => l.instanceId === link.toId)?.ports.find((p) => p.role === "in");
    if (!from || !to) continue;
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const angleDeg = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
    out.push({
      id: `${link.fromId}>${link.toId}`,
      fromLetter: link.fromId,
      toLetter: link.toId,
      fromLabel: link.fromLabel,
      toLabel: link.toLabel,
      fromPort: from.id,
      toPort: to.id,
      positivePath: [{ x: from.holes[0].x, y: from.holes[0].y }, { x: to.holes[0].x, y: to.holes[0].y }],
      negativePath: [{ x: from.holes[1].x, y: from.holes[1].y }, { x: to.holes[1].x, y: to.holes[1].y }],
      clipPosition: { ...mid, angleDeg },
      distanceMm: Math.hypot(to.x - from.x, to.y - from.y),
    });
  }
  return out;
}

// ------------------------------------------------------------- planificar

export function isInstallationActive(settings: SignInstallationSettings): boolean {
  return settings.mounting.type !== "none" || settings.wiring.mode !== "off";
}

export interface PlanInput {
  instances: LetterInstance[];
  params: LetterSignParams;
  origin: { x: number; y: number };
  cutouts: BackCutout[];
}

export function planInstallation({ instances, params, origin, cutouts }: PlanInput): InstallationPlan {
  const settings = getInstallationSettings(params);
  const errors: InstallationIssue[] = [];
  const warnings: InstallationIssue[] = [];
  const plan: InstallationPlan = { active: isInstallationActive(settings), origin, instances, wiring: null, letters: [], connections: [], spliceClipCount: 0, cableLengths: [], errors, warnings };
  if (!plan.active || instances.length === 0) return plan;

  if (params.frontType === "light-channel") {
    errors.push({ code: "NOT_SUPPORTED_FRONT", letterId: null, message: "El sistema de instalación no está disponible con el frente de canal luminoso (el cuerpo es macizo, sin cavidad trasera)." });
    return plan;
  }

  const wiringOn = settings.wiring.mode === "chained";
  const roles = buildWiringRoles(instances, settings.wiring.direction);
  if (wiringOn) plan.wiring = buildWiringModel(instances, settings.wiring.direction);

  const all = instances.map((i) => i.boundsMm);
  const minY = Math.min(...all.map((b) => b.minY)), maxY = Math.max(...all.map((b) => b.maxY));
  const ctx: Ctx = {
    params,
    settings,
    origin,
    cutoutKeepouts: unionRawPaths(
      (cutouts ?? []).flatMap((c) => {
        const groups = normalizePolygons(backCutoutPolygons(c, origin));
        return outsetContourGroups(groups, ZONE_MARGIN_MM);
      }),
    ),
    cableLevelY: minY + CABLE_LEVEL_FRACTION * (maxY - minY),
  };

  const cutoutZones: ZoneRec[] = (cutouts ?? []).map((c) => makeZone(`cutout:${c.id}`, "cutout", null, backCutoutPolygons(c, origin)));

  for (const instance of instances) {
    const safe = letterSafeRegion(instance, params);
    const state: LetterState = { instance, safe, safePaths: contourGroupsToRawPaths(safe), recs: [], issues: [], cache: new Map() };
    const out: LetterInstallationPlan = { instanceId: instance.id, mounts: [], ports: [], clips: [], labels: [], zones: [] };
    placeMounts(state, ctx, out);
    placePorts(state, ctx, out, roles);
    // Etiquetas antes que los clips: quedan junto al par y el clip se acomoda más adentro.
    placeLabels(state, ctx, out);
    placeClips(state, ctx, out);
    out.zones = state.recs.map((r) => r.zone);

    // Validación: solapes entre features (auto o manuales) y contra recortes manuales.
    const recs = state.recs;
    for (let i = 0; i < recs.length; i++) {
      for (let j = i + 1; j < recs.length; j++) {
        if (recsConflict(recs[i], recs[j])) state.issues.push({ code: "ZONES_OVERLAP", letterId: instance.id, message: `Dos features traseras se superponen en ${instance.label} (${recs[i].zone.id} / ${recs[j].zone.id}).` });
      }
      for (const cz of cutoutZones) {
        if (areaOf(intersectRawPaths(recs[i].footprintPaths, cz.keepout)) > OVERLAP_EPS_MM2) {
          const port = recs[i].zone.kind === "cable-port";
          state.issues.push({ code: port ? "PORT_INVADES_MOUNT" : "ZONES_OVERLAP", letterId: instance.id, message: `${port ? "Un puerto de cable" : "Una feature de instalación"} de ${instance.label} se superpone con un recorte trasero manual.` });
        }
      }
    }
    out.mounts.forEach((mt) => {
      if (!mt.valid) state.issues.push({ code: "MOUNT_INVALID", letterId: instance.id, message: `Punto de montaje ${mt.id}: ${mt.message ?? "inválido"}` });
    });
    for (const issue of state.issues) {
      const isError = issue.code === "ZONES_OVERLAP" || issue.code === "MOUNT_INVALID" || issue.code === "PORT_INVALID" || issue.code === "SPLICE_CLIP_INVALID" || issue.code === "PORT_INVADES_MOUNT";
      (isError ? errors : warnings).push(issue);
    }
    plan.letters.push(out);
  }

  validateFit(plan, params, settings);
  plan.connections = buildConnections(plan);
  plan.spliceClipCount = wiringOn && settings.wiring.spliceClip.enabled && plan.wiring ? plan.wiring.links.length : 0;

  if (wiringOn && plan.wiring) {
    const outMap = new Map<string, { x: number; y: number }>();
    const inMap = new Map<string, { x: number; y: number }>();
    for (const l of plan.letters) {
      for (const p of l.ports) {
        const g = { x: origin.x + p.x, y: origin.y + p.y };
        if (p.role === "out") outMap.set(l.instanceId, g);
        else inMap.set(l.instanceId, g);
      }
    }
    plan.cableLengths = computeCableLengths(instances, plan.wiring, settings.wiring.serviceMarginMm, { out: outMap, in: inMap });
  }
  return plan;
}

/** Ajuste de alturas (cavidad, separación de pared) y avisos de uso. */
function validateFit(plan: InstallationPlan, params: LetterSignParams, settings: SignInstallationSettings): void {
  const cavity = params.depthMm - params.baseMm;
  const lipTake = params.frontType === "lid" && params.lidJoint === "interior-lip" ? params.insertDepthMm : 0;
  const usable = cavity - lipTake - 0.5;
  const push = (issue: InstallationIssue, error: boolean) => (error ? plan.errors : plan.warnings).push(issue);
  const anyOf = (pick: (l: (typeof plan.letters)[number]) => number) => plan.letters.some((l) => pick(l) > 0);

  if (settings.mounting.type === "standoff" && anyOf((l) => l.mounts.filter((m) => m.valid).length)) {
    const s = settings.mounting.standoff;
    const h = bossHeightAboveShelfMm(s, params.baseMm);
    if (h > usable) push({ code: "FEATURE_EXCEEDS_CAVITY", letterId: null, message: `El refuerzo del receptor (${h.toFixed(1)} mm) no cabe en la cavidad disponible (${usable.toFixed(1)} mm). Aumentá la profundidad del cartel o reducí la profundidad de encastre.` }, true);
    const { socketR } = standoffRadii(s);
    if (s.insertDepthMm <= params.baseMm) push({ code: "SPACER_INVALID", letterId: null, message: "La profundidad de encastre debe ser mayor al espesor de la base." }, true);
    if (s.screwHeadDiameterMm > 0 && (s.pegDiameterMm - s.screwHeadDiameterMm) / 2 < 0.8) push({ code: "SPACER_INVALID", letterId: null, message: "El rebaje de la cabeza del tornillo deja menos de 0.8 mm de pared en la espiga." }, true);
    if (s.screwHoleDiameterMm >= s.pegDiameterMm - 1.6) push({ code: "SPACER_INVALID", letterId: null, message: "El agujero del tornillo es demasiado grande para el diámetro de espiga." }, true);
    if (s.pegDiameterMm >= s.bodyDiameterMm) push({ code: "SPACER_INVALID", letterId: null, message: "La espiga debe ser más angosta que el cuerpo del separador." }, true);
    void socketR;
  }
  if (settings.mounting.type === "keyhole" && settings.mounting.keyhole.depthMm > cavity) {
    push({ code: "KEYHOLE_DEPTH", letterId: null, message: "La cavidad no tiene profundidad suficiente para alojar la cabeza del tornillo del keyhole." }, false);
  }
  if (settings.wiring.mode === "chained") {
    const wr = settings.wiring;
    if (!(wr.wireHoleDiameterMm >= wr.wireDiameterMm)) push({ code: "PORT_INVALID", letterId: null, message: "El agujero del puerto es más angosto que el conductor: aumentá el diámetro del agujero." }, true);
    if (!(wr.holeCenterSpacingMm >= wr.wireHoleDiameterMm + 1.2)) push({ code: "PORT_INVALID", letterId: null, message: "La separación entre los dos agujeros del puerto es demasiado chica (queda menos de 1.2 mm de pared entre ellos)." }, true);
    if (wr.spliceClip.enabled) for (const message of validateSpliceClip(wr.spliceClip)) push({ code: "SPLICE_CLIP_INVALID", letterId: null, message }, true);
    if (settings.mounting.type === "keyhole") {
      push({ code: "REAR_PORT_FLUSH", letterId: null, message: "Con montaje Keyhole la letra apoya contra la pared: los puertos traseros dejan salir el cable hacia la pared. Dejá un canal en la pared o usá separadores." }, false);
    }
    if (settings.mounting.type === "standoff" && settings.wiring.wireDiameterMm > settings.mounting.standoff.wallSpacingMm - 1) {
      push({ code: "SPLICE_EXCEEDS_SPACING", letterId: null, message: "El cable es más grueso que la separación disponible con la pared." }, false);
    }
  }
}

/** Todas las zonas reservadas del plan (de todas las letras). */
export function collectZones(plan: InstallationPlan): BackFeatureZone[] {
  return plan.letters.flatMap((l) => l.zones);
}
