import { createClient } from "@/utils/supabase/server";

export type StampyRafflesContext = {
  referralCode?: string;
  referralLink?: string;
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

export async function getStampyRafflesContext(userId: string): Promise<StampyRafflesContext | null> {
  try {
    const supabase = await createClient();

    // 1. Profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("referral_code, membership_status, member_level")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      console.error("[Stampy] raffles context profile error", profileError);
      return null;
    }

    // 2. Bonus entries
    const { data: bonusData } = await supabase
      .from("user_raffle_bonus_entries")
      .select("entries_count")
      .eq("user_id", userId)
      .eq("is_active", true);

    let bonusEntries = 0;
    if (bonusData) {
      bonusEntries = bonusData.reduce((acc, curr) => acc + (curr.entries_count || 0), 0);
    }

    // 3. Base entries
    let baseEntries = 0;
    if (profile.membership_status === "active") {
      baseEntries = (profile.member_level === "gold" || profile.member_level === "elite") ? 2 : 1;
    }

    // 4. Total
    const totalEntries = baseEntries + bonusEntries;

    // 5. Referrals
    const { data: referrals } = await supabase
      .from("referrals")
      .select("status")
      .eq("referrer_id", userId);

    let pendingReferrals = 0;
    let convertedReferrals = 0;

    if (referrals) {
      pendingReferrals = referrals.filter(r => r.status === "pending").length;
      convertedReferrals = referrals.filter(r => r.status === "converted" || r.status === "rewarded").length;
    }

    // 6. Sorteo activo
    const { data: activeRaffle } = await supabase
      .from("raffles")
      .select("title, description, draw_date, is_active")
      .eq("is_active", true)
      .order("draw_date", { ascending: true })
      .limit(1)
      .single();

    let referralLink = undefined;
    if (profile.referral_code) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://academiastampa.com";
      referralLink = `${baseUrl}/registro?ref=${profile.referral_code}`;
    }

    return {
      referralCode: profile.referral_code || undefined,
      referralLink,
      baseEntries,
      bonusEntries,
      totalEntries,
      pendingReferrals,
      convertedReferrals,
      activeRaffle: activeRaffle ? {
        title: activeRaffle.title,
        drawDate: activeRaffle.draw_date
      } : undefined
    };

  } catch (error) {
    console.error("[Stampy] raffles context failed", error);
    return null;
  }
}
