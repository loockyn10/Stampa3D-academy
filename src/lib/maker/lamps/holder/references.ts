/**
 * Medidas de referencia de los cuatro STL que el usuario probó físicamente (`references/lamp-e27/`). Cada cifra salió de la
 * MALLA, no de una estimación: `scripts/lamp-stl-reference.mjs` repite la medición (corte por semiplanos que pasan por el eje,
 * ajuste del centro por mínimos cuadrados sobre un cilindro liso) y `tests/maker-lamps-mounts.test.mjs` compara estas
 * constantes con los STL cuando están presentes. Nada de acá se redondea «a algo parecido»: se conservan las tolerancias y los
 * perfiles mecánicos originales.
 *
 * Diámetros de DISEÑO: los STL son poliedros inscriptos (los vértices están sobre el círculo de diseño y el centro de cada faceta queda
 * un poco adentro: flecha ≈ 0,015–0,02 mm). Las cotas de acá son las de los VÉRTICES (p. ej. el agujero a presión tiene sus vértices en
 * R = 20,0000: Ø40,000; el radio medio de las facetas da 19,984). La app también malla círculos inscriptos, así que las mallas generadas
 * tienen los vértices exactamente en estos radios.
 *
 * Los STL describen piezas del propio usuario con SU orientación de impresión (z = 0 es la cama). Acá solo se guardan las cotas
 * del encastre y de la rosca; cómo se orientan en la lámpara lo decide `mounts.ts`.
 */

/** diffuser.stl: tubo recto, 2 capas de vértices (z = 0 y z = 130,575), sin biseles ni lengüetas. */
export const REFERENCE_DIFFUSER = {
  file: "diffuser.stl",
  outerDiameterMm: 65.135,
  innerDiameterMm: 63.534,
  /** (65,135 − 63,534) / 2 */
  wallMm: 0.8005,
  heightMm: 130.575,
} as const;

/**
 * BASE v2.stl: alojamiento A PRESIÓN. Tubo central de Ø exterior ≈ 50 con un agujero ciego liso (sin costillas: el ajuste circular
 * de 36 ángulos deja un residuo de 0,015 mm, la flecha de las facetas) sobre un PISO macizo con el orificio del cable.
 *   - agujero Ø40,000 (vértices en R = 20,0000), de z = 15,00 (cara superior del piso) hasta z = 65,46;
 *   - entrada redondeada de ≈ 2 mm (el radio sube de 19,98 a 21,24 entre z = 65,46 y 67,50);
 *   - orificio del cable Ø7,000 (vértices en R = 3,5000) de z = 11 a 15, y avellanado a 45° por debajo (R = 13,475 en z = 1 hasta R = 3,482 en z = 11);
 *   - ranura de salida del cable en la pared del tubo (a ±10° de un azimut) desde z ≈ 54: no es parte del encastre y no se reproduce.
 */
export const REFERENCE_PRESS = {
  file: "BASE v2.stl",
  boreDiameterMm: 40,
  /** Profundidad útil del agujero (de la cara superior del piso al inicio de la entrada redondeada). */
  boreDepthMm: 50.46,
  /** Cara superior del piso sobre la base del STL. */
  floorTopMm: 15,
  /** Entrada redondeada: sobreancho radial y alto. */
  leadInRadialMm: 1.26,
  leadInHeightMm: 2.04,
  cableHoleDiameterMm: 7,
  towerOuterDiameterMm: 50,
} as const;

/** Rosca hembra: un nervio en V que entra desde la pared lisa del agujero. Siempre a derechas, exactamente 2 vueltas con corte plano en ambos extremos. */
export interface ReferenceThread {
  file: string;
  /** Ø de la raíz (pared lisa del agujero) y de la cresta (ápice del nervio). Profundidad = (raíz − cresta) / 2. */
  rootDiameterMm: number;
  crestDiameterMm: number;
  pitchMm: number;
  /** Pendiente de cada flanco (Δradio / Δaltura): 0,9 en BASE2 (42,1° del eje), 1,0 en patas V6 (45°). */
  flankSlope: number;
  turns: number;
  /** Profundidad, bajo la cara de entrada del portalámparas, del ápice más cercano y del más profundo (la hélice recorre 2 vueltas entre ambos). */
  nearApexDepthMm: number;
  deepApexDepthMm: number;
}

/**
 * BASE2.stl: base con embudo. Cara superior en z = 41,575; la rosca ocupa de z = 31,28 (primer ápice, 10,30 mm bajo la cara) a 37,96
 * (último ápice, 3,62 mm bajo la cara): 2 vueltas, ápices a 3,34 mm. Raíz Ø40,621 (vértices en R = 20,3099…20,3114), cresta Ø39,118
 * (vértices del ápice en R = 19,559, en V agudo), flancos con pendiente 0,9. Debajo hay un cono de entrada (que no se reproduce: depende de
 * la base del usuario).
 */
export const REFERENCE_THREAD_BASE2: ReferenceThread = {
  file: "BASE2.stl",
  rootDiameterMm: 40.621,
  crestDiameterMm: 39.118,
  pitchMm: 3.34,
  flankSlope: 0.9,
  turns: 2,
  nearApexDepthMm: 3.62,
  deepApexDepthMm: 10.3,
};

/**
 * patas V6.stl: plato con rosca hembra y tres patas. La cara de entrada del portalámparas es la inferior del plato en el STL (z = 0); la
 * rosca va de z = 0,77 (primer ápice) a 6,77 (último): 2 vueltas, ápices a 3,0 mm, raíz Ø40,500 (vértices en R = 20,2500), cresta Ø39,000
 * (vértices del ápice en R = 19,5000, en V agudo), flancos a 45°.
 * Plato Ø78,82 (R = 39,408) con borde vertical de 3,0 mm y cara superior abovedada hasta z = 15,44; agujero liso hasta z = 15,00.
 * Patas: tres cuñas macizas de 6,64 mm de ancho a 120°, inclinadas hacia afuera y arriba (borde superior ≈ 40°, inferior ≈ 50° respecto de la horizontal),
 * con punta redondeada de ≈ 5,9 mm de radio en (r = 63,2, z = 40,9).
 */
export const REFERENCE_THREAD_V6: ReferenceThread = {
  file: "patas V6.stl",
  rootDiameterMm: 40.5,
  crestDiameterMm: 39,
  pitchMm: 3,
  flankSlope: 1,
  turns: 2,
  nearApexDepthMm: 0.77,
  deepApexDepthMm: 6.77,
};

export const REFERENCE_V6_PLATE = {
  outerDiameterMm: 78.82,
  edgeHeightMm: 3,
  thicknessMm: 15,
  /** Cuña de cada pata: ancho tangencial y ángulos de sus dos bordes respecto de la horizontal. */
  legWidthMm: 6.64,
  legUpperEdgeDeg: 40,
  legLowerEdgeDeg: 50,
  legTipRadiusMm: 5.9,
  legs: 3,
} as const;

/** Profundidad radial del nervio (mm). */
export const threadDepthMm = (t: ReferenceThread): number => (t.rootDiameterMm - t.crestDiameterMm) / 2;
/** Semiancho axial de la base del nervio en la raíz (mm): profundidad / pendiente del flanco. */
export const threadHalfBaseMm = (t: ReferenceThread): number => threadDepthMm(t) / t.flankSlope;
