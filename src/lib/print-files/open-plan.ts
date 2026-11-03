/**
 * Estrategias de apertura de un proyecto en un laminador. Lógica pura (sin DOM): decide QUÉ intentar según el laminador
 * y el dispositivo; la UI solo la ejecuta. Un navegador no puede saber si la aplicación se abrió, así que ningún plan
 * promete éxito y todos conservan la descarga como alternativa.
 */

import { getSlicer, type DesktopPlatform, type SlicerId } from "./slicers";

export type ClientPlatform = DesktopPlatform | "linux" | "android" | "ios" | "unknown";

export interface PlatformSignals {
  userAgent?: string | null;
  /** `navigator.platform` (puede ser vacío o "MacIntel" en iPadOS). */
  platform?: string | null;
  maxTouchPoints?: number | null;
}

export function detectClientPlatform({ userAgent, platform, maxTouchPoints }: PlatformSignals): ClientPlatform {
  const ua = (userAgent ?? "").toLowerCase();
  const nav = (platform ?? "").toLowerCase();
  if (/android/.test(ua)) return "android";
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  // iPadOS 13+ se presenta como Mac: la pantalla táctil lo delata (ningún Mac de escritorio tiene touch points).
  if (nav === "macintel" && (maxTouchPoints ?? 0) > 1) return "ios";
  if (/windows|win32|win64/.test(ua) || nav.startsWith("win")) return "windows";
  if (/mac os x|macintosh/.test(ua) || nav.startsWith("mac")) return "macos";
  if (/linux|x11|cros/.test(ua) || nav.startsWith("linux")) return "linux";
  return "unknown";
}

export function isMobilePlatform(platform: ClientPlatform): boolean {
  return platform === "android" || platform === "ios";
}

export type DownloadReason =
  /** Teléfono o tablet: los laminadores de escritorio no están disponibles. */
  | "mobile"
  /** El laminador no tiene un esquema de URL verificado. */
  | "no_deep_link"
  /** El laminador sí tiene esquema, pero no para este sistema operativo. */
  | "unsupported_platform";

export type OpenPlan =
  | { method: "protocol"; href: string }
  | { method: "download"; reason: DownloadReason };

/** ¿Vale la pena generar un enlace temporal? Evita crear tickets que luego no se usarían (celular, Flash Studio…). */
export function supportsDirectOpen(slicerId: SlicerId | string, platform: ClientPlatform): boolean {
  const slicer = getSlicer(slicerId);
  if (!slicer || isMobilePlatform(platform)) return false;
  return (platform === "windows" || platform === "macos") && Boolean(slicer.deepLink[platform]);
}

/** `fileUrl`: URL https temporal del archivo (ver /api/print-files/open). */
export function buildOpenPlan(slicerId: SlicerId | string, platform: ClientPlatform, fileUrl: string): OpenPlan {
  const slicer = getSlicer(slicerId);
  if (!slicer) return { method: "download", reason: "no_deep_link" };
  if (isMobilePlatform(platform)) return { method: "download", reason: "mobile" };
  if (Object.keys(slicer.deepLink).length === 0) return { method: "download", reason: "no_deep_link" };

  const build = platform === "windows" || platform === "macos" ? slicer.deepLink[platform] : undefined;
  if (!build) return { method: "download", reason: "unsupported_platform" };
  if (!/^https?:\/\//i.test(fileUrl)) return { method: "download", reason: "no_deep_link" };
  return { method: "protocol", href: build(fileUrl) };
}

/** Texto para el aviso tras ejecutar un plan de descarga (nunca habla de "éxito" de una apertura). */
export function describeDownloadReason(reason: DownloadReason, slicerLabel: string): string {
  switch (reason) {
    case "mobile":
      return `Desde un celular o tablet no se puede abrir ${slicerLabel}: descargá el archivo y abrilo en tu computadora.`;
    case "unsupported_platform":
      return `La apertura directa de ${slicerLabel} no está disponible en este sistema: descargá el archivo para abrirlo.`;
    default:
      return `${slicerLabel} no permite abrirse desde el navegador: descargá el archivo para abrirlo.`;
  }
}
