import type { AttributionRequired, CommercialUse, ModelLicense } from "./types";
import { asRecord, cleanText } from "./sanitize";

/**
 * Normalización de licencias. Regla: solo se mapea lo que la fuente informa de forma explícita; ante cualquier duda
 * queda `unknown`. "Gratis" nunca implica uso comercial permitido.
 */

export const UNKNOWN_LICENSE: ModelLicense = {
  name: null,
  url: null,
  commercialUse: "unknown",
  attributionRequired: "unknown",
  remixAllowed: null,
};

function flag(licenses: unknown, type: string): boolean | null {
  if (!Array.isArray(licenses)) return null;
  for (const entry of licenses) {
    const record = asRecord(entry);
    if (record && record.type === type && typeof record.value === "boolean") return record.value;
  }
  return null;
}

/** MyMiniFactory: `licenses[]` = [{ type: mention|remix|commercial-use|exclusivity|share|store, value: boolean }]. */
export function normalizeMyMiniFactoryLicense(licenses: unknown, licenseName: unknown): ModelLicense {
  const commercial = flag(licenses, "commercial-use");
  const mention = flag(licenses, "mention");
  const commercialUse: CommercialUse = commercial === null ? "unknown" : commercial ? "allowed" : "prohibited";
  const attributionRequired: AttributionRequired = mention === null ? "unknown" : mention;
  return {
    name: cleanText(licenseName, 120),
    url: null,
    commercialUse,
    attributionRequired,
    remixAllowed: flag(licenses, "remix"),
  };
}

/** MyMiniFactory: `store: true` = objeto de tienda (de pago). Sin dato = null. */
export function myMiniFactoryIsFree(licenses: unknown): boolean | null {
  const store = flag(licenses, "store");
  return store === null ? null : !store;
}

interface KnownLicense {
  commercialUse: CommercialUse;
  attributionRequired: AttributionRequired;
}

// Nombres de licencia de Thingiverse mapeados de forma explícita (comparados normalizados).
const THINGIVERSE_LICENSES: Record<string, KnownLicense> = {
  "creative commons - attribution": { commercialUse: "allowed", attributionRequired: true },
  "creative commons - attribution - share alike": { commercialUse: "allowed", attributionRequired: true },
  "creative commons - attribution - no derivatives": { commercialUse: "allowed", attributionRequired: true },
  "creative commons - attribution - non-commercial": { commercialUse: "prohibited", attributionRequired: true },
  "creative commons - attribution - non-commercial - share alike": { commercialUse: "prohibited", attributionRequired: true },
  "creative commons - attribution - non-commercial - no derivatives": { commercialUse: "prohibited", attributionRequired: true },
  "creative commons - public domain dedication": { commercialUse: "allowed", attributionRequired: false },
  "gnu - gpl": { commercialUse: "allowed", attributionRequired: "unknown" },
  "gnu - lgpl": { commercialUse: "allowed", attributionRequired: "unknown" },
  "bsd license": { commercialUse: "allowed", attributionRequired: "unknown" },
};

function normalizeLicenseKey(name: string): string {
  return name.toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim();
}

export function normalizeThingiverseLicense(licenseName: unknown, allowsDerivatives: unknown): ModelLicense {
  const name = cleanText(licenseName, 120);
  const known = name ? THINGIVERSE_LICENSES[normalizeLicenseKey(name)] : undefined;
  return {
    name,
    url: null,
    commercialUse: known?.commercialUse ?? "unknown",
    attributionRequired: known?.attributionRequired ?? "unknown",
    remixAllowed: typeof allowsDerivatives === "boolean" ? allowsDerivatives : null,
  };
}
