export const PRINTER_BRAND_OPTIONS = [
  { value: "bambu_lab", label: "Bambu Lab" },
  { value: "creality", label: "Creality" },
  { value: "elegoo", label: "Elegoo" },
  { value: "flashforge", label: "Flashforge" },
  { value: "anycubic", label: "Anycubic" },
  { value: "other", label: "Otra" },
  { value: "none_yet", label: "Todavía no tengo impresora" },
];

export const EXPERIENCE_LEVEL_OPTIONS = [
  { value: "beginner", label: "Estoy empezando desde cero" },
  { value: "basic", label: "Ya hice algunas impresiones" },
  { value: "intermediate", label: "Ya imprimo seguido, pero quiero mejorar" },
  { value: "advanced", label: "Tengo experiencia y quiero optimizar/calibrar" },
];

export const MAIN_GOAL_OPTIONS = [
  { value: "first_print", label: "Hacer mi primera impresión" },
  { value: "learn_slicer", label: "Aprender a usar el slicer" },
  { value: "improve_quality", label: "Mejorar calidad de impresión" },
  { value: "fix_issues", label: "Solucionar fallas" },
  { value: "design_parts", label: "Diseñar piezas" },
  { value: "sell_products", label: "Vender productos impresos en 3D" },
];

export const COMMERCIAL_STAGE_OPTIONS = [
  { value: "hobby", label: "Lo hago como hobby" },
  { value: "starting_business", label: "Quiero empezar a vender" },
  { value: "already_selling", label: "Ya vendo algunas cosas" },
  { value: "workshop", label: "Tengo o quiero armar un taller" },
];

export function formatPrinterBrandLabel(value: string | null | undefined): string {
  if (!value) return "Cualquier marca";
  // Compatibility
  if (value === "elegoo_fdm") return "Elegoo";
  const option = PRINTER_BRAND_OPTIONS.find(o => o.value === value);
  return option ? option.label : value;
}

export function formatExperienceLevelLabel(value: string | null | undefined): string {
  if (!value) return "Cualquier nivel";
  const option = EXPERIENCE_LEVEL_OPTIONS.find(o => o.value === value);
  return option ? option.label : value;
}

export function formatMainGoalLabel(value: string | null | undefined): string {
  if (!value) return "Cualquier objetivo";
  const option = MAIN_GOAL_OPTIONS.find(o => o.value === value);
  return option ? option.label : value;
}

export function formatCommercialStageLabel(value: string | null | undefined): string {
  if (!value) return "Cualquier etapa";
  const option = COMMERCIAL_STAGE_OPTIONS.find(o => o.value === value);
  return option ? option.label : value;
}
