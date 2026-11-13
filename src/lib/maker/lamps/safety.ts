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

export const LAMP_CLOSED_INSERT_MESSAGE =
  "Inserto CERRADO (tapa plana o cierre en gota): rodea la bombilla y puede retener más calor que un cilindro abierto. Geométricamente respeta la separación de diseño, pero eso NO es una validación térmica: PENDIENTE DE VALIDACIÓN TÉRMICA con tu portalámparas, tu bombilla LED y tu filamento antes de usarlo encendido. No lo presentes como seguro para uso eléctrico.";

export const LAMP_ADHESION_UNVERIFIED_MESSAGE =
  "Reborde interno de adhesión: aumenta la superficie de contacto con la cama y NO garantiza imprimir sin brim ni balsa con cualquier geometría o material. Pendiente de probar en tu impresora y laminador (hay una pieza de prueba en «Piezas de prueba»).";

export const LAMP_OPENWORK_MESSAGE =
  "Pantalla CALADA: las aberturas dejan pasar luz y aire, pero eso NO es una validación térmica ni eléctrica. Una pantalla calada no vuelve segura ninguna combinación de bombilla, portalámparas y filamento: la temperatura, la estabilidad y el ensamblaje siguen PENDIENTES DE VALIDACIÓN FÍSICA con el conjunto impreso.";

export const LAMP_DOUBLE_WALL_CLOSED_MESSAGE =
  "Cámara CERRADA: queda una cavidad interna de aire sin acceso (el piso la cierra abajo y el cielorraso arriba). Es imprimible sin soportes solo si el laminador acepta el techo inclinado y el cielorraso de pocos milímetros: confirmalo en el laminador antes de imprimir; no está validado.";

export const LAMP_SAFETY_NOTICES: readonly string[] = [
  "Usá un portalámparas E27 comercial certificado y una bombilla LED compatible con él. Nada eléctrico se imprime en 3D: ni contactos, ni roscas energizadas, ni conexiones a la red.",
  "Esta herramienta no da instrucciones de cableado de red. El cableado lo debe hacer una persona calificada, siguiendo las instrucciones del fabricante del portalámparas y la normativa vigente.",
  "La separación a la bombilla que configurás es una preferencia geométrica de diseño, NO una distancia térmicamente segura. No hay datos verificados de temperatura para tu bombilla, tu filamento y tu montaje.",
  "El PETG (o cualquier otro filamento) no es seguro por el solo hecho de resistir más temperatura que el PLA. Hace falta medir la temperatura real de las piezas con la lámpara encendida.",
  "No presentes ni vendas la lámpara como lista para uso comercial hasta completar las verificaciones físicas.",
];

/** Medidas que hay que tomar del portalámparas real (y de la bombilla) antes de imprimir la base. */
export const LAMP_MEASUREMENTS_NEEDED: readonly string[] = [
  "Agujero central por el que entra el portalámparas: diámetro libre real (el dato nominal es Ø42; el STL de referencia mide Ø40,9) y diámetro del cuerpo roscado del portalámparas.",
  "Anillos de sujeción: diámetro exterior MÁXIMO (nominal Ø58), espesor de cada anillo y cuántos hay: de eso salen el diámetro y la profundidad del rebaje.",
  "Posición axial: a qué altura sobre la mesa apoyan los anillos o el collar del portalámparas y por qué lado se montan (el STL de referencia los apoya a 31,4 mm con el rebaje por arriba: no está verificado con tu portalámparas).",
  "Altura desde el apoyo hasta el borde superior del portalámparas (donde entra la bombilla).",
  "Inserto de color: si Ø65 es el diámetro EXTERIOR o el interior, y su espesor real de pared (la ranura de la referencia mide 1,25 mm de ancho). Para los insertos cerrados (tapa plana o gota) y el ondulado: forma real de tu bombilla (la herramienta la modela como un cilindro, más conservador que una bombilla redondeada).",
  "Diámetro del cable de alimentación y, si el portalámparas trae pasacables o prensacable propio, su diámetro.",
  "Diámetro de la bombilla y alto que sobresale del portalámparas (la A60 típica es un valor de referencia, no una medida).",
];

/** Pruebas físicas necesarias antes de usar la lámpara encendida. */
export const LAMP_PHYSICAL_TESTS: readonly string[] = [
  "Imprimí las piezas de prueba (macho y hembra de la rosca, y el tramo de torre del portalámparas) antes de la lámpara completa: enroscá, desenroscá varias veces, mové la holgura si hace falta y comprobá que el portalámparas real pase por el agujero, que sus anillos asienten en el rebaje y que el cilindro entre en su ranura.",
  "Laminado en Bambu Studio (o tu laminador) de cada pieza: orientación, soportes, relleno y, si usás el collar, si la pantalla en modo vaso se corta como un solo contorno.",
  "Montaje en seco con el portalámparas real: agujero central, rebaje y anillos (¿se aprietan sin forzar la pared de la torre?), paso y salida del cable, precinto, holguras.",
  "Encaje de la pantalla, del cilindro y de la rosca con el filamento y la impresora reales (la holgura depende del material y de la calibración).",
  "Reborde interno de adhesión: imprimí la pieza de prueba «rosca macho» (lleva el mismo reborde) y comprobá que se adhiere a tu cama con tu laminador sin brim; luego apoyala alrededor de la pieza de prueba del portalámparas para verificar la holgura con la torre. Que se adhiera una vez no valida cualquier geometría o material.",
  "Insertos: laminar en Bambu Studio el plano (invertido, tapa sobre la cama), la gota (parada, con brim del laminador si hace falta; revisá la punta y la pendiente del cierre) y el ondulado (revisá torsión y pendiente). Ninguna geometría de inserto está validada físicamente hasta imprimirla y probarla.",
  "Pantalla CALADA: laminar en Bambu Studio y revisar voladizos de las tiras inclinadas, puentes sobre las aberturas, puntas finas (terminación abierta), estabilidad durante la impresión y si hacen falta soportes o brim. Imprimir una tira de prueba antes de la pantalla completa. Las aberturas NO validan la temperatura: el conjunto sigue pendiente de prueba térmica.",
  "Insertos CERRADOS (plano y gota) y ondulado con tapa: prueba térmica específica (rodean la bombilla y pueden retener más calor). Una lámpara de referencia con cilindro sin ranuras visibles funcionando no demuestra que todas las combinaciones sean térmicamente seguras.",
  "Prueba térmica con una bombilla LED encendida durante varias horas y la lámpara en su posición de uso: temperatura del cilindro, de la pantalla, de la rosca y de la base medida con instrumento, sin dejarla funcionando sola. No uses bombillas incandescentes ni halógenas para validar estos prototipos.",
  "Prueba de estabilidad: inclinación y golpe suave con la lámpara montada; verificá que no vuelque ni quede tensionada por el cable.",
  "Revisión del conjunto por una persona calificada en instalaciones eléctricas antes del uso habitual.",
];

/** Cómo se monta el portalámparas según el sistema de fijación (lo que dice el LÉEME de la lámpara). */
export const LAMP_MOUNT_ASSEMBLY: Record<"rings" | "press" | "threadBase2" | "threadV6", string> = {
  rings: "Base (doble anillo, referencia bottom.stl): pasá el portalámparas comercial por el agujero central, fijalo con sus anillos en el rebaje superior y llevá el cable por el canal inferior; sujetalo con el precinto.",
  press: "Base (a presión, referencia BASE v2.stl): empujá el portalámparas comercial por arriba dentro del agujero liso Ø40,00 hasta que apoye en el piso; el cable sale por el orificio de Ø7 mm y el canal inferior; sujetalo con el precinto.",
  threadBase2: "Base (rosca hembra A, referencia BASE2.stl): enroscá el portalámparas comercial por arriba en la rosca de la torre (a derechas, paso 3,34 mm) hasta que su brida apoye en la cara de la torre; el cable sale por el agujero central y el canal inferior.",
  threadV6: "Base (rosca hembra B con patas, referencia patas V6.stl): enroscá el portalámparas comercial por arriba en la rosca del plato (a derechas, paso 3,0 mm) hasta que su brida apoye en el plato; la base no tiene piso: el cable sale por abajo, entre las patas.",
};

export const LAMP_MOUNT_TEST: Record<"rings" | "press" | "threadBase2" | "threadV6", string> = {
  rings: "Tramo alto de la torre de la base: agujero central, rebaje de los anillos con su apoyo y ranura del cilindro, con las mismas medidas.",
  press: "Tramo de la torre con 20 mm del agujero liso Ø40,00 (con su entrada redondeada) sobre 3 mm de piso con el orificio del cable de Ø7 mm: es el ajuste a presión de BASE v2.stl.",
  threadBase2: "Tramo de la torre con la rosca hembra completa de BASE2.stl (raíz Ø40,621, cresta Ø39,118, paso 3,34 mm, 2 vueltas, a derechas).",
  threadV6: "Tramo del plato con la rosca hembra completa de patas V6.stl (raíz Ø40,5, cresta Ø39,0, paso 3,0 mm, 2 vueltas, a derechas).",
};

export function lampReadmeText(extra: { designCode?: string; holderMeasured: boolean; partNames: string[]; collar?: boolean; openwork?: boolean; mount?: "rings" | "press" | "threadBase2" | "threadV6" }): string {
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
    "- " + LAMP_MOUNT_ASSEMBLY[extra.mount ?? "rings"],
    "- Inserto de color / difusor: apoyá su borde inferior (encastre estándar de diffuser.stl, Ø65,135 exterior y 0,8 mm de pared, igual en todos los estilos y tamaños) en la ranura anular de la torre, alrededor del portalámparas. Si el cuerpo es más ancho, el difusor se ensancha con una transición de 45° sobre ese encastre.",
    "- Orientación de impresión de los insertos: plano y ondulado invertidos (extremo superior sobre la cama, ya vienen así en el STL); gota parada (abertura inferior sobre la cama, brim del laminador si hace falta).",
    extra.collar
      ? "- Collar: apoyá el borde inferior de la pantalla en el pozo del collar (entra a presión) y enroscá el collar en la base hasta el tope."
      : "- Pantalla: enroscala en la base hasta el tope; el cuello roscado es parte de la pantalla.",
    ...(extra.openwork ? ["- Pantalla CALADA: es una sola pieza conectada (anillo inferior, tiras y anillo superior) que se imprime de forma convencional, NO en modo vaso. " + LAMP_OPENWORK_MESSAGE] : []),
    "- Para cambiar el color: sacá el inserto por la abertura superior (los insertos cerrados se agarran de la tapa o la punta); si no sale, desenroscá la pantalla (giro antihorario visto desde arriba).",
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
export function lampTestReadmeText(extra: { threadDiameterMm: number; pitchMm: number; starts: number; clearanceMm: number; holderMeasured: boolean; adhesion?: { enabled: boolean; widthMm: number; heightMm: number }; mount?: "rings" | "press" | "threadBase2" | "threadV6" }): string {
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
    ...(extra.adhesion?.enabled
      ? [
          `   - REBORDE INTERNO DE ADHESIÓN: el macho trae el reborde de la lámpara (${extra.adhesion.widthMm} mm de ancho × ${extra.adhesion.heightMm} mm de alto) en su borde inferior. Imprimilo SIN brim ni balsa y mirá si se adhiere y si se despega con la pieza entera (esto no prueba otras geometrías ni otros materiales).`,
          "   - Holgura con la torre: apoyá el macho (con su reborde) alrededor de la pieza de prueba del portalámparas; el borde interior del reborde no debe tocarla.",
        ]
      : []),
    "",
    "2) lampara_prueba_portalamparas.stl",
    "   " + LAMP_MOUNT_TEST[extra.mount ?? "rings"],
    ...((extra.mount ?? "rings") === "rings"
      ? [
          "   - Pasá el portalámparas comercial real por el agujero, apoyá y apretá sus anillos en el rebaje, y apoyá un cilindro impreso en su ranura: nada debe forzarse ni quedar flojo.",
          "   - Mirá que la pared entre el rebaje y la ranura (la parte más delgada) aguante el apriete de los anillos sin fisurarse.",
        ]
      : (extra.mount ?? "rings") === "press"
        ? ["   - Empujá el portalámparas comercial real dentro del agujero: debe entrar con esfuerzo y quedar firme, sin girar ni salirse al tirar del cable.", "   - Mirá que el orificio del cable de Ø7 mm deje pasar el cable sin rozar."]
        : ["   - Enroscá el portalámparas comercial real a mano, en sentido horario visto desde arriba, hasta que su brida apoye: debe avanzar sin forzar y quedar firme.", "   - Si traba o queda flojo, es una cuestión de la impresora/filamento: ajustá el flujo o la escala antes de imprimir la base; el perfil es el medido en el STL de referencia y no se modifica."]),
    extra.holderMeasured
      ? "   - Las medidas del portalámparas las cargaste vos: esta prueba es la forma de confirmarlas."
      : "   - Las medidas del portalámparas todavía son de EJEMPLO: la base no está validada hasta que esta prueba encaje con tu portalámparas real.",
    "",
    "Estas piezas NO prueban la temperatura, la estabilidad ni la seguridad eléctrica. Esas pruebas siguen pendientes (ver LEEME.txt de la lámpara).",
  ];
  return lines.join("\n") + "\n";
}
