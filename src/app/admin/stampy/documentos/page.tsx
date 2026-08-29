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
  extraction_error: string | null;
  chunks_count: number;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

export interface KnowledgeDocumentPreviewChunk {
  id: string;
  title: string;
  content: string;
  source_key: string | null;
}

export default async function StampyKnowledgeDocumentsPage() {
  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);
  if (!access.capabilities.accessAdmin) redirect("/sin-acceso");

  const { data: documents, error } = await supabase
    .from("stampy_knowledge_documents")
    .select("id, title, description, file_name, file_path, mime_type, file_size, status, is_active, extraction_error, chunks_count, created_at, updated_at, processed_at")
    .order("created_at", { ascending: false });

  const rows = (documents ?? []) as KnowledgeDocumentAdminRow[];

  return <KnowledgeDocumentsAdmin documents={rows} initialError={error?.message ?? null} />;
}
