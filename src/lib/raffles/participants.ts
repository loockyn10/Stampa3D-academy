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

/** Chances base de un participante: 2 para nivel Gold/Elite, 1 para el resto. Única fuente de esta regla. */
export function getBaseRaffleChances(memberLevel: string | null | undefined): number {
  return memberLevel === "gold" || memberLevel === "elite" ? 2 : 1;
}

export interface RaffleChancesBreakdown {
  base: number;
  /** Participaciones extra acreditadas y activas (`user_raffle_bonus_entries.is_active`). */
  bonus: number;
  /** Beneficio por nivel de XP: apagado salvo `XP_RAFFLE_BONUSES_ENABLED=true`. */
  xp: number;
  total: number;
}

/** Suma las participaciones extra activas acreditadas a la cuenta. */
export function sumActiveBonusEntries(rows: Array<{ entries_count?: number | string | null }> | null | undefined): number {
  return (rows ?? []).reduce((total, row) => total + Math.max(0, Number(row.entries_count) || 0), 0);
}

/**
 * Interpretación única de las chances (Sorteos, Inicio, Stampy y registro de ganadores):
 * sin acceso a la plataforma no se participa (null); con acceso = base + extra acreditadas (+ XP si está habilitado).
 * Las invitaciones pendientes NO suman: solo cuentan las entradas ya acreditadas.
 */
export function getUserRaffleChances(input: {
  hasPlatformAccess: boolean;
  memberLevel: string | null | undefined;
  bonusEntries: number;
  xpLevel?: number;
  xpBonusesEnabled?: boolean;
}): RaffleChancesBreakdown | null {
  if (!input.hasPlatformAccess) return null;
  const base = getBaseRaffleChances(input.memberLevel);
  const bonus = Math.max(0, Number(input.bonusEntries) || 0);
  const xp = getXpRaffleBonusChances(input.xpLevel ?? 1, input.xpBonusesEnabled === true);
  return { base, bonus, xp, total: base + bonus + xp };
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

  return getUserRaffleChances({
    hasPlatformAccess: access.capabilities.accessPlatform,
    memberLevel: input.profile.member_level,
    bonusEntries: input.bonusEntries,
    xpLevel: input.xpLevel,
    xpBonusesEnabled: input.xpBonusesEnabled,
  })?.total ?? null;
}
