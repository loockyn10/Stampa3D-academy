import { normalizeBarcode } from "@/lib/barcode/hid-scanner";

export type BusinessBarcodeType = "unit" | "case";

export interface BusinessStockReceiptPresentation {
  id: string;
  catalogItemId: string;
  barcode: string;
  barcodeType: BusinessBarcodeType;
  unitsPerScan: number;
  displayName: string;
  category: string;
  sourceType: "manufactured" | "resale";
  isActive: boolean;
  unitWeightGrams: number | null;
}

export interface BusinessPendingStockScan extends BusinessStockReceiptPresentation {
  scanCount: number;
}

export interface BusinessStockReceiptItem {
  catalogItemId: string;
  displayName: string;
  category: string;
  sourceType: "manufactured" | "resale";
  isActive: boolean;
  unitWeightGrams: number | null;
}

export type AddBusinessStockScanResult =
  | { success: true; pending: BusinessPendingStockScan[]; presentation: BusinessStockReceiptPresentation }
  | { success: false; reason: "unknown"; barcode: string }
  | { success: false; reason: "archived" | "manufactured"; presentation: BusinessStockReceiptPresentation };

export function addBusinessStockScan(
  pending: readonly BusinessPendingStockScan[],
  presentations: readonly BusinessStockReceiptPresentation[],
  rawBarcode: string,
): AddBusinessStockScanResult {
  const barcode = normalizeBarcode(rawBarcode);
  const comparable = barcode.toLocaleLowerCase("es-AR");
  const presentation = presentations.find((candidate) => (
    candidate.barcode.toLocaleLowerCase("es-AR") === comparable
  ));

  if (!presentation) return { success: false, reason: "unknown", barcode };
  if (!presentation.isActive) return { success: false, reason: "archived", presentation };
  if (presentation.sourceType !== "resale") return { success: false, reason: "manufactured", presentation };

  const existing = pending.find((candidate) => candidate.id === presentation.id);
  const next = existing
    ? pending.map((candidate) => candidate.id === presentation.id
      ? { ...candidate, scanCount: candidate.scanCount + 1 }
      : candidate)
    : [...pending, { ...presentation, scanCount: 1 }];
  return { success: true, pending: next, presentation };
}

export function setBusinessStockScanCount(
  pending: readonly BusinessPendingStockScan[],
  presentationId: string,
  scanCount: number,
): BusinessPendingStockScan[] {
  if (!Number.isInteger(scanCount) || scanCount <= 0) {
    return pending.filter((candidate) => candidate.id !== presentationId);
  }
  return pending.map((candidate) => candidate.id === presentationId
    ? { ...candidate, scanCount }
    : candidate);
}

export function getBusinessStockScanUnits(scan: Pick<BusinessPendingStockScan, "scanCount" | "unitsPerScan">): number {
  return Math.max(0, scan.scanCount) * Math.max(0, scan.unitsPerScan);
}

export function getBusinessStockReceiptTotal(pending: readonly BusinessPendingStockScan[]): number {
  return pending.reduce((total, scan) => total + getBusinessStockScanUnits(scan), 0);
}

export function getBusinessStockReceiptWeightKg(
  units: number,
  unitWeightGrams: number | null,
): number | null {
  if (unitWeightGrams === null || unitWeightGrams <= 0) return null;
  return Number(((Math.max(0, units) * unitWeightGrams) / 1000).toFixed(3));
}
