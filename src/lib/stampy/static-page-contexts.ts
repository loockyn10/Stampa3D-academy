export type StampyStaticPageContext = {
  title: string;
  context: string;
  suggestedQuestions?: string[];
};

export function getStaticStampyPageContext(pathname: string): StampyStaticPageContext | null {
  const routes = [
    {
      pattern: "/calculadora",
      match: "exact",
      title: "Calculadora",
      context:
        "El usuario está en la calculadora de precios de impresión 3D. Ayudalo a entender costos, filamento, tiempo de impresión, electricidad, margen, markup, tipo de producto y precio final. Respondé breve y práctico.",
      suggestedQuestions: [
        "¿Cómo calculo mejor mi precio?",
        "¿Qué margen me conviene usar?",
        "¿Por qué me da este costo?"
      ]
    },
    {
      pattern: "/stock",
      match: "exact",
      title: "Stock",
      context:
        "El usuario está gestionando stock de filamentos, productos terminados y partes. Ayudalo con movimientos, descuentos por producción, control de faltantes y stock bajo.",
      suggestedQuestions: [
        "¿Cómo descuento filamento?",
        "¿Cómo controlo stock bajo?",
        "¿Qué significa este movimiento?"
      ]
    },
    {
      pattern: "/sorteos",
      match: "exact",
      title: "Sorteos",
      context:
        "El usuario está en la sección de sorteos. Ayudalo a entender participaciones, código de referido y beneficios por invitar amigos. No des instrucciones largas.",
      suggestedQuestions: [
        "¿Cómo sumo participaciones?",
        "¿Dónde comparto mi código?",
        "¿Qué pasa si alguien se suscribe con mi referido?"
      ]
    },
    {
      pattern: "/productos",
      match: "exact",
      title: "Productos",
      context:
        "El usuario está gestionando productos. Ayudalo con costos guardados, precios de venta, productos simples, productos armables, partes y relación con stock.",
      suggestedQuestions: [
        "¿Cómo creo un producto?",
        "¿Qué diferencia hay entre simple y armable?",
        "¿Cómo actualizo el costo?"
      ]
    },
    {
      pattern: "/presupuestos",
      match: "exact",
      title: "Presupuestos",
      context:
        "El usuario está en presupuestos. Ayudalo a armar presupuestos claros, revisar precios, explicar costos, márgenes, descuentos y datos del cliente.",
      suggestedQuestions: [
        "¿Cómo armo este presupuesto?",
        "¿Estoy cobrando bien?",
        "¿Qué debería incluir?"
      ]
    },
    {
      pattern: "/academia",
      match: "exact",
      title: "Academia",
      context:
        "El usuario está en el hub de Academia. Ayudalo a interpretar rutas recomendadas, cursos, talleres y próximos pasos.",
      suggestedQuestions: [
        "¿Por dónde empiezo?",
        "¿Qué ruta me conviene?",
        "¿Qué curso sigue después?"
      ]
    },
    {
      pattern: "/cursos",
      match: "prefix",
      title: "Cursos",
      context:
        "El usuario está explorando cursos o viendo contenido educativo. Actuá como tutor de aprendizaje, ayudalo a entender conceptos y a elegir próximos pasos sin inventar cursos inexistentes.",
      suggestedQuestions: [
        "¿Qué curso me conviene seguir?",
        "¿Podés explicarme esto?",
        "¿Qué debería practicar después?"
      ]
    },
    {
      pattern: "/talleres",
      match: "prefix",
      title: "Talleres",
      context:
        "El usuario está explorando talleres prácticos. Ayudalo a elegir proyectos, entender qué se va a construir y conectar el taller con calculadora, productos y stock.",
      suggestedQuestions: [
        "¿Qué taller me conviene hacer?",
        "¿Qué necesito para este proyecto?",
        "¿Esto me sirve para vender?"
      ]
    },
    {
      pattern: "/libreria-stl",
      match: "exact",
      title: "Librería STL",
      context:
        "El usuario está en la librería STL. Ayudalo a buscar modelos, entender dificultad, uso recomendado y descarga de archivos.",
      suggestedQuestions: [
        "¿Qué modelo me conviene descargar?",
        "¿Qué significa la dificultad?",
        "¿Cómo uso este STL?"
      ]
    },
    {
      pattern: "/configuracion",
      match: "exact",
      title: "Configuración",
      context:
        "El usuario está configurando su taller, perfil, impresoras, filamentos y datos de cálculo. Ayudalo a cargar datos correctamente.",
      suggestedQuestions: [
        "¿Qué datos tengo que cargar?",
        "¿Cómo configuro mi impresora?",
        "¿Por qué es importante configurar filamentos?"
      ]
    }
  ];

  // Primero exact
  const exact = routes.find((route) => route.match === "exact" && route.pattern === pathname);
  if (exact) return exact;

  // Luego prefix, priorizando el pattern más largo
  const prefix = routes
    .filter((route) => route.match === "prefix" && pathname.startsWith(route.pattern))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0];

  return prefix ?? null;
}
