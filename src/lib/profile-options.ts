export const PRINTER_BRAND_OPTIONS = [
  { value: "bambu_lab", label: "Bambu Lab" },
  { value: "creality", label: "Creality" },
  { value: "flashforge", label: "Flashforge" },
  { value: "elegoo_fdm", label: "Elegoo FDM" },
  { value: "prusa", label: "Prusa" },
  { value: "anycubic", label: "Anycubic" },
  { value: "resin", label: "Resina / SLA / MSLA" },
  { value: "other", label: "Otra" },
  { value: "none_yet", label: "Todavía no tengo impresora" },
];

export const EXPERIENCE_LEVEL_OPTIONS = [
  { value: "beginner", label: "Estoy empezando" },
  { value: "basic", label: "Ya hice algunas impresiones" },
  { value: "intermediate", label: "Ya imprimo seguido" },
  { value: "advanced", label: "Ya vendo y quiero optimizar mi taller" },
];

export const MAIN_GOAL_OPTIONS = [
  { value: "first_print", label: "Hacer mi primera impresión" },
  { value: "learn_slicer", label: "Aprender slicer" },
  { value: "improve_quality", label: "Mejorar calidad de impresión" },
  { value: "sell_products", label: "Vender productos impresos" },
  { value: "manage_business", label: "Organizar mi taller" },
  { value: "make_projects", label: "Hacer proyectos concretos" },
  { value: "all", label: "Un poco de todo" },
];

export const SLICER_PREFERENCE_OPTIONS = [
  { value: "bambu_studio", label: "Bambu Studio" },
  { value: "orca_slicer", label: "OrcaSlicer" },
  { value: "cura", label: "Cura" },
  { value: "prusa_slicer", label: "PrusaSlicer" },
  { value: "flashprint", label: "FlashPrint / FlashMaker" },
  { value: "lychee_chitubox", label: "Lychee / Chitubox" },
  { value: "none", label: "Todavía no uso slicer" },
  { value: "not_sure", label: "No sé cuál usar" },
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
  if (value === "elegoo") return "Elegoo FDM";
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

export function formatSlicerPreferenceLabel(value: string | null | undefined): string {
  if (!value) return "Cualquier slicer";
  const option = SLICER_PREFERENCE_OPTIONS.find(o => o.value === value);
  return option ? option.label : value;
}

export function formatCommercialStageLabel(value: string | null | undefined): string {
  if (!value) return "Cualquier etapa";
  const option = COMMERCIAL_STAGE_OPTIONS.find(o => o.value === value);
  return option ? option.label : value;
}
