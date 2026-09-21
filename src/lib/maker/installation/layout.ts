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
import { glyphPolygons, textWidthMm, LABEL_PIXEL_MM } from "@/lib/maker/installation/labelFont";
import type {
  BackFeatureZone,
  CableClip,
  CablePort,
  InstallationIssue,
  InstallationPlan,
  LetterInstance,
  LetterInstallationPlan,
  LetterLabelMark,
  MountPoint,
  PortRole,
  RelPoint,
  RouteNode,
  SignInstallationSettings,
  SpliceBay,
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
export const BAY_RAIL_MM = 1.2;
export const BAY_LIP_OVERHANG_MM = 0.4;
export const BAY_LIP_THICKNESS_MM = 0.8;
export const CLIP_POST_MM = 1.4;
export const CLIP_LENGTH_MM = 3;
export const CLIP_LIP_OVERHANG_MM = 0.4;
export const CLIP_LIP_THICKNESS_MM = 0.8;
/** Distancias (desde el puerto) del primer clip y separación entre clips. */
export const CLIP_FIRST_DISTANCE_MM = 6;
export const CLIP_SPACING_MM = 7;
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

export function bayHeightMm(spliceDiameterMm: number): number {
  return Math.max(2, 0.65 * spliceDiameterMm) + BAY_LIP_THICKNESS_MM;
}

export function clipHeightMm(wireDiameterMm: number): number {
  return Math.max(1, 0.65 * wireDiameterMm) + CLIP_LIP_THICKNESS_MM;
}

export function portHoleDiameterMm(w: SignInstallationSettings["wiring"]): number {
  return w.wireDiameterMm + 2 * w.portClearanceMm;
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

function placePorts(state: LetterState, ctx: Ctx, out: LetterInstallationPlan, roles: ReturnType<typeof buildWiringRoles>): void {
  const w = ctx.settings.wiring;
  if (w.mode !== "chained") return;
  const role = roles.get(state.instance.id);
  if (!role) return;
  const { instance } = state;
  const holeD = portHoleDiameterMm(w);
  const r = holeD / 2;
  const wanted: { role: PortRole; side: "left" | "right" }[] = [];
  if (role.hasPowerIn) wanted.push({ role: "power-in", side: role.inSide });
  if (role.hasIn) wanted.push({ role: "in", side: role.inSide });
  if (role.hasOut) wanted.push({ role: "out", side: role.outSide });

  for (const want of wanted) {
    const avail = available(state, ctx, r + THROUGH_HOLE_EDGE_MARGIN_MM);
    const b = instance.boundsMm;
    const sorted = candidateGrid(instance)
      .filter((c) => isPointInsideContourGroups(avail.groups, c))
      .map((c) => ({ c, score: (want.side === "left" ? c[0] - b.minX : b.maxX - c[0]) + 1.5 * Math.abs(c[1] - ctx.cableLevelY) }))
      .sort((p, q) => p.score - q.score || byXY(p.c, q.c));
    const id = `${instance.id}:${want.role}`;
    const pick = sorted[0]?.c;
    if (!pick) {
      state.issues.push({ code: "PORT_NO_SPACE", letterId: instance.id, message: `No hay espacio para el puerto de cable (${want.role === "out" ? "salida" : "entrada"}) en ${instance.label}.` });
      continue;
    }
    const port: CablePort = {
      id,
      letterId: instance.id,
      role: want.role,
      side: want.side,
      ...rel(ctx, pick),
      holeDiameterMm: holeD,
      placement: { kind: "rear-edge", preferred: "side-wall", fallback: true, reason: "Salida lateral (side-wall) diferida en V1: exigiría perforar la pared en dirección horizontal (geometría frágil); se usa un puerto trasero cerca del borde." },
      valid: true,
    };
    out.ports.push(port);
    state.recs.push(makeZone(id, "cable-port", instance.id, [circlePolygon(pick[0], pick[1], holeD)]));
  }
}

// ------------------------------------------------------------ empalmes

interface BayShape {
  innerW: number;
  innerL: number;
  outerW: number;
  outerL: number;
  height: number;
}

export function baySizes(s: SignInstallationSettings["wiring"]["splice"]): BayShape {
  const innerW = s.diameterMm + 2 * s.clearanceMm;
  const innerL = s.lengthMm + 2 * s.clearanceMm;
  return { innerW, innerL, outerW: innerW + 2 * BAY_RAIL_MM, outerL: innerL, height: bayHeightMm(s.diameterMm) };
}

/** Polígono exterior (envolvente) de una bahía: el rectángulo que reserva la zona. */
export function bayFootprint(cx: number, cy: number, rot: 0 | 90, shape: BayShape): Point2D[] {
  return rectPolygon(cx, cy, shape.outerL, shape.outerW, rot);
}

function placeBays(state: LetterState, ctx: Ctx, out: LetterInstallationPlan): void {
  const w = ctx.settings.wiring;
  const { instance } = state;
  if (w.mode !== "chained" || !w.splice.enabled) return;
  const override = ctx.settings.overrides[instance.id];
  if (override?.spliceEnabled === false) return;
  const shape = baySizes(w.splice);
  const b = instance.boundsMm;
  const centroid: Point2D = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  const preferredRot: 0 | 90 = b.height >= b.width ? 90 : 0;
  const rotations: (0 | 90)[] = preferredRot === 90 ? [90, 0] : [0, 90];
  const cands = candidateGrid(instance);

  const placed: SpliceBay[] = [];
  const tryPlace = (polarity: "+" | "-", manual: RelPoint | undefined, anchor: Point2D): boolean => {
    const id = `${instance.id}:bay${polarity === "+" ? "P" : "N"}`;
    const availM = available(state, ctx, FEATURE_EDGE_MARGIN_MM);
    let best: { p: Point2D; rot: 0 | 90; score: number } | null = null;
    if (manual) {
      const p = glob(ctx, manual);
      const rot = preferredRot;
      const ok = insideAll([bayFootprint(p[0], p[1], rot, shape)], availM.paths);
      placed.push({ id, letterId: instance.id, polarity, ...rel(ctx, p), rotationDeg: rot, innerWidthMm: shape.innerW, innerLengthMm: shape.innerL, outerWidthMm: shape.outerW, outerLengthMm: shape.outerL, heightMm: shape.height, valid: ok });
      if (ok) state.recs.push(makeZone(id, "splice-bay", instance.id, [bayFootprint(p[0], p[1], rot, shape)]));
      else state.issues.push({ code: "SPLICE_OUTSIDE_MATERIAL", letterId: instance.id, message: `El alojamiento de empalme ${polarity} de ${instance.label} queda fuera del material o se superpone con otra feature.` });
      return true;
    }
    for (const rot of rotations) {
      const halfMin = Math.min(shape.outerW, shape.outerL) / 2;
      const avail = available(state, ctx, halfMin + FEATURE_EDGE_MARGIN_MM);
      const pool = cands
        .filter((c) => isPointInsideContourGroups(avail.groups, c))
        .map((c) => ({ c, score: Math.hypot(c[0] - anchor[0], c[1] - anchor[1]) + (rot === preferredRot ? 0 : 0.5) }))
        .sort((p, q) => p.score - q.score || byXY(p.c, q.c));
      for (const cand of pool) {
        if (best && cand.score >= best.score) break;
        if (insideAll([bayFootprint(cand.c[0], cand.c[1], rot, shape)], availM.paths)) {
          best = { p: cand.c, rot, score: cand.score };
          break;
        }
      }
    }
    if (!best) return false;
    const fp = bayFootprint(best.p[0], best.p[1], best.rot, shape);
    placed.push({ id, letterId: instance.id, polarity, ...rel(ctx, best.p), rotationDeg: best.rot, innerWidthMm: shape.innerW, innerLengthMm: shape.innerL, outerWidthMm: shape.outerW, outerLengthMm: shape.outerL, heightMm: shape.height, valid: true });
    state.recs.push(makeZone(id, "splice-bay", instance.id, [fp]));
    return true;
  };

  const okPlus = tryPlace("+", override?.splicePlus, centroid);
  const plusAnchor: Point2D = placed[0] ? glob(ctx, placed[0]) : centroid;
  const okMinus = okPlus && tryPlace("-", override?.spliceMinus, plusAnchor);
  if (!okPlus || !okMinus) {
    // Sin espacio para AMBAS bahías: no se deja una sola (quedaría un empalme sin su par).
    for (const bay of placed) state.recs = state.recs.filter((r) => r.zone.id !== bay.id);
    state.cache.clear();
    state.issues.push({ code: "SPLICE_NO_SPACE", letterId: instance.id, message: `No hay espacio suficiente para el alojamiento automático de empalmes en ${instance.label}. Podés desactivarlo para esta letra.` });
    return;
  }
  out.bays.push(...placed);
}

// ------------------------------------------------------------------- clips

function placeClips(state: LetterState, ctx: Ctx, out: LetterInstallationPlan): void {
  const w = ctx.settings.wiring;
  if (w.mode !== "chained" || out.bays.length === 0) return;
  const gap = w.wireDiameterMm + 2 * 0.15;
  const outerW = gap + 2 * CLIP_POST_MM;
  const target: Point2D = [ctx.origin.x + (out.bays[0].x + out.bays[out.bays.length - 1].x) / 2, ctx.origin.y + (out.bays[0].y + out.bays[out.bays.length - 1].y) / 2];
  const CLIPS_PER_PORT = 2;
  const DEVIATIONS = [0, 15, -15, 30, -30, 45, -45, 60, -60, 90, -90, 120, -120, 150, -150, 180];
  for (const port of out.ports) {
    const availM = available(state, ctx, FEATURE_EDGE_MARGIN_MM);
    const start = glob(ctx, port);
    const baseAngle = Math.atan2(target[1] - start[1], target[0] - start[0]);
    // Se prueban direcciones alrededor de la recta puerto -> bahías y se elige la primera que aloja ambos clips
    // (o la que aloja más). Orden físico garantizado: distancia creciente desde el puerto.
    let best: CableClip[] = [];
    for (const dev of DEVIATIONS) {
      const angle = baseAngle + (dev * Math.PI) / 180;
      const angleDeg = (angle * 180) / Math.PI;
      const trial: CableClip[] = [];
      let previous = 0;
      for (let n = 0; n < CLIPS_PER_PORT; n++) {
        const from = n === 0 ? CLIP_FIRST_DISTANCE_MM : previous + CLIP_SPACING_MM;
        let found: CableClip | null = null;
        for (let d = from; d <= from + 24 && !found; d += 1) {
          const cx = start[0] + Math.cos(angle) * d;
          const cy = start[1] + Math.sin(angle) * d;
          const fp = rectPolygon(cx, cy, CLIP_LENGTH_MM, outerW, angleDeg);
          if (isPointInsideContourGroups(availM.groups, [cx, cy]) && insideAll([fp], availM.paths)) {
            found = { id: `${port.id}:c${n + 1}`, letterId: state.instance.id, portId: port.id, ...rel(ctx, [cx, cy]), angleDeg, gapMm: gap, outerWidthMm: outerW, lengthMm: CLIP_LENGTH_MM, heightMm: clipHeightMm(w.wireDiameterMm), distanceFromPortMm: d };
            previous = d;
          }
        }
        if (!found) break;
        trial.push(found);
      }
      if (trial.length > best.length) best = trial;
      if (best.length === CLIPS_PER_PORT) break;
    }
    for (const clip of best) {
      const fp = rectPolygon(ctx.origin.x + clip.x, ctx.origin.y + clip.y, CLIP_LENGTH_MM, outerW, clip.angleDeg);
      state.recs.push(makeZone(clip.id, "cable-clip", state.instance.id, [fp], 0.6));
      out.clips.push(clip);
    }
    if (best.length < CLIPS_PER_PORT) {
      state.issues.push({ code: "CLIP_NO_SPACE", letterId: state.instance.id, message: `No hay espacio para ${best.length === 0 ? "los clips" : "el segundo clip"} de alivio de tensión del puerto ${port.role} de ${state.instance.label}.` });
    }
  }
}

// ---------------------------------------------------------------- etiquetas

function placeLabels(state: LetterState, ctx: Ctx, out: LetterInstallationPlan): void {
  if (ctx.settings.wiring.mode !== "chained" || !ctx.settings.wiring.printLabels) return;
  const tryLabel = (id: string, text: string, anchor: Point2D, candidates: { angleDeg: number; distance: number }[]) => {
    const wMm = textWidthMm(text);
    const hMm = 5 * LABEL_PIXEL_MM;
    for (const { angleDeg, distance } of candidates) {
      const rad = (angleDeg * Math.PI) / 180;
      const cx = anchor[0] + Math.cos(rad) * (distance + (Math.abs(Math.cos(rad)) * wMm) / 2);
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
  for (const bay of out.bays) {
    // Junto a la bahía: primero a los costados (compacto), luego más allá de sus extremos.
    const lateral = bay.outerWidthMm / 2 + 1.4;
    const axial = bay.outerLengthMm / 2 + 1.4;
    const rot = bay.rotationDeg;
    const near = [{ angleDeg: rot + 90, distance: lateral }, { angleDeg: rot + 270, distance: lateral }, { angleDeg: rot, distance: axial }, { angleDeg: rot + 180, distance: axial }];
    tryLabel(`${bay.id}:label`, bay.polarity === "+" ? "+" : "-", glob(ctx, bay), [...near, ...near.map((c) => ({ ...c, distance: c.distance + 3 }))]);
  }
  for (const port of out.ports) {
    const d = port.holeDiameterMm / 2 + 1.5;
    tryLabel(`${port.id}:label`, port.role === "out" ? "OUT" : "IN", glob(ctx, port), [90, 270, 0, 180].map((angleDeg) => ({ angleDeg, distance: d })));
  }
}

// ---------------------------------------------------------------- ruteo

function buildRoute(out: LetterInstallationPlan, roles: ReturnType<typeof buildWiringRoles>): RouteNode[] {
  const role = roles.get(out.instanceId);
  if (!role) return [];
  const route: RouteNode[] = [];
  const portIn = out.ports.find((p) => p.role === "in" || p.role === "power-in");
  const portOut = out.ports.find((p) => p.role === "out");
  const clipsOf = (portId: string) => out.clips.filter((c) => c.portId === portId).sort((a, b) => a.distanceFromPortMm - b.distanceFromPortMm);
  if (portIn) {
    route.push({ kind: "port-in", x: portIn.x, y: portIn.y, refId: portIn.id });
    for (const c of clipsOf(portIn.id)) route.push({ kind: "clip", x: c.x, y: c.y, refId: c.id });
  }
  for (const bay of out.bays) route.push({ kind: bay.polarity === "+" ? "bay+" : "bay-", x: bay.x, y: bay.y, refId: bay.id });
  if (portOut) {
    for (const c of [...clipsOf(portOut.id)].reverse()) route.push({ kind: "clip", x: c.x, y: c.y, refId: c.id });
    route.push({ kind: "port-out", x: portOut.x, y: portOut.y, refId: portOut.id });
  }
  return route;
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
  const plan: InstallationPlan = { active: isInstallationActive(settings), origin, instances, wiring: null, letters: [], cableLengths: [], errors, warnings };
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
    const out: LetterInstallationPlan = { instanceId: instance.id, mounts: [], ports: [], bays: [], clips: [], route: [], labels: [], zones: [] };
    placeMounts(state, ctx, out);
    placePorts(state, ctx, out, roles);
    placeBays(state, ctx, out);
    placeClips(state, ctx, out);
    placeLabels(state, ctx, out);
    out.route = wiringOn ? buildRoute(out, roles) : [];
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
      const isError = issue.code === "ZONES_OVERLAP" || issue.code === "MOUNT_INVALID" || issue.code === "SPLICE_OUTSIDE_MATERIAL" || issue.code === "PORT_INVADES_MOUNT";
      (isError ? errors : warnings).push(issue);
    }
    plan.letters.push(out);
  }

  validateFit(plan, params, settings);

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
    const wireCap = settings.wiring.splice.enabled ? bayHeightMm(settings.wiring.splice.diameterMm) : 0;
    if (anyOf((l) => l.bays.length) && wireCap > usable) push({ code: "FEATURE_EXCEEDS_CAVITY", letterId: null, message: `El alojamiento de empalmes (${wireCap.toFixed(1)} mm) no cabe en la cavidad disponible (${usable.toFixed(1)} mm).` }, true);
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
