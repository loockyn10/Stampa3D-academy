export interface KnowledgeDocumentPage {
  pageNumber: number;
  text: string;
}

export interface KnowledgeDocumentChunk {
  content: string;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
}

interface ChunkOptions {
  targetChars?: number;
  maxChars?: number;
  overlapChars?: number;
  minChars?: number;
}

const DEFAULT_TARGET_CHARS = 4_500;
const DEFAULT_MAX_CHARS = 6_000;
const DEFAULT_OVERLAP_CHARS = 550;
const DEFAULT_MIN_CHARS = 900;

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function edgeCandidates(text: string): { first: string | null; last: string | null } {
  const lines = text
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);

  return {
    first: lines[0] ?? null,
    last: lines.at(-1) ?? null,
  };
}

function findRepeatedEdges(pages: KnowledgeDocumentPage[]): Set<string> {
  if (pages.length < 3) return new Set();

  const counts = new Map<string, number>();
  for (const page of pages) {
    const edges = new Set(Object.values(edgeCandidates(page.text)).filter(Boolean) as string[]);
    for (const edge of edges) {
      if (edge.length < 3 || edge.length > 180) continue;
      counts.set(edge, (counts.get(edge) ?? 0) + 1);
    }
  }

  const minimumOccurrences = Math.max(3, Math.ceil(pages.length * 0.6));
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= minimumOccurrences)
      .map(([line]) => line),
  );
}

export function cleanKnowledgeDocumentPages(
  pages: KnowledgeDocumentPage[],
): KnowledgeDocumentPage[] {
  const repeatedEdges = findRepeatedEdges(pages);

  return pages.map((page) => {
    const lines = page.text.split(/\r?\n/).map(normalizeLine);
    while (lines.length > 0 && !lines[0]) lines.shift();
    while (lines.length > 0 && !lines.at(-1)) lines.pop();
    if (lines[0] && repeatedEdges.has(lines[0])) lines.shift();
    if (lines.at(-1) && repeatedEdges.has(lines.at(-1) as string)) lines.pop();

    return {
      pageNumber: page.pageNumber,
      text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    };
  });
}

interface TextPart {
  text: string;
  pageNumber: number;
}

function splitOversizedText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf(" ", maxChars);
    if (splitAt < Math.floor(maxChars * 0.6)) splitAt = maxChars;
    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function pagesToParts(pages: KnowledgeDocumentPage[], maxChars: number): TextPart[] {
  return pages.flatMap((page) => {
    const paragraphs = page.text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    return paragraphs.flatMap((paragraph) =>
      splitOversizedText(paragraph, maxChars).map((text) => ({
        text,
        pageNumber: page.pageNumber,
      })),
    );
  });
}

function overlapParts(parts: TextPart[], overlapChars: number): TextPart[] {
  const overlap: TextPart[] = [];
  let remainingChars = overlapChars;
  for (let index = parts.length - 1; index >= 0 && remainingChars > 0; index -= 1) {
    const part = parts[index];
    if (part.text.length <= remainingChars) {
      overlap.unshift(part);
      remainingChars -= part.text.length + 2;
      continue;
    }

    let tail = part.text.slice(-remainingChars);
    const firstSpace = tail.indexOf(" ");
    if (firstSpace >= 0 && firstSpace < Math.floor(tail.length * 0.25)) {
      tail = tail.slice(firstSpace + 1);
    }
    overlap.unshift({ text: tail.trim(), pageNumber: part.pageNumber });
    remainingChars = 0;
  }
  return overlap;
}

function toChunk(parts: TextPart[], chunkIndex: number): KnowledgeDocumentChunk {
  return {
    content: parts.map((part) => part.text).join("\n\n").trim(),
    chunkIndex,
    pageStart: Math.min(...parts.map((part) => part.pageNumber)),
    pageEnd: Math.max(...parts.map((part) => part.pageNumber)),
  };
}

export function chunkKnowledgeDocumentPages(
  rawPages: KnowledgeDocumentPage[],
  options: ChunkOptions = {},
): KnowledgeDocumentChunk[] {
  const targetChars = options.targetChars ?? DEFAULT_TARGET_CHARS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS;

  if (targetChars <= 0 || maxChars < targetChars || overlapChars < 0) {
    throw new Error("Configuración de chunking inválida.");
  }

  const pages = cleanKnowledgeDocumentPages(rawPages).filter((page) => page.text);
  const parts = pagesToParts(pages, maxChars);
  if (parts.length === 0) return [];

  const groups: TextPart[][] = [];
  let current: TextPart[] = [];
  let currentChars = 0;
  let hasNewParts = false;

  for (const part of parts) {
    if (current.length > 0 && currentChars + 2 + part.text.length > maxChars) {
      groups.push(current);
      current = overlapParts(current, overlapChars);
      currentChars = current.reduce((total, item) => total + item.text.length + 2, 0);
      hasNewParts = false;
    }

    const separatorChars = current.length > 0 ? 2 : 0;
    current.push(part);
    currentChars += separatorChars + part.text.length;
    hasNewParts = true;

    if (currentChars >= targetChars) {
      groups.push(current);
      current = overlapParts(current, overlapChars);
      currentChars = current.reduce((total, item) => total + item.text.length + 2, 0);
      hasNewParts = false;
    }
  }

  if (current.length > 0 && hasNewParts) {
    const previous = groups.at(-1);
    const currentTextLength = current.map((part) => part.text).join("\n\n").length;
    const previousTextLength = previous?.map((part) => part.text).join("\n\n").length ?? 0;
    const additions = previous ? current.filter((part) => !previous.includes(part)) : current;
    const additionsLength = additions.map((part) => part.text).join("\n\n").length;
    if (previous && currentTextLength < minChars && previousTextLength + 2 + additionsLength <= maxChars) {
      groups[groups.length - 1] = [...previous, ...additions];
    } else {
      groups.push(current);
    }
  }

  return groups
    .map((group, chunkIndex) => toChunk(group, chunkIndex))
    .filter((chunk, index, chunks) => index === 0 || chunk.content !== chunks[index - 1].content);
}

export function buildKnowledgeDocumentExtractedText(
  pages: KnowledgeDocumentPage[],
): string {
  return cleanKnowledgeDocumentPages(pages)
    .filter((page) => page.text)
    .map((page) => `[Página ${page.pageNumber}]\n${page.text}`)
    .join("\n\n")
    .trim();
}
