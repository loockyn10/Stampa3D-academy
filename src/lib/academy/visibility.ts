/**
 * Visibilidad de cursos y talleres de Academia (fuente única).
 *
 * Se persiste en la columna existente `courses.status` (no hay columna nueva): los valores canónicos son
 * `published`, `coming_soon` y `hidden`. Los valores históricos `draft` y `archived` (y cualquier valor
 * desconocido o vacío) se interpretan como `hidden`: nunca como publicados.
 *
 * Esto es solo la regla de decisión. La barrera real vive en el servidor (`src/lib/academy/access.ts`, Server
 * Actions) y en la base (migration `20261026120000_academy_course_visibility.sql`, policies RESTRICTIVE).
 */

export const COURSE_VISIBILITIES = ["published", "coming_soon", "hidden"] as const;

export type CourseVisibility = (typeof COURSE_VISIBILITIES)[number];

export const COURSE_VISIBILITY_META: Record<
  CourseVisibility,
  { label: string; shortLabel: string; description: string; adminHint: string }
> = {
  published: {
    label: "Publicado",
    shortLabel: "Publicado",
    description: "Visible en Academia y disponible para los alumnos según su membresía.",
    adminHint: "Los alumnos pueden entrar, ver las clases y registrar su progreso.",
  },
  coming_soon: {
    label: "En preparación",
    shortLabel: "En preparación",
    description: "Aparece en el catálogo con su portada y descripción, pero con el contenido bloqueado.",
    adminHint: "Genera expectativa: nadie puede entrar a las clases ni registrar progreso hasta publicarlo.",
  },
  hidden: {
    label: "Oculto",
    shortLabel: "Oculto",
    description: "No aparece en Academia, buscador, Inicio ni recomendaciones, y su URL no es accesible.",
    adminHint: "Solo los administradores lo ven. No se elimina nada: clases, inscripciones y progreso se conservan.",
  },
};

/** Interpreta cualquier valor de `courses.status` (incluidos los históricos) como una visibilidad canónica. */
export function normalizeCourseVisibility(status: unknown): CourseVisibility {
  if (status === "published") return "published";
  if (status === "coming_soon") return "coming_soon";
  return "hidden";
}

export function isCourseVisibility(value: unknown): value is CourseVisibility {
  return typeof value === "string" && (COURSE_VISIBILITIES as readonly string[]).includes(value);
}

/** Estados en los que un alumno pierde (temporalmente) el acceso al contenido. */
export function isBlockedVisibility(visibility: CourseVisibility): boolean {
  return visibility !== "published";
}

export interface CourseAccessDecision {
  visibility: CourseVisibility;
  /** La ficha del curso puede mostrarse (catálogo o URL directa). */
  canView: boolean;
  /** Puede entrar a módulos, clases y recursos. */
  canEnter: boolean;
  /** Puede crear/actualizar progreso. */
  canWriteProgress: boolean;
  /** Puede ofrecerse como curso disponible (recomendaciones, Stampy, "continuar aprendiendo"). */
  canRecommend: boolean;
  /** Aparece en el catálogo público. */
  listed: boolean;
  /** Solo es una vista previa de administración (el estado no permitiría el acceso a un alumno). */
  adminPreview: boolean;
}

/**
 * Decisión de acceso a un curso para quien consulta. Los administradores conservan acceso completo (edición y
 * vista previa) pero no "ven" el curso como publicado: `adminPreview` indica que el estado bloquearía al resto.
 * Esta regla se SUMA a la de membresía y a la de la funcionalidad Academia; no las reemplaza.
 */
export function resolveCourseAccess(status: unknown, options: { isAdmin: boolean }): CourseAccessDecision {
  const visibility = normalizeCourseVisibility(status);
  const open = visibility === "published";
  const isAdmin = options.isAdmin === true;
  return {
    visibility,
    canView: isAdmin || visibility !== "hidden",
    canEnter: isAdmin || open,
    canWriteProgress: isAdmin || open,
    canRecommend: open,
    listed: visibility !== "hidden",
    adminPreview: isAdmin && !open,
  };
}

/** Texto de advertencia al bloquear un curso con alumnos que ya tienen progreso. */
export function describeVisibilityImpact(learnerCount: number, next: CourseVisibility): string | null {
  if (!isBlockedVisibility(next) || learnerCount <= 0) return null;
  const people = learnerCount === 1 ? "1 alumno ya tiene" : `${learnerCount} alumnos ya tienen`;
  const state = next === "coming_soon" ? "«En preparación»" : "«Oculto»";
  return `${people} progreso en este curso. Al pasarlo a ${state} perderán temporalmente el acceso, pero no se borran sus inscripciones ni su progreso: volverán a verlo al publicarlo de nuevo.`;
}
