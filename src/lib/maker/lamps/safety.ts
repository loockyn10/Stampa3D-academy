/**
 * Textos de seguridad y validación de Lámparas. Una sola fuente: los usan el panel de la herramienta, los avisos del
 * motor, el LÉEME del ZIP y la documentación. Ninguna cifra de acá es una distancia o temperatura "segura": no hay
 * datos verificados para afirmarlo.
 */

/** Códigos de avisos que SIEMPRE acompañan al diseño (no dependen de los parámetros); la UI los muestra aparte. */
export const LAMP_NOTICE_CODES = ["PHYSICAL_VALIDATION_PENDING", "HOLDER_NOT_VALIDATED"] as const;

export const LAMP_PHYSICAL_VALIDATION_MESSAGE =
  "Diseño pendiente de validación física. Los controles de esta herramienta son geométricos: no reemplazan pruebas reales de montaje, temperatura y estabilidad con tu portalámparas, tu bombilla y tu filamento.";

export const LAMP_HOLDER_NOT_VALIDATED_MESSAGE =
  "Base PRELIMINAR - NO VALIDADA: las medidas del portalámparas son valores de ejemplo. E27 es la rosca de la bombilla, no las medidas exteriores del portalámparas: medí el tuyo y cargá las medidas antes de imprimir la base.";

export const LAMP_SAFETY_NOTICES: readonly string[] = [
  "Usá un portalámparas E27 comercial certificado y una bombilla LED compatible con él. Nada eléctrico se imprime en 3D: ni contactos, ni roscas energizadas, ni conexiones a la red.",
  "Esta herramienta no da instrucciones de cableado de red. El cableado lo debe hacer una persona calificada, siguiendo las instrucciones del fabricante del portalámparas y la normativa vigente.",
  "La separación a la bombilla que configurás es una preferencia geométrica de diseño, NO una distancia térmicamente segura. No hay datos verificados de temperatura para tu bombilla, tu filamento y tu montaje.",
  "El PETG (o cualquier otro filamento) no es seguro por el solo hecho de resistir más temperatura que el PLA. Hace falta medir la temperatura real de las piezas con la lámpara encendida.",
  "No presentes ni vendas la lámpara como lista para uso comercial hasta completar las verificaciones físicas.",
];

/** Medidas que hay que tomar del portalámparas real (y de la bombilla) antes de imprimir la base. */
export const LAMP_MEASUREMENTS_NEEDED: readonly string[] = [
  "Diámetro del cuerpo/faldón del portalámparas que apoya sobre la base.",
  "Altura desde la cara de apoyo hasta el borde superior del portalámparas (donde entra la bombilla).",
  "Sistema de fijación real: espiga roscada (M10, M13...) con tuerca, tornillos, presión... y su diámetro exacto. Esta base preliminar solo contempla espiga roscada con tuerca.",
  "Alto y diámetro de la tuerca o de los bornes que quedan por debajo de la base.",
  "Diámetro del cable de alimentación y del pasacables, si el portalámparas lo trae.",
  "Diámetro de la bombilla y alto que sobresale del portalámparas (la A60 típica es un valor de referencia, no una medida).",
];

/** Pruebas físicas necesarias antes de usar la lámpara encendida. */
export const LAMP_PHYSICAL_TESTS: readonly string[] = [
  "Montaje en seco con el portalámparas real: asiento, agujero de la espiga, tuerca, paso y salida del cable, holguras.",
  "Encaje de la pantalla y del inserto con el filamento y la impresora reales (la holgura depende del material y de la calibración).",
  "Prueba térmica con la bombilla encendida durante varias horas y la lámpara en su posición de uso: temperatura del inserto, de la pantalla y de la base medida con instrumento, sin supervisión ausente.",
  "Prueba de estabilidad: inclinación y golpe suave con la lámpara montada; verificá que no vuelque ni quede tensionada por el cable.",
  "Revisión del conjunto por una persona calificada en instalaciones eléctricas antes del uso habitual.",
];

export function lampReadmeText(extra: { designCode?: string; holderMeasured: boolean; partNames: string[] }): string {
  const lines = [
    "LÁMPARA E27 - Stampa Maker (BETA)",
    "",
    "DISEÑO PENDIENTE DE VALIDACIÓN FÍSICA",
    LAMP_PHYSICAL_VALIDATION_MESSAGE,
    "",
    extra.holderMeasured
      ? "Las medidas del portalámparas las cargó el usuario; el conjunto sigue sin validar físicamente."
      : LAMP_HOLDER_NOT_VALIDATED_MESSAGE,
    "",
    "Piezas incluidas: " + extra.partNames.join(", "),
    "",
    "ORDEN DE MONTAJE DE LAS PIEZAS IMPRESAS (el cableado del portalámparas no forma parte de esta herramienta)",
    "- Base, luego el inserto (cae en la ranura de la base) y por último la pantalla (se baja por encima y apoya en los apoyos).",
    "- Para cambiar el color: levantá la pantalla y sacá el inserto tirando de las lengüetas; la pantalla no se reemplaza.",
    "",
    "SEGURIDAD",
    ...LAMP_SAFETY_NOTICES.map((s) => "- " + s),
    "",
    "MEDIDAS A VERIFICAR ANTES DE IMPRIMIR LA BASE",
    ...LAMP_MEASUREMENTS_NEEDED.map((s) => "- " + s),
    "",
    "PRUEBAS FÍSICAS NECESARIAS",
    ...LAMP_PHYSICAL_TESTS.map((s) => "- " + s),
  ];
  if (extra.designCode) lines.push("", "CÓDIGO DEL DISEÑO (pegalo en la herramienta para reconstruirlo exactamente)", extra.designCode);
  return lines.join("\n") + "\n";
}
