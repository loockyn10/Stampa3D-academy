import { StampyActionIntent, StampyActionIntentType } from "./types";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function detectStampyActionIntent({
  message,
  workshopContext,
  currentPath,
}: {
  message: string;
  workshopContext?: any;
  currentPath?: string | null;
}): StampyActionIntent | null {
  const norm = normalize(message);

  // Must contain an action verb
  const actionVerbs = [
    "descontar", "descontame", "sacar", "sacame", "restar", "restale", "consumi", "use ",
    "agregar", "agregame", "cargar", "cargame", "sumar", "sumame", "compre", "nuevo",
    "crear", "generar", "hacer", "haceme", "cotizar", "cotizame", "presupuestar", "presupuestame",
    "modificar", "actualizar", "corregir", "cambiar", "calcular", "calculame", "usado"
  ];

  const hasActionVerb = actionVerbs.some((verb) => norm.includes(verb));
  if (!hasActionVerb) {
    return null; // Probable query, not an action
  }

  // 1. discount_filament
  if (
    norm.includes("descontar") || norm.includes("descontame") ||
    norm.includes("sacar") || norm.includes("sacame") ||
    norm.includes("restar") || norm.includes("restale") ||
    norm.includes("use ") || norm.includes("usado ") || norm.includes("consumi") ||
    norm.includes("registrar salida")
  ) {
    const isFilamentRelated = norm.match(/(filamento|rollo|pla|petg|tpu|abs|asa|nylon|resina)/);
    if (isFilamentRelated) {
      const matchGrams = norm.match(/(\d+)\s*(g|gr|gramos)/);
      const matchMaterial = norm.match(/(pla|petg|tpu|abs|asa|nylon|resina)/);
      return {
        type: "discount_filament",
        confidence: 0.9,
        title: "Descontar filamento",
        summary: "Se detectó la intención de restar material del stock.",
        extracted: {
          grams: matchGrams ? parseInt(matchGrams[1], 10) : null,
          material: matchMaterial ? matchMaterial[1].toUpperCase() : null
        },
        toolHref: "/stock?tab=filamentos",
        toolLabel: "Stock de filamentos",
        canExecute: false,
        reason: "Matched discount verbs with filament context."
      };
    }
  }

  // 2. add_filament
  if (
    (norm.includes("agregar") || norm.includes("agregame") ||
    norm.includes("cargar") || norm.includes("sumar") ||
    norm.includes("sumame") || norm.includes("compre") ||
    norm.includes("nuevo")) &&
    norm.match(/(filamento|rollo|pla|petg|tpu|abs|asa|nylon|resina)/)
  ) {
    const matchMaterial = norm.match(/(pla|petg|tpu|abs|asa|nylon|resina)/);
    const colorMatch = norm.match(/(rojo|azul|verde|negro|blanco|amarillo|naranja|gris)/);
    return {
      type: "add_filament",
      confidence: 0.9,
      title: "Agregar filamento",
      summary: "Se detectó la intención de ingresar nuevo material al stock.",
      extracted: {
        material: matchMaterial ? matchMaterial[1].toUpperCase() : null,
        color: colorMatch ? colorMatch[1] : null,
      },
      toolHref: "/stock?tab=filamentos",
      toolLabel: "Stock de filamentos",
      canExecute: false,
      reason: "Matched add verbs with filament context."
    };
  }

  // 3. add_printer
  if (
    (norm.includes("agregar") || norm.includes("agregame") ||
    norm.includes("cargar") || norm.includes("sumar") ||
    norm.includes("sumame") || norm.includes("compre") ||
    norm.includes("nueva")) &&
    (norm.includes("impresora") || norm.includes("maquina") || norm.includes("bambu") || norm.includes("ender") || norm.includes("a1 mini"))
  ) {
    return {
      type: "add_printer",
      confidence: 0.9,
      title: "Agregar impresora",
      summary: "Se detectó la intención de registrar una nueva impresora.",
      extracted: {},
      toolHref: "/calculadora",
      toolLabel: "Calculadora de precios",
      canExecute: false,
      reason: "Matched add verbs with printer context."
    };
  }

  // 4. create_product
  if (
    (norm.includes("crear") || norm.includes("agregar") ||
    norm.includes("agregame") || norm.includes("cargar") ||
    norm.includes("nuevo") || norm.includes("suma")) &&
    (norm.includes("producto") || norm.includes("vender") || norm.includes("articulo") || norm.includes("pieza"))
  ) {
    return {
      type: "create_product",
      confidence: 0.8,
      title: "Crear producto",
      summary: "Se detectó la intención de crear un producto en stock.",
      extracted: {},
      toolHref: "/productos",
      toolLabel: "Productos",
      canExecute: false,
      reason: "Matched create verbs with product context."
    };
  }

  // 5. create_quote
  if (
    norm.includes("presupuesto") || norm.includes("presupuestar") ||
    norm.includes("presupuestame") || norm.includes("cotizame") ||
    norm.includes("cotizar") || norm.includes("cobro a un cliente")
  ) {
    return {
      type: "create_quote",
      confidence: 0.9,
      title: "Crear presupuesto",
      summary: "Se detectó la intención de armar un presupuesto para un cliente.",
      extracted: {},
      toolHref: "/presupuestos",
      toolLabel: "Presupuestos",
      canExecute: false,
      reason: "Matched quote verbs."
    };
  }

  // 6. calculate_price
  if (
    norm.includes("calcular") || norm.includes("calculame") ||
    norm.includes("cuanto deberia cobrar") || norm.includes("precio de impresion") ||
    norm.includes("cuanto sale imprimir")
  ) {
    return {
      type: "calculate_price",
      confidence: 0.9,
      title: "Calcular precio",
      summary: "Se detectó la intención de calcular costos de impresión.",
      extracted: {},
      toolHref: "/calculadora",
      toolLabel: "Calculadora de precios",
      canExecute: false,
      reason: "Matched calculate verbs."
    };
  }

  // 7. update_stock
  if (
    norm.includes("actualizar stock") || norm.includes("corregir stock") ||
    norm.includes("cambiar cantidad") || norm.includes("modificar stock")
  ) {
    return {
      type: "update_stock",
      confidence: 0.8,
      title: "Actualizar stock general",
      summary: "Se detectó la intención de modificar las cantidades del stock.",
      extracted: {},
      toolHref: "/stock",
      toolLabel: "Control de Stock",
      canExecute: false,
      reason: "Matched generic update stock verbs."
    };
  }

  return null;
}

export function buildActionIntentResponse(intent: StampyActionIntent): string {
  let response = "Detecté que querés hacer una acción, pero todavía no ejecuto cambios directamente desde el chat.\n\n";
  response += "Acción detectada:\n";
  response += `- Tipo: ${intent.title}\n`;
  
  const extractedKeys = Object.keys(intent.extracted);
  if (extractedKeys.length > 0) {
    const extractedLines = extractedKeys
      .filter(k => intent.extracted[k] !== null && intent.extracted[k] !== undefined)
      .map(k => {
        let label = k;
        if (k === "grams") label = "Cantidad";
        if (k === "material") label = "Material";
        if (k === "color") label = "Color";
        return `  - ${label}: ${intent.extracted[k]}${k === "grams" ? "g" : ""}`;
      });
    
    if (extractedLines.length > 0) {
      response += "- Datos detectados:\n" + extractedLines.join("\n") + "\n";
    }
  }

  if (intent.toolLabel) {
    response += `- Herramienta recomendada: ${intent.toolLabel}\n\n`;
    response += `Para hacerlo ahora, usá la sugerencia de herramienta acá abajo y registralo manualmente.`;
  }

  return response;
}
