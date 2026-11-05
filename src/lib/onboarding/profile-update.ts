import { EXPERIENCE_LEVEL_OPTIONS, MAIN_GOAL_OPTIONS, PRINTER_BRAND_OPTIONS } from "@/lib/profile-options";

export interface OnboardingAnswers {
  displayName: string;
  printerBrand: string;
  printerModel: string;
  experienceLevel: string;
  mainGoal: string;
}

/** Columns the onboarding may write. None of them is protected by the profiles guard (20261104120000). */
export const ONBOARDING_COLUMNS = [
  "display_name",
  "main_printer_brand",
  "main_printer_model",
  "experience_level",
  "main_goal",
  "onboarding_completed",
  "onboarding_completed_at",
  "updated_at",
] as const;

const allowed = (options: readonly { value: string }[], value: string) =>
  options.some((option) => option.value === value) ? value : null;

/**
 * UPDATE payload for the own profile. `answers = null` = "Completar más tarde": only marks the onboarding as done.
 * Every answer is optional; an empty one never overwrites what the profile already has, and only known option values
 * are written.
 */
export function buildOnboardingUpdate(answers: OnboardingAnswers | null, now: Date): Record<string, string | boolean> {
  const payload: Record<string, string | boolean> = {
    onboarding_completed: true,
    onboarding_completed_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  if (!answers) return payload;

  const displayName = answers.displayName.trim().slice(0, 60);
  if (displayName) payload.display_name = displayName;

  const brand = allowed(PRINTER_BRAND_OPTIONS, answers.printerBrand);
  if (brand) {
    payload.main_printer_brand = brand;
    const model = answers.printerModel.trim().slice(0, 80);
    if (brand === "none_yet") payload.main_printer_model = "";
    else if (model) payload.main_printer_model = model;
  }

  const experience = allowed(EXPERIENCE_LEVEL_OPTIONS, answers.experienceLevel);
  if (experience) payload.experience_level = experience;

  const goal = allowed(MAIN_GOAL_OPTIONS, answers.mainGoal);
  if (goal) payload.main_goal = goal;

  return payload;
}
