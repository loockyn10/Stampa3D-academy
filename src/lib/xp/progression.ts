export interface XpProgress {
  totalXp: number;
  level: number;
  currentLevelThreshold: number;
  nextLevelThreshold: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  xpToNextLevel: number;
  progressPercent: number;
}

export function getXpThresholdForLevel(level: number): number {
  const normalizedLevel = Math.max(1, Math.floor(Number(level) || 1));
  const completedLevels = normalizedLevel - 1;
  return (10 * completedLevels * completedLevels) + (90 * completedLevels);
}

export function getXpLevelForTotal(totalXp: number): number {
  const normalizedXp = Math.max(0, Math.floor(Number(totalXp) || 0));
  const approximateCompletedLevels = Math.floor(
    (Math.sqrt(8_100 + (40 * normalizedXp)) - 90) / 20,
  );
  let level = Math.max(1, approximateCompletedLevels + 1);

  while (getXpThresholdForLevel(level + 1) <= normalizedXp) level += 1;
  while (level > 1 && getXpThresholdForLevel(level) > normalizedXp) level -= 1;
  return level;
}

export function getXpProgress(totalXp: number): XpProgress {
  const normalizedXp = Math.max(0, Math.floor(Number(totalXp) || 0));
  const level = getXpLevelForTotal(normalizedXp);
  const currentLevelThreshold = getXpThresholdForLevel(level);
  const nextLevelThreshold = getXpThresholdForLevel(level + 1);
  const xpIntoLevel = normalizedXp - currentLevelThreshold;
  const xpForNextLevel = nextLevelThreshold - currentLevelThreshold;
  const xpToNextLevel = nextLevelThreshold - normalizedXp;

  return {
    totalXp: normalizedXp,
    level,
    currentLevelThreshold,
    nextLevelThreshold,
    xpIntoLevel,
    xpForNextLevel,
    xpToNextLevel,
    progressPercent: xpForNextLevel > 0
      ? Math.min(100, Math.max(0, (xpIntoLevel / xpForNextLevel) * 100))
      : 0,
  };
}

