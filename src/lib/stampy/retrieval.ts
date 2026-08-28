import { SupabaseClient } from "@supabase/supabase-js";
import { createEmbedding } from "./embeddings";
import { StampyRetrievedChunk } from "./types";
import {
  getKnowledgeDocumentPageLabel,
  prioritizeStampyRetrievedChunks,
} from "./knowledge-retrieval-policy";

interface RetrieveParams {
  supabase: SupabaseClient;
  query: string;
  courseId?: string;
  lessonId?: string;
  currentPath?: string;
  maxChunks?: number;
}

export async function retrieveStampyKnowledge({
  supabase,
  query,
  courseId,
  lessonId,
  currentPath,
  maxChunks = 8,
}: RetrieveParams): Promise<string> {
  const isEnabled = process.env.STAMPY_RETRIEVAL_ENABLED === "true";
  if (!isEnabled) {
    return "";
  }

  const minSimilarity = parseFloat(process.env.STAMPY_RETRIEVAL_MIN_SIMILARITY || "0.72");
  const envMaxChunks = parseInt(process.env.STAMPY_RETRIEVAL_MAX_CHUNKS || "8", 10);
  const limit = Math.min(maxChunks, envMaxChunks);

  try {
    const embedding = await createEmbedding(query);

    const candidateCount = Math.min(Math.max(limit * 4, limit), 50);
    const { data: chunks, error } = await supabase.rpc("match_stampy_knowledge_chunks", {
      query_embedding: embedding,
      match_threshold: minSimilarity,
      match_count: candidateCount,
    });

    if (error) {
      throw error;
    }

    if (!chunks || chunks.length === 0) {
      console.log("[Stampy] retrieval", {
        enabled: isEnabled,
        queryChars: query.length,
        chunksFound: 0,
      });
      return "";
    }

    const typedChunks = prioritizeStampyRetrievedChunks(
      chunks as StampyRetrievedChunk[],
      limit,
    );

    console.log("[Stampy] retrieval", {
      enabled: isEnabled,
      queryChars: query.length,
      chunksFound: typedChunks.length,
      topSimilarity: typedChunks[0]?.similarity,
      sourceTypes: typedChunks.map(c => c.source_type).slice(0, 5),
    });

    let contextText = "CONOCIMIENTO RELEVANTE DE ACADEMIA STAMPA:\nUsá estas fuentes sólo cuando sean relevantes. Si no alcanzan, aclaralo. No copies pasajes largos.\n\n";

    let charCount = contextText.length;
    const MAX_CHARS = 7000;

    for (let i = 0; i < typedChunks.length; i++) {
      const c = typedChunks[i];
      const documentPageLabel = getKnowledgeDocumentPageLabel(c);
      const sourceLabel = c.source_type === "knowledge_document"
        ? `Documento técnico${documentPageLabel ? ` (${documentPageLabel})` : ""}`
        : c.source_type;
      const routeLine = c.source_type === "knowledge_document" ? "" : `Ruta: ${c.route}\n`;
      const snippet = `Fuente ${i + 1}:\nTítulo: ${c.title}\nTipo: ${sourceLabel}\n${routeLine}Contenido:\n${c.content}\n\n`;
      
      if (charCount + snippet.length > MAX_CHARS) {
        break; // Stop appending to avoid going over the limit
      }
      
      contextText += snippet;
      charCount += snippet.length;
    }

    return contextText;

  } catch (err) {
    console.error("[Stampy] retrieval failed:", err);
    return "";
  }
}
