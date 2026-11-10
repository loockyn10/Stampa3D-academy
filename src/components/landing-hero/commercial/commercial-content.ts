/**
 * Contenido de las secciones comerciales de /landing-preview. Solo datos: los componentes no contienen ningún texto de producto.
 *
 * Reglas (acordadas con el dueño, ver docs/TASKS.md «Landing 5.5»):
 * - Solo beneficios verificados en el código (política de acceso, rutas libres y feature flags).
 * - Nada de Stampa Maker, Mi Negocio, Presupuestos, Tienda online, Sorteos, acceso Beta ni códigos de descuento.
 * - Nada sobre cancelación, reembolsos ni condiciones de pago no aprobadas (D045); los legales siguen pendientes.
 * - El precio NO está acá: se lee de `membership_settings` (ver `membership-price.ts`).
 */

export const commercialCtas = {
  primary: { label: "Comenzar gratis", href: "/registro" },
  secondary: { label: "Probar la Calculadora", href: "/calculadora" },
  login: { label: "Ya tengo cuenta", href: "/login" },
} as const;

export type JourneyPlan = "free" | "premium";

/** «De la idea a la pieza»: un mismo proyecto atraviesa las herramientas y cada paso le pasa algo al siguiente. */
export const journey = {
  eyebrow: "De la idea a la pieza",
  title: ["Un proyecto.", "Cinco pasos.", "Un mismo lugar."],
  lead: "Imaginá un soporte para auriculares. Así lo recorrés en Universo, y el punto exacto donde empieza la membresía.",
  steps: [
    {
      plan: "free" as JourneyPlan,
      verb: "Encontrás el modelo",
      text: "Una sola búsqueda en Cults3D y MyMiniFactory, con filtros por precio, fuente y uso comercial. Cada resultado te lleva al modelo original.",
      handoff: "Con la membresía, «Calcular en Stampa» manda el modelo directo a la Calculadora.",
    },
    {
      plan: "free" as JourneyPlan,
      verb: "Sabés cuánto cobrar",
      text: "Material, tiempo de impresión, energía y margen en un mismo cálculo. Podés probarla sin cuenta.",
      handoff: "Con la membresía, el cálculo se guarda como un producto de tu taller.",
    },
    {
      plan: "premium" as JourneyPlan,
      verb: "Aprendés a imprimirlo bien",
      text: "Cursos y talleres con una ruta armada según tu impresora y tu objetivo, y tu avance clase por clase.",
      handoff: "La ruta recomendada sale de tu perfil: no tenés que explicar tu equipo dos veces.",
    },
    {
      plan: "premium" as JourneyPlan,
      verb: "Lo fabricás y lo registrás",
      text: "Impresoras, filamentos, productos e inventario en un solo lugar. Cada producción descuenta el filamento de la receta y suma unidades terminadas.",
      handoff: "El stock de cada bobina se actualiza solo.",
    },
    {
      plan: "premium" as JourneyPlan,
      verb: "Si algo falla, preguntás",
      text: "Stampy responde con tu contexto (tu perfil, tu taller, la pantalla que ves) y puede sugerirte clases de Academia. Las acciones que prepara las confirmás vos.",
      handoff: "Y vuelve a empezar: la próxima idea ya tiene camino.",
    },
  ],
  closing: "La cuenta gratuita cubre los dos primeros pasos. Los otros tres son la membresía.",
  planLabels: { free: "Gratis", premium: "Membresía" } as Record<JourneyPlan, string>,
} as const;

export interface ComparisonRow {
  name: string;
  /** `null` = no incluido en la cuenta gratuita. */
  free: string | null;
  premium: string;
}

export const comparison = {
  eyebrow: "Gratis y Premium",
  title: ["Empezá gratis.", "Sumá la membresía", "cuando la necesites."],
  lead: "Crear tu cuenta no activa ninguna membresía. La membresía Premium es una evolución opcional de esa misma cuenta.",
  freeHeading: "Cuenta gratuita",
  premiumHeading: "Membresía Premium",
  notIncluded: "No incluido",
  rows: [
    {
      name: "Calculadora",
      free: "Sin cuenta, con una configuración de ejemplo. Con cuenta, guardás tus valores y elegís impresoras y filamentos de catálogo.",
      premium: "Con tus impresoras y filamentos reales, y guardás el cálculo como producto.",
    },
    {
      name: "Explorar Modelos",
      free: "Buscador de Cults3D y MyMiniFactory. Con cuenta, filtros y orden completos.",
      premium: "Suma «Calcular en Stampa» en cada modelo.",
    },
    {
      name: "Tu perfil",
      free: "Tus datos, contraseña y estado de membresía.",
      premium: "Incluido.",
    },
    { name: "Mi Taller", free: null, premium: "Impresoras, filamentos, productos e inventario con tu stock real." },
    { name: "Academia", free: null, premium: "Cursos y talleres, ruta recomendada y avance por clase." },
    { name: "Stampy IA", free: null, premium: "Asistente de impresión 3D con el contexto de tu taller." },
    { name: "Librería STL", free: null, premium: "Modelos propios de Stampa con visor 3D y descarga." },
    { name: "Redes y Canales", free: null, premium: "Acceso a los espacios de comunidad." },
  ] as readonly ComparisonRow[],
} as const;

export const pricing = {
  name: "Membresía Premium",
  unit: "por mes",
  details: ["Renovación mensual", "Se contrata desde tu cuenta, con Mercado Pago", "El valor y los medios de pago se muestran antes de confirmar"],
  /** Estado provisional: solo se usa si el precio no se pudo leer de la base. */
  provisional: "El valor mensual se muestra antes de confirmar la contratación.",
  note: "Premium es opcional: primero creás tu cuenta gratuita y después, si querés, la sumás.",
} as const;

export const faq = {
  eyebrow: "Preguntas frecuentes",
  title: ["Lo que conviene", "saber antes de empezar."],
  items: [
    {
      question: "¿Registrarme activa una membresía Premium?",
      answer: "No. Registrarte crea una cuenta gratuita. Premium es opcional y se contrata aparte, desde tu cuenta, cuando decidas.",
    },
    {
      question: "¿Necesito tarjeta para crear la cuenta?",
      answer: "No. El registro pide tu nombre, tu email y una contraseña (y, si tenés uno, un código). Después confirmás tu email.",
    },
    {
      question: "¿Qué puedo hacer gratis?",
      answer:
        "Usar la Calculadora (sin cuenta con una configuración de ejemplo; con cuenta guardás tus valores y elegís impresoras y filamentos de catálogo), buscar modelos en Explorar Modelos con todos los filtros y administrar tu perfil.",
    },
    {
      question: "¿Qué suma la membresía Premium?",
      answer: "Mi Taller, Academia, Stampy IA, la Librería STL y el acceso a Redes y Canales. Además, la Calculadora trabaja con tus impresoras y filamentos reales.",
    },
    {
      question: "¿Cómo se paga Premium?",
      answer: "A través de Mercado Pago, con renovación mensual. El valor y los medios de pago disponibles se muestran antes de confirmar.",
    },
    {
      question: "¿Necesito experiencia previa en impresión 3D?",
      answer: "No. Academia tiene cursos de nivel principiante y talleres de nivel principiante e intermedio, y la ruta recomendada se arma según tu impresora y tu objetivo.",
    },
    {
      question: "¿Explorar Modelos aloja o vende modelos?",
      answer:
        "No. Es un buscador: cada resultado te lleva a la página original del modelo, en su plataforma. Que un modelo sea gratis no significa que permita uso comercial, así que verificá siempre la licencia en la fuente.",
    },
    {
      question: "¿Cómo funciona Stampy?",
      answer:
        "Es un asistente de impresión 3D que usa el contexto de tu cuenta y de la pantalla donde estás. Si prepara una acción en tu taller, no se aplica hasta que la confirmes. Es un asistente experimental: revisá los datos importantes.",
    },
  ],
} as const;

export const finalCta = {
  title: ["Tu próxima pieza", "empieza acá."],
  lead: "Creá tu cuenta gratuita y empezá por la Calculadora. La membresía, cuando la necesites.",
  micro: "Crear la cuenta no activa ninguna membresía.",
} as const;

export const footerContent = {
  brand: "Universo Stampa",
  tagline: "Formación y herramientas para aprender, organizar y hacer crecer tu taller de impresión 3D.",
  toolsHeading: "Empezá",
  tools: [
    { label: "Comenzar gratis", href: "/registro" },
    { label: "Calculadora", href: "/calculadora" },
    { label: "Explorar Modelos", href: "/explorar-modelos" },
    { label: "Ingresar", href: "/login" },
  ],
  communityHeading: "Comunidad",
  communityEmpty: "Los canales de comunidad se publican acá cuando están configurados.",
  legalHeading: "Información legal",
  legalPending: "pendiente",
  previewNote: "Vista previa interna de la nueva landing. Los documentos legales están pendientes de aprobación y esta página todavía no está lista para cobrar públicamente.",
} as const;
