import { threadFacts, threadSpec, type LampThreadSpec } from "@/lib/maker/lamps/threads/lampThread";
import { minInnerRadiusBetween, type ShadeField } from "@/lib/maker/lamps/shade/surface";
import { LAMP_GEOMETRY, type LampClearanceCheck, type LampDefinition, type LampFitReport, type LampThreadReport } from "@/lib/maker/lamps/types";

/** Alojamiento de la espiga/tornillos del portalámparas, ya resuelto. Lo leen la base y la pieza de prueba de ajuste. */
export interface FixingLayout {
  mount: "stem" | "screws";
  /** Radio de los agujeros pasantes (espiga o tornillo + holgura). */
  holeR: number;
  /** Centros de los agujeros (y de las tuercas). Una espiga: un centro en el eje; tornillos: dos, sobre Y. */
  centers: { x: number; y: number }[];
  /** Radio circunscripto del alojamiento hexagonal (con holgura) y su techo (z de ensamblado). */
  nutPocketCircumR: number;
  nutPocketAcrossFlats: number;
  pocketCeilingZ: number;
  /** Material entre la cara de apoyo del portalámparas y el techo del alojamiento. */
  webMm: number;
  /** "screws": agujero central de paso del cable (radio). */
  cableHoleR: number | null;
}

export interface TieLayout {
  /** Centro en X de las dos ranuras del precinto, medio ancho (X) y rango en Y a cada lado del canal. */
  x: number;
  halfX: number;
  y0: number;
  y1: number;
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
 * Es la ÚNICA fuente de las cotas de encastre: la geometría de base/inserto/pantalla/collar y la validación leen de
 * acá, así que lo que se valida es exactamente lo que se genera.
 */
export interface LampLayout {
  spec: LampThreadSpec;
  connection: "integrated" | "collar";

  // ---- Base (de abajo hacia arriba)
  holderSeatZ: number;
  floorTopZ: number;
  /** Tope de la rosca: la cara plana de abajo del cuello apoya acá. */
  ledgeZ: number;
  baseTopZ: number;
  baseDiameterMm: number;
  baseDiameterAuto: boolean;
  fixing: FixingLayout;
  channelHalf: number;
  channelHeight: number;
  tie: TieLayout | null;
  ventSlots: number;
  seatR: number;

  // ---- Pantalla / collar
  neckTopZ: number;
  /** Altura de la transición de 45° y z donde arranca la parte decorativa. */
  flareH: number;
  decorZ0: number;
  shadeTopZ: number;
  collar: CollarLayout | null;

  holderR: number;
  bulbR: number;
  holderTopZ: number;
  bulbTopZ: number;
  insert: null | {
    outerR: number;
    innerR: number;
    heightMm: number;
    z0: number;
    z1: number;
    auto: boolean;
    tabLengthMm: number;
  };
  fit: LampFitReport;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const ceilTo = (n: number, step: number) => Math.ceil(n / step - 1e-9) * step;

export function computeLampLayout(def: LampDefinition, field: ShadeField): LampLayout {
  const g = LAMP_GEOMETRY;
  const { shade, thread, insert, base, holder, bulb, cable } = def;
  const spec = threadSpec(thread);
  const connection = thread.connection;
  const seatR = holder.bodyDiameterMm / 2 + g.holderFitClearanceMm;
  const holderR = holder.bodyDiameterMm / 2;
  const bulbR = bulb.diameterMm / 2;
  const R_b = shade.bottomDiameterMm / 2;

  // ---- Piso de la base y alojamiento de la espiga/tornillos
  const nutAF = holder.nutAcrossFlatsMm + 2 * g.nutPocketClearanceMm;
  const holderSeatZ = holder.fixingLengthMm + g.fixingTipMarginMm;
  const floorTopZ = holderSeatZ + g.holderSeatDepthMm;
  const maxWeb = holder.fixingLengthMm - holder.nutThicknessMm - g.fixingTipMarginMm;
  const webMm = Math.min(g.fixingWebMaxMm, maxWeb);
  const screws = holder.mount === "screws";
  const centers = screws ? [{ x: 0, y: -holder.screwSpacingMm / 2 }, { x: 0, y: holder.screwSpacingMm / 2 }] : [{ x: 0, y: 0 }];
  const fixing: FixingLayout = {
    mount: holder.mount,
    holeR: holder.fixingDiameterMm / 2 + g.fixingHoleClearanceMm,
    centers,
    nutPocketCircumR: nutAF / 2 / Math.cos(Math.PI / 6),
    nutPocketAcrossFlats: nutAF,
    pocketCeilingZ: holderSeatZ - webMm,
    webMm,
    cableHoleR: screws ? cable.diameterMm / 2 + 1.5 : null,
  };

  const ledgeZ = floorTopZ + g.ventSlotHeightMm + g.baseLedgeRoofMm;
  const baseTopZ = ledgeZ + spec.femaleDepth;
  const neckTopZ = ledgeZ + spec.neckLength;

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
    flareH = R_b - spec.rootR;
    decorZ0 = neckTopZ + flareH;
  }
  const shadeTopZ = decorZ0 + shade.heightMm;
  const holderTopZ = holderSeatZ + holder.heightMm;
  const bulbTopZ = holderTopZ + bulb.heightAboveHolderMm;

  const requiredInnerR = Math.max(bulbR, holderR) + insert.minBulbGapMm;

  // ---- Base: diámetro, canal de cable y anclaje del precinto
  const maxShadeD = 2 * field.maxOuterRadius;
  const autoBaseD = ceilTo(Math.max(2 * (spec.majorR + spec.clearance + g.baseOuterWallMm), 0.6 * maxShadeD, 0.3 * shadeTopZ), 5);
  const baseDiameterMm = base.diameterMm ?? autoBaseD;

  // ---- Inserto: automático = el MÁS ANGOSTO que respeta la separación a la bombilla/portalámparas (no el más ancho que cabe)
  let insertLayout: LampLayout["insert"] = null;
  let shadeClear: number | null = null;
  let removableFromTop: boolean | null = null;
  if (insert.enabled) {
    const z0 = floorTopZ - g.grooveDepthMm;
    const heightMm = round1((insert.heightPct / 100) * (shadeTopZ - z0));
    const z1 = z0 + heightMm;
    const tabLen = insert.tabs ? g.tabLengthMm : 0;
    const localTop = z1 - decorZ0;
    // Espacio libre exterior: el cuello (o el collar) y, si el inserto llega a la parte decorativa, su radio interior mínimo.
    let clearAll = spec.boreR - insert.clearanceMm;
    let clearTop = Infinity;
    if (localTop > 0) {
      clearAll = Math.min(clearAll, minInnerRadiusBetween(field, 0, localTop) - insert.clearanceMm);
      clearTop = minInnerRadiusBetween(field, localTop - g.tabThicknessMm, localTop) - insert.clearanceMm - tabLen;
    } else {
      clearTop = spec.boreR - insert.clearanceMm - tabLen; // inserto corto: sus lengüetas quedan dentro del cuello
    }
    shadeClear = Math.min(clearAll, clearTop);
    const auto = insert.diameterMm === null;
    const outerR = auto ? ceilTo(requiredInnerR + insert.thicknessMm, 0.25) : insert.diameterMm! / 2;
    insertLayout = { outerR, innerR: outerR - insert.thicknessMm, heightMm, z0, z1, auto, tabLengthMm: tabLen };
    removableFromTop = localTop >= shade.heightMm ? true : minInnerRadiusBetween(field, Math.max(localTop, 0), shade.heightMm) >= outerR + tabLen + insert.clearanceMm;
  }

  // ---- Cable
  const channelHalf = (cable.diameterMm + 1.5) / 2;
  const channelHeight = cable.diameterMm + 1 + (cable.tieAnchor ? g.tieStrapThicknessMm : 0);
  const grooveInnerR = insertLayout ? insertLayout.innerR - insert.clearanceMm : spec.boreR - 2;
  const tieRoom = grooveInnerR - seatR;
  const tie: TieLayout | null =
    cable.tieAnchor && tieRoom >= g.tieStrapWidthMm + 3
      ? { x: (seatR + grooveInnerR) / 2, halfX: g.tieStrapWidthMm / 2, y0: channelHalf - 0.5, y1: channelHalf + g.tieStrapThicknessMm }
      : null;

  const gapActual = insertLayout ? insertLayout.innerR - Math.max(bulbR, holderR) : null;
  const facts = threadFacts(spec);
  const threadReport: LampThreadReport = {
    connection,
    majorDiameterMm: round1(2 * spec.majorR),
    rootDiameterMm: round1(2 * spec.rootR),
    boreDiameterMm: round1(2 * spec.boreR),
    pitchMm: spec.pitch,
    starts: spec.starts,
    leadMm: round1(facts.leadMm),
    depthMm: Math.round(facts.depthMm * 100) / 100,
    engagementMm: spec.length,
    usefulEngagementMm: round1(spec.usefulEngagement),
    turnsToSeat: Math.round(facts.turnsToSeat * 10) / 10,
    radialClearanceMm: spec.clearance,
    normalClearanceMm: Math.round(facts.normalClearanceMm * 100) / 100,
    axialPlayMm: facts.axialPlayMm,
    femaleDepthMm: round1(spec.femaleDepth),
    stopFaceWidthMm: round1(spec.rootR - spec.boreR),
    flareHeightMm: round1(flareH),
    neckLengthMm: round1(spec.neckLength),
    baseWallMm: round1(baseDiameterMm / 2 - (spec.majorR + spec.clearance)),
  };

  const clearances: LampClearanceCheck[] = [];
  const add = (id: string, label: string, valueMm: number, minMm: number | null, soft = false) =>
    clearances.push({ id, label, valueMm: Math.round(valueMm * 100) / 100, minMm, status: minMm === null ? "info" : valueMm + 1e-6 >= minMm ? "ok" : soft ? "warn" : "fail" });
  add("threadRadial", "Rosca: holgura radial macho–hembra", spec.clearance, 0.2);
  add("threadNormal", "Rosca: holgura normal al flanco (45°)", facts.normalClearanceMm, null);
  add("threadCore", "Cuello: espesor bajo la raíz de la rosca", thread.coreWallMm, 2);
  add("baseWall", "Base: pared alrededor de la rosca", threadReport.baseWallMm, g.baseMinOuterWallMm);
  add("holderCavity", "Portalámparas – cavidad de la base (radial)", spec.boreR - holderR, 1.5);
  if (insertLayout) {
    add("insertShade", "Inserto – cuello/pantalla (radial, con lengüetas)", (shadeClear ?? 0) - insertLayout.outerR + insert.clearanceMm, insert.clearanceMm);
    add("insertBulb", "Inserto – bombilla/portalámparas (radial)", gapActual ?? 0, Math.max(insert.minBulbGapMm, g.bulbGapFloorMm));
  }
  add("fixingWeb", "Apoyo del portalámparas – techo del alojamiento de la tuerca", webMm, g.fixingWebMinMm);

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
    shadeClearRadiusMm: shadeClear === null ? null : round1(shadeClear),
    requiredInsertInnerRadiusMm: round1(requiredInnerR),
    insertBulbGapMm: gapActual === null ? null : round1(gapActual),
    insertRemovableFromTop: removableFromTop,
    baseDiameterMm,
    baseHeightMm: baseTopZ,
    floorTopZ,
    fixingWebMm: round1(webMm),
    thread: threadReport,
    clearances,
  };

  return {
    spec,
    connection,
    holderSeatZ,
    floorTopZ,
    ledgeZ,
    baseTopZ,
    baseDiameterMm,
    baseDiameterAuto: base.diameterMm === null,
    fixing,
    channelHalf,
    channelHeight,
    tie,
    ventSlots: Math.round(base.ventSlots),
    seatR,
    neckTopZ,
    flareH,
    decorZ0,
    shadeTopZ,
    collar,
    holderR,
    bulbR,
    holderTopZ,
    bulbTopZ,
    insert: insertLayout,
    fit,
  };
}
