import { createClient } from "@/utils/supabase/server";

export type StampyUserContext = {
  displayName?: string;
  experienceLevelLabel?: string;
  mainGoalLabel?: string;
  slicerLabel?: string;
  commercialStageLabel?: string;
  printerLabel?: string;
  onboardingCompleted?: boolean;
  referralCode?: string;
  membershipStatusLabel?: string;
  memberLevelLabel?: string;
};

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

const membershipStatusMap: Record<string, string> = {
  active: "membresía activa",
  inactive: "membresía inactiva",
  cancelled: "membresía cancelada",
  expired: "membresía vencida"
};

const memberLevelMap: Record<string, string> = {
  bronze: "Bronce",
  silver: "Plata",
  gold: "Oro",
  elite: "Elite"
};

export async function getStampyUserContext(userId: string): Promise<StampyUserContext | null> {
  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("display_name, full_name, main_printer_brand, main_printer_model, experience_level, main_goal, slicer_preference, commercial_stage, onboarding_completed, referral_code, membership_status, member_level")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("[Stampy] getStampyUserContext db error", error);
    return null;
  }
  if (!profile) return null;

  let printerLabel = profile.main_printer_brand ? (printerMap[profile.main_printer_brand] || profile.main_printer_brand) : undefined;
  if (printerLabel && profile.main_printer_model) {
    printerLabel = `${printerLabel} ${profile.main_printer_model}`;
  }

  const displayName = profile.display_name || profile.full_name || undefined;

  return {
    displayName,
    printerLabel,
    experienceLevelLabel: profile.experience_level ? (expLevelMap[profile.experience_level] || profile.experience_level) : undefined,
    mainGoalLabel: profile.main_goal ? (goalMap[profile.main_goal] || profile.main_goal) : undefined,
    slicerLabel: profile.slicer_preference ? (slicerMap[profile.slicer_preference] || profile.slicer_preference) : undefined,
    commercialStageLabel: profile.commercial_stage ? (commercialStageMap[profile.commercial_stage] || profile.commercial_stage) : undefined,
    onboardingCompleted: profile.onboarding_completed,
    referralCode: profile.referral_code,
    membershipStatusLabel: profile.membership_status ? (membershipStatusMap[profile.membership_status] || profile.membership_status) : undefined,
    memberLevelLabel: profile.member_level ? (memberLevelMap[profile.member_level] || profile.member_level) : undefined,
  };
}
