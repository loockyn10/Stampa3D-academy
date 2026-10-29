// Modelo de datos del sistema de tutoriales. Ver docs/TUTORIALS.md.
//
// Un tutorial es DATO puro (sin JSX): agregar uno nuevo es registrar un objeto en `definitions/`.
// Las ilustraciones se describen con un vocabulario chico (`TutorialIllustration`) que renderiza
// `components/tutorials/TutorialIllustration.tsx` con los tokens del tema.

/** Nombres de iconos permitidos en las ilustraciones (mapa a lucide en `components/tutorials/tutorial-icons.ts`). */
export const TUTORIAL_ICON_NAMES = [
  "barcode",
  "bot",
  "book-open",
  "boxes",
  "briefcase",
  "calculator",
  "chart",
  "clipboard-list",
  "compass",
  "download",
  "file-text",
  "gift",
  "graduation-cap",
  "home",
  "layers",
  "lightbulb",
  "link",
  "package",
  "package-check",
  "package-plus",
  "palette",
  "pen-tool",
  "printer",
  "receipt",
  "refresh",
  "search",
  "settings",
  "shopping-bag",
  "sparkles",
  "store",
  "type",
  "user",
  "users",
  "warehouse",
  "wrench",
  "zap",
] as const;

export type TutorialIconName = (typeof TUTORIAL_ICON_NAMES)[number];

/** `accent` destaca el elemento principal de la ilustración; `neutral` es el resto. */
export type TutorialTone = "accent" | "neutral";

export interface TutorialFlowNode {
  icon: TutorialIconName;
  label: string;
  hint?: string;
}

export interface TutorialCardItem {
  icon: TutorialIconName;
  title: string;
  text?: string;
  tone?: TutorialTone;
}

export interface TutorialChatMessage {
  from: "user" | "stampy";
  text: string;
}

export interface TutorialFilterGroup {
  label: string;
  options: string[];
  /** Opción resaltada como seleccionada. */
  active?: string;
}

export type TutorialIllustration =
  /** Secuencia de pasos con flechas (cómo se encadena un flujo). */
  | { kind: "flow"; nodes: TutorialFlowNode[] }
  /** Tarjetas parecidas a los accesos/paneles reales de la herramienta. */
  | { kind: "cards"; items: TutorialCardItem[] }
  /** Desglose de costos: filas sumadas, un subtotal y el resultado (sin números inventados). */
  | { kind: "breakdown"; rows: string[]; subtotal: string; result: string; note?: string }
  /** Conversación de ejemplo. */
  | { kind: "chat"; messages: TutorialChatMessage[] }
  /** Barra de búsqueda con grupos de filtros. */
  | { kind: "filters"; search: string; groups: TutorialFilterGroup[] };

export interface TutorialStep {
  /** Estable dentro del tutorial (para keys y tests). */
  id: string;
  title: string;
  /** Una o dos frases. */
  text: string;
  illustration: TutorialIllustration;
}

export interface TutorialVideo {
  /** YouTube (watch / youtu.be / embed), Bunny (`player.mediadelivery.net`) o cualquier https (se abre como enlace). */
  url: string;
  title?: string;
}

export interface TutorialDefinition {
  /** Identificador único. Es la clave persistida en `user_tool_tutorial_views.tool_key`: no renombrar. */
  id: string;
  /** Nombre de la herramienta (encabezado). */
  toolName: string;
  title: string;
  description: string;
  /**
   * Versión entera (empieza en 1). Subirla vuelve a mostrar la guía automáticamente a quienes vieron una
   * versión anterior; hacerlo solo cuando la herramienta cambió de forma considerable.
   */
  version: number;
  steps: TutorialStep[];
  /** Opcional. Mientras no exista, el tutorial es solo la guía visual (sin reproductor ni botones de video). */
  video?: TutorialVideo;
}

export type TutorialMode = "guide" | "video";

/** Ruta → tutorial. El primer elemento que coincide gana (ordenar de lo específico a lo general). */
export interface TutorialRoute {
  match: string;
  tutorialId: string;
  /** Solo la ruta exacta (sin subrutas). */
  exact?: boolean;
}
