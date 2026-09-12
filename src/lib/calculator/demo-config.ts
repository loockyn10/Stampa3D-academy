import "server-only";

export const CALCULATOR_DEMO_CONFIG = {
  printerTemplateId: process.env.STAMPA_DEMO_PRINTER_TEMPLATE_ID?.trim() || null,
  filamentTemplateId: process.env.STAMPA_DEMO_FILAMENT_TEMPLATE_ID?.trim() || null,
  settings: {
    electricityPriceKwh: 120,
    platformCommissionPercent: 15,
    platformExtraAmount: 0,
    defaultErrorPercent: 5,
  },
  productTypes: [
    { id: "demo-direct-sale", name: "Venta directa", multiplier: 3, fixed_cost: 0 },
  ],
} as const;
