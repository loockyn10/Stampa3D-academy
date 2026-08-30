"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { useAppFeedback } from "@/components/ui/app-feedback";
import type { KnowledgeDocumentAdminRow, KnowledgeDocumentPreviewChunk } from "./page";
import {
  archiveStampyKnowledgeDocument,
  createStampyKnowledgeDocument,
  deleteStampyKnowledgeDocument,
  getStampyKnowledgeDocumentPreview,
  processStampyKnowledgeDocument,
  setStampyKnowledgeDocumentActive,
  updateStampyKnowledgeDocument,
} from "./actions";

const BUCKET = "stampy-knowledge-documents";
const MAX_BYTES = 20 * 1024 * 1024;
const RESUMABLE_THRESHOLD = 6 * 1024 * 1024;

type ActionResult = { success?: boolean; error?: string };

async function uploadPrivatePdf(file: File, filePath: string, onProgress: (value: number) => void) {
  const supabase = createClient();
  if (file.size <= RESUMABLE_THRESHOLD) {
    const { error } = await supabase.storage.from(BUCKET).upload(filePath, file, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (error) throw error;
    onProgress(100);
    return;
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session) throw new Error("No hay una sesión activa para subir el PDF.");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error("Falta configuración pública de Supabase.");

  const tus = await import("tus-js-client");
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 3_000, 5_000, 10_000],
      headers: {
        authorization: `Bearer ${sessionData.session.access_token}`,
        apikey: anonKey,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: BUCKET,
        objectName: filePath,
        contentType: "application/pdf",
        cacheControl: "3600",
      },
      chunkSize: 6 * 1024 * 1024,
      onError: reject,
      onProgress: (uploaded, total) => onProgress(Math.round((uploaded / total) * 100)),
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

function statusStyle(status: KnowledgeDocumentAdminRow["status"]) {
  if (status === "ready") return "bg-emerald-500/10 text-emerald-300";
  if (status === "error") return "bg-red-500/10 text-red-300";
  if (status === "processing") return "bg-cyan-500/10 text-cyan-300";
  if (status === "archived") return "bg-gray-500/10 text-gray-400";
  return "bg-amber-500/10 text-amber-300";
}

function formatBytes(value: number | null) {
  if (!value) return "—";
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function KnowledgeDocumentsAdmin({
  documents,
  initialError,
}: {
  documents: KnowledgeDocumentAdminRow[];
  initialError: string | null;
}) {
  const router = useRouter();
  const { confirmAction, promptForValue } = useAppFeedback();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState<string | null>(initialError);
  const [previewByDocument, setPreviewByDocument] = useState<Record<string, KnowledgeDocumentPreviewChunk[]>>({});
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [openPreviewId, setOpenPreviewId] = useState<string | null>(null);

  const runAction = async (id: string, action: () => Promise<ActionResult>) => {
    setBusyId(id);
    setNotice(null);
    try {
      const result = await action();
      if (result.error) setNotice(result.error);
      else router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "La operación falló.");
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async () => {
    setNotice(null);
    if (!file) return setNotice("Seleccioná un PDF.");
    if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
      return setNotice("El archivo debe ser un PDF válido.");
    }
    if (file.size <= 0 || file.size > MAX_BYTES) return setNotice("El PDF debe pesar como máximo 20 MB.");

    setUploading(true);
    setProgress(0);
    try {
      const created = await createStampyKnowledgeDocument({
        title,
        description,
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      });
      if (created.error || !created.documentId || !created.filePath) {
        throw new Error(created.error || "No se pudo crear el documento.");
      }

      await uploadPrivatePdf(file, created.filePath, setProgress);
      const processed = await processStampyKnowledgeDocument(created.documentId);
      if (processed.error) throw new Error(processed.error);

      setTitle("");
      setDescription("");
      setFile(null);
      setNotice("Documento subido e indexado correctamente.");
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo subir el documento.");
      router.refresh();
    } finally {
      setUploading(false);
    }
  };

  const handleEdit = async (document: KnowledgeDocumentAdminRow) => {
    const nextTitle = await promptForValue({
      title: "Editar documento",
      label: "Título del documento",
      initialValue: document.title,
      confirmLabel: "Continuar",
    });
    if (nextTitle === null) return;
    const nextDescription = await promptForValue({
      title: "Editar documento",
      label: "Descripción",
      initialValue: document.description ?? "",
      confirmLabel: "Guardar cambios",
    });
    if (nextDescription === null) return;
    await runAction(document.id, () =>
      updateStampyKnowledgeDocument({
        documentId: document.id,
        title: nextTitle,
        description: nextDescription,
      }),
    );
  };

  const handleDelete = async (document: KnowledgeDocumentAdminRow) => {
    const confirmed = await confirmAction({
      title: "Eliminar documento",
      description: `Se eliminarán definitivamente “${document.title}” y todos sus fragmentos indexados.`,
      confirmLabel: "Eliminar documento",
      destructive: true,
    });
    if (!confirmed) return;
    await runAction(document.id, () => deleteStampyKnowledgeDocument(document.id));
  };

  const handlePreview = async (documentId: string) => {
    if (openPreviewId === documentId) {
      setOpenPreviewId(null);
      return;
    }
    setOpenPreviewId(documentId);
    if (previewByDocument[documentId]) return;

    setPreviewLoadingId(documentId);
    try {
      const result = await getStampyKnowledgeDocumentPreview(documentId);
      if (result.error) {
        setNotice(result.error);
        setOpenPreviewId(null);
      } else {
        setPreviewByDocument((current) => ({
          ...current,
          [documentId]: result.previewChunks ?? [],
        }));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo cargar la vista previa.");
      setOpenPreviewId(null);
    } finally {
      setPreviewLoadingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm">
          <Link href="/admin/stampy" className="font-medium text-cyan-400 hover:text-cyan-300">Stampy</Link>
          <span className="text-gray-600">/</span>
          <span className="text-gray-500">Documentos</span>
        </div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
          <FileText className="text-cyan-400" /> Documentos de conocimiento
        </h1>
        <p className="mt-1 text-sm text-gray-500">PDFs privados que Stampy puede consultar mediante retrieval semántico.</p>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-sm text-cyan-100">
          <AlertCircle size={16} /> {notice}
        </div>
      )}

      <section className="space-y-4 rounded-2xl border border-stampa-border bg-stampa-surface p-5">
        <div>
          <h2 className="font-bold text-white">Subir PDF</h2>
          <p className="text-xs text-gray-500">Sólo PDF con texto seleccionable. Máximo 20 MB. OCR no está habilitado.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título" maxLength={180} className="rounded-xl border border-stampa-border bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50" />
          <input type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="rounded-xl border border-stampa-border bg-white/5 px-3 py-2 text-sm text-gray-300" />
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descripción opcional" maxLength={1000} rows={3} className="rounded-xl border border-stampa-border bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50 md:col-span-2" />
        </div>
        {uploading && (
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-cyan-500 transition-all" style={{ width: `${Math.max(progress, 5)}%` }} />
          </div>
        )}
        <button onClick={handleCreate} disabled={uploading || !file || title.trim().length < 3} className="flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
          {uploading ? `Procesando (${progress}%)` : "Subir e indexar"}
        </button>
      </section>

      <section className="space-y-4">
        {documents.length === 0 ? (
          <div className="rounded-2xl border border-stampa-border bg-stampa-surface p-10 text-center text-sm text-gray-500">Todavía no hay documentos.</div>
        ) : documents.map((document) => {
          const busy = busyId === document.id;
          return (
            <article key={document.id} className="rounded-2xl border border-stampa-border bg-stampa-surface p-5">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-bold text-white">{document.title}</h2>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusStyle(document.status)}`}>{document.status}</span>
                    {!document.is_active && <span className="rounded-full bg-gray-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-400">inactivo</span>}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{document.file_name ?? "Sin archivo"} · {formatBytes(document.file_size)} · {document.chunks_count} chunks</p>
                  {document.description && <p className="mt-2 text-sm text-gray-400">{document.description}</p>}
                  {document.processed_at && <p className="mt-1 text-xs text-gray-600">Procesado: {new Date(document.processed_at).toLocaleString("es-AR")}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button disabled={busy} onClick={() => void handleEdit(document)} className="rounded-lg border border-stampa-border p-2 text-gray-400 hover:text-white" title="Editar"><Pencil size={15} /></button>
                  <button disabled={busy || document.status === "processing"} onClick={() => void runAction(document.id, () => processStampyKnowledgeDocument(document.id))} className="flex items-center gap-1 rounded-lg border border-stampa-border px-3 py-2 text-xs text-cyan-300" title="Reindexar">{busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Reindexar</button>
                  <button disabled={busy || document.status === "archived"} onClick={() => void runAction(document.id, () => setStampyKnowledgeDocumentActive(document.id, !document.is_active))} className="rounded-lg border border-stampa-border px-3 py-2 text-xs text-gray-300">{document.is_active ? "Desactivar" : "Activar"}</button>
                  <button disabled={busy || document.status === "archived"} onClick={() => void runAction(document.id, () => archiveStampyKnowledgeDocument(document.id))} className="rounded-lg border border-stampa-border p-2 text-amber-300" title="Archivar"><Archive size={15} /></button>
                  <button disabled={busy} onClick={() => void handleDelete(document)} className="rounded-lg border border-red-500/20 p-2 text-red-300" title="Eliminar"><Trash2 size={15} /></button>
                </div>
              </div>

              {document.extraction_error && (
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-500/10 p-3 text-xs text-red-200"><AlertCircle size={14} className="mt-0.5 shrink-0" /> {document.extraction_error}</div>
              )}

              {document.status === "ready" && (
                <div className="mt-4 flex items-center gap-2 text-xs text-emerald-300"><CheckCircle2 size={14} /> Disponible para retrieval cuando está activo.</div>
              )}

              {document.chunks_count > 0 && (
                <div className="mt-4 rounded-xl border border-white/5 bg-black/20 p-3">
                  <button
                    type="button"
                    onClick={() => void handlePreview(document.id)}
                    className="flex items-center gap-2 text-sm font-semibold text-gray-300 hover:text-white"
                  >
                    {previewLoadingId === document.id && <Loader2 size={14} className="animate-spin" />}
                    {openPreviewId === document.id ? "Ocultar vista previa" : "Ver vista previa del índice"}
                  </button>
                  {openPreviewId === document.id && (previewByDocument[document.id] ?? []).map((chunk) => (
                    <div key={chunk.id} className="mt-3 border-t border-white/5 pt-3">
                      <p className="text-xs font-semibold text-cyan-300">{chunk.title}</p>
                      <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-xs text-gray-500">{chunk.content.slice(0, 1_500)}</p>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}
