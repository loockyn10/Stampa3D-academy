export interface FilamentDisplayData {
  filament_type?: string | null;
  brand?: string | null;
  name?: string | null;
  color?: string | null;
  remaining_grams?: number | string | null;
  filament_templates?: { brand?: string | null } | null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || null;
}

function normalizedToken(value: string): string {
  return value.toLocaleLowerCase("es-AR").replace(/[^a-z0-9áéíóúüñ+.-]/gi, "");
}

function appendDistinctWords(parts: string[], value: string): void {
  const existingTokens = new Set(parts.join(" ").split(/\s+/).map(normalizedToken));
  const newWords = value.split(/\s+/).filter((word) => !existingTokens.has(normalizedToken(word)));
  if (newWords.length > 0) parts.push(newWords.join(" "));
}

export function getFilamentDisplayName(
  filament: FilamentDisplayData | null | undefined,
): string {
  if (!filament) return "Sin filamento";

  const brand = cleanText(filament.brand) || cleanText(filament.filament_templates?.brand);
  const material = cleanText(filament.filament_type);
  const variant = cleanText(filament.name);
  const color = cleanText(filament.color);
  const parts: string[] = [];

  for (const value of [brand, material, variant, color]) {
    if (!value) continue;
    appendDistinctWords(parts, value);
  }

  return parts.join(" ") || "Filamento sin nombre";
}

export function getFilamentSearchText(
  filament: FilamentDisplayData | null | undefined,
): string {
  if (!filament) return "";
  return [
    getFilamentDisplayName(filament),
    cleanText(filament.brand),
    cleanText(filament.filament_templates?.brand),
    cleanText(filament.filament_type),
    cleanText(filament.name),
    cleanText(filament.color),
  ].filter(Boolean).join(" ");
}

export function getFilamentLabel(
  filament: FilamentDisplayData | null | undefined,
): string {
  return getFilamentDisplayName(filament);
}
