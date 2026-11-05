/** Counts of a catalog card: only ACTIVE modules and lessons (inactive ones are not shown inside the course). */
export interface CatalogModuleLike {
  is_active?: boolean | null;
  lessons?: { duration_minutes?: number | null; is_active?: boolean | null }[] | null;
}

export function catalogCourseStats(modules: readonly CatalogModuleLike[] | null | undefined): { lessons: number; minutes: number } {
  let lessons = 0;
  let minutes = 0;
  for (const courseModule of modules ?? []) {
    if (courseModule?.is_active === false) continue;
    for (const lesson of courseModule?.lessons ?? []) {
      if (lesson?.is_active === false) continue;
      lessons += 1;
      minutes += Number(lesson.duration_minutes) || 0;
    }
  }
  return { lessons, minutes };
}
