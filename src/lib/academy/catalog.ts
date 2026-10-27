import { normalizeCourseVisibility } from "./visibility";

/**
 * Estados que el catálogo de Academia consulta. `hidden` (y los históricos `draft`/`archived`) nunca se piden:
 * el filtro vive en la consulta y además lo refuerza la base (policies RESTRICTIVE de la migration de visibilidad).
 */
export const CATALOG_STATUSES = ["published", "coming_soon"] as const;

export interface CatalogCourseLike {
  id: string;
  status?: unknown;
}

export interface SplitCatalog<T extends CatalogCourseLike> {
  published: T[];
  comingSoon: T[];
}

/**
 * Separa el catálogo en cursos disponibles y "Próximamente". Cada curso aparece una sola vez y los ocultos se
 * descartan aunque la consulta los hubiera devuelto (p. ej. a un administrador).
 */
export function splitCatalogCourses<T extends CatalogCourseLike>(courses: readonly T[]): SplitCatalog<T> {
  const published: T[] = [];
  const comingSoon: T[] = [];
  const seen = new Set<string>();
  for (const course of courses) {
    if (!course?.id || seen.has(course.id)) continue;
    seen.add(course.id);
    const visibility = normalizeCourseVisibility(course.status);
    if (visibility === "published") published.push(course);
    else if (visibility === "coming_soon") comingSoon.push(course);
  }
  return { published, comingSoon };
}

/** Solo los cursos publicados pueden recomendarse como disponibles (rutas, "continuar aprendiendo", Stampy). */
export function filterRecommendableCourses<T extends CatalogCourseLike>(courses: readonly T[]): T[] {
  return courses.filter((course) => normalizeCourseVisibility(course?.status) === "published");
}
