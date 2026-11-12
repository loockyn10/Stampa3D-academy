/**
 * Contenido editable del Hero 3D de Universo Stampa (hero de /landing).
 * Todo texto y enlace del hero vive acá para poder ajustarlo (o hacerlo administrable) sin tocar la escena.
 */

export type HeroAction = { label: string; href: string; kind: "primary" | "secondary" };

export const heroContent = {
  brand: "Universo Stampa",
  /** Línea 1 y línea 2 del título; la segunda lleva el acento naranja. */
  titleLines: ["Tus ideas tienen un", "universo de posibilidades"] as const,
  subtitle: "Aprendé, creá y llevá tus proyectos de impresión 3D al siguiente nivel.",
  /** "#descubrimiento" avanza la secuencia hasta la escena final; el resto son rutas existentes. */
  actions: [
    { label: "Explorar Universo", href: "#descubrimiento", kind: "secondary" },
    { label: "Comenzar gratis", href: "/registro", kind: "primary" },
  ] as HeroAction[],
  loginLabel: "Ingresar",
  loginHref: "/login",
  scrollHint: "Deslizá para entrar",
  /** Subtítulos cinematográficos que acompañan la transformación (escena 3). */
  captions: ["Cada capa, una idea.", "Cada pieza, un proyecto."] as const,
} as const;

/** Escena 4: la interfaz real de Universo que emerge tras atravesar el núcleo (la ventana sale de `universe-tools.ts`). */
export const discoveryContent = {
  eyebrow: "Has entrado",
  title: "Bienvenido a Universo Stampa",
  subtitle: "Formación, herramientas y comunidad para imprimir, gestionar y hacer crecer tu taller.",
  primary: { label: "Comenzar gratis", href: "/registro" },
  /** Baja hasta la sección de herramientas (ver `toolsSectionContent.anchorId`). */
  secondary: { label: "Ver las herramientas", href: "#herramientas" },
} as const;
