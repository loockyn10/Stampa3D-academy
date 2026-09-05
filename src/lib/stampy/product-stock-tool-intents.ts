import type { StampyScreenContext, StampyScreenEntity } from "./screen-context";

export type StampyProductStockToolName =
  | "products.inspect"
  | "products.recalculate"
  | "products.production_capacity"
  | "stock.filaments.list"
  | "products.batch_recalculate_blocked"
  | "products.production_with_stock_blocked";

export interface StampyProductStockToolIntent {
  toolName: StampyProductStockToolName;
  productId?: string;
  productName?: string;
  aspect?: "profit" | "pricing" | "recipe" | "summary";
  quantity?: number | null;
  filamentQuery?: {
    material?: string;
    color?: string;
    brand?: string;
    lowStockOnly?: boolean;
  };
  clarification?: string;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("es-AR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function numericFact(entity: StampyScreenEntity, labelPart: string): number | null {
  const fact = entity.facts?.find((candidate) => normalize(candidate.label).includes(labelPart));
  const value = Number(fact?.value);
  return Number.isFinite(value) ? value : null;
}

function resolveVisibleProduct(message: string, context: StampyScreenContext | null): {
  product: StampyScreenEntity | null;
  clarification?: string;
} {
  if (!context) return { product: null };
  const normalizedMessage = normalize(message);
  const visibleProducts = (context.visibleEntities ?? []).filter((entity) => entity.type === "product");
  const selectedProduct = context.selectedEntity?.type === "product" ? context.selectedEntity : null;

  const ordinals: Array<[RegExp, number]> = [
    [/\b(?:primer|primero|primera)\b/, 1],
    [/\b(?:segundo|segunda)\b/, 2],
    [/\b(?:tercer|tercero|tercera)\b/, 3],
    [/\b(?:cuarto|cuarta)\b/, 4],
  ];
  const ordinal = ordinals.find(([pattern]) => pattern.test(normalizedMessage));
  if (ordinal) {
    return {
      product: visibleProducts.find((entity) => entity.position === ordinal[1]) ?? null,
    };
  }

  if (/\b(?:mas caro|mayor precio)\b/.test(normalizedMessage)) {
    const priced = visibleProducts
      .map((entity) => ({ entity, price: numericFact(entity, "precio") }))
      .filter((item): item is { entity: StampyScreenEntity; price: number } => item.price !== null)
      .sort((a, b) => b.price - a.price);
    if (priced.length > 0 && (priced.length === 1 || priced[0].price !== priced[1].price)) {
      return { product: priced[0].entity };
    }
  }

  if (/\b(?:sin stock|no tiene stock)\b/.test(normalizedMessage)) {
    const matches = visibleProducts.filter((entity) => numericFact(entity, "stock") === 0);
    if (matches.length === 1) return { product: matches[0] };
    if (matches.length > 1) {
      return { product: null, clarification: "Veo más de un producto sin stock. Decime el nombre o la posición del que querés consultar." };
    }
  }

  const namedMatches = visibleProducts.filter(
    (entity) => entity.name && normalizedMessage.includes(normalize(entity.name)),
  );
  if (namedMatches.length === 1) return { product: namedMatches[0] };
  if (namedMatches.length > 1) {
    return { product: null, clarification: "Hay más de un producto visible con ese nombre. Indicame su posición, precio o stock." };
  }

  if (selectedProduct && /\b(?:este|esta|esto|seleccionado|seleccionada|recalculalo|recalculala|usa|cuesta|amarillo|amarilla)\b/.test(normalizedMessage)) {
    return { product: selectedProduct };
  }
  if (selectedProduct) return { product: selectedProduct };
  if (visibleProducts.length === 1) return { product: visibleProducts[0] };
  return {
    product: null,
    clarification: "Decime qué producto querés consultar o seleccionalo en Productos.",
  };
}

function parseProductionQuantity(message: string): number | null {
  const match = normalize(message).match(/\b(?:hacer|fabricar|producir|registrar)?\s*(\d+)\b/);
  if (!match) return null;
  const quantity = Number.parseInt(match[1], 10);
  return Number.isInteger(quantity) && quantity > 0 && quantity <= 50 ? quantity : null;
}

function parseFilamentQuery(message: string): StampyProductStockToolIntent["filamentQuery"] {
  const normalizedMessage = normalize(message);
  const material = normalizedMessage.match(/\b(pla|petg|tpu|abs|asa|nylon|resina)\b/)?.[1]?.toUpperCase();
  const color = normalizedMessage.match(/\b(negro|blanco|rojo|azul|celeste|verde|amarillo|naranja|gris|violeta|cian|transparente|natural)\b/)?.[1];
  const brand = normalizedMessage.match(/\b(w3d|elegoo|gst3d|grilon|printalot|hellbot|creality)\b/)?.[1]?.toUpperCase();
  return {
    ...(material ? { material } : {}),
    ...(color ? { color } : {}),
    ...(brand ? { brand } : {}),
    ...(/\b(?:por terminarse|queda poco|menos stock|stock bajo)\b/.test(normalizedMessage)
      ? { lowStockOnly: true }
      : {}),
  };
}

export function bindSelectedProductToConsumptionMessage(
  message: string,
  context: StampyScreenContext | null,
): string {
  const normalizedMessage = normalize(message);
  const selected = context?.selectedEntity?.type === "product" ? context.selectedEntity : null;
  if (!selected?.name) return message;
  if (!/\b(?:descont|rest|consum)\w*\b/.test(normalizedMessage)) return message;
  if (!/\b(?:filament|material|necesario|necesaria|fabricar|producir)\w*\b/.test(normalizedMessage)) return message;
  if (normalizedMessage.includes(normalize(selected.name))) return message;
  const quantity = parseProductionQuantity(message);
  if (!quantity) return message;
  return `Descontá los filamentos de ${quantity} ${selected.name}`;
}

export function detectStampyProductStockToolIntent({
  message,
  screenContext,
}: {
  message: string;
  screenContext: StampyScreenContext | null;
}): StampyProductStockToolIntent | null {
  const normalizedMessage = normalize(message);

  if (/\b(?:recalcula|recalcular|recalculame|recalculalo|recalculala)\b/.test(normalizedMessage)) {
    if (/\b(?:todo|todos|todas)\b/.test(normalizedMessage)) {
      return { toolName: "products.batch_recalculate_blocked" };
    }
    const target = resolveVisibleProduct(message, screenContext);
    return {
      toolName: "products.recalculate",
      productId: target.product?.id,
      productName: target.product?.name,
      clarification: target.clarification,
    };
  }

  if (/\b(?:agrega|agregar|suma|sumar|registra|registrar)\w*\b/.test(normalizedMessage) && /\b(?:stock de productos|al stock|producto terminado|unidades producidas)\b/.test(normalizedMessage)) {
    return { toolName: "products.production_with_stock_blocked" };
  }

  if (/\b(?:me alcanza|alcanzan|cuantos puedo (?:hacer|fabricar|producir)|cantidad maxima|maximo puedo)\b/.test(normalizedMessage)) {
    const target = resolveVisibleProduct(message, screenContext);
    return {
      toolName: "products.production_capacity",
      productId: target.product?.id,
      productName: target.product?.name,
      quantity: parseProductionQuantity(message),
      clarification: target.clarification,
    };
  }

  const stockQuestion = /\b(?:cuanto|cuantos|queda|quedan|tengo|bobina|rollo|por terminarse|stock bajo)\b/.test(normalizedMessage)
    && (/\b(?:filamento|pla|petg|tpu|abs|asa|nylon|resina|bobina|rollo|stock)\b/.test(normalizedMessage)
      || /\b(?:cual|cuales).*(?:por terminarse|queda poco)\b/.test(normalizedMessage));
  if (stockQuestion) {
    return { toolName: "stock.filaments.list", filamentQuery: parseFilamentQuery(message) };
  }

  const asksRecipe = /\b(?:que filamentos? usa|que material(?:es)? usa|receta|que lleva)\b/.test(normalizedMessage);
  const asksProfit = /\b(?:cuanto gano|ganancia|margen|rentabilidad)\b/.test(normalizedMessage);
  const asksPricing = /\b(?:por que (?:cuesta|vale|esta amarillo|esta amarilla)|como se calculo|que cambio|necesita recalculo)\b/.test(normalizedMessage);
  if (asksRecipe || asksProfit || asksPricing) {
    const target = resolveVisibleProduct(message, screenContext);
    return {
      toolName: "products.inspect",
      productId: target.product?.id,
      productName: target.product?.name,
      aspect: asksRecipe ? "recipe" : asksProfit ? "profit" : "pricing",
      clarification: target.clarification,
    };
  }

  return null;
}
