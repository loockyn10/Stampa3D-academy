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

export const LAMP_COLLAR_UNVERIFIED_MESSAGE =
  "Unión por collar roscado: el pozo con nervios que recibe el borde de la pantalla NO está validado con un laminador ni con una pared real de modo vaso. Imprimí el collar y la pantalla y probá el apriete, el centrado y el tirón antes de confiar en la unión.";

export const LAMP_SAFETY_NOTICES: readonly string[] = [
  "Usá un portalámparas E27 comercial certificado y una bombilla LED compatible con él. Nada eléctrico se imprime en 3D: ni contactos, ni roscas energizadas, ni conexiones a la red.",
  "Esta herramienta no da instrucciones de cableado de red. El cableado lo debe hacer una persona calificada, siguiendo las instrucciones del fabricante del portalámparas y la normativa vigente.",
  "La separación a la bombilla que configurás es una preferencia geométrica de diseño, NO una distancia térmicamente segura. No hay datos verificados de temperatura para tu bombilla, tu filamento y tu montaje.",
  "El PETG (o cualquier otro filamento) no es seguro por el solo hecho de resistir más temperatura que el PLA. Hace falta medir la temperatura real de las piezas con la lámpara encendida.",
  "No presentes ni vendas la lámpara como lista para uso comercial hasta completar las verificaciones físicas.",
];

/** Medidas que hay que tomar del portalámparas real (y de la bombilla) antes de imprimir la base. */
export const LAMP_MEASUREMENTS_NEEDED: readonly string[] = [
  "Diámetro MÁXIMO (circunscripto) del faldón o brida del portalámparas que apoya sobre la base.",
  "Altura desde la cara de apoyo hasta el borde superior del portalámparas (donde entra la bombilla).",
  "Sistema de fijación real: espiga hueca roscada con tuerca (M10, M13, 1/8\"...) o brida con tornillos. Anotá el diámetro exacto de la espiga o del tornillo.",
  "Cuánto sobresale la espiga (o el tornillo) por debajo de la cara de apoyo: es lo que decide el espesor del piso de la base. Sin esa medida el portalámparas puede no llegar a la tuerca.",
  "Tuerca: medida entre caras planas y espesor. Con tornillos: separación entre los ejes de los dos agujeros.",
  "Diámetro del cable de alimentación y, si el portalámparas trae pasacables o prensacable propio, su diámetro.",
  "Diámetro de la bombilla y alto que sobresale del portalámparas (la A60 típica es un valor de referencia, no una medida).",
];

/** Pruebas físicas necesarias antes de usar la lámpara encendida. */
export const LAMP_PHYSICAL_TESTS: readonly string[] = [
  "Imprimí las piezas de prueba (macho y hembra de la rosca, y el disco de ajuste del portalámparas) antes de la lámpara completa: enroscá, desenroscá varias veces, mové la holgura si hace falta y comprobá que el portalámparas real asiente, que la espiga atraviese el piso y que la tuerca agarre.",
  "Laminado en Bambu Studio (o tu laminador) de cada pieza: orientación, soportes, relleno y, si usás el collar, si la pantalla en modo vaso se corta como un solo contorno.",
  "Montaje en seco con el portalámparas real: asiento, agujero de la espiga, tuerca, paso y salida del cable, precinto, holguras.",
  "Encaje de la pantalla, del inserto y de la rosca con el filamento y la impresora reales (la holgura depende del material y de la calibración).",
  "Prueba térmica con una bombilla LED encendida durante varias horas y la lámpara en su posición de uso: temperatura del inserto, de la pantalla, de la rosca y de la base medida con instrumento, sin dejarla funcionando sola. No uses bombillas incandescentes ni halógenas para validar estos prototipos.",
  "Prueba de estabilidad: inclinación y golpe suave con la lámpara montada; verificá que no vuelque ni quede tensionada por el cable.",
  "Revisión del conjunto por una persona calificada en instalaciones eléctricas antes del uso habitual.",
];

export function lampReadmeText(extra: { designCode?: string; holderMeasured: boolean; partNames: string[]; collar?: boolean }): string {
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
    "- Base: fijá el portalámparas comercial al piso (espiga con tuerca o tornillos) y pasá el cable por el canal inferior; sujetalo con el precinto.",
    "- Inserto: apoyalo en la ranura del piso de la base, dentro de la cavidad.",
    extra.collar
      ? "- Collar: apoyá el borde inferior de la pantalla en el pozo del collar (entra a presión) y enroscá el collar en la base hasta el tope."
      : "- Pantalla: enroscala en la base hasta el tope; el cuello roscado es parte de la pantalla.",
    "- Para cambiar el color: sacá el inserto tirando de las lengüetas por la abertura superior; si no sale, desenroscá la pantalla (giro antihorario visto desde arriba).",
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

/** LÉEME de las piezas de prueba (rosca y ajuste del portalámparas): qué imprimir, qué comprobar y qué NO prueban. */
export function lampTestReadmeText(extra: { threadDiameterMm: number; pitchMm: number; starts: number; clearanceMm: number; holderMeasured: boolean }): string {
  const lines = [
    "PIEZAS DE PRUEBA - LÁMPARA E27 - Stampa Maker (BETA)",
    "",
    "Imprimilas ANTES que la lámpara completa, con el mismo filamento, boquilla, altura de capa y perfil que vas a usar.",
    "",
    "1) lampara_prueba_rosca_macho.stl + lampara_prueba_rosca_hembra.stl",
    `   Son la rosca real de la interfaz pantalla-base (Ø ${extra.threadDiameterMm} mm, paso ${extra.pitchMm} mm, ${extra.starts} entrada${extra.starts === 1 ? "" : "s"}, holgura radial ${extra.clearanceMm} mm), recortada a una longitud corta.`,
    "   - Imprimí cada pieza apoyada como viene en el archivo (el macho con el extremo roscado hacia abajo).",
    "   - Enroscá el macho en la hembra a mano, en sentido horario visto desde arriba, hasta el tope plano. Desenroscá y repetí varias veces.",
    "   - Si traba o hay que forzar: subí la holgura de la rosca en la herramienta (de a 0,1 mm) y volvé a imprimir. Si queda muy suelta o baila: bajala.",
    "   - Mirá que el tope apoye parejo (sin rendijas) y que no queden hilos de filamento en los flancos.",
    "",
    "2) lampara_prueba_portalamparas.stl",
    "   Disco con el asiento, el agujero de la espiga o de los tornillos, el alojamiento hexagonal de la tuerca, el canal de cable y las ranuras del precinto de la base.",
    "   - Apoyá el portalámparas comercial real en el asiento, pasá la espiga (o los tornillos) y colocá la tuerca desde abajo: tiene que agarrar la rosca completa y apretar.",
    "   - Pasá el cable por el canal y probá el precinto.",
    extra.holderMeasured
      ? "   - Las medidas del portalámparas las cargaste vos: esta prueba es la forma de confirmarlas."
      : "   - Las medidas del portalámparas todavía son de EJEMPLO: la base no está validada hasta que esta prueba encaje con tu portalámparas real.",
    "",
    "Estas piezas NO prueban la temperatura, la estabilidad ni la seguridad eléctrica. Esas pruebas siguen pendientes (ver LEEME.txt de la lámpara).",
  ];
  return lines.join("\n") + "\n";
}
