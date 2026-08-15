export function isValidHexColor(value: string): boolean {
  return /^#?[0-9A-Fa-f]{6}$/i.test(value.trim());
}

function levenshteinDistance(a: string, b: string): number {
  const matrix = [];
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1 // deletion
          )
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

const colorDictionary: Record<string, string> = {
  blanco: "#f8fafc",
  negro: "#020617",
  gris: "#737373",
  grafito: "#374151",
  plateado: "#cbd5e1",
  rojo: "#ef4444",
  naranja: "#f97316",
  amarillo: "#eab308",
  verde: "#22c55e",
  "verde manzana": "#84cc16",
  azul: "#2563eb",
  "azul oscuro": "#1d4ed8",
  celeste: "#38bdf8",
  turquesa: "#14b8a6",
  violeta: "#8b5cf6",
  morado: "#7c3aed",
  rosa: "#ec4899",
  fucsia: "#d946ef",
  marron: "#92400e",
  marrón: "#92400e",
  beige: "#d6b98c",
  crema: "#f5e6c8",
  dorado: "#d97706",
  cobre: "#b45309",
  transparente: "#e5e7eb",
};

const removeAccents = (str: string) => {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

export function normalizeFilamentColor(input: string): {
  input: string;
  label: string;
  hex: string;
  confidence: "high" | "medium" | "low";
  matchedKey?: string;
} {
  const defaultNeutral = "#737373";
  if (!input || !input.trim()) {
    return { input, label: "Neutral", hex: defaultNeutral, confidence: "low" };
  }

  let cleaned = input.trim();

  // 1. Check if it's already a valid HEX
  if (isValidHexColor(cleaned)) {
    const hex = cleaned.startsWith("#") ? cleaned : `#${cleaned}`;
    return { input, label: "Color Manual", hex: hex.toLowerCase(), confidence: "high" };
  }

  cleaned = cleaned.toLowerCase();
  const normalizedInput = removeAccents(cleaned).replace(/\s+/g, " ");

  // Identificar modificadores
  const modifiers = ["claro", "oscuro", "fluo", "fluorescente", "pastel", "mate", "silk", "seda", "perlado", "translucido", "translúcido", "metalico", "metálico"];
  
  // Extraer base
  let baseColorText = normalizedInput;
  modifiers.forEach(mod => {
    const regex = new RegExp(`\\b${mod}\\b`, "g");
    baseColorText = baseColorText.replace(regex, "");
  });
  baseColorText = baseColorText.trim();

  if (baseColorText.length === 0) {
    baseColorText = normalizedInput; // Si era "transparente perlado" no queremos borrar todo
  }

  // 2. Exact match in dictionary
  if (colorDictionary[baseColorText]) {
    return {
      input,
      label: cleaned.charAt(0).toUpperCase() + cleaned.slice(1),
      hex: colorDictionary[baseColorText],
      confidence: "high",
      matchedKey: baseColorText
    };
  }

  // 3. Fuzzy match
  let bestMatch = "";
  let minDistance = Infinity;

  const keys = Object.keys(colorDictionary);
  for (const key of keys) {
    const distance = levenshteinDistance(baseColorText, removeAccents(key));
    if (distance < minDistance) {
      minDistance = distance;
      bestMatch = key;
    }
  }

  if (minDistance <= 2 && baseColorText.length > 2) {
    return {
      input,
      label: bestMatch.charAt(0).toUpperCase() + bestMatch.slice(1),
      hex: colorDictionary[bestMatch],
      confidence: minDistance === 1 ? "high" : "medium",
      matchedKey: bestMatch
    };
  }

  // 4. Fallback
  return {
    input,
    label: "Color no detectado",
    hex: defaultNeutral,
    confidence: "low"
  };
}
