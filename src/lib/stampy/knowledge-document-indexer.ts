import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createEmbeddings } from "./embeddings";
import {
  buildKnowledgeDocumentExtractedText,
  chunkKnowledgeDocumentPages,
} from "./knowledge-document-chunking";
import { extractPdfText } from "./pdf-extraction";

export const STAMPY_KNOWLEDGE_DOCUMENT_BUCKET = "stampy-knowledge-documents";

export interface StampyKnowledgeDocumentForIndexing {
  id: string;
  title: string;
  file_path: string | null;
  mime_type: string | null;
  file_size: number | null;
  status: string;
}

interface IndexKnowledgeDocumentResult {
  chunksCount: number;
  totalPages: number;
  extractedChars: number;
}

export async function indexStampyKnowledgeDocument({
  supabase,
  document,
}: {
  supabase: SupabaseClient;
  document: StampyKnowledgeDocumentForIndexing;
}): Promise<IndexKnowledgeDocumentResult> {
  if (!document.file_path) {
    throw new Error("El documento no tiene un archivo asociado.");
  }
  if (document.mime_type !== "application/pdf") {
    throw new Error("El documento debe ser un PDF.");
  }

  const { data: file, error: downloadError } = await supabase.storage
    .from(STAMPY_KNOWLEDGE_DOCUMENT_BUCKET)
    .download(document.file_path);

  if (downloadError || !file) {
    throw new Error(downloadError?.message || "No se pudo descargar el PDF privado.");
  }

  const extracted = await extractPdfText(await file.arrayBuffer());
  const extractedText = buildKnowledgeDocumentExtractedText(extracted.pages);
  const chunks = chunkKnowledgeDocumentPages(extracted.pages);

  if (!extractedText || chunks.length === 0) {
    throw new Error("No se pudo extraer texto. Puede ser un PDF escaneado. OCR queda pendiente.");
  }

  const embeddings = await createEmbeddings(chunks.map((chunk) => chunk.content));
  if (embeddings.length !== chunks.length) {
    throw new Error("No se pudieron generar todos los embeddings del documento.");
  }

  const rpcChunks = chunks.map((chunk, index) => ({
    source_key: `chunk_${chunk.chunkIndex}`,
    title: `${document.title} — páginas ${chunk.pageStart}-${chunk.pageEnd}`,
    content: chunk.content,
    metadata: {
      document_id: document.id,
      document_title: document.title,
      page_start: chunk.pageStart,
      page_end: chunk.pageEnd,
      chunk_index: chunk.chunkIndex,
      source_type: "knowledge_document",
    },
    embedding: embeddings[index],
  }));

  const { data: insertedCount, error: replaceError } = await supabase.rpc(
    "replace_stampy_knowledge_document_chunks",
    {
      p_document_id: document.id,
      p_extracted_text: extractedText,
      p_chunks: rpcChunks,
    },
  );

  if (replaceError) {
    throw new Error(replaceError.message || "No se pudieron reemplazar los chunks del documento.");
  }

  return {
    chunksCount: Number(insertedCount ?? chunks.length),
    totalPages: extracted.totalPages,
    extractedChars: extractedText.length,
  };
}
