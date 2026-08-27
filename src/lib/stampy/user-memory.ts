import type { SupabaseClient } from "@supabase/supabase-js";

export const STAMPY_MEMORY_CATEGORIES = [
  "software",
  "hardware",
  "printing",
  "business",
  "workflow",
] as const;

export type StampyMemoryCategory = (typeof STAMPY_MEMORY_CATEGORIES)[number];

export interface ExtractedUsefulMemory {
  category: StampyMemoryCategory;
  memoryKey: string;
  memoryValue: string;
  confidence: number;
}

export interface StampyUserMemory {
  id: string;
  user_id: string;
  category: StampyMemoryCategory;
  memory_key: string;
  memory_value: string;
  confidence: number;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

interface SaveUserMemoryParams {
  supabase: SupabaseClient;
  userId: string;
  message: string;
  sourceMessageId?: string | null;
}

export interface SaveUserMemoryResult {
  extracted: ExtractedUsefulMemory[];
  savedCount: number;
  errors: string[];
}

interface RankRelevantMemoryParams {
  message: string;
  memories: StampyUserMemory[];
  maxResults?: number;
}

interface LoadRelevantMemoryParams {
  supabase: SupabaseClient;
  userId: string;
  message?: string;
  query?: string;
  maxResults?: number;
  limit?: number;
}

export interface LoadRelevantMemoryResult {
  memories: StampyUserMemory[];
  promptText: string;
  error: string | null;
}

interface DictionaryEntry {
  pattern: RegExp;
  value: string;
}

const SOFTWARE: DictionaryEntry[] = [
  { pattern: /\borca(?:slicer)?\b/i, value: "Orca" },
  { pattern: /\bbambu\s+studio\b/i, value: "Bambu Studio" },
  { pattern: /\bprusa\s*slicer\b/i, value: "PrusaSlicer" },
  { pattern: /\bsimplify\s*3d\b/i, value: "Simplify3D" },
  { pattern: /\bcura\b/i, value: "Cura" },
];

const MATERIALS: DictionaryEntry[] = [
  { pattern: /\bpetg\b/i, value: "PETG" },
  { pattern: /\btpu\b/i, value: "TPU" },
  { pattern: /\bpla\b/i, value: "PLA" },
  { pattern: /\babs\b/i, value: "ABS" },
  { pattern: /\basa\b/i, value: "ASA" },
  { pattern: /\bnylon\b/i, value: "Nylon" },
  { pattern: /\bresina\b/i, value: "Resina" },
];

const BUSINESS_PRODUCTS: DictionaryEntry[] = [
  { pattern: /\bmates?\b/i, value: "mates" },
  { pattern: /\bllaveros?\b/i, value: "llaveros" },
  { pattern: /\bsouvenirs?\b/i, value: "souvenirs" },
  { pattern: /\bmacetas?\b/i, value: "macetas" },
  { pattern: /\bfiguras?\b/i, value: "figuras" },
  { pattern: /\btrofeos?\b/i, value: "trofeos" },
];

const RELEVANCE_RULES: Array<{
  pattern: RegExp;
  categories: StampyMemoryCategory[];
}> = [
  {
    pattern: /\b(warping|deforma(?:cion|do)?|esquinas?|adhesion|brim|cama|primera\s+capa)\b/i,
    categories: ["hardware", "printing", "workflow"],
  },
  {
    pattern: /\b(slicer|lamin(?:ar|ado)|perfil|orca|bambu\s+studio|cura|prusa\s*slicer)\b/i,
    categories: ["software", "printing", "workflow"],
  },
  {
    pattern: /\b(nozzle|boquilla|impresora|ams|secadora)\b/i,
    categories: ["hardware", "printing"],
  },
  {
    pattern: /\b(pla|petg|tpu|abs|asa|nylon|resina|material|filamento|temperatura|stringing|impresion|imprimir)\b/i,
    categories: ["printing", "hardware", "workflow"],
  },
  {
    pattern: /\b(precio|presupuesto|venta|vender|vendo|cliente|margen|mayorista|producto|negocio)\b/i,
    categories: ["business", "printing"],
  },
  {
    pattern: /\b(flujo|proceso|secar|seco|altura\s+de\s+capa|velocidad)\b/i,
    categories: ["workflow", "printing"],
  },
];

function normalizeForMatching(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/(\d)[,.](\d)/g, "$1decimalmark$2")
    .replace(/[¿?¡!.,;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/decimalmark/g, ".");
}

function isQuestion(message: string): boolean {
  const normalized = normalizeForMatching(message);
  return (
    /[?¿]/.test(message) ||
    /^(que|como|cuando|donde|cual|puedo|debo|conviene|recomendas|usas|tenes|vendes)\b/.test(
      normalized
    )
  );
}

function isNegatedAt(message: string, index: number): boolean {
  const prefix = message.slice(Math.max(0, index - 32), index);
  return /\b(?:no|nunca|ya\s+no)\s+(?:\w+\s+){0,3}$/.test(prefix);
}

function findAssertedMatches(
  message: string,
  assertion: RegExp,
  dictionary: DictionaryEntry[]
): DictionaryEntry[] {
  const assertionMatch = assertion.exec(message);
  if (!assertionMatch || isNegatedAt(message, assertionMatch.index)) return [];

  return dictionary.filter((entry) => entry.pattern.test(message.slice(assertionMatch.index)));
}

function addMemory(
  memories: ExtractedUsefulMemory[],
  memory: ExtractedUsefulMemory
) {
  const alreadyIncluded = memories.some(
    (current) =>
      current.category === memory.category &&
      current.memoryKey === memory.memoryKey &&
      current.memoryValue === memory.memoryValue
  );

  if (!alreadyIncluded) memories.push(memory);
}

/**
 * Extracts only stable, domain-specific facts stated by the user. It deliberately
 * ignores general conversation and does not use an AI model.
 */
export function extractUsefulMemory(message: string): ExtractedUsefulMemory[] {
  const normalized = normalizeForMatching(message);
  if (!normalized || isQuestion(message)) return [];

  const memories: ExtractedUsefulMemory[] = [];

  for (const software of findAssertedMatches(
    normalized,
    /\b(?:siempre\s+)?(?:uso|utilizo|trabajo\s+con|lamino\s+con)\b|\bmi\s+slicer\s+es\b/,
    SOFTWARE
  )) {
    addMemory(memories, {
      category: "software",
      memoryKey: "preferred_slicer",
      memoryValue: software.value,
      confidence: 0.95,
    });
  }

  for (const material of findAssertedMatches(
    normalized,
    /\b(?:siempre\s+)?(?:imprimo|uso)\b|\b(?:suelo|acostumbro\s+a)\s+imprimir\b/,
    MATERIALS
  )) {
    addMemory(memories, {
      category: "printing",
      memoryKey: "preferred_material",
      memoryValue: material.value,
      confidence: /\bsiempre\b/.test(normalized) ? 0.95 : 0.85,
    });
  }

  const nozzleMatch = /\b(?:tengo|uso|mi)\b[^.]{0,40}\b(?:nozzle|boquilla)\s+(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(?:mm)?\b/.exec(
    normalized
  );
  if (nozzleMatch && !isNegatedAt(normalized, nozzleMatch.index)) {
    addMemory(memories, {
      category: "hardware",
      memoryKey: "nozzle_diameter",
      memoryValue: `${nozzleMatch[1].replace(",", ".")} mm`,
      confidence: 0.95,
    });
  }

  const dryerMatch = /\b(?:tengo|uso|mi)\b[^.]{0,40}\bsecadora\b(?:\s+(?:de\s+)?filamento)?(?:\s+(?:es|marca))?\s*([a-z0-9-]+)?/.exec(
    normalized
  );
  if (dryerMatch && !isNegatedAt(normalized, dryerMatch.index)) {
    addMemory(memories, {
      category: "hardware",
      memoryKey: "filament_dryer",
      memoryValue: dryerMatch[1] ? titleCase(dryerMatch[1]) : "Sí",
      confidence: 0.85,
    });
  }

  const amsMatch = /\b(?:tengo|uso|mi\s+impresora\s+tiene)\b[^.]{0,32}\bams\b/.exec(normalized);
  if (amsMatch && !isNegatedAt(normalized, amsMatch.index)) {
    addMemory(memories, {
      category: "hardware",
      memoryKey: "material_system",
      memoryValue: "AMS",
      confidence: 0.95,
    });
  }

  const saleAssertion = /\b(?:vendo|comercializo|fabricamos|vendemos)\b/.exec(normalized);
  if (saleAssertion && !isNegatedAt(normalized, saleAssertion.index)) {
    for (const product of BUSINESS_PRODUCTS.filter((entry) =>
      entry.pattern.test(normalized.slice(saleAssertion.index))
    )) {
      addMemory(memories, {
        category: "business",
        memoryKey: "product",
        memoryValue: product.value,
        confidence: 0.9,
      });
    }

    if (/\b(?:al\s+por\s+mayor|mayorista)\b/.test(normalized)) {
      addMemory(memories, {
        category: "business",
        memoryKey: "sales_model",
        memoryValue: "mayorista",
        confidence: 0.9,
      });
    }
  }

  const dryingMatch = /\b(?:siempre\s+)?(?:seco|secamos)\b[^.]{0,32}\bfilamentos?\b/.exec(
    normalized
  );
  if (dryingMatch && !isNegatedAt(normalized, dryingMatch.index)) {
    addMemory(memories, {
      category: "workflow",
      memoryKey: "dries_filament",
      memoryValue: "Sí",
      confidence: /\bsiempre\b/.test(normalized) ? 0.95 : 0.85,
    });
  }

  const brimMatch = /\b(?:siempre\s+)?(?:uso|usamos)\b[^.]{0,24}\bbrim\b|\bbrim\b[^.]{0,16}\bsiempre\b/.exec(
    normalized
  );
  if (brimMatch && !isNegatedAt(normalized, brimMatch.index)) {
    addMemory(memories, {
      category: "workflow",
      memoryKey: "bed_adhesion",
      memoryValue: "Brim",
      confidence: /\bsiempre\b/.test(normalized) ? 0.95 : 0.85,
    });
  }

  const layerHeightMatch = /\b(?:siempre\s+)?imprimo\s+a\s+(\d+(?:[.,]\d+)?)\s*(?:mm)?\b/.exec(
    normalized
  );
  if (layerHeightMatch && !isNegatedAt(normalized, layerHeightMatch.index)) {
    addMemory(memories, {
      category: "workflow",
      memoryKey: "layer_height",
      memoryValue: `${layerHeightMatch[1].replace(",", ".")} mm`,
      confidence: /\bsiempre\b/.test(normalized) ? 0.95 : 0.8,
    });
  }

  return memories;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function getRelevantCategories(message: string): StampyMemoryCategory[] {
  const normalized = normalizeForMatching(message);
  const categories = new Set<StampyMemoryCategory>();

  for (const rule of RELEVANCE_RULES) {
    if (rule.pattern.test(normalized)) {
      for (const category of rule.categories) categories.add(category);
    }
  }

  return [...categories];
}

function isStampyUserMemory(value: unknown): value is StampyUserMemory {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.user_id === "string" &&
    STAMPY_MEMORY_CATEGORIES.includes(row.category as StampyMemoryCategory) &&
    typeof row.memory_key === "string" &&
    typeof row.memory_value === "string" &&
    typeof row.confidence === "number" &&
    (row.source_message_id === null || typeof row.source_message_id === "string") &&
    typeof row.created_at === "string" &&
    typeof row.updated_at === "string"
  );
}

export function rankRelevantMemory({
  message,
  memories,
  maxResults = 10,
}: RankRelevantMemoryParams): StampyUserMemory[] {
  const normalized = normalizeForMatching(message);
  const categories = getRelevantCategories(message);
  const categoryOrder = new Map(categories.map((category, index) => [category, index]));
  const boundedLimit = Math.max(0, Math.min(10, Math.floor(maxResults)));

  return memories
    .filter((memory) => categoryOrder.has(memory.category))
    .map((memory) => {
      let score = 100 - (categoryOrder.get(memory.category) ?? categories.length) * 5;
      const searchableKey = normalizeForMatching(memory.memory_key.replaceAll("_", " "));
      const searchableValue = normalizeForMatching(memory.memory_value);

      if (searchableValue && normalized.includes(searchableValue)) score += 35;
      if (searchableKey && normalized.includes(searchableKey)) score += 20;
      score += Math.max(0, Math.min(1, memory.confidence)) * 10;

      const timestamp = Date.parse(memory.updated_at);
      if (Number.isFinite(timestamp)) score += timestamp / 1e13;

      return { memory, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        Date.parse(right.memory.updated_at) - Date.parse(left.memory.updated_at)
    )
    .slice(0, boundedLimit)
    .map(({ memory }) => memory);
}

function memoryToSentence(memory: StampyUserMemory): string {
  if (
    memory.category === "software" &&
    (memory.memory_key === "preferred_slicer" || memory.memory_key === "slicer")
  ) {
    return `Usa ${memory.memory_value}.`;
  }
  if (memory.category === "printing" && memory.memory_key === "preferred_material") {
    return `Prefiere ${memory.memory_value}.`;
  }
  if (memory.category === "hardware" && memory.memory_key === "nozzle_diameter") {
    return `Tiene nozzle ${memory.memory_value}.`;
  }
  if (memory.category === "hardware" && memory.memory_key === "filament_dryer") {
    return memory.memory_value === "Sí"
      ? "Tiene secadora de filamento."
      : `Tiene secadora de filamento ${memory.memory_value}.`;
  }
  if (memory.category === "hardware" && memory.memory_key === "material_system") {
    return `Tiene ${memory.memory_value}.`;
  }
  if (memory.category === "business" && memory.memory_key === "product") {
    return `Vende ${memory.memory_value}.`;
  }
  if (memory.category === "business" && memory.memory_key === "sales_model") {
    return `Vende ${memory.memory_value}.`;
  }
  if (memory.category === "workflow" && memory.memory_key === "dries_filament") {
    return "Seca los filamentos antes de imprimir.";
  }
  if (memory.category === "workflow" && memory.memory_key === "bed_adhesion") {
    return `Usa ${memory.memory_value} como adhesión.`;
  }
  if (memory.category === "workflow" && memory.memory_key === "layer_height") {
    return `Suele imprimir a ${memory.memory_value}.`;
  }

  return `${memory.memory_key.replaceAll("_", " ")}: ${memory.memory_value}.`;
}

export function formatRelevantMemoryForPrompt(memories: StampyUserMemory[]): string {
  if (memories.length === 0) return "";

  const maxPromptChars = 1200;
  let promptText = "MEMORIAS ÚTILES DEL USUARIO:";
  for (const memory of memories.slice(0, 10)) {
    const line = `\n- ${memoryToSentence(memory)}`;
    if (promptText.length + line.length > maxPromptChars) break;
    promptText += line;
  }

  return promptText;
}

/**
 * Call this only after Stampy has produced and persisted its response. The
 * database RPC makes identical facts atomic: duplicates only refresh updated_at.
 */
export async function saveUserMemory({
  supabase,
  userId,
  message,
  sourceMessageId = null,
}: SaveUserMemoryParams): Promise<SaveUserMemoryResult> {
  const extracted = extractUsefulMemory(message);
  const errors: string[] = [];
  let savedCount = 0;

  for (const memory of extracted) {
    const { error } = await supabase.rpc("save_stampy_user_memory", {
      p_user_id: userId,
      p_category: memory.category,
      p_memory_key: memory.memoryKey,
      p_memory_value: memory.memoryValue,
      p_confidence: memory.confidence,
      p_source_message_id: sourceMessageId,
    });

    if (error) {
      errors.push(error.message);
    } else {
      savedCount += 1;
    }
  }

  return { extracted, savedCount, errors };
}

/**
 * Loads only categories related to the current message, then ranks at most ten
 * facts for prompt injection. An unrelated/casual message performs no query.
 */
export async function loadRelevantMemory({
  supabase,
  userId,
  message,
  query,
  maxResults,
  limit,
}: LoadRelevantMemoryParams): Promise<LoadRelevantMemoryResult> {
  const memoryQuery = query ?? message ?? "";
  const resultLimit = limit ?? maxResults ?? 10;
  const categories = getRelevantCategories(memoryQuery);
  if (categories.length === 0 || resultLimit <= 0) {
    return { memories: [], promptText: "", error: null };
  }

  const { data, error } = await supabase
    .from("stampy_user_memory")
    .select(
      "id, user_id, category, memory_key, memory_value, confidence, source_message_id, created_at, updated_at"
    )
    .eq("user_id", userId)
    .in("category", categories)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    return { memories: [], promptText: "", error: error.message };
  }

  const rows = Array.isArray(data) ? data.filter(isStampyUserMemory) : [];
  const memories = rankRelevantMemory({
    message: memoryQuery,
    memories: rows,
    maxResults: resultLimit,
  });
  return {
    memories,
    promptText: formatRelevantMemoryForPrompt(memories),
    error: null,
  };
}
