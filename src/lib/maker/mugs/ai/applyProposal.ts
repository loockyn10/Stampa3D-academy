import { planMugBody } from "@/lib/maker/mugs/body/createMugBody";
import { createDecoration, defaultDepth, ENGRAVE_SAFETY_MM, MAX_DECORATIONS, newDecorationId } from "@/lib/maker/mugs/decorations/decorationDefaults";
import { bodyHeightOf } from "@/lib/maker/mugs/decorations/validateDecorations";
import { DEFAULT_MUG, deriveHandleDefaults } from "@/lib/maker/mugs/defaults";
import type { MugDecorationOp, MugDesignProposal, MugPatch, ProposedDecoration } from "@/lib/maker/mugs/ai/types";
import type { MugDecoration, MugDefinition, MugMedallionDef } from "@/lib/maker/mugs/types";

export interface ApplyOptions {
  /** Generador de ids de decoraciones nuevas (inyectable para tests deterministas). */
  newId?: () => string;
}

/** Fracción del contorno del jarro que una decoración puede ocupar como máximo. */
const MAX_CIRCUMFERENCE_FRACTION = 0.85;

function mergePatch(base: MugDefinition, patch: MugPatch): MugDefinition {
  return {
    ...base,
    ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
    ...(patch.heightMm !== undefined ? { heightMm: patch.heightMm } : {}),
    ...(patch.topDiameterMm !== undefined ? { topDiameterMm: patch.topDiameterMm } : {}),
    ...(patch.bottomDiameterMm !== undefined ? { bottomDiameterMm: patch.bottomDiameterMm } : {}),
    ...(patch.wallThicknessMm !== undefined ? { wallThicknessMm: patch.wallThicknessMm } : {}),
    ...(patch.bottomThicknessMm !== undefined ? { bottomThicknessMm: patch.bottomThicknessMm } : {}),
    ...(patch.bodyStyle !== undefined ? { bodyStyle: patch.bodyStyle } : {}),
    ...(patch.bodyBulgePct !== undefined ? { bodyBulgePct: patch.bodyBulgePct } : {}),
    ...(patch.rim !== undefined ? { rim: patch.rim } : {}),
    ...(patch.base !== undefined ? { base: patch.base } : {}),
    surface: { ...base.surface, ...patch.surface },
    grooves: { ...base.grooves, ...patch.grooves },
    bands: { ...base.bands, ...patch.bands },
    handle: { ...base.handle, ...patch.handle },
    insert: { ...base.insert, ...patch.insert },
  };
}

/** Coherencia entre campos que el modelo puede tocar por separado (la validación física sigue siendo `validateMug`). */
function reconcile(def: MugDefinition, patch: MugPatch, previous: MugDefinition): MugDefinition {
  const next = { ...def };

  // Ranuras / bandas: pedir una cantidad las activa; 0 bandas = desactivadas. Solo si el modelo no dijo `enabled`.
  if (patch.grooves && patch.grooves.enabled === undefined && patch.grooves.count !== undefined) next.grooves = { ...next.grooves, enabled: true };
  if (patch.bands && patch.bands.enabled === undefined && patch.bands.count !== undefined) next.bands = { ...next.bands, enabled: patch.bands.count > 0 };
  if (next.bands.enabled && next.bands.count <= 0) next.bands = { ...next.bands, enabled: false };

  // Las bandas deben entrar en la altura (mismo criterio que validateMug: 76 % de la altura del cuerpo).
  if (next.bands.enabled) {
    const fit = Math.floor((bodyHeightOf(next) * 0.76) / next.bands.heightMm);
    if (fit < next.bands.count) next.bands = fit >= 1 ? { ...next.bands, count: fit } : { ...next.bands, enabled: false };
  }

  // Asa: tocar altura/proyección/posición implica asa manual; lo que el modelo no dijo se deriva del jarro
  // (no del valor viejo, que en modo auto es solo un default).
  const h = patch.handle;
  if (h && next.handle.enabled) {
    const touchesManual = h.heightMm !== undefined || h.projectionMm !== undefined || h.verticalPositionPct !== undefined;
    if (touchesManual && h.auto === undefined) {
      const derived = deriveHandleDefaults(next.heightMm, Math.max(next.topDiameterMm, next.bottomDiameterMm));
      const wasAuto = previous.handle.auto;
      next.handle = {
        ...next.handle,
        auto: false,
        heightMm: h.heightMm ?? (wasAuto ? derived.heightMm : next.handle.heightMm),
        projectionMm: h.projectionMm ?? (wasAuto ? derived.projectionMm : next.handle.projectionMm),
        verticalPositionPct: h.verticalPositionPct ?? (wasAuto ? derived.verticalPositionPct : next.handle.verticalPositionPct),
      };
    }
  }
  return next;
}

/** Aplica los campos propuestos a una decoración (nueva o existente). */
function withDecorationFields(d: MugDecoration, c: ProposedDecoration, modeChanged: boolean): MugDecoration {
  const medallion: MugMedallionDef = {
    ...d.medallion,
    ...(c.medallionShape !== undefined ? { shape: c.medallionShape } : {}),
    ...(c.medallionBaseDepthMm !== undefined ? { baseDepthMm: c.medallionBaseDepthMm } : {}),
    ...(c.medallionPaddingMm !== undefined ? { paddingMm: c.medallionPaddingMm } : {}),
  };
  let source = c.source !== undefined && c.source !== null ? c.source : d.source;
  if (source.kind === "text" && (c.fontId !== undefined || c.align !== undefined)) {
    source = { ...source, ...(c.fontId !== undefined ? { fontId: c.fontId } : {}), ...(c.align !== undefined ? { align: c.align } : {}) };
  }
  const mode = c.mode ?? d.mode;
  return {
    ...d,
    name: c.name ?? d.name,
    enabled: c.enabled ?? d.enabled,
    source,
    mode,
    position: { angleDeg: c.angleDeg ?? d.position.angleDeg, centerZMm: c.centerZMm ?? d.position.centerZMm },
    size: { ...d.size, widthMm: c.widthMm ?? d.size.widthMm, heightMm: c.heightMm ?? d.size.heightMm },
    rotationDeg: c.rotationDeg ?? d.rotationDeg,
    depthMm: c.depthMm ?? (modeChanged ? defaultDepth(mode) : d.depthMm),
    medallion,
  };
}

function applyOps(def: MugDefinition, base: MugDecoration[], ops: MugDecorationOp[], replace: boolean, newId: () => string): MugDecoration[] {
  let list = replace ? [] : [...base];
  const height = bodyHeightOf(def);
  for (const op of ops) {
    if (op.op === "remove") {
      list = list.filter((d) => d.id !== op.targetId);
    } else if (op.op === "update") {
      if (op.needsAssetChoice && op.changes.source === null) continue; // pendiente de elección del usuario
      list = list.map((d) => (d.id === op.targetId ? withDecorationFields(d, op.changes, op.changes.mode !== undefined && op.changes.mode !== d.mode) : d));
    } else {
      const source = op.decoration.source;
      if (!source || list.length >= MAX_DECORATIONS) continue; // sin archivo elegido o sin cupo
      const created = createDecoration(source, height, { id: newId(), mode: op.decoration.mode ?? "emboss" });
      list.push(withDecorationFields({ ...created, depthMm: defaultDepth(created.mode) }, op.decoration, false));
    }
  }
  return list;
}

/** Deja cada decoración dentro de lo que el motor puede resolver (altura, profundidad de grabado, ancho vs. contorno). */
function fitDecorations(def: MugDefinition): MugDefinition {
  if (def.decorations.length === 0) return def;
  const height = bodyHeightOf(def);
  let outerR: ((z: number) => number) | null = null;
  try {
    outerR = planMugBody(def, "preview").outerR;
  } catch {
    outerR = null; // definición inválida: validateMug lo informará
  }
  const decorations = def.decorations.map((d) => {
    let next = d;
    const z = Math.min(Math.max(d.position.centerZMm, 0), height);
    if (z !== d.position.centerZMm) next = { ...next, position: { ...next.position, centerZMm: z } };
    if (d.mode === "engrave") {
      const maxDepth = def.wallThicknessMm - ENGRAVE_SAFETY_MM - 0.05;
      if (maxDepth >= 0.1 && d.depthMm > maxDepth) next = { ...next, depthMm: Math.round(maxDepth * 100) / 100 };
    }
    if (outerR) {
      const spread = Math.abs(Math.cos((d.rotationDeg * Math.PI) / 180)) + Math.abs(Math.sin((d.rotationDeg * Math.PI) / 180));
      const maxW = (2 * Math.PI * outerR(z) * MAX_CIRCUMFERENCE_FRACTION) / spread;
      if (Number.isFinite(maxW) && maxW > 3 && d.size.widthMm > maxW) next = { ...next, size: { ...next.size, widthMm: Math.round(maxW * 10) / 10 } };
    }
    return next;
  });
  return { ...def, decorations };
}

/**
 * Función PURA: `MugDefinition` actual + propuesta saneada -> `MugDefinition` siguiente.
 * - patch: parte de la definición actual y cambia solo lo propuesto (todo lo demás, incluidas dimensiones y asa, se conserva).
 * - full: parte de los defaults del motor, pero conserva el MODO (jarro/inserto), las medidas del inserto y las
 *   decoraciones actuales (salvo `replaceDecorations`, que el usuario debe haber pedido).
 * No valida física (eso es `validateMug`); sí evita combinaciones incoherentes obvias (bandas que no entran, asa manual sin datos).
 */
export function applyMugDesignProposal(current: MugDefinition, proposal: MugDesignProposal, options: ApplyOptions = {}): MugDefinition {
  const newId = options.newId ?? newDecorationId;
  const base: MugDefinition = proposal.mode === "full" ? { ...DEFAULT_MUG, mode: current.mode, insert: current.insert, decorations: current.decorations } : current;
  let next = reconcile(mergePatch(base, proposal.mugPatch), proposal.mugPatch, base);
  next = { ...next, decorations: applyOps(next, base.decorations, proposal.decorationOps, proposal.replaceDecorations, newId) };
  return fitDecorations(next);
}

/** Resuelve la elección del usuario para las decoraciones que quedaron sin archivo (varios candidatos). */
export function resolveAssetChoice(proposal: MugDesignProposal, opIndex: number, source: NonNullable<ProposedDecoration["source"]>): MugDesignProposal {
  const ops = proposal.decorationOps.map((op, i) => {
    if (i !== opIndex || op.op === "remove" || !op.needsAssetChoice) return op;
    const { needsAssetChoice: _ignored, ...rest } = op;
    void _ignored;
    return rest.op === "add" ? { ...rest, decoration: { ...rest.decoration, source } } : { ...rest, changes: { ...rest.changes, source } };
  }) as MugDecorationOp[];
  return { ...proposal, decorationOps: ops };
}

export function pendingAssetChoices(proposal: MugDesignProposal): number[] {
  return proposal.decorationOps.flatMap((op, i) => (op.op !== "remove" && op.needsAssetChoice ? [i] : []));
}
