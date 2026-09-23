// Orquestador de Instalación 0.3 (une segments.ts + wiring.ts + passThrough.ts +
// bridges.ts + clipPlacement.ts + wallClip.ts en un solo resultado). Vive separado de
// createNeonGeometry.ts para mantener cada pieza chica y testeable; createNeonGeometry.ts
// solo lo invoca y combina su resultado con la malla del canal (ver comentario ahí sobre
// por qué la validación de pass-through/puentes necesita el `cavityGroups` de una
// primera pasada SIN instalación).
import type { ContourGroup, Point2D } from "@/lib/maker/types";
import type { NeonChannelParams, NeonIssue, NeonPath } from "@/lib/maker/neon/types";
import { buildNeonSegments, type NeonSegment } from "@/lib/maker/neon/installation/segments";
import { buildManualWiringPlan, computeNeonBuses, planNeonWiring, type NeonWiringPlan } from "@/lib/maker/neon/installation/wiring";
import { isPassThroughValid, planPassThrough, type NeonPassThrough } from "@/lib/maker/neon/installation/passThrough";
import { planBridges, type BridgeEdge } from "@/lib/maker/neon/installation/bridges";
import { planClipPositions, type NeonClipPlacementSettings } from "@/lib/maker/neon/installation/clipPlacement";
import { buildNeonWallClipPart } from "@/lib/maker/neon/installation/wallClip";
import type { Interval } from "@/lib/maker/neon/installation/arclength";
import type { NeonAuxPart, NeonInstallationOverrides, NeonInstallationRecipe } from "@/lib/maker/neon/installation/types";

export interface NeonInstallationResult {
  segments: NeonSegment[];
  wiring: NeonWiringPlan | null;
  /** Pass-throughs ya VALIDADOS (dentro de la cavidad) — lo que efectivamente perfora el piso. */
  passThroughs: NeonPassThrough[];
  bridges: (BridgeEdge & { footprint: Point2D[] })[];
  clipPositions: Map<string, number[]>;
  auxParts: NeonAuxPart[];
  warnings: NeonIssue[];
  errors: NeonIssue[];
}

export function emptyNeonInstallationResult(): NeonInstallationResult {
  return { segments: [], wiring: null, passThroughs: [], bridges: [], clipPositions: new Map(), auxParts: [], warnings: [], errors: [] };
}

/**
 * `baselineCavityGroups` viene de `createChannelGeometry(shiftedPaths, params)` SIN
 * contexto de instalación (el mismo canal de siempre) — es contra lo que se valida cada
 * pass-through/puente. `shiftedPaths` debe ser EXACTAMENTE lo que recibió ese cálculo
 * (mismo shift de origen que createNeonGeometry.ts ya aplica).
 */
export function planNeonInstallation(
  shiftedPaths: NeonPath[],
  channelParams: NeonChannelParams,
  baselineCavityGroups: ContourGroup[],
  recipe: NeonInstallationRecipe,
  overrides: NeonInstallationOverrides,
): NeonInstallationResult {
  const segments = buildNeonSegments(shiftedPaths);
  const warnings: NeonIssue[] = [];
  const errors: NeonIssue[] = [];

  if (segments.length === 0) {
    return { segments, wiring: null, passThroughs: [], bridges: [], clipPositions: new Map(), auxParts: [], warnings, errors };
  }
  const byId = new Map(segments.map((s) => [s.id, s]));

  // Cableado, puentes y montaje son TRES conceptos independientes (Sección 20/26 del
  // pedido: "Mechanical bridge y electrical jumper son conceptos DIFERENTES"): cada uno
  // se activa con su propio toggle, sin depender de los otros dos.
  let wiring: NeonWiringPlan | null = null;
  let passThroughs: NeonPassThrough[] = [];
  if (recipe.wiringEnabled) {
    // --- Cableado: automático, con orden/inversión manual (Etapa 8) encima. ---
    let plan = planNeonWiring(segments, recipe.serviceMarginMm);
    const autoInverted = new Set(plan.segments.filter((s) => s.inverted).map((s) => s.segmentId));
    const manualOrderValid = overrides.order !== null && overrides.order.length === segments.length && overrides.order.every((id) => byId.has(id));
    const finalOrder = manualOrderValid ? (overrides.order as string[]) : plan.order;
    const finalInverted = new Set(autoInverted);
    for (const [segId, ov] of Object.entries(overrides.segments)) {
      if (!byId.has(segId)) continue;
      if (ov.invertedOrientation === true) finalInverted.add(segId);
      else if (ov.invertedOrientation === false) finalInverted.delete(segId);
    }
    const orderChanged = manualOrderValid && finalOrder.some((id, i) => id !== plan.order[i]);
    const invertedChanged = finalInverted.size !== autoInverted.size || [...finalInverted].some((id) => !autoInverted.has(id));
    if (orderChanged || invertedChanged) plan = buildManualWiringPlan(segments, finalOrder, finalInverted, recipe.serviceMarginMm);
    wiring = plan;

    const buses = computeNeonBuses(wiring);
    if (buses.shorted) errors.push({ code: "NEON_WIRING_SHORTED", message: "El cableado quedó en corto (bus + y bus - conectados). Revisá el orden manual." });

    // --- Pass-through: uno en el lado IN (siempre hay un jumper o la alimentación entrando ahí), otro en OUT si hasOut. Loops: uno solo, en su punto de corte. ---
    const passThroughSettings = { widthMm: recipe.passThroughWidthMm, heightMm: recipe.passThroughHeightMm, endpointInsetMm: recipe.endpointInsetMm };
    const rawPassThroughs: NeonPassThrough[] = [];
    for (const w of wiring.segments) {
      const seg = byId.get(w.segmentId)!;
      const ov = overrides.segments[w.segmentId];
      if (seg.closed) {
        const pt = planPassThrough(seg, "start", passThroughSettings, ov?.passThroughStart);
        if (pt) rawPassThroughs.push(pt);
        continue;
      }
      const inSide = w.inverted ? "end" : "start";
      const outSide = w.inverted ? "start" : "end";
      const inOverride = inSide === "start" ? ov?.passThroughStart : ov?.passThroughEnd;
      const inPt = planPassThrough(seg, inSide, passThroughSettings, inOverride);
      if (inPt) rawPassThroughs.push(inPt);
      if (w.hasOut) {
        const outOverride = outSide === "start" ? ov?.passThroughStart : ov?.passThroughEnd;
        const outPt = planPassThrough(seg, outSide, passThroughSettings, outOverride);
        if (outPt) rawPassThroughs.push(outPt);
      }
    }
    for (const pt of rawPassThroughs) {
      if (isPassThroughValid(pt, baselineCavityGroups)) {
        passThroughs.push(pt);
      } else {
        warnings.push({
          code: "NEON_PASS_THROUGH_INVALID",
          message: `El pass-through de ${pt.segmentId} (${pt.side === "start" ? "extremo inicial" : "extremo final"}) no entra en la cavidad del canal: revisá su posición o el tamaño configurado.`,
        });
      }
    }
  }

  // --- Puentes traseros (independiente del cableado) ---
  let bridges: (BridgeEdge & { footprint: Point2D[] })[] = [];
  if (recipe.bridgeMode === "bridged" && segments.length > 1) {
    const bridgePlan = planBridges(segments, channelParams, { widthMm: recipe.bridgeWidthMm, maxLengthBeforeWarningMm: recipe.bridgeLengthWarningMm }, baselineCavityGroups);
    bridges = bridgePlan.bridges;
    warnings.push(...bridgePlan.warnings);
  }

  // --- Clips de pared: reservan la zona de cada pass-through (+ margen) para no superponerse. ---
  let clipPositions = new Map<string, number[]>();
  const auxParts: NeonAuxPart[] = [];
  if (recipe.mountMode === "clips") {
    const reservedBySegment = new Map<string, Interval[]>();
    for (const pt of passThroughs) {
      const half = Math.max(pt.widthMm, pt.heightMm) / 2 + 2;
      const list = reservedBySegment.get(pt.segmentId) ?? [];
      list.push({ t0: pt.arcMm - half, t1: pt.arcMm + half });
      reservedBySegment.set(pt.segmentId, list);
    }
    const clipSettings: NeonClipPlacementSettings = {
      spacingMm: recipe.clipSpacingMm,
      clipDepthMm: recipe.clipDepthMm,
      minCurvatureRadiusMm: Math.max(channelParams.minBendRadiusMm, 5),
      edgeMarginMm: Math.max(20, recipe.clipSpacingMm * 0.2),
    };
    const clipResult = planClipPositions(segments, clipSettings, reservedBySegment);
    clipPositions = clipResult.positions;
    warnings.push(...clipResult.issues);

    const totalClips = [...clipPositions.values()].reduce((sum, arr) => sum + arr.length, 0);
    auxParts.push(
      ...buildNeonWallClipPart(
        channelParams,
        {
          wallGapMm: recipe.wallGapMm,
          clipClearanceMm: recipe.clipClearanceMm,
          clipWallThicknessMm: recipe.clipWallThicknessMm,
          clipDepthMm: recipe.clipDepthMm,
          screwShankDiameterMm: recipe.screwShankDiameterMm,
          screwHeadDiameterMm: recipe.screwHeadDiameterMm,
        },
        totalClips,
      ),
    );
    if (recipe.wallGapMm < 2) {
      warnings.push({ code: "NEON_WALL_GAP_CABLE_CONFLICT", message: "Una separación de pared tan chica puede no dejar lugar para el cableado detrás del canal." });
    }
  }

  return { segments, wiring, passThroughs, bridges, clipPositions, auxParts, warnings, errors };
}
