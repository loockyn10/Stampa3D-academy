import type { LetterSignParams } from "@/lib/maker/types";

export interface FieldError {
  field: keyof LetterSignParams;
  message: string;
}

/** Validaciones básicas de parámetros, antes de correr el pipeline geométrico. */
export function validateLetterSignParams(params: LetterSignParams): FieldError[] {
  const errors: FieldError[] = [];

  if (!params.text || params.text.trim().length === 0) {
    errors.push({ field: "text", message: "Escribí un texto." });
  }

  if (!(params.heightMm > 0)) {
    errors.push({ field: "heightMm", message: "El alto debe ser mayor a 0." });
  }

  if (!(params.depthMm > 0)) {
    errors.push({ field: "depthMm", message: "La profundidad debe ser mayor a 0." });
  }

  if (!(params.wallMm > 0)) {
    errors.push({ field: "wallMm", message: "El espesor de pared debe ser mayor a 0." });
  }

  if (!(params.baseMm > 0)) {
    errors.push({ field: "baseMm", message: "El espesor de fondo debe ser mayor a 0." });
  }

  if (params.baseMm > 0 && params.depthMm > 0 && params.baseMm >= params.depthMm) {
    errors.push({ field: "baseMm", message: "El fondo debe ser menor que la profundidad total." });
  }

  return errors;
}
