import { SupabaseClient } from "@supabase/supabase-js";
import { createEmbedding } from "./embeddings";
import { StampyRetrievedChunk } from "./types";

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

    const { data: chunks, error } = await supabase.rpc("match_stampy_knowledge_chunks", {
      query_embedding: embedding,
      match_threshold: minSimilarity,
      match_count: limit,
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

    const typedChunks = chunks as StampyRetrievedChunk[];

    console.log("[Stampy] retrieval", {
      enabled: isEnabled,
      queryChars: query.length,
      chunksFound: typedChunks.length,
      topSimilarity: typedChunks[0]?.similarity,
      sourceTypes: typedChunks.map(c => c.source_type).slice(0, 5),
    });

    let contextText = "CONOCIMIENTO RELEVANTE DE ACADEMIA STAMPA:\nEstos fragmentos fueron recuperados del índice de conocimiento. Usalos cuando sean relevantes. Si no alcanzan, aclaralo.\n\n";

    let charCount = contextText.length;
    const MAX_CHARS = 7000;

    for (let i = 0; i < typedChunks.length; i++) {
      const c = typedChunks[i];
      const snippet = `Fragmento ${i + 1}:\nTítulo: ${c.title}\nFuente: ${c.source_type}\nRuta: ${c.route}\nContenido:\n${c.content}\n\n`;
      
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
