/**
 * "Continuar aprendiendo" de Inicio: el curso con la lección completada más reciente
 * (`lesson_progress.completed_at`). Antes se tomaba el primer curso encontrado, no el último iniciado.
 */

export interface LessonProgressCourseRow {
  completed_at?: string | null;
  lessons?: {
    course_modules?: {
      courses?: {
        id: string;
        title?: string | null;
        slug?: string | null;
        thumbnail_url?: string | null;
      } | null;
    } | null;
  } | null;
}

export interface ContinueLearningCourse {
  courseId: string;
  /** Segmento de URL de `/cursos/[id]` (slug o id). */
  routeId: string;
  title: string;
  thumbnailUrl: string | null;
  completedLessons: number;
  lastActivityAt: string | null;
  /** Cursos distintos con al menos una lección completada. */
  startedCourses: number;
}

export function pickContinueLearningCourse(rows: LessonProgressCourseRow[]): ContinueLearningCourse | null {
  const byCourse = new Map<string, { course: NonNullable<NonNullable<NonNullable<LessonProgressCourseRow["lessons"]>["course_modules"]>["courses"]>; completed: number; last: number; lastIso: string | null }>();
  for (const row of rows) {
    const course = row.lessons?.course_modules?.courses;
    if (!course?.id) continue;
    const at = row.completed_at ? Date.parse(row.completed_at) : Number.NaN;
    const entry = byCourse.get(course.id) ?? { course, completed: 0, last: Number.NEGATIVE_INFINITY, lastIso: null };
    entry.completed += 1;
    if (Number.isFinite(at) && at > entry.last) {
      entry.last = at;
      entry.lastIso = row.completed_at ?? null;
    }
    byCourse.set(course.id, entry);
  }
  if (byCourse.size === 0) return null;
  const [latest] = Array.from(byCourse.values()).sort((a, b) => b.last - a.last);
  return {
    courseId: latest.course.id,
    routeId: latest.course.slug || latest.course.id,
    title: latest.course.title || "Curso",
    thumbnailUrl: latest.course.thumbnail_url || null,
    completedLessons: latest.completed,
    lastActivityAt: latest.lastIso,
    startedCourses: byCourse.size,
  };
}

export function courseProgressPercent(completed: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}
