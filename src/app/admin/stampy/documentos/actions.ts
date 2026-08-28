"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { sanitizeFileName } from "@/lib/storage";
import {
  indexStampyKnowledgeDocument,
  STAMPY_KNOWLEDGE_DOCUMENT_BUCKET,
  type StampyKnowledgeDocumentForIndexing,
} from "@/lib/stampy/knowledge-document-indexer";
import { MAX_KNOWLEDGE_DOCUMENT_BYTES } from "@/lib/stampy/pdf-extraction";
import { createClient } from "@/utils/supabase/server";

const ADMIN_DOCUMENTS_PATH = "/admin/stampy/documentos";

interface AdminContext {
  supabase: SupabaseClient;
  userId: string;
}

async function requireAdmin(): Promise<AdminContext | null> {
  const supabase = await createClient();
  const { access, error } = await getCurrentUserAccess(supabase);
  if (error || !access.userId || !access.capabilities.accessAdmin) return null;
  return { supabase, userId: access.userId };
}

function compactError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function validTitle(value: string): string | null {
  const title = value.trim();
  return title.length >= 3 && title.length <= 180 ? title : null;
}

export async function createStampyKnowledgeDocument(input: {
  title: string;
  description?: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}) {
  const admin = await requireAdmin();
  if (!admin) return { error: "No autorizado." };

  const title = validTitle(input.title);
  const cleanFileName = sanitizeFileName(input.fileName);
  if (!title) return { error: "El título debe tener entre 3 y 180 caracteres." };
  if (!cleanFileName.toLowerCase().endsWith(".pdf")) return { error: "El archivo debe ser PDF." };
  if (input.mimeType !== "application/pdf") return { error: "El tipo de archivo debe ser application/pdf." };
  if (!Number.isSafeInteger(input.fileSize) || input.fileSize <= 0 || input.fileSize > MAX_KNOWLEDGE_DOCUMENT_BYTES) {
    return { error: "El PDF debe pesar como máximo 20 MB." };
  }

  const documentId = randomUUID();
  const filePath = `${admin.userId}/${documentId}/${cleanFileName}`;
  const { error } = await admin.supabase.from("stampy_knowledge_documents").insert({
    id: documentId,
    title,
    description: input.description?.trim().slice(0, 1_000) || null,
    source_type: "pdf",
    file_name: input.fileName.slice(0, 255),
    file_path: filePath,
    mime_type: input.mimeType,
    file_size: input.fileSize,
    status: "draft",
    is_active: true,
    created_by: admin.userId,
  });

  if (error) return { error: error.message };
  revalidatePath(ADMIN_DOCUMENTS_PATH);
  return { success: true, documentId, filePath };
}

export async function processStampyKnowledgeDocument(documentId: string) {
  const admin = await requireAdmin();
  if (!admin) return { error: "No autorizado." };
  if (!documentId) return { error: "Documento inválido." };

  const { data, error: readError } = await admin.supabase
    .from("stampy_knowledge_documents")
    .select("id, title, file_path, mime_type, file_size, status")
    .eq("id", documentId)
    .single();

  if (readError || !data) return { error: "No se encontró el documento." };
  if (data.status === "archived") return { error: "El documento está archivado." };

  const { error: processingError } = await admin.supabase
    .from("stampy_knowledge_documents")
    .update({ status: "processing", extraction_error: null })
    .eq("id", documentId);
  if (processingError) return { error: processingError.message };

  try {
    const result = await indexStampyKnowledgeDocument({
      supabase: admin.supabase,
      document: data as StampyKnowledgeDocumentForIndexing,
    });
    revalidatePath(ADMIN_DOCUMENTS_PATH);
    return { success: true, result };
  } catch (error) {
    const message = compactError(error);
    console.error("[Stampy Documents] processing failed", message);
    await admin.supabase
      .from("stampy_knowledge_documents")
      .update({
        status: "error",
        extraction_error: message,
        processed_at: null,
      })
      .eq("id", documentId);
    revalidatePath(ADMIN_DOCUMENTS_PATH);
    return { error: message };
  }
}

export async function updateStampyKnowledgeDocument(input: {
  documentId: string;
  title: string;
  description?: string;
}) {
  const admin = await requireAdmin();
  if (!admin) return { error: "No autorizado." };
  const title = validTitle(input.title);
  if (!title) return { error: "El título debe tener entre 3 y 180 caracteres." };

  const { data, error } = await admin.supabase
    .from("stampy_knowledge_documents")
    .update({
      title,
      description: input.description?.trim().slice(0, 1_000) || null,
    })
    .eq("id", input.documentId)
    .select("id")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "No se encontró el documento a editar." };
  revalidatePath(ADMIN_DOCUMENTS_PATH);
  return { success: true };
}

export async function setStampyKnowledgeDocumentActive(documentId: string, isActive: boolean) {
  const admin = await requireAdmin();
  if (!admin) return { error: "No autorizado." };

  const { data, error } = await admin.supabase
    .from("stampy_knowledge_documents")
    .update({ is_active: isActive })
    .eq("id", documentId)
    .neq("status", "archived")
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "No se encontró un documento activo para actualizar." };

  const { error: chunksError } = await admin.supabase
    .from("stampy_knowledge_chunks")
    .update({ is_active: isActive })
    .eq("source_type", "knowledge_document")
    .eq("source_id", documentId);
  if (chunksError) return { error: chunksError.message };

  revalidatePath(ADMIN_DOCUMENTS_PATH);
  return { success: true };
}

export async function archiveStampyKnowledgeDocument(documentId: string) {
  const admin = await requireAdmin();
  if (!admin) return { error: "No autorizado." };

  const { data, error } = await admin.supabase
    .from("stampy_knowledge_documents")
    .update({ status: "archived", is_active: false })
    .eq("id", documentId)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "No se encontró el documento." };

  const { error: chunksError } = await admin.supabase
    .from("stampy_knowledge_chunks")
    .update({ is_active: false })
    .eq("source_type", "knowledge_document")
    .eq("source_id", documentId);
  if (chunksError) return { error: chunksError.message };

  revalidatePath(ADMIN_DOCUMENTS_PATH);
  return { success: true };
}

export async function deleteStampyKnowledgeDocument(documentId: string) {
  const admin = await requireAdmin();
  if (!admin) return { error: "No autorizado." };

  const { data: document, error: readError } = await admin.supabase
    .from("stampy_knowledge_documents")
    .select("id, file_path")
    .eq("id", documentId)
    .single();
  if (readError || !document) return { error: "No se encontró el documento." };

  if (document.file_path) {
    const { error: storageError } = await admin.supabase.storage
      .from(STAMPY_KNOWLEDGE_DOCUMENT_BUCKET)
      .remove([document.file_path]);
    if (storageError) return { error: storageError.message };
  }

  const { error: chunksError } = await admin.supabase
    .from("stampy_knowledge_chunks")
    .delete()
    .eq("source_type", "knowledge_document")
    .eq("source_id", documentId);
  if (chunksError) return { error: chunksError.message };

  const { error: deleteError } = await admin.supabase
    .from("stampy_knowledge_documents")
    .delete()
    .eq("id", documentId);
  if (deleteError) return { error: deleteError.message };

  revalidatePath(ADMIN_DOCUMENTS_PATH);
  return { success: true };
}
