/**
 * Catálogo de herramientas de Universo que presenta la sección de exploración de /landing-preview.
 *
 * Es solo datos: la sección (`ToolsExplorer`) no conoce ninguna herramienta en particular. Para sumar una herramienta,
 * cambiar una demostración o incorporar un video no hace falta tocar componentes ni estilos: se edita este arreglo
 * (y, más adelante, el administrador podrá producir exactamente esta misma forma desde la base de datos).
 *
 * Reglas de contenido:
 * - Solo herramientas que existen en la aplicación (los textos salen de `src/lib/tutorials/definitions`).
 * - `image` / `video` son capturas o grabaciones reales. Si todavía no hay una, se usa `placeholder`, que se muestra
 *   rotulado como «Demostración en preparación»: nunca se dibuja una pantalla inventada.
 */

export type ToolIconName = "calculator" | "compass" | "shapes" | "wrench" | "briefcase" | "graduation-cap" | "bot";

/** Medio de una demostración. `video` queda previsto para el administrador: hoy ninguna herramienta lo usa. */
export type DemoMedia =
  | { kind: "image"; src: string; alt: string; width: number; height: number }
  | { kind: "video"; src: string; poster: string; alt: string; width: number; height: number }
  | { kind: "placeholder"; note: string };

export type ToolDemo = {
  id: string;
  /** Etiqueta corta del selector (solo se muestra si la herramienta tiene más de una demostración). */
  label: string;
  /** Qué se está viendo, en una frase. */
  summary: string;
  media: DemoMedia;
};

/**
 * `open`: se puede probar sin cuenta. `member`: vive dentro de la plataforma (hace falta una cuenta con acceso).
 * Determina la etiqueta y el destino del botón de la herramienta.
 */
export type ToolAccess = "open" | "member";

export type UniverseTool = {
  id: string;
  name: string;
  /** Frase breve que acompaña al nombre en la lista. */
  tagline: string;
  description: string;
  /** Ruta real de la herramienta dentro de la app. */
  route: string;
  access: ToolAccess;
  icon: ToolIconName;
  highlights: readonly string[];
  /** Al menos una demostración; la primera es la que se ve al elegir la herramienta. */
  demos: readonly [ToolDemo, ...ToolDemo[]];
};

const DEMO_DIR = "/landing-preview/demos";
const PENDING_NOTE = "Todavía no tenemos una grabación de esta herramienta. Cuando exista, se mostrará acá.";

/** Herramientas que se presentan hoy en la landing, en el orden en que aparecen. */
export const universeTools: readonly UniverseTool[] = [
  {
    id: "calculadora",
    name: "Calculadora",
    tagline: "Cuánto cobrar por una impresión",
    description: "Calculá el precio de una pieza con material, tiempo, margen y costos extra. La misma calculadora funciona sin cuenta, con una configuración de ejemplo.",
    route: "/calculadora",
    access: "open",
    icon: "calculator",
    highlights: ["Filamento, gramos, horas, tipo de producto e impresora", "Modo Avanzado: desperdicio, electricidad, mantenimiento y plataforma de venta", "Costo base, precio sugerido, ganancia y precio para Mercado Libre"],
    demos: [
      {
        id: "basico",
        label: "Modo Básico",
        summary: "Cargá filamento, gramos y tiempo: el resumen te da costo base, precio sugerido y ganancia estimada.",
        media: { kind: "image", src: `${DEMO_DIR}/calculadora-basico-demo.png`, alt: "Calculadora de Universo en Modo Básico con 120 gramos y 3 horas 30 minutos cargados, y el resumen del cálculo con el precio sugerido.", width: 1440, height: 900 },
      },
      {
        id: "avanzado",
        label: "Modo Avanzado",
        summary: "Sumá desperdicio, electricidad, mantenimiento, mano de obra y la comisión de la plataforma donde vendés.",
        media: { kind: "image", src: `${DEMO_DIR}/calculadora-avanzado-demo.png`, alt: "Calculadora de Universo en Modo Avanzado con las secciones de material y taller, costos extra y plataforma de venta.", width: 1440, height: 900 },
      },
    ],
  },
  {
    id: "explorar-modelos",
    name: "Explorar Modelos",
    tagline: "Modelos 3D de varias plataformas",
    description: "Buscá modelos en varias plataformas desde un solo lugar. Cada resultado te lleva al modelo original, y siempre conviene verificar su licencia antes de vender.",
    route: "/explorar-modelos",
    access: "open",
    icon: "compass",
    highlights: ["Una sola búsqueda en Cults3D y MyMiniFactory", "Filtros por fuente, precio, uso comercial y orden", "Buscás en español o en inglés"],
    demos: [
      {
        id: "busqueda",
        label: "Búsqueda",
        summary: "El buscador con sus filtros de fuente, precio, uso comercial y orden.",
        media: { kind: "image", src: `${DEMO_DIR}/explorar-modelos.png`, alt: "Explorar Modelos: barra de búsqueda con los filtros de fuente, precio, uso comercial y orden.", width: 1440, height: 900 },
      },
    ],
  },
  {
    id: "mi-taller",
    name: "Mi Taller",
    tagline: "Fabricar con costos reales",
    description: "Mi Taller es donde se fabrica: impresoras, bobinas, productos y unidades terminadas, con el mismo motor de cálculo que la Calculadora.",
    route: "/mi-taller",
    access: "member",
    icon: "wrench",
    highlights: ["Impresoras y una card por cada bobina física", "Productos con receta de material, tiempo y precio", "Registrar producción descuenta filamento y suma unidades terminadas"],
    demos: [
      {
        id: "recorrido",
        label: "Recorrido",
        summary: "Productos con sus categorías, filamentos con su stock, impresoras e inventario con el registro de producción. Cuenta de demostración con datos ficticios.",
        media: {
          kind: "video",
          src: `${DEMO_DIR}/mi-taller.mp4`,
          poster: `${DEMO_DIR}/mi-taller-poster.jpg`,
          alt: "Recorrido por Mi Taller con datos de demostración: lista de productos filtrada por categoría, filamentos con su stock disponible, impresoras cargadas e inventario con el cálculo de lo que descuenta una producción.",
          width: 1280,
          height: 800,
        },
      },
    ],
  },
  {
    id: "academia",
    name: "Academia",
    tagline: "Aprender a tu ritmo",
    description: "Cursos, talleres y una ruta recomendada según tu perfil, para avanzar lección por lección.",
    route: "/academia",
    access: "member",
    icon: "graduation-cap",
    highlights: ["Cursos: de fundamentos a herramientas avanzadas", "Talleres: proyectos reales paso a paso", "Ruta recomendada según tu perfil"],
    demos: [{ id: "pendiente", label: "Demostración", summary: "Demostración en preparación.", media: { kind: "placeholder", note: PENDING_NOTE } }],
  },
  {
    id: "stampy",
    name: "Stampy IA",
    tagline: "Tu asistente de impresión",
    description: "Consultale dudas y pedile ayuda con tu taller. Stampy usa lo que ves en pantalla como contexto, y las acciones que prepara no se aplican hasta que las confirmes.",
    route: "/stampy",
    access: "member",
    icon: "bot",
    highlights: ["Solucionar problemas de impresión y calcular precios", "Consultar tu inventario", "Acciones que preparás con él y confirmás vos"],
    demos: [{ id: "pendiente", label: "Demostración", summary: "Demostración en preparación.", media: { kind: "placeholder", note: PENDING_NOTE } }],
  },
];

/**
 * Herramientas que existen en Universo pero NO se promocionan en la landing pública (beta privada o deshabilitadas por feature flag).
 * No se muestran. Para volver a publicar una, moverla a `universeTools` en la posición que corresponda: no hace falta tocar componentes.
 */
const stampaMaker: UniverseTool = {
  id: "stampa-maker",
  name: "Stampa Maker",
  tagline: "Piezas a medida desde parámetros",
  description: "Herramientas que generan geometría 3D imprimible a partir de parámetros simples: elegís una, ajustás las medidas y descargás el STL para imprimir.",
  route: "/stampa-maker",
  access: "member",
  icon: "shapes",
  highlights: ["Creador de Carteles: carteles, tapas y difusores", "Neon LED: canales para Neon Flex", "Ajustás parámetros y descargás el STL"],
  demos: [{ id: "pendiente", label: "Demostración", summary: "Demostración en preparación.", media: { kind: "placeholder", note: PENDING_NOTE } }],
};

/** Mi Negocio está deshabilitado a propósito (feature flag apagada, en refinamiento): no se promociona hasta su lanzamiento. */
const miNegocio: UniverseTool = {
  id: "mi-negocio",
  name: "Mi Negocio",
  tagline: "Vender y organizar",
  description: "Mi Negocio es lo que se vende y cómo se opera: catálogo, ventas, clientes, presupuestos y tienda.",
  route: "/mi-negocio",
  access: "member",
  icon: "briefcase",
  highlights: ["Catálogo de productos fabricados y de reventa", "Ventas, clientes y cuenta corriente", "Presupuestos rápidos o profesionales en PDF"],
  demos: [{ id: "pendiente", label: "Demostración", summary: "Demostración en preparación.", media: { kind: "placeholder", note: PENDING_NOTE } }],
};

export const unlistedTools: readonly UniverseTool[] = [stampaMaker, miNegocio];

/** Demostración protagonista de la transición del Hero: la primera de la primera herramienta. */
export const heroRevealTool = universeTools[0];

export const toolsSectionContent = {
  anchorId: "herramientas",
  eyebrow: "Herramientas de Universo",
  title: "Elegí una herramienta y mirala en acción",
  subtitle: "Estas son las herramientas reales de la plataforma. Las que ya tienen demostración muestran la aplicación tal cual es.",
  openLabel: "Probala sin registrarte",
  memberLabel: "Dentro de la plataforma",
  openCta: (toolName: string) => `Abrir ${toolName}`,
  memberCta: "Comenzar gratis",
  memberHref: "/registro",
  placeholderTitle: "Demostración en preparación",
} as const;
