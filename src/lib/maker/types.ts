// Tipos compartidos del pipeline geométrico de Stampa Maker.
// Todas las unidades de longitud son milímetros (1 unidad = 1 mm).

export type MakerFontId = "montserrat-regular" | "montserrat-bold";

export interface MakerFontDefinition {
  id: MakerFontId;
  label: string;
  /** Ruta pública al archivo de fuente (.woff, parseable por opentype.js). */
  url: string;
}

/**
 * Tipo de frente del cuerpo. "open": frente completamente abierto (0.1, sin
 * cambios). "lid": además del cuerpo, se genera una tapa frontal plana como
 * pieza separada (0.2) — ver createLetterGeometry.ts.
 */
export type FrontType = "open" | "lid";

/** Parámetros configurables por el usuario para el Creador de Carteles. */
export interface LetterSignParams {
  text: string;
  fontId: MakerFontId;
  /** Alto nominal del texto (altura de mayúscula), en mm. */
  heightMm: number;
  /** Profundidad total de la pieza (extrusión), en mm. */
  depthMm: number;
  /** Espesor de las paredes laterales, en mm. */
  wallMm: number;
  /** Espesor del fondo cerrado, en mm. */
  baseMm: number;
  frontType: FrontType;
  /** Espesor de la tapa frontal, en mm. Solo se usa/valida si frontType === "lid". */
  lidMm: number;
}

/** Punto 2D en milímetros, en el plano de la cara del texto (X = ancho, Y = alto). */
export type Point2D = readonly [number, number];

/** Contorno cerrado sin clasificar todavía como exterior o hueco. */
export interface RawContour {
  points: Point2D[];
}

/** Contorno exterior con sus huecos anidados directos. */
export interface ContourGroup {
  outer: Point2D[];
  holes: Point2D[][];
}

export interface LetterGeometryWarning {
  code: "WALL_TOO_THICK" | "EMPTY_TEXT" | "NO_GLYPHS";
  message: string;
}

/** Triangle soup (sin indexar): cada triángulo repite sus 3 vértices. */
export interface TriangleSoupData {
  positions: Float32Array;
  normals: Float32Array;
  triangleCount: number;
}

/** Geometría de un único carácter (sin espacios), en las mismas coordenadas que el texto completo. */
export interface LetterPieceResult {
  char: string;
  /** Posición 1-based entre los caracteres exportables (sin espacios): 1, 2, 3... */
  index: number;
  /** Cuerpo (fondo + paredes, soldado en un solo sólido). Siempre presente. */
  body: TriangleSoupData;
  /** Tapa frontal plana, pieza separada (no fusionada con el cuerpo). `null` cuando frontType === "open". */
  lid: TriangleSoupData | null;
}

export interface LetterGeometryResult {
  /** Cuerpo combinado (todas las letras concatenadas), misma pieza que ve el preview y STAMPA.stl. */
  body: TriangleSoupData;
  /** Tapa combinada (todas las letras concatenadas). `null` cuando frontType === "open". */
  lid: TriangleSoupData | null;
  /** Total de triángulos (cuerpo + tapa), para checks rápidos de "¿hay algo para exportar?". */
  triangleCount: number;
  /** Caja delimitadora aproximada del modelo, en mm. */
  boundingBox: { width: number; height: number; depth: number };
  warnings: LetterGeometryWarning[];
  /**
   * Geometría de cada carácter por separado (misma fuente de verdad que
   * `body`/`lid`: son las mismas piezas, solo sin concatenar). Vacío para
   * texto vacío/sin glifos. Usado para exportar letras individuales sin
   * un segundo motor geométrico paralelo.
   */
  letters: LetterPieceResult[];
}
