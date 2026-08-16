import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";

export interface StampyUserContext {
  displayName?: string;
  fullName?: string;
  printerBrand?: string;
  printerModel?: string;
  experienceLevel?: string;
  mainGoal?: string;
  slicerPreference?: string;
  commercialStage?: string;
  onboardingCompleted?: boolean;
  referralCode?: string;
  membershipStatus?: string;
  memberLevel?: string;
  recommendedPathTitle?: string;
  recommendedPathChips?: string[];
}

const expLevelMap: Record<string, string> = {
  beginner: "Está empezando",
  basic: "Ya hizo algunas impresiones",
  intermediate: "Imprime seguido",
  advanced: "Vende o quiere optimizar su taller"
};

const goalMap: Record<string, string> = {
  first_print: "lograr sus primeras impresiones",
  learn_slicer: "aprender slicer",
  improve_quality: "mejorar calidad",
  sell_products: "vender productos",
  manage_business: "gestionar mejor su taller",
  make_projects: "hacer proyectos prácticos",
  all: "aprender y mejorar en general"
};

const slicerMap: Record<string, string> = {
  bambu_studio: "Bambu Studio",
  orca_slicer: "Orca Slicer",
  cura: "Cura",
  prusa_slicer: "PrusaSlicer",
  flashprint: "FlashPrint",
  lychee_chitubox: "Lychee/Chitubox",
  none: "todavía no usa slicer",
  not_sure: "no está seguro"
};

const commercialStageMap: Record<string, string> = {
  hobby: "hobby",
  starting_business: "empezando a vender",
  already_selling: "ya vende",
  workshop: "tiene o está armando un taller"
};

const printerMap: Record<string, string> = {
  bambu_lab: "Bambu Lab",
  creality: "Creality",
  flashforge: "Flashforge",
  elegoo_fdm: "Elegoo FDM",
  elegoo: "Elegoo",
  prusa: "Prusa",
  anycubic: "Anycubic",
  resin: "Resina",
  other: "Otra",
  none_yet: "Todavía no tiene impresora"
};

export async function getStampyUserContext(userId: string): Promise<StampyUserContext | null> {
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, full_name, main_printer_brand, main_printer_model, experience_level, main_goal, slicer_preference, commercial_stage, onboarding_completed, referral_code, membership_status, member_level")
    .eq("id", userId)
    .single();

  if (!profile) return null;

  const brand = profile.main_printer_brand || "other";
  const goal = profile.main_goal || "all";
  
  let title = "Ruta recomendada para empezar";
  let chips: string[] = [];

  const addChip = (label: string) => {
    if (!chips.includes(label)) chips.push(label);
  };

  if (brand === "bambu_lab") {
    title = "Ruta recomendada para Bambu Lab";
    addChip("Bambu Lab");
  } else if (brand === "flashforge") {
    title = "Ruta recomendada para Flashforge";
    addChip("Flashforge");
  } else if (brand === "none_yet") {
    title = "Ruta para empezar desde cero sin impresora";
    addChip("Sin impresora");
  } else {
    title = "Ruta general recomendada";
    if (brand && brand !== "other") {
      addChip(brand.charAt(0).toUpperCase() + brand.slice(1));
    } else {
      addChip("Ruta General");
    }
  }

  if (goal === "sell_products") {
    addChip("Vender productos");
  } else if (goal === "learn_slicer") {
    addChip("Aprender Slicer");
  } else if (goal === "improve_quality") {
    addChip("Mejorar calidad");
  } else if (goal === "manage_business") {
    addChip("Organizar taller");
  } else if (goal === "first_print") {
    addChip("Primera impresión");
  } else if (goal === "all") {
    addChip("Un poco de todo");
  }

  if (profile.experience_level === "beginner") addChip("Empezando desde cero");
  if (profile.experience_level === "basic") addChip("Algunas impresiones");
  if (profile.experience_level === "intermediate") addChip("Quiero mejorar");
  if (profile.experience_level === "advanced") addChip("Tengo experiencia");

  return {
    displayName: profile.display_name,
    fullName: profile.full_name,
    printerBrand: profile.main_printer_brand ? (printerMap[profile.main_printer_brand] || profile.main_printer_brand) : undefined,
    printerModel: profile.main_printer_model,
    experienceLevel: profile.experience_level ? (expLevelMap[profile.experience_level] || profile.experience_level) : undefined,
    mainGoal: profile.main_goal ? (goalMap[profile.main_goal] || profile.main_goal) : undefined,
    slicerPreference: profile.slicer_preference ? (slicerMap[profile.slicer_preference] || profile.slicer_preference) : undefined,
    commercialStage: profile.commercial_stage ? (commercialStageMap[profile.commercial_stage] || profile.commercial_stage) : undefined,
    onboardingCompleted: profile.onboarding_completed,
    referralCode: profile.referral_code,
    membershipStatus: profile.membership_status,
    memberLevel: profile.member_level,
    recommendedPathTitle: title,
    recommendedPathChips: chips
  };
}
