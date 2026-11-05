/** Pure navigation of a course: order, where to resume, previous/next. */

export interface NavModule {
  id: string;
  sort_order?: number | null;
}

export interface NavLesson {
  id: string;
  module_id: string;
  sort_order?: number | null;
}

const bySortOrder = (a: { sort_order?: number | null }, b: { sort_order?: number | null }) =>
  (a.sort_order ?? 0) - (b.sort_order ?? 0);

/** All lessons in course order (module order, then lesson order). Empty modules are skipped. */
export function orderLessons<L extends NavLesson>(modules: readonly NavModule[], lessonsByModule: Record<string, readonly L[]>): L[] {
  return [...modules].sort(bySortOrder).flatMap((module) => [...(lessonsByModule[module.id] ?? [])].sort(bySortOrder));
}

/**
 * Lesson to open when entering a course: the one in the URL (`?clase=`) if it belongs to the course, otherwise the
 * first one not completed (resume), otherwise the first one (course already finished).
 */
export function pickStartLesson<L extends NavLesson>(ordered: readonly L[], completed: ReadonlySet<string>, requestedId?: string | null): L | null {
  if (ordered.length === 0) return null;
  if (requestedId) {
    const requested = ordered.find((lesson) => lesson.id === requestedId);
    if (requested) return requested;
  }
  return ordered.find((lesson) => !completed.has(lesson.id)) ?? ordered[0];
}

export function lessonNeighbors<L extends NavLesson>(ordered: readonly L[], currentId: string | null | undefined): { previous: L | null; next: L | null; position: number } {
  const index = currentId ? ordered.findIndex((lesson) => lesson.id === currentId) : -1;
  if (index === -1) return { previous: null, next: null, position: 0 };
  return { previous: ordered[index - 1] ?? null, next: ordered[index + 1] ?? null, position: index + 1 };
}

/** Lessons of the course that exist and are completed (progress of removed lessons is not counted). */
export function completedInCourse(ordered: readonly NavLesson[], completed: ReadonlySet<string>): number {
  return ordered.filter((lesson) => completed.has(lesson.id)).length;
}
