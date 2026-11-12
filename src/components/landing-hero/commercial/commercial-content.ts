/**
 * Contenido de las secciones comerciales de /landing. Solo datos: los componentes no contienen ningún texto de producto.
 *
 * Reglas (acordadas con el dueño, ver docs/TASKS.md «Landing 5.5»):
 * - El objetivo de la página es la membresía Premium; la cuenta gratuita es la alternativa secundaria.
 * - Solo beneficios verificados en el código (política de acceso, rutas libres y feature flags).
 * - Nada de Stampa Maker, Mi Negocio, Presupuestos, Tienda online, Sorteos, acceso Beta ni códigos de descuento.
 * - Nada sobre cancelación, reembolsos ni condiciones de pago no aprobadas (D045); los legales siguen pendientes.
 * - Nada de la promoción de lanzamiento mientras no esté implementada técnicamente.
 * - El precio NO está acá: se lee de `membership_settings` (ver `membership-price.ts`).
 */

import { PREMIUM_RETURN_TO, premiumAuthHref } from "@/lib/auth/premium-intent";

/**
 * Premium se contrata desde la cuenta, así que «Quiero Premium» no promete un checkout directo: lleva al registro y conserva la
 * intención con el mecanismo existente `returnTo` (ver `sanitizeReturnTo`). Al terminar el alta (y confirmar el email, si corresponde)
 * la persona llega a /sin-acceso, donde está el botón real de contratación; si ya tiene cuenta, /registro y /login la envían ahí.
 */
export { PREMIUM_RETURN_TO };

export const commercialCtas = {
  primary: { label: "Quiero Premium", href: premiumAuthHref("registro") },
  secondary: { label: "Probar la Calculadora", href: "/calculadora" },
  free: { label: "Crear cuenta gratuita", href: "/registro" },
  login: { label: "Ya tengo cuenta", href: premiumAuthHref("login") },
  /** Aclaración junto al botón principal: el flujo real es cuenta primero, contratación después. */
  flowNote: "Primero creás tu cuenta y en el paso siguiente activás Premium con Mercado Pago.",
} as const;

export type JourneyPlan = "free" | "premium";

/** «De la idea a la pieza»: un mismo proyecto atraviesa las herramientas y cada paso le pasa algo al siguiente. */
export const journey = {
  eyebrow: "De la idea a la pieza",
  title: ["Un proyecto.", "Cinco pasos.", "Un mismo lugar."],
  lead: "Imaginá un soporte para auriculares. Así lo recorrés en Universo, con Premium conectando cada paso con el siguiente.",
  steps: [
    {
      plan: "free" as JourneyPlan,
      verb: "Encontrás el modelo",
      text: "Una sola búsqueda en Cults3D y MyMiniFactory, con filtros por precio, fuente y uso comercial. Cada resultado te lleva al modelo original.",
      handoff: "Con Premium, «Calcular en Stampa» manda el modelo directo a la Calculadora.",
    },
    {
      plan: "free" as JourneyPlan,
      verb: "Sabés cuánto cobrar",
      text: "Material, tiempo de impresión, energía y margen en un mismo cálculo. Podés probarla sin cuenta.",
      handoff: "Con Premium, el cálculo se guarda como un producto de tu taller.",
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
  closing: "Premium es lo que conecta los cinco pasos: del modelo al cálculo, del cálculo al producto y del producto a tu taller.",
  planLabels: { free: "Gratis", premium: "Premium" } as Record<JourneyPlan, string>,
} as const;

export interface ComparisonRow {
  name: string;
  /** `null` = no incluido en la cuenta gratuita. */
  free: string | null;
  premium: string;
  /** Si aparece en la lista de beneficios del bloque Premium en móvil (lo que Premium suma de verdad). */
  featured: boolean;
}

export const comparison = {
  eyebrow: "Membresía Premium",
  title: ["Premium reúne", "tu taller, tu formación", "y tu asistente."],
  lead: "Una sola membresía para organizar tu taller con tu stock real, aprender con una ruta armada para tu equipo y resolver dudas con Stampy.",
  freeHeading: "Cuenta gratuita",
  premiumHeading: "Membresía Premium",
  notIncluded: "No incluido",
  /** Bloques de la comparación en pantallas chicas: Premium primero y protagonista, la cuenta gratuita como alternativa. */
  mobile: {
    premiumBadge: "Membresía Premium",
    premiumLead: "Todo lo que suma Premium:",
    freeBadge: "Alternativa",
    freeIntro: "Una forma de empezar con las herramientas básicas:",
    freeMissing: "No incluye",
  },
  rows: [
    {
      name: "Calculadora",
      free: "Sin cuenta, con una configuración de ejemplo. Con cuenta, guardás tus valores y elegís impresoras y filamentos de catálogo.",
      premium: "Con tus impresoras y filamentos reales, y guardás el cálculo como producto.",
      featured: true,
    },
    {
      name: "Explorar Modelos",
      free: "Buscador de Cults3D y MyMiniFactory. Con cuenta, filtros y orden completos.",
      premium: "Suma «Calcular en Stampa» en cada modelo.",
      featured: true,
    },
    {
      name: "Tu perfil",
      free: "Tus datos, contraseña y estado de membresía.",
      premium: "Incluido.",
      featured: false,
    },
    { name: "Mi Taller", free: null, premium: "Impresoras, filamentos, productos e inventario con tu stock real.", featured: true },
    { name: "Academia", free: null, premium: "Cursos y talleres, ruta recomendada y avance por clase.", featured: true },
    { name: "Stampy IA", free: null, premium: "Asistente de impresión 3D con el contexto de tu taller.", featured: true },
    { name: "Librería STL", free: null, premium: "Modelos propios de Stampa con visor 3D y descarga.", featured: true },
    { name: "Redes y Canales", free: null, premium: "Acceso a los espacios de comunidad.", featured: true },
  ] as readonly ComparisonRow[],
} as const;

export const pricing = {
  name: "Membresía Premium",
  unit: "por mes",
  details: ["Renovación mensual", "Se contrata desde tu cuenta, con Mercado Pago", "El valor y los medios de pago se muestran antes de confirmar"],
  /** Estado provisional: solo se usa si el precio no se pudo leer de la base. */
  provisional: "El valor mensual se muestra antes de confirmar la contratación.",
} as const;

export const faq = {
  eyebrow: "Preguntas frecuentes",
  title: ["Lo que conviene", "saber antes de empezar."],
  items: [
    {
      question: "¿Qué incluye la membresía Premium?",
      answer:
        "Mi Taller, Academia, Stampy IA, la Librería STL y el acceso a Redes y Canales. Además, la Calculadora trabaja con tus impresoras y filamentos reales y guarda el cálculo como producto, y cada modelo de Explorar Modelos suma «Calcular en Stampa».",
    },
    {
      question: "¿Cómo se paga Premium?",
      answer: "A través de Mercado Pago, con renovación mensual. El valor y los medios de pago disponibles se muestran antes de confirmar.",
    },
    {
      question: "¿Cómo contrato Premium?",
      answer:
        "Creás tu cuenta con tu nombre, tu email y una contraseña, y confirmás tu email. Con la cuenta lista, activás la membresía con Mercado Pago. Crear la cuenta por sí solo no activa Premium.",
    },
    {
      question: "¿Necesito experiencia previa en impresión 3D?",
      answer: "No. Academia tiene cursos de nivel principiante y talleres de nivel principiante e intermedio, y la ruta recomendada se arma según tu impresora y tu objetivo.",
    },
    {
      question: "¿Cómo funciona Stampy?",
      answer:
        "Es un asistente de impresión 3D, parte de Premium, que usa el contexto de tu cuenta y de la pantalla donde estás. Si prepara una acción en tu taller, no se aplica hasta que la confirmes. Es un asistente experimental: revisá los datos importantes.",
    },
    {
      question: "¿Explorar Modelos aloja o vende modelos?",
      answer:
        "No. Es un buscador: cada resultado te lleva a la página original del modelo, en su plataforma. Que un modelo sea gratis no significa que permita uso comercial, así que verificá siempre la licencia en la fuente.",
    },
    {
      question: "¿Qué puedo usar sin Premium?",
      answer:
        "La Calculadora (sin cuenta con una configuración de ejemplo; con cuenta guardás tus valores y elegís impresoras y filamentos de catálogo), Explorar Modelos con todos los filtros y tu perfil.",
    },
  ],
} as const;

export const finalCta = {
  title: ["Tu próxima pieza", "empieza acá."],
  lead: "Premium reúne tu taller, la Academia y Stampy en un solo lugar, listo para tu próximo proyecto.",
} as const;

export const footerContent = {
  brand: "Universo Stampa",
  tagline: "Formación y herramientas para aprender, organizar y hacer crecer tu taller de impresión 3D.",
  toolsHeading: "Empezá",
  tools: [
    { label: "Quiero Premium", href: commercialCtas.primary.href },
    { label: "Calculadora", href: "/calculadora" },
    { label: "Explorar Modelos", href: "/explorar-modelos" },
    { label: "Ingresar", href: "/login" },
  ],
  communityHeading: "Comunidad",
  communityEmpty: "Los canales de comunidad se publican acá cuando están configurados.",
  legalHeading: "Información legal",
  legalPending: "pendiente",
} as const;
