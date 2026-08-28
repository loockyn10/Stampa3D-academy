import type { StampyRetrievedChunk } from "./types";

const SOURCE_PRIORITY: Record<string, number> = {
  lesson_transcript: 0,
  lesson: 0,
  course: 0,
  workshop: 0,
  module: 0,
  stampy_context: 1,
  knowledge_document: 2,
};

export function prioritizeStampyRetrievedChunks(
  chunks: StampyRetrievedChunk[],
  limit: number,
): StampyRetrievedChunk[] {
  return [...chunks]
    .sort((left, right) => {
      const priorityDifference =
        (SOURCE_PRIORITY[left.source_type] ?? 3) -
        (SOURCE_PRIORITY[right.source_type] ?? 3);
      return priorityDifference || right.similarity - left.similarity;
    })
    .slice(0, Math.max(0, limit));
}

export function getKnowledgeDocumentPageLabel(chunk: StampyRetrievedChunk): string {
  if (chunk.source_type !== "knowledge_document") return "";
  const pageStart = Number(chunk.metadata?.page_start);
  const pageEnd = Number(chunk.metadata?.page_end);
  if (!Number.isFinite(pageStart) || !Number.isFinite(pageEnd)) return "";
  return pageStart === pageEnd ? `página ${pageStart}` : `páginas ${pageStart}-${pageEnd}`;
}
