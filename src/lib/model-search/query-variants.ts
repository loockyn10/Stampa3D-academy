import { LEXICON, PHRASES, PROTECTED_WORDS, type LexiconEntry } from "./lexicon";

/**
 * Búsqueda ampliada (nivel 1, determinista y sin red): a partir de la consulta del usuario genera variantes en el
 * otro idioma (español ↔ inglés) para ampliar resultados, nunca para reemplazarlos. La consulta original siempre se
 * conserva y la decide el llamador.
 *
 * No traduce palabra por palabra: entiende "objeto principal + complemento + adjetivos" y reordena según el idioma.
 *   soporte de notebook  → laptop stand · laptop holder        (no "notebook support")
 *   dragón articulado    → articulated dragon
 *   desk organizer       → organizador de escritorio
 * Ante cualquier duda (palabra desconocida, estructura rara, objeto demasiado genérico) NO genera variante: una
 * búsqueda ampliada incorrecta es peor que ninguna. Cómo sumar una interpretación más inteligente (IA) está en
 * docs/ARCHITECTURE.md §18.4: se enchufa por `ModelSearchDeps.expandQuery` sin tocar este archivo.
 */

/** Tope global de variantes por consulta; cada provider declara su propio máximo (≤ este valor). */
export const MAX_QUERY_VARIANTS = 2;
/** Consultas más largas son frases libres: no se intentan interpretar. */
const MAX_TOKENS = 8;

type Lang = "es" | "en";

interface Token {
  /** En minúsculas y con tildes, tal como se reutiliza al armar la variante. */
  raw: string;
  /** Sin tildes, para comparar. */
  key: string;
}

type Item =
  | { type: "noun" | "adj"; entry: LexiconEntry; plural: boolean }
  | { type: "conn"; key: string }
  | { type: "lit"; text: string };

type ConceptItem = Extract<Item, { type: "noun" | "adj" }>;

interface Structure {
  head: ConceptItem;
  mods: ConceptItem[];
  comp: { type: "noun"; entry: LexiconEntry } | { type: "lit"; text: string } | null;
}

const ARTICLES: Record<Lang, ReadonlySet<string>> = {
  es: new Set(["el", "la", "los", "las", "un", "una", "unos", "unas"]),
  en: new Set(["the", "a", "an"]),
};
/** Conectores que significan "de/para": se pueden reordenar. Otros ("con", "sin", "y"…) cambian el sentido y se rechazan. */
const CONNECTORS: Record<Lang, ReadonlySet<string>> = {
  es: new Set(["de", "del", "para"]),
  en: new Set(["for", "of"]),
};
const UNSUPPORTED_WORDS = new Set(["con", "sin", "en", "y", "o", "por", "and", "or", "with", "without", "in", "on", "to"]);

export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function tokenize(query: string): Token[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((raw) => ({ raw, key: stripAccents(raw) }));
}

export function normalizeForCompare(value: string): string {
  return tokenize(value).map((token) => token.key).join(" ");
}

// ── Índices por idioma (se construyen una sola vez) ──────────────────────────────────────────────────────────────

interface LangIndex {
  forms: Map<string, LexiconEntry>;
  maxWords: number;
}

const indexCache: Partial<Record<Lang, LangIndex>> = {};
let protectedIndex: { single: Set<string>; multi: string[][] } | null = null;

function langIndex(lang: Lang): LangIndex {
  const cached = indexCache[lang];
  if (cached) return cached;
  const forms = new Map<string, LexiconEntry>();
  let maxWords = 1;
  for (const entry of LEXICON) {
    for (const form of entry[lang]) {
      const key = normalizeForCompare(form);
      const existing = forms.get(key);
      if (existing && existing !== entry) throw new Error(`lexicon: "${key}" (${lang}) pertenece a ${existing.id} y ${entry.id}`);
      forms.set(key, entry);
      maxWords = Math.max(maxWords, key.split(" ").length);
    }
  }
  return (indexCache[lang] = { forms, maxWords });
}

function protectedWords() {
  if (protectedIndex) return protectedIndex;
  const single = new Set<string>();
  const multi: string[][] = [];
  for (const phrase of PROTECTED_WORDS) {
    const words = phrase.split(" ");
    if (words.length === 1) single.add(phrase);
    else multi.push(words);
  }
  multi.sort((a, b) => b.length - a.length);
  return (protectedIndex = { single, multi });
}

/** Formas candidatas de una palabra para tolerar plural y femenino: "soportes", "articulada", "organizers". */
function lookupCandidates(key: string, lang: Lang): { form: string; plural: boolean }[] {
  const candidates: { form: string; plural: boolean }[] = [{ form: key, plural: false }];
  if (lang === "es") {
    if (key.endsWith("es") && key.length > 4) candidates.push({ form: key.slice(0, -2), plural: true });
    if (key.endsWith("s") && key.length > 3) candidates.push({ form: key.slice(0, -1), plural: true });
    candidates.push({ form: `${key}s`, plural: false });
    for (const candidate of [...candidates]) {
      if (candidate.form.endsWith("a")) candidates.push({ form: `${candidate.form.slice(0, -1)}o`, plural: candidate.plural });
    }
  } else {
    if (key.endsWith("ies") && key.length > 4) candidates.push({ form: `${key.slice(0, -3)}y`, plural: true });
    if (key.endsWith("es") && key.length > 4) candidates.push({ form: key.slice(0, -2), plural: true });
    if (key.endsWith("s") && key.length > 3) candidates.push({ form: key.slice(0, -1), plural: true });
    candidates.push({ form: `${key}s`, plural: false });
  }
  return candidates;
}

function lookupWord(key: string, lang: Lang): { entry: LexiconEntry; plural: boolean } | null {
  const { forms } = langIndex(lang);
  for (const candidate of lookupCandidates(key, lang)) {
    const entry = forms.get(candidate.form);
    if (entry) return { entry, plural: candidate.plural };
  }
  return null;
}

// ── Análisis ────────────────────────────────────────────────────────────────────────────────────────────────────

function parseItems(tokens: Token[], lang: Lang): Item[] | null {
  const { forms, maxWords } = langIndex(lang);
  const protectedSet = protectedWords();
  const items: Item[] = [];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];

    const protectedPhrase = protectedSet.multi.find((words) => words.every((word, offset) => tokens[index + offset]?.key === word));
    if (protectedPhrase) {
      items.push({ type: "lit", text: tokens.slice(index, index + protectedPhrase.length).map((entry) => entry.raw).join(" ") });
      index += protectedPhrase.length;
      continue;
    }

    let matched = false;
    for (let span = Math.min(maxWords, tokens.length - index); span >= 2 && !matched; span -= 1) {
      const entry = forms.get(tokens.slice(index, index + span).map((entry) => entry.key).join(" "));
      if (entry) {
        items.push({ type: entry.pos, entry, plural: false });
        index += span;
        matched = true;
      }
    }
    if (matched) continue;

    const word = lookupWord(token.key, lang);
    if (word) {
      items.push({ type: word.entry.pos, entry: word.entry, plural: word.plural });
    } else if (ARTICLES[lang].has(token.key)) {
      // Artículos: no aportan al sentido de la búsqueda.
    } else if (CONNECTORS[lang].has(token.key)) {
      items.push({ type: "conn", key: token.key });
    } else if (UNSUPPORTED_WORDS.has(token.key)) {
      return null;
    } else if (/\d/.test(token.key) || protectedSet.single.has(token.key)) {
      const last = items[items.length - 1];
      if (last?.type === "lit") last.text = `${last.text} ${token.raw}`;
      else items.push({ type: "lit", text: token.raw });
    } else {
      // Palabra desconocida (o de otro idioma): no se adivina.
      return null;
    }
    index += 1;
  }
  return items;
}

/** Reduce los items a {objeto principal, adjetivos, complemento} o null si la estructura no es segura. */
function buildStructure(items: Item[], lang: Lang): Structure | null {
  const connectorAt = items.findIndex((item) => item.type === "conn");
  const left = connectorAt === -1 ? items : items.slice(0, connectorAt);
  const right = connectorAt === -1 ? [] : items.slice(connectorAt + 1);
  // Un solo conector, seguido de un sustantivo o nombre propio. En español los adjetivos finales ("soporte para notebook
  // plegable") califican al objeto principal.
  const trailing: ConceptItem[] = [];
  while (lang === "es" && right.length > 0 && right[right.length - 1].type === "adj") trailing.unshift(right.pop() as ConceptItem);
  if (right.some((item) => item.type === "conn" || item.type === "adj") || (connectorAt !== -1 && right.length === 0)) return null;
  if (left.some((item) => item.type === "conn")) return null;

  const nounIndexes = left.flatMap((item, position) => (item.type === "noun" ? [position] : []));
  if (nounIndexes.length === 0) return null;
  // En español el objeto principal va primero ("soporte notebook"); en inglés va último ("laptop stand").
  const headPosition = lang === "es" ? nounIndexes[0] : nounIndexes[nounIndexes.length - 1];
  const head = left[headPosition] as ConceptItem;
  if (lang === "en" && headPosition !== left.length - 1 && connectorAt === -1) return null;

  const mods: ConceptItem[] = [...trailing];
  const complements: Item[] = [];
  left.forEach((item, position) => {
    if (position === headPosition) return;
    if (item.type === "adj") mods.push(item);
    else complements.push(item);
  });
  complements.push(...right);

  if (complements.length > 1 || mods.length > 2) return null;
  const complement = complements[0];
  const comp: Structure["comp"] =
    !complement ? null : complement.type === "lit" ? { type: "lit", text: complement.text } : complement.type === "noun" ? { type: "noun", entry: complement.entry } : null;
  if (complement && !comp) return null;
  if (comp?.type === "noun" && comp.entry.generic) {
    // Un objeto genérico solo tiene sentido como principal: "audífonos soporte" = "soporte para audífonos".
    if (head.entry.generic) return null;
    return { head: { type: "noun", entry: comp.entry, plural: false }, mods, comp: { type: "noun", entry: head.entry } };
  }
  if (head.entry.generic && !comp && mods.length === 0) return null;
  return { head, mods, comp };
}

// ── Generación ──────────────────────────────────────────────────────────────────────────────────────────────────

const FEMININE_NOUNS = new Set(["pared", "llave", "flor", "torre", "nave", "mano", "moto", "bici", "luz", "imagen"]);

function spanishGender(entry: LexiconEntry): "m" | "f" {
  if (entry.gender) return entry.gender;
  const word = stripAccents(entry.es[0]);
  if (FEMININE_NOUNS.has(word) || /(a|ion|dad|tad)$/.test(word)) return "f";
  return "m";
}

function pluralizeEs(word: string): string {
  const parts = word.split(" ");
  const first = parts[0];
  let plural: string;
  if (/[aeiouáéíóú]$/.test(first)) plural = `${first}s`;
  else if (first.endsWith("z")) plural = `${first.slice(0, -1)}ces`;
  else if (first.endsWith("s")) plural = first;
  else plural = `${first}es`;
  return [plural, ...parts.slice(1)].join(" ");
}

function pluralizeEn(word: string): string {
  const parts = word.split(" ");
  const last = parts[parts.length - 1];
  let plural: string;
  if (/(s|x|z|ch|sh)$/.test(last)) plural = `${last}es`;
  else if (/[^aeiou]y$/.test(last)) plural = `${last.slice(0, -1)}ies`;
  else plural = `${last}s`;
  return [...parts.slice(0, -1), plural].join(" ");
}

function agreeAdjectiveEs(base: string, gender: "m" | "f", plural: boolean): string {
  let word = base;
  if (gender === "f" && word.endsWith("o")) word = `${word.slice(0, -1)}a`;
  return plural ? pluralizeEs(word) : word;
}

/** Parejas (alternativa de objeto principal, alternativa de complemento) de mejor a peor, sin repetir. */
function alternativePairs(headCount: number, compCount: number): [number, number][] {
  const pairs: [number, number][] = [];
  for (let head = 0; head < Math.min(headCount, 2); head += 1) {
    for (let comp = 0; comp < Math.min(compCount, 2); comp += 1) pairs.push([head, comp]);
  }
  // A igual calidad, primero otra palabra para el objeto principal (stand → holder) y después otro nombre del complemento.
  return pairs.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || b[0] - a[0]);
}

function generate(structure: Structure, target: Lang): string[] {
  const { head, mods, comp } = structure;
  const override = comp?.type === "noun" ? comp.entry.withHead?.[head.entry.id]?.[target] : undefined;
  const headForms = override ?? head.entry[target];
  const compForms = !comp ? [""] : comp.type === "lit" ? [comp.text] : comp.entry[target];
  const gender = target === "es" ? spanishGender(head.entry) : "m";

  return alternativePairs(headForms.length, compForms.length).map(([headIndex, compIndex]) => {
    const headWord = head.plural ? (target === "es" ? pluralizeEs(headForms[headIndex]) : pluralizeEn(headForms[headIndex])) : headForms[headIndex];
    const compWord = compForms[compIndex];
    if (target === "en") {
      const adjectives = [...mods].sort((a, b) => Number(b.entry.size === true) - Number(a.entry.size === true));
      return [...adjectives.map((mod) => mod.entry.en[0]), compWord, headWord].filter(Boolean).join(" ");
    }
    const preposition = !comp ? "" : comp.type === "lit" ? "para" : (comp.entry.prep ?? "de");
    const adjective = (mod: ConceptItem) => agreeAdjectiveEs(mod.entry.es[0], gender, head.plural);
    return [
      ...mods.filter((mod) => mod.entry.before).map(adjective),
      headWord,
      ...mods.filter((mod) => !mod.entry.before).map(adjective),
      preposition,
      compWord,
    ]
      .filter(Boolean)
      .join(" ");
  });
}

function phraseVariants(normalized: string): string[] {
  for (const phrase of PHRASES) {
    for (const [from, to] of [["es", "en"], ["en", "es"]] as const) {
      if (phrase[from].some((form) => normalizeForCompare(form) === normalized)) return [...phrase[to]];
    }
  }
  return [];
}

/**
 * Variantes de `query` en el otro idioma, de más a menos relevante, sin repetir entre sí ni con la consulta original.
 * Devuelve [] si no hay una interpretación segura (consulta desconocida, ambigua, ya en el idioma destino, etc.).
 */
export function expandQuery(query: string, max: number = MAX_QUERY_VARIANTS): string[] {
  const limit = Math.min(Math.max(0, Math.trunc(max)), MAX_QUERY_VARIANTS);
  if (limit === 0) return [];
  const tokens = tokenize(query);
  if (tokens.length === 0 || tokens.length > MAX_TOKENS) return [];
  const normalized = tokens.map((token) => token.key).join(" ");

  const candidates = phraseVariants(normalized);
  if (candidates.length === 0) {
    for (const lang of ["es", "en"] as const) {
      const items = parseItems(tokens, lang);
      const structure = items ? buildStructure(items, lang) : null;
      if (!structure) continue;
      const generated = generate(structure, lang === "es" ? "en" : "es");
      // Si la forma preferida del otro idioma es la misma consulta ("tablet", "robot"), no hay nada que ampliar:
      // tampoco se gastan requests en sinónimos secundarios.
      if (generated.length > 0 && normalizeForCompare(generated[0]) === normalized) continue;
      candidates.push(...generated);
    }
  }

  const seen = new Set([normalized]);
  const variants: string[] = [];
  for (const candidate of candidates) {
    const key = normalizeForCompare(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    variants.push(candidate.replace(/\s+/g, " ").trim());
    if (variants.length >= limit) break;
  }
  return variants;
}

/**
 * ¿El título menciona alguna palabra significativa de la consulta (singular/plural indistinto)? Se usa solo para
 * ORDENAR los resultados de una variante (los que no coinciden van al final): nunca para descartarlos.
 */
export function titleMatchesQuery(title: string, query: string): boolean {
  const significant = tokenize(query).filter(
    (token) => token.key.length > 1 && !ARTICLES.es.has(token.key) && !ARTICLES.en.has(token.key) && !CONNECTORS.es.has(token.key) && !CONNECTORS.en.has(token.key),
  );
  if (significant.length === 0) return true;
  // Singular/plural indistinto: cada palabra aporta su forma tal cual y sin "s"/"es" final.
  const forms = (key: string) => [key, key.replace(/s$/, ""), key.replace(/es$/, "")];
  const titleForms = new Set(tokenize(title).flatMap((token) => forms(token.key)));
  return significant.some((token) => forms(token.key).some((form) => titleForms.has(form)));
}
