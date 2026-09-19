// Tipos compartidos del pipeline geométrico de Stampa Maker.
// Todas las unidades de longitud son milímetros (1 unidad = 1 mm).

export type MakerFontId = "montserrat-regular" | "montserrat-bold";

/**
 * Tipo de cuerpo. "standard": cuerpo actual (fondo+repisa+pared, sin
 * cambios). Futuras variantes (p.ej. "tapered", 0.4 Etapa 3) se agregan acá
 * y se resuelven en el único `switch` de
 * geometry/body/index.ts#buildBody — nunca con `if (bodyType === ...)`
 * disperso por el resto del proyecto.
 */
export type BodyType = "standard" | "tapered";

/**
 * Estilo de aproximación del cuerpo tapered (0.4.1 corrección 2). "stepped":
 * el original de 0.4 (bandas grandes, ~2mm, escalones visibles a propósito
 * — un estilo válido, no un defecto). "smooth": misma progresión de offset
 * (`rearExpansionMm` en la base, 0 en el frente), pero aproximada con
 * sub-bandas finas (~0.2mm) + interpolación smoothstep, para que se perciba
 * como una pendiente continua en vez de escalones grandes. Ver
 * geometry/body/tapered.ts.
 */
export type TaperStyle = "stepped" | "smooth";

export interface MakerFontDefinition {
  id: MakerFontId;
  label: string;
  /** Ruta pública al archivo de fuente (.woff, parseable por opentype.js). */
  url: string;
}

/**
 * Tipo de frente del cuerpo (FRONT SYSTEM). "open": frente completamente
 * abierto (0.1, sin cambios). "lid": además del cuerpo, se genera una tapa
 * (0.2+) como pieza separada — ver createLetterGeometry.ts. Cómo se une esa
 * tapa al cuerpo es un concepto aparte, ver `LidJoint`. "perforated" (0.4
 * Etapa 5): máscara perforada + difusor plano, 2 piezas separadas. Único
 * `switch` sobre este tipo: geometry/front/index.ts#buildFrontParts.
 */
export type FrontType = "open" | "lid" | "perforated" | "light-channel";

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
  /** Tipo de cuerpo (ver BodyType). */
  bodyType: BodyType;
  /**
   * Expansión de la base trasera respecto del frente, en mm (0.4 Etapa 3).
   * Solo se usa/valida si bodyType === "tapered". La silueta del frente
   * (z=depthMm) siempre queda nominal (offset 0); la base (z=0) queda
   * `rearExpansionMm` más ancha, con transición progresiva entre medio.
   */
  rearExpansionMm: number;
  /** Estilo de aproximación del tapered (ver TaperStyle). Solo se usa/valida si bodyType === "tapered". */
  taperStyle: TaperStyle;
  /**
   * Costillas laterales (0.4 Etapa 2): relieves perimetrales que sobresalen
   * de la pared exterior/hueco de la letra en una o dos bandas de Z,
   * siguiendo el contorno real (nunca un bounding box). 0 = sin costillas.
   */
  ribsCount: 0 | 1 | 2;
  /** Cuánto sobresale la costilla lateralmente, en mm. Solo se usa si ribsCount > 0. */
  ribProtrusionMm: number;
  /** Ancho de la costilla en Z, en mm. Solo se usa si ribsCount > 0. */
  ribWidthMm: number;
  /**
   * Bisel frontal interior (0.4 Etapa 4): la pared (exterior y counters) se
   * inclina hacia adentro en una banda pegada al frente. A diferencia del
   * tapered, SÍ cambia la silueta de la interfaz frontal a propósito (el
   * bisel debe quedar visible justo en el borde del frente).
   */
  bevelEnabled: boolean;
  /** Longitud en Z de la banda del bisel, en mm. Solo se usa si bevelEnabled. */
  bevelDepthMm: number;
  /** Cuánto se desplaza hacia adentro en el borde del frente, en mm. Solo se usa si bevelEnabled. */
  bevelInsetMm: number;
  /**
   * Doble bisel / cintura luminosa (0.4.1 corrección 3B): modificador de
   * pared SEPARADO del bisel frontal (`bevelEnabled`) — una banda
   * intermedia (no necesariamente pegada al frente) donde la pared entra
   * hacia adentro y vuelve a salir, pensada para pintarse/imprimirse en un
   * color distinto en el slicer (solo geometría, sin selección de material
   * ni 3MF). Independiente de `bevelEnabled`: pueden combinarse mientras
   * sus bandas de Z no se superpongan (ver validation.ts).
   */
  grooveEnabled: boolean;
  /** Desplazamiento máximo hacia adentro en el centro de la banda, en mm. Solo se usa/valida si grooveEnabled. */
  grooveInsetMm: number;
  /** Extensión total en Z de la banda (entra + vuelve a salir), en mm. Solo se usa/valida si grooveEnabled. */
  grooveWidthMm: number;
  /** Distancia desde el FRENTE (z=depthMm) hasta el centro de la banda, en mm (misma convención que bevelDepthMm). Solo se usa/valida si grooveEnabled. */
  groovePositionMm: number;
  /**
   * Bisel posterior (0.4.2): equivalente al bisel frontal (`bevelEnabled`)
   * pero en el extremo OPUESTO del cuerpo — la pared (exterior y counters)
   * se inclina hacia adentro en una banda pegada a la BASE (Z=0), en vez de
   * al frente (Z=depthMm). Modificador independiente: puede combinarse con
   * el bisel frontal mientras sus bandas no se superpongan (ver
   * validation.ts) y con el bisel lateral/costillas (mismo criterio de
   * "ceder lugar" que ya usan entre sí, ver body/standard.ts). No aplica
   * con `bodyType === "tapered"` (mismo criterio que bevelEnabled/ribsCount).
   */
  rearBevelEnabled: boolean;
  /** Longitud en Z de la banda del bisel posterior, en mm, medida desde la base (Z=0). Solo se usa si rearBevelEnabled. */
  rearBevelDepthMm: number;
  /** Cuánto se desplaza hacia adentro en el extremo trasero (Z=0), en mm. Solo se usa si rearBevelEnabled. */
  rearBevelInsetMm: number;
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
  /**
   * Bisel de tapa/difusor (0.4.2): modificador independiente del bisel del
   * CUERPO (`bevelEnabled`/`rearBevelEnabled`), aplicado a la pieza frontal
   * imprimible que corresponda según `frontType` — la tapa (`frontType ===
   * "lid"`, cualquier `lidJoint`) o el difusor plano (`frontType ===
   * "perforated"`). NUNCA se aplica a la máscara perforada (tiene su propia
   * geometría, ver front/perforated.ts) ni al difusor de canal (fuera de
   * alcance de 0.4.2). Elimina el canto recto exterior de la pieza con una
   * transición inclinada — mismo mecanismo de banda+perfil suave que el
   * bisel del cuerpo (ver geometry/plateBevel.ts), acotado automáticamente
   * al espesor real de la pieza (`lidMm`/`diffuserThicknessMm`, ver
   * `LID_BEVEL_DEPTH_CLAMPED`) para no perforarla. Solo afecta el borde
   * VISIBLE (frontal) de la pieza: el lip interior de una tapa encastrable
   * no cambia.
   */
  lidBevelEnabled: boolean;
  /** Longitud en Z de la banda del bisel de tapa/difusor, en mm, medida desde la cara visible hacia atrás. Se acota automáticamente al espesor de la pieza. Solo se usa si lidBevelEnabled. */
  lidBevelDepthMm: number;
  /** Cuánto se desplaza hacia adentro en la cara visible, en mm. Solo se usa si lidBevelEnabled. */
  lidBevelInsetMm: number;
  /** Espesor de la CARA frontal de la máscara perforada, en mm (0.4 Etapa 5). Solo se usa/valida si frontType === "perforated". */
  maskThicknessMm: number;
  /**
   * Espesor de la pared del faldón lateral de la máscara (0.4.1 corrección
   * 4B — la máscara pasa de ser una placa plana a una carcasa que también
   * cubre el lateral del cuerpo, ver front/perforated.ts). Solo se
   * usa/valida si frontType === "perforated".
   */
  maskWallThicknessMm: number;
  /**
   * Cuántos mm de profundidad lateral del cuerpo cubre el faldón de la
   * máscara, medidos desde el frente hacia atrás (0 = sin faldón, ~depthMm =
   * cobertura completa; se acota automáticamente a la profundidad
   * disponible). Solo se usa/valida si frontType === "perforated".
   */
  maskSideDepthMm: number;
  /** Holgura POR LADO entre el faldón de la máscara y la silueta real del cuerpo, en mm (no se toca físicamente). Solo se usa/valida si frontType === "perforated". */
  maskClearanceMm: number;
  /**
   * Espesor del difusor plano, en mm. Compartido entre "perforated" (0.4
   * Etapa 5) y "light-channel" (0.4 Etapa 6, futuro) — mutuamente
   * excluyentes por `frontType`, mismo concepto de pieza en ambos.
   */
  diffuserThicknessMm: number;
  /** Diámetro de cada agujero del patrón circular, en mm. Solo se usa/valida si frontType === "perforated". */
  holeDiameterMm: number;
  /** Espaciado del patrón circular, CENTRO A CENTRO, en mm. Solo se usa/valida si frontType === "perforated". */
  pitchMm: number;
  /** Margen mínimo entre un agujero (borde del círculo, no su centro) y cualquier borde de la letra (exterior o counter), en mm. Solo se usa/valida si frontType === "perforated". */
  edgeMarginMm: number;
  /** Ancho del canal luminoso, en mm (0.4 Etapa 6). Solo se usa/valida si frontType === "light-channel". */
  channelWidthMm: number;
  /** Profundidad del canal (cavidad, nunca atraviesa el cuerpo), en mm. Solo se usa/valida si frontType === "light-channel". */
  channelDepthMm: number;
  /** Margen entre el canal y el borde real del trazo (exterior o counter), en mm. Solo se usa/valida si frontType === "light-channel". */
  channelOffsetMm: number;
  /** Holgura POR LADO entre el difusor del canal y la huella real del canal, en mm. Solo se usa/valida si frontType === "light-channel". */
  diffuserClearanceMm: number;
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
  code:
    | "WALL_TOO_THICK"
    | "EMPTY_TEXT"
    | "NO_GLYPHS"
    | "LIP_COLLAPSED"
    | "INSERT_DEPTH_CLAMPED"
    | "CHANNEL_COLLAPSED"
    | "CHANNEL_DEPTH_CLAMPED"
    | "BEVEL_PLATE_COLLAPSED"
    | "MASK_SKIRT_COLLAPSED"
    | "MASK_SIDE_DEPTH_CLAMPED"
    | "LID_BEVEL_COLLAPSED"
    | "LID_BEVEL_DEPTH_CLAMPED";
  message: string;
}

/** Triangle soup (sin indexar): cada triángulo repite sus 3 vértices. */
export interface TriangleSoupData {
  positions: Float32Array;
  normals: Float32Array;
  triangleCount: number;
}

/**
 * Identidad de una pieza física exportable/previsualizable. "body"/"lid"
 * son las piezas de 0.1-0.3 (sin cambios de comportamiento); "mask"/
 * "diffuser" (0.4 Etapa 5, frente perforado) y "channelDiffuser" (0.4
 * Etapa 6, canal luminoso) son nuevas. Agregar un futuro sistema de frente
 * que sume otra pieza física es sumar un valor acá, no una nueva rama de
 * `frontType` en cada exportador/el viewport — ver
 * geometry/front/index.ts#buildFrontParts y exporters/parts.ts.
 */
export type PartKind = "body" | "lid" | "mask" | "diffuser" | "channelDiffuser";

/** Una pieza física imprimible (mesh + cómo nombrarla al exportar). */
export interface SignPart {
  kind: PartKind;
  /** Sufijo de archivo cuando hay más de una pieza, ej. "cuerpo", "tapa", "mascara", "difusor", "difusor_canal". */
  filenameSuffix: string;
  mesh: TriangleSoupData;
}

/** Geometría de un único carácter (sin espacios), en las mismas coordenadas que el texto completo. */
export interface LetterPieceResult {
  char: string;
  /** Posición 1-based entre los caracteres exportables (sin espacios): 1, 2, 3... */
  index: number;
  /** Piezas físicas de este carácter. Siempre incluye una de kind "body"; las demás dependen de `frontType`. */
  parts: SignPart[];
}

export interface LetterGeometryResult {
  /**
   * Piezas combinadas (todas las letras concatenadas por kind), misma
   * fuente que ve el preview y la exportación de palabra completa. Siempre
   * incluye una entrada "body"; el resto depende de `frontType`.
   */
  parts: SignPart[];
  /** Total de triángulos de todas las piezas, para checks rápidos de "¿hay algo para exportar?". */
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
