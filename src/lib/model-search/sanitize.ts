/** Saneamiento de datos externos. Todo lo que viene de un provider se trata como no confiable. */

/** Devuelve la URL normalizada solo si es https, sin credenciales y de un dominio permitido (o subdominio). */
export function safeExternalUrl(value: unknown, allowedDomains: readonly string[]): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const host = url.hostname.toLowerCase();
  const allowed = allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  return allowed ? url.toString() : null;
}

/** Texto plano acotado, sin caracteres de control. React lo escapa al renderizar. */
export function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…` : cleaned;
}

export function nonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

export function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function externalId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value)) return value;
  return null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const ch = String.fromCharCode;
/** Caracteres de control (C0 + DEL). Se construye por código para no depender de escapes en el fuente. */
export const CONTROL_CHARS = new RegExp(`[${ch(0)}-${ch(31)}${ch(127)}]+`, "g");
