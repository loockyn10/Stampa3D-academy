export interface CalculatorPrinterCatalogItem {
  id: string;
  name: string;
  display_name: string;
  brand: string | null;
  model: string | null;
  power_watts: number;
  maintenance_cost_per_hour: number;
  image_path: string | null;
}

export interface CalculatorFilamentCatalogItem {
  id: string;
  name: string | null;
  display_name: string;
  brand: string | null;
  filament_type: string;
  color: string | null;
  color_hex: string | null;
  default_total_grams: number;
  default_purchase_price: number;
}

export interface CalculatorPreferenceDto {
  defaultPrinterTemplateId: string | null;
  defaultFilamentTemplateId: string | null;
  onboardingStatus: "pending" | "completed" | "skipped";
}

export interface CalculatorCatalogResponse {
  authenticated: boolean;
  demo: boolean;
  printers: CalculatorPrinterCatalogItem[];
  filaments: CalculatorFilamentCatalogItem[];
  catalogPrinters: CalculatorPrinterCatalogItem[];
  catalogFilaments: CalculatorFilamentCatalogItem[];
  selectedPrinterTemplateIds: string[];
  selectedFilamentTemplateIds: string[];
  preferences: CalculatorPreferenceDto | null;
  settings: {
    electricityPriceKwh: number;
    platformCommissionPercent: number;
    platformExtraAmount: number;
    defaultErrorPercent: number;
  };
  productTypes: Array<{ id: string; name: string; multiplier: number; fixed_cost: number }>;
}
