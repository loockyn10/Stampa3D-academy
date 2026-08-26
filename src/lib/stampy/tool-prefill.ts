export function normalizeStampyPrefillText(value?: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isReasonableMatch(candidate: string, query: string): boolean {
  if (!candidate || !query) return false;
  return candidate.includes(query) || query.includes(candidate);
}

export function findStampyNamedMatch<T extends { name?: string | null }>(
  items: T[],
  query?: string | null
): T | undefined {
  const normalizedQuery = normalizeStampyPrefillText(query);
  if (!normalizedQuery) return undefined;

  return items.find((item) =>
    isReasonableMatch(normalizeStampyPrefillText(item.name), normalizedQuery)
  );
}

interface StampyFilamentPrefillCandidate {
  filament_type?: string | null;
  brand?: string | null;
  name?: string | null;
  color?: string | null;
  filament_templates?: { brand?: string | null } | null;
}

interface StampyFilamentPrefillQuery {
  material?: string | null;
  brand?: string | null;
  color?: string | null;
}

export function findStampyFilamentMatch<T extends StampyFilamentPrefillCandidate>(
  filaments: T[],
  query: StampyFilamentPrefillQuery
): T | undefined {
  const queryTokens = [query.material, query.brand, query.color]
    .map(normalizeStampyPrefillText)
    .filter(Boolean);

  if (queryTokens.length === 0) return undefined;

  return filaments.find((filament) => {
    const candidate = normalizeStampyPrefillText([
      filament.filament_type,
      filament.brand,
      filament.filament_templates?.brand,
      filament.name,
      filament.color,
    ].filter(Boolean).join(" "));

    return queryTokens.every((token) => candidate.includes(token));
  });
}

export function parsePositiveStampyPrefillNumber(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(",", ".").trim();
  const numericValue = Number(normalized);
  return Number.isFinite(numericValue) && numericValue > 0 ? normalized : null;
}
