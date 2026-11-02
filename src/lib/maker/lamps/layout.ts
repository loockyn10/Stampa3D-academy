import { buildInsertSurface, insertEnvelopeGap, type InsertSurface } from "@/lib/maker/lamps/insert/surface";
import type { DoubleWallField } from "@/lib/maker/lamps/doublewall/field";
import type { OpenworkField } from "@/lib/maker/lamps/openwork/field";
import { threadFacts, threadSpec, type LampThreadSpec } from "@/lib/maker/lamps/threads/lampThread";
import { minInnerRadiusBetween, type ShadeField } from "@/lib/maker/lamps/shade/surface";
import { LAMP_GEOMETRY, type LampClearanceCheck, type LampDefinition, type LampDiffuserFitReport, type LampFitReport, type LampInsertStyle, type LampThreadReport, type LampTowerReport } from "@/lib/maker/lamps/types";

/** Torre central de la base (radios en mm, alturas en Z de ensamblado): la leen la base, el cilindro y la pieza de prueba del portalámparas. */
export interface TowerLayout {
  /** Agujero central pasante (desde la mesa hasta la cara superior). */
  boreR: number;
  /** Rebaje superior de los anillos: radio, z del piso del rebaje (apoyo) y z de la cara superior de la torre. */
  recessR: number;
  seatZ: number;
  topZ: number;
  /** Radio exterior de la torre. */
  towerR: number;
  /** Ranura anular del cilindro (null sin cilindro) y z de su fondo. */
  slot: null | { innerR: number; outerR: number; bottomZ: number };
}

export interface TieLayout {
  /** Centro en X de las dos ranuras del precinto, medio ancho (X) y rango en Y a cada lado del canal. */
  x: number;
  halfX: number;
  y0: number;
  y1: number;
}

/** Reborde anular interno de adhesión, ya resuelto contra el resto del ensamblaje (torre, inserto). */
export interface AdhesionLayout {
  enabled: boolean;
  widthMm: number;
  heightMm: number;
  /** Radio exterior (= orificio del cuello) e interior del reborde, y z de su cara inferior (el tope) y superior. */
  outerR: number;
  innerR: number;
  z0: number;
  z1: number;
  /** Ancho máximo sin interferencia (con la holgura de diseño) y holgura radial real que deja el ancho pedido. */
  availableWidthMm: number;
  clearanceMm: number;
  limitedBy: "tower" | "insert";
}

export interface CollarLayout {
  /** Radio exterior de la pared del pozo, radio del pozo (hueco que recibe la pantalla) y radio interior del piso del pozo. */
  outerWallR: number;
  socketR: number;
  floorInnerR: number;
  /** Altura de la transición de 45° del collar. */
  flareH: number;
  floorZ: number;
  topZ: number;
}

/**
 * Posiciones (ensamblado: base apoyada en Z = 0, eje de la lámpara en X = Y = 0) y radios derivados de la definición.
 * Es la ÚNICA fuente de las cotas de encastre: la geometría de base/cilindro/pantalla/collar y la validación leen de
 * acá, así que lo que se valida es exactamente lo que se genera.
 */
export interface LampLayout {
  spec: LampThreadSpec;
  connection: "integrated" | "collar";

  // ---- Base (de abajo hacia arriba)
  tower: TowerLayout;
  /** Cara superior del piso: de acá sube la torre y empieza la cavidad anular. */
  floorTopZ: number;
  /** Tope de la rosca: la cara plana de abajo del cuello apoya acá. */
  ledgeZ: number;
  baseTopZ: number;
  baseDiameterMm: number;
  baseDiameterAuto: boolean;
  channelHalf: number;
  channelHeight: number;
  tie: TieLayout | null;
  /** Reborde interno de adhesión de la pieza roscada (pantalla o collar). */
  adhesion: AdhesionLayout;

  // ---- Pantalla / collar
  neckTopZ: number;
  /** Altura de la transición de 45° y z donde arranca la parte decorativa. */
  flareH: number;
  decorZ0: number;
  shadeTopZ: number;
  collar: CollarLayout | null;

  bodyR: number;
  ringsR: number;
  bulbR: number;
  holderTopZ: number;
  bulbTopZ: number;
  insert: null | {
    style: LampInsertStyle;
    /** Radio exterior / interior NOMINALES (zona de montaje, tubo liso). */
    outerR: number;
    innerR: number;
    /** Radio exterior máximo del cuerpo (con ondas, sin lengüetas). */
    bodyMaxR: number;
    heightMm: number;
    z0: number;
    z1: number;
    auto: boolean;
    tabLengthMm: number;
    closedTop: boolean;
    surface: InsertSurface;
  };
  fit: LampFitReport;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const ceilTo = (n: number, step: number) => Math.ceil(n / step - 1e-9) * step;

export function computeLampLayout(def: LampDefinition, field: ShadeField): LampLayout {
  const g = LAMP_GEOMETRY;
  const { shade, thread, insert, base, holder, bulb, cable } = def;
  const spec = threadSpec(thread);
  const connection = thread.connection;
  const bodyR = holder.bodyDiameterMm / 2;
  const ringsR = holder.ringsDiameterMm / 2;
  const bulbR = bulb.diameterMm / 2;
  const R_b = shade.bottomDiameterMm / 2;

  // ---- Torre: agujero, rebaje de los anillos, apoyo, cara superior
  const recessR = ringsR + holder.ringsClearanceMm;
  const seatZ = holder.seatHeightMm;
  const topZ = seatZ + holder.ringsRecessDepthMm;
  const envelopeR = Math.max(bulbR, bodyR);
  // Radio interior mínimo EXIGIDO (error si no se cumple): separación a la bombilla/cuerpo y a los anillos del portalámparas.
  const requiredInnerR = Math.max(envelopeR + insert.minBulbGapMm, ringsR + g.ringsToInsertMinMm);
  // Cilindro automático = el más angosto que lo cumple y además deja la pared sana de la torre entre el rebaje de los anillos
  // y la ranura (la recomendada, no solo la mínima).
  const autoInnerR = Math.max(requiredInnerR, recessR + insert.clearanceMm + g.towerWarnWallMm);

  // ---- Cable (el piso debe dejar el canal inferior con techo)
  const channelHalf = (cable.diameterMm + 1.5) / 2;
  const channelHeight = cable.diameterMm + 1 + (cable.tieAnchor ? g.tieStrapThicknessMm : 0);
  const floorTopZ = Math.max(8.6, channelHeight + 3);
  const ledgeZ = floorTopZ + g.baseCavityHeightMm;
  const baseTopZ = ledgeZ + spec.femaleDepth;
  const neckTopZ = ledgeZ + spec.neckLength;

  // ---- Cilindro de color y su ranura en la torre
  // Pantalla CALADA con difusor "según anillos": el cilindro ocupa el diámetro INTERIOR LIBRE de los anillos (menos la holgura diametral),
  // sin depender del diámetro decorativo máximo. Lo limita el anillo más angosto o, si fuera menor, la base (la torre que lo aloja necesita
  // 3 mm de aire hasta el orificio del cuello roscado). Con la sólida o con "manual" rige el diámetro de `insert.diameterMm` como siempre.
  // Pantallas calada y de doble pared: el difusor se dimensiona por el interior LIBRE (anillos, o la abertura central de la doble pared).
  const isDouble = def.shadeType === "double";
  const owField = (def.shadeType === "openwork" || isDouble) && "ringFree" in field ? (field as OpenworkField | DoubleWallField) : null;
  const diffuserCfg = isDouble ? def.doubleWall : def.openwork;
  const ringsMode = !!owField && diffuserCfg.diffuserFit === "rings";
  // Aire mínimo entre la torre y el orificio del cuello: 3 mm, o el ancho del reborde de adhesión más su holgura de diseño si es mayor (el reborde vive en ese espacio).
  const towerAirMm = Math.max(3, def.adhesion.enabled ? def.adhesion.widthMm + g.adhesionClearanceMm : 3);
  const baseLimitR = spec.boreR - towerAirMm - g.towerOuterWallMm - insert.clearanceMm;
  // Radio libre real del anillo inferior: con la rosca integrada, el escalón de la transición de 45° (cara interior del anillo menos el espesor sobre el cono) es más angosto que el propio anillo.
  // (solo la calada con transición hacia afuera: hacia adentro la cara interior del anillo sigue recta hasta el cono, sin escalón; la doble pared tiene su propio cono interior)
  const ledgeR = owField && def.shadeType === "openwork" && connection === "integrated" && R_b >= spec.rootR ? R_b - def.openwork.depthMm * Math.SQRT2 : Infinity;
  const bottomFreeR = owField ? Math.min(owField.ringFree.bottomR, ledgeR) : 0;
  let diffuserLimit: LampDiffuserFitReport["limitedBy"] = "manual";
  let cylOuterR = 0;
  let slot: TowerLayout["slot"] = null;
  if (insert.enabled) {
    if (ringsMode && owField) {
      const half = diffuserCfg.diffuserClearanceMm / 2;
      // El tubo de montaje es el mismo para los tres estilos (los insertos son intercambiables): un ondulado cuyas ondas no caben en el anillo se rechaza (DIFFUSER_CANNOT_PASS_TOP), no se achica el tubo.
      const candidates: [LampDiffuserFitReport["limitedBy"], number][] = isDouble
        ? [["opening", owField.ringFree.structureMinR - half], ["base", baseLimitR]]
        : [["bottomRing", bottomFreeR - half], ["topRing", owField.ringFree.topR - half], ["base", baseLimitR]];
      candidates.sort((a, b) => a[1] - b[1]);
      diffuserLimit = candidates[0][0];
      // al 0,05 mm hacia abajo, con 2,5 µm de tolerancia de redondeo (un libre de 79,999 mm con 1 mm de holgura da exactamente Ø79 mm, no Ø78,9)
      cylOuterR = Math.floor((candidates[0][1] + 0.0025) * 20) / 20;
    } else cylOuterR = insert.diameterMm === null ? ceilTo(autoInnerR + insert.thicknessMm, 0.25) : insert.diameterMm / 2;
    slot = { innerR: cylOuterR - insert.thicknessMm - insert.clearanceMm, outerR: cylOuterR + insert.clearanceMm, bottomZ: topZ - insert.seatDepthMm };
  }
  const towerR = slot ? slot.outerR + g.towerOuterWallMm : recessR + 2.4;
  const tower: TowerLayout = { boreR: holder.boreDiameterMm / 2, recessR, seatZ, topZ, towerR, slot };

  // ---- Transición cuello -> parte decorativa (45°) o collar independiente
  let collar: CollarLayout | null = null;
  let flareH: number;
  let decorZ0: number;
  if (connection === "collar") {
    const outerWallR = R_b + g.socketClearanceMm + g.socketWallMm;
    flareH = outerWallR - spec.rootR;
    const floorZ = neckTopZ + flareH;
    collar = { outerWallR, socketR: R_b + g.socketClearanceMm, floorInnerR: R_b - g.socketFloorWidthMm, flareH, floorZ, topZ: floorZ + shade.collarHeightMm };
    decorZ0 = floorZ;
  } else {
    // Calada: la transición de 45° puede ir hacia afuera o hacia ADENTRO (anillos más angostos que la raíz de la rosca); solida y doble pared, solo hacia afuera.
    flareH = def.shadeType === "openwork" ? Math.abs(R_b - spec.rootR) : R_b - spec.rootR;
    decorZ0 = neckTopZ + flareH;
  }
  const shadeTopZ = decorZ0 + shade.heightMm;
  const holderTopZ = seatZ + holder.heightMm;
  const bulbTopZ = holderTopZ + bulb.heightAboveHolderMm;

  const maxShadeD = 2 * field.maxOuterRadius;
  const autoBaseD = ceilTo(Math.max(2 * (spec.majorR + spec.clearance + g.baseOuterWallMm), 0.6 * maxShadeD, 0.3 * shadeTopZ), 5);
  const baseDiameterMm = base.diameterMm ?? autoBaseD;

  let insertLayout: LampLayout["insert"] = null;
  if (slot) {
    const z0 = slot.bottomZ;
    // Altura automática: el % de lo disponible; en los estilos CERRADOS, además, la mínima que deja la tapa (plano) o el arranque
    // del cierre (gota) por encima de la envolvente de la bombilla más la separación de diseño (la bombilla se modela como cilindro).
    let autoHeight = round1((insert.heightPct / 100) * (shadeTopZ - z0));
    if (insert.style === "flat") autoHeight = Math.max(autoHeight, round1(bulbTopZ + insert.minBulbGapMm + insert.capThicknessMm + 0.5 - z0));
    if (insert.style === "drop") autoHeight = round1(bulbTopZ + insert.minBulbGapMm + insert.dropClosureMm + 0.5 - z0);
    const heightMm = insert.heightMm ?? autoHeight;
    const surface = buildInsertSurface({
      style: insert.style,
      outerR: cylOuterR,
      thicknessMm: insert.thicknessMm,
      z0,
      heightMm,
      seatDepthMm: insert.seatDepthMm,
      capThicknessMm: insert.capThicknessMm,
      drop: { closureMm: insert.dropClosureMm, curvaturePct: insert.dropCurvaturePct, tipRadiusMm: insert.dropTipRadiusMm },
      wavy: { waves: insert.waves, amplitudeMm: insert.amplitudeMm, twistDeg: insert.twistDeg, verticalFrequency: insert.verticalFrequency, top: insert.wavyTop },
      // Con el difusor según anillos las lengüetas exteriores no caben (no hay espacio radial hasta el anillo): se ignoran y se avisa.
      tabs: insert.tabs && !ringsMode,
    });
    insertLayout = {
      style: insert.style,
      outerR: cylOuterR,
      innerR: cylOuterR - insert.thicknessMm,
      bodyMaxR: surface.bodyMaxR,
      heightMm,
      z0,
      z1: z0 + heightMm,
      auto: insert.diameterMm === null && !ringsMode,
      tabLengthMm: surface.tabLengthMm,
      closedTop: surface.closedTop,
      surface,
    };
  }

  // ---- Espacio libre del cilindro respecto del cuello roscado y de la pantalla
  let shadeClear: number | null = null;
  let removableFromTop: boolean | null = null;
  if (insertLayout) {
    const localTop = insertLayout.z1 - decorZ0;
    let clearAll = spec.boreR - insert.clearanceMm;
    let clearTop: number;
    if (localTop > 0) {
      clearAll = Math.min(clearAll, minInnerRadiusBetween(field, 0, localTop) - insert.clearanceMm);
      clearTop = minInnerRadiusBetween(field, localTop - g.tabThicknessMm, localTop) - insert.clearanceMm - insertLayout.tabLengthMm;
    } else {
      clearTop = spec.boreR - insert.clearanceMm - insertLayout.tabLengthMm; // cilindro corto: sus lengüetas quedan dentro del cuello
    }
    if (owField && connection === "integrated" && localTop > 0) clearAll = Math.min(clearAll, ledgeR - insert.clearanceMm);
    shadeClear = Math.min(clearAll, clearTop);
    removableFromTop = localTop >= shade.heightMm ? true : minInnerRadiusBetween(field, Math.max(localTop, 0), shade.heightMm) >= insertLayout.bodyMaxR + insertLayout.tabLengthMm + insert.clearanceMm;
  }

  // ---- Anclaje del precinto: entre la torre y la pared de la cavidad
  const tieRoom = spec.boreR - towerR;
  const tie: TieLayout | null =
    cable.tieAnchor && tieRoom >= g.tieStrapWidthMm + 3
      ? { x: (towerR + spec.boreR) / 2, halfX: g.tieStrapWidthMm / 2, y0: channelHalf - 0.5, y1: channelHalf + g.tieStrapThicknessMm }
      : null;

  // ---- Reborde interno de adhesión: vive en el orificio del cuello, justo sobre el tope. Lo que lo limita es lo que cruza ese plano
  // dentro del orificio: la torre central (siempre) y el inserto si su borde inferior llega hasta ahí (ranura muy profunda).
  const adh = def.adhesion;
  const insertAtFlange = insertLayout && insertLayout.z0 < ledgeZ + adh.heightMm && insertLayout.z1 > ledgeZ ? insertLayout.bodyMaxR : 0;
  const nearestR = Math.max(towerR, insertAtFlange);
  const adhesion: AdhesionLayout = {
    enabled: adh.enabled,
    widthMm: adh.widthMm,
    heightMm: adh.heightMm,
    outerR: spec.boreR,
    innerR: spec.boreR - adh.widthMm,
    z0: ledgeZ,
    z1: ledgeZ + adh.heightMm,
    availableWidthMm: round2(spec.boreR - nearestR - g.adhesionClearanceMm),
    clearanceMm: round2(spec.boreR - adh.widthMm - nearestR),
    limitedBy: insertAtFlange > towerR ? "insert" : "tower",
  };

  const gapActual = insertLayout ? (insertLayout.surface.valid ? insertEnvelopeGap(insertLayout.surface, { bodyR, holderTopZ, bulbR, bulbTopZ }) : insertLayout.innerR - envelopeR) : null;
  const ringsGap = insertLayout ? insertLayout.innerR - ringsR : null;
  let diffuser: LampDiffuserFitReport | null = null;
  if (owField && insertLayout) {
    diffuser = {
      source: ringsMode ? "rings" : "manual",
      ringBottomFreeDiameterMm: round2(2 * bottomFreeR),
      ringTopFreeDiameterMm: round2(2 * owField.ringFree.topR),
      structureMinFreeDiameterMm: round2(2 * owField.ringFree.structureMinR),
      baseLimitDiameterMm: round2(2 * baseLimitR),
      diffuserDiameterMm: round2(2 * insertLayout.bodyMaxR),
      diametralClearanceMm: diffuserCfg.diffuserClearanceMm,
      radialClearanceBottomMm: round2(bottomFreeR - insertLayout.bodyMaxR),
      radialClearanceTopMm: round2(owField.ringFree.topR - insertLayout.bodyMaxR),
      limitedBy: ringsMode ? diffuserLimit : "manual",
    };
  }
  const facts = threadFacts(spec);
  const threadReport: LampThreadReport = {
    connection,
    majorDiameterMm: round1(2 * spec.majorR),
    rootDiameterMm: round1(2 * spec.rootR),
    boreDiameterMm: round1(2 * spec.boreR),
    pitchMm: spec.pitch,
    starts: spec.starts,
    leadMm: round1(facts.leadMm),
    depthMm: round2(facts.depthMm),
    engagementMm: spec.length,
    usefulEngagementMm: round1(spec.usefulEngagement),
    turnsToSeat: round1(facts.turnsToSeat),
    radialClearanceMm: spec.clearance,
    normalClearanceMm: round2(facts.normalClearanceMm),
    axialPlayMm: facts.axialPlayMm,
    femaleDepthMm: round1(spec.femaleDepth),
    stopFaceWidthMm: round1(spec.rootR - spec.boreR),
    flareHeightMm: round1(flareH),
    neckLengthMm: round1(spec.neckLength),
    baseWallMm: round1(baseDiameterMm / 2 - (spec.majorR + spec.clearance)),
  };
  const innerWall = slot ? slot.innerR - recessR : null;
  const towerReport: LampTowerReport = {
    boreDiameterMm: round1(2 * tower.boreR),
    ringsRecessDiameterMm: round2(2 * recessR),
    ringsRecessDepthMm: holder.ringsRecessDepthMm,
    seatZ,
    topZ,
    seatMaterialMm: round1(seatZ),
    towerDiameterMm: round1(2 * towerR),
    slotInnerDiameterMm: slot ? round2(2 * slot.innerR) : 0,
    slotOuterDiameterMm: slot ? round2(2 * slot.outerR) : 0,
    slotDepthMm: insert.enabled ? insert.seatDepthMm : 0,
    innerWallMm: innerWall === null ? 0 : round2(innerWall),
    outerWallMm: slot ? g.towerOuterWallMm : 0,
    ringsToInsertGapMm: ringsGap === null ? null : round1(ringsGap),
    towerToNeckGapMm: round1(spec.boreR - towerR),
  };

  const clearances: LampClearanceCheck[] = [];
  const add = (id: string, label: string, valueMm: number, minMm: number | null, soft = false) =>
    clearances.push({ id, label, valueMm: round2(valueMm), minMm, status: minMm === null ? "info" : valueMm + 1e-6 >= minMm ? "ok" : soft ? "warn" : "fail" });
  add("threadRadial", "Rosca: holgura radial macho–hembra", spec.clearance, 0.2);
  add("threadNormal", "Rosca: holgura normal al flanco (45°)", facts.normalClearanceMm, null);
  add("threadCore", "Cuello: espesor bajo la raíz de la rosca", thread.coreWallMm, 2);
  add("baseWall", "Base: pared alrededor de la rosca", threadReport.baseWallMm, g.baseMinOuterWallMm);
  add("towerToNeck", "Torre – orificio del cuello roscado (radial)", spec.boreR - towerR, 3);
  if (innerWall !== null) {
    add("towerInnerWall", "Torre: pared entre el rebaje de los anillos y la ranura", innerWall, g.towerWarnWallMm, true);
    add("towerOuterWall", "Torre: pared exterior de la ranura", g.towerOuterWallMm, g.towerMinWallMm);
  }
  if (insertLayout) {
    add("ringsToInsert", "Anillos – interior del inserto (radial)", ringsGap ?? 0, g.ringsToInsertMinMm);
    add("insertShade", "Inserto – cuello/pantalla (radial, con ondas y lengüetas)", (shadeClear ?? 0) - insertLayout.bodyMaxR + insert.clearanceMm, insert.clearanceMm);
    clearances.push({
      id: "insertBulb",
      label: "Inserto – bombilla/portalámparas (mínima, cierre incluido)",
      valueMm: round2(gapActual ?? 0),
      minMm: insert.minBulbGapMm,
      status: (gapActual ?? 0) + 1e-6 < insert.minBulbGapMm ? "fail" : (gapActual ?? 0) < g.bulbGapAdvisoryMm ? "warn" : "ok",
    });
  }

  if (adh.enabled) add("adhesionClearance", "Reborde de adhesión – torre/inserto (radial)", adhesion.clearanceMm, g.adhesionClearanceMm);

  const adhesionReport = {
    enabled: adh.enabled,
    widthMm: adh.widthMm,
    heightMm: adh.heightMm,
    outerRadiusMm: round2(spec.boreR),
    innerRadiusMm: round2(adhesion.innerR),
    availableWidthMm: adhesion.availableWidthMm,
    clearanceMm: adhesion.clearanceMm,
    limitedBy: adhesion.limitedBy,
    contactAreaWithoutMm2: round1(Math.PI * (spec.rootR ** 2 - spec.boreR ** 2)),
    contactAreaMm2: round1(Math.PI * (spec.rootR ** 2 - (adh.enabled ? adhesion.innerR : spec.boreR) ** 2)),
  };

  const fit: LampFitReport = {
    shadeBottomZ: ledgeZ,
    decorBottomZ: decorZ0,
    shadeTopZ,
    insertBottomZ: insertLayout?.z0 ?? null,
    insertTopZ: insertLayout?.z1 ?? null,
    holderTopZ,
    bulbTopZ,
    insertOuterDiameterMm: insertLayout ? round1(2 * insertLayout.outerR) : null,
    insertInnerDiameterMm: insertLayout ? round1(2 * insertLayout.innerR) : null,
    insertAuto: insertLayout?.auto ?? false,
    insertStyle: insertLayout?.style ?? null,
    insertMaxDiameterMm: insertLayout ? round1(2 * insertLayout.bodyMaxR) : null,
    insertHeightMm: insertLayout ? round1(insertLayout.heightMm) : null,
    insertClosed: insertLayout?.closedTop ?? false,
    insertEnvelopeGapMm: gapActual === null ? null : round1(gapActual),
    adhesion: adhesionReport,
    diffuser,
    shadeClearRadiusMm: shadeClear === null ? null : round1(shadeClear),
    requiredInsertInnerRadiusMm: round1(requiredInnerR),
    insertBulbGapMm: gapActual === null ? null : round1(gapActual),
    insertRemovableFromTop: removableFromTop,
    baseDiameterMm,
    baseHeightMm: baseTopZ,
    floorTopZ,
    tower: towerReport,
    thread: threadReport,
    clearances,
  };

  return {
    spec,
    connection,
    tower,
    floorTopZ,
    ledgeZ,
    baseTopZ,
    baseDiameterMm,
    baseDiameterAuto: base.diameterMm === null,
    channelHalf,
    channelHeight,
    tie,
    adhesion,
    neckTopZ,
    flareH,
    decorZ0,
    shadeTopZ,
    collar,
    bodyR,
    ringsR,
    bulbR,
    holderTopZ,
    bulbTopZ,
    insert: insertLayout,
    fit,
  };
}
