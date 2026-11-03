"use client";

import React, { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FileBox, Loader2, X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { CalculatorSelect, type CalculatorSelectOption } from "@/components/ui/calculator-select";
import { updateProductPrintFileAction } from "@/app/productos/print-file-actions";
import { uploadPrintFile } from "@/lib/print-files/client-upload";
import { formatBytes } from "@/lib/print-files/config";
import { SLICERS, type SlicerId } from "@/lib/print-files/slicers";
import type { PrintFile, PrintFileComponent, PrintFileOption } from "@/lib/print-files/types";
import {
  PRINT_FILE_MATERIAL_MAX,
  PRINT_FILE_NAME_MAX,
  PRINT_FILE_PRINTER_NAME_MAX,
  stripThreeMfExtension,
  validatePrintFileMetadata,
} from "@/lib/print-files/validation";
import { SlicerLogo } from "./slicer-logo";

const OTHER_PRINTER = "__other";
const NO_VALUE = "";

interface PrintFileFormDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  productId: string;
  supabase: SupabaseClient;
  /** Edición: el proyecto a modificar. */
  file?: PrintFile | null;
  /** Alta: laminador preseleccionado (p. ej. al tocar un laminador que todavía no tiene proyecto). */
  initialSlicer?: SlicerId | null;
  printers: PrintFileOption[];
  components: PrintFileComponent[];
  onSaved: (file: PrintFile, warning?: string) => void;
}

const inputClass =
  "h-11 w-full rounded-xl border border-fg/10 bg-fg/[0.06] px-4 text-sm text-fg outline-none transition placeholder:text-neutral-500 focus:border-[#ff6a00]/60 focus:ring-2 focus:ring-[#ff6a00]/10 disabled:opacity-50";
const labelClass = "mb-1.5 block text-xs font-bold text-gray-400";

function initialFormState(mode: "create" | "edit", file: PrintFile | null | undefined, printers: PrintFileOption[], initialSlicer: SlicerId | null | undefined) {
  if (mode === "edit" && file) {
    const knownPrinter = Boolean(file.printer_id && printers.some((printer) => printer.value === file.printer_id));
    const total = file.est_minutes ?? 0;
    return {
      name: file.name,
      slicer: (file.slicer as SlicerId) ?? "",
      printerSelection: knownPrinter ? String(file.printer_id) : file.printer_name ? OTHER_PRINTER : NO_VALUE,
      printerOther: knownPrinter ? "" : file.printer_name ?? "",
      componentId: file.component_id ?? NO_VALUE,
      hours: total >= 60 ? String(Math.floor(total / 60)) : "",
      minutes: total % 60 > 0 ? String(total % 60) : "",
      grams: file.est_grams ? String(file.est_grams) : "",
      material: file.material ?? "",
      showOptional: Boolean(file.est_minutes || file.est_grams || file.material),
    };
  }
  return {
    name: "",
    slicer: (initialSlicer ?? "") as SlicerId | "",
    printerSelection: NO_VALUE,
    printerOther: "",
    componentId: NO_VALUE,
    hours: "",
    minutes: "",
    grams: "",
    material: "",
    showOptional: false,
  };
}

/** El formulario vive solo mientras el diálogo está abierto: cada apertura parte de los datos del proyecto (o vacío). */
export function PrintFileFormDialog(props: PrintFileFormDialogProps) {
  const busyRef = useRef(false);
  return (
    <Dialog
      open={props.open}
      onClose={() => {
        if (!busyRef.current) props.onClose();
      }}
      labelledBy="print-file-form-title"
      panelClassName="max-w-lg rounded-2xl border border-stampa-border bg-stampa-bg-soft"
    >
      <PrintFileFormBody {...props} busyRef={busyRef} />
    </Dialog>
  );
}

function PrintFileFormBody({
  onClose,
  mode,
  productId,
  supabase,
  file,
  initialSlicer,
  printers,
  components,
  onSaved,
  busyRef,
}: PrintFileFormDialogProps & { busyRef: React.MutableRefObject<boolean> }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initial = useState(() => initialFormState(mode, file, printers, initialSlicer))[0];
  const [chosenFile, setChosenFile] = useState<File | null>(null);
  const [name, setName] = useState(initial.name);
  const [slicer, setSlicer] = useState<SlicerId | "">(initial.slicer);
  const [printerSelection, setPrinterSelection] = useState(initial.printerSelection);
  const [printerOther, setPrinterOther] = useState(initial.printerOther);
  const [componentId, setComponentId] = useState(initial.componentId);
  const [hours, setHours] = useState(initial.hours);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [grams, setGrams] = useState(initial.grams);
  const [material, setMaterial] = useState(initial.material);
  const [showOptional, setShowOptional] = useState(initial.showOptional);
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setBusy = (value: boolean) => {
    busyRef.current = value;
    setBusyState(value);
  };

  const printerOptions: CalculatorSelectOption[] = [
    { value: NO_VALUE, label: "Sin especificar" },
    ...printers.map((printer) => ({ value: printer.value, label: printer.label })),
    { value: OTHER_PRINTER, label: "Otra impresora…" },
  ];
  const componentOptions: CalculatorSelectOption[] = [
    { value: NO_VALUE, label: "Todo el producto (proyecto completo)" },
    ...components.map((component) => ({ value: component.id, label: component.name })),
  ];

  const handleFileChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!picked) return;
    setChosenFile(picked);
    setError(null);
    if (!name.trim()) setName(stripThreeMfExtension(picked.name).slice(0, PRINT_FILE_NAME_MAX));
  };

  const buildMetadata = () => {
    const printerLabel = printerSelection === OTHER_PRINTER
      ? printerOther
      : printers.find((printer) => printer.value === printerSelection)?.label ?? "";
    const totalMinutes = (Number(hours) || 0) * 60 + (Number(minutes) || 0);
    return {
      name,
      slicer,
      componentId: componentId || null,
      printerId: printerSelection && printerSelection !== OTHER_PRINTER ? printerSelection : null,
      printerName: printerLabel || null,
      estMinutes: totalMinutes > 0 ? totalMinutes : null,
      estGrams: grams,
      material,
    };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);

    const metadata = buildMetadata();
    const validation = validatePrintFileMetadata(metadata, chosenFile ? stripThreeMfExtension(chosenFile.name) : "");
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setBusy(true);
    try {
      if (mode === "edit" && file) {
        const result = await updateProductPrintFileAction(file.id, metadata);
        if (!result.success) {
          setError(result.error);
          return;
        }
        onSaved(result.file);
        return;
      }
      if (!chosenFile) {
        setError("Elegí el archivo .3mf del proyecto.");
        return;
      }
      const result = await uploadPrintFile({ supabase, file: chosenFile, productId, metadata });
      if (!result.success) {
        setError(result.error);
        return;
      }
      onSaved(result.file, result.warning);
    } finally {
      setBusy(false);
    }
  };

  const closeIfIdle = () => {
    if (!busy) onClose();
  };

  return (
    <>
      <form onSubmit={handleSubmit} noValidate>
        <div className="flex items-center justify-between border-b border-stampa-border bg-stampa-surface px-5 py-4">
          <h3 id="print-file-form-title" className="text-base font-bold text-fg">
            {mode === "edit" ? "Editar proyecto" : "Agregar proyecto"}
          </h3>
          <button
            type="button"
            onClick={closeIfIdle}
            aria-label="Cerrar"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-fg/5 hover:text-fg"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {mode === "create" && (
            <div>
              <span className={labelClass}>Archivo 3MF</span>
              <input ref={fileInputRef} type="file" accept=".3mf" className="sr-only" onChange={handleFileChosen} tabIndex={-1} aria-label="Archivo 3MF" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-dashed border-stampa-border bg-stampa-surface px-4 py-3 text-left transition-colors hover:border-stampa-orange/50 hover:bg-fg/5 disabled:opacity-50"
              >
                <FileBox size={22} className="shrink-0 text-stampa-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  {chosenFile ? (
                    <>
                      <span className="block truncate text-sm font-bold text-fg">{chosenFile.name}</span>
                      <span className="block text-xs text-gray-500">{formatBytes(chosenFile.size)} · tocá para cambiarlo</span>
                    </>
                  ) : (
                    <span className="block text-sm font-semibold text-gray-300">Elegir archivo .3mf</span>
                  )}
                </span>
              </button>
            </div>
          )}

          <div>
            <span className={labelClass}>Laminador</span>
            <div role="radiogroup" aria-label="Laminador" className="grid grid-cols-3 gap-2">
              {SLICERS.map((definition) => {
                const selected = slicer === definition.id;
                return (
                  <button
                    key={definition.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={busy}
                    onClick={() => setSlicer(definition.id)}
                    className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${
                      selected ? "border-stampa-orange bg-stampa-orange/10 text-fg" : "border-stampa-border bg-stampa-surface text-gray-400 hover:bg-fg/5 hover:text-fg"
                    }`}
                  >
                    <SlicerLogo slicerId={definition.id} size={28} />
                    {definition.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="print-file-name" className={labelClass}>Nombre del proyecto</label>
            <input
              id="print-file-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={PRINT_FILE_NAME_MAX}
              disabled={busy}
              placeholder="Ej. Pantalla ondulada · A1"
              className={inputClass}
            />
          </div>

          <div>
            <span className={labelClass}>Impresora <span className="font-normal text-gray-500">(opcional)</span></span>
            <CalculatorSelect options={printerOptions} value={printerSelection} onChange={setPrinterSelection} disabled={busy} usePortal />
            {printerSelection === OTHER_PRINTER && (
              <input
                value={printerOther}
                onChange={(event) => setPrinterOther(event.target.value)}
                maxLength={PRINT_FILE_PRINTER_NAME_MAX}
                disabled={busy}
                placeholder="Nombre de la impresora"
                aria-label="Nombre de la impresora"
                className={`${inputClass} mt-2`}
              />
            )}
          </div>

          {components.length > 1 && (
            <div>
              <span className={labelClass}>Pieza <span className="font-normal text-gray-500">(opcional)</span></span>
              <CalculatorSelect options={componentOptions} value={componentId} onChange={setComponentId} disabled={busy} usePortal />
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowOptional((current) => !current)}
              aria-expanded={showOptional}
              className="inline-flex min-h-10 items-center text-xs font-bold text-stampa-accent hover:underline"
            >
              {showOptional ? "Ocultar datos opcionales" : "Agregar tiempo, gramos y material (opcional)"}
            </button>
            {showOptional && (
              <div className="mt-3 space-y-3">
                <p className="text-[11px] leading-snug text-gray-500">
                  Son datos de este proyecto. No cambian el costo, el precio ni el tiempo del producto.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="print-file-hours" className={labelClass}>Horas</label>
                    <input id="print-file-hours" inputMode="numeric" value={hours} onChange={(event) => setHours(event.target.value.replace(/\D/g, "").slice(0, 4))} disabled={busy} className={inputClass} placeholder="0" />
                  </div>
                  <div>
                    <label htmlFor="print-file-minutes" className={labelClass}>Minutos</label>
                    <input id="print-file-minutes" inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value.replace(/\D/g, "").slice(0, 2))} disabled={busy} className={inputClass} placeholder="0" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="print-file-grams" className={labelClass}>Gramos</label>
                    <input id="print-file-grams" inputMode="decimal" value={grams} onChange={(event) => setGrams(event.target.value.replace(/[^0-9.,]/g, "").slice(0, 10))} disabled={busy} className={inputClass} placeholder="0" />
                  </div>
                  <div>
                    <label htmlFor="print-file-material" className={labelClass}>Material</label>
                    <input id="print-file-material" value={material} onChange={(event) => setMaterial(event.target.value)} maxLength={PRINT_FILE_MATERIAL_MAX} disabled={busy} className={inputClass} placeholder="Ej. PLA Negro" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-stampa-border bg-stampa-surface px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={closeIfIdle}
            disabled={busy}
            className="min-h-11 rounded-xl border border-stampa-border px-4 py-2.5 text-sm font-bold text-gray-300 transition-colors hover:bg-fg/5 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stampa-orange px-5 py-2.5 text-sm font-bold text-neutral-950 transition-colors hover:bg-stampa-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {busy ? (mode === "create" ? "Subiendo…" : "Guardando…") : mode === "create" ? "Subir proyecto" : "Guardar cambios"}
          </button>
        </div>
      </form>
    </>
  );
}
