export interface StampyToolContract {
  id: string;
  name: string;
  description: string;
  route: string;
  area: string;
  supportedIntents: string[];
  requiredFields: string[];
  optionalFields: string[];
  forbiddenFields: string[];
  safetyNotes: string[];
  canExecuteFromChat: boolean;
}

export const STAMPY_TOOL_REGISTRY: StampyToolContract[] = [
  {
    id: "quotes.create",
    name: "Crear presupuesto",
    description: "Crear presupuestos para clientes.",
    route: "/presupuestos",
    area: "quotes",
    supportedIntents: ["create_quote"],
    requiredFields: ["clientName", "productName", "quantity"],
    optionalFields: ["title", "validUntil", "notes"],
    forbiddenFields: ["grams_as_main_input", "hours_as_main_input", "invented_price"],
    safetyNotes: [
      "El presupuesto no se crea desde Stampy.",
      "No calcular importes desde el chat.",
      "No usar gramos como estructura principal del presupuesto.",
      "No inventar precio ni tarifas.",
      "No mezclar datos de calculadora salvo que el usuario diga explícitamente 'con esos datos'."
    ],
    canExecuteFromChat: false
  },
  {
    id: "calculator.price",
    name: "Calculadora de precios",
    description: "Calcular precio de una impresión.",
    route: "/calculadora",
    area: "calculator",
    supportedIntents: ["calculate_price"],
    requiredFields: ["grams", "hours"],
    optionalFields: ["printerName", "filament", "productType", "material", "brand", "color", "subtype", "name"],
    forbiddenFields: ["invented_price"],
    safetyNotes: [
      "No inventar precio desde el chat.",
      "No prometer selección perfecta si la UI no la aplica realmente.",
      "Si solo se puede precargar gramos y horas, decirlo claramente.",
      "La calculadora es la fuente real del cálculo, el usuario debe confirmar los datos ahí."
    ],
    canExecuteFromChat: false
  },
  {
    id: "calculator.printers.create",
    name: "Crear impresora",
    description: "Crear una impresora nueva en el taller.",
    route: "/calculadora",
    area: "calculator",
    supportedIntents: ["add_printer"],
    requiredFields: ["printerName"],
    optionalFields: [
      "brand",
      "model",
      "powerWatts",
      "maintenanceCostPerHour",
    ],
    forbiddenFields: ["invented_power", "automatic_reactivation"],
    safetyNotes: [
      "Nunca crear desde el primer mensaje: requiere confirmación explícita.",
      "No inventar potencia ni mantenimiento por el modelo.",
      "No crear ni reactivar si ya existe una impresora coincidente.",
    ],
    canExecuteFromChat: false,
  },
  {
    id: "stock.filaments.increase",
    name: "Aumentar stock de filamento",
    description: "Aumentar gramos disponibles de un filamento existente.",
    route: "/stock?tab=filamentos",
    area: "stock",
    supportedIntents: ["increase_filament_stock"],
    requiredFields: ["grams"],
    optionalFields: ["material", "brand", "color"],
    forbiddenFields: ["create_new_if_increasing"],
    safetyNotes: [
      "'un rollo' = 1000g, 'un kilo' = 1000g, 'medio kilo' = 500g.",
      "Debe haber material, color o marca suficiente para identificar el filamento existente.",
      "No crear filamento nuevo si el usuario está sumando gramos a uno existente.",
      "Nunca modificar stock desde el primer mensaje.",
      "Solo ejecutar con match único y confirmación explícita; Stock sigue disponible como fallback."
    ],
    canExecuteFromChat: false
  },
  {
    id: "stock.filaments.discount",
    name: "Descontar stock de filamento",
    description: "Descontar material usado.",
    route: "/stock?tab=filamentos",
    area: "stock",
    supportedIntents: ["discount_filament"],
    requiredFields: ["grams"],
    optionalFields: ["material", "brand", "color"],
    forbiddenFields: [],
    safetyNotes: [
      "Nunca descontar material desde el primer mensaje.",
      "Debe haber material, color o marca suficiente para identificar el filamento.",
      "Solo ejecutar con match único, stock suficiente y confirmación explícita; Stock sigue disponible como fallback."
    ],
    canExecuteFromChat: false
  },
  {
    id: "stock.filaments.create",
    name: "Crear filamento",
    description: "Crear o cargar un filamento nuevo en el stock.",
    route: "/stock?tab=filamentos",
    area: "stock",
    supportedIntents: ["add_filament"],
    requiredFields: ["material"],
    optionalFields: ["brand", "color", "subtype", "name", "totalGrams"],
    forbiddenFields: [],
    safetyNotes: [
      "Solo usar si el usuario dice claramente 'nuevo filamento' o 'crear filamento'.",
      "Nunca crear desde el primer mensaje: requiere confirmación explícita.",
      "No crear si ya existe un filamento activo claramente duplicado."
    ],
    canExecuteFromChat: false
  },
  {
    id: "products.create",
    name: "Crear producto",
    description: "Crear un nuevo producto del usuario.",
    route: "/productos",
    area: "products",
    supportedIntents: ["create_product"],
    requiredFields: ["productName"],
    optionalFields: [
      "description",
      "initialStock",
      "printTimeMinutes",
      "baseCost",
      "salePrice",
      "components",
    ],
    forbiddenFields: [],
    safetyNotes: [
      "No confundir producto con filamento.",
      "No confundir producto con presupuesto.",
      "Si no está claro qué es, preguntar antes."
    ],
    canExecuteFromChat: false
  }
];

export function getStampyToolContract(toolId: string): StampyToolContract | undefined {
  return STAMPY_TOOL_REGISTRY.find(t => t.id === toolId);
}

export function getStampyToolContractsForArea(area: string): StampyToolContract[] {
  return STAMPY_TOOL_REGISTRY.filter(t => t.area === area);
}

export function getStampyToolContractsForIntent(intentType: string): StampyToolContract[] {
  return STAMPY_TOOL_REGISTRY.filter(t => t.supportedIntents.includes(intentType));
}

export function formatToolContractForPrompt(contract: StampyToolContract): string {
  let text = `HERRAMIENTA: ${contract.name}\n`;
  text += `Ruta: ${contract.route}\n`;
  
  if (contract.requiredFields.length > 0) {
    text += `Campos requeridos: ${contract.requiredFields.join(", ")}.\n`;
  }
  if (contract.optionalFields.length > 0) {
    text += `Campos opcionales: ${contract.optionalFields.join(", ")}.\n`;
  }
  if (contract.safetyNotes.length > 0) {
    text += `Reglas: ${contract.safetyNotes.join(" ")}\n`;
  }
  
  return text.trim();
}

export function getRelevantContractsForPath(pathname: string): StampyToolContract[] {
  const contracts: StampyToolContract[] = [];
  
  if (pathname.startsWith("/presupuestos")) {
    contracts.push(...getStampyToolContractsForArea("quotes"));
  } else if (pathname.startsWith("/calculadora")) {
    contracts.push(...getStampyToolContractsForArea("calculator"));
  } else if (pathname.startsWith("/stock")) {
    contracts.push(...getStampyToolContractsForArea("stock"));
  } else if (pathname.startsWith("/productos")) {
    contracts.push(...getStampyToolContractsForArea("products"));
  }
  
  return contracts;
}
