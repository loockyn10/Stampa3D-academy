import type { ContourGroup, Point2D } from "@/lib/maker/types";

/**
 * Sistema de instalación de Carteles (montaje + cableado + plantilla).
 * Todas las unidades son milímetros. Ver docs/STAMPA_MAKER.md, sección
 * "Carteles — Sistema de instalación".
 *
 * Coordenadas: las posiciones de features (montaje, puertos bipolares...) son
 * relativas al CENTRO de la caja del diseño (mismo origen que `BackCutout`), X a
 * la derecha visto DE FRENTE, Y arriba. Internamente el motor usa las
 * coordenadas globales del diseño (`origin + relativa`).
 */

// ------------------------------------------------------------------ receta

export type MountingType = "none" | "keyhole" | "standoff";

export interface KeyholeMountSettings {
  /** Diámetro de la cabeza del tornillo (círculo grande del keyhole). */
  headDiameterMm: number;
  neckWidthMm: number;
  neckLengthMm: number;
  /** Espacio libre necesario detrás de la base para alojar la cabeza del tornillo (se valida contra la cavidad). */
  depthMm: number;
  /** Margen mínimo entre el keyhole y el borde interior de la pared. */
  edgeMarginMm: number;
}

export interface StandoffMountSettings {
  /** Distancia letra-pared (largo del cuerpo del separador). */
  wallSpacingMm: number;
  /** Diámetro del cuerpo del separador. */
  bodyDiameterMm: number;
  /** Diámetro de la espiga. */
  pegDiameterMm: number;
  /** Profundidad del encastre en la letra (desde la cara trasera). */
  insertDepthMm: number;
  /** Holgura POR LADO entre espiga y receptor. */
  clearanceMm: number;
  /** Diámetro del agujero pasante para el tornillo de pared. */
  screwHoleDiameterMm: number;
  /** Diámetro del rebaje (counterbore) para la cabeza del tornillo; 0 = sin rebaje. */
  screwHeadDiameterMm: number;
  /** Espesor de pared del refuerzo (boss) alrededor del receptor. */
  bossWallMm: number;
  /** Margen mínimo entre el refuerzo y el borde interior de la pared de la letra. */
  edgeMarginMm: number;
}

export interface MountingSettings {
  type: MountingType;
  keyhole: KeyholeMountSettings;
  standoff: StandoffMountSettings;
}

export type WiringMode = "off" | "chained";
export type WiringDirection = "ltr" | "rtl";
/** V1 solo expone `direct-wire`; los demás valores reservan el futuro (USB-C sin implementar). */
export type PowerEntryKind = "direct-wire" | "usb-c-5v" | "usb-c-pd";
export type LedVoltage = "5V" | "12V" | "24V" | "other";

/**
 * Soporte de empalmes EXTERNO (`ExternalSpliceClip`, pieza impresa aparte): sostiene, ordena, separa y retiene
 * suavemente los DOS empalmes (+ y -) ya terminados y aislados entre una letra y la siguiente. NO conduce corriente.
 */
export interface SpliceClipSettings {
  /** Genera la pieza `bipolar-splice-clip.stl` (una sola pieza + cantidad = letras - 1). */
  enabled: boolean;
  /** Diámetro máximo del empalme terminado (con aislación). */
  diameterMm: number;
  /** Largo del empalme terminado. */
  lengthMm: number;
  /** Distancia entre los ejes de los dos alojamientos (+ y -). */
  spacingMm: number;
  /** Holgura POR LADO. */
  clearanceMm: number;
}

export interface WiringSettings {
  mode: WiringMode;
  direction: WiringDirection;
  powerEntry: PowerEntryKind;
  /** Diámetro de cada conductor (informativo: el agujero debe ser >= a este valor). */
  wireDiameterMm: number;
  /** Diámetro de CADA uno de los dos agujeros de un puerto bipolar. */
  wireHoleDiameterMm: number;
  /** Distancia entre los centros de los dos agujeros (+ y -) de un puerto bipolar. */
  holeCenterSpacingMm: number;
  spliceClip: SpliceClipSettings;
  /** Cable extra por tramo (servicio) para la longitud estimada. */
  serviceMarginMm: number;
  /** Solo documentación/etiqueta: no dimensiona nada eléctrico. */
  voltage: LedVoltage | null;
  /** Etiquetas impresas (+, -, IN, OUT) junto a los puertos bipolares. */
  printLabels: boolean;
}

export type PaperFormat = "A4" | "Letter" | "A3";

export interface TemplateSettings {
  paper: PaperFormat;
  overlapMm: number;
}

/** Configuración GLOBAL (receta): puede viajar en un preset. */
export interface InstallationRecipe {
  mounting: MountingSettings;
  wiring: WiringSettings;
  template: TemplateSettings;
}

// --------------------------------------------------------------- overrides

/** Posición relativa al centro del diseño. */
export interface RelPoint {
  x: number;
  y: number;
}

/** Overrides POR LETRA (específicos del proyecto: nunca viajan en un preset). */
export interface LetterInstallationOverride {
  /** Puntos de montaje manuales: reemplazan a los automáticos de esa letra. */
  mountPoints?: RelPoint[];
  /** Cantidad de soportes automáticos (si no hay `mountPoints`). */
  mountCount?: number;
}

/** Indexado por `LetterInstance.id`. */
export type InstallationOverrides = Record<string, LetterInstallationOverride>;

/** Configuración completa serializable de un proyecto. */
export interface SignInstallationSettings extends InstallationRecipe {
  overrides: InstallationOverrides;
}

// -------------------------------------------------------- identidad letras

export interface LetterBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface LetterInstance {
  /** Único y determinístico ("L1", "L2"...): NUNCA el carácter (puede repetirse). */
  id: string;
  /** 1-based, entre los caracteres con tinta (mismo índice que `LetterPieceResult.index`). */
  index: number;
  char: string;
  /** Etiqueta visible determinística: "S", "T", "A1", "M", "P", "A2". */
  label: string;
  boundsMm: LetterBounds;
  contourGroups: ContourGroup[];
  positionInWord: { index: number; count: number; isFirst: boolean; isLast: boolean };
}

// ---------------------------------------------------------------- cableado

export type WireSide = "left" | "right";

export interface LetterWiringRole {
  instanceId: string;
  label: string;
  /** Posición en la cadena física de cableado (0 = la que recibe la alimentación). */
  order: number;
  isFirst: boolean;
  isLast: boolean;
  hasPowerIn: boolean;
  hasIn: boolean;
  hasOut: boolean;
  /** Lado de la letra por donde entra el cable. */
  inSide: WireSide;
  outSide: WireSide;
}

export type TerminalId = "IN+" | "IN-" | "LED+" | "LED-" | "OUT+" | "OUT-";

/** Una red eléctrica dentro de una letra: los terminales de `terminals` se unen en un mismo empalme. */
export interface LetterNet {
  polarity: "+" | "-";
  terminals: TerminalId[];
}

export interface LetterWiring {
  instanceId: string;
  label: string;
  role: LetterWiringRole;
  nets: [LetterNet, LetterNet];
}

export interface CableLink {
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
  /** OUT+ de N con IN+ de N+1 y OUT- con IN-: misma polaridad (nunca LED -> LED). */
  joins: [["OUT+", "IN+"], ["OUT-", "IN-"]];
}

export interface WiringModel {
  topology: "parallel";
  direction: WiringDirection;
  /** Orden FÍSICO del cable (ids). */
  physicalOrder: string[];
  letters: LetterWiring[];
  links: CableLink[];
}

// --------------------------------------------------------------- features

export type BackFeatureKind = "mount" | "cutout" | "cable-clip" | "cable-port" | "label";

/** Zona reservada de la cara trasera. `footprint` es la huella real; el keepout es la huella + `marginMm`. Coordenadas globales del diseño. */
export interface BackFeatureZone {
  id: string;
  kind: BackFeatureKind;
  letterId: string | null;
  footprint: Point2D[][];
  marginMm: number;
}

export type MountPointKind = "keyhole" | "standoff";

export interface MountPoint {
  id: string;
  letterId: string;
  kind: MountPointKind;
  /** Relativo al centro del diseño. */
  x: number;
  y: number;
  source: "auto" | "manual";
  valid: boolean;
  message: string | null;
  /** Radio de la huella circular (refuerzo/cabeza), para el editor. */
  footprintRadiusMm: number;
}

export type PortRole = "power-in" | "in" | "out";

/** Cómo se materializa un puerto. V1: solo `rear-edge`; `side-wall` es la técnica preferida diferida (ver docs). */
export interface CablePortPlacement {
  kind: "rear-edge" | "side-wall";
  preferred: "side-wall" | "rear-edge";
  fallback: boolean;
  reason: string | null;
}

/** Un agujero de un puerto bipolar (coordenadas relativas al centro del diseño). */
export interface PortHole {
  polarity: "+" | "-";
  x: number;
  y: number;
}

/**
 * Puerto de cable BIPOLAR: una unidad (IN/OUT/ALIM) con DOS agujeros paralelos (+ y -). Se posiciona, valida y
 * reserva como un único bloque; nunca como dos features independientes. `x/y` es el centro del par; el eje del
 * par es vertical (+ arriba, - abajo, visto de frente).
 */
export interface BipolarCablePort {
  id: string;
  letterId: string;
  role: PortRole;
  side: WireSide;
  x: number;
  y: number;
  wireHoleDiameterMm: number;
  holeCenterSpacingMm: number;
  holes: [PortHole, PortHole];
  placement: CablePortPlacement;
  valid: boolean;
}

/** Conexión bipolar entre OUT de la letra N e IN de la letra N+1 (datos del helper visual, plantilla y guía). */
export interface WireConnection {
  id: string;
  fromLetter: string;
  toLetter: string;
  fromLabel: string;
  toLabel: string;
  fromPort: string;
  toPort: string;
  /** Recorrido del conductor + (de su agujero en OUT al de IN) y del -; coordenadas relativas al centro del diseño. */
  positivePath: RelPoint[];
  negativePath: RelPoint[];
  /** Posición inicial (visual) del soporte de empalmes: punto medio del recorrido; el eje sigue la dirección del cable. */
  clipPosition: { x: number; y: number; angleDeg: number };
  /** Distancia entre los centros de los dos puertos. */
  distanceMm: number;
}

export interface CableClip {
  id: string;
  letterId: string;
  portId: string;
  x: number;
  y: number;
  /** Ángulo (grados) del eje del cable. */
  angleDeg: number;
  gapMm: number;
  outerWidthMm: number;
  lengthMm: number;
  heightMm: number;
  /** Distancia desde el puerto (orden port -> clip -> clip -> bahía). */
  distanceFromPortMm: number;
}

export interface LetterLabelMark {
  id: string;
  letterId: string;
  text: string;
  x: number;
  y: number;
  angleDeg: number;
}

export type InstallationIssueCode =
  | "MOUNT_FEWER_THAN_TWO"
  | "MOUNT_NONE"
  | "MOUNT_INVALID"
  | "PORT_NO_SPACE"
  | "PORT_INVALID"
  | "PORT_INVADES_MOUNT"
  | "CLIP_NO_SPACE"
  | "ZONES_OVERLAP"
  | "SPLICE_EXCEEDS_SPACING"
  | "SPLICE_CLIP_INVALID"
  | "FEATURE_EXCEEDS_CAVITY"
  | "KEYHOLE_DEPTH"
  | "REAR_PORT_FLUSH"
  | "NOT_SUPPORTED_FRONT"
  | "SPACER_INVALID";

export interface InstallationIssue {
  code: InstallationIssueCode;
  letterId: string | null;
  message: string;
}

export interface LetterInstallationPlan {
  instanceId: string;
  mounts: MountPoint[];
  ports: BipolarCablePort[];
  /** Retención local (strain relief) cerca de cada puerto: un clip por puerto. */
  clips: CableClip[];
  labels: LetterLabelMark[];
  zones: BackFeatureZone[];
}

export interface CableLength {
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
  distanceMm: number;
  lengthMm: number;
}

export interface InstallationPlan {
  active: boolean;
  origin: { x: number; y: number };
  instances: LetterInstance[];
  wiring: WiringModel | null;
  letters: LetterInstallationPlan[];
  /** Conexiones bipolares entre letras consecutivas (orden físico). */
  connections: WireConnection[];
  /** Cantidad de soportes de empalme externos = letras - 1 (0 sin cableado encadenado o con 1 letra). */
  spliceClipCount: number;
  /** Longitudes estimadas de cable entre letras consecutivas (orden físico). */
  cableLengths: CableLength[];
  /** Errores: bloquean la exportación (geometría físicamente inválida). */
  errors: InstallationIssue[];
  warnings: InstallationIssue[];
}
