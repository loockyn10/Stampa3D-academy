// Tutoriales de Inicio y Configuración. Contenido verificado contra home-dashboard.tsx y configuracion/page.tsx.

import type { TutorialDefinition } from "../types";

export const dashboardTutorial: TutorialDefinition = {
  id: "dashboard",
  toolName: "Inicio",
  title: "Tu punto de partida",
  description: "Desde Inicio llegás a las herramientas y retomás lo que dejaste a medias.",
  version: 1,
  steps: [
    {
      id: "accesos",
      title: "Accesos rápidos",
      text: "Con un toque llegás a las herramientas principales de Universo Stampa.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "bot", title: "Stampy", tone: "accent" },
          { icon: "calculator", title: "Calculadora" },
          { icon: "compass", title: "Explorar Modelos" },
          { icon: "graduation-cap", title: "Academia" },
          { icon: "wrench", title: "Mi Taller" },
          { icon: "briefcase", title: "Mi Negocio" },
        ],
      },
    },
    {
      id: "resumen",
      title: "Retomá donde quedaste",
      text: "Si tenés un curso empezado, aparece para continuar. Mi Taller y Mi Negocio muestran un resumen de tu actividad.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "graduation-cap", title: "Continuar curso", tone: "accent" },
          { icon: "wrench", title: "Resumen de Mi Taller" },
          { icon: "briefcase", title: "Resumen de Mi Negocio" },
        ],
      },
    },
    {
      id: "novedades",
      title: "Sorteos y novedades",
      text: "Mirá el próximo sorteo y los modelos nuevos de la Librería STL.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "gift", title: "Sorteos", text: "El próximo sorteo" },
          { icon: "boxes", title: "Librería STL", text: "Modelos nuevos" },
        ],
      },
    },
  ],
};

export const settingsTutorial: TutorialDefinition = {
  id: "settings",
  toolName: "Configuración",
  title: "Dejá todo a tu medida",
  description: "Tu cuenta, tu negocio y los valores que usa tu taller.",
  version: 1,
  steps: [
    {
      id: "areas",
      title: "Una pestaña por área",
      text: "Cambiá de pestaña para ajustar cada parte. Ves solo las áreas de las herramientas que tenés disponibles.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "user", title: "Cuenta", text: "Datos y seguridad" },
          { icon: "store", title: "Negocio", text: "Datos del negocio" },
          { icon: "calculator", title: "Calculadora", text: "Costos y tipos de producto" },
          { icon: "bot", title: "Stampy", text: "Preferencias del asistente" },
        ],
      },
    },
    {
      id: "apariencia",
      title: "Elegí la apariencia",
      text: "En Cuenta → Apariencia elegís modo claro, oscuro o automático (sigue a tu dispositivo).",
      illustration: {
        kind: "cards",
        items: [
          { icon: "palette", title: "Claro" },
          { icon: "palette", title: "Oscuro" },
          { icon: "settings", title: "Automático", text: "Sigue a tu dispositivo", tone: "accent" },
        ],
      },
    },
    {
      id: "costos",
      title: "Tus costos, una sola vez",
      text: "Los valores de la Calculadora quedan guardados y se usan en todos tus cálculos.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "settings", label: "Costos y tipos de producto" },
          { icon: "calculator", label: "Todos tus cálculos" },
        ],
      },
    },
  ],
};
