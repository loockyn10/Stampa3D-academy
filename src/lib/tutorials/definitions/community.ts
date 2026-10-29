// Tutoriales de Academia, Stampy y Sorteos.
// Contenido verificado contra academia/page.tsx, stampy/page.tsx y raffles-view.tsx (reglas de participación).

import type { TutorialDefinition } from "../types";

export const coursesTutorial: TutorialDefinition = {
  id: "courses",
  toolName: "Academia",
  title: "Aprendé a tu ritmo",
  description: "Cursos, talleres y una ruta recomendada según tu perfil.",
  version: 1,
  steps: [
    {
      id: "caminos",
      title: "Cursos y talleres",
      text: "Los cursos enseñan de forma estructurada. Los talleres te hacen construir proyectos reales paso a paso.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "book-open", title: "Cursos", text: "De fundamentos a herramientas avanzadas", tone: "accent" },
          { icon: "pen-tool", title: "Talleres", text: "Proyectos reales paso a paso" },
        ],
      },
    },
    {
      id: "ruta",
      title: "Seguí tu ruta recomendada",
      text: "Según tu perfil, la Academia te sugiere por dónde empezar entre los cursos publicados.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "user", label: "Tu perfil" },
          { icon: "graduation-cap", label: "Ruta recomendada" },
          { icon: "book-open", label: "Tu primer curso" },
        ],
      },
    },
    {
      id: "avanzar",
      title: "Avanzá lección por lección",
      text: "Abrí un curso y seguí sus lecciones. Desde Inicio podés retomar el curso que dejaste empezado.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "book-open", label: "Abrí un curso" },
          { icon: "clipboard-list", label: "Completá lecciones" },
          { icon: "home", label: "Retomá desde Inicio" },
        ],
      },
    },
  ],
};

export const stampyTutorial: TutorialDefinition = {
  id: "stampy",
  toolName: "Stampy",
  title: "Tu asistente de impresión 3D",
  description: "Consultale dudas y pedile ayuda con tu taller.",
  version: 1,
  steps: [
    {
      id: "preguntar",
      title: "Preguntale lo que necesites",
      text: "Escribí tu consulta o tocá una sugerencia para empezar.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "wrench", title: "Solucionar un problema de impresión" },
          { icon: "calculator", title: "Calcular el precio de un producto" },
          { icon: "boxes", title: "Consultar mi inventario" },
          { icon: "graduation-cap", title: "Aprender impresión 3D" },
          { icon: "lightbulb", title: "Buscar ideas de productos" },
        ],
      },
    },
    {
      id: "contexto",
      title: "Responde con contexto",
      text: "Stampy usa lo que ves en pantalla como contexto, así tus respuestas son más precisas. Lo tenés a mano desde cualquier página.",
      illustration: {
        kind: "chat",
        messages: [
          { from: "user", text: "¿Qué filamentos tengo cargados?" },
          { from: "stampy", text: "Mira tus datos y te responde." },
        ],
      },
    },
    {
      id: "acciones",
      title: "Acciones que vos confirmás",
      text: "Pedile tareas del taller. Stampy las prepara y no se aplican hasta que las confirmes.",
      illustration: {
        kind: "chat",
        messages: [
          { from: "user", text: "Descontame 20g de PLA" },
          { from: "stampy", text: "Prepara la acción y te pide confirmar." },
        ],
      },
    },
  ],
};

export const rafflesTutorial: TutorialDefinition = {
  id: "raffles",
  toolName: "Sorteos",
  title: "Cómo participar en los sorteos",
  description: "Participás con tu cuenta activa. Cuantas más chances tengas, más participaciones sumás.",
  version: 1,
  steps: [
    {
      id: "chances",
      title: "Tus chances",
      text: "Con acceso activo ya participás: todos tienen 1 chance base y los niveles Gold y Elite tienen 2.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "gift", title: "Tus chances", text: "Base + adicionales", tone: "accent" },
          { icon: "sparkles", title: "Chances adicionales", text: "Acreditadas a tu cuenta" },
        ],
      },
    },
    {
      id: "invitar",
      title: "Invitá con tu enlace",
      text: "Compartí tu enlace personal. Cuando alguien crea su cuenta con él, la invitación queda registrada a tu nombre.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "link", label: "Tu enlace" },
          { icon: "users", label: "Alguien se registra" },
          { icon: "user", label: "Invitación a tu nombre" },
        ],
      },
    },
    {
      id: "resultados",
      title: "Mirá los resultados",
      text: "El equipo de Stampa realiza el sorteo en la fecha indicada. Los ganadores de cada premio aparecen en \"Sorteos finalizados\".",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "gift", label: "Sorteo activo" },
          { icon: "clipboard-list", label: "Fecha del sorteo" },
          { icon: "package-check", label: "Sorteos finalizados", hint: "Ganadores por premio" },
        ],
      },
    },
  ],
};
