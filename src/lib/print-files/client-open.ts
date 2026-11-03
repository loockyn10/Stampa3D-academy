import { createPrintFileAccessAction } from "@/app/productos/print-file-actions";
import {
  buildOpenPlan,
  describeDownloadReason,
  detectClientPlatform,
  isMobilePlatform,
  supportsDirectOpen,
  type ClientPlatform,
} from "./open-plan";
import { getSlicer } from "./slicers";

export function currentClientPlatform(): ClientPlatform {
  if (typeof navigator === "undefined") return "unknown";
  return detectClientPlatform({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

function triggerNavigation(href: string, download?: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  if (download) anchor.download = download;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export type FileActionResult =
  /** Se descargó el archivo (el navegador puede igual pedir confirmación o bloquearla). */
  | { kind: "downloaded"; message: string }
  /**
   * Se le pidió al navegador abrir la aplicación. NO es una confirmación: el navegador no informa si el programa
   * está instalado ni si llegó a abrirse. El mensaje lo dice y ofrece la descarga.
   */
  | { kind: "requested"; message: string }
  | { kind: "error"; message: string };

export async function downloadPrintFile(fileId: string): Promise<FileActionResult> {
  const access = await createPrintFileAccessAction(fileId, "download");
  if (!access.success) return { kind: "error", message: access.error };
  triggerNavigation(access.url, access.fileName);
  return { kind: "downloaded", message: "Descarga iniciada." };
}

/**
 * Intenta abrir el proyecto en el laminador elegido; si no hay un mecanismo verificado para este laminador o
 * dispositivo, descarga el archivo y explica cómo abrirlo. Nunca informa una apertura exitosa.
 */
export async function openPrintFileInSlicer(fileId: string, slicerId: string): Promise<FileActionResult> {
  const slicer = getSlicer(slicerId);
  if (!slicer) return { kind: "error", message: "Laminador no reconocido." };
  const platform = currentClientPlatform();

  if (!supportsDirectOpen(slicerId, platform)) {
    const plan = buildOpenPlan(slicerId, platform, "");
    const reason = plan.method === "download" ? plan.reason : "no_deep_link";
    const result = await downloadPrintFile(fileId);
    if (result.kind === "error") return result;
    const lead = describeDownloadReason(reason, slicer.label);
    return { kind: "downloaded", message: isMobilePlatform(platform) ? lead : `${lead} ${slicer.manualOpenHint}` };
  }

  const access = await createPrintFileAccessAction(fileId, "open");
  if (!access.success) return { kind: "error", message: access.error };
  const plan = buildOpenPlan(slicerId, platform, access.url);
  if (plan.method !== "protocol") return downloadPrintFile(fileId);

  triggerNavigation(plan.href);
  return {
    kind: "requested",
    message: `Le pedimos a tu navegador que abra ${slicer.label}. Si no se abrió, descargá el archivo y abrilo desde el programa.${slicer.deepLinkNote ? ` ${slicer.deepLinkNote}` : ""}`,
  };
}
