"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Loader2 } from "lucide-react";

type SupportedBarcodeFormat =
  | "code_128"
  | "ean_13"
  | "ean_8"
  | "upc_a"
  | "upc_e";

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new(options?: { formats?: SupportedBarcodeFormat[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
}

interface BarcodeScannerProps {
  onDetected: (barcode: string) => void;
}

const REQUESTED_FORMATS: SupportedBarcodeFormat[] = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

export function BarcodeScanner({ onDetected }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const onDetectedRef = useRef(onDetected);
  const lastDetectionRef = useRef<{ value: string; at: number } | null>(null);
  const lastFrameAtRef = useRef(0);
  const [scanning, setScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { onDetectedRef.current = onDetected; }, [onDetected]);

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    detectorRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
    setStarting(false);
  }, []);

  useEffect(() => stop, [stop]);

  const start = async () => {
    setStarting(true);
    setError(null);
    const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!Detector) {
      setStarting(false);
      setError("Este navegador no permite escanear códigos con la cámara. Usá la búsqueda manual.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setStarting(false);
      setError("La cámara requiere una conexión segura. Usá la búsqueda manual.");
      return;
    }

    try {
      const supported = Detector.getSupportedFormats
        ? await Detector.getSupportedFormats()
        : REQUESTED_FORMATS;
      const formats = REQUESTED_FORMATS.filter((format) => supported.includes(format));
      if (formats.length === 0) throw new Error("unsupported_formats");

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      detectorRef.current = new Detector({ formats });
      if (!videoRef.current) throw new Error("video_unavailable");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setScanning(true);
      setStarting(false);
      const scanFrame = async (now: number) => {
        const video = videoRef.current;
        const detector = detectorRef.current;
        if (!video || !detector || !streamRef.current) return;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastFrameAtRef.current >= 220) {
          lastFrameAtRef.current = now;
          try {
            const barcodes = await detector.detect(video);
            const value = barcodes[0]?.rawValue?.trim();
            if (value) {
              const previous = lastDetectionRef.current;
              if (!previous || previous.value !== value || now - previous.at > 1400) {
                lastDetectionRef.current = { value, at: now };
                onDetectedRef.current(value);
              }
            }
          } catch {
            // Individual frames can fail while autofocus settles; keep scanning.
          }
        }
        frameRef.current = requestAnimationFrame(scanFrame);
      };
      frameRef.current = requestAnimationFrame(scanFrame);
    } catch (scanError) {
      stop();
      const name = scanError instanceof DOMException ? scanError.name : "";
      setError(name === "NotAllowedError"
        ? "No se habilitó la cámara. Revisá el permiso o buscá el producto manualmente."
        : "No pudimos iniciar el escáner. Buscá el producto manualmente.");
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-stampa-border bg-black/20">
      <div className={`relative aspect-[4/3] bg-black ${scanning ? "block" : "hidden"}`}>
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-stampa-orange/80 shadow-[0_0_0_999px_rgba(0,0,0,0.25)]" />
      </div>
      {!scanning && (
        <div className="flex min-h-44 flex-col items-center justify-center p-5 text-center">
          <Camera size={28} className="text-stampa-orange" />
          <p className="mt-3 text-sm font-bold text-white">Escanear EAN, UPC o Code 128</p>
          <p className="mt-1 text-xs leading-5 text-gray-500">La cámara se usa sólo mientras este panel está abierto.</p>
        </div>
      )}
      {error && <p className="border-t border-red-500/20 bg-red-500/10 px-4 py-3 text-xs leading-5 text-red-200">{error}</p>}
      <div className="border-t border-stampa-border p-3">
        {scanning ? (
          <button onClick={stop} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-stampa-border bg-white/5 text-sm font-bold text-white"><CameraOff size={17} /> Detener cámara</button>
        ) : (
          <button onClick={() => void start()} disabled={starting} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-stampa-orange text-sm font-bold text-white disabled:opacity-60">
            {starting ? <Loader2 size={17} className="animate-spin" /> : <Camera size={17} />} Iniciar cámara
          </button>
        )}
      </div>
    </div>
  );
}
