import {
  evaluateAccessPolicy,
  type AccessGrantFact,
} from "@/lib/auth/access-policy";
import { getXpRaffleBonusChances } from "@/lib/xp/raffle-bonuses";

export interface RaffleParticipantProfile {
  role: string | null;
  membership_status: string | null;
  membership_expires_at: string | null;
  onboarding_completed: boolean | null;
  member_level: string | null;
}

export function getRaffleParticipantChances(input: {
  profile: RaffleParticipantProfile;
  grants: AccessGrantFact[];
  bonusEntries: number;
  xpLevel?: number;
  xpBonusesEnabled?: boolean;
  now?: Date;
}): number | null {
  const access = evaluateAccessPolicy({
    authenticated: true,
    role: input.profile.role,
    membershipStatus: input.profile.membership_status,
    membershipExpiresAt: input.profile.membership_expires_at,
    onboardingCompleted: input.profile.onboarding_completed === true,
    grants: input.grants,
  }, input.now);

  if (!access.capabilities.accessPlatform) return null;

  const baseChances = input.profile.member_level === "gold" || input.profile.member_level === "elite"
    ? 2
    : 1;

  return baseChances
    + Math.max(0, input.bonusEntries)
    + getXpRaffleBonusChances(input.xpLevel ?? 1, input.xpBonusesEnabled === true);
}
