import type { NeonParams } from "@/lib/maker/neon/types";

export interface NeonFieldError {
  field: keyof NeonParams;
  message: string;
}

const RULES: { field: keyof NeonParams; label: string; min: number; max: number }[] = [
  { field: "designHeightMm", label: "El alto del diseño", min: 10, max: 2000 },
  { field: "neonWidthMm", label: "El ancho del Neon", min: 2, max: 30 },
  { field: "clearanceMm", label: "La holgura", min: 0, max: 3 },
  { field: "wallHeightMm", label: "La altura de pared", min: 1, max: 50 },
  { field: "wallThicknessMm", label: "El espesor de pared", min: 0.4, max: 10 },
  { field: "floorThicknessMm", label: "El espesor de fondo", min: 0.4, max: 10 },
  { field: "minBendRadiusMm", label: "El radio mínimo", min: 1, max: 500 },
];

export function validateNeonParams(params: NeonParams): NeonFieldError[] {
  const errors: NeonFieldError[] = [];
  for (const rule of RULES) {
    const v = params[rule.field];
    if (!Number.isFinite(v) || v < rule.min || v > rule.max) {
      errors.push({ field: rule.field, message: `${rule.label} debe estar entre ${rule.min} y ${rule.max} mm.` });
    }
  }
  return errors;
}
