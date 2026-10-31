import { normalizeLampDefinition } from "@/lib/maker/lamps/defaults";
import type { LampDefinition } from "@/lib/maker/lamps/types";

/**
 * "Código del diseño": la LampDefinition completa (incluida la semilla) en un texto corto para copiar, pegar o guardar.
 * Sin base de datos ni migraciones: reconstruye el diseño EXACTO en cualquier navegador. El código no es de confianza:
 * al leerlo se normaliza y el resultado pasa por la validación completa antes de generar nada.
 */
const PREFIX = "SL1:";

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text: string): string {
  const binary = atob(text);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeLampDesign(def: LampDefinition): string {
  return PREFIX + toBase64(JSON.stringify(def)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeLampDesign(code: string): { def: LampDefinition } | { error: string } {
  const text = code.trim();
  if (!text.startsWith(PREFIX)) return { error: "El código no es de una lámpara de Stampa Maker (debe empezar con SL1:)." };
  try {
    const b64 = text.slice(PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
    const json = fromBase64(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return { def: normalizeLampDefinition(JSON.parse(json)) };
  } catch {
    return { error: "No se pudo leer el código del diseño: está incompleto o dañado." };
  }
}
