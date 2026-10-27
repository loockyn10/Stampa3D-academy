import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUserAccess, type UserAccessSnapshot } from "@/lib/auth/user-access";
import { isFeatureAvailable } from "@/lib/features/server";
import { resolveCourseAccess, type CourseAccessDecision, type CourseVisibility } from "./visibility";

/**
 * Control de acceso del lado del servidor a un curso (página, clases, progreso). Combina, en este orden:
 *   1. funcionalidad Academia (feature flag; los administradores la conservan);
 *   2. membresía (`accessPlatform`; `authenticated != paid`);
 *   3. visibilidad del curso (`published` / `coming_soon` / `hidden`).
 * La base refuerza lo mismo con policies RESTRICTIVE (migration de visibilidad); esto evita confiar en ellas
 * como única barrera y devuelve un estado que la UI puede mostrar sin filtrar datos.
 */

export interface GateCourse {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  courseKind: string | null;
  level: string | null;
  status: string | null;
}

export type CourseGate =
  | { kind: "open"; course: GateCourse; decision: CourseAccessDecision }
  | { kind: "coming_soon"; course: GateCourse }
  | { kind: "not_found" }
  | { kind: "feature_unavailable" }
  | { kind: "no_membership" }
  | { kind: "unauthenticated" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCourseUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export interface GateInputs {
  authenticated: boolean;
  isAdmin: boolean;
  accessPlatform: boolean;
  academiaAvailable: boolean;
  course: GateCourse | null;
}

/** Decisión pura (sin I/O) usada por `loadCourseGate` y por los tests. */
export function decideCourseGate(inputs: GateInputs): CourseGate {
  if (!inputs.authenticated) return { kind: "unauthenticated" };
  if (!inputs.academiaAvailable) return { kind: "feature_unavailable" };
  if (!inputs.isAdmin && !inputs.accessPlatform) return { kind: "no_membership" };
  if (!inputs.course) return { kind: "not_found" };

  const decision = resolveCourseAccess(inputs.course.status, { isAdmin: inputs.isAdmin });
  // Oculto es indistinguible de inexistente para quien no es administrador.
  if (!decision.canView) return { kind: "not_found" };
  if (!decision.canEnter) return { kind: "coming_soon", course: inputs.course };
  return { kind: "open", course: inputs.course, decision };
}

interface CourseRow {
  id: string;
  slug: string | null;
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  course_kind: string | null;
  level: string | null;
  status: string | null;
}

function toGateCourse(row: CourseRow): GateCourse {
  return {
    id: row.id,
    slug: row.slug ?? null,
    title: row.title || "Curso",
    description: row.description ?? null,
    thumbnailUrl: row.thumbnail_url ?? null,
    courseKind: row.course_kind ?? null,
    level: row.level ?? null,
    status: row.status ?? null,
  };
}

/**
 * Resuelve el acceso a `/cursos/[id]` (id o slug). La consulta usa la sesión del usuario: con las policies de la
 * migration un curso oculto ni siquiera se devuelve a un alumno; aun así la decisión se vuelve a tomar acá.
 */
export async function loadCourseGate(
  supabase: SupabaseClient,
  idOrSlug: string,
  resolvedAccess?: UserAccessSnapshot,
): Promise<CourseGate> {
  const access = resolvedAccess ?? (await getCurrentUserAccess(supabase)).access;
  if (!access.authenticated) return { kind: "unauthenticated" };

  const isAdmin = access.capabilities.accessAdmin === true;
  const academiaAvailable = await isFeatureAvailable(supabase, "academia", access);
  if (!academiaAvailable || (!isAdmin && !access.capabilities.accessPlatform)) {
    return decideCourseGate({
      authenticated: true,
      isAdmin,
      accessPlatform: access.capabilities.accessPlatform,
      academiaAvailable,
      course: null,
    });
  }

  const key = idOrSlug.trim();
  if (!key) return { kind: "not_found" };

  let query = supabase
    .from("courses")
    .select("id, slug, title, description, thumbnail_url, course_kind, level, status");
  query = isCourseUuid(key) ? query.eq("id", key) : query.eq("slug", key);
  const { data, error } = await query.maybeSingle();

  return decideCourseGate({
    authenticated: true,
    isAdmin,
    accessPlatform: access.capabilities.accessPlatform,
    academiaAvailable,
    course: !error && data ? toGateCourse(data as CourseRow) : null,
  });
}

export interface LessonGateRow {
  id: string;
  is_active?: boolean | null;
  course_modules?: {
    is_active?: boolean | null;
    courses?: { id: string; status: string | null } | { id: string; status: string | null }[] | null;
  } | {
    is_active?: boolean | null;
    courses?: { id: string; status: string | null } | { id: string; status: string | null }[] | null;
  }[] | null;
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export type LessonGate =
  | { allowed: true; courseId: string; visibility: CourseVisibility }
  | { allowed: false; reason: "feature_unavailable" | "no_membership" | "unauthenticated" | "not_found" | "course_locked" };

/**
 * Acceso a una clase concreta (progreso, contexto de Stampy): la clase debe existir, estar activa y pertenecer a
 * un curso `published` (o ser administrador).
 */
export async function loadLessonGate(
  supabase: SupabaseClient,
  lessonId: string,
  resolvedAccess?: UserAccessSnapshot,
): Promise<LessonGate> {
  const access = resolvedAccess ?? (await getCurrentUserAccess(supabase)).access;
  if (!access.authenticated) return { allowed: false, reason: "unauthenticated" };
  const isAdmin = access.capabilities.accessAdmin === true;
  if (!(await isFeatureAvailable(supabase, "academia", access))) return { allowed: false, reason: "feature_unavailable" };
  if (!isAdmin && !access.capabilities.accessPlatform) return { allowed: false, reason: "no_membership" };
  if (!isCourseUuid(lessonId)) return { allowed: false, reason: "not_found" };

  const { data, error } = await supabase
    .from("lessons")
    .select("id, is_active, course_modules!inner ( is_active, courses!inner ( id, status ) )")
    .eq("id", lessonId)
    .maybeSingle();
  if (error || !data) return { allowed: false, reason: "not_found" };

  const lesson = data as unknown as LessonGateRow;
  const lessonModule = first(lesson.course_modules);
  const course = first(lessonModule?.courses);
  if (!course?.id) return { allowed: false, reason: "not_found" };

  const decision = resolveCourseAccess(course.status, { isAdmin });
  if (!decision.canView) return { allowed: false, reason: "not_found" };
  if (!decision.canWriteProgress) return { allowed: false, reason: "course_locked" };
  return { allowed: true, courseId: course.id, visibility: decision.visibility };
}
