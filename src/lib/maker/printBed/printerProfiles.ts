/**
 * Perfil mínimo de impresora para la Vista Cama. Solo volumen de impresión:
 * sin temperaturas, sin slicing. Agregar una impresora (A1 Mini, P1S, X1C,
 * K1...) es sumar una entrada a `PRINTER_PROFILES`.
 */
export interface PrinterProfile {
  id: string;
  name: string;
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export const PRINTER_PROFILES: readonly PrinterProfile[] = [
  { id: "bambulab-a1", name: "Bambu Lab A1", widthMm: 256, depthMm: 256, heightMm: 256 },
];

export const DEFAULT_PRINTER_PROFILE_ID = "bambulab-a1";

export function getPrinterProfile(id: string): PrinterProfile {
  return PRINTER_PROFILES.find((p) => p.id === id) ?? PRINTER_PROFILES[0];
}
