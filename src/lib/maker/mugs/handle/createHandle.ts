import type { MugBodyPlan } from "@/lib/maker/mugs/body/createMugBody";
import { deriveHandleDefaults } from "@/lib/maker/mugs/defaults";
import { loftBetweenLoops, windowLoop } from "@/lib/maker/mugs/geometry/merge";
import type { IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";
import type { RevolveResult } from "@/lib/maker/mugs/geometry/revolveProfile";
import { pathFrames } from "@/lib/maker/mugs/geometry/sweep";
import { handleCenterline } from "@/lib/maker/mugs/handle/handlePaths";
import type { MugDefinition, MugHandleDef } from "@/lib/maker/mugs/types";

/** Diámetro máximo base (sin relieves) del cuerpo: para derivar tamaños automáticos del asa. */
export function baseMaxDiameter(plan: MugBodyPlan): number {
  let r = 0;
  for (let z = 0; z <= plan.heightMm; z += plan.heightMm / 40) r = Math.max(r, plan.outerR(z));
  return 2 * r;
}

/** Asa con `auto` resuelto: altura/proyección/posición derivadas del jarro, espesor y ancho del usuario. */
export function resolveHandle(def: MugDefinition, heightMm: number, maxDiameterMm: number): MugHandleDef {
  if (!def.handle.auto) return def.handle;
  const d = deriveHandleDefaults(heightMm, maxDiameterMm);
  return { ...def.handle, heightMm: d.heightMm, projectionMm: d.projectionMm, verticalPositionPct: d.verticalPositionPct };
}

export interface HandleAttachmentPlan {
  handle: MugHandleDef;
  /** Filas exteriores (k) de los centros de las uniones y semi-tamaño de la ventana en celdas. */
  rowTop: number;
  rowBot: number;
  hc: number;
  hr: number;
  /** Semi-tamaño real de la zona de unión (mm), para validar/mostrar. */
  windowHalfWidthMm: number;
  windowHalfHeightMm: number;
  /** Cuadriláteros de la pared a omitir (índices de fila de perfil i = k + 1). */
  skipQuad: (i: number, j: number) => boolean;
}

/** Dimensiones de la zona de unión: ancha (>= 8 mm de semi-ancho y semi-alto) para soportar carga. */
export function planHandleAttachments(def: MugDefinition, plan: MugBodyPlan): HandleAttachmentPlan {
  const handle = resolveHandle(def, plan.heightMm, baseMaxDiameter(plan));
  const zc = (plan.heightMm * handle.verticalPositionPct) / 100;
  const rowTop = Math.round((zc + handle.heightMm / 2) / plan.dz);
  const rowBot = Math.round((zc - handle.heightMm / 2) / plan.dz);
  const wa = Math.max(handle.sectionWidthMm, 8), wb = Math.max(handle.thicknessMm * 1.1, 8);
  const dy = (2 * Math.PI * plan.outerR(zc)) / plan.segments;
  const hc = Math.max(2, Math.round(wa / dy));
  const hr = Math.max(2, Math.round(wb / plan.dz));
  const inWindow = (k: number, j: number, row: number) => {
    if (k < row - hr || k > row + hr - 1) return false;
    const jm = ((j % plan.segments) + plan.segments) % plan.segments;
    return jm < hc || jm >= plan.segments - hc;
  };
  return {
    handle,
    rowTop,
    rowBot,
    hc,
    hr,
    windowHalfWidthMm: hc * dy,
    windowHalfHeightMm: hr * plan.dz,
    skipQuad: (i, j) => inWindow(i - 1, j, rowTop) || inWindow(i - 1, j, rowBot),
  };
}

/**
 * Construye el asa como loft pegado a los bordes de las dos ventanas del cuerpo (ver geometry/merge.ts).
 * Modifica `mesh` en el lugar.
 */
export function buildHandle(mesh: IndexedMesh, body: RevolveResult, plan: MugBodyPlan, att: HandleAttachmentPlan, stepMm: number): void {
  const loop = windowLoop(att.hc, att.hr);
  const top = loop.map((o) => body.vertex(att.rowTop + o.dr + 1, o.dc));
  // En la unión inferior el eje N apunta hacia abajo: mismo orden local <=> fila espejada.
  const bot = loop.map((o) => body.vertex(att.rowBot - o.dr + 1, o.dc));
  const cTop = body.vertex(att.rowTop + 1, 0), cBot = body.vertex(att.rowBot + 1, 0);
  const at = (v: number) => [mesh.positions[v * 3], mesh.positions[v * 3 + 2]] as const;
  const [xT, zT] = at(cTop), [xB, zB] = at(cBot);
  const path = handleCenterline(att.handle.style, xT, zT, xB, zB, att.handle.projectionMm, stepMm);
  path[0] = [xT, zT];
  path[path.length - 1] = [xB, zB];
  const frames = pathFrames(path);
  const total = frames[frames.length - 1].s;
  loftBetweenLoops(mesh, top, bot, frames, {
    halfWidth: att.handle.sectionWidthMm / 2,
    halfThickness: att.handle.thicknessMm / 2,
    blendLength: Math.min(total * 0.3, 14),
  });
  void plan;
}
