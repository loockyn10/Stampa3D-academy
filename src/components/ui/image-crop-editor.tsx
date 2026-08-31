"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Minus, Plus, RotateCcw, X } from "lucide-react";
import {
  clampCropOffset,
  createCroppedImageFile,
  getCropPreviewLayout,
  getCropSourceRect,
  getCoverScale,
  type CropFrameSize,
  type CropOffset,
  type ImageCropConfig,
} from "@/lib/images/crop";

interface ImageCropEditorProps {
  file: File;
  config: ImageCropConfig;
  onCancel: () => void;
  onConfirm: (file: File) => void | Promise<void>;
}

const INITIAL_OFFSET: CropOffset = { x: 0, y: 0 };

export function ImageCropEditor({ file, config, onCancel, onConfirm }: ImageCropEditorProps) {
  const [imageUrl] = useState(() => URL.createObjectURL(file));
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [frameSize, setFrameSize] = useState<CropFrameSize>({ width: 0, height: 0 });
  const [previewSize, setPreviewSize] = useState<CropFrameSize>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<CropOffset>(INITIAL_OFFSET);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startOffset: CropOffset;
  } | null>(null);

  const maxZoom = Math.max(1.5, config.maxZoom ?? 4);

  useEffect(() => {
    return () => URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const updateSize = () => {
      const bounds = frame.getBoundingClientRect();
      const nextFrame = { width: bounds.width, height: bounds.height };
      setFrameSize(nextFrame);
      setOffset((current) => imageSize.width
        ? clampCropOffset({ image: imageSize, frame: nextFrame, zoom, offset: current })
        : current);
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [imageSize, zoom]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;

    const updateSize = () => {
      const bounds = preview.getBoundingClientRect();
      setPreviewSize({ width: bounds.width, height: bounds.height });
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(preview);
    return () => observer.disconnect();
  }, [config.preview]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !processing) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel, processing]);

  const displaySize = useMemo(() => {
    const scale = getCoverScale(imageSize, frameSize) * zoom;
    return { width: imageSize.width * scale, height: imageSize.height * scale };
  }, [frameSize, imageSize, zoom]);

  const previewLayout = useMemo(() => {
    if (!imageSize.width || !frameSize.width || !previewSize.width) return null;
    const source = getCropSourceRect({ image: imageSize, frame: frameSize, zoom, offset });
    return getCropPreviewLayout({ image: imageSize, source, preview: previewSize });
  }, [frameSize, imageSize, offset, previewSize, zoom]);

  const updateZoom = useCallback((nextZoom: number) => {
    const clampedZoom = Math.min(maxZoom, Math.max(1, nextZoom));
    setZoom(clampedZoom);
    setOffset((current) => clampCropOffset({
      image: imageSize,
      frame: frameSize,
      zoom: clampedZoom,
      offset: current,
    }));
  }, [frameSize, imageSize, maxZoom]);

  const reset = () => {
    setZoom(1);
    setOffset(INITIAL_OFFSET);
    setError(null);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!imageSize.width || processing) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: offset,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextOffset = {
      x: drag.startOffset.x + event.clientX - drag.startX,
      y: drag.startOffset.y + event.clientY - drag.startY,
    };
    setOffset(clampCropOffset({ image: imageSize, frame: frameSize, zoom, offset: nextOffset }));
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const confirm = async () => {
    if (!imageRef.current || !imageSize.width || !frameSize.width) return;
    setProcessing(true);
    setError(null);
    try {
      const processedFile = await createCroppedImageFile({
        file,
        imageElement: imageRef.current,
        frame: frameSize,
        zoom,
        offset,
        config,
      });
      await onConfirm(processedFile);
    } catch (processingError) {
      setError(processingError instanceof Error ? processingError.message : "No se pudo procesar la imagen.");
      setProcessing(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-stampa-bg/85 p-2 backdrop-blur-sm sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !processing) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-crop-title"
        aria-describedby="image-crop-help"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
      >
        <div className="flex items-center justify-between border-b border-stampa-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id="image-crop-title" className="text-base font-bold text-white sm:text-lg">Ajustar imagen</h2>
            <p id="image-crop-help" className="mt-0.5 text-xs text-gray-400">Arrastrá la imagen y ajustá el zoom hasta lograr el encuadre.</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={processing}
            className="ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
            aria-label="Cerrar editor de imagen"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          <div
            ref={frameRef}
            className={`relative mx-auto max-h-[52dvh] w-full max-w-xl cursor-grab overflow-hidden bg-black/60 ring-1 ring-white/10 active:cursor-grabbing ${config.cropShape === "circle" ? "rounded-full" : "rounded-xl"}`}
            style={{ aspectRatio: config.aspectRatio, touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imageRef}
              src={imageUrl}
              alt="Vista previa del recorte"
              draggable={false}
              onLoad={(event) => {
                const nextImageSize = {
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                };
                setImageSize(nextImageSize);
                setOffset((current) => clampCropOffset({
                  image: nextImageSize,
                  frame: frameSize,
                  zoom,
                  offset: current,
                }));
              }}
              onError={() => setError("No se pudo leer esta imagen. Probá con un archivo JPG, PNG o WEBP.")}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
              style={{
                width: displaySize.width || undefined,
                height: displaySize.height || undefined,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
            />
            {config.showGrid && (
              <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                <span className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
                <span className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
                <span className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
                <span className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/30" />
          </div>

          {config.preview && (
            <section className="mx-auto mt-4 max-w-sm" aria-label={config.preview.label ?? "Vista previa"}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {config.preview.label ?? "Vista previa"}
              </p>
              <div className="overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface shadow-lg">
                <div
                  ref={previewRef}
                  className="relative w-full overflow-hidden bg-stampa-bg-soft"
                  style={{ aspectRatio: config.aspectRatio }}
                >
                  {previewLayout && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl}
                      alt="Vista previa de la portada en la tarjeta"
                      draggable={false}
                      className="pointer-events-none absolute max-w-none select-none"
                      style={previewLayout}
                    />
                  )}
                </div>
                <div className="border-t border-stampa-border bg-gradient-to-t from-neutral-950 to-neutral-900 px-4 py-3">
                  <p className="truncate text-sm font-bold text-white">{config.preview.title}</p>
                  <p className="mt-2 text-xs text-gray-400">Vista en Academia</p>
                </div>
              </div>
            </section>
          )}

          <div className="mx-auto mt-4 max-w-xl rounded-xl border border-stampa-border bg-stampa-bg-soft p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => updateZoom(zoom - 0.1)}
                disabled={processing || zoom <= 1}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-stampa-border text-gray-300 hover:bg-white/5 disabled:opacity-40"
                aria-label="Alejar imagen"
              >
                <Minus size={18} />
              </button>
              <label className="min-w-0 flex-1">
                <span className="sr-only">Zoom de la imagen</span>
                <input
                  type="range"
                  min="1"
                  max={maxZoom}
                  step="0.01"
                  value={zoom}
                  onChange={(event) => updateZoom(Number(event.target.value))}
                  disabled={processing}
                  className="h-11 w-full cursor-pointer accent-stampa-orange"
                  aria-label="Zoom de la imagen"
                  aria-valuetext={`${Math.round(zoom * 100)}%`}
                />
              </label>
              <button
                type="button"
                onClick={() => updateZoom(zoom + 0.1)}
                disabled={processing || zoom >= maxZoom}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-stampa-border text-gray-300 hover:bg-white/5 disabled:opacity-40"
                aria-label="Acercar imagen"
              >
                <Plus size={18} />
              </button>
              <span className="hidden w-12 text-right text-xs font-semibold tabular-nums text-gray-400 sm:block">{Math.round(zoom * 100)}%</span>
            </div>
            <button
              type="button"
              onClick={reset}
              disabled={processing}
              className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-gray-300 hover:bg-white/5 disabled:opacity-50"
            >
              <RotateCcw size={16} /> Restablecer
            </button>
          </div>

          {error && <p role="alert" className="mx-auto mt-3 max-w-xl rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-stampa-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:p-4">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            disabled={processing}
            className="min-h-11 rounded-xl border border-stampa-border px-5 text-sm font-bold text-gray-300 hover:bg-white/5 disabled:opacity-50 sm:min-w-28"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={processing || !imageSize.width || Boolean(error)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stampa-orange px-5 text-sm font-bold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-36"
          >
            {processing && <Loader2 size={17} className="animate-spin" />}
            {processing ? "Procesando..." : "Usar imagen"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
