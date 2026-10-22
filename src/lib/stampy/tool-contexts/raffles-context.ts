import { createClient } from "@/utils/supabase/server";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { getUserRaffleChances, sumActiveBonusEntries } from "@/lib/raffles/participants";
import { getVisibleRaffles } from "@/lib/raffles/public-raffles";

export type StampyRafflesContext = {
  referralCode?: string;
  referralLink?: string;
  /** false = sin acceso vigente a la plataforma: no participa (mismo criterio que el registro de ganadores). */
  eligible: boolean;
  baseEntries: number;
  bonusEntries: number;
  totalEntries: number;
  pendingReferrals: number;
  convertedReferrals: number;
  activeRaffle?: {
    title: string;
    drawDate?: string;
  };
};

/**
 * Contexto de sorteos para Stampy. Usa la misma interpretación de chances que la página de Sorteos
 * y el registro de ganadores (`getUserRaffleChances`): acceso a la plataforma + nivel + extras acreditadas.
 * Las invitaciones se leen con la columna real `referrals.referrer_user_id`.
 */
export async function getStampyRafflesContext(userId: string): Promise<StampyRafflesContext | null> {
  try {
    const supabase = await createClient();
    const [{ access }, profileResult, bonusResult, referralsResult, rafflesResult] = await Promise.all([
      getCurrentUserAccess(supabase),
      supabase.from("profiles").select("referral_code").eq("id", userId).single(),
      supabase.from("user_raffle_bonus_entries").select("entries_count").eq("user_id", userId).eq("is_active", true),
      supabase.from("referrals").select("status").eq("referrer_user_id", userId),
      getVisibleRaffles(supabase),
    ]);

    if (profileResult.error || !profileResult.data || access.userId !== userId) {
      console.error("[Stampy] raffles context profile error", profileResult.error);
      return null;
    }

    const chances = getUserRaffleChances({
      hasPlatformAccess: access.capabilities.accessPlatform,
      memberLevel: access.identity.memberLevel,
      bonusEntries: bonusResult.error ? 0 : sumActiveBonusEntries(bonusResult.data),
    });

    const referrals = referralsResult.error ? [] : referralsResult.data ?? [];
    const now = Date.now();
    const activeRaffle = rafflesResult.error
      ? undefined
      : rafflesResult.data.find((raffle) => !raffle.draw_date || Date.parse(raffle.draw_date) >= now) ?? rafflesResult.data[0];

    const referralCode = profileResult.data.referral_code || undefined;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://academiastampa.com";

    return {
      referralCode,
      referralLink: referralCode ? `${baseUrl}/registro?ref=${referralCode}` : undefined,
      eligible: chances !== null,
      baseEntries: chances?.base ?? 0,
      bonusEntries: chances?.bonus ?? 0,
      totalEntries: chances?.total ?? 0,
      pendingReferrals: referrals.filter((referral) => referral.status === "pending").length,
      convertedReferrals: referrals.filter((referral) => referral.status === "converted" || referral.status === "rewarded").length,
      activeRaffle: activeRaffle
        ? { title: activeRaffle.title, drawDate: activeRaffle.draw_date ?? undefined }
        : undefined,
    };
  } catch (error) {
    console.error("[Stampy] raffles context failed", error);
    return null;
  }
}
