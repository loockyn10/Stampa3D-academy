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
 * cambios). "lid": además del cuerpo, se genera una tapa (0.2+) como pieza
 * separada — ver createLetterGeometry.ts. Cómo se une esa tapa al cuerpo es
 * un concepto aparte, ver `LidJoint`.
 */
export type FrontType = "open" | "lid";

/**
 * Sistema de unión entre la tapa y el cuerpo. Solo aplica si
 * `frontType === "lid"`. "glue": tapa plana para pegar, sin encastre (0.2,
 * sin cambios). "interior-lip": tapa con labio interior que entra en la
 * cavidad del cuerpo con holgura (0.3) — ver
 * src/lib/maker/geometry/joints/interiorLip.ts. Deliberadamente un tipo
 * aparte de `FrontType`: agregar un futuro joint (clips, imanes, tornillos)
 * es sumar un valor acá, no una nueva rama de frontType ni un enum
 * combinado cuerpo×tapa×encastre en toda la app.
 */
export type LidJoint = "glue" | "interior-lip";

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
  /** Espesor de la tapa, en mm. Solo se usa/valida si frontType === "lid" (cualquier lidJoint). */
  lidMm: number;
  /** Sistema de unión de la tapa. Solo se usa/valida si frontType === "lid". */
  lidJoint: LidJoint;
  /**
   * Profundidad del labio dentro de la cavidad del cuerpo, en mm. Solo se
   * usa/valida si lidJoint === "interior-lip".
   */
  insertDepthMm: number;
  /**
   * Holgura POR LADO entre el labio y la pared interior real del cuerpo, en
   * mm (no se divide por dos: 0.20 mm de holgura = ~0.20 mm de separación
   * física en cada lado). Solo se usa/valida si lidJoint === "interior-lip".
   */
  clearanceMm: number;
  /**
   * Espesor de la PARED del labio (perimetral), en mm. El labio es un
   * anillo/marco fino de este espesor, no toda la región interior de la
   * cavidad — la zona central detrás de la placa queda vacía, para no
   * engrosar la tapa (crítico para cartelería luminosa: la placa debe
   * conservar solo `lidMm` de espesor donde no hay labio). Independiente
   * de `lidMm`, `insertDepthMm`, `clearanceMm` y del `wallMm` del cuerpo.
   * Solo se usa/valida si lidJoint === "interior-lip".
   */
  lipWallMm: number;
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
  code: "WALL_TOO_THICK" | "EMPTY_TEXT" | "NO_GLYPHS" | "LIP_COLLAPSED" | "INSERT_DEPTH_CLAMPED";
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
  /**
   * Errores geométricos: el modelo generado NO debería exportarse mientras
   * `errors.length > 0` (p.ej. LIP_COLLAPSED — el labio del encastre
   * desapareció en alguna letra). El preview puede seguir mostrándose para
   * que el usuario entienda qué ajustar; los exportadores (exportWord,
   * exportLettersZip) rechazan exportar mientras existan. Distinto de
   * `warnings`: un warning no bloquea la exportación (p.ej.
   * INSERT_DEPTH_CLAMPED, WALL_TOO_THICK), un error sí.
   */
  errors: LetterGeometryWarning[];
  warnings: LetterGeometryWarning[];
  /**
   * Geometría de cada carácter por separado (misma fuente de verdad que
   * `body`/`lid`: son las mismas piezas, solo sin concatenar). Vacío para
   * texto vacío/sin glifos. Usado para exportar letras individuales sin
   * un segundo motor geométrico paralelo.
   */
  letters: LetterPieceResult[];
}
