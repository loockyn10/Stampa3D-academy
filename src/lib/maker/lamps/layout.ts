import { effectiveProfileTop, isProfileStyle } from "@/lib/maker/lamps/insert/profile";
import { buildInsertSurface, insertEnvelopeGap, type InsertSurface } from "@/lib/maker/lamps/insert/surface";
import type { DoubleWallField } from "@/lib/maker/lamps/doublewall/field";
import type { OpenworkField } from "@/lib/maker/lamps/openwork/field";
import { threadFacts, threadSpec, type LampThreadSpec } from "@/lib/maker/lamps/threads/lampThread";
import { minInnerRadiusBetween, type ShadeField } from "@/lib/maker/lamps/shade/surface";
import { mountPressLayout, mountThreadLayout, mountTripodLayout, type MountPressLayout, type MountThreadLayout, type MountTripodLayout } from "@/lib/maker/lamps/holder/mounts";
import { REFERENCE_DIFFUSER, REFERENCE_THREAD_BASE2, REFERENCE_THREAD_V6 } from "@/lib/maker/lamps/holder/references";
import { LAMP_GEOMETRY, type LampClearanceCheck, type LampDefinition, type LampDiffuserFitReport, type LampFitReport, type LampHolderMount, type LampInsertStyle, type LampThreadReport, type LampTowerReport } from "@/lib/maker/lamps/types";

/** Torre central de la base (radios en mm, alturas en Z de ensamblado): la leen la base, el cilindro y la pieza de prueba del portalámparas. */
export interface TowerLayout {
  /** Sistema de fijación del portalámparas y si la base tiene piso. */
  mount: LampHolderMount;
  hasFloor: boolean;
  /** Plano donde apoya el portalámparas (piso del rebaje, fondo del agujero a presión o cara superior de la torre/plato). */
  holderSeatZ: number;
  /** Detalle de cada sistema (null si no aplica). */
  press: MountPressLayout | null;
  thread: MountThreadLayout | null;
  tripod: MountTripodLayout | null;
  /** Agujero central pasante (desde la mesa hasta la cara superior); con presión, el agujero liso del portalámparas. */
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
    /** Radio exterior / interior del CUERPO (con ondas: ver `bodyMaxR`). */
    outerR: number;
    innerR: number;
    /** Encastre inferior ESTÁNDAR (diffuser.stl): radio exterior e interior del tubo recto que entra en la ranura, y alto de la transición hasta el cuerpo. */
    fitOuterR: number;
    mountInnerR: number;
    flareH: number;
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
const round3 = (n: number) => Math.round(n * 1000) / 1000;
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
  const ringsSeatZ = holder.seatHeightMm;
  const ringsTopZ = ringsSeatZ + holder.ringsRecessDepthMm;
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

  // ---- Sistema de fijación del portalámparas: define el plano de apoyo, la cara superior de la torre y el agujero. Cada cota sale de los STL de referencia.
  const mount: LampHolderMount = holder.mount ?? "rings";
  let seatZ = ringsSeatZ;
  let topZ = ringsTopZ;
  let holderSeatZ = ringsSeatZ;
  let towerBoreR = holder.boreDiameterMm / 2;
  let hasFloor = true;
  let pressLayout: MountPressLayout | null = null;
  let threadLayout: MountThreadLayout | null = null;
  let tripodLayout: MountTripodLayout | null = null;
  if (mount === "press") {
    pressLayout = mountPressLayout(holder.pressDepthMm, channelHeight + g.towerFloorBelowSlotMm);
    seatZ = pressLayout.seatZ;
    topZ = pressLayout.topZ;
    holderSeatZ = pressLayout.seatZ;
    towerBoreR = pressLayout.boreR;
  } else if (mount === "threadBase2" || mount === "threadV6") {
    // la cara de entrada del portalámparas es la cara superior de la torre (o del plato): ahí apoya su brida, sin rebaje
    seatZ = ringsTopZ;
    topZ = ringsTopZ;
    holderSeatZ = ringsTopZ;
    threadLayout = mountThreadLayout(mount === "threadBase2" ? REFERENCE_THREAD_BASE2 : REFERENCE_THREAD_V6, topZ);
    if (mount === "threadV6") {
      hasFloor = false;
      towerBoreR = threadLayout.rootR;
      tripodLayout = mountTripodLayout(topZ, threadLayout.rootR, spec.boreR, ledgeZ);
    }
  }

  // ---- Cilindro de color y su ranura en la torre
  // Pantalla CALADA con difusor "según anillos": el cilindro ocupa el diámetro INTERIOR LIBRE de los anillos (menos la holgura diametral),
  // sin depender del diámetro decorativo máximo. Lo limita el anillo más angosto o, si fuera menor, la base (la torre que lo aloja necesita
  // 3 mm de aire hasta el orificio del cuello roscado). Con la sólida o con "manual" rige el diámetro de `insert.diameterMm` como siempre.
  // Pantallas calada y de doble pared: el difusor se dimensiona por el interior LIBRE (anillos, o la abertura central de la doble pared).
  const isDouble = def.shadeType === "double";
  const owField = (def.shadeType === "openwork" || isDouble) && "ringFree" in field ? (field as OpenworkField | DoubleWallField) : null;
  const diffuserCfg = isDouble ? def.doubleWall : def.openwork;
  // "diameter" (solo calada): el difusor es el dato; "rings": el difusor sale de los anillos; "manual": Ø de `insert.diameterMm`
  const fitMode: "diameter" | "rings" | "manual" = owField ? diffuserCfg.diffuserFit : "manual";
  const diameterMode = fitMode === "diameter" && !isDouble;
  const ringsMode = fitMode === "rings" || diameterMode;
  // Aire mínimo entre la torre y el orificio del cuello: 3 mm, o el ancho del reborde de adhesión más su holgura de diseño si es mayor (el reborde vive en ese espacio).
  const towerAirMm = Math.max(3, def.adhesion.enabled ? def.adhesion.widthMm + g.adhesionClearanceMm : 3);
  // Encastre inferior ESTÁNDAR (diffuser.stl): la ranura de la torre es siempre la de este tubo, sea cual sea el cuerpo del difusor. Lo único que limita el
  // ANCHO del cuerpo es que pase por el orificio del cuello roscado con la holgura de montaje (antes lo limitaba la torre, que crecía con el difusor).
  const fitOuterR = REFERENCE_DIFFUSER.outerDiameterMm / 2;
  const baseLimitR = spec.boreR - insert.clearanceMm;
  // Radio libre real del anillo inferior: con la rosca integrada, el escalón de la transición de 45° (cara interior del anillo menos el espesor sobre el cono) es más angosto que el propio anillo.
  // (solo la calada con transición hacia afuera: hacia adentro la cara interior del anillo sigue recta hasta el cono, sin escalón; la doble pared tiene su propio cono interior)
  const ledgeR = owField && def.shadeType === "openwork" && connection === "integrated" && R_b >= spec.rootR ? R_b - def.openwork.depthMm * Math.SQRT2 : Infinity;
  const bottomFreeR = owField ? Math.min(owField.ringFree.bottomR, ledgeR) : 0;
  let diffuserLimit: LampDiffuserFitReport["limitedBy"] = "manual";
  let cylOuterR = 0;
  let slot: TowerLayout["slot"] = null;
  let flareH0 = 0;
  if (insert.enabled) {
    if (diameterMode) {
      // el difusor mide exactamente lo pedido; que la base lo aloje lo valida DIFFUSER_EXCEEDS_BASE (no se achica en silencio)
      cylOuterR = def.openwork.diffuserDiameterMm / 2;
      diffuserLimit = "diameter";
    } else if (ringsMode && owField) {
      const half = diffuserCfg.diffuserClearanceMm / 2;
      // El tubo de montaje es el mismo para los tres estilos (los insertos son intercambiables): un ondulado cuyas ondas no caben en el anillo se rechaza (DIFFUSER_CANNOT_PASS_TOP), no se achica el tubo.
      const candidates: [LampDiffuserFitReport["limitedBy"], number][] = isDouble
        ? [["opening", owField.ringFree.structureMinR - half], ["base", baseLimitR]]
        : [["bottomRing", bottomFreeR - half], ["topRing", owField.ringFree.topR - half], ["base", baseLimitR]];
      candidates.sort((a, b) => a[1] - b[1]);
      diffuserLimit = candidates[0][0];
      // al 0,05 mm hacia abajo, con 2,5 µm de tolerancia de redondeo (un libre de 79,999 mm con 1 mm de holgura da exactamente Ø79 mm, no Ø78,9)
      cylOuterR = Math.floor((candidates[0][1] + 0.0025) * 20) / 20;
    } else if (isProfileStyle(insert.style)) {
      // Difusores de perfil: el encastre es el estándar y lo decorativo vive por encima (ancho, apertura, cintura...): el Ø nominal del cilindro no interviene.
      cylOuterR = fitOuterR;
    } else cylOuterR = insert.diameterMm === null ? Math.max(fitOuterR, ceilTo(autoInnerR + insert.thicknessMm, 0.25)) : insert.diameterMm / 2;
    slot = { innerR: fitOuterR - insert.thicknessMm - insert.clearanceMm, outerR: fitOuterR + insert.clearanceMm, bottomZ: topZ - insert.seatDepthMm };
    flareH0 = Math.max(0, cylOuterR - fitOuterR) / Math.tan((g.diffuserFlareDeg * Math.PI) / 180);
  }
  const towerR = Math.max(slot ? slot.outerR + g.towerOuterWallMm : recessR + 2.4, tripodLayout?.plateR ?? 0);
  const tower: TowerLayout = { mount, hasFloor, holderSeatZ, press: pressLayout, thread: threadLayout, tripod: tripodLayout, boreR: towerBoreR, recessR, seatZ, topZ, towerR, slot };

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
  const holderTopZ = holderSeatZ + holder.heightMm;
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
    // Calada con el difusor como dato: acompaña la altura útil de la estructura y deja solo la holgura vertical de ensamblaje bajo el borde superior.
    if (diameterMode) autoHeight = Math.floor((shadeTopZ - def.openwork.diffuserTopGapMm - z0) * 10 + 1e-6) / 10; // hacia abajo: nunca más cerca del borde que la holgura pedida
    if (insert.style === "flat") autoHeight = Math.max(autoHeight, round1(bulbTopZ + insert.minBulbGapMm + insert.capThicknessMm + 0.5 - z0));
    if (insert.style === "drop") autoHeight = round1(bulbTopZ + insert.minBulbGapMm + insert.dropClosureMm + 0.5 - z0);
    // Perfil con extremo cerrado (tapa plana, cúpula, gota o campana): la altura mínima deja la tapa / el cierre por encima de la bombilla más la separación de diseño.
    if (isProfileStyle(insert.style) && effectiveProfileTop(insert.style, insert.profileTop) !== "open") autoHeight = Math.max(autoHeight, round1(bulbTopZ + insert.minBulbGapMm + (effectiveProfileTop(insert.style, insert.profileTop) === "flat" ? insert.capThicknessMm : 4) + 0.5 - z0));
    const heightMm = insert.heightMm ?? autoHeight;
    const surface = buildInsertSurface({
      style: insert.style,
      outerR: cylOuterR,
      fitOuterR,
      thicknessMm: insert.thicknessMm,
      z0,
      heightMm,
      seatDepthMm: insert.seatDepthMm,
      capThicknessMm: insert.capThicknessMm,
      drop: { closureMm: insert.dropClosureMm, curvaturePct: insert.dropCurvaturePct, tipRadiusMm: insert.dropTipRadiusMm },
      wavy: { waves: insert.waves, amplitudeMm: insert.amplitudeMm, twistDeg: insert.twistDeg, verticalFrequency: insert.verticalFrequency, top: insert.wavyTop },
      profile: { widthMm: insert.profileWidthMm, topDiameterMm: insert.profileTopDiameterMm, curvaturePct: insert.profileCurvaturePct, waistPct: insert.profileWaistPct, waistPositionPct: insert.profileWaistPositionPct, top: insert.profileTop },
      // LOS DIFUSORES NO LLEVAN LENGÜETAS SUPERIORES: ningún estilo ni diseño (nuevo o anterior) las genera. `insert.tabs` se conserva en la definición solo por
      // compatibilidad de lectura del código SL1 y NO tiene efecto. El encastre inferior (tubo, transición y ranura) no depende de esto.
      tabs: false,
    });
    insertLayout = {
      style: insert.style,
      outerR: cylOuterR,
      innerR: cylOuterR - insert.thicknessMm,
      fitOuterR,
      mountInnerR: Math.min(fitOuterR, cylOuterR) - insert.thicknessMm,
      flareH: flareH0,
      bodyMaxR: surface.bodyMaxR,
      heightMm,
      z0,
      z1: z0 + heightMm,
      auto: insert.diameterMm === null && !ringsMode && !isProfileStyle(insert.style),
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

  // ---- Recorrido de inserción y extracción: el difusor entra y sale por la abertura superior; en todo el trayecto (estructura y cuello roscado) debe pasar con la holgura de montaje.
  let pathFreeR = 0;
  if (insertLayout) {
    pathFreeR = Math.min(spec.boreR, minInnerRadiusBetween(field, 0, shade.heightMm), ledgeR);
  }
  const pathClearance = insertLayout ? pathFreeR - (insertLayout.bodyMaxR + insertLayout.tabLengthMm) : 0;
  // Rosca de montaje más chica (Ø mayor) con la que la base aloja este difusor: la torre + su pared + el aire hasta el orificio del cuello deben caber.
  let minThreadMajor: number | null = null;
  if (insertLayout) {
    for (let m = 60; m <= 200; m += 0.5) {
      const probe = threadSpec({ ...thread, majorDiameterMm: m });
      // la torre estándar con su aire hasta el cuello, y el cuerpo del difusor pasando por el orificio del cuello
      if (probe.boreR - towerAirMm - g.towerOuterWallMm - insert.clearanceMm >= fitOuterR - 1e-9 && probe.boreR - insert.clearanceMm >= cylOuterR - 1e-9) {
        minThreadMajor = m;
        break;
      }
    }
  }

  const gapActual = insertLayout ? (insertLayout.surface.valid ? insertEnvelopeGap(insertLayout.surface, { bodyR, holderTopZ, bulbR, bulbTopZ }) : insertLayout.innerR - envelopeR) : null;
  const ringsGap = insertLayout ? insertLayout.mountInnerR - ringsR : null;
  let diffuser: LampDiffuserFitReport | null = null;
  if (owField && insertLayout) {
    diffuser = {
      source: diameterMode ? "diameter" : ringsMode ? "rings" : "manual",
      ringBottomFreeDiameterMm: round2(2 * bottomFreeR),
      ringTopFreeDiameterMm: round2(2 * owField.ringFree.topR),
      structureMinFreeDiameterMm: round2(2 * owField.ringFree.structureMinR),
      baseLimitDiameterMm: round2(2 * baseLimitR),
      diffuserDiameterMm: round2(2 * insertLayout.bodyMaxR),
      diametralClearanceMm: diffuserCfg.diffuserClearanceMm,
      radialClearanceBottomMm: round2(bottomFreeR - insertLayout.bodyMaxR),
      radialClearanceTopMm: round2(owField.ringFree.topR - insertLayout.bodyMaxR),
      limitedBy: ringsMode ? diffuserLimit : "manual",
      pathMinFreeDiameterMm: round2(2 * pathFreeR),
      pathClearanceMm: round2(pathClearance),
      insertable: pathClearance + 1e-4 >= insert.clearanceMm,
      topGapMm: round2(shadeTopZ - insertLayout.z1),
      minThreadMajorMm: minThreadMajor,
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
  // Sin rebaje de anillos (presión, roscas) la pared interior de la torre es la distancia del agujero a la ranura.
  const innerWall = slot ? slot.innerR - (mount === "rings" ? recessR : Math.max(towerBoreR, threadLayout?.rootR ?? 0)) : null;
  const towerReport: LampTowerReport = {
    mount,
    hasFloor,
    holderSeatZ,
    holderThread: threadLayout
      ? { rootDiameterMm: round2(2 * threadLayout.rootR), crestDiameterMm: round2(2 * threadLayout.crestR), pitchMm: threadLayout.pitch, turns: threadLayout.turns, firstApexZ: round2(threadLayout.deepApexZ), lastApexZ: round2(threadLayout.nearApexZ) }
      : null,
    holderPress: pressLayout ? { boreDiameterMm: round2(2 * pressLayout.boreR), depthMm: round2(pressLayout.depth), cableHoleDiameterMm: round2(2 * pressLayout.cableHoleR) } : null,
    boreDiameterMm: round2(2 * tower.boreR),
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
    insertFit: insertLayout ? { outerDiameterMm: round2(2 * insertLayout.fitOuterR), innerDiameterMm: round2(2 * insertLayout.mountInnerR), heightMm: round2(insert.seatDepthMm + g.insertMountExtraMm), flareHeightMm: round2(insertLayout.flareH) } : null,
    insertOuterDiameterMm: insertLayout ? round3(2 * insertLayout.outerR) : null,
    insertInnerDiameterMm: insertLayout ? round3(2 * insertLayout.innerR) : null,
    insertAuto: insertLayout?.auto ?? false,
    insertStyle: insertLayout?.style ?? null,
    insertMaxDiameterMm: insertLayout ? round3(2 * insertLayout.bodyMaxR) : null,
    insertMinDiameterMm: insertLayout && isProfileStyle(insertLayout.style) ? round3(2 * insertLayout.surface.bodyMinR) : null,
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
