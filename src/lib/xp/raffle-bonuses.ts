export const XP_RAFFLE_LEVEL_BONUSES = [
  { minimumLevel: 5, extraChances: 1 },
  { minimumLevel: 10, extraChances: 1 },
  { minimumLevel: 15, extraChances: 1 },
] as const;

export const XP_RAFFLE_MAX_EXTRA_CHANCES = 3;

export function isXpRaffleBonusesEnabled(): boolean {
  return process.env.XP_RAFFLE_BONUSES_ENABLED === "true";
}

export function getXpRaffleBonusChances(level: number, enabled = false): number {
  if (!enabled) return 0;
  const normalizedLevel = Math.max(1, Math.floor(Number(level) || 1));
  return Math.min(
    XP_RAFFLE_MAX_EXTRA_CHANCES,
    XP_RAFFLE_LEVEL_BONUSES.reduce(
      (total, reward) => total + (normalizedLevel >= reward.minimumLevel ? reward.extraChances : 0),
      0,
    ),
  );
}

export function isRaffleAvailableForXpLevel(
  minimumLevel: number | null | undefined,
  userLevel: number,
  enabled = false,
): boolean {
  if (!enabled || minimumLevel == null) return true;
  return Math.max(1, Math.floor(Number(userLevel) || 1)) >= minimumLevel;
}
