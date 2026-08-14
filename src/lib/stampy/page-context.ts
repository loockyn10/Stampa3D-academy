export interface StampyPageContext {
  source: "page";
  pathname: string;
  pageTitle: string;
  pageDescription: string;
  userIntentHints?: string[];
  relatedRoutes?: string[];
  toolKey?: string;
}

const PAGE_MAP: Record<string, Omit<StampyPageContext, "source" | "pathname">> = {
  "/academia": {
    pageTitle: "Academia",
    pageDescription: "Hub principal de aprendizaje con cursos estructurados, talleres prácticos y ruta de aprendizaje recomendada según el perfil del usuario.",
    userIntentHints: ["por donde empezar", "ruta de aprendizaje", "qué curso tomar"],
    relatedRoutes: ["/cursos", "/talleres"],
    toolKey: "academy",
  },
  "/cursos": {
    pageTitle: "Cursos",
    pageDescription: "Listado de cursos estructurados por módulos y clases. Cada curso tiene un camino ordenado de aprendizaje.",
    userIntentHints: ["aprender", "formación", "módulos", "clases"],
    relatedRoutes: ["/academia", "/talleres"],
    toolKey: "courses",
  },
  "/talleres": {
    pageTitle: "Talleres",
    pageDescription: "Proyectos prácticos paso a paso. Cada taller tiene archivos STL, materiales sugeridos y guía de construcción.",
    userIntentHints: ["proyecto práctico", "hacer algo", "aplicar lo aprendido"],
    relatedRoutes: ["/academia", "/cursos"],
    toolKey: "workshops",
  },
  "/calculadora": {
    pageTitle: "Calculadora",
    pageDescription: "Herramienta para calcular precios de impresión 3D. Modo básico (markup rápido) y modo avanzado (material, tiempo, electricidad, mano de obra, margen, envío, comisión y amortización).",
    userIntentHints: ["calcular precio", "cuánto cobrar", "costo de impresión", "margen"],
    relatedRoutes: ["/presupuestos", "/productos"],
    toolKey: "calculator-basic",
  },
  "/presupuestos": {
    pageTitle: "Presupuestos",
    pageDescription: "Herramienta para crear presupuestos profesionales para clientes. Permite agregar ítems calculados, aplicar descuentos y generar un PDF para compartir.",
    userIntentHints: ["hacer un presupuesto", "cotización", "enviar precio al cliente"],
    relatedRoutes: ["/calculadora", "/productos"],
    toolKey: "budgets",
  },
  "/productos": {
    pageTitle: "Productos",
    pageDescription: "Gestión del catálogo de productos guardados del taller: costos, precios de venta, stock asociado y rentabilidad.",
    userIntentHints: ["guardar producto", "catálogo", "piezas recurrentes"],
    relatedRoutes: ["/stock", "/calculadora"],
    toolKey: "products",
  },
  "/stock": {
    pageTitle: "Stock",
    pageDescription: "Control de inventario: filamentos disponibles, productos terminados y movimientos de stock.",
    userIntentHints: ["cuánto filamento tengo", "inventario", "material disponible"],
    relatedRoutes: ["/productos"],
    toolKey: "filament-stock",
  },
  "/libreria-stl": {
    pageTitle: "Librería STL",
    pageDescription: "Modelos STL exclusivos disponibles para descargar. Requiere membresía activa.",
    userIntentHints: ["descargar modelo", "STL", "archivo para imprimir"],
    relatedRoutes: ["/talleres"],
    toolKey: "stl-library",
  },
  "/sorteos": {
    pageTitle: "Sorteos",
    pageDescription: "Beneficios y sorteos activos para miembros de la academia. Se puede ver historial de ganadores y participar.",
    userIntentHints: ["sorteo", "ganar", "beneficio", "participo"],
    relatedRoutes: [],
    toolKey: "raffles",
  },
  "/perfil": {
    pageTitle: "Perfil",
    pageDescription: "Datos personales del usuario, estado de membresía, insignias obtenidas y progreso general.",
    userIntentHints: ["mi perfil", "membresía", "datos personales"],
    relatedRoutes: ["/configuracion"],
    toolKey: undefined,
  },
  "/configuracion": {
    pageTitle: "Configuración",
    pageDescription: "Configuración del negocio y taller: perfil de negocio, impresoras, filamentos predeterminados y parámetros de calculadora.",
    userIntentHints: ["configurar", "ajustes", "impresora", "filamento default"],
    relatedRoutes: [],
    toolKey: undefined,
  },
  "/redes": {
    pageTitle: "Redes Sociales",
    pageDescription: "Redes oficiales de Stampa 3D: YouTube, Instagram y otros canales.",
    userIntentHints: ["redes sociales", "youtube", "instagram"],
    relatedRoutes: ["/canales"],
    toolKey: "community",
  },
  "/canales": {
    pageTitle: "Canales de Comunidad",
    pageDescription: "Canales de la comunidad Stampa: WhatsApp y Telegram para consultas y novedades.",
    userIntentHints: ["comunidad", "whatsapp", "telegram", "canal"],
    relatedRoutes: ["/redes"],
    toolKey: "community",
  },
  "/stampy": {
    pageTitle: "Stampy IA",
    pageDescription: "Chat principal del asistente IA. El usuario puede preguntar cualquier cosa sobre impresión 3D, la plataforma y sus herramientas.",
    userIntentHints: [],
    relatedRoutes: [],
    toolKey: undefined,
  },
};

export function getStampyPageContext(pathname: string): StampyPageContext {
  // Match exact first, then try prefix for dynamic routes like /cursos/[id]
  const exact = PAGE_MAP[pathname];
  if (exact) {
    return { source: "page", pathname, ...exact };
  }

  // Prefix match (e.g. /cursos/some-id → /cursos)
  const prefix = Object.keys(PAGE_MAP).find(
    (key) => key !== "/" && pathname.startsWith(key + "/")
  );
  if (prefix) {
    return { source: "page", pathname, ...PAGE_MAP[prefix] };
  }

  return {
    source: "page",
    pathname,
    pageTitle: "Academia Stampa",
    pageDescription: "Pantalla interna de la plataforma.",
  };
}
