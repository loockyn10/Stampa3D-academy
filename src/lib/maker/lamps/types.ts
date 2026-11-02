import type { LetterGeometryResult } from "@/lib/maker/types";
import type { IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

/**
 * Lámparas E27 (Stampa Maker). `LampDefinition` es la ÚNICA fuente de verdad: la UI y los presets solo editan este
 * objeto; la geometría sale exclusivamente de `createLamp`. Piezas independientes: pantalla (con cuello roscado macho,
 * o lisa + collar roscado para modo vaso), inserto de color y base con rosca hembra y alojamiento para un portalámparas
 * E27 comercial (que NUNCA se imprime). La interfaz roscada (`thread`) es independiente de la decoración de la pantalla.
 */
export type LampFamily = "wavy" | "spiral" | "organic";
export type LampProfile = "straight" | "barrel" | "waist" | "bell" | "tulip";

export interface LampShadeDef {
  family: LampFamily;
  /** Altura de la parte decorativa (sobre el cuello roscado y la transición de 45°). */
  heightMm: number;
  /** Diámetro exterior del tramo recto inferior de la parte decorativa (arranque del perfil). Debe ser mayor que la raíz de la rosca. */
  bottomDiameterMm: number;
  topDiameterMm: number;
  profile: LampProfile;
  /** 0–100: cuánto se aparta el perfil de la recta (abombado/cintura, exponente de la campana, mezcla S del tulipán). */
  profileAmountPct: number;
  /** Cantidad de ondas alrededor (entero). */
  waves: number;
  /** Desvío radial máximo de la onda (mm). */
  amplitudeMm: number;
  /** Giro total de las ondas entre el collar y el borde superior (grados, con signo). */
  twistDeg: number;
  /** Ciclos de variación vertical de la amplitud a lo alto de la pantalla (0 = ninguna). */
  verticalFrequency: number;
  /** 0–100: cuánto modula la variación vertical a las ondas (0 = ondas puras). */
  patternIntensityPct: number;
  /** 0–100: peso de los términos orgánicos (solo familia "organic"). */
  organicPct: number;
  /** Semilla reproducible de los términos orgánicos. */
  seed: number;
  /** Espesor del sólido (mm). En modo vaso la pared real es el ancho de extrusión del laminador. */
  wallMm: number;
  /** Altura del tramo recto inferior (mm): un anillo circular exacto antes de que nazca la ondulación (en modo collar es el que entra al encastre). */
  collarHeightMm: number;
}

/** Tipo de pantalla exterior: sólida (ondas, motor de superficie) o calada (estructura abierta de tiras: aberturas reales en la malla). */
export type LampShadeType = "solid" | "openwork" | "double";
export type OpenworkPattern = "diamond" | "spiral";
/** Terminación superior: anillo continuo (recomendado) o tiras cortadas a ras del borde (puntas sin soporte). */
export type OpenworkTop = "ring" | "open";

/**
 * Pantalla CALADA. La altura total, el diámetro inferior y el superior se comparten con la pantalla sólida (`LampShadeDef`):
 * así alternar entre tipos conserva las dimensiones. La sección horizontal es siempre un círculo; la silueta (motor compartido
 * por todos los patrones) solo decide el radio a cada altura y el patrón decide qué parte de esa superficie es material.
 */
export interface LampOpenworkDef {
  pattern: OpenworkPattern;
  // ---- Silueta (compartida por todos los patrones)
  /** Diámetro máximo del abombado (si es menor que el mayor de los extremos, no hay abombado). */
  maxDiameterMm: number;
  /** Altura relativa (0-100 %) del ensanchamiento y de la cintura. */
  bulgePositionPct: number;
  /** 0-100: cuán angosto/pronunciado es el abombado y la cintura (0 = amplio y suave). */
  curvaturePct: number;
  /** 0-100: intensidad de la cintura (estrechamiento en la posición indicada). */
  waistPct: number;
  /** 0-100: cambios suaves de diámetro a distintas alturas (silueta orgánica) y su semilla. */
  organicPct: number;
  seed: number;
  /** Torsión general (grados, con signo): giro del patrón entre la base y el borde superior. */
  twistDeg: number;
  // ---- Estructura (comunes)
  /** Ancho de las tiras sobre la superficie (mm), medido perpendicular a su eje. */
  stripWidthMm: number;
  /** Profundidad radial de las tiras (espesor de la pantalla en la dirección normal a la superficie, mm). */
  depthMm: number;
  /** Altura del anillo inferior continuo (de la unión al arranque de las tiras) y del superior (mm). */
  bottomRingMm: number;
  topRingMm: number;
  topFinish: OpenworkTop;
  /** Variación de la inclinación a lo alto: intensidad (0-70 %) y ciclos. */
  variationPct: number;
  variationCycles: number;
  // ---- Diamante
  /** Rombos alrededor (densidad horizontal). */
  divisions: number;
  /** Inclinación de las diagonales respecto de la horizontal (grados): 45° = rombos casi cuadrados, más = alargados. */
  inclinationDeg: number;
  /** Desplazamiento de fase del patrón (grados, 0-360). */
  phaseDeg: number;
  // ---- Espiral
  /** Bandas helicoidales en paralelo y vueltas que da cada una entre la base y el borde (con signo = sentido). */
  bands: number;
  turns: number;
  /** Anillos intermedios de unión entre bandas (0 = sin conexiones) y su ancho (mm). */
  connectors: number;
  connectorWidthMm: number;
  // ---- Difusor (inserto) de la pantalla calada
  /** "rings": el difusor cilíndrico se dimensiona por el diámetro INTERIOR LIBRE de los anillos (no por el decorativo máximo). "manual": se usa `insert.diameterMm` como en la sólida. */
  diffuserFit: "rings" | "manual";
  /** Holgura DIAMETRAL inicial entre el difusor y el anillo más angosto (mm). Se valida físicamente: no es un valor probado. */
  diffuserClearanceMm: number;
}

/**
 * Pantalla de DOBLE PARED (impresión convencional): dos paredes concéntricas de siluetas independientes, unidas abajo por un piso
 * macizo y arriba por un techo inclinado, con la abertura central (bombilla, portalámparas y difusor) libre. La altura y los
 * diámetros inferior y superior de la pared EXTERIOR se comparten con las otras pantallas (`LampShadeDef`); acá van el resto.
 */
export interface LampDoubleWallDef {
  // ---- Pared exterior (silueta abombada + estrías/ondulaciones + torsión)
  /** Diámetro máximo de las crestas (si es menor o igual que el de los extremos, la pared es cilíndrica/cónica). */
  maxDiameterMm: number;
  bulgePositionPct: number;
  curvaturePct: number;
  /** Estrías u ondulaciones (cantidad entera), profundidad cresta–valle (mm) y torsión total (grados). */
  flutes: number;
  fluteAmplitudeMm: number;
  twistDeg: number;
  // ---- Pared interior (cilíndrica si los dos diámetros coinciden, cónica si no, reloj de arena con cintura, orgánica)
  innerBottomDiameterMm: number;
  innerTopDiameterMm: number;
  innerWaistPct: number;
  innerWaistPositionPct: number;
  innerCurvaturePct: number;
  innerOrganicPct: number;
  innerSeed: number;
  // ---- Cámara y uniones
  /** Separación mínima exigida entre las caras de la cámara de las dos paredes (mm), medida sobre las superficies reales. */
  minGapMm: number;
  /** Espesor de las dos paredes (mm). */
  wallMm: number;
  /** Piso que une las paredes abajo, zona donde se inclinan una hacia la otra arriba, rim superior y ancho final de la cámara (mm). */
  floorMm: number;
  roofHeightMm: number;
  roofCapMm: number;
  topGapMm: number;
  /** "closed": un cielorraso cierra la cámara (cavidad interna de aire); "open": la cámara termina arriba en una ranura de `topGapMm`. */
  chamber: "closed" | "open";
  /** Modalidad de fabricación. Solo "conventional": el modo jarrón sigue experimental y no se ofrece (ver docs/STAMPA_MAKER_DOUBLE_WALL.md). */
  fabrication: "conventional";
  // ---- Difusor (inserto)
  diffuserFit: "rings" | "manual";
  diffuserClearanceMm: number;
}

/** Familias de inserto: tapa plana (cerrado, se imprime invertido), gota (cierre ojival, se imprime parado) y ondulado (superficie lateral ondulada, abierto o con tapa). */
export type LampInsertStyle = "flat" | "drop" | "wavy";
export type LampInsertTop = "open" | "flat";

export interface LampInsertDef {
  enabled: boolean;
  /** Familia del inserto. La interfaz de montaje inferior (tubo liso Ø exterior que apoya en la ranura de la torre) es la MISMA en las tres. */
  style: LampInsertStyle;
  /** Diámetro EXTERIOR nominal del cilindro (referencia impresa: Ø65). null = automático: el más angosto que respeta `minBulbGapMm`. */
  diameterMm: number | null;
  /** Altura TOTAL del inserto en mm, contada desde su borde inferior (dentro de la ranura) hasta su extremo superior. null = automática (`heightPct` de la altura disponible). */
  heightMm: number | null;
  /** Altura automática como % de la altura disponible (desde el asiento de la base hasta el borde de la pantalla). Solo se usa con `heightMm = null`. */
  heightPct: number;
  thicknessMm: number;
  /** Holgura de montaje por lado (mm) entre el cilindro y su ranura de la base / el cuello roscado y la pantalla. */
  clearanceMm: number;
  /** Profundidad de la ranura anular de la base donde apoya el borde inferior del cilindro (referencia: 10 mm). */
  seatDepthMm: number;
  /** Separación radial MÍNIMA exigida entre la bombilla (o el cuerpo del portalámparas) y el cilindro: evita el contacto previsto con las medidas cargadas. NO es una distancia térmicamente segura. */
  minBulbGapMm: number;
  /** Dos lengüetas exteriores en el borde superior (para extraer el inserto). Solo con extremo superior abierto (ondulado abierto). Obliga a impresión convencional. */
  tabs: boolean;
  /** Plano y ondulado con tapa: espesor de la tapa plana (unión a 90° con la pared). */
  capThicknessMm: number;
  /** Gota: altura del cierre (la sección cilíndrica es la altura total menos esta), curvatura (0 = cono recto, 100 = ojiva tangente al cilindro) y radio de la punta redondeada. */
  dropClosureMm: number;
  dropCurvaturePct: number;
  dropTipRadiusMm: number;
  /** Ondulado: ondas alrededor, amplitud (la onda SOLO suma hacia afuera: el interior nunca se acerca más a la bombilla que el tubo liso), torsión total (grados), frecuencia vertical y terminación superior. */
  waves: number;
  amplitudeMm: number;
  twistDeg: number;
  verticalFrequency: number;
  wavyTop: LampInsertTop;
  /** Color de la VISTA PREVIA (#rrggbb). No es geometría ni simula la luz real. */
  previewColor: string;
}

/**
 * Interfaz mecánica pantalla–base (rosca de StampaMaker, NO la rosca eléctrica E27 de la bombilla). Es estándar y
 * propia: cualquier pantalla que comparta estos valores encaja en cualquier base que los comparta. Cambiar ondas,
 * torsión o patrón no la modifica.
 */
export interface LampThreadDef {
  /** "integrated": el cuello roscado macho es parte de la pantalla (impresión convencional). "collar": la pantalla queda lisa (modo vaso posible) y un collar roscado aparte la une a la base. */
  connection: "integrated" | "collar";
  /** Diámetro exterior (cresta) de la rosca macho. */
  majorDiameterMm: number;
  /** Paso de cada filete (mm). El avance por vuelta es paso × entradas. */
  pitchMm: number;
  /** Cantidad de entradas (filetes en paralelo): más entradas = menos vueltas para cerrar. */
  starts: number;
  /** Longitud roscada del macho (incluye la entrada y la salida del filete). */
  engagementMm: number;
  /** Holgura radial entre la rosca macho y la hembra (mm). */
  clearanceMm: number;
  /** Espesor del cuello macho por debajo de la raíz de la rosca (mm). */
  coreWallMm: number;
}

/** Reborde anular INTERNO de adhesión en el extremo inferior de la pieza roscada (pantalla, o collar): más superficie contra la cama sin balsa. Permanente, forma parte del STL. */
export interface LampAdhesionDef {
  enabled: boolean;
  /** Extensión radial hacia el eje desde el orificio del cuello (mm). */
  widthMm: number;
  /** Espesor del reborde (mm): normalmente 1-2 capas. */
  heightMm: number;
}

export interface LampBaseDef {
  /** null = automático (rosca + pared). */
  diameterMm: number | null;
}

/**
 * Medidas del portalámparas E27 comercial de CUERPO ROSCADO Y DOS ANILLOS DE SUJECIÓN (el tipo que usa la lámpara de
 * referencia). E27 describe la rosca de la bombilla, NO las dimensiones exteriores del portalámparas: los valores salen de
 * las medidas dadas por el usuario y del STL de referencia `bottom.stl`, y siguen pendientes de validación física
 * (`measured`). La posición axial de los anillos y el lado por el que se montan son datos del STL, no verificados.
 */
export interface LampHolderDef {
  /** true = el usuario verificó estas medidas con su portalámparas real. false = geometría PRELIMINAR NO VALIDADA. */
  measured: boolean;
  /** Diámetro del agujero central pasante de la torre (nominal del usuario: Ø42; el STL de referencia mide Ø40,9). */
  boreDiameterMm: number;
  /** Diámetro máximo de los anillos de sujeción (nominal: Ø58). El rebaje superior de la torre = este diámetro + 2 × holgura. */
  ringsDiameterMm: number;
  /** Holgura radial del rebaje respecto de los anillos (STL: 0,9 mm por lado). */
  ringsClearanceMm: number;
  /** Profundidad del rebaje de los anillos (STL: 5,15 mm). */
  ringsRecessDepthMm: number;
  /** Altura, desde la mesa, del piso del rebaje donde apoyan los anillos / el collar del portalámparas (STL: 31,4 mm). */
  seatHeightMm: number;
  /** Diámetro del cuerpo del portalámparas por encima de la base (dato a medir; se usa para separaciones). */
  bodyDiameterMm: number;
  /** Desde el apoyo hasta el borde superior del portalámparas (donde entra la bombilla). */
  heightMm: number;
}

export interface LampBulbDef {
  diameterMm: number;
  /** Alto de la bombilla por encima del borde superior del portalámparas. */
  heightAboveHolderMm: number;
}

export interface LampCableDef {
  diameterMm: number;
  /** Ranuras para una abrazadera plástica (precinto) comercial que sujeta el cable: alivio de tensión. */
  tieAnchor: boolean;
}

export interface LampDefinition {
  version: 2;
  /** Tipo de pantalla activo. `shade` y `openwork` conviven en la definición: alternar entre tipos no pierde los parámetros del otro. */
  shadeType: LampShadeType;
  shade: LampShadeDef;
  openwork: LampOpenworkDef;
  /** Parámetros de la pantalla de doble pared (conviven con los de las otras: alternar de tipo no los pierde). */
  doubleWall: LampDoubleWallDef;
  thread: LampThreadDef;
  insert: LampInsertDef;
  base: LampBaseDef;
  adhesion: LampAdhesionDef;
  holder: LampHolderDef;
  bulb: LampBulbDef;
  cable: LampCableDef;
}

export type LampIssueSeverity = "error" | "warning";

export interface LampIssue {
  code: string;
  message: string;
  /** Campo de la definición al que apunta (`shade.waves`, `insert.thicknessMm`...). */
  field?: string;
}

/** Verificación de los prerrequisitos GEOMÉTRICOS del modo vaso (spiral vase). No reemplaza abrir el STL en el laminador. */
export interface LampVaseReport {
  ready: boolean;
  /** Ángulo máximo de la pared respecto de la vertical (0° = pared vertical). */
  maxOverhangDeg: number;
  reasons: string[];
}

export interface LampPartMetrics {
  triangleCount: number;
  volumeCm3: number;
  /** Cerrada + manifold + orientada, sin triángulos degenerados. */
  watertight: boolean;
  boundingBox: { width: number; depth: number; height: number };
}

/** Resumen de la interfaz roscada ya resuelta (todos los valores salen de la misma función que genera las mallas). */
export interface LampThreadReport {
  connection: "integrated" | "collar";
  majorDiameterMm: number;
  rootDiameterMm: number;
  boreDiameterMm: number;
  pitchMm: number;
  starts: number;
  leadMm: number;
  depthMm: number;
  /** Longitud roscada del macho (con entrada y salida del filete) y tramo de profundidad completa. */
  engagementMm: number;
  usefulEngagementMm: number;
  /** Vueltas desde que el filete toca hasta el tope. */
  turnsToSeat: number;
  radialClearanceMm: number;
  /** Holgura medida en la dirección normal al flanco (45°). */
  normalClearanceMm: number;
  /** Juego axial total entre flancos (macho flojo en la hembra). */
  axialPlayMm: number;
  femaleDepthMm: number;
  /** Ancho del anillo plano del cuello que apoya en el tope de la base. */
  stopFaceWidthMm: number;
  /** Altura de la transición de 45° entre el cuello y la parte decorativa. */
  flareHeightMm: number;
  /** Largo del cuello liso + roscado, medido desde el tope. */
  neckLengthMm: number;
  /** Material de la base alrededor de la rosca hembra (mm, radial). */
  baseWallMm: number;
}

/** Una cota del ensamblaje con su mínimo exigido (cuando lo hay). `status` compara contra el mínimo de DISEÑO, no contra uno térmico. */
export interface LampClearanceCheck {
  id: string;
  label: string;
  valueMm: number;
  minMm: number | null;
  status: "ok" | "warn" | "fail" | "info";
}

/** Torre central de la base (alojamiento del portalámparas y del cilindro), todo ya resuelto desde la definición. */
export interface LampTowerReport {
  boreDiameterMm: number;
  ringsRecessDiameterMm: number;
  ringsRecessDepthMm: number;
  /** Altura (desde la mesa) del piso del rebaje y de la cara superior de la torre. */
  seatZ: number;
  topZ: number;
  /** Material macizo bajo el piso del rebaje (donde se aprietan los anillos). */
  seatMaterialMm: number;
  towerDiameterMm: number;
  /** Ranura anular del cilindro: diámetros interior y exterior y profundidad. */
  slotInnerDiameterMm: number;
  slotOuterDiameterMm: number;
  slotDepthMm: number;
  /** Paredes de la torre: entre el rebaje y la ranura, y entre la ranura y el exterior. */
  innerWallMm: number;
  outerWallMm: number;
  /** Radial, entre los anillos y el interior del cilindro. */
  ringsToInsertGapMm: number | null;
  /** Radial, entre la torre y el orificio del cuello roscado (cavidad anular de ventilación). */
  towerToNeckGapMm: number;
}

/** Cómo se dimensionó el difusor de una pantalla calada (todo sale del mismo cálculo que genera la malla). */
export interface LampDiffuserFitReport {
  source: "rings" | "manual";
  /** Diámetros interiores LIBRES (cara interior de la estructura, no el exterior) de los anillos inferior y superior de la pantalla. */
  ringBottomFreeDiameterMm: number;
  ringTopFreeDiameterMm: number;
  /** Diámetro interior libre mínimo de TODA la pantalla (la estructura decorativa incluida). */
  structureMinFreeDiameterMm: number;
  /** Máximo diámetro de difusor que admite la base: torre central + 3 mm de aire hasta el orificio del cuello roscado. */
  baseLimitDiameterMm: number;
  diffuserDiameterMm: number;
  /** Holgura diametral pedida y holguras radiales reales del difusor en cada anillo. */
  diametralClearanceMm: number;
  radialClearanceBottomMm: number;
  radialClearanceTopMm: number;
  limitedBy: "bottomRing" | "topRing" | "opening" | "base" | "manual";
}

/** Cifras de la pantalla de doble pared, medidas sobre las mismas superficies que se mallan. */
export interface LampDoubleWallReport {
  /** Separación mínima entre las caras de la cámara (3D, estrías incluidas) y su altura; la exigida. */
  minGapMm: number;
  minGapAtZ: number;
  requiredGapMm: number;
  /** Inclinación máxima de las caras (grados desde la vertical) y su altura. */
  maxLeanDeg: number;
  maxLeanAtZ: number;
  /** Alturas locales (desde el borde inferior de la parte decorativa): tope del piso, arranque del techo y cielorraso. */
  floorTopMm: number;
  roofStartMm: number;
  ceilingMm: number;
  /** Abertura central: diámetro libre mínimo (cintura), en el borde inferior y en el superior. */
  openingMinDiameterMm: number;
  openingBottomDiameterMm: number;
  openingTopDiameterMm: number;
  /** Cámara cerrada = cavidad interna. `cavities` y `solidBodies` se miden sobre la malla (1 cuerpo; 1 cavidad si está cerrada). */
  chamberClosed: boolean;
  solidBodies: number;
  cavities: number;
}



export interface LampAdhesionReport {
  enabled: boolean;
  widthMm: number;
  heightMm: number;
  /** Radio exterior (= orificio del cuello) e interior del reborde. */
  outerRadiusMm: number;
  innerRadiusMm: number;
  /** Ancho máximo que no interfiere con el resto del ensamblaje, con la holgura de diseño. */
  availableWidthMm: number;
  /** Radial, entre el borde interior del reborde y lo que queda más cerca (torre o inserto). */
  clearanceMm: number;
  limitedBy: "tower" | "insert";
  /** Anillo plano que apoya en la cama sin / con reborde (mm²), calculado del mismo layout. */
  contactAreaMm2: number;
  contactAreaWithoutMm2: number;
}

export interface LampFitReport {
  /** Z (ensamblado, base en 0) del tope de la rosca, de la parte decorativa, del inserto y del borde superior. */
  shadeBottomZ: number;
  /** Z donde arranca la parte decorativa (sobre el cuello y la transición). */
  decorBottomZ: number;
  shadeTopZ: number;
  insertBottomZ: number | null;
  insertTopZ: number | null;
  holderTopZ: number;
  bulbTopZ: number;
  /** Diámetro exterior efectivo del inserto (mm) y si salió del modo automático. */
  insertOuterDiameterMm: number | null;
  insertInnerDiameterMm: number | null;
  insertAuto: boolean;
  /** Radio libre mínimo (cuello, transición y pantalla) a la altura del inserto, para explicar por qué no entra. */
  shadeClearRadiusMm: number | null;
  /** Radio interior mínimo necesario para respetar la separación de diseño a la bombilla. */
  requiredInsertInnerRadiusMm: number;
  /** Separación radial real entre el inserto y la bombilla/portalámparas. */
  insertBulbGapMm: number | null;
  /** El inserto sale por la abertura superior sin desmontar la pantalla. */
  insertRemovableFromTop: boolean | null;
  /** Familia del inserto, diámetro MÁXIMO (con ondas y sin lengüetas), altura total efectiva y si el extremo superior está cerrado. */
  insertStyle: LampInsertStyle | null;
  insertMaxDiameterMm: number | null;
  insertHeightMm: number | null;
  insertClosed: boolean;
  /** Distancia GEOMÉTRICA mínima entre la cara interior del inserto (cierre incluido) y la envolvente de la bombilla/portalámparas. */
  insertEnvelopeGapMm: number | null;
  /** Reborde interno de adhesión ya resuelto. */
  adhesion: LampAdhesionReport;
  /** Solo con pantalla calada: dimensionado del difusor según los anillos. */
  diffuser: LampDiffuserFitReport | null;
  /** Diámetro de la base (efectivo) y su altura total. */
  baseDiameterMm: number;
  baseHeightMm: number;
  /** Cara superior del piso de la base (la cavidad anular empieza acá). */
  floorTopZ: number;
  tower: LampTowerReport;
  thread: LampThreadReport;
  clearances: LampClearanceCheck[];
}

/** Cifras de la pantalla calada, medidas sobre la MISMA grilla que se malla (no sobre los parámetros). */
export interface OpenworkReport {
  pattern: OpenworkPattern;
  /** Columnas y filas de la grilla, tamaño de celda y si la grilla quedó más gruesa que lo recomendado por el presupuesto de malla. */
  columns: number;
  rows: number;
  cellMm: number;
  coarse: boolean;
  /** % de la zona de tiras que es abertura real. */
  aperturePct: number;
  /** Abertura mínima (diámetro del mayor círculo que cabe) y máxima, entre tiras vecinas. */
  minOpeningMm: number;
  maxOpeningMm: number;
  /** Ángulo máximo de una tira respecto de la vertical (inclinación de su cara inferior) y de la pared de la silueta. */
  maxStripLeanDeg: number;
  maxSurfaceTiltDeg: number;
  /** Diámetro mínimo y máximo de la silueta. */
  minDiameterMm: number;
  maxDiameterMm: number;
  /** Diamante: rombos alrededor y filas de rombos a lo alto. Espiral: bandas, vueltas y paso entre bandas. */
  diamondsAround: number | null;
  diamondRows: number | null;
  bandGapMm: number | null;
  /** Triángulos EXACTOS de la parte calada (anillos y tiras, pieles y paredes de corte), contados sobre la misma grilla antes de mallar. El cuello roscado suma aparte. */
  latticeTriangles: number;
}

export interface LampMetrics {
  /** Solo con pantalla de doble pared. */
  doubleWall: LampDoubleWallReport | null;
  totalHeightMm: number;
  maxDiameterMm: number;
  shade: LampPartMetrics & { vase: LampVaseReport; maxTiltDeg: number; minRidgeRadiusMm: number | null };
  /** Solo con pantalla calada: cifras de la estructura y componentes conexas de la malla de la pantalla (1 = pieza única conectada). */
  openwork: (OpenworkReport & { components: number }) | null;
  insert: (LampPartMetrics & { vaseCapable: boolean }) | null;
  /** Collar roscado independiente (solo con conexión "collar"). */
  collar: LampPartMetrics | null;
  base: LampPartMetrics;
  totalTriangles: number;
  /** Tiempo de generación (ms) de esta llamada (0 si todas las piezas salieron del cache). */
  generationMs: number;
  fit: LampFitReport;
}

export interface LampResult {
  /** Piezas listas para MakerViewport / Vista Cama / STL: base ("body"), inserto ("lampInsert"), collar ("lampCollar") y pantalla ("lampShade"). null si hay errores. */
  geometry: LetterGeometryResult | null;
  /** Mallas indexadas por pieza (tests y chequeos topológicos). */
  indexed: { base: IndexedMesh; insert: IndexedMesh | null; collar: IndexedMesh | null; shade: IndexedMesh } | null;
  metrics: LampMetrics | null;
  errors: LampIssue[];
  warnings: LampIssue[];
}

/** Límites de cada campo numérico: los usa la validación y la UI. */
export interface FieldLimit {
  min: number;
  max: number;
  integer?: boolean;
  label: string;
}

export const LAMP_LIMITS = {
  "shade.heightMm": { min: 60, max: 400, label: "Altura de la pantalla" },
  "shade.bottomDiameterMm": { min: 60, max: 300, label: "Diámetro inferior" },
  "shade.topDiameterMm": { min: 40, max: 300, label: "Diámetro superior" },
  "shade.profileAmountPct": { min: 0, max: 100, label: "Intensidad del perfil" },
  "shade.waves": { min: 2, max: 32, integer: true, label: "Ondas" },
  "shade.amplitudeMm": { min: 0, max: 25, label: "Amplitud" },
  "shade.twistDeg": { min: -1440, max: 1440, label: "Torsión" },
  "shade.verticalFrequency": { min: 0, max: 8, label: "Frecuencia vertical" },
  "shade.patternIntensityPct": { min: 0, max: 100, label: "Intensidad del patrón" },
  "shade.organicPct": { min: 0, max: 100, label: "Variación orgánica" },
  "shade.seed": { min: 0, max: 4294967295, integer: true, label: "Semilla" },
  "shade.wallMm": { min: 0.6, max: 3, label: "Espesor de pared" },
  "shade.collarHeightMm": { min: 6, max: 40, label: "Altura del tramo recto" },
  "thread.majorDiameterMm": { min: 80, max: 200, label: "Diámetro de la rosca" },
  "thread.pitchMm": { min: 3, max: 8, label: "Paso de la rosca" },
  "thread.starts": { min: 1, max: 4, integer: true, label: "Entradas de la rosca" },
  "thread.engagementMm": { min: 8, max: 30, label: "Longitud roscada" },
  "thread.clearanceMm": { min: 0.2, max: 0.8, label: "Holgura de la rosca" },
  "thread.coreWallMm": { min: 2, max: 8, label: "Espesor del cuello" },
  "insert.heightPct": { min: 30, max: 95, label: "Altura automática del inserto" },
  "insert.thicknessMm": { min: 0.4, max: 3, label: "Espesor del inserto" },
  "insert.capThicknessMm": { min: 0.8, max: 5, label: "Espesor de la tapa" },
  "insert.dropClosureMm": { min: 10, max: 160, label: "Altura del cierre" },
  "insert.dropCurvaturePct": { min: 0, max: 100, label: "Curvatura del cierre" },
  "insert.dropTipRadiusMm": { min: 1.5, max: 30, label: "Redondeo de la punta" },
  "insert.waves": { min: 2, max: 32, integer: true, label: "Ondas del inserto" },
  "insert.amplitudeMm": { min: 0, max: 12, label: "Amplitud del inserto" },
  "insert.twistDeg": { min: -720, max: 720, label: "Torsión del inserto" },
  "insert.verticalFrequency": { min: 0, max: 6, label: "Frecuencia vertical del inserto" },
  "openwork.maxDiameterMm": { min: 60, max: 320, label: "Diámetro máximo" },
  "openwork.bulgePositionPct": { min: 10, max: 90, label: "Posición del ensanchamiento" },
  "openwork.curvaturePct": { min: 0, max: 100, label: "Curvatura" },
  "openwork.waistPct": { min: 0, max: 100, label: "Intensidad de la cintura" },
  "openwork.organicPct": { min: 0, max: 100, label: "Variación orgánica" },
  "openwork.seed": { min: 0, max: 4294967295, integer: true, label: "Semilla" },
  "openwork.twistDeg": { min: -1440, max: 1440, label: "Torsión" },
  "openwork.stripWidthMm": { min: 0.8, max: 14, label: "Ancho de las tiras" },
  "openwork.depthMm": { min: 0.8, max: 8, label: "Profundidad de las tiras" },
  "openwork.bottomRingMm": { min: 4, max: 40, label: "Anillo inferior" },
  "openwork.topRingMm": { min: 3, max: 40, label: "Anillo superior" },
  "openwork.variationPct": { min: 0, max: 70, label: "Variación de inclinación" },
  "openwork.variationCycles": { min: 0, max: 6, label: "Ciclos de la variación" },
  "openwork.divisions": { min: 3, max: 48, integer: true, label: "Divisiones alrededor" },
  "openwork.inclinationDeg": { min: 20, max: 75, label: "Inclinación de las diagonales" },
  "openwork.phaseDeg": { min: 0, max: 360, label: "Desplazamiento de fase" },
  "openwork.bands": { min: 1, max: 24, integer: true, label: "Cantidad de bandas" },
  "openwork.turns": { min: -8, max: 8, label: "Vueltas" },
  "openwork.connectors": { min: 0, max: 8, integer: true, label: "Anillos de unión" },
  "openwork.connectorWidthMm": { min: 1, max: 10, label: "Ancho de los anillos de unión" },
  "openwork.diffuserClearanceMm": { min: 0.7, max: 10, label: "Holgura diametral del difusor" },
  "doubleWall.maxDiameterMm": { min: 60, max: 340, label: "Diámetro máximo de la pared exterior" },
  "doubleWall.bulgePositionPct": { min: 10, max: 90, label: "Posición del ensanchamiento" },
  "doubleWall.curvaturePct": { min: 0, max: 100, label: "Curvatura de la pared exterior" },
  "doubleWall.flutes": { min: 3, max: 48, integer: true, label: "Estrías" },
  "doubleWall.fluteAmplitudeMm": { min: 0, max: 12, label: "Profundidad de las estrías" },
  "doubleWall.twistDeg": { min: -1440, max: 1440, label: "Torsión" },
  "doubleWall.innerBottomDiameterMm": { min: 40, max: 300, label: "Diámetro inferior de la pared interior" },
  "doubleWall.innerTopDiameterMm": { min: 40, max: 300, label: "Diámetro superior de la pared interior" },
  "doubleWall.innerWaistPct": { min: 0, max: 100, label: "Intensidad de la cintura" },
  "doubleWall.innerWaistPositionPct": { min: 10, max: 90, label: "Posición de la cintura" },
  "doubleWall.innerCurvaturePct": { min: 0, max: 100, label: "Curvatura de la pared interior" },
  "doubleWall.innerOrganicPct": { min: 0, max: 100, label: "Variación orgánica de la pared interior" },
  "doubleWall.innerSeed": { min: 0, max: 4294967295, integer: true, label: "Semilla de la pared interior" },
  "doubleWall.minGapMm": { min: 5, max: 100, label: "Separación mínima entre paredes" },
  "doubleWall.wallMm": { min: 0.8, max: 4, label: "Espesor de las paredes" },
  "doubleWall.floorMm": { min: 1.2, max: 10, label: "Espesor del piso" },
  "doubleWall.roofHeightMm": { min: 8, max: 80, label: "Altura del techo inclinado" },
  "doubleWall.roofCapMm": { min: 1.2, max: 10, label: "Rim superior" },
  "doubleWall.topGapMm": { min: 0.8, max: 10, label: "Ancho final de la cámara" },
  "doubleWall.diffuserClearanceMm": { min: 0.7, max: 10, label: "Holgura diametral del difusor" },
  "adhesion.widthMm": { min: 1, max: 10, label: "Ancho del reborde" },
  "adhesion.heightMm": { min: 0.2, max: 1.2, label: "Altura del reborde" },
  "insert.clearanceMm": { min: 0.3, max: 2, label: "Holgura de montaje" },
  "insert.seatDepthMm": { min: 3, max: 20, label: "Profundidad de la ranura del cilindro" },
  "insert.minBulbGapMm": { min: 0.5, max: 40, label: "Separación mínima a la bombilla" },
  "holder.boreDiameterMm": { min: 30, max: 60, label: "Agujero central del portalámparas" },
  "holder.ringsDiameterMm": { min: 40, max: 75, label: "Diámetro de los anillos de sujeción" },
  "holder.ringsClearanceMm": { min: 0.3, max: 2, label: "Holgura del rebaje de los anillos" },
  "holder.ringsRecessDepthMm": { min: 2, max: 15, label: "Profundidad del rebaje de los anillos" },
  "holder.seatHeightMm": { min: 12, max: 80, label: "Altura del apoyo de los anillos" },
  "holder.bodyDiameterMm": { min: 20, max: 80, label: "Diámetro del cuerpo del portalámparas" },
  "holder.heightMm": { min: 20, max: 120, label: "Altura del portalámparas" },
  "bulb.diameterMm": { min: 30, max: 120, label: "Diámetro de la bombilla" },
  "bulb.heightAboveHolderMm": { min: 40, max: 200, label: "Alto de la bombilla sobre el portalámparas" },
  "cable.diameterMm": { min: 3, max: 12, label: "Diámetro del cable" },
} as const satisfies Record<string, FieldLimit>;

export type LampLimitKey = keyof typeof LAMP_LIMITS;

/** Constantes geométricas fijas del sistema de encastre (no son parámetros del usuario). */
export const LAMP_GEOMETRY = {
  /** Torre central de la base (STL de referencia): pared exterior entre la ranura del cilindro y el exterior de la torre. */
  towerOuterWallMm: 2,
  /** Pared mínima (error) y recomendada (aviso) entre el rebaje de los anillos y la ranura del cilindro, y bajo la ranura. */
  towerMinWallMm: 1.2,
  towerWarnWallMm: 1.6,
  towerFloorBelowSlotMm: 3,
  /** Holgura mínima entre los anillos del portalámparas y el interior del cilindro. */
  ringsToInsertMinMm: 1,
  /** Por debajo de esta separación radial a la bombilla no hay datos para afirmar ventilación ni temperatura: aviso de validación física. */
  bulbGapAdvisoryMm: 5,

  // ---- Rosca de la interfaz pantalla–base
  /** Profundidad del filete como fracción del paso (flancos a 45°: el tramo axial de cada flanco = la profundidad). */
  threadDepthFrac: 0.32,
  /** Entrada del filete (rampa de profundidad) y salida, en múltiplos de la profundidad. */
  threadRampInDepths: 2,
  threadRampOutDepths: 1,
  /** La hembra se extiende este tramo más allá del filete macho. */
  threadFemaleRunoutMm: 1.5,
  /** Avellanado de entrada de la hembra (45°). */
  threadEntryChamferMm: 1.5,
  /** Filas por paso en la malla del macho y capas por paso en la hembra. */
  threadRowsPerPitch: 16,
  threadFemaleLayersPerPitch: 16,
  femaleSegments: 144,
  /** Tramo liso del cuello expuesto entre la cara superior de la base y la transición. */
  shadeBaseGapMm: 3,
  /** Pendiente de la transición cuello -> pantalla (respecto de la vertical). */
  flareDeg: 45,
  flareMinMm: 3,
  flareWarnMm: 40,

  // ---- Base
  baseOuterWallMm: 10,
  baseMinOuterWallMm: 6,
  /** Altura de la cavidad anular entre el piso y el tope de la rosca (cara de apoyo del cuello). Sin ventanas laterales: la pared exterior de la base es lisa. */
  baseCavityHeightMm: 11,
  /** Anclaje del precinto: ancho del fleje, espesor del fleje. */
  tieStrapWidthMm: 4.4,
  tieStrapThicknessMm: 1.8,

  // ---- Collar roscado independiente (modo vaso)
  socketWallMm: 2.4,
  /** Holgura radial entre el diámetro EXTERIOR de la pantalla y el pozo del collar (sin nervios). */
  socketClearanceMm: 0.4,
  socketFloorWidthMm: 3,
  socketRibs: 6,
  socketRibHeightMm: 0.6,
  socketRibArcDeg: 10,
  socketLeadInMm: 0.8,

  tabLengthMm: 7,
  tabThicknessMm: 2.4,
  tabArcMm: 18,
  /** Holgura radial mínima de DISEÑO entre el borde interior del reborde de adhesión y la torre / el inserto. */
  adhesionClearanceMm: 1,
  /** Zona de montaje del inserto: tubo liso Ø exterior sobre la cara superior de la torre antes de que empiecen las ondas, y rampa de la envolvente de la onda. */
  insertMountExtraMm: 3,
  insertWaveRampMm: 12,
  /** Radio de curvatura mínimo de las crestas del inserto ondulado, en múltiplos del espesor. */
  insertCrestRadiusFactor: 1.5,
  /** Cierre de la gota: altura mínima y pendiente (respecto de la vertical) sobre la cual se avisa de la imprimibilidad. */
  dropMinClosureMm: 10,
  dropLeanWarnDeg: 45,
  /** Tolerancia de ancho de lengüeta del inserto abierto: cuña inferior que sostiene la lengüeta (mm). */
  tabGussetMm: 1.5,
  /** Distancia mínima del borde superior del inserto al de la pantalla. */
  insertTopMarginMm: 4,
  /** Pendiente máxima (grados respecto de la vertical) para declarar la pantalla compatible con modo vaso. */
  vaseMaxOverhangDeg: 45,
  /** Pendiente a partir de la cual la geometría se considera degenerada para impresión (bloquea). */
  hardMaxTiltDeg: 70,
  /** Triángulos máximos de la parte decorativa de la pantalla (presupuesto de malla; el cuello roscado suma aparte). */
  maxShadeTriangles: 110_000,

  // ---- Pantalla calada
  /** Ancho de tira por debajo del cual no hay forma de imprimirla (error) y por debajo del cual es frágil (aviso): 2 y 3 perímetros de boquilla 0,4. */
  openworkMinStripMm: 0.8,
  openworkWarnStripMm: 1.2,
  /** Profundidad radial mínima (error) y recomendada (aviso). */
  openworkMinDepthMm: 1,
  openworkWarnDepthMm: 1.6,
  /** Abertura (círculo inscripto) mínima: por debajo no es una abertura real imprimible (error); por debajo de la recomendada, aviso. */
  openworkMinOpeningMm: 0.8,
  openworkWarnOpeningMm: 3,
  /** Abertura mínima de la zona de tiras: por debajo de este % la pantalla es casi sólida. */
  openworkWarnAperturePct: 8,
  /** Inclinación de una tira respecto de la vertical a partir de la cual hay voladizo (aviso: puede pedir soportes) y a partir de la cual no se imprime (error). */
  openworkLeanWarnDeg: 45,
  openworkLeanHardDeg: 68,
  /** Radio máximo del empalme (mm) entre tiras que se cruzan: redondea los rincones de las aberturas. */
  openworkFilletMm: 0.7,
  /** Celda de la grilla (mm): objetivo en fracción del ancho de tira, y límites. Presupuesto de celdas y de triángulos. */
  openworkCellMinMm: 1,
  openworkCellMaxMm: 2,
  openworkCellsPerStrip: 2.5,
  openworkMaxCells: 90_000,
  openworkWarnTriangles: 170_000,
  openworkMaxTriangles: 330_000,
  /** Mínimo de columnas: la rosca del cuello se muestrea en la misma grilla angular. */
  openworkMinColumns: 180,
} as const;
