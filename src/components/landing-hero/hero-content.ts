/**
 * Contenido editable del Hero 3D de Universo Stampa (prototipo de /landing-preview).
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

/** Escena 4: presentación estilizada de la plataforma (marcador de posición hasta tener demostraciones administrables). */
export const discoveryContent = {
  eyebrow: "Has entrado",
  title: "Bienvenido a Universo Stampa",
  subtitle: "Formación, herramientas y comunidad para imprimir, gestionar y hacer crecer tu taller.",
  primary: { label: "Comenzar gratis", href: "/registro" },
  secondary: { label: "Conocer la plataforma", href: "/landing" },
  /** Módulos mostrados como tarjetas flotantes. Sustituibles por demos reales más adelante. */
  modules: [
    { id: "calculadora", title: "Calculadora", hint: "Costos reales por pieza", kind: "bars" },
    { id: "taller", title: "Mi Taller", hint: "Filamentos, stock y producción", kind: "stock" },
    { id: "stampy", title: "Stampy IA", hint: "Tu asistente de impresión", kind: "chat" },
    { id: "academia", title: "Academia", hint: "Aprendé paso a paso", kind: "progress" },
  ] as const,
} as const;

export type DiscoveryModule = (typeof discoveryContent.modules)[number];
