"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Barcode, Box, CheckCircle2, Loader2, Minus, PackagePlus, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useBarcodeScanHandler } from "@/components/barcode/BarcodeScannerProvider";
import { Dialog } from "@/components/ui/dialog";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { isValidBarcode, normalizeBarcode } from "@/lib/barcode/hid-scanner";
import {
  addBusinessStockScan,
  getBusinessStockReceiptTotal,
  getBusinessStockReceiptWeightKg,
  getBusinessStockScanUnits,
  setBusinessStockScanCount,
  type BusinessBarcodeType,
  type BusinessPendingStockScan,
  type BusinessStockReceiptItem,
  type BusinessStockReceiptPresentation,
} from "@/lib/business/stock-receipt";
import {
  confirmBusinessStockReceiptAction,
  loadBusinessStockReceiptSetupAction,
  restoreBusinessCatalogItemAction,
  saveBusinessCatalogBarcodesAction,
} from "@/app/mi-negocio/actions";

interface StockReceiptDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirmed: () => void | Promise<void>;
  onCreateProduct: (input: { barcode: string; barcodeType: BusinessBarcodeType; unitsPerScan: number }) => void;
  resumeBarcode?: string | null;
  onResumeConsumed?: () => void;
}

interface UnknownBarcodeState {
  barcode: string;
  archivedPresentation?: BusinessStockReceiptPresentation;
}

const inputClass = "min-h-11 w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 text-sm text-white outline-none focus:border-stampa-orange/60";

export function StockReceiptDialog({ open, onClose, onConfirmed, onCreateProduct, resumeBarcode, onResumeConsumed }: StockReceiptDialogProps) {
  const { toast } = useAppFeedback();
  const [items, setItems] = useState<BusinessStockReceiptItem[]>([]);
  const [presentations, setPresentations] = useState<BusinessStockReceiptPresentation[]>([]);
  const [pending, setPending] = useState<BusinessPendingStockScan[]>([]);
  const [unknown, setUnknown] = useState<UnknownBarcodeState | null>(null);
  const [manualBarcode, setManualBarcode] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignmentItemId, setAssignmentItemId] = useState("");
  const [assignmentType, setAssignmentType] = useState<BusinessBarcodeType>("case");
  const [assignmentUnits, setAssignmentUnits] = useState("10");
  const operationKeyRef = useRef<string | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const pendingRef = useRef<BusinessPendingStockScan[]>([]);
  const presentationsRef = useRef<BusinessStockReceiptPresentation[]>([]);

  const replacePending = useCallback((next: BusinessPendingStockScan[]) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  const replacePresentations = useCallback((next: BusinessStockReceiptPresentation[]) => {
    presentationsRef.current = next;
    setPresentations(next);
  }, []);

  const loadSetup = useCallback(async () => {
    const result = await loadBusinessStockReceiptSetupAction();
    setLoading(false);
    if (!result.success) {
      setSetupError(result.error);
      toast.error(`No se pudieron cargar los códigos: ${result.error}`);
      return null;
    }
    setSetupError(null);
    setItems(result.items);
    replacePresentations(result.presentations);
    return result;
  }, [replacePresentations, toast]);

  useEffect(() => () => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
  }, []);

  const showFeedback = useCallback((message: string) => {
    setFeedback(message);
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), 1_800);
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    // Opening the dialog synchronizes its server-backed barcode catalog.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSetup().then((setup) => {
      if (!active || !setup || !resumeBarcode) return;
      const added = addBusinessStockScan(pendingRef.current, setup.presentations, resumeBarcode);
      if (added.success) {
        replacePending(added.pending);
        setUnknown(null);
        operationKeyRef.current = null;
        showFeedback(`✓ ${added.presentation.displayName} · +${added.presentation.unitsPerScan} unidades`);
      }
      onResumeConsumed?.();
    });
    return () => { active = false; };
  }, [loadSetup, onResumeConsumed, open, replacePending, resumeBarcode, showFeedback]);

  const processBarcode = useCallback((rawBarcode: string) => {
    const barcode = normalizeBarcode(rawBarcode);
    if (!isValidBarcode(barcode, 1)) {
      showFeedback("El código escaneado no es válido.");
      return;
    }
    const result = addBusinessStockScan(pendingRef.current, presentationsRef.current, barcode);
    if (result.success) {
      replacePending(result.pending);
      setUnknown(null);
      operationKeyRef.current = null;
      showFeedback(`✓ ${result.presentation.displayName} · +${result.presentation.unitsPerScan} ${result.presentation.unitsPerScan === 1 ? "unidad" : "unidades"}${result.presentation.barcodeType === "case" ? " · Caja" : ""}`);
      return;
    }
    if (result.reason === "unknown") {
      setUnknown({ barcode: result.barcode });
      setAssignmentItemId("");
      showFeedback(`Código no reconocido: ${result.barcode}`);
      return;
    }
    if (result.reason === "archived") {
      setUnknown({ barcode, archivedPresentation: result.presentation });
      showFeedback(`${result.presentation.displayName} está archivado.`);
      return;
    }
    showFeedback(`${result.presentation.displayName} es fabricado: registrá su producción desde Mi Taller.`);
  }, [replacePending, showFeedback]);

  useBarcodeScanHandler({
    id: "business-stock-receipt",
    route: "/mi-negocio/catalogo",
    priority: 1_000,
    enabled: open && !loading && !setupError && !confirming && !assigning,
    allowWhenDialogOpen: true,
    onScan: (scan) => processBarcode(scan.value),
  });

  const resaleItems = useMemo(
    () => items.filter((item) => item.isActive && item.sourceType === "resale"),
    [items],
  );
  const totalUnits = useMemo(() => getBusinessStockReceiptTotal(pending), [pending]);
  const assignmentUnitsNumber = Number(assignmentUnits);
  const assignmentIsValid = assignmentType === "unit"
    || (Number.isInteger(assignmentUnitsNumber) && assignmentUnitsNumber >= 2 && assignmentUnitsNumber <= 100_000);

  const submitManualBarcode = () => {
    processBarcode(manualBarcode);
    setManualBarcode("");
  };

  const closeAndReset = () => {
    if (confirming || assigning) return;
    replacePending([]);
    setUnknown(null);
    setFeedback(null);
    setManualBarcode("");
    setLoading(true);
    operationKeyRef.current = null;
    onClose();
  };

  const restoreArchived = async () => {
    const presentation = unknown?.archivedPresentation;
    if (!presentation || assigning) return;
    setAssigning(true);
    const result = await restoreBusinessCatalogItemAction({ catalogItemId: presentation.catalogItemId });
    setAssigning(false);
    if (!result.success) return toast.error(result.error);
    const restored = { ...presentation, isActive: true };
    replacePresentations(presentationsRef.current.map((candidate) => candidate.catalogItemId === restored.catalogItemId
      ? { ...candidate, isActive: true }
      : candidate));
    setItems((current) => current.map((candidate) => candidate.catalogItemId === restored.catalogItemId
      ? { ...candidate, isActive: true }
      : candidate));
    const added = addBusinessStockScan(pendingRef.current, [restored], restored.barcode);
    if (added.success) replacePending(added.pending);
    setUnknown(null);
    operationKeyRef.current = null;
    showFeedback(`✓ ${restored.displayName} restaurado · +${restored.unitsPerScan} unidades`);
    await onConfirmed();
  };

  const assignUnknownBarcode = async () => {
    if (!unknown || !assignmentItemId || assigning) return;
    const selectedItem = items.find((item) => item.catalogItemId === assignmentItemId);
    if (!selectedItem) return;
    const unit = presentations.find((candidate) => candidate.catalogItemId === assignmentItemId && candidate.barcodeType === "unit");
    const box = presentations.find((candidate) => candidate.catalogItemId === assignmentItemId && candidate.barcodeType === "case");
    const units = assignmentType === "case" ? assignmentUnitsNumber : 1;
    setAssigning(true);
    const result = await saveBusinessCatalogBarcodesAction({
      catalogItemId: assignmentItemId,
      unitBarcode: assignmentType === "unit" ? unknown.barcode : unit?.barcode,
      caseBarcode: assignmentType === "case" ? unknown.barcode : box?.barcode,
      caseUnitsPerScan: assignmentType === "case" ? units : box?.unitsPerScan,
    });
    setAssigning(false);
    if (!result.success) return toast.error(result.error);

    const nextPresentation: BusinessStockReceiptPresentation = {
      id: `${assignmentItemId}:${assignmentType}`,
      catalogItemId: assignmentItemId,
      barcode: unknown.barcode,
      barcodeType: assignmentType,
      unitsPerScan: units,
      displayName: selectedItem.displayName,
      category: selectedItem.category,
      sourceType: selectedItem.sourceType,
      isActive: true,
      unitWeightGrams: selectedItem.unitWeightGrams,
    };
    replacePresentations([
      ...presentationsRef.current.filter((candidate) => !(candidate.catalogItemId === assignmentItemId && candidate.barcodeType === assignmentType)),
      nextPresentation,
    ]);
    const added = addBusinessStockScan(pendingRef.current, [nextPresentation], nextPresentation.barcode);
    if (added.success) replacePending(added.pending);
    setUnknown(null);
    operationKeyRef.current = null;
    showFeedback(`✓ ${selectedItem.displayName} · +${units} ${units === 1 ? "unidad" : "unidades"}`);
  };

  const confirmReceipt = async () => {
    if (pending.length === 0 || confirming) return;
    operationKeyRef.current ??= crypto.randomUUID();
    setConfirming(true);
    let result: Awaited<ReturnType<typeof confirmBusinessStockReceiptAction>>;
    try {
      result = await confirmBusinessStockReceiptAction({
        operationKey: operationKeyRef.current,
        scans: pending.map((scan) => ({ barcode: scan.barcode, scanCount: scan.scanCount })),
      });
    } catch {
      setConfirming(false);
      toast.error("No recibimos la respuesta. Reintentá: el mismo ingreso no se aplicará dos veces.");
      return;
    }
    setConfirming(false);
    if (!result.success) return toast.error(result.error);
    toast.success(`${result.totalUnits} unidades ingresadas${result.replayed ? " (el ingreso ya estaba aplicado)" : ""}.`);
    replacePending([]);
    setUnknown(null);
    operationKeyRef.current = null;
    await loadSetup();
    await onConfirmed();
  };

  return (
    <Dialog open={open} onClose={closeAndReset} labelledBy="stock-receipt-title" panelClassName="max-w-2xl rounded-2xl border border-stampa-border bg-stampa-surface">
      <div className="flex items-start justify-between gap-4 border-b border-stampa-border p-5">
        <div>
          <h2 id="stock-receipt-title" className="flex items-center gap-2 text-lg font-black text-white"><PackagePlus size={20} className="text-stampa-orange" /> Ingreso de stock</h2>
          <p className="mt-1 text-sm text-gray-400">Escaneá productos o cajas. El stock cambia recién cuando confirmás.</p>
        </div>
        <button type="button" disabled={confirming || assigning} onClick={closeAndReset} aria-label="Cerrar" className="rounded-lg p-2 text-gray-500 hover:bg-white/5 hover:text-white disabled:opacity-40"><X size={18} /></button>
      </div>

      <div className="space-y-4 p-5">
        <div className="rounded-2xl border border-dashed border-stampa-orange/40 bg-stampa-orange/5 p-4 text-center">
          <Barcode className="mx-auto text-stampa-orange" size={26} />
          <p className="mt-2 text-sm font-black text-white">{loading ? "Cargando códigos..." : setupError ? "No se pudieron cargar los códigos" : "Esperando scanner..."}</p>
          <p className="mt-1 text-xs text-gray-500">No necesitás seleccionar ningún campo.</p>
          {setupError && <button type="button" onClick={() => void loadSetup()} className="mt-3 min-h-10 rounded-xl border border-amber-500/30 px-4 text-xs font-bold text-amber-200">Reintentar</button>}
          <div className="mx-auto mt-3 flex max-w-md gap-2">
            <input disabled={Boolean(setupError)} value={manualBarcode} onChange={(event) => setManualBarcode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitManualBarcode(); } }} placeholder="Escribir o pegar código" className={`${inputClass} disabled:opacity-40`} />
            <button type="button" disabled={Boolean(setupError) || !manualBarcode.trim()} onClick={submitManualBarcode} className="min-h-11 shrink-0 rounded-xl border border-stampa-border px-3 text-xs font-bold text-white disabled:opacity-40">Agregar</button>
          </div>
        </div>

        <div className="min-h-9" aria-live="polite">{feedback && <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200">{feedback}</p>}</div>

        {unknown && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="text-sm font-black text-white">{unknown.archivedPresentation ? "Este producto está archivado" : "Código no reconocido"}</p>
            <p className="mt-1 break-all font-mono text-xs text-amber-200">{unknown.barcode}</p>
            {unknown.archivedPresentation ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={assigning} onClick={() => void restoreArchived()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-stampa-orange px-4 text-xs font-black text-white disabled:opacity-50">{assigning ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} Restaurar producto</button>
                <button type="button" onClick={() => setUnknown(null)} className="min-h-10 rounded-xl px-3 text-xs font-bold text-gray-400">Cancelar</button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <select value={assignmentItemId} onChange={(event) => setAssignmentItemId(event.target.value)} className={inputClass}>
                  <option value="">Asignar a producto existente</option>
                  {resaleItems.map((item) => <option key={item.catalogItemId} value={item.catalogItemId}>{item.displayName}</option>)}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setAssignmentType("unit")} className={`min-h-10 rounded-xl border text-xs font-bold ${assignmentType === "unit" ? "border-stampa-orange bg-stampa-orange/10 text-orange-200" : "border-stampa-border text-gray-400"}`}>Código unitario</button>
                  <button type="button" onClick={() => setAssignmentType("case")} className={`min-h-10 rounded-xl border text-xs font-bold ${assignmentType === "case" ? "border-stampa-orange bg-stampa-orange/10 text-orange-200" : "border-stampa-border text-gray-400"}`}>Código de caja</button>
                </div>
                {assignmentType === "case" && <label className="block text-xs font-bold text-gray-300">Unidades por caja<input type="number" min="2" step="1" value={assignmentUnits} onChange={(event) => setAssignmentUnits(event.target.value)} className={`${inputClass} mt-1.5`} /></label>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!assignmentItemId || !assignmentIsValid || assigning} onClick={() => void assignUnknownBarcode()} className="min-h-10 rounded-xl bg-stampa-orange px-4 text-xs font-black text-white disabled:opacity-40">Asignar y sumar</button>
                  <button type="button" disabled={!assignmentIsValid} onClick={() => { setLoading(true); onCreateProduct({ barcode: unknown.barcode, barcodeType: assignmentType, unitsPerScan: assignmentType === "case" ? assignmentUnitsNumber : 1 }); }} className="min-h-10 rounded-xl border border-stampa-border px-4 text-xs font-bold text-white disabled:opacity-40">Crear producto</button>
                  <button type="button" onClick={() => setUnknown(null)} className="min-h-10 rounded-xl px-3 text-xs font-bold text-gray-500">Cancelar</button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          {pending.length === 0 ? (
            <div className="rounded-2xl border border-stampa-border bg-black/10 p-6 text-center text-sm text-gray-500">Todavía no escaneaste mercadería.</div>
          ) : pending.map((scan) => {
            const units = getBusinessStockScanUnits(scan);
            const weightKg = /filament/i.test(scan.category)
              ? getBusinessStockReceiptWeightKg(units, scan.unitWeightGrams)
              : null;
            return (
              <div key={scan.id} className="rounded-2xl border border-stampa-border bg-black/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-white">{scan.displayName}</p>
                    <p className="mt-1 text-xs text-gray-400">{scan.barcodeType === "case" ? `${scan.scanCount} cajas × ${scan.unitsPerScan} u.` : `${scan.scanCount} unidades escaneadas`}</p>
                    <p className="mt-1 text-sm font-bold text-stampa-orange">{units} unidades{weightKg === null ? "" : ` · ${weightKg.toLocaleString("es-AR")} kg`}</p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[10px] font-black uppercase text-gray-400"><Box size={12} /> {scan.barcodeType === "case" ? "Caja" : "Unidad"}</span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center rounded-xl border border-stampa-border">
                    <button type="button" onClick={() => { replacePending(setBusinessStockScanCount(pendingRef.current, scan.id, scan.scanCount - 1)); operationKeyRef.current = null; }} className="flex h-10 w-10 items-center justify-center"><Minus size={15} /></button>
                    <span className="w-10 text-center text-sm font-bold text-white">{scan.scanCount}</span>
                    <button type="button" onClick={() => { replacePending(setBusinessStockScanCount(pendingRef.current, scan.id, scan.scanCount + 1)); operationKeyRef.current = null; }} className="flex h-10 w-10 items-center justify-center"><Plus size={15} /></button>
                  </div>
                  <button type="button" onClick={() => { replacePending(pendingRef.current.filter((candidate) => candidate.id !== scan.id)); operationKeyRef.current = null; }} aria-label={`Quitar ${scan.displayName}`} className="rounded-lg p-2 text-gray-500 hover:bg-red-500/10 hover:text-red-300"><Trash2 size={17} /></button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-stampa-border bg-stampa-surface/95 p-5 backdrop-blur">
        <div className="mb-4 flex items-end justify-between gap-4"><div><p className="text-xs text-gray-500">Total pendiente</p><p className="text-2xl font-black text-white">{totalUnits} unidades</p></div><CheckCircle2 className={pending.length ? "text-emerald-300" : "text-gray-700"} /></div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={confirming || assigning} onClick={closeAndReset} className="min-h-11 rounded-xl border border-stampa-border text-sm font-bold text-gray-300 disabled:opacity-40">Cancelar</button>
          <button type="button" disabled={pending.length === 0 || confirming || assigning} onClick={() => void confirmReceipt()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stampa-orange text-sm font-black text-white disabled:opacity-40">{confirming && <Loader2 size={16} className="animate-spin" />} Confirmar ingreso</button>
        </div>
      </div>
    </Dialog>
  );
}
