export type StampyKnowledgeItem = {
  id: string;
  title: string;
  category: "tool" | "flow" | "section";
  route?: string;
  shortDescription: string;
  whenToRecommend: string[];
  howToUse: string[];
  keywords: string[];
  relatedTools?: string[];
  priority?: number;
};

export const STAMPY_APP_KNOWLEDGE: StampyKnowledgeItem[] = [
  {
    id: "calculator-basic",
    title: "Calculadora básica",
    category: "tool",
    route: "/calculadora",
    shortDescription: "Sirve para estimar precios rápidamente usando markupes simples y configuraciones predefinidas.",
    whenToRecommend: [
      "cuando el usuario quiere sacar un precio rápido",
      "cuando necesita una estimación simple",
      "cuando no quiere cargar todos los costos avanzados",
      "cuando pregunta cuánto cobrar de forma general"
    ],
    howToUse: [
      "entrar a Calculadora",
      "usar el modo básico",
      "elegir o configurar el tipo de producto",
      "cargar los datos principales",
      "revisar el precio sugerido",
      "usar modo avanzado si necesita más precisión"
    ],
    keywords: [
      "calculadora", "calcular precio", "precio rápido", "estimar", "cuanto cobrar", "cobrar", "costo", "markup", "básico", "precio de venta", "rentabilidad"
    ],
    relatedTools: ["calculator-advanced", "products", "budgets"],
    priority: 90
  },
  {
    id: "calculator-advanced",
    title: "Calculadora avanzada",
    category: "tool",
    route: "/calculadora",
    shortDescription: "Sirve para calcular un precio más real considerando material, tiempo, electricidad, mano de obra, margen, envío, comisión, mantenimiento y amortización.",
    whenToRecommend: [
      "cuando el usuario quiere calcular un precio real",
      "cuando pregunta cuánto cobrar una pieza concreta",
      "cuando quiere contemplar material, tiempo y margen",
      "cuando necesita una cotización más precisa",
      "cuando quiere guardar un cálculo como producto"
    ],
    howToUse: [
      "entrar a Calculadora",
      "abrir modo avanzado",
      "cargar material, gramos y porcentaje de error",
      "cargar horas y minutos de impresión",
      "revisar electricidad y costo de máquina",
      "sumar mano de obra o postprocesos si corresponde",
      "definir margen",
      "considerar envío o comisión de plataforma si aplica",
      "guardar como producto si es una pieza recurrente",
      "usar Presupuestos si se lo va a enviar a un cliente"
    ],
    keywords: [
      "calculadora avanzada", "costo real", "margen", "filamento", "gramos", "tiempo de impresión", "electricidad", "mano de obra", "comisión", "mantenimiento", "amortización", "precio sugerido", "no sé cuánto cobrar", "cuanto cobrar", "cotizar"
    ],
    relatedTools: ["calculator-basic", "products", "budgets", "stock"],
    priority: 100
  },
  {
    id: "budgets",
    title: "Presupuestos",
    category: "tool",
    route: "/presupuestos",
    shortDescription: "Sirve para crear presupuestos profesionales para clientes, agregar productos o items, aplicar descuentos y descargar PDF.",
    whenToRecommend: [
      "cuando el usuario quiere hacer un presupuesto",
      "cuando quiere enviar un precio a un cliente",
      "cuando habla de cotización",
      "cuando necesita un PDF",
      "cuando ya calculó un precio y quiere presentarlo bien"
    ],
    howToUse: [
      "entrar a Presupuestos",
      "crear o elegir un cliente",
      "agregar productos o items",
      "revisar cantidades y precios",
      "aplicar descuento si corresponde",
      "guardar el presupuesto",
      "descargar el PDF para enviarlo al cliente"
    ],
    keywords: [
      "presupuesto", "presupuestador", "cotización", "cotizar", "cliente", "enviar precio", "pdf de presupuesto", "descuento", "presupuesto profesional", "documento", "enviar presupuesto"
    ],
    relatedTools: ["calculator-advanced", "products", "profile"],
    priority: 100
  },
  {
    id: "products",
    title: "Productos",
    category: "tool",
    route: "/productos",
    shortDescription: "Sirve para guardar piezas o productos recurrentes con costos, precio de venta, tiempo de impresión, material usado, imagen y stock.",
    whenToRecommend: [
      "cuando el usuario vende una pieza repetidamente",
      "cuando quiere guardar un cálculo",
      "cuando quiere armar un catálogo interno",
      "cuando quiere reutilizar productos en presupuestos",
      "cuando quiere controlar stock de producto terminado"
    ],
    howToUse: [
      "entrar a Productos",
      "crear un nuevo producto",
      "cargar nombre, descripción e imagen si corresponde",
      "asociar filamento, gramos y tiempo de impresión",
      "revisar costo base y precio de venta",
      "guardar el producto",
      "usarlo después en Presupuestos o Stock"
    ],
    keywords: [
      "producto", "productos", "catálogo", "pieza recurrente", "guardar cálculo", "vender siempre lo mismo", "stock producto", "precio producto"
    ],
    relatedTools: ["calculator-advanced", "budgets", "stock"],
    priority: 85
  },
  {
    id: "filament-stock",
    title: "Stock de filamentos",
    category: "tool",
    route: "/stock?tab=filamentos",
    shortDescription: "Sirve para controlar cuántos gramos quedan de cada filamento y registrar entradas o salidas de material.",
    whenToRecommend: [
      "cuando el usuario quiere organizar su stock",
      "cuando quiere saber cuánto filamento le queda",
      "cuando habla de inventario",
      "cuando necesita descontar material usado",
      "cuando quiere evitar quedarse sin filamento"
    ],
    howToUse: [
      "entrar a Stock",
      "cargar los filamentos disponibles",
      "registrar gramos totales y gramos restantes",
      "sumar stock cuando compra material",
      "restar stock cuando usa material",
      "revisar movimientos para tener control del inventario"
    ],
    keywords: [
      "stock", "filamento", "filamentos", "gramos restantes", "inventario", "material disponible", "descontar filamento", "controlar material", "entrada de stock", "salida de stock"
    ],
    relatedTools: ["products", "calculator-advanced"],
    priority: 90
  },
  {
    id: "finished-product-stock",
    title: "Stock de productos terminados",
    category: "tool",
    route: "/stock?tab=productos",
    shortDescription: "Sirve para controlar unidades disponibles de productos ya impresos y listos para vender.",
    whenToRecommend: [
      "cuando el usuario imprime productos por adelantado",
      "cuando quiere saber cuántas unidades terminadas tiene",
      "cuando vende productos repetidos",
      "cuando necesita organizar producción"
    ],
    howToUse: [
      "entrar a Stock",
      "elegir el producto terminado",
      "sumar unidades cuando se imprimen",
      "restar unidades cuando se venden o entregan",
      "revisar cantidades disponibles"
    ],
    keywords: [
      "stock producto", "productos terminados", "unidades", "piezas impresas", "inventario de productos", "producción", "unidades disponibles"
    ],
    relatedTools: ["products", "budgets", "filament-stock"],
    priority: 80
  },
  {
    id: "academy",
    title: "Academia",
    category: "section",
    route: "/academia",
    shortDescription: "Centro de aprendizaje con cursos, talleres y tu ruta recomendada.",
    whenToRecommend: [
      "cuando el usuario pregunta por dónde empezar",
      "cuando quiere ver su ruta de aprendizaje recomendada",
      "cuando busca el hub central de aprendizaje",
      "cuando no sabe si elegir curso o taller"
    ],
    howToUse: [
      "entrar a Academia",
      "revisar la ruta recomendada según tu perfil",
      "explorar cursos y talleres disponibles"
    ],
    keywords: [
      "academia", "ruta recomendada", "por donde empezar", "aprender desde cero", "hub", "ruta de aprendizaje", "cursos y talleres"
    ],
    relatedTools: ["courses", "workshops"],
    priority: 100
  },
  {
    id: "workshops",
    title: "Talleres",
    category: "section",
    route: "/talleres",
    shortDescription: "Proyectos prácticos paso a paso para aplicar lo aprendido.",
    whenToRecommend: [
      "cuando el usuario quiere hacer un proyecto práctico",
      "cuando busca aplicar conocimientos",
      "cuando pregunta por talleres o productos específicos"
    ],
    howToUse: [
      "entrar a Talleres",
      "elegir un taller práctico",
      "seguir el paso a paso del proyecto"
    ],
    keywords: [
      "taller", "talleres", "proyecto práctico", "proyectos", "producto para hacer", "ideas de productos", "práctica"
    ],
    relatedTools: ["academy", "courses"],
    priority: 95
  },
  {
    id: "courses",
    title: "Cursos",
    category: "section",
    route: "/cursos",
    shortDescription: "Sirve para aprender impresión 3D de forma estructurada paso a paso mediante cursos, módulos y clases.",
    whenToRecommend: [
      "cuando el usuario quiere aprender de forma teórica y estructurada",
      "cuando tiene un problema que se explica mejor en una clase",
      "cuando pregunta por Bambu Studio, OrcaSlicer, impresión desde cero o Fusion 360",
      "cuando necesita una explicación detallada paso a paso"
    ],
    howToUse: [
      "entrar a Cursos",
      "elegir un curso estructurado",
      "avanzar por módulos y clases",
      "marcar progreso",
      "volver a clases recomendadas cuando tenga un problema puntual"
    ],
    keywords: [
      "curso", "cursos", "formación estructurada", "módulo", "impresión 3d desde cero", "bambu studio", "orca slicer", "fusion 360", "slicer"
    ],
    relatedTools: ["academy", "workshops", "stampy"],
    priority: 90
  },
  {
    id: "stl-library",
    title: "Librería STL",
    category: "section",
    route: "/libreria-stl",
    shortDescription: "Sirve para encontrar y descargar modelos STL organizados por categorías, modelos y variantes.",
    whenToRecommend: [
      "cuando el usuario busca archivos STL",
      "cuando quiere descargar modelos",
      "cuando pregunta por diseños listos para imprimir",
      "cuando necesita variantes de un modelo"
    ],
    howToUse: [
      "entrar a Librería STL",
      "elegir una categoría",
      "abrir un modelo",
      "seleccionar una variante",
      "descargar el archivo correspondiente"
    ],
    keywords: [
      "stl", "librería stl", "archivo", "modelo", "modelos", "descargar stl", "variante", "diseño", "archivo 3d"
    ],
    relatedTools: ["courses"],
    priority: 75
  },
  {
    id: "raffles",
    title: "Sorteos",
    category: "section",
    route: "/sorteos",
    shortDescription: "Sirve para ver sorteos activos, historial de sorteos y beneficios para miembros.",
    whenToRecommend: [
      "cuando el usuario pregunta por sorteos",
      "cuando quiere saber beneficios de miembro",
      "cuando habla de impresoras sorteadas o premios"
    ],
    howToUse: [
      "entrar a Sorteos",
      "revisar sorteo activo",
      "ver condiciones de participación",
      "consultar historial de ganadores"
    ],
    keywords: [
      "sorteo", "sorteos", "premio", "premios", "impresora", "ganar", "participación", "beneficios", "participar", "ganador"
    ],
    relatedTools: ["community"],
    priority: 60
  },
  {
    id: "community",
    title: "Comunidad",
    category: "section",
    route: "/canales",
    shortDescription: "Sirve para conectar con la comunidad de Academia Stampa mediante canales como WhatsApp, Telegram, YouTube o Instagram.",
    whenToRecommend: [
      "cuando el usuario quiere consultar con otros miembros",
      "cuando busca comunidad",
      "cuando pregunta por grupos",
      "cuando quiere compartir avances o dudas"
    ],
    howToUse: [
      "entrar a la sección de comunidad",
      "elegir el canal disponible",
      "unirse al grupo o red correspondiente"
    ],
    keywords: [
      "comunidad", "whatsapp", "telegram", "grupo", "miembros", "ayuda", "compartir", "instagram", "youtube"
    ],
    relatedTools: ["courses", "stampy"],
    priority: 65
  },
  {
    id: "profile",
    title: "Perfil del negocio",
    category: "section",
    route: "/perfil",
    shortDescription: "Sirve para configurar datos personales o del negocio, como nombre, logo, teléfono, ciudad y datos visibles en presupuestos.",
    whenToRecommend: [
      "cuando el usuario quiere personalizar sus datos",
      "cuando quiere que sus presupuestos tengan información del negocio",
      "cuando pregunta por logo, nombre de empresa o datos de contacto"
    ],
    howToUse: [
      "entrar a Perfil",
      "completar datos personales o del negocio",
      "cargar logo si corresponde",
      "guardar cambios",
      "usar esos datos en presupuestos y presentación profesional"
    ],
    keywords: [
      "perfil", "negocio", "logo", "empresa", "datos", "teléfono", "ciudad", "dirección", "presupuesto con logo", "información del negocio"
    ],
    relatedTools: ["budgets"],
    priority: 70
  }
];
