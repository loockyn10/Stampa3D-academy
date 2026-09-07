import type { StampyScreenContext } from "./screen-context";

export type StampyClientAspect = "budgets" | "last_budget" | "missing_data" | "email" | "summary";

export interface StampyClientToolIntent {
  toolName: "clients.inspect";
  clientId: string;
  aspect: StampyClientAspect;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("es-AR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectStampyClientToolIntent({
  message,
  screenContext,
}: {
  message: string;
  screenContext: StampyScreenContext | null;
}): StampyClientToolIntent | null {
  const selected = screenContext?.selectedEntity?.type === "client"
    ? screenContext.selectedEntity
    : null;
  const text = normalize(message);
  const visibleNamedMatches = (screenContext?.visibleEntities ?? []).filter(
    (entity) => entity.type === "client" && entity.name && text.includes(normalize(entity.name)),
  );
  if (visibleNamedMatches.length > 1) return null;
  const target = visibleNamedMatches.length === 1 ? visibleNamedMatches[0] : selected;
  if (!target) return null;
  const aspect: StampyClientAspect | null = /\b(?:email|correo)\b/.test(text)
    ? "email"
    : /\b(?:ultimo|ultima|mas reciente)\b.*\bpresupuesto|\b(?:cual|cuando).*(?:ultimo|ultima|mas reciente)\b/.test(text)
      ? "last_budget"
      : /\bpresupuestos?\b/.test(text)
        ? "budgets"
        : /\b(?:que|cuales).*\bdatos?\b.*\bfalt|\bque falta\b|\bincomplet/.test(text)
          ? "missing_data"
          : /\b(?:datos|informacion|resumen)\b.*\bcliente\b/.test(text)
            ? "summary"
            : null;

  return aspect ? { toolName: "clients.inspect", clientId: target.id, aspect } : null;
}
