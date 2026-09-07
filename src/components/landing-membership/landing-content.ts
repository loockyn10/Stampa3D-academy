export const landingPrimaryCta = {
  label: "Activar membresía",
  href: "/registro",
} as const;

export const quickProofItems = [
  {
    value: "Una ruta clara",
    label: "para aprender",
    description: "Cursos y talleres organizados por nivel.",
  },
  {
    value: "Costos reales",
    label: "para decidir",
    description: "Material, energía, tiempo y margen en un mismo cálculo.",
  },
  {
    value: "Tu stock",
    label: "siempre visible",
    description: "Control de filamentos antes de empezar cada trabajo.",
  },
  {
    value: "Presupuestos",
    label: "listos para enviar",
    description: "Propuestas claras y profesionales para tus clientes.",
  },
] as const;

export const mechanismSteps = [
  {
    number: "01",
    title: "Aprendé correctamente",
    description:
      "Seguí una ruta ordenada para dominar impresión, slicing y diseño.",
  },
  {
    number: "02",
    title: "Calculá y organizá",
    description:
      "Registrá productos, materiales, costos y stock en un solo lugar.",
  },
  {
    number: "03",
    title: "Presupuestá y vendé",
    description:
      "Calculá precios rentables y generá presupuestos profesionales.",
  },
] as const;

export const pillars = [
  {
    key: "learn",
    name: "Aprender",
    result: "Sabé qué aprender después.",
    description:
      "Avanzá con una ruta ordenada para mejorar tus impresiones y tu criterio técnico.",
    features: [
      "Cursos paso a paso",
      "Rutas y talleres",
      "Slicing y mantenimiento",
      "Diseño para impresión 3D",
    ],
    roadmap: [
      "Impresión 3D desde cero",
      "Bambu Studio y OrcaSlicer",
      "Diseño con Fusion 360",
      "Producción, costos y venta",
    ],
  },
  {
    key: "manage",
    name: "Gestionar",
    result: "Tomá decisiones con números reales.",
    description:
      "Ordená la información diaria del taller sin depender de planillas separadas.",
    features: [
      "Calculadora de costos",
      "Presupuestos profesionales",
      "Catálogo de productos",
      "Control de stock",
    ],
  },
  {
    key: "produce",
    name: "Producir",
    result: "Pasá de la idea a la pieza con menos fricción.",
    description:
      "Encontrá recursos que te ayuden a preparar trabajos y ampliar lo que podés ofrecer.",
    features: [
      "Librería STL",
      "Perfiles de impresión",
      "Plantillas de trabajo",
      "Recursos descargables",
    ],
  },
  {
    key: "solve",
    name: "Resolver",
    result: "No te quedes trabado trabajando solo.",
    description:
      "Consultá dudas técnicas y encontrá acompañamiento dentro del mismo ecosistema.",
    features: [
      "Stampy, asistente de la academia",
      "Comunidad de makers",
      "Canales de soporte",
      "Acompañamiento continuo",
    ],
  },
] as const;

export const outcomes = [
  "Cobrar conociendo tus costos y tu margen.",
  "Preparar presupuestos profesionales.",
  "Controlar el filamento disponible.",
  "Seguir una ruta de aprendizaje ordenada.",
  "Organizar productos y trabajos.",
  "Gestionar el taller desde un mismo sistema.",
] as const;

export interface LandingTestimonial {
  name: string;
  photoUrl: string;
  workshop: string;
  quote: string;
  verifiedResult?: string;
}

// TODO: reemplazar por testimonios autorizados y verificables antes de publicarlos.
// La UI ya soporta nombre, fotografía, taller, declaración y resultado opcional.
export const testimonials: LandingTestimonial[] = [];

export const membershipOffer = {
  name: "Membresía Academia Stampa",
  // TODO: leer o sincronizar este valor con public.membership_settings.
  // El repo tiene valores de fallback divergentes, por eso no se publica una cifra fija.
  price: null as string | null,
  priceFallback: "Precio vigente al contratar",
  frequency: "Renovación mensual",
  included: [
    "Cursos, rutas y talleres de impresión 3D",
    "Calculadora de costos y precios",
    "Productos, stock y presupuestos profesionales",
    "Librería STL y recursos de producción",
    "Stampy y acceso a la comunidad",
    "Nuevos contenidos y actualizaciones incluidas",
  ],
  cancellation:
    "Podés cancelar cuando quieras. El acceso continúa hasta finalizar el período ya abonado.",
} as const;

export const faqItems = [
  {
    question: "¿Necesito experiencia previa en impresión 3D?",
    answer:
      "No. La ruta de aprendizaje contempla contenidos desde los primeros pasos y también material para seguir avanzando.",
  },
  {
    question: "¿Los cursos son grabados?",
    answer:
      "La academia organiza cursos y clases para avanzar a tu ritmo.",
    pending: "Confirmar el formato de todos los cursos publicados.",
  },
  {
    question: "¿Qué herramientas incluye la membresía?",
    answer:
      "Incluye calculadora de costos, presupuestos, productos, stock, librería STL, Stampy y los espacios de comunidad disponibles.",
  },
  {
    question: "¿Sirve para cualquier impresora 3D?",
    answer:
      "Los fundamentos y herramientas de gestión no dependen de una marca específica.",
    pending: "Confirmar compatibilidad de contenidos y perfiles por modelo.",
  },
  {
    question: "¿Cómo funciona la calculadora de costos?",
    answer:
      "Reúne material, electricidad, mantenimiento, tiempo e insumos para ayudarte a definir un costo base, un margen y un precio sugerido.",
  },
  {
    question: "¿Cuánto tiempo tengo acceso?",
    answer:
      "Tenés acceso mientras la membresía está activa. Si cancelás, conservás el acceso hasta terminar el período ya abonado.",
  },
  {
    question: "¿Puedo cancelar la membresía?",
    answer:
      "Sí. Podés cancelarla cuando quieras y el acceso permanece activo hasta finalizar el período pagado.",
  },
  {
    question: "¿La librería STL permite uso comercial?",
    answer: "La licencia puede variar según cada recurso.",
    pending: "Publicar las condiciones de uso comercial de la librería STL.",
  },
  {
    question: "¿Qué medios de pago se aceptan?",
    answer:
      "La contratación se completa a través de Mercado Pago. Los medios disponibles se muestran antes de confirmar el pago.",
  },
  {
    question: "¿Cómo funciona el soporte?",
    answer:
      "Podés apoyarte en Stampy y en los canales de comunidad disponibles para resolver dudas y compartir avances.",
  },
] as const;

export const socialLinks = [
  { label: "Instagram", href: "https://instagram.com/extruye" },
  { label: "YouTube", href: "https://youtube.com/extruye" },
  { label: "WhatsApp", href: "https://chat.whatsapp.com/extruye" },
  { label: "Telegram", href: "https://t.me/extruye" },
] as const;

// TODO: reemplazar los estados pendientes por enlaces públicos cuando existan.
export const legalLinks = [
  { label: "Términos y condiciones", href: null },
  { label: "Política de privacidad", href: null },
  { label: "Condiciones de la membresía", href: null },
] as const;
