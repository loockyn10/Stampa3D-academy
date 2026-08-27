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
  const qs = urlParams.toString().replace(/\+/g, "%20");
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

function parseNewFilamentWeight(text: string): {
  totalGrams: number;
  assumed: boolean;
} {
  const parsedGrams = parseGrams(text);
  if (parsedGrams) return { totalGrams: parsedGrams, assumed: false };

  const norm = normalize(text);
  if (/\b(?:un|1)\s+rollo\b/.test(norm) || /\bun\s+kilo\b/.test(norm)) {
    return { totalGrams: 1000, assumed: false };
  }

  return { totalGrams: 1000, assumed: true };
}

function parseFilamentSubtype(text: string): string | null {
  const norm = normalize(text);
  const subtypes: Array<[RegExp, string]> = [
    [/\becofila\b/, "Ecofila"],
    [/\bsilk\b/, "Silk"],
    [/\bmate\b/, "Mate"],
    [/\bpro\b/, "Pro"],
  ];

  return subtypes.find(([pattern]) => pattern.test(norm))?.[1] ?? null;
}

function parseHours(text: string): number | null {
  const norm = normalize(text);
  const match = norm.match(/(\d+(?:\.\d+)?)\s*(h|hs|horas|hora)/);
  if (match) return parseFloat(match[1]);
  return null;
}

function parseQuoteDetails(message: string): {
  clientName: string | null;
  productName: string | null;
  quantity: number | null;
} {
  const match = message
    .trim()
    .match(/\bpara\s+(.+?)\s+de\s+(\d+)\s+(.+?)[.!?]?$/i);

  if (!match) {
    return { clientName: null, productName: null, quantity: null };
  }

  return {
    clientName: match[1].trim(),
    quantity: Number.parseInt(match[2], 10),
    productName: match[3].trim(),
  };
}

function toDisplayCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function parsePrinterName(message: string): string | null {
  const match = message.match(
    /\b(?:en la|en|impresora)\s+((?:Bambu|Creality|Ender|Prusa)\s+.+?)(?=\s+de\s+\d+(?:[.,]\d+)?\s*(?:h|hs|hora|horas)\b|\s+(?:con|usando)\b|$)/i
  );
  return match ? match[1].trim() : null;
}

function parseNewPrinterDetails(message: string): {
  printerName: string | null;
  brand: string | null;
  model: string | null;
  powerWatts: number;
  powerWattsAssumed: boolean;
  maintenanceCostPerHour: number;
  maintenanceCostPerHourAssumed: boolean;
} {
  const stopPattern =
    "(?=\\s+(?:de\\s+)?\\d+(?:[.,]\\d+)?\\s*(?:w|watts?|vatios?)\\b|\\s+(?:con\\s+)?mantenimiento\\b|[.!?]?$)";
  const patterns = [
    new RegExp(`\\bimpresora(?:\\s+nueva)?\\s+(.+?)${stopPattern}`, "i"),
    new RegExp(`\\bal\\s+taller\\s+(?:una|un)\\s+(.+?)${stopPattern}`, "i"),
    new RegExp(`\\bcargar\\s+mi\\s+(.+?)${stopPattern}`, "i"),
  ];
  const nameMatch = patterns
    .map((pattern) => message.trim().match(pattern))
    .find(Boolean);
  const printerName = nameMatch?.[1]
    ? nameMatch[1].replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim()
    : null;

  const normalizedName = normalize(printerName ?? "");
  const knownBrands: Array<[string, string]> = [
    ["bambu lab", "Bambu Lab"],
    ["bambu", "Bambu"],
    ["creality", "Creality"],
    ["artillery", "Artillery"],
    ["prusa", "Prusa"],
    ["elegoo", "Elegoo"],
    ["anycubic", "Anycubic"],
    ["sovol", "Sovol"],
    ["flashforge", "Flashforge"],
    ["qidi", "Qidi"],
  ];
  const brandEntry = knownBrands.find(([candidate]) =>
    normalizedName.startsWith(`${candidate} `) || normalizedName === candidate
  );
  const brand = brandEntry?.[1] ?? null;
  const model = printerName
    ? brandEntry
      ? printerName.slice(brandEntry[0].length).trim() || null
      : printerName
    : null;

  const powerMatch = message.match(
    /\b(\d+(?:[.,]\d+)?)\s*(?:w|watts?|vatios?)\b/i
  );
  const powerWatts = powerMatch
    ? Number.parseFloat(powerMatch[1].replace(",", "."))
    : 0;

  const maintenanceMatch =
    message.match(
      /\bmantenimiento(?:\s*(?:por\s+hora|\/h))?\s*(?:de|a)?\s*\$?\s*(\d+(?:[.,]\d+)?)/i
    ) ?? message.match(/\$\s*(\d+(?:[.,]\d+)?)\s*(?:\/h|por\s+hora)\b/i);
  const maintenanceCostPerHour = maintenanceMatch
    ? Number.parseFloat(maintenanceMatch[1].replace(",", "."))
    : 0;

  return {
    printerName,
    brand,
    model,
    powerWatts,
    powerWattsAssumed: !powerMatch,
    maintenanceCostPerHour,
    maintenanceCostPerHourAssumed: !maintenanceMatch,
  };
}

const PRODUCT_RECIPE_MATERIALS = [
  "PLA",
  "PETG",
  "TPU",
  "ABS",
  "ASA",
  "NYLON",
  "RESINA",
] as const;

const PRODUCT_RECIPE_BRANDS: Array<[RegExp, string]> = [
  [/\bhellbot\b/i, "Hellbot"],
  [/\belegoo\b/i, "Elegoo"],
  [/\bw3d\b/i, "W3D"],
  [/\bgst3d\b/i, "GST3D"],
  [/\bgrilon\b/i, "Grilon"],
  [/\bprintalot\b/i, "Printalot"],
  [/\bcreality\b/i, "Creality"],
];

const PRODUCT_RECIPE_COLORS = [
  "rojo",
  "azul",
  "verde",
  "negro",
  "blanco",
  "amarillo",
  "naranja",
  "gris",
  "violeta",
  "cian",
  "transparente",
  "natural",
];

export interface StampyProductFilamentComponent {
  grams: number;
  material: string;
  brand: string | null;
  name: string | null;
  color: string | null;
}

function parseProductFilamentComponents(
  message: string
): StampyProductFilamentComponent[] {
  const materialPattern = PRODUCT_RECIPE_MATERIALS.join("|");
  const componentPattern = new RegExp(
    `(\\d+(?:[.,]\\d+)?)\\s*(?:g|gr|gramos)\\s+(${materialPattern})\\b(.*?)(?=(?:\\s*(?:,|y)\\s*)\\d+(?:[.,]\\d+)?\\s*(?:g|gr|gramos)\\b|[.!?]?$)`,
    "gi"
  );
  const components: StampyProductFilamentComponent[] = [];

  for (const match of message.matchAll(componentPattern)) {
    const grams = Number.parseFloat(match[1].replace(",", "."));
    if (!Number.isFinite(grams) || grams <= 0) continue;

    const tail = match[3]
      .replace(/\b(?:con\s+)?stock\b.*$/i, "")
      .replace(/\breceta\b.*$/i, "")
      .replace(/\b(?:tarda|demora|tiempo\s+de\s+impresi[oó]n)\b.*$/i, "")
      .replace(/\b(?:costo|precio|venta|lo\s+vendo|se\s+vende)\b.*$/i, "")
      .trim();
    const brandEntry = PRODUCT_RECIPE_BRANDS.find(([pattern]) =>
      pattern.test(tail)
    );
    const normalizedTail = normalize(tail);
    const color =
      PRODUCT_RECIPE_COLORS.find((candidate) =>
        new RegExp(`\\b${candidate}\\b`, "i").test(normalizedTail)
      ) ?? null;
    let subtype = tail;
    for (const [pattern] of PRODUCT_RECIPE_BRANDS) {
      subtype = subtype.replace(pattern, " ");
    }
    for (const candidate of PRODUCT_RECIPE_COLORS) {
      subtype = subtype.replace(new RegExp(`\\b${candidate}\\b`, "gi"), " ");
    }
    subtype = subtype
      .replace(/\b(?:de|del|filamento|material)\b/gi, " ")
      .replace(/[,.;]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    components.push({
      grams,
      material: match[2].toUpperCase(),
      brand: brandEntry?.[1] ?? null,
      name: subtype || null,
      color,
    });
  }

  return components;
}

function parseLocalizedDecimal(rawValue: string): number | null {
  const compact = rawValue.replace(/[$\s]/g, "");
  if (!/^-?\d[\d.,]*$/.test(compact)) return null;

  const sign = compact.startsWith("-") ? -1 : 1;
  const unsigned = compact.replace(/^-/, "");
  const lastDot = unsigned.lastIndexOf(".");
  const lastComma = unsigned.lastIndexOf(",");
  let normalized = unsigned;

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSeparator = lastDot > lastComma ? "." : ",";
    const thousandsSeparator = decimalSeparator === "." ? /,/g : /\./g;
    normalized = unsigned
      .replace(thousandsSeparator, "")
      .replace(decimalSeparator, ".");
  } else {
    const separator = lastDot >= 0 ? "." : lastComma >= 0 ? "," : null;
    if (separator) {
      const groups = unsigned.split(separator);
      const isThousands =
        groups.length > 2 ||
        (groups.length === 2 && groups[0].length <= 3 && groups[1].length === 3);
      normalized = isThousands
        ? groups.join("")
        : `${groups[0]}.${groups.slice(1).join("")}`;
    }
  }

  const parsed = Number.parseFloat(normalized) * sign;
  return Number.isFinite(parsed) ? parsed : null;
}

function parseProductMoneyField(
  message: string,
  labelPattern: string
): number | string | null {
  const label = new RegExp(`\\b(?:${labelPattern})\\b`, "i");
  const labelMatch = label.exec(message);
  if (!labelMatch) return null;

  const afterLabel = message.slice(labelMatch.index + labelMatch[0].length);
  const amountMatch = afterLabel.match(
    /^\s*(?:(?:de|a)\s+)?\$?\s*(-?\d[\d.,]*)/i
  );
  if (!amountMatch) return "invalid";

  return parseLocalizedDecimal(amountMatch[1]) ?? "invalid";
}

function parseProductPrintTime(message: string): number | string | null {
  const marker = /\b(?:tarda|demora|tiempo\s+de\s+impresi[oó]n)\b/i.exec(message);
  if (!marker) return null;

  const timeText = message
    .slice(marker.index + marker[0].length)
    .split(/[,.;]|\s+y\s+(?=(?:costo|precio|venta|stock|usa|lleva)\b)/i)[0]
    .trim();
  const hoursMatch = timeText.match(
    /(-?\d+(?:[.,]\d+)?)\s*(?:h|hs|hora|horas)\b/i
  );
  const minutesMatch = timeText.match(
    /(-?\d+(?:[.,]\d+)?)\s*(?:m|min|mins|minuto|minutos)\b/i
  );
  const hasHalfHour = /\b(?:y\s+)?media\b/i.test(timeText);

  if (!hoursMatch && !minutesMatch) return "invalid";

  const hours = hoursMatch
    ? Number.parseFloat(hoursMatch[1].replace(",", "."))
    : 0;
  const minutes = minutesMatch
    ? Number.parseFloat(minutesMatch[1].replace(",", "."))
    : 0;
  const totalMinutes = hours * 60 + minutes + (hasHalfHour ? 30 : 0);
  return Number.isFinite(totalMinutes) ? totalMinutes : "invalid";
}

const PRODUCT_NAME_STOP_PATTERN =
  "(?=\\s*(?:,|\\b(?:con\\s+)?(?:stock(?:\\s+inicial)?|cantidad\\s+-?\\d+\\s+unidades?|carg[aá]\\s+-?\\d+\\s+unidades?|que\\s+usa|que\\s+lleva|con\\s+receta|receta|que\\s+tarda|tarda|que\\s+demora|demora|tiempo\\s+de\\s+impresi[oó]n|con\\s+costo|costo|precio|valor|venta|lo\\s+vendo|se\\s+vende|con\\s+-?\\d+(?:[.,]\\d+)?\\s*(?:g|gr|gramos)))\\b|[.!?]?$)";

function parseProductDetails(message: string): {
  productName: string | null;
  initialStock: number | string | null;
  printTimeMinutes: number | string | null;
  baseCost: number | string | null;
  salePrice: number | string | null;
  components: StampyProductFilamentComponent[];
} {
  const creationPattern = "(?:creame|cre[aá]|crear|cargame|carg[aá]|agregame|agreg[aá])";
  const explicitProductMatch = message.match(
    new RegExp(
      `\\b${creationPattern}\\s+(?:un\\s+)?producto\\s+(.+?)${PRODUCT_NAME_STOP_PATTERN}`,
      "i"
    )
  );
  const implicitProductMatch = message.match(
    new RegExp(
      `\\b${creationPattern}\\s+(.+?)${PRODUCT_NAME_STOP_PATTERN}`,
      "i"
    )
  );
  const productName = (explicitProductMatch?.[1] ?? implicitProductMatch?.[1])
    ?.replace(/\s+/g, " ")
    .replace(/[,;:]+$/, "")
    .trim() ?? null;
  const stockMarker = message.match(
    /\b(?:stock(?:\s+inicial)?\s*(?:de|:)?|cantidad\s+|carg[aá]\s+)(-?\d+(?:[.,]\d+)?)\s*(?:unidades?)?\b/i
  );
  const hasInvalidStockMarker =
    !stockMarker &&
    /\b(?:stock(?:\s+inicial)?|cantidad(?:\s+\S+)?\s+unidades?|carg[aá](?:\s+\S+)?\s+unidades?)\b/i.test(
      message
    );
  const explicitSalePrice = parseProductMoneyField(
    message,
    "precio\\s+de\\s+venta|precio\\s+final|lo\\s+vendo|se\\s+vende|venta"
  );
  const legacySalePrice = /\bprecio\s+de\s+costo\b/i.test(message)
    ? null
    : parseProductMoneyField(message, "precio|valor");

  return {
    productName,
    initialStock: stockMarker
      ? parseLocalizedDecimal(stockMarker[1]) ?? "invalid"
      : hasInvalidStockMarker
        ? "invalid"
        : null,
    printTimeMinutes: parseProductPrintTime(message),
    baseCost: parseProductMoneyField(
      message,
      "costo\\s+de\\s+producci[oó]n|precio\\s+de\\s+costo|costo\\s+base|me\\s+cuesta|costo"
    ),
    salePrice: explicitSalePrice ?? legacySalePrice,
    components: parseProductFilamentComponents(message),
  };
}

function looksLikeProductCreation(message: string): boolean {
  const normalized = normalize(message);
  if (
    !/\b(?:crear|crea|creame|cargar|carga|cargame|agregar|agrega|agregame)\b/.test(
      normalized
    )
  ) {
    return false;
  }
  if (/\bproducto\b/.test(normalized)) return true;
  if (/\b(?:filamento|impresora|maquina)\b/.test(normalized)) return false;

  return (
    /\b(?:receta|que usa|que lleva)\b/.test(normalized) ||
    /\b(?:tarda|demora|tiempo de impresion|costo|precio de venta|precio final|lo vendo|se vende|venta)\b/.test(
      normalized
    ) ||
    /\b(?:stock(?: inicial)?|cantidad)\s+-?\d+\b/.test(normalized) ||
    /\bcon\s+\d+(?:[.,]\d+)?\s*(?:g|gr|gramos)\s+(?:pla|petg|tpu|abs|asa|nylon|resina)\b/.test(
      normalized
    )
  );
}

export function detectStampyActionIntent({
  message,
  currentPath,
}: {
  message: string;
  currentPath?: string | null;
}): StampyActionIntent | null {
  const norm = normalize(message);

  const actionVerbs = [
    "descontar", "descontame", "sacar", "sacame", "restar", "restale", "consumi", "use ",
    "agregar", "agrega", "agregame", "cargar", "cargame", "sumar", "sumame", "compre", "nuevo",
    "crear", "crea ", "creame", "carga ", "generar", "hacer", "hace", "haceme", "suma ", "cotizar", "cotizame", "presupuestar", "presupuestame",
    "modificar", "actualizar", "corregir", "cambiar", "calcular", "calculame", "usado"
  ];

  const hasActionVerb = actionVerbs.some((verb) => norm.includes(verb));
  if (!hasActionVerb) {
    return null;
  }

  // 1. create_quote (PRIORITY ABSOLUTA - MODO SEGURO)
  if (
    norm.includes("presupuesto") || norm.includes("presupuestar") ||
    norm.includes("presupuestame") || norm.includes("cotizame") ||
    norm.includes("cotizacion") || norm.includes("cotización") ||
    norm.includes("cotizar") || norm.includes("cobro a un cliente") ||
    norm.includes("hacer presupuesto") || norm.includes("armar presupuesto") ||
    norm.includes("crear presupuesto")
  ) {
    const quoteDetails = parseQuoteDetails(message);
    const quoteToolHref = quoteDetails.clientName
      ? buildToolHref("/presupuestos", {
          action: "new",
          client: quoteDetails.clientName,
          title: `Presupuesto ${quoteDetails.clientName}`,
        })
      : undefined;
    // Check if it's an insufficient quote request based solely on grams
    const hasGramsOnly = (norm.includes("presupuesto de") || norm.includes("presupuesto por")) && norm.match(/\d+\s*(g|gr|gramos|hs|h|horas)/);
    
    if (hasGramsOnly && !norm.includes("para")) {
       return {
        type: "create_quote",
        confidence: 0.9,
        title: "Presupuesto insuficiente",
        summary: "Se detectó intención de armar presupuesto solo por gramos o horas.",
        extracted: {
          ...quoteDetails,
          incomplete: true,
          reason: "grams_only"
        },
        toolHref: quoteToolHref,
        toolLabel: "Presupuestos",
        canExecute: false,
        reason: "Matched quote verbs but missing all critical data (grams only)."
      };
    }

    return {
      type: "create_quote",
      confidence: 0.9,
      title: "Crear presupuesto",
      summary: "Se detectó la intención de armar un presupuesto.",
      extracted: quoteDetails,
      toolHref: quoteToolHref,
      toolLabel: "Presupuestos",
      canExecute: false,
      reason: "Matched quote verbs (safe mode)."
    };
  }

  // 1.25 create_product. It must run before filament intents because a product
  // recipe can contain filament names and verbs such as "cargá" or "usa".
  if (looksLikeProductCreation(message)) {
    const productDetails = parseProductDetails(message);
    const toolHref = buildToolHref("/productos", { action: "new" });
    return {
      type: "create_product",
      confidence: productDetails.productName ? 0.92 : 0.75,
      title: "Crear producto",
      summary: "Se detectó la intención de crear un producto.",
      extracted: productDetails,
      toolHref,
      toolLabel: "Productos",
      canExecute: false,
      reason: "Matched product creation with optional filament recipe.",
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
      const brandMatch = norm.match(/(w3d|elegoo|gst3d|grilon|printalot|hellbot|creality)/);
      const brand = brandMatch ? brandMatch[1].toUpperCase() : null;

      const toolHref = buildToolHref("/stock", {
        tab: "filamentos",
        action: "discount",
        material,
        brand,
        color,
        grams
      });

      return {
        type: "discount_filament",
        confidence: 0.9,
        title: "Descontar filamento",
        summary: "Se detectó la intención de restar material del stock.",
        extracted: { grams, material, brand, color },
        toolHref,
        toolLabel: "Stock de filamentos",
        canExecute: false,
        reason: "Matched discount verbs with filament context."
      };
    }
  }

  // 2. increase_filament_stock
  if (
    (norm.includes("agregar") || norm.includes("agrega") || norm.includes("agregame") ||
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
    const brandMatch = norm.match(/(w3d|elegoo|gst3d|grilon|printalot|hellbot|creality)/);
    const brand = brandMatch ? brandMatch[1].toUpperCase() : null;
    const name = parseFilamentSubtype(message);
    const { totalGrams, assumed: totalGramsAssumed } = parseNewFilamentWeight(message);

    const toolHref = buildToolHref("/stock", {
      tab: "filamentos",
      action: "add",
      material,
      brand,
      name,
      color,
      totalGrams,
    });

    return {
      type: "add_filament",
      confidence: 0.9,
      title: "Agregar filamento nuevo",
      summary: "Se detectó la intención de ingresar un nuevo material al stock.",
      extracted: {
        material,
        brand,
        name,
        color,
        totalGrams,
        totalGramsAssumed,
      },
      toolHref,
      toolLabel: "Stock de filamentos",
      canExecute: false,
      reason: "Matched add verbs with new filament context."
    };
  }

  // 3. add_printer
  if (
    (norm.includes("agregar") || norm.includes("agrega") || norm.includes("agregame") ||
    norm.includes("cargar") || norm.includes("cargame") ||
    norm.includes("crear") || norm.includes("creame") ||
    norm.includes("sumar") || norm.includes("suma ") ||
    norm.includes("sumame") || norm.includes("compre") ||
    norm.includes("nueva")) &&
    (norm.includes("impresora") || norm.includes("maquina") ||
      norm.includes("bambu") || norm.includes("creality") ||
      norm.includes("ender") || norm.includes("artillery") ||
      norm.includes("prusa") || norm.includes("anycubic") ||
      norm.includes("sovol") || norm.includes("flashforge") ||
      norm.includes("qidi"))
  ) {
    const printerDetails = parseNewPrinterDetails(message);
    const toolHref = buildToolHref("/calculadora", {
      action: "add_printer",
      printer: printerDetails.printerName,
    });
    return {
      type: "add_printer",
      confidence: 0.9,
      title: "Agregar impresora",
      summary: "Se detectó la intención de registrar una nueva impresora.",
      extracted: printerDetails,
      toolHref,
      toolLabel: "Calculadora",
      canExecute: false,
      reason: "Matched add verbs with printer context."
    };
  }

  // 6. calculate_price (MODO SEGURO)
  if (
    norm.includes("calcular") || norm.includes("calculame") ||
    norm.includes("cuanto deberia cobrar") || norm.includes("precio de impresion") ||
    norm.includes("cuanto sale imprimir") || norm.includes("precio para") || norm.includes("cobro por")
  ) {
    const grams = parseGrams(norm);
    const hours = parseHours(norm);
    const matchMaterial = norm.match(/(pla|petg|tpu|abs|asa|nylon|resina)/);
    const material = matchMaterial ? matchMaterial[1].toUpperCase() : null;
    const materialIndex = material ? norm.indexOf(material.toLowerCase()) : -1;
    const filamentContext = materialIndex >= 0
      ? norm.slice(materialIndex).split(/\s+para\b/)[0]
      : norm;

    const brandMatch = filamentContext.match(/(w3d|elegoo|gst3d|grilon|printalot|hellbot|creality)/);
    const brand = brandMatch ? brandMatch[1].toUpperCase() : null;
    const matchColor = filamentContext.match(/(rojo|azul|verde|negro|blanco|amarillo|naranja|gris|violeta|cian|transparente|natural)/);
    const color = matchColor ? toDisplayCase(matchColor[1]) : null;

    const printerName = parsePrinterName(message);
    
    const pricingMatch = message.match(/(?:para un cliente|para|cliente)\s+(minorista|mayorista|llavero|jarro)/i) || norm.match(/(minorista|mayorista|llavero|jarro)/);
    const productType = pricingMatch ? pricingMatch[1].toLowerCase() : null;

    const toolHref = buildToolHref("/calculadora", {
      action: "calculate",
      grams,
      hours,
      printer: printerName,
      material,
      brand,
      color,
      productType,
    });

    return {
      type: "calculate_price",
      confidence: 0.9,
      title: "Calcular precio",
      summary: "Se detectó la intención de calcular costos de impresión.",
      extracted: { grams, hours, printerName, material, brand, color, productType },
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

import { getStampyToolContractsForIntent } from "./tool-registry";

export function buildActionIntentResponse(intent: StampyActionIntent): string {
  const contracts = getStampyToolContractsForIntent(intent.type);
  const contract = contracts.length > 0 ? contracts[0] : null;

  if (intent.type === "create_quote") {
    if (intent.extracted.incomplete && intent.extracted.reason === "grams_only") {
      return "Con solo gramos no alcanza para armar un presupuesto. Para presupuestar necesitás indicar cliente, producto, cantidad, título, fecha de validez y notas. Los gramos pueden servir como información adicional, pero no son la base del presupuesto.";
    }
    return "Para armar un presupuesto necesitás cargarlo desde la herramienta de Presupuestos. Los datos principales son cliente, producto, cantidad, título, fecha de validez y notas. Todavía no creo presupuestos desde el chat, pero te dejo el acceso para que lo cargues y revises.";
  }

  if (intent.type === "calculate_price") {
    return "Puedo llevarte a la calculadora para que revises el cálculo. Si detecto gramos y horas, los puedo precargar, pero revisá manualmente impresora, filamento y tipo de producto antes de tomar el precio como válido.";
  }

  let response = "Detecté que querés hacer una acción, pero todavía no ejecuto cambios directamente desde el chat.\n\n";
  response += "Acción detectada:\n";
  response += `- Tipo: ${intent.title}\n`;
  
  const extractedKeys = Object.keys(intent.extracted);
  if (extractedKeys.length > 0) {
    const extractedLines = extractedKeys
      .filter(k => intent.extracted[k] !== null && intent.extracted[k] !== undefined && k !== "missingFields" && k !== "title" && k !== "incomplete" && k !== "reason")
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

  if (contract && contract.safetyNotes.length > 0) {
    response += `\nNotas de seguridad:\n${contract.safetyNotes.map(n => `- ${n}`).join("\n")}\n`;
  }

  if (intent.toolLabel) {
    response += `\nTe dejo la herramienta de **${intent.toolLabel}** preparada acá abajo para que revises y confirmes la acción manualmente.`;
  }

  return response;
}
