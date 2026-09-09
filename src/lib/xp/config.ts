export const XP_TIMEZONE = "America/Argentina/Buenos_Aires";

export type XpCategory = "academy" | "tools" | "workshop" | "business" | "onboarding";

export type XpEventType =
  | "class_completed"
  | "calculator_used"
  | "production_registered"
  | "sale_completed"
  | "replenishment_completed"
  | "stock_adjusted"
  | "first_printer"
  | "first_filament"
  | "first_product"
  | "first_production"
  | "first_sale"
  | "launch_academy_history";

export interface XpRule {
  eventType: XpEventType;
  category: XpCategory;
  xp: number;
  dailyLimit: number | null;
  lifetimeLimit: number | null;
  perEntityOnce: boolean;
  label: string;
  publicDescription: string;
}

export const XP_RULES: readonly XpRule[] = [
  { eventType: "class_completed", category: "academy", xp: 10, dailyLimit: 2, lifetimeLimit: null, perEntityOnce: true, label: "Clase completada", publicDescription: "Completá hasta 2 clases por día. Cada clase entrega XP una sola vez." },
  { eventType: "calculator_used", category: "tools", xp: 5, dailyLimit: 1, lifetimeLimit: null, perEntityOnce: false, label: "Cálculo válido", publicDescription: "Realizá un cálculo válido de costos y precio." },
  { eventType: "production_registered", category: "workshop", xp: 10, dailyLimit: 1, lifetimeLimit: null, perEntityOnce: false, label: "Producción registrada", publicDescription: "Registrá una producción real en Mi Taller." },
  { eventType: "sale_completed", category: "business", xp: 10, dailyLimit: 1, lifetimeLimit: null, perEntityOnce: true, label: "Venta confirmada", publicDescription: "Confirmá una venta real en Mi Negocio." },
  { eventType: "replenishment_completed", category: "business", xp: 5, dailyLimit: 1, lifetimeLimit: null, perEntityOnce: true, label: "Reposición completada", publicDescription: "Completá una reposición del depósito al showroom." },
  { eventType: "stock_adjusted", category: "business", xp: 5, dailyLimit: 1, lifetimeLimit: null, perEntityOnce: true, label: "Stock actualizado", publicDescription: "Registrá un ingreso o ajuste significativo de stock comercial." },
  { eventType: "first_printer", category: "onboarding", xp: 20, dailyLimit: null, lifetimeLimit: 1, perEntityOnce: false, label: "Primera impresora", publicDescription: "Cargá tu primera impresora." },
  { eventType: "first_filament", category: "onboarding", xp: 15, dailyLimit: null, lifetimeLimit: 1, perEntityOnce: false, label: "Primer filamento", publicDescription: "Cargá tu primer filamento." },
  { eventType: "first_product", category: "onboarding", xp: 25, dailyLimit: null, lifetimeLimit: 1, perEntityOnce: false, label: "Primer producto", publicDescription: "Creá tu primer producto." },
  { eventType: "first_production", category: "onboarding", xp: 25, dailyLimit: null, lifetimeLimit: 1, perEntityOnce: false, label: "Primera producción", publicDescription: "Registrá tu primera producción." },
  { eventType: "first_sale", category: "onboarding", xp: 25, dailyLimit: null, lifetimeLimit: 1, perEntityOnce: false, label: "Primera venta", publicDescription: "Confirmá tu primera venta." },
] as const;

export function getXpRule(eventType: string): XpRule | null {
  return XP_RULES.find((rule) => rule.eventType === eventType) ?? null;
}

export type XpAwardReason = "awarded" | "duplicate" | "daily_limit" | "lifetime_limit" | "unknown_event";

export function evaluateXpAward(input: {
  eventType: string;
  eventAlreadyExists?: boolean;
  awardedToday?: number;
  awardedLifetime?: number;
}): { xpAwarded: number; reason: XpAwardReason } {
  const rule = getXpRule(input.eventType);
  if (!rule) return { xpAwarded: 0, reason: "unknown_event" };
  if (input.eventAlreadyExists) return { xpAwarded: 0, reason: "duplicate" };
  if (rule.dailyLimit !== null && (input.awardedToday ?? 0) >= rule.dailyLimit) {
    return { xpAwarded: 0, reason: "daily_limit" };
  }
  if (rule.lifetimeLimit !== null && (input.awardedLifetime ?? 0) >= rule.lifetimeLimit) {
    return { xpAwarded: 0, reason: "lifetime_limit" };
  }
  return { xpAwarded: rule.xp, reason: "awarded" };
}

export function getXpLogicalDay(date: Date, timezone = XP_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function formatPublicXpRulesForStampy(): string {
  return XP_RULES.map((rule) => {
    const limits = [
      rule.dailyLimit ? `máximo ${rule.dailyLimit} por día` : null,
      rule.lifetimeLimit === 1 ? "una sola vez" : null,
      rule.perEntityOnce && rule.eventType === "class_completed" ? "una vez por clase" : null,
    ].filter(Boolean).join(", ");
    return `- ${rule.label}: +${rule.xp} XP${limits ? ` (${limits})` : ""}.`;
  }).join("\n");
}
