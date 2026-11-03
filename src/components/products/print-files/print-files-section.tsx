"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Download, FileBox, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { deleteProductPrintFileAction } from "@/app/productos/print-file-actions";
import { uploadPrintFile } from "@/lib/print-files/client-upload";
import {
  currentClientPlatform,
  downloadPrintFile,
  openPrintFileInSlicer,
  type FileActionResult,
} from "@/lib/print-files/client-open";
import { formatBytes } from "@/lib/print-files/config";
import { classifyPrintFilesLoadError } from "@/lib/print-files/load-state";
import { isMobilePlatform, supportsDirectOpen, type ClientPlatform } from "@/lib/print-files/open-plan";
import { SLICERS, getSlicer, slicerLabel, type SlicerId } from "@/lib/print-files/slicers";
import { PRINT_FILE_COLUMNS, type PrintFile, type PrintFileComponent, type PrintFileOption } from "@/lib/print-files/types";
import { formatPrintMinutes } from "@/lib/print-files/validation";
import { PrintFileFormDialog } from "./print-file-form-dialog";
import { SlicerLogo } from "./slicer-logo";

interface PrintFilesSectionProps {
  productId: string;
  supabase: SupabaseClient;
  printers: PrintFileOption[];
  /** Piezas activas de la receta. Con una sola pieza ("Producto completo") no se ofrece vincular. */
  components: PrintFileComponent[];
}

type Notice = { tone: "info" | "warn" | "error"; text: string } | null;

export function PrintFilesSection({ productId, supabase, printers, components }: PrintFilesSectionProps) {
  const { toast, confirmAction } = useAppFeedback();
  const [files, setFiles] = useState<PrintFile[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "unavailable">("loading");
  // El componente solo se monta en el navegador (dentro del detalle abierto por el usuario): no hay SSR que desalinear.
  const [platform] = useState<ClientPlatform>(() => currentClientPlatform());
  const [reloadToken, setReloadToken] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [chooser, setChooser] = useState<SlicerId | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [form, setForm] = useState<{ mode: "create" | "edit"; file?: PrintFile; slicer?: SlicerId } | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<PrintFile | null>(null);

  const mobile = isMobilePlatform(platform);

  // El padre monta la sección con `key={product.id}`: cada producto empieza con avisos y selección limpios.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("product_print_files")
        .select(PRINT_FILE_COLUMNS)
        .eq("product_id", productId)
        .eq("status", "ready")
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) {
        setStatus(classifyPrintFilesLoadError(error));
        return;
      }
      setFiles((data ?? []) as unknown as PrintFile[]);
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, productId, reloadToken]);

  const componentNames = useMemo(() => new Map(components.map((component) => [component.id, component.name])), [components]);
  const filesBySlicer = useMemo(() => {
    const map = new Map<string, PrintFile[]>();
    for (const file of files) map.set(file.slicer, [...(map.get(file.slicer) ?? []), file]);
    return map;
  }, [files]);

  // Sin la migration la biblioteca no existe: no se muestra nada (igual que las categorías de producto).
  if (status === "unavailable") return null;

  const reportResult = (result: FileActionResult) => {
    if (result.kind === "error") setNotice({ tone: "error", text: result.message });
    else setNotice({ tone: "info", text: result.message });
  };

  const runOpen = async (file: PrintFile) => {
    if (busyKey) return;
    setBusyKey(`open:${file.id}`);
    setNotice(null);
    try {
      reportResult(await openPrintFileInSlicer(file.id, file.slicer));
    } finally {
      setBusyKey(null);
    }
  };

  const runDownload = async (file: PrintFile) => {
    if (busyKey) return;
    setBusyKey(`download:${file.id}`);
    setNotice(null);
    try {
      reportResult(await downloadPrintFile(file.id));
    } finally {
      setBusyKey(null);
    }
  };

  const handleSlicerClick = (slicerId: SlicerId) => {
    setNotice(null);
    const candidates = filesBySlicer.get(slicerId) ?? [];
    if (candidates.length === 0) {
      setChooser(slicerId);
      return;
    }
    if (candidates.length === 1) {
      setChooser(null);
      void runOpen(candidates[0]);
      return;
    }
    setChooser((current) => (current === slicerId ? null : slicerId));
  };

  const handleDelete = async (file: PrintFile) => {
    const confirmed = await confirmAction({
      title: "Eliminar proyecto",
      description: `Se eliminará «${file.name}» y su archivo ${file.file_name}. No se puede deshacer.`,
      confirmLabel: "Eliminar proyecto",
      destructive: true,
    });
    if (!confirmed) return;
    setBusyKey(`delete:${file.id}`);
    try {
      const result = await deleteProductPrintFileAction(file.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setFiles((current) => current.filter((item) => item.id !== file.id));
      toast.success("Proyecto eliminado.");
    } finally {
      setBusyKey(null);
    }
  };

  const startReplace = (file: PrintFile) => {
    replaceTargetRef.current = file;
    replaceInputRef.current?.click();
  };

  const handleReplacePicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    event.target.value = "";
    const target = replaceTargetRef.current;
    replaceTargetRef.current = null;
    if (!picked || !target) return;

    const confirmed = await confirmAction({
      title: "Reemplazar archivo",
      description: `«${target.name}» pasará a usar ${picked.name}. El archivo anterior se elimina cuando el nuevo se verifica.`,
      confirmLabel: "Reemplazar",
    });
    if (!confirmed) return;

    setBusyKey(`replace:${target.id}`);
    setNotice(null);
    try {
      const result = await uploadPrintFile({ supabase, file: picked, productId, replaceFileId: target.id });
      if (!result.success) {
        setNotice({ tone: "error", text: result.error });
        return;
      }
      setFiles((current) => [...current.filter((item) => item.id !== target.id), result.file].sort((a, b) => a.created_at.localeCompare(b.created_at)));
      if (result.warning) setNotice({ tone: "warn", text: result.warning });
      else toast.success("Archivo reemplazado.");
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaved = (file: PrintFile, warning?: string) => {
    setFiles((current) => {
      const without = current.filter((item) => item.id !== file.id);
      return [...without, file].sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
    setForm(null);
    setChooser(null);
    if (warning) setNotice({ tone: "warn", text: warning });
    else toast.success(form?.mode === "edit" ? "Cambios guardados." : "Proyecto agregado.");
  };

  const chooserSlicer = chooser ? getSlicer(chooser) : null;
  const chooserFiles = chooser ? filesBySlicer.get(chooser) ?? [] : [];

  return (
    <section aria-labelledby={`print-files-title-${productId}`} className="mb-6 rounded-xl border border-stampa-border bg-stampa-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 id={`print-files-title-${productId}`} className="flex items-center gap-2 text-sm font-bold text-gray-300">
          <FileBox size={16} className="text-stampa-accent" aria-hidden="true" /> Archivos de impresión
        </h4>
        <button
          type="button"
          onClick={() => setForm({ mode: "create" })}
          disabled={status !== "ready"}
          className="flex min-h-9 items-center gap-1.5 rounded-lg border border-stampa-orange/40 bg-stampa-orange/10 px-3 py-1.5 text-xs font-bold text-stampa-accent transition-colors hover:bg-stampa-orange/20 disabled:opacity-50"
        >
          <Plus size={14} aria-hidden="true" /> Agregar proyecto
        </button>
      </div>

      {/* Lanzador por laminador */}
      <div className="mb-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {SLICERS.some((slicer) => supportsDirectOpen(slicer.id, platform)) ? "Abrir en" : "Descargar para"}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {SLICERS.map((slicer) => {
            const count = filesBySlicer.get(slicer.id)?.length ?? 0;
            return (
              <button
                key={slicer.id}
                type="button"
                onClick={() => handleSlicerClick(slicer.id)}
                disabled={status !== "ready" || Boolean(busyKey)}
                aria-pressed={chooser === slicer.id}
                className={`flex min-h-12 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                  chooser === slicer.id ? "border-stampa-orange bg-stampa-orange/10" : "border-stampa-border bg-stampa-bg-soft hover:bg-fg/5"
                }`}
              >
                <SlicerLogo slicerId={slicer.id} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-fg">{slicer.label}</span>
                  <span className="block text-[11px] text-gray-500">
                    {count === 0 ? "Sin proyecto" : count === 1 ? "1 proyecto" : `${count} proyectos`}
                    {count > 0 && !supportsDirectOpen(slicer.id, platform) ? " · se descarga" : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {chooser && chooserSlicer && chooserFiles.length === 0 && (
        <div className="mb-3 rounded-xl border border-stampa-border bg-stampa-bg-soft p-3 text-sm" role="status">
          <p className="text-gray-300">
            Todavía no hay un proyecto preparado para <strong className="text-fg">{chooserSlicer.label}</strong>. Cada laminador necesita su propio
            archivo: no se reutiliza el de otro.
          </p>
          <button
            type="button"
            onClick={() => setForm({ mode: "create", slicer: chooser })}
            className="mt-2 flex min-h-9 items-center gap-1.5 rounded-lg bg-stampa-orange px-3 py-1.5 text-xs font-bold text-neutral-950 hover:bg-stampa-orange-hover"
          >
            <Plus size={14} aria-hidden="true" /> Agregar proyecto de {chooserSlicer.label}
          </button>
        </div>
      )}

      {chooser && chooserSlicer && chooserFiles.length > 1 && (
        <div className="mb-3 rounded-xl border border-stampa-border bg-stampa-bg-soft p-3" role="group" aria-label={`Proyectos de ${chooserSlicer.label}`}>
          <p className="mb-2 text-xs font-semibold text-gray-400">Elegí qué proyecto de {chooserSlicer.label} {supportsDirectOpen(chooserSlicer.id, platform) ? "abrir" : "descargar"}:</p>
          <ul className="space-y-1.5">
            {chooserFiles.map((file) => (
              <li key={file.id}>
                <button
                  type="button"
                  onClick={() => {
                    setChooser(null);
                    void runOpen(file);
                  }}
                  disabled={Boolean(busyKey)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-stampa-border bg-stampa-surface px-3 py-2 text-left hover:bg-fg/5 disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-fg">{file.name}</span>
                    <span className="block truncate text-[11px] text-gray-500">{file.printer_name || "Impresora sin especificar"}</span>
                  </span>
                  <span className="shrink-0 text-xs font-bold text-stampa-accent">{supportsDirectOpen(chooserSlicer.id, platform) ? "Abrir" : "Descargar"}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mb-3 rounded-xl border p-3 text-sm ${
            notice.tone === "error"
              ? "border-red-500/25 bg-red-500/10 text-red-300"
              : notice.tone === "warn"
                ? "border-yellow-500/25 bg-yellow-500/10 text-yellow-300"
                : "border-stampa-border bg-stampa-bg-soft text-gray-300"
          }`}
        >
          {notice.text}
        </p>
      )}

      {status === "loading" && (
        <p className="flex items-center gap-2 py-3 text-xs text-gray-500"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Cargando archivos…</p>
      )}

      {status === "error" && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-300" role="alert">
          <span>No se pudieron cargar los archivos.</span>
          <button type="button" onClick={() => { setStatus("loading"); setReloadToken((token) => token + 1); }} className="flex min-h-9 items-center gap-1 px-2 text-xs font-bold underline"><RefreshCw size={12} aria-hidden="true" /> Reintentar</button>
        </div>
      )}

      {status === "ready" && files.length === 0 && (
        <p className="rounded-xl border border-dashed border-stampa-border p-4 text-center text-sm text-gray-500">
          Todavía no cargaste ningún proyecto 3MF para este producto. Guardá acá los archivos listos para imprimir, uno por laminador e impresora.
        </p>
      )}

      {status === "ready" && files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file) => {
            const direct = supportsDirectOpen(file.slicer, platform);
            const time = formatPrintMinutes(file.est_minutes);
            const pieceName = file.component_id ? componentNames.get(file.component_id) : null;
            const busy = busyKey?.endsWith(file.id) ?? false;
            const details = [
              file.printer_name ? `Impresora: ${file.printer_name}` : null,
              pieceName ? `Pieza: ${pieceName}` : null,
              file.material ? `Material: ${file.material}` : null,
              time ? `Tiempo: ${time}` : null,
              file.est_grams ? `Consumo: ${file.est_grams} g` : null,
            ].filter(Boolean) as string[];
            return (
              <li key={file.id} className="rounded-xl border border-stampa-border bg-stampa-bg-soft p-3">
                <div className="flex items-start gap-3">
                  <SlicerLogo slicerId={file.slicer} size={32} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-fg">{file.name}</p>
                    <p className="truncate text-[11px] text-gray-500">
                      {slicerLabel(file.slicer)} · {file.file_name} · {formatBytes(file.file_size)}
                    </p>
                    {details.length > 0 && (
                      <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{details.join(" · ")}</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void runOpen(file)}
                    disabled={Boolean(busyKey)}
                    className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-stampa-orange px-3 py-2 text-xs font-bold text-neutral-950 transition-colors hover:bg-stampa-orange-hover disabled:opacity-60 sm:flex-none"
                  >
                    {busyKey === `open:${file.id}` ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : direct ? <SlicerLogo slicerId={file.slicer} size={16} /> : <Download size={14} aria-hidden="true" />}
                    {direct ? `Abrir en ${slicerLabel(file.slicer)}` : mobile ? "Descargar" : `Descargar para ${slicerLabel(file.slicer)}`}
                  </button>
                  {direct && (
                    <button
                      type="button"
                      onClick={() => void runDownload(file)}
                      disabled={Boolean(busyKey)}
                      aria-label={`Descargar ${file.file_name}`}
                      className="flex min-h-10 items-center gap-1.5 rounded-lg border border-stampa-border px-3 py-2 text-xs font-bold text-gray-300 hover:bg-fg/5 disabled:opacity-60"
                    >
                      {busyKey === `download:${file.id}` ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
                      Descargar
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <button type="button" onClick={() => setForm({ mode: "edit", file })} disabled={Boolean(busyKey)} aria-label={`Editar ${file.name}`} title="Editar datos" className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-fg/5 hover:text-fg disabled:opacity-50"><Pencil size={15} /></button>
                    <button type="button" onClick={() => startReplace(file)} disabled={Boolean(busyKey)} aria-label={`Reemplazar el archivo de ${file.name}`} title="Reemplazar archivo" className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-fg/5 hover:text-fg disabled:opacity-50">
                      {busyKey === `replace:${file.id}` ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                    </button>
                    <button type="button" onClick={() => void handleDelete(file)} disabled={Boolean(busyKey)} aria-label={`Eliminar ${file.name}`} title="Eliminar" className="flex h-10 w-10 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                      {busyKey === `delete:${file.id}` ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                    </button>
                  </div>
                </div>
                {busy && busyKey?.startsWith("replace:") && <p className="mt-2 text-[11px] text-gray-500">Subiendo y verificando el archivo nuevo…</p>}
              </li>
            );
          })}
        </ul>
      )}

      {mobile && status === "ready" && files.length > 0 && (
        <p className="mt-3 text-[11px] leading-snug text-gray-500">
          Los laminadores de escritorio no se pueden abrir desde un celular o tablet: descargá el archivo y abrilo en tu computadora.
        </p>
      )}

      <input ref={replaceInputRef} type="file" accept=".3mf" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={handleReplacePicked} />

      <PrintFileFormDialog
        open={form !== null}
        onClose={() => setForm(null)}
        mode={form?.mode ?? "create"}
        productId={productId}
        supabase={supabase}
        file={form?.file ?? null}
        initialSlicer={form?.slicer ?? null}
        printers={printers}
        components={components}
        onSaved={handleSaved}
      />
    </section>
  );
}
