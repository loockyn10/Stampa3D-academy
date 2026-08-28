import { redirect } from "next/navigation";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { createClient } from "@/utils/supabase/server";
import { KnowledgeDocumentsAdmin } from "./knowledge-documents-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export interface KnowledgeDocumentAdminRow {
  id: string;
  title: string;
  description: string | null;
  file_name: string | null;
  file_path: string | null;
  mime_type: string | null;
  file_size: number | null;
  status: "draft" | "processing" | "ready" | "error" | "archived";
  is_active: boolean;
  extracted_text: string | null;
  extraction_error: string | null;
  chunks_count: number;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
  preview_chunks: Array<{
    id: string;
    title: string;
    content: string;
    source_key: string | null;
  }>;
}

export default async function StampyKnowledgeDocumentsPage() {
  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);
  if (!access.capabilities.accessAdmin) redirect("/sin-acceso");

  const { data: documents, error } = await supabase
    .from("stampy_knowledge_documents")
    .select("*")
    .order("created_at", { ascending: false });

  const documentIds = (documents ?? []).map((document) => document.id);
  const chunksByDocument = new Map<string, KnowledgeDocumentAdminRow["preview_chunks"]>();

  if (documentIds.length > 0) {
    const { data: chunks } = await supabase
      .from("stampy_knowledge_chunks")
      .select("id, source_id, source_key, title, content")
      .eq("source_type", "knowledge_document")
      .in("source_id", documentIds)
      .order("source_key", { ascending: true });

    for (const chunk of chunks ?? []) {
      if (!chunk.source_id) continue;
      const current = chunksByDocument.get(chunk.source_id) ?? [];
      if (current.length < 3) {
        current.push({
          id: chunk.id,
          title: chunk.title,
          content: chunk.content,
          source_key: chunk.source_key,
        });
      }
      chunksByDocument.set(chunk.source_id, current);
    }
  }

  const rows = (documents ?? []).map((document) => ({
    ...document,
    preview_chunks: chunksByDocument.get(document.id) ?? [],
  })) as KnowledgeDocumentAdminRow[];

  return <KnowledgeDocumentsAdmin documents={rows} initialError={error?.message ?? null} />;
}
