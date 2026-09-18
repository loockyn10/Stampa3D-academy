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

  if (params.bodyType === "tapered" && !(params.rearExpansionMm >= 0 && params.rearExpansionMm <= 15)) {
    errors.push({ field: "rearExpansionMm", message: "La expansión de la base trasera debe estar entre 0 y 15 mm." });
  }

  if (params.ribsCount > 0) {
    if (!(params.ribProtrusionMm > 0 && params.ribProtrusionMm <= 5)) {
      errors.push({ field: "ribProtrusionMm", message: "El protrusion de la costilla debe estar entre 0 y 5 mm." });
    }
    if (!(params.ribWidthMm > 0 && params.ribWidthMm <= 10)) {
      errors.push({ field: "ribWidthMm", message: "El ancho de la costilla debe estar entre 0 y 10 mm." });
    }
  }

  if (params.bevelEnabled) {
    if (!(params.bevelDepthMm > 0 && params.bevelDepthMm <= 20)) {
      errors.push({ field: "bevelDepthMm", message: "La profundidad del bisel debe estar entre 0 y 20 mm." });
    }
    if (!(params.bevelInsetMm > 0 && params.bevelInsetMm <= 10)) {
      errors.push({ field: "bevelInsetMm", message: "El desplazamiento del bisel debe estar entre 0 y 10 mm." });
    }
  }

  if (params.frontType === "lid" && !(params.lidMm >= 0.4 && params.lidMm <= 10)) {
    errors.push({ field: "lidMm", message: "El espesor de tapa debe estar entre 0.4 y 10 mm." });
  }

  if (params.frontType === "lid" && params.lidJoint === "interior-lip") {
    if (!(params.insertDepthMm >= 0.5 && params.insertDepthMm <= 20)) {
      errors.push({ field: "insertDepthMm", message: "La profundidad de encastre debe estar entre 0.5 y 20 mm." });
    }
    if (!(params.clearanceMm >= 0 && params.clearanceMm <= 2)) {
      errors.push({ field: "clearanceMm", message: "La holgura debe estar entre 0 y 2 mm." });
    }
    if (!(params.lipWallMm >= 0.4 && params.lipWallMm <= 3)) {
      errors.push({ field: "lipWallMm", message: "El espesor del labio debe estar entre 0.4 y 3 mm." });
    }
  }

  if (params.frontType === "light-channel") {
    if (!(params.channelWidthMm > 0 && params.channelWidthMm <= 30)) {
      errors.push({ field: "channelWidthMm", message: "El ancho del canal debe estar entre 0 y 30 mm." });
    }
    if (!(params.channelDepthMm > 0 && params.channelDepthMm <= 30)) {
      errors.push({ field: "channelDepthMm", message: "La profundidad del canal debe estar entre 0 y 30 mm." });
    }
    if (!(params.channelOffsetMm >= 0 && params.channelOffsetMm <= 20)) {
      errors.push({ field: "channelOffsetMm", message: "El margen del canal debe estar entre 0 y 20 mm." });
    }
    if (!(params.diffuserClearanceMm >= 0 && params.diffuserClearanceMm <= 2)) {
      errors.push({ field: "diffuserClearanceMm", message: "La holgura del difusor debe estar entre 0 y 2 mm." });
    }
    if (!(params.diffuserThicknessMm >= 0.2 && params.diffuserThicknessMm <= 5)) {
      errors.push({ field: "diffuserThicknessMm", message: "El espesor del difusor debe estar entre 0.2 y 5 mm." });
    }
  }

  if (params.frontType === "perforated") {
    if (!(params.maskThicknessMm >= 0.4 && params.maskThicknessMm <= 5)) {
      errors.push({ field: "maskThicknessMm", message: "El espesor de la máscara debe estar entre 0.4 y 5 mm." });
    }
    if (!(params.diffuserThicknessMm >= 0.2 && params.diffuserThicknessMm <= 5)) {
      errors.push({ field: "diffuserThicknessMm", message: "El espesor del difusor debe estar entre 0.2 y 5 mm." });
    }
    if (!(params.holeDiameterMm > 0 && params.holeDiameterMm <= 20)) {
      errors.push({ field: "holeDiameterMm", message: "El diámetro de agujero debe estar entre 0 y 20 mm." });
    }
    if (!(params.pitchMm > params.holeDiameterMm && params.pitchMm <= 50)) {
      errors.push({ field: "pitchMm", message: "El espaciado (centro a centro) debe ser mayor al diámetro de agujero y hasta 50 mm." });
    }
    if (!(params.edgeMarginMm >= 0 && params.edgeMarginMm <= 20)) {
      errors.push({ field: "edgeMarginMm", message: "El margen de borde debe estar entre 0 y 20 mm." });
    }
  }

  return errors;
}
