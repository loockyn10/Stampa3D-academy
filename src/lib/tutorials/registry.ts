// Registro central de tutoriales. Para agregar uno nuevo ver docs/TUTORIALS.md:
//   1. definirlo en `definitions/*.ts`;
//   2. sumarlo a TUTORIAL_LIST;
//   3. mapear su ruta en TUTORIAL_ROUTES.
// El modal, la persistencia, el botón "¿Cómo funciona?" y el video no requieren más cambios.

import { businessTutorial, budgetsTutorial } from "./definitions/business";
import { coursesTutorial, rafflesTutorial, stampyTutorial } from "./definitions/community";
import { dashboardTutorial, settingsTutorial } from "./definitions/general";
import { calculatorTutorial, makerTutorial, modelSearchTutorial, stlLibraryTutorial } from "./definitions/tools";
import { printersTutorial, productsTutorial, stockTutorial, workshopTutorial } from "./definitions/workshop";
import type { TutorialDefinition, TutorialRoute } from "./types";

export const TUTORIAL_LIST: readonly TutorialDefinition[] = [
  dashboardTutorial,
  coursesTutorial,
  stampyTutorial,
  calculatorTutorial,
  modelSearchTutorial,
  stlLibraryTutorial,
  makerTutorial,
  workshopTutorial,
  printersTutorial,
  stockTutorial,
  productsTutorial,
  businessTutorial,
  budgetsTutorial,
  rafflesTutorial,
  settingsTutorial,
];

export const TUTORIALS: Readonly<Record<string, TutorialDefinition>> = Object.fromEntries(
  TUTORIAL_LIST.map((tutorial) => [tutorial.id, tutorial]),
);

/**
 * Rutas con tutorial. Los `tutorialId` que ya existían (dashboard, courses, calculator, budgets, products, stock,
 * printers, stl_library, raffles, settings, stampy) no cambian: son las claves de `user_tool_tutorial_views`.
 * Pantallas de trabajo pesado (editores de Maker, venta rápida, etc.) no abren la guía solas: solo los hubs.
 */
export const TUTORIAL_ROUTES: readonly TutorialRoute[] = [
  { match: "/", tutorialId: "dashboard", exact: true },
  { match: "/stampy", tutorialId: "stampy" },
  { match: "/academia", tutorialId: "courses" },
  { match: "/cursos", tutorialId: "courses" },
  { match: "/talleres", tutorialId: "courses" },
  { match: "/calculadora", tutorialId: "calculator" },
  { match: "/explorar-modelos", tutorialId: "model_search" },
  { match: "/libreria-stl", tutorialId: "stl_library" },
  { match: "/stampa-maker", tutorialId: "maker", exact: true },
  { match: "/mi-taller", tutorialId: "workshop", exact: true },
  { match: "/mi-taller/impresoras", tutorialId: "printers" },
  { match: "/mi-taller/filamentos", tutorialId: "stock" },
  { match: "/mi-taller/inventario", tutorialId: "stock" },
  { match: "/mi-taller/productos", tutorialId: "products" },
  { match: "/stock", tutorialId: "stock" },
  { match: "/productos", tutorialId: "products" },
  { match: "/mi-negocio", tutorialId: "business", exact: true },
  { match: "/presupuestos", tutorialId: "budgets" },
  { match: "/sorteos", tutorialId: "raffles" },
  { match: "/configuracion", tutorialId: "settings" },
];

/** Rutas donde nunca hay tutorial (acceso, administración, landing). */
const EXCLUDED_PREFIXES = ["/landing", "/login", "/registro", "/sin-acceso", "/admin"] as const;

export function getTutorial(id: string | null | undefined): TutorialDefinition | null {
  return (id && TUTORIALS[id]) || null;
}

export function resolveTutorialId(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  if (EXCLUDED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;
  for (const route of TUTORIAL_ROUTES) {
    if (pathname === route.match) return route.tutorialId;
    if (!route.exact && pathname.startsWith(`${route.match}/`)) return route.tutorialId;
  }
  return null;
}
