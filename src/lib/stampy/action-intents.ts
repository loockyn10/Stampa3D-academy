import { StampyActionIntent, StampyActionIntentType } from "./types";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function buildToolHref(basePath: string, params: Record<string, string | number | null | undefined>): string {
  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      const strValue = String(value);
      // Sanitize length
      if (strValue.length > 80) continue;
      
      if (typeof value === "number") {
        if (!Number.isFinite(value) || value < 0) continue;
        // Reasonable max
        if (key === "grams" && value > 100000) continue;
        if (key === "hours" && value > 10000) continue;
      }
      urlParams.append(key, strValue);
    }
  }
  const qs = urlParams.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function parseGrams(text: string): number | null {
  const norm = normalize(text);
  if (norm.includes("medio kilo") || norm.includes("medio kg")) return 500;
  
  const kgMatch = norm.match(/(\d+(?:\.\d+)?)\s*(kg|kilos|kilo)/);
  if (kgMatch) return Math.round(parseFloat(kgMatch[1]) * 1000);
  
  const gMatch = norm.match(/(\d+(?:\.\d+)?)\s*(g|gr|gramos)/);
  if (gMatch) return Math.round(parseFloat(gMatch[1]));

  return null;
}

function parseHours(text: string): number | null {
  const norm = normalize(text);
  const match = norm.match(/(\d+(?:\.\d+)?)\s*(h|hs|horas|hora)/);
  if (match) return parseFloat(match[1]);
  return null;
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

  const actionVerbs = [
    "descontar", "descontame", "sacar", "sacame", "restar", "restale", "consumi", "use ",
    "agregar", "agregame", "cargar", "cargame", "sumar", "sumame", "compre", "nuevo",
    "crear", "generar", "hacer", "haceme", "cotizar", "cotizame", "presupuestar", "presupuestame",
    "modificar", "actualizar", "corregir", "cambiar", "calcular", "calculame", "usado"
  ];

  const hasActionVerb = actionVerbs.some((verb) => norm.includes(verb));
  if (!hasActionVerb) {
    return null;
  }

  // 1. create_quote (PRIORITY ABSOLUTA)
  if (
    norm.includes("presupuesto") || norm.includes("presupuestar") ||
    norm.includes("presupuestame") || norm.includes("cotizame") ||
    norm.includes("cotizacion") || norm.includes("cotización") ||
    norm.includes("cotizar") || norm.includes("cobro a un cliente") ||
    norm.includes("hacer presupuesto") || norm.includes("armar presupuesto") ||
    norm.includes("crear presupuesto")
  ) {
    let clientName = null;
    let productName = null;
    let quantity = null;
    let title = null;
    let validUntil = null;
    const missingFields: string[] = [];

    const paraMatch = message.match(/para\s+([A-Za-z\s]+?)(?:\s+de\s+|\s+por\s+|\s+con\s+|\.|$)/i);
    if (paraMatch && paraMatch[1]) {
      clientName = paraMatch[1].trim();
    }

    const qtyMatch = message.match(/(?:de|por)\s+(\d+)\s+([A-Za-z0-9\s]+?)(?:\s+para\s+|\.|$)/i);
    if (qtyMatch) {
      quantity = parseInt(qtyMatch[1], 10);
      productName = qtyMatch[2].trim();
    }
    
    if (clientName) {
      title = `Presupuesto ${clientName} #TEMP`;
    }
    
    if (!clientName) missingFields.push("clientName");
    if (!productName) missingFields.push("productName");
    if (!quantity) missingFields.push("quantity");
    if (!validUntil) missingFields.push("validUntil");

    if (!clientName || !productName || !quantity) {
      return {
        type: "create_quote",
        confidence: 0.9,
        title: "Presupuesto Incompleto",
        summary: "Se detectó la intención de armar un presupuesto, pero faltan datos clave.",
        extracted: { incomplete: true, missingFields },
        toolHref: "/presupuestos",
        toolLabel: "Presupuestos",
        canExecute: false,
        reason: "Matched quote verbs but missing critical data."
      };
    }

    const toolHref = buildToolHref("/presupuestos", { action: "new", client: clientName, product: productName, quantity });

    return {
      type: "create_quote",
      confidence: 0.9,
      title: "Crear presupuesto",
      summary: "Se detectó la intención de armar un presupuesto para un cliente.",
      extracted: { clientName, productName, quantity, title, validUntil, missingFields },
      toolHref,
      toolLabel: "Presupuestos",
      canExecute: false,
      reason: "Matched quote verbs with custom details."
    };
  }

  // 1.5 discount_filament
  if (
    norm.includes("descontar") || norm.includes("descontame") ||
    norm.includes("sacar") || norm.includes("sacame") ||
    norm.includes("restar") || norm.includes("restale") ||
    norm.includes("use ") || norm.includes("usado ") || norm.includes("consumi") ||
    norm.includes("registrar salida")
  ) {
    const isFilamentRelated = norm.match(/(filamento|rollo|pla|petg|tpu|abs|asa|nylon|resina)/);
    if (isFilamentRelated) {
      const grams = parseGrams(norm);
      const matchMaterial = norm.match(/(pla|petg|tpu|abs|asa|nylon|resina)/);
      const material = matchMaterial ? matchMaterial[1].toUpperCase() : null;
      const matchColor = norm.match(/(rojo|azul|verde|negro|blanco|amarillo|naranja|gris|violeta|cian|transparente|natural)/);
      const color = matchColor ? matchColor[1] : null;

      const toolHref = buildToolHref("/stock", {
        tab: "filamentos",
        action: "discount",
        material,
        color,
        grams
      });

      return {
        type: "discount_filament",
        confidence: 0.9,
        title: "Descontar filamento",
        summary: "Se detectó la intención de restar material del stock.",
        extracted: { grams, material, color },
        toolHref,
        toolLabel: "Stock de filamentos",
        canExecute: false,
        reason: "Matched discount verbs with filament context."
      };
    }
  }

  // 2. increase_filament_stock
  if (
    (norm.includes("agregar") || norm.includes("agregame") ||
    norm.includes("cargar") || norm.includes("sumar") ||
    norm.includes("sumame") || norm.includes("compre")) &&
    norm.match(/(filamento|rollo|kilo|pla|petg|tpu|abs|asa|nylon|resina)/) &&
    !norm.includes("nuevo filamento") &&
    !norm.includes("filamento nuevo")
  ) {
    const grams = parseGrams(norm) || (norm.includes("rollo") || norm.includes("kilo") ? 1000 : null);
    const matchMaterial = norm.match(/(pla|petg|tpu|abs|asa|nylon|resina)/);
    const material = matchMaterial ? matchMaterial[1].toUpperCase() : null;
    const matchColor = norm.match(/(rojo|azul|verde|negro|blanco|amarillo|naranja|gris|violeta|cian|transparente|natural)/);
    const color = matchColor ? matchColor[1] : null;
    
    // Attempt to extract brand heuristically (e.g., words near PLA or color)
    const brandMatch = norm.match(/(w3d|elegoo|gst3d|grilon|printalot|hellbot|creality)/);
    const brand = brandMatch ? brandMatch[1].toUpperCase() : null;

    if (grams || material || color) {
      const toolHref = buildToolHref("/stock", {
        tab: "filamentos",
        action: "increase",
        material,
        brand,
        color,
        grams
      });

      return {
        type: "increase_filament_stock",
        confidence: 0.9,
        title: "Aumentar stock de filamento",
        summary: "Se detectó la intención de agregar cantidad a un filamento existente.",
        extracted: { grams, material, brand, color },
        toolHref,
        toolLabel: "Stock de filamentos",
        canExecute: false,
        reason: "Matched add verbs with existing filament context."
      };
    }
  }

  // 3. add_filament
  if (
    (norm.includes("agregar") || norm.includes("agregame") ||
    norm.includes("cargar") || norm.includes("sumar") ||
    norm.includes("sumame") || norm.includes("compre") ||
    norm.includes("creame") || norm.includes("crear") ||
    norm.includes("nuevo")) &&
    (norm.includes("nuevo") || norm.includes("que no tengo")) &&
    norm.match(/(filamento|rollo|pla|petg|tpu|abs|asa|nylon|resina)/)
  ) {
    const matchMaterial = norm.match(/(pla|petg|tpu|abs|asa|nylon|resina)/);
    const material = matchMaterial ? matchMaterial[1].toUpperCase() : null;
    const matchColor = norm.match(/(rojo|azul|verde|negro|blanco|amarillo|naranja|gris|violeta|cian|transparente|natural)/);
    const color = matchColor ? matchColor[1] : null;

    const toolHref = buildToolHref("/stock", {
      tab: "filamentos",
      action: "add",
      material,
      color
    });

    return {
      type: "add_filament",
      confidence: 0.9,
      title: "Agregar filamento nuevo",
      summary: "Se detectó la intención de ingresar un nuevo material al stock.",
      extracted: { material, color },
      toolHref,
      toolLabel: "Stock de filamentos",
      canExecute: false,
      reason: "Matched add verbs with new filament context."
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
    const toolHref = buildToolHref("/calculadora", { action: "add_printer" });
    return {
      type: "add_printer",
      confidence: 0.9,
      title: "Agregar impresora",
      summary: "Se detectó la intención de registrar una nueva impresora.",
      extracted: {},
      toolHref,
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
    const toolHref = buildToolHref("/productos", { action: "new" });
    return {
      type: "create_product",
      confidence: 0.8,
      title: "Crear producto",
      summary: "Se detectó la intención de crear un producto en stock.",
      extracted: {},
      toolHref,
      toolLabel: "Productos",
      canExecute: false,
      reason: "Matched create verbs with product context."
    };
  }

  // 6. calculate_price
  if (
    norm.includes("calcular") || norm.includes("calculame") ||
    norm.includes("cuanto deberia cobrar") || norm.includes("precio de impresion") ||
    norm.includes("cuanto sale imprimir") || norm.includes("precio para") || norm.includes("cobro por")
  ) {
    const grams = parseGrams(norm);
    const hours = parseHours(norm);
    const matchMaterial = norm.match(/(pla|petg|tpu|abs|asa|nylon|resina)/);
    const material = matchMaterial ? matchMaterial[1].toUpperCase() : null;
    
    const brandMatch = norm.match(/(w3d|elegoo|gst3d|grilon|printalot|hellbot|creality)/);
    const brand = brandMatch ? brandMatch[1].toUpperCase() : null;
    
    const matchColor = norm.match(/(rojo|azul|verde|negro|blanco|amarillo|naranja|gris|violeta|cian|transparente|natural)/);
    const color = matchColor ? matchColor[1] : null;

    const printerMatch = message.match(/(?:en la|en|impresora)\s+([A-Za-z0-9\s]+?)(?:\s+de\s+|\s+para\s+|\.|$)/i);
    let printerName = null;
    if (printerMatch && (printerMatch[1].toLowerCase().includes("bambu") || printerMatch[1].toLowerCase().includes("creality") || printerMatch[1].toLowerCase().includes("ender") || printerMatch[1].toLowerCase().includes("prusa") || printerMatch[1].toLowerCase().includes("artillery"))) {
      printerName = printerMatch[1].trim();
    }
    
    const pricingMatch = message.match(/(?:para un cliente|para|cliente)\s+(minorista|mayorista|llavero|jarro|personalizado)/i) || norm.match(/(minorista|mayorista|llavero|jarro|personalizado)/);
    const pricingType = pricingMatch ? pricingMatch[1] : null;

    const toolHref = buildToolHref("/calculadora", { action: "calculate", grams, hours, material, brand, color, printer: printerName, pricingType });

    return {
      type: "calculate_price",
      confidence: 0.9,
      title: "Calcular precio",
      summary: "Se detectó la intención de calcular costos de impresión.",
      extracted: { grams, hours, material, brand, color, printerName, pricingType },
      toolHref,
      toolLabel: "Calculadora de precios",
      canExecute: false,
      reason: "Matched calculate verbs with full context."
    };
  }

  // 6. calculate_price
  if (
    norm.includes("calcular") || norm.includes("calculame") ||
    norm.includes("cuanto deberia cobrar") || norm.includes("precio de impresion") ||
    norm.includes("cuanto sale imprimir") || norm.includes("precio para") || norm.includes("cobro por")
  ) {
    const grams = parseGrams(norm);
    const hours = parseHours(norm);
    const matchMaterial = norm.match(/(pla|petg|tpu|abs|asa|nylon|resina)/);
    const material = matchMaterial ? matchMaterial[1].toUpperCase() : null;
    
    const brandMatch = norm.match(/(w3d|elegoo|gst3d|grilon|printalot|hellbot|creality)/);
    const brand = brandMatch ? brandMatch[1].toUpperCase() : null;
    
    const matchColor = norm.match(/(rojo|azul|verde|negro|blanco|amarillo|naranja|gris|violeta|cian|transparente|natural)/);
    const color = matchColor ? matchColor[1] : null;

    const printerMatch = message.match(/(?:en la|en|impresora)\s+(Bambu [A-Za-z0-9\s]+|Creality [A-Za-z0-9\s]+|Ender [A-Za-z0-9\s]+|Prusa [A-Za-z0-9\s]+)/i);
    const printerName = printerMatch ? printerMatch[1].trim() : null;
    
    const pricingMatch = message.match(/(?:para un cliente|para|cliente)\s+(minorista|mayorista|llavero|jarro)/i) || norm.match(/(minorista|mayorista|llavero|jarro)/);
    const pricingType = pricingMatch ? pricingMatch[1] : null;

    const toolHref = buildToolHref("/calculadora", { action: "calculate", grams, hours, material, brand, color, printer: printerName, pricingType });

    return {
      type: "calculate_price",
      confidence: 0.9,
      title: "Calcular precio",
      summary: "Se detectó la intención de calcular costos de impresión.",
      extracted: { grams, hours, material, brand, color, printerName, pricingType },
      toolHref,
      toolLabel: "Calculadora de precios",
      canExecute: false,
      reason: "Matched calculate verbs with full context."
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
  if (intent.type === "create_quote") {
    if (intent.extracted.incomplete) {
      return "Para armar un presupuesto necesito al menos cliente, producto y cantidad. Por ejemplo: 'Hacé un presupuesto para Lucas Marchetti de 2 Jarros de Argentina'. Los gramos pueden ir como nota si querés.";
    }
    let response = "Detecté que querés crear un presupuesto.\n\nDatos detectados:\n";
    const { clientName, productName, quantity, missingFields } = intent.extracted;
    if (clientName) response += `- Cliente: ${clientName}\n`;
    if (productName) response += `- Producto: ${productName}\n`;
    if (quantity) response += `- Cantidad: ${quantity}\n`;
    
    if (missingFields && (missingFields as string[]).includes("validUntil")) {
      response += "\nMe falta la fecha de validez para dejarlo completo. No creé ningún presupuesto todavía, pero te dejo el presupuestador preparado para que revises y completes los datos.";
    } else {
      response += "\nNo creé ningún presupuesto todavía, pero te dejo el presupuestador preparado para que revises y completes los datos.";
    }
    return response;
  }

  if (intent.type === "calculate_price") {
    let response = "Detecté que querés calcular el precio de una impresión.\n\nDatos detectados:\n";
    const { printerName, material, brand, color, grams, hours, pricingType } = intent.extracted;
    if (printerName) response += `- Impresora: ${printerName}\n`;
    if (material || brand || color) response += `- Filamento: ${[material, brand, color].filter(Boolean).join(" ")}\n`;
    if (grams) response += `- Material usado: ${grams}g\n`;
    if (hours) response += `- Tiempo: ${hours}h\n`;
    if (pricingType) response += `- Tipo/categoría: ${pricingType}\n`;
    
    response += "\nNo calculé ni guardé nada desde el chat. Te dejo la calculadora preparada para que revises los datos y obtengas el precio desde la herramienta.";
    return response;
  }

  let response = "Detecté que querés hacer una acción, pero todavía no ejecuto cambios directamente desde el chat.\n\n";
  response += "Acción detectada:\n";
  response += `- Tipo: ${intent.title}\n`;
  
  const extractedKeys = Object.keys(intent.extracted);
  if (extractedKeys.length > 0) {
    const extractedLines = extractedKeys
      .filter(k => intent.extracted[k] !== null && intent.extracted[k] !== undefined && k !== "missingFields" && k !== "title")
      .map(k => {
        let label = k;
        if (k === "grams") label = "Cantidad";
        if (k === "hours") label = "Horas";
        if (k === "material") label = "Material";
        if (k === "color") label = "Color";
        if (k === "brand") label = "Marca";
        return `  - ${label}: ${intent.extracted[k]}${k === "grams" ? "g" : ""}${k === "hours" ? "h" : ""}`;
      });
    
    if (extractedLines.length > 0) {
      response += "- Datos detectados:\n" + extractedLines.join("\n") + "\n";
    }
  }

  if (intent.toolLabel) {
    response += `\nTe dejo la herramienta de **${intent.toolLabel}** preparada acá abajo para que revises y confirmes la acción manualmente.`;
  }

  return response;
}
