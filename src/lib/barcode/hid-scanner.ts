export const HID_BARCODE_THRESHOLDS = {
  maxInterKeyDelayMs: 55,
  maxTerminatorDelayMs: 80,
  resetDelayMs: 180,
  minLength: 6,
  maxLength: 120,
} as const;

const BARCODE_CHARACTER = /^[0-9A-Za-z._/+:%$()-]$/;
const BARCODE_VALUE = /^[0-9A-Za-z._/+:%$()-]+$/;

export interface BarcodeScan {
  id: number;
  value: string;
  scannedAt: number;
}

export interface BarcodeKeyResult {
  accepted: boolean;
  sequenceStarted: boolean;
  barcode: string | null;
}

export interface BarcodeHidDetectorOptions {
  maxInterKeyDelayMs?: number;
  maxTerminatorDelayMs?: number;
  resetDelayMs?: number;
  minLength?: number;
  maxLength?: number;
}

export function normalizeBarcode(value: string): string {
  return value.replace(/[\r\n\t]+$/g, "").trim();
}

export function isValidBarcode(value: string, minLength = HID_BARCODE_THRESHOLDS.minLength): boolean {
  const normalized = normalizeBarcode(value);
  return normalized.length >= minLength
    && normalized.length <= HID_BARCODE_THRESHOLDS.maxLength
    && BARCODE_VALUE.test(normalized);
}

export class BarcodeHidDetector {
  private readonly options: Required<BarcodeHidDetectorOptions>;
  private buffer = "";
  private lastKeyAt: number | null = null;

  constructor(options: BarcodeHidDetectorOptions = {}) {
    this.options = { ...HID_BARCODE_THRESHOLDS, ...options };
  }

  get bufferedLength(): number {
    return this.buffer.length;
  }

  reset(): void {
    this.buffer = "";
    this.lastKeyAt = null;
  }

  expire(now: number): boolean {
    if (this.lastKeyAt === null || now - this.lastKeyAt <= this.options.resetDelayMs) return false;
    this.reset();
    return true;
  }

  feed(key: string, at: number): BarcodeKeyResult {
    this.expire(at);

    if (key === "Enter" || key === "Tab") {
      const terminatorWasFast = this.lastKeyAt !== null
        && at - this.lastKeyAt <= this.options.maxTerminatorDelayMs;
      const value = normalizeBarcode(this.buffer);
      const barcode = terminatorWasFast
        && value.length >= this.options.minLength
        && value.length <= this.options.maxLength
        && BARCODE_VALUE.test(value)
        ? value
        : null;
      const accepted = this.buffer.length > 0;
      this.reset();
      return { accepted, sequenceStarted: false, barcode };
    }

    if (key.length !== 1 || !BARCODE_CHARACTER.test(key)) {
      this.reset();
      return { accepted: false, sequenceStarted: false, barcode: null };
    }

    const sequenceStarted = this.lastKeyAt === null
      || at - this.lastKeyAt > this.options.maxInterKeyDelayMs;
    if (sequenceStarted) {
      this.reset();
    }

    if (this.buffer.length >= this.options.maxLength) {
      this.reset();
      return { accepted: false, sequenceStarted: false, barcode: null };
    }

    this.buffer += key;
    this.lastKeyAt = at;
    return { accepted: true, sequenceStarted, barcode: null };
  }
}

export class PendingBarcodeScanQueue {
  private nextId = 0;
  private scans: BarcodeScan[] = [];

  enqueue(value: string, scannedAt: number): BarcodeScan {
    const scan = { id: ++this.nextId, value: normalizeBarcode(value), scannedAt };
    this.scans.push(scan);
    return scan;
  }

  drain(): BarcodeScan[] {
    const pending = this.scans;
    this.scans = [];
    return pending;
  }

  get size(): number {
    return this.scans.length;
  }
}
