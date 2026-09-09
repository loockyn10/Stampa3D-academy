"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BarcodeHidDetector,
  HID_BARCODE_THRESHOLDS,
  PendingBarcodeScanQueue,
  type BarcodeScan,
} from "@/lib/barcode/hid-scanner";

const QUICK_SALE_ROUTE = "/mi-negocio/venta-rapida";
const CONTEXTUAL_BARCODE_ROUTES = [QUICK_SALE_ROUTE, "/mi-negocio/catalogo"] as const;
const EXCLUDED_PRIVATE_ROUTE_PREFIXES = ["/admin", "/onboarding"] as const;

interface BarcodeScanHandlerRegistration {
  id: string;
  route: string;
  priority?: number;
  enabled?: boolean;
  allowWhenDialogOpen?: boolean;
  onScan: (scan: BarcodeScan) => void | Promise<void>;
}

interface BarcodeScannerContextValue {
  registerHandler: (handler: BarcodeScanHandlerRegistration) => () => void;
}

interface EditableSnapshot {
  element: HTMLInputElement | HTMLTextAreaElement;
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

const BarcodeScannerContext = createContext<BarcodeScannerContextValue | null>(null);

function routeMatches(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function hasBlockingDialog(): boolean {
  return Boolean(document.querySelector(
    '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], [data-barcode-scan-blocking="true"]',
  ));
}

function getEditableSnapshot(target: EventTarget | null): EditableSnapshot | null {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return null;
  if (target instanceof HTMLInputElement && ["password", "file", "checkbox", "radio"].includes(target.type)) return null;
  return {
    element: target,
    value: target.value,
    selectionStart: target.selectionStart,
    selectionEnd: target.selectionEnd,
  };
}

function restoreEditableSnapshot(snapshot: EditableSnapshot | null): void {
  if (!snapshot || !snapshot.element.isConnected) return;
  const element = snapshot.element;
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(element, snapshot.value);
  else element.value = snapshot.value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  try {
    element.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  } catch {
    // Some input types do not support a text selection.
  }
}

export function BarcodeScannerProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const detectorRef = useRef(new BarcodeHidDetector());
  const queueRef = useRef(new PendingBarcodeScanQueue());
  const handlersRef = useRef(new Map<string, BarcodeScanHandlerRegistration>());
  const resetTimerRef = useRef<number | null>(null);
  const editableSnapshotRef = useRef<EditableSnapshot | null>(null);
  const navigationPendingRef = useRef(false);

  const findContextualHandler = useCallback((currentPathname: string) => (
    [...handlersRef.current.values()]
      .filter((handler) => handler.enabled !== false && routeMatches(currentPathname, handler.route))
      .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))[0] ?? null
  ), []);

  const invokeHandler = useCallback((handler: BarcodeScanHandlerRegistration, scan: BarcodeScan) => {
    void Promise.resolve(handler.onScan(scan)).catch(() => {
      // Page handlers own user-facing errors; a scan is never replayed implicitly.
    });
  }, []);

  const drainPendingForCurrentRoute = useCallback(() => {
    if (queueRef.current.size === 0) return;
    const handler = findContextualHandler(pathnameRef.current);
    if (!handler || handler.enabled === false) return;
    for (const scan of queueRef.current.drain()) invokeHandler(handler, scan);
  }, [findContextualHandler, invokeHandler]);

  const registerHandler = useCallback((handler: BarcodeScanHandlerRegistration) => {
    handlersRef.current.set(handler.id, handler);
    drainPendingForCurrentRoute();
    return () => {
      if (handlersRef.current.get(handler.id) === handler) handlersRef.current.delete(handler.id);
    };
  }, [drainPendingForCurrentRoute]);

  const dispatchBarcode = useCallback((value: string, scannedAt: number) => {
    queueRef.current.enqueue(value, scannedAt);
    const handler = findContextualHandler(pathnameRef.current);
    if (handler) {
      if (handler.enabled !== false) {
        for (const pendingScan of queueRef.current.drain()) {
          invokeHandler(handler, pendingScan);
        }
      }
      return;
    }

    if (
      CONTEXTUAL_BARCODE_ROUTES.some((route) => routeMatches(pathnameRef.current, route))
      || navigationPendingRef.current
    ) return;
    navigationPendingRef.current = true;
    router.push(QUICK_SALE_ROUTE);
  }, [findContextualHandler, invokeHandler, router]);

  useEffect(() => {
    pathnameRef.current = pathname;
    if (pathname === QUICK_SALE_ROUTE) navigationPendingRef.current = false;
    drainPendingForCurrentRoute();
  }, [drainPendingForCurrentRoute, pathname]);

  useEffect(() => {
    if (!enabled || EXCLUDED_PRIVATE_ROUTE_PREFIXES.some((route) => routeMatches(pathname, route))) {
      detectorRef.current.reset();
      return;
    }

    const detector = detectorRef.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const contextualHandler = findContextualHandler(pathnameRef.current);
      if (hasBlockingDialog() && contextualHandler?.allowWhenDialogOpen !== true) {
        detector.reset();
        editableSnapshotRef.current = null;
        return;
      }

      const timestamp = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
      const result = detector.feed(event.key, timestamp);
      if (result.sequenceStarted) editableSnapshotRef.current = getEditableSnapshot(event.target);

      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      if (detector.bufferedLength > 0) {
        resetTimerRef.current = window.setTimeout(() => {
          detector.reset();
          editableSnapshotRef.current = null;
        }, HID_BARCODE_THRESHOLDS.resetDelayMs);
      }

      if (!result.barcode) return;
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
      event.preventDefault();
      event.stopImmediatePropagation();
      restoreEditableSnapshot(editableSnapshotRef.current);
      editableSnapshotRef.current = null;
      dispatchBarcode(result.barcode, Date.now());
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      detector.reset();
      editableSnapshotRef.current = null;
    };
  }, [dispatchBarcode, enabled, findContextualHandler, pathname]);

  const contextValue = useMemo(() => ({ registerHandler }), [registerHandler]);
  return (
    <BarcodeScannerContext.Provider value={contextValue}>
      {children}
    </BarcodeScannerContext.Provider>
  );
}

export function useBarcodeScanHandler({
  id,
  route,
  priority = 0,
  enabled = true,
  allowWhenDialogOpen = false,
  onScan,
}: BarcodeScanHandlerRegistration) {
  const context = useContext(BarcodeScannerContext);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!context) return;
    return context.registerHandler({
      id,
      route,
      priority,
      enabled,
      allowWhenDialogOpen,
      onScan: (scan) => onScanRef.current(scan),
    });
  }, [allowWhenDialogOpen, context, enabled, id, priority, route]);
}
