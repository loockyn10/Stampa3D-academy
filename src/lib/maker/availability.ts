/**
 * Disponibilidad de las herramientas de Stampa Maker. Jarros 3D está congelado: Beta / solo administradores
 * (desarrollo pausado temporalmente). El rol sale de `capabilities.accessAdmin` (misma infraestructura que /admin).
 */
export interface MakerToolAvailability {
  href: string;
  beta?: boolean;
  adminOnly?: boolean;
}

export const MAKER_TOOL_AVAILABILITY: readonly MakerToolAvailability[] = [
  { href: "/stampa-maker/carteles" },
  { href: "/stampa-maker/neon" },
  { href: "/stampa-maker/jarros", beta: true, adminOnly: true },
];

export function canAccessMakerTool(href: string, isAdmin: boolean): boolean {
  const tool = MAKER_TOOL_AVAILABILITY.find((t) => t.href === href);
  return !tool?.adminOnly || isAdmin;
}

export function visibleMakerTools<T extends { href: string }>(tools: readonly T[], isAdmin: boolean): (T & { beta: boolean })[] {
  return tools
    .filter((t) => canAccessMakerTool(t.href, isAdmin))
    .map((t) => ({ ...t, beta: MAKER_TOOL_AVAILABILITY.find((a) => a.href === t.href)?.beta === true }));
}
